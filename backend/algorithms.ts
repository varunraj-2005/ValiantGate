import type {
  AdaptiveSnapshot,
  RateLimitAlgorithm,
  RateLimitConfig,
  SlidingWindowSnapshot,
  UserCategory,
} from './types.ts';

export interface RateLimitDecision {
  allowed: boolean;
  algorithm: RateLimitAlgorithm;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  reason: string;
}

interface FixedWindowEntry {
  windowIndex: number;
  count: number;
}

interface TokenBucketEntry {
  tokens: number;
  lastRefillMs: number;
}

interface SlidingWindowEntry {
  timestamps: number[];
  expiredCount: number;
  acceptedCount: number;
  rejectedCount: number;
}

interface UserAbuseState {
  recentTimestamps: number[];
  recent429s: number[];
  recentErrors: number[];
}

const PRIORITY_WEIGHTS: Record<UserCategory, number> = {
  basic: 1,
  standard: 2,
  premium: 3,
};

const PRIORITY_MULTIPLIERS: Record<UserCategory, number> = {
  basic: 0.75,
  standard: 1.0,
  premium: 1.35,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class RateLimiterEngine {
  private fixedWindows = new Map<string, FixedWindowEntry>();
  private tokenBuckets = new Map<string, TokenBucketEntry>();
  private slidingWindows = new Map<string, SlidingWindowEntry>();
  private adaptiveWindows = new Map<string, SlidingWindowEntry>();
  private userAbuseHistory = new Map<string, UserAbuseState>();

  // Global sliding window for aggregate safety protection
  private globalSecondTimestamps: number[] = [];

  // Smoothed adaptive controller state
  private smoothedDemand = 0;
  private smoothedAbuse = 0;
  private smoothedResource = 0;
  private currentAdaptiveLimit: number;
  private lastAdaptiveUpdateMs = 0;
  private lastAdaptiveReason = 'Initialized at base limit awaiting live traffic.';
  private lastRawLimit: number;

  private lastTrackedSlidingUser = 'demo-user-01';

  constructor(private config: RateLimitConfig) {
    this.currentAdaptiveLimit = config.adaptiveBaseLimit;
    this.lastRawLimit = config.adaptiveBaseLimit;
  }

  public updateConfig(partial: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...partial };
    this.currentAdaptiveLimit = clamp(
      this.currentAdaptiveLimit,
      this.config.adaptiveMinLimit,
      this.config.adaptiveMaxLimit,
    );
  }

  public getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  public resetEnforcementState(): void {
    this.fixedWindows.clear();
    this.tokenBuckets.clear();
    this.slidingWindows.clear();
    this.adaptiveWindows.clear();
    this.userAbuseHistory.clear();
    this.globalSecondTimestamps = [];
    this.smoothedDemand = 0;
    this.smoothedAbuse = 0;
    this.smoothedResource = 0;
    this.currentAdaptiveLimit = this.config.adaptiveBaseLimit;
    this.lastRawLimit = this.config.adaptiveBaseLimit;
    this.lastAdaptiveUpdateMs = 0;
    this.lastAdaptiveReason = 'Enforcement state reset to base limit.';
  }

  public evaluate(
    userId: string,
    category: UserCategory,
    algorithmOverride?: RateLimitAlgorithm,
    nowMs = Date.now(),
  ): RateLimitDecision {
    const algorithm = algorithmOverride ?? this.config.activeAlgorithm;
    this.lastTrackedSlidingUser = userId;

    // Maintain 1-second global window for global safety cap
    this.globalSecondTimestamps = this.globalSecondTimestamps.filter(
      (ts) => ts > nowMs - 1000,
    );

    if (algorithm === 'fixed_window') {
      return this.checkFixedWindow(userId, nowMs);
    }
    if (algorithm === 'token_bucket') {
      return this.checkTokenBucket(userId, nowMs);
    }
    if (algorithm === 'sliding_window') {
      return this.checkSlidingWindow(userId, nowMs);
    }
    return this.checkAdaptive(userId, category, nowMs);
  }

  public recordRequestOutcome(
    userId: string,
    statusCode: number,
    nowMs = Date.now(),
  ): void {
    const state = this.getOrCreateAbuseState(userId, nowMs);
    if (statusCode === 429) {
      state.recent429s.push(nowMs);
    } else if (statusCode >= 400) {
      state.recentErrors.push(nowMs);
    }
  }

  public getUserAbuseScore(userId: string, nowMs = Date.now()): number {
    const state = this.userAbuseHistory.get(userId);
    if (!state) return 0;

    const cutoff10s = nowMs - 10_000;
    const cutoff30s = nowMs - 30_000;
    state.recentTimestamps = state.recentTimestamps.filter((t) => t > cutoff10s);
    state.recent429s = state.recent429s.filter((t) => t > cutoff30s);
    state.recentErrors = state.recentErrors.filter((t) => t > cutoff30s);

    const reqRate10s = state.recentTimestamps.length / 10;
    const rateRisk = clamp(reqRate10s / 8, 0, 1); // >8 req/s from 1 identity = high burst risk
    const violationRisk = clamp(state.recent429s.length / 12, 0, 1);
    const errorRisk = clamp(state.recentErrors.length / 10, 0, 1);

    // Weighted rule-based experimental risk score [0, 1]
    return Number(
      clamp(0.45 * rateRisk + 0.4 * violationRisk + 0.15 * errorRisk, 0, 1).toFixed(3),
    );
  }

  public updateAdaptiveController(metrics: {
    currentRps: number;
    cpuPercent: number;
    memoryPercent: number;
    p95LatencyMs: number;
    nowMs?: number;
  }): AdaptiveSnapshot {
    const nowMs = metrics.nowMs ?? Date.now();
    const cfg = this.config;

    // 1. Traffic Demand Score [0, 1]
    const rawDemand = clamp(
      metrics.currentRps / Math.max(1, cfg.normalRpsThreshold * 2),
      0,
      1,
    );

    // 2. Abuse Risk Score [0, 1] across active identities + distributed identity spread
    let maxUserRisk = 0;
    let highRiskIdentities = 0;
    for (const userId of this.userAbuseHistory.keys()) {
      const score = this.getUserAbuseScore(userId, nowMs);
      if (score > maxUserRisk) maxUserRisk = score;
      if (score >= 0.45) highRiskIdentities += 1;
    }
    // Distributed abuse multiplier when >=3 identities simultaneously behave abusively
    const distributedSpread = clamp((highRiskIdentities - 1) / 6, 0, 1);
    const rawAbuse = clamp(0.65 * maxUserRisk + 0.35 * distributedSpread, 0, 1);

    // 3. Backend Resource Pressure Score [0, 1]
    const cpuScore = clamp(metrics.cpuPercent / Math.max(1, cfg.criticalCpuThreshold), 0, 1);
    const memScore = clamp(
      metrics.memoryPercent / Math.max(1, cfg.criticalMemoryThreshold),
      0,
      1,
    );
    const latScore = clamp(
      metrics.p95LatencyMs / Math.max(1, cfg.criticalLatencyMsThreshold),
      0,
      1,
    );
    const rawResource = clamp(0.45 * cpuScore + 0.25 * memScore + 0.3 * latScore, 0, 1);

    // Smooth scores via EMA (alpha_ema = 0.35) to prevent oscillations
    const ema = 0.35;
    this.smoothedDemand =
      this.lastAdaptiveUpdateMs === 0
        ? rawDemand
        : ema * rawDemand + (1 - ema) * this.smoothedDemand;
    this.smoothedAbuse =
      this.lastAdaptiveUpdateMs === 0
        ? rawAbuse
        : ema * rawAbuse + (1 - ema) * this.smoothedAbuse;
    this.smoothedResource =
      this.lastAdaptiveUpdateMs === 0
        ? rawResource
        : ema * rawResource + (1 - ema) * this.smoothedResource;

    // Experimental control formula:
    // Adaptive Limit = Base * (1 + alpha * Demand - beta * Abuse - gamma * ResourcePressure)
    const rawFormulaLimit =
      cfg.adaptiveBaseLimit *
      (1 +
        cfg.adaptiveAlpha * this.smoothedDemand -
        cfg.adaptiveBeta * this.smoothedAbuse -
        cfg.adaptiveGamma * this.smoothedResource);

    const boundedTarget = clamp(
      Math.round(rawFormulaLimit),
      cfg.adaptiveMinLimit,
      cfg.adaptiveMaxLimit,
    );
    this.lastRawLimit = Math.round(rawFormulaLimit);

    // Slew-rate limiter: cap change per update tick to prevent sudden jumps
    const maxStep = Math.max(2, Math.round(cfg.adaptiveBaseLimit * 0.15));
    const delta = boundedTarget - this.currentAdaptiveLimit;
    const prevLimit = this.currentAdaptiveLimit;
    if (Math.abs(delta) > maxStep) {
      this.currentAdaptiveLimit = prevLimit + Math.sign(delta) * maxStep;
    } else {
      this.currentAdaptiveLimit = boundedTarget;
    }
    this.currentAdaptiveLimit = clamp(
      this.currentAdaptiveLimit,
      cfg.adaptiveMinLimit,
      cfg.adaptiveMaxLimit,
    );

    // Build clear plain-English explanation
    const drivers: string[] = [];
    if (this.smoothedAbuse >= 0.35) {
      drivers.push(
        `elevated rule-based abuse risk (${(this.smoothedAbuse * 100).toFixed(0)}%)`,
      );
    }
    if (this.smoothedResource >= 0.45) {
      drivers.push(
        `backend resource pressure (${(this.smoothedResource * 100).toFixed(0)}%)`,
      );
    }
    if (this.smoothedDemand >= 0.35) {
      drivers.push(
        `rising traffic demand (${(this.smoothedDemand * 100).toFixed(0)}%)`,
      );
    }

    if (this.currentAdaptiveLimit < prevLimit) {
      this.lastAdaptiveReason =
        drivers.length > 0
          ? `Reduced limit from ${prevLimit} to ${this.currentAdaptiveLimit} due to ${drivers.join(' and ')}.`
          : `Reduced limit from ${prevLimit} to ${this.currentAdaptiveLimit} toward target equilibrium (${boundedTarget}).`;
    } else if (this.currentAdaptiveLimit > prevLimit) {
      this.lastAdaptiveReason =
        drivers.length > 0
          ? `Increased limit from ${prevLimit} to ${this.currentAdaptiveLimit} to accommodate ${drivers.join(' and ')} while system headroom remains healthy.`
          : `Relaxed limit from ${prevLimit} to ${this.currentAdaptiveLimit} as abuse and resource pressure subsided.`;
    } else if (drivers.length === 0) {
      this.lastAdaptiveReason = `Holding steady at ${this.currentAdaptiveLimit} req/window under nominal demand and healthy server resources.`;
    } else {
      this.lastAdaptiveReason = `Holding at ${this.currentAdaptiveLimit} req/window (clamped/stabilized with ${drivers.join(', ')}).`;
    }

    this.lastAdaptiveUpdateMs = nowMs;

    return this.getAdaptiveSnapshot();
  }

  public getAdaptiveSnapshot(): AdaptiveSnapshot {
    return {
      demandScore: Number(this.smoothedDemand.toFixed(3)),
      abuseRiskScore: Number(this.smoothedAbuse.toFixed(3)),
      resourcePressureScore: Number(this.smoothedResource.toFixed(3)),
      baseLimit: this.config.adaptiveBaseLimit,
      currentLimit: this.currentAdaptiveLimit,
      minLimit: this.config.adaptiveMinLimit,
      maxLimit: this.config.adaptiveMaxLimit,
      rawComputedLimit: this.lastRawLimit,
      alpha: this.config.adaptiveAlpha,
      beta: this.config.adaptiveBeta,
      gamma: this.config.adaptiveGamma,
      reason: this.lastAdaptiveReason,
      updatedAt: new Date().toISOString(),
    };
  }

  public getEffectiveUserLimit(userId: string, category: UserCategory): number {
    if (this.config.activeAlgorithm === 'fixed_window') {
      return this.config.fixedWindowLimit;
    }
    if (this.config.activeAlgorithm === 'token_bucket') {
      return this.config.tokenBucketCapacity;
    }
    if (this.config.activeAlgorithm === 'sliding_window') {
      return this.config.slidingWindowLimit;
    }
    return this.computeAdaptiveUserLimit(userId, category);
  }

  public getSlidingWindowSnapshot(userId?: string): SlidingWindowSnapshot {
    const targetUser = userId ?? this.lastTrackedSlidingUser;
    const nowMs = Date.now();
    const isAdaptive = this.config.activeAlgorithm === 'adaptive';
    const map = isAdaptive ? this.adaptiveWindows : this.slidingWindows;
    const windowSeconds = this.config.slidingWindowSeconds;
    const limit = isAdaptive
      ? this.currentAdaptiveLimit
      : this.config.slidingWindowLimit;

    const entry = map.get(targetUser) ?? {
      timestamps: [],
      expiredCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
    };

    const cutoff = nowMs - windowSeconds * 1000;
    const activeTimestamps = entry.timestamps.filter((ts) => ts > cutoff);
    const newlyExpired = entry.timestamps.length - activeTimestamps.length;
    if (newlyExpired > 0) {
      entry.timestamps = activeTimestamps;
      entry.expiredCount += newlyExpired;
    }

    return {
      userId: targetUser,
      limit,
      windowSeconds,
      inWindowCount: entry.timestamps.length,
      remaining: Math.max(0, limit - entry.timestamps.length),
      expiredCount: entry.expiredCount,
      acceptedCount: entry.acceptedCount,
      rejectedCount: entry.rejectedCount,
      timestamps: [...entry.timestamps],
      nowMs,
    };
  }

  public getPriorityWeight(category: UserCategory): number {
    return PRIORITY_WEIGHTS[category] ?? 1;
  }

  private getOrCreateAbuseState(userId: string, nowMs: number): UserAbuseState {
    let state = this.userAbuseHistory.get(userId);
    if (!state) {
      state = { recentTimestamps: [], recent429s: [], recentErrors: [] };
      this.userAbuseHistory.set(userId, state);
    }
    state.recentTimestamps.push(nowMs);
    return state;
  }

  private computeAdaptiveUserLimit(userId: string, category: UserCategory): number {
    const multiplier = PRIORITY_MULTIPLIERS[category] ?? 1.0;
    const userAbuse = this.getUserAbuseScore(userId);
    // Individual abusive user gets throttled proportionally even if global traffic is mild
    const penaltyFactor = userAbuse >= 0.45 ? Math.max(0.25, 1 - userAbuse * 0.75) : 1.0;
    const singleUserFairCap = Math.max(
      this.config.adaptiveMinLimit,
      Math.round(this.config.adaptiveMaxLimit * 0.85),
    );
    const raw = Math.round(this.currentAdaptiveLimit * multiplier * penaltyFactor);
    return clamp(raw, this.config.adaptiveMinLimit, singleUserFairCap);
  }

  private checkFixedWindow(userId: string, nowMs: number): RateLimitDecision {
    const windowMs = this.config.fixedWindowSeconds * 1000;
    const windowIndex = Math.floor(nowMs / windowMs);
    const limit = this.config.fixedWindowLimit;

    let entry = this.fixedWindows.get(userId);
    if (!entry || entry.windowIndex !== windowIndex) {
      entry = { windowIndex, count: 0 };
      this.fixedWindows.set(userId, entry);
    }

    const windowEndMs = (windowIndex + 1) * windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - nowMs) / 1000));

    if (entry.count < limit) {
      entry.count += 1;
      this.globalSecondTimestamps.push(nowMs);
      this.getOrCreateAbuseState(userId, nowMs);
      return {
        allowed: true,
        algorithm: 'fixed_window',
        limit,
        remaining: Math.max(0, limit - entry.count),
        retryAfterSeconds: 0,
        reason: 'Accepted within fixed window quota.',
      };
    }

    this.getOrCreateAbuseState(userId, nowMs);
    return {
      allowed: false,
      algorithm: 'fixed_window',
      limit,
      remaining: 0,
      retryAfterSeconds,
      reason: `Fixed window limit (${limit}/${this.config.fixedWindowSeconds}s) exceeded.`,
    };
  }

  private checkTokenBucket(userId: string, nowMs: number): RateLimitDecision {
    const capacity = this.config.tokenBucketCapacity;
    const refillRate = this.config.tokenBucketRefillRate;

    let entry = this.tokenBuckets.get(userId);
    if (!entry) {
      entry = { tokens: capacity, lastRefillMs: nowMs };
      this.tokenBuckets.set(userId, entry);
    } else {
      const elapsedSec = Math.max(0, (nowMs - entry.lastRefillMs) / 1000);
      entry.tokens = Math.min(capacity, entry.tokens + elapsedSec * refillRate);
      entry.lastRefillMs = nowMs;
    }

    this.getOrCreateAbuseState(userId, nowMs);

    if (entry.tokens >= 1) {
      entry.tokens -= 1;
      this.globalSecondTimestamps.push(nowMs);
      return {
        allowed: true,
        algorithm: 'token_bucket',
        limit: capacity,
        remaining: Math.floor(entry.tokens),
        retryAfterSeconds: 0,
        reason: 'Accepted; 1 token consumed from bucket.',
      };
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((1 - entry.tokens) / Math.max(0.01, refillRate)),
    );
    return {
      allowed: false,
      algorithm: 'token_bucket',
      limit: capacity,
      remaining: 0,
      retryAfterSeconds,
      reason: `Token bucket empty (capacity=${capacity}, refill=${refillRate}/s).`,
    };
  }

  private checkSlidingWindow(userId: string, nowMs: number): RateLimitDecision {
    const windowSeconds = this.config.slidingWindowSeconds;
    const windowMs = windowSeconds * 1000;
    const limit = this.config.slidingWindowLimit;

    let entry = this.slidingWindows.get(userId);
    if (!entry) {
      entry = {
        timestamps: [],
        expiredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
      };
      this.slidingWindows.set(userId, entry);
    }

    const cutoff = nowMs - windowMs;
    const valid = entry.timestamps.filter((ts) => ts > cutoff);
    entry.expiredCount += entry.timestamps.length - valid.length;
    entry.timestamps = valid;

    this.getOrCreateAbuseState(userId, nowMs);

    if (entry.timestamps.length < limit) {
      entry.timestamps.push(nowMs);
      entry.acceptedCount += 1;
      this.globalSecondTimestamps.push(nowMs);
      return {
        allowed: true,
        algorithm: 'sliding_window',
        limit,
        remaining: Math.max(0, limit - entry.timestamps.length),
        retryAfterSeconds: 0,
        reason: 'Accepted within sliding window log.',
      };
    }

    entry.rejectedCount += 1;
    const oldest = entry.timestamps[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
    return {
      allowed: false,
      algorithm: 'sliding_window',
      limit,
      remaining: 0,
      retryAfterSeconds,
      reason: `Sliding window limit (${limit} in ${windowSeconds}s) reached.`,
    };
  }

  private checkAdaptive(
    userId: string,
    category: UserCategory,
    nowMs: number,
  ): RateLimitDecision {
    const windowSeconds = this.config.slidingWindowSeconds;
    const windowMs = windowSeconds * 1000;

    this.getOrCreateAbuseState(userId, nowMs);

    // Enforce global server safety cap first so combined traffic never overwhelms host
    if (this.globalSecondTimestamps.length >= this.config.globalSafetyCapRps) {
      return {
        allowed: false,
        algorithm: 'adaptive',
        limit: this.computeAdaptiveUserLimit(userId, category),
        remaining: 0,
        retryAfterSeconds: 1,
        reason: `Global server safety cap (${this.config.globalSafetyCapRps} req/s) engaged.`,
      };
    }

    const effectiveLimit = this.computeAdaptiveUserLimit(userId, category);

    let entry = this.adaptiveWindows.get(userId);
    if (!entry) {
      entry = {
        timestamps: [],
        expiredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
      };
      this.adaptiveWindows.set(userId, entry);
    }

    const cutoff = nowMs - windowMs;
    const valid = entry.timestamps.filter((ts) => ts > cutoff);
    entry.expiredCount += entry.timestamps.length - valid.length;
    entry.timestamps = valid;

    if (entry.timestamps.length < effectiveLimit) {
      entry.timestamps.push(nowMs);
      entry.acceptedCount += 1;
      this.globalSecondTimestamps.push(nowMs);
      return {
        allowed: true,
        algorithm: 'adaptive',
        limit: effectiveLimit,
        remaining: Math.max(0, effectiveLimit - entry.timestamps.length),
        retryAfterSeconds: 0,
        reason: `Accepted under adaptive quota (${effectiveLimit} for ${category}).`,
      };
    }

    entry.rejectedCount += 1;
    const oldest = entry.timestamps[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
    return {
      allowed: false,
      algorithm: 'adaptive',
      limit: effectiveLimit,
      remaining: 0,
      retryAfterSeconds,
      reason: `Adaptive quota (${effectiveLimit}/${windowSeconds}s) exceeded for ${category} user.`,
    };
  }
}

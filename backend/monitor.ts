import os from 'node:os';
import type { RateLimiterEngine } from './algorithms.ts';
import type {
  MonitoringSnapshot,
  RateLimitAlgorithm,
  RequestLogEntry,
  TimeSeriesPoint,
  TrafficState,
  UserCategory,
  UserStats,
} from './types.ts';

interface CpuSample {
  idle: number;
  total: number;
}

const MAX_RECENT_LOGS = 200;
const MAX_TIME_SERIES = 120;
const MAX_LATENCY_WINDOW = 500;

const TRACKED_STATUS_CODES = [
  '200',
  '201',
  '400',
  '401',
  '403',
  '404',
  '429',
  '500',
  '503',
];

function sampleCpuTotals(): CpuSample {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

export function maskClientIdentifier(rawId: string): string {
  const trimmed = rawId.trim();
  if (!trimmed) return 'anonymous';
  // Never expose raw long API keys or bearer secrets in logs
  if (trimmed.length > 20 || trimmed.toLowerCase().startsWith('sk_') || trimmed.toLowerCase().startsWith('key_')) {
    return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
  }
  return trimmed;
}

export class MonitoringService {
  private startedAtIso = new Date().toISOString();
  private startedAtMs = Date.now();
  private apiPaused = false;

  private totalIncoming = 0;
  private totalAccepted = 0;
  private totalRejected = 0;
  private totalSuccessful = 0;
  private totalFailed = 0;
  private totalServerErrors = 0;

  private statusCodes: Record<string, number> = {};
  private recentLogs: RequestLogEntry[] = [];
  private timeSeries: TimeSeriesPoint[] = [];
  private latenciesMs: number[] = [];

  private userMap = new Map<string, UserStats>();
  private activeUsersWindow = new Map<string, number>();

  // Rolling 1-second counters for time-series & live RPS
  private secIncomingTimestamps: number[] = [];
  private secAcceptedTimestamps: number[] = [];
  private secRejectedTimestamps: number[] = [];

  private prevCpuSample: CpuSample = sampleCpuTotals();
  private lastCpuPercent = 0;
  private lastMemoryPercent = 0;

  private trafficState: TrafficState = 'GREEN';
  private trafficStateChangedAt = new Date().toISOString();
  private trafficReason = 'Request rate, CPU, and latency are within nominal thresholds.';
  private lastResetEvent: string | null = null;

  private samplerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private limiter: RateLimiterEngine) {
    this.initStatusCounts();
    this.sampleResources();
  }

  private initStatusCounts(): void {
    this.statusCodes = {};
    for (const code of TRACKED_STATUS_CODES) {
      this.statusCodes[code] = 0;
    }
  }

  public startSampler(): void {
    if (this.samplerTimer) return;
    this.samplerTimer = setInterval(() => {
      this.tickSample();
    }, 1000);
  }

  public stopSampler(): void {
    if (this.samplerTimer) {
      clearInterval(this.samplerTimer);
      this.samplerTimer = null;
    }
  }

  public isApiPaused(): boolean {
    return this.apiPaused;
  }

  public setApiPaused(paused: boolean): void {
    this.apiPaused = paused;
  }

  public recordRequest(params: {
    clientId: string;
    category: UserCategory;
    endpoint: string;
    method: string;
    statusCode: number;
    responseTimeMs: number;
    algorithm: RateLimitAlgorithm;
    decision: 'Accepted' | 'Rejected' | 'Paused' | 'Error';
  }): void {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const safeClientId = maskClientIdentifier(params.clientId);

    this.totalIncoming += 1;
    this.secIncomingTimestamps.push(nowMs);

    if (params.decision === 'Accepted') {
      this.totalAccepted += 1;
      this.secAcceptedTimestamps.push(nowMs);
    } else if (params.decision === 'Rejected') {
      this.totalRejected += 1;
      this.secRejectedTimestamps.push(nowMs);
    }

    if (params.statusCode >= 200 && params.statusCode < 300) {
      this.totalSuccessful += 1;
    } else if (params.statusCode >= 500) {
      this.totalServerErrors += 1;
      this.totalFailed += 1;
    } else if (params.statusCode >= 400 && params.statusCode !== 429) {
      this.totalFailed += 1;
    }

    const codeKey = String(params.statusCode);
    this.statusCodes[codeKey] = (this.statusCodes[codeKey] ?? 0) + 1;

    this.latenciesMs.push(params.responseTimeMs);
    if (this.latenciesMs.length > MAX_LATENCY_WINDOW) {
      this.latenciesMs.shift();
    }

    this.activeUsersWindow.set(safeClientId, nowMs);

    // Update per-user aggregate stats
    let user = this.userMap.get(safeClientId);
    if (!user) {
      user = {
        userId: safeClientId,
        category: params.category,
        priorityWeight: this.limiter.getPriorityWeight(params.category),
        totalRequests: 0,
        acceptedRequests: 0,
        rejectedRequests: 0,
        currentLimit: this.limiter.getEffectiveUserLimit(
          params.clientId,
          params.category,
        ),
        abuseRiskScore: 0,
        lastSeenAt: nowIso,
      };
      this.userMap.set(safeClientId, user);
    }

    user.category = params.category;
    user.priorityWeight = this.limiter.getPriorityWeight(params.category);
    user.totalRequests += 1;
    if (params.decision === 'Accepted') {
      user.acceptedRequests += 1;
    } else if (params.decision === 'Rejected') {
      user.rejectedRequests += 1;
    }
    user.currentLimit = this.limiter.getEffectiveUserLimit(
      params.clientId,
      params.category,
    );
    user.abuseRiskScore = this.limiter.getUserAbuseScore(params.clientId, nowMs);
    user.lastSeenAt = nowIso;

    // Bounded recent log ring buffer
    const entry: RequestLogEntry = {
      id: `${nowMs}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: nowIso,
      clientId: safeClientId,
      category: params.category,
      endpoint: params.endpoint,
      method: params.method,
      statusCode: params.statusCode,
      responseTimeMs: Number(params.responseTimeMs.toFixed(2)),
      algorithm: params.algorithm,
      decision: params.decision,
    };

    this.recentLogs.unshift(entry);
    if (this.recentLogs.length > MAX_RECENT_LOGS) {
      this.recentLogs.pop();
    }
  }

  /**
   * Clear monitoring history & aggregate charts WITHOUT deleting Redis/enforcement buckets
   * or active security configuration.
   */
  public clearDashboardData(): void {
    this.totalIncoming = 0;
    this.totalAccepted = 0;
    this.totalRejected = 0;
    this.totalSuccessful = 0;
    this.totalFailed = 0;
    this.totalServerErrors = 0;
    this.initStatusCounts();
    this.recentLogs = [];
    this.timeSeries = [];
    this.latenciesMs = [];
    this.userMap.clear();
    this.activeUsersWindow.clear();
    this.secIncomingTimestamps = [];
    this.secAcceptedTimestamps = [];
    this.secRejectedTimestamps = [];
    this.trafficState = 'GREEN';
    this.trafficStateChangedAt = new Date().toISOString();
    this.trafficReason = 'Dashboard monitoring data cleared; awaiting incoming traffic.';
    this.lastResetEvent = `Monitoring reset executed at ${new Date().toISOString()} (rate-limit enforcement state preserved).`;
  }

  public resetExperimentMetrics(): void {
    this.clearDashboardData();
    this.lastResetEvent = `Experiment metrics reset at ${new Date().toISOString()}.`;
  }

  private pruneRollingSecond(nowMs: number): {
    incomingRps: number;
    acceptedRps: number;
    rejectedRps: number;
  } {
    const cutoff = nowMs - 1000;
    this.secIncomingTimestamps = this.secIncomingTimestamps.filter((t) => t > cutoff);
    this.secAcceptedTimestamps = this.secAcceptedTimestamps.filter((t) => t > cutoff);
    this.secRejectedTimestamps = this.secRejectedTimestamps.filter((t) => t > cutoff);

    // Prune active users older than 60 seconds
    const userCutoff = nowMs - 60_000;
    for (const [uid, seenAt] of this.activeUsersWindow.entries()) {
      if (seenAt < userCutoff) {
        this.activeUsersWindow.delete(uid);
      }
    }

    return {
      incomingRps: this.secIncomingTimestamps.length,
      acceptedRps: this.secAcceptedTimestamps.length,
      rejectedRps: this.secRejectedTimestamps.length,
    };
  }

  private sampleResources(): {
    cpuPercent: number;
    memoryPercent: number;
    availableMemoryMb: number;
    totalMemoryMb: number;
    processRssMb: number;
  } {
    const nextCpu = sampleCpuTotals();
    const idleDiff = nextCpu.idle - this.prevCpuSample.idle;
    const totalDiff = nextCpu.total - this.prevCpuSample.total;
    this.prevCpuSample = nextCpu;

    const cpuPct =
      totalDiff > 0 ? Math.max(0, Math.min(100, (1 - idleDiff / totalDiff) * 100)) : this.lastCpuPercent;
    this.lastCpuPercent = Number(cpuPct.toFixed(1));

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMemPct = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;
    this.lastMemoryPercent = Number(usedMemPct.toFixed(1));

    const rssMb = process.memoryUsage().rss / (1024 * 1024);

    return {
      cpuPercent: this.lastCpuPercent,
      memoryPercent: this.lastMemoryPercent,
      availableMemoryMb: Math.round(freeMem / (1024 * 1024)),
      totalMemoryMb: Math.round(totalMem / (1024 * 1024)),
      processRssMb: Number(rssMb.toFixed(1)),
    };
  }

  private computeLatencyStats(): { avg: number; p95: number; p99: number } {
    if (this.latenciesMs.length === 0) {
      return { avg: 0, p95: 0, p99: 0 };
    }
    const sum = this.latenciesMs.reduce((acc, v) => acc + v, 0);
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    return {
      avg: Number((sum / this.latenciesMs.length).toFixed(2)),
      p95: Number(percentile(sorted, 95).toFixed(2)),
      p99: Number(percentile(sorted, 99).toFixed(2)),
    };
  }

  private evaluateTrafficState(
    rps: number,
    cpuPercent: number,
    memoryPercent: number,
    p95LatencyMs: number,
  ): void {
    const cfg = this.limiter.getConfig();
    let nextState: TrafficState = 'GREEN';
    let nextReason = 'Request rate, CPU, and latency are within nominal thresholds.';

    const isCritical =
      rps >= cfg.criticalRpsThreshold ||
      cpuPercent >= cfg.criticalCpuThreshold ||
      memoryPercent >= cfg.criticalMemoryThreshold ||
      p95LatencyMs >= cfg.criticalLatencyMsThreshold;

    const isHigh =
      rps >= cfg.normalRpsThreshold ||
      cpuPercent >= cfg.criticalCpuThreshold * 0.75 ||
      p95LatencyMs >= cfg.criticalLatencyMsThreshold * 0.6;

    if (isCritical) {
      nextState = 'RED';
      const reasons: string[] = [];
      if (rps >= cfg.criticalRpsThreshold) reasons.push(`RPS ${rps} >= ${cfg.criticalRpsThreshold}`);
      if (cpuPercent >= cfg.criticalCpuThreshold) reasons.push(`CPU ${cpuPercent}% >= ${cfg.criticalCpuThreshold}%`);
      if (memoryPercent >= cfg.criticalMemoryThreshold) reasons.push(`Memory ${memoryPercent}% >= ${cfg.criticalMemoryThreshold}%`);
      if (p95LatencyMs >= cfg.criticalLatencyMsThreshold) reasons.push(`P95 latency ${p95LatencyMs}ms >= ${cfg.criticalLatencyMsThreshold}ms`);
      nextReason = `Critical threshold reached: ${reasons.join(', ')}.`;
    } else if (isHigh) {
      nextState = 'ORANGE';
      nextReason = `Elevated traffic or resource load (${rps} req/s, CPU ${cpuPercent}%, P95 ${p95LatencyMs}ms).`;
    }

    if (nextState !== this.trafficState) {
      this.trafficState = nextState;
      this.trafficStateChangedAt = new Date().toISOString();
    }
    this.trafficReason = nextReason;
  }

  public tickSample(): TimeSeriesPoint {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const rps = this.pruneRollingSecond(nowMs);
    const resources = this.sampleResources();
    const latency = this.computeLatencyStats();

    this.evaluateTrafficState(
      rps.incomingRps,
      resources.cpuPercent,
      resources.memoryPercent,
      latency.p95,
    );

    const adaptive = this.limiter.updateAdaptiveController({
      currentRps: rps.incomingRps,
      cpuPercent: resources.cpuPercent,
      memoryPercent: resources.memoryPercent,
      p95LatencyMs: latency.p95,
      nowMs,
    });

    const d = new Date(nowMs);
    const label = d.toTimeString().slice(0, 8);

    const point: TimeSeriesPoint = {
      timestamp: nowIso,
      label,
      incomingRps: rps.incomingRps,
      acceptedRps: rps.acceptedRps,
      rejectedRps: rps.rejectedRps,
      cpuPercent: resources.cpuPercent,
      memoryPercent: resources.memoryPercent,
      avgLatencyMs: latency.avg,
      p95LatencyMs: latency.p95,
      p99LatencyMs: latency.p99,
      adaptiveLimit: adaptive.currentLimit,
      demandScore: adaptive.demandScore,
      abuseScore: adaptive.abuseRiskScore,
      resourceScore: adaptive.resourcePressureScore,
    };

    this.timeSeries.push(point);
    if (this.timeSeries.length > MAX_TIME_SERIES) {
      this.timeSeries.shift();
    }

    return point;
  }

  public getSnapshot(): MonitoringSnapshot {
    const nowMs = Date.now();
    const rps = this.pruneRollingSecond(nowMs);
    const resources = this.sampleResources();
    const latency = this.computeLatencyStats();
    const cfg = this.limiter.getConfig();

    this.evaluateTrafficState(
      rps.incomingRps,
      resources.cpuPercent,
      resources.memoryPercent,
      latency.p95,
    );

    const thresholdRps = cfg.criticalRpsThreshold;
    const percentOfThreshold = Number(
      Math.min(200, (rps.incomingRps / Math.max(1, thresholdRps)) * 100).toFixed(1),
    );

    // Refresh current limits & abuse scores on user rows
    const users = Array.from(this.userMap.values())
      .map((u) => ({
        ...u,
        currentLimit: this.limiter.getEffectiveUserLimit(u.userId, u.category),
        abuseRiskScore: this.limiter.getUserAbuseScore(u.userId, nowMs),
      }))
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 30);

    return {
      apiPaused: this.apiPaused,
      activeAlgorithm: cfg.activeAlgorithm,
      uptimeSeconds: Number(((nowMs - this.startedAtMs) / 1000).toFixed(1)),
      startedAt: this.startedAtIso,
      totals: {
        incoming: this.totalIncoming,
        accepted: this.totalAccepted,
        rejected: this.totalRejected,
        successful: this.totalSuccessful,
        failed: this.totalFailed,
        serverErrors: this.totalServerErrors,
        currentRps: rps.incomingRps,
        activeUsers: this.activeUsersWindow.size,
        avgResponseTimeMs: latency.avg,
        p95ResponseTimeMs: latency.p95,
        p99ResponseTimeMs: latency.p99,
      },
      resources,
      trafficIndicator: {
        state: this.trafficState,
        currentRps: rps.incomingRps,
        thresholdRps,
        percentOfThreshold,
        changedAt: this.trafficStateChangedAt,
        reason: this.trafficReason,
      },
      statusCodes: { ...this.statusCodes },
      adaptive: this.limiter.getAdaptiveSnapshot(),
      slidingWindow: this.limiter.getSlidingWindowSnapshot(),
      users,
      recentLogs: [...this.recentLogs],
      timeSeries: [...this.timeSeries],
      lastResetEvent: this.lastResetEvent,
    };
  }

  public getRawLatencySample(): number[] {
    return [...this.latenciesMs];
  }
}

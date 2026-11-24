import type { RateLimiterEngine } from './algorithms.ts';
import type { MonitoringService } from './monitor.ts';
import type {
  ComparisonMetricsRow,
  ComparisonRunState,
  LoadTestConfig,
  LoadTestProgress,
  RateLimitAlgorithm,
  TrafficScenario,
  UserCategory,
} from './types.ts';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PlannedRequest {
  userId: string;
  category: UserCategory;
  isAbusive: boolean;
  delayMs: number;
}

export class LoadTestService {
  private abortController: AbortController | null = null;
  private progress: LoadTestProgress = {
    running: false,
    testId: null,
    scenario: null,
    algorithm: null,
    targetRequests: 0,
    sent: 0,
    completed: 0,
    accepted: 0,
    rejected: 0,
    errors: 0,
    currentRps: 0,
    successPercent: 0,
    rejectionPercent: 0,
    avgResponseTimeMs: 0,
    elapsedSeconds: 0,
    progressPercent: 0,
    startedAt: null,
    finishedAt: null,
    stopReason: null,
  };

  private comparisonState: ComparisonRunState = {
    running: false,
    currentAlgorithm: null,
    completedAlgorithms: [],
    results: [],
    startedAt: null,
    finishedAt: null,
    error: null,
  };

  constructor(
    private port: number,
    private limiter: RateLimiterEngine,
    private monitor: MonitoringService,
  ) {}

  public getProgress(): LoadTestProgress {
    return { ...this.progress };
  }

  public getComparisonState(): ComparisonRunState {
    return {
      ...this.comparisonState,
      completedAlgorithms: [...this.comparisonState.completedAlgorithms],
      results: [...this.comparisonState.results],
    };
  }

  public stopLoadTest(reason = 'Stopped by operator'): LoadTestProgress {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.progress.running) {
      this.progress.running = false;
      this.progress.finishedAt = new Date().toISOString();
      this.progress.stopReason = reason;
    }
    return this.getProgress();
  }

  public async startLoadTest(rawConfig: LoadTestConfig): Promise<LoadTestProgress> {
    if (this.progress.running || this.comparisonState.running) {
      throw new Error('A load test or comparison run is already active.');
    }

    // Enforce safe upper bounds (Security Requirement #15)
    const totalRequests = clamp(Math.round(rawConfig.totalRequests), 10, 1500);
    const virtualUsers = clamp(Math.round(rawConfig.virtualUsers), 1, 30);
    const targetRps = clamp(Math.round(rawConfig.targetRps), 1, 150);
    const durationSeconds = clamp(Math.round(rawConfig.durationSeconds), 3, 90);

    // Switch backend active algorithm to requested algorithm
    this.limiter.updateConfig({ activeAlgorithm: rawConfig.algorithm });

    const testId = `lt-${Date.now().toString(36)}`;
    const abort = new AbortController();
    this.abortController = abort;

    this.progress = {
      running: true,
      testId,
      scenario: rawConfig.scenario,
      algorithm: rawConfig.algorithm,
      targetRequests: totalRequests,
      sent: 0,
      completed: 0,
      accepted: 0,
      rejected: 0,
      errors: 0,
      currentRps: 0,
      successPercent: 0,
      rejectionPercent: 0,
      avgResponseTimeMs: 0,
      elapsedSeconds: 0,
      progressPercent: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      stopReason: null,
    };

    const plan = this.buildScenarioPlan(
      rawConfig.scenario,
      totalRequests,
      targetRps,
      rawConfig.userCategory,
    );

    void this.executePlan(
      plan,
      virtualUsers,
      durationSeconds,
      rawConfig.endpoint,
      rawConfig.method,
      rawConfig.algorithm,
      abort.signal,
    );

    return this.getProgress();
  }

  public async startComparison(params: {
    algorithms: RateLimitAlgorithm[];
    totalRequests: number;
    virtualUsers: number;
    targetRps: number;
    scenario: TrafficScenario;
    endpoint: string;
  }): Promise<ComparisonRunState> {
    if (this.progress.running || this.comparisonState.running) {
      throw new Error('A load test or comparison run is already active.');
    }

    const validAlgorithms = params.algorithms.length > 0
      ? params.algorithms
      : (['fixed_window', 'token_bucket', 'sliding_window', 'adaptive'] as RateLimitAlgorithm[]);

    const totalRequests = clamp(Math.round(params.totalRequests), 20, 400);
    const virtualUsers = clamp(Math.round(params.virtualUsers), 1, 20);
    const targetRps = clamp(Math.round(params.targetRps), 5, 120);

    const abort = new AbortController();
    this.abortController = abort;

    this.comparisonState = {
      running: true,
      currentAlgorithm: validAlgorithms[0],
      completedAlgorithms: [],
      results: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };

    void this.runComparisonSequence(
      validAlgorithms,
      totalRequests,
      virtualUsers,
      targetRps,
      params.scenario,
      params.endpoint,
      abort.signal,
    );

    return this.getComparisonState();
  }

  private async runComparisonSequence(
    algorithms: RateLimitAlgorithm[],
    totalRequests: number,
    virtualUsers: number,
    targetRps: number,
    scenario: TrafficScenario,
    endpoint: string,
    signal: AbortSignal,
  ): Promise<void> {
    const previousAlgo = this.limiter.getConfig().activeAlgorithm;
    try {
      for (const algo of algorithms) {
        if (signal.aborted) break;
        this.comparisonState.currentAlgorithm = algo;

        // Isolate each experiment cleanly
        this.limiter.resetEnforcementState();
        this.monitor.resetExperimentMetrics();
        this.limiter.updateConfig({ activeAlgorithm: algo });

        const plan = this.buildScenarioPlan(scenario, totalRequests, targetRps, 'standard');
        const row = await this.executeComparisonSingle(
          algo,
          plan,
          virtualUsers,
          endpoint,
          signal,
        );

        if (signal.aborted) break;
        this.comparisonState.results.push(row);
        this.comparisonState.completedAlgorithms.push(algo);

        // Brief cooldown between algorithms so windows/resources settle
        await sleep(350);
      }

      this.comparisonState.running = false;
      this.comparisonState.currentAlgorithm = null;
      this.comparisonState.finishedAt = new Date().toISOString();
    } catch (err) {
      this.comparisonState.running = false;
      this.comparisonState.currentAlgorithm = null;
      this.comparisonState.finishedAt = new Date().toISOString();
      this.comparisonState.error = err instanceof Error ? err.message : 'Comparison failed.';
    } finally {
      this.limiter.updateConfig({ activeAlgorithm: previousAlgo });
      if (this.abortController?.signal === signal) {
        this.abortController = null;
      }
    }
  }

  private async executeComparisonSingle(
    algorithm: RateLimitAlgorithm,
    plan: PlannedRequest[],
    virtualUsers: number,
    endpoint: string,
    signal: AbortSignal,
  ): Promise<ComparisonMetricsRow> {
    const startMs = Date.now();
    const latencies: number[] = [];
    const cpuSamples: number[] = [];
    const memSamples: number[] = [];

    let accepted = 0;
    let rejected = 0;
    let legitTotal = 0;
    let legitBlocked = 0;
    let abuseTotal = 0;
    let abuseBlocked = 0;
    let firstSpikeRejectMs: number | null = null;
    let lastRejectMs: number | null = null;

    let cursor = 0;
    const sampler = setInterval(() => {
      const snap = this.monitor.getSnapshot();
      cpuSamples.push(snap.resources.cpuPercent);
      memSamples.push(snap.resources.memoryPercent);
    }, 250);

    const runWorker = async () => {
      while (!signal.aborted) {
        const idx = cursor++;
        if (idx >= plan.length) break;
        const item = plan[idx];

        if (item.delayMs > 0) {
          await sleep(item.delayMs);
        }
        if (signal.aborted) break;

        if (item.isAbusive) abuseTotal += 1;
        else legitTotal += 1;

        const reqStart = performance.now();
        try {
          const res = await fetch(`http://127.0.0.1:${this.port}${endpoint}`, {
            method: 'GET',
            headers: {
              'X-API-Key': item.userId,
              'X-User-Category': item.category,
              'X-RateLimit-Algorithm': algorithm,
            },
            signal,
          });
          const elapsed = performance.now() - reqStart;
          latencies.push(elapsed);

          if (res.status === 429) {
            rejected += 1;
            const now = Date.now();
            if (firstSpikeRejectMs === null) firstSpikeRejectMs = now;
            lastRejectMs = now;
            if (item.isAbusive) abuseBlocked += 1;
            else legitBlocked += 1;
          } else if (res.ok) {
            accepted += 1;
          }
        } catch {
          // Aborted or transient error
        }
      }
    };

    const workers = Array.from({ length: virtualUsers }, () => runWorker());
    await Promise.all(workers);
    clearInterval(sampler);

    const endMs = Date.now();
    const durationSec = Math.max(0.1, (endMs - startMs) / 1000);
    const total = legitTotal + abuseTotal;
    const sortedLat = [...latencies].sort((a, b) => a - b);
    const avgLat =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;

    const snap = this.monitor.getSnapshot();
    const cpuAvg =
      cpuSamples.length > 0
        ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length
        : snap.resources.cpuPercent;
    const cpuPeak =
      cpuSamples.length > 0 ? Math.max(...cpuSamples) : snap.resources.cpuPercent;
    const memAvg =
      memSamples.length > 0
        ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length
        : snap.resources.memoryPercent;
    const memPeak =
      memSamples.length > 0 ? Math.max(...memSamples) : snap.resources.memoryPercent;

    const recoveryTimeMs =
      firstSpikeRejectMs !== null && lastRejectMs !== null
        ? Math.max(0, endMs - lastRejectMs)
        : 0;

    return {
      algorithm,
      totalRequests: total,
      acceptedRequests: accepted,
      rejectedRequests: rejected,
      legitimateTotal: legitTotal,
      legitimateBlocked: legitBlocked,
      legitimateBlockingRate:
        legitTotal > 0 ? Number(((legitBlocked / legitTotal) * 100).toFixed(2)) : 0,
      abuseTotal: abuseTotal,
      abuseBlocked: abuseBlocked,
      abuseBlockingRate:
        abuseTotal > 0 ? Number(((abuseBlocked / abuseTotal) * 100).toFixed(2)) : 0,
      rejectionPercent:
        total > 0 ? Number(((rejected / total) * 100).toFixed(2)) : 0,
      avgLatencyMs: Number(avgLat.toFixed(2)),
      p95LatencyMs: Number(percentile(sortedLat, 95).toFixed(2)),
      p99LatencyMs: Number(percentile(sortedLat, 99).toFixed(2)),
      throughputRps: Number((accepted / durationSec).toFixed(2)),
      cpuAvgPercent: Number(cpuAvg.toFixed(1)),
      cpuPeakPercent: Number(cpuPeak.toFixed(1)),
      memoryAvgPercent: Number(memAvg.toFixed(1)),
      memoryPeakPercent: Number(memPeak.toFixed(1)),
      recoveryTimeMs: Math.round(recoveryTimeMs),
      durationSeconds: Number(durationSec.toFixed(2)),
    };
  }

  private buildScenarioPlan(
    scenario: TrafficScenario,
    totalRequests: number,
    targetRps: number,
    defaultCategory: UserCategory,
  ): PlannedRequest[] {
    const plan: PlannedRequest[] = [];
    const baseDelayMs = Math.max(5, Math.round(1000 / Math.max(1, targetRps)));

    for (let i = 0; i < totalRequests; i += 1) {
      const progress = i / Math.max(1, totalRequests);

      if (scenario === 'normal') {
        const categories: UserCategory[] = [defaultCategory, 'standard', 'premium', 'basic'];
        const userIdx = (i % 6) + 1;
        plan.push({
          userId: `legit-user-0${userIdx}`,
          category: categories[i % categories.length],
          isAbusive: false,
          delayMs: baseDelayMs,
        });
      } else if (scenario === 'spike') {
        const inSpike = progress >= 0.25 && progress <= 0.7;
        plan.push({
          userId: inSpike ? `spike-client-${(i % 4) + 1}` : `steady-client-${(i % 3) + 1}`,
          category: inSpike ? 'basic' : defaultCategory,
          isAbusive: inSpike && i % 3 === 0,
          delayMs: inSpike ? Math.max(2, Math.round(baseDelayMs * 0.2)) : baseDelayMs,
        });
      } else if (scenario === 'burst') {
        const inBurstSlot = i % 20 < 15;
        plan.push({
          userId: `burst-user-${(i % 3) + 1}`,
          category: defaultCategory,
          isAbusive: false,
          delayMs: inBurstSlot ? 2 : baseDelayMs * 2,
        });
      } else if (scenario === 'single_abuse') {
        // 75% aggressive single abuser, 25% legitimate users
        const isAbuse = i % 4 !== 0;
        plan.push({
          userId: isAbuse ? 'attacker-single-01' : `legit-user-0${(i % 3) + 1}`,
          category: isAbuse ? 'basic' : 'premium',
          isAbusive: isAbuse,
          delayMs: isAbuse ? 3 : baseDelayMs,
        });
      } else if (scenario === 'distributed_abuse') {
        // 70% distributed bots across 12 distinct identities, 30% legitimate users
        const isAbuse = i % 10 < 7;
        const botId = `bot-node-${String((i % 12) + 1).padStart(2, '0')}`;
        const legitId = `legit-user-0${(i % 4) + 1}`;
        plan.push({
          userId: isAbuse ? botId : legitId,
          category: isAbuse ? 'basic' : 'standard',
          isAbusive: isAbuse,
          delayMs: isAbuse ? 4 : baseDelayMs,
        });
      } else if (scenario === 'high_load') {
        plan.push({
          userId: `heavy-tenant-${(i % 8) + 1}`,
          category: i % 3 === 0 ? 'premium' : 'standard',
          isAbusive: false,
          delayMs: Math.max(2, Math.round(baseDelayMs * 0.35)),
        });
      } else {
        // recovery scenario: heavy load first 50%, calm normal second 50%
        const heavy = progress < 0.5;
        plan.push({
          userId: heavy ? `surge-user-${(i % 5) + 1}` : `calm-user-${(i % 3) + 1}`,
          category: heavy ? 'basic' : 'standard',
          isAbusive: heavy && i % 2 === 0,
          delayMs: heavy ? 3 : Math.max(25, baseDelayMs * 2),
        });
      }
    }

    return plan;
  }

  private async executePlan(
    plan: PlannedRequest[],
    virtualUsers: number,
    durationSeconds: number,
    endpoint: string,
    method: 'GET' | 'POST',
    algorithm: RateLimitAlgorithm,
    signal: AbortSignal,
  ): Promise<void> {
    const startMs = Date.now();
    const deadlineMs = startMs + durationSeconds * 1000;
    let cursor = 0;
    let totalLatency = 0;

    const runWorker = async () => {
      while (!signal.aborted && Date.now() < deadlineMs) {
        const idx = cursor++;
        if (idx >= plan.length) break;
        const item = plan[idx];

        if (item.delayMs > 0) {
          await sleep(item.delayMs);
        }
        if (signal.aborted || Date.now() >= deadlineMs) break;

        this.progress.sent += 1;
        const reqStart = performance.now();
        try {
          const init: RequestInit = {
            method,
            headers: {
              'X-API-Key': item.userId,
              'X-User-Category': item.category,
              'X-RateLimit-Algorithm': algorithm,
              ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            },
            signal,
          };
          if (method === 'POST') {
            init.body = JSON.stringify({
              product_id: (idx % 4) + 1,
              quantity: 1 + (idx % 3),
              client_ref: item.userId,
            });
          }

          const res = await fetch(`http://127.0.0.1:${this.port}${endpoint}`, init);
          const latencyMs = performance.now() - reqStart;
          totalLatency += latencyMs;

          this.progress.completed += 1;
          if (res.status === 429) {
            this.progress.rejected += 1;
          } else if (res.ok) {
            this.progress.accepted += 1;
          } else {
            this.progress.errors += 1;
          }
        } catch {
          if (!signal.aborted) {
            this.progress.completed += 1;
            this.progress.errors += 1;
          }
        }

        const elapsed = Math.max(0.1, (Date.now() - startMs) / 1000);
        this.progress.elapsedSeconds = Number(elapsed.toFixed(1));
        this.progress.currentRps = Number((this.progress.completed / elapsed).toFixed(1));
        this.progress.avgResponseTimeMs =
          this.progress.completed > 0
            ? Number((totalLatency / this.progress.completed).toFixed(2))
            : 0;
        this.progress.successPercent =
          this.progress.completed > 0
            ? Number(((this.progress.accepted / this.progress.completed) * 100).toFixed(1))
            : 0;
        this.progress.rejectionPercent =
          this.progress.completed > 0
            ? Number(((this.progress.rejected / this.progress.completed) * 100).toFixed(1))
            : 0;
        this.progress.progressPercent = Number(
          Math.min(100, (this.progress.completed / Math.max(1, plan.length)) * 100).toFixed(1),
        );
      }
    };

    const workers = Array.from({ length: virtualUsers }, () => runWorker());
    await Promise.all(workers);

    if (this.progress.running) {
      this.progress.running = false;
      this.progress.finishedAt = new Date().toISOString();
      this.progress.progressPercent = signal.aborted
        ? this.progress.progressPercent
        : 100;
      this.progress.stopReason = signal.aborted
        ? 'Stopped by operator'
        : Date.now() >= deadlineMs
          ? 'Configured test duration reached'
          : 'Configured request count completed';
    }

    if (this.abortController?.signal === signal) {
      this.abortController = null;
    }
  }
}

export type RateLimitAlgorithm =
  | 'fixed_window'
  | 'token_bucket'
  | 'sliding_window'
  | 'adaptive';

export type UserCategory = 'basic' | 'standard' | 'premium';

export type TrafficState = 'GREEN' | 'ORANGE' | 'RED';

export type TrafficScenario =
  | 'normal'
  | 'spike'
  | 'burst'
  | 'single_abuse'
  | 'distributed_abuse'
  | 'high_load'
  | 'recovery';

export interface RateLimitConfig {
  activeAlgorithm: RateLimitAlgorithm;
  fixedWindowLimit: number;
  fixedWindowSeconds: number;
  tokenBucketCapacity: number;
  tokenBucketRefillRate: number;
  slidingWindowLimit: number;
  slidingWindowSeconds: number;
  adaptiveBaseLimit: number;
  adaptiveMinLimit: number;
  adaptiveMaxLimit: number;
  adaptiveAlpha: number;
  adaptiveBeta: number;
  adaptiveGamma: number;
  globalSafetyCapRps: number;
  normalRpsThreshold: number;
  criticalRpsThreshold: number;
  criticalCpuThreshold: number;
  criticalMemoryThreshold: number;
  criticalLatencyMsThreshold: number;
}

export interface AdaptiveSnapshot {
  demandScore: number;
  abuseRiskScore: number;
  resourcePressureScore: number;
  baseLimit: number;
  currentLimit: number;
  minLimit: number;
  maxLimit: number;
  rawComputedLimit: number;
  alpha: number;
  beta: number;
  gamma: number;
  reason: string;
  updatedAt: string;
}

export interface SlidingWindowSnapshot {
  userId: string;
  limit: number;
  windowSeconds: number;
  inWindowCount: number;
  remaining: number;
  expiredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  timestamps: number[];
  nowMs: number;
}

export interface UserStats {
  userId: string;
  category: UserCategory;
  priorityWeight: number;
  totalRequests: number;
  acceptedRequests: number;
  rejectedRequests: number;
  currentLimit: number;
  abuseRiskScore: number;
  lastSeenAt: string;
}

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  clientId: string;
  category: UserCategory;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  algorithm: RateLimitAlgorithm;
  decision: 'Accepted' | 'Rejected' | 'Paused' | 'Error';
}

export interface TimeSeriesPoint {
  timestamp: string;
  label: string;
  incomingRps: number;
  acceptedRps: number;
  rejectedRps: number;
  cpuPercent: number;
  memoryPercent: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  adaptiveLimit: number;
  demandScore: number;
  abuseScore: number;
  resourceScore: number;
}

export interface MonitoringSnapshot {
  apiPaused: boolean;
  activeAlgorithm: RateLimitAlgorithm;
  uptimeSeconds: number;
  startedAt: string;
  totals: {
    incoming: number;
    accepted: number;
    rejected: number;
    successful: number;
    failed: number;
    serverErrors: number;
    currentRps: number;
    activeUsers: number;
    avgResponseTimeMs: number;
    p95ResponseTimeMs: number;
    p99ResponseTimeMs: number;
  };
  resources: {
    cpuPercent: number;
    memoryPercent: number;
    availableMemoryMb: number;
    totalMemoryMb: number;
    processRssMb: number;
  };
  trafficIndicator: {
    state: TrafficState;
    currentRps: number;
    thresholdRps: number;
    percentOfThreshold: number;
    changedAt: string;
    reason: string;
  };
  statusCodes: Record<string, number>;
  adaptive: AdaptiveSnapshot;
  slidingWindow: SlidingWindowSnapshot;
  users: UserStats[];
  recentLogs: RequestLogEntry[];
  timeSeries: TimeSeriesPoint[];
  lastResetEvent: string | null;
}

export interface LoadTestConfig {
  totalRequests: number;
  virtualUsers: number;
  targetRps: number;
  durationSeconds: number;
  algorithm: RateLimitAlgorithm;
  userCategory: UserCategory;
  scenario: TrafficScenario;
  endpoint: string;
  method: 'GET' | 'POST';
}

export interface LoadTestProgress {
  running: boolean;
  testId: string | null;
  scenario: TrafficScenario | null;
  algorithm: RateLimitAlgorithm | null;
  targetRequests: number;
  sent: number;
  completed: number;
  accepted: number;
  rejected: number;
  errors: number;
  currentRps: number;
  successPercent: number;
  rejectionPercent: number;
  avgResponseTimeMs: number;
  elapsedSeconds: number;
  progressPercent: number;
  startedAt: string | null;
  finishedAt: string | null;
  stopReason: string | null;
}

export interface ComparisonMetricsRow {
  algorithm: RateLimitAlgorithm;
  totalRequests: number;
  acceptedRequests: number;
  rejectedRequests: number;
  legitimateTotal: number;
  legitimateBlocked: number;
  legitimateBlockingRate: number;
  abuseTotal: number;
  abuseBlocked: number;
  abuseBlockingRate: number;
  rejectionPercent: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputRps: number;
  cpuAvgPercent: number;
  cpuPeakPercent: number;
  memoryAvgPercent: number;
  memoryPeakPercent: number;
  recoveryTimeMs: number;
  durationSeconds: number;
}

export interface ComparisonRunState {
  running: boolean;
  currentAlgorithm: RateLimitAlgorithm | null;
  completedAlgorithms: RateLimitAlgorithm[];
  results: ComparisonMetricsRow[];
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

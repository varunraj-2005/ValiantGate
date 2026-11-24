import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  OctagonAlert,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  Trash2,
} from 'lucide-react';
import type {
  LoadTestProgress,
  MonitoringSnapshot,
  RateLimitAlgorithm,
  RateLimitConfig,
  SlidingWindowSnapshot,
} from '../../backend/types.ts';
import {
  SlidingWindowChart,
  StatusCodeBarChart,
  TimeSeriesChart,
} from './Charts.tsx';

interface ServerDashboardProps {
  snapshot: MonitoringSnapshot;
  config: RateLimitConfig;
  loadTest: LoadTestProgress;
  slidingWindowOverride: SlidingWindowSnapshot | null;
  selectedSlidingUser: string;
  onSelectSlidingUser: (userId: string) => void;
  onSelectAlgorithm: (algo: RateLimitAlgorithm) => Promise<void>;
  onUpdateConfig: (patch: Partial<RateLimitConfig>) => Promise<void>;
  onPauseApi: () => Promise<void>;
  onResumeApi: () => Promise<void>;
  onStopLoadTest: () => Promise<void>;
  onClearDashboard: () => Promise<void>;
  onResetExperiment: () => Promise<void>;
  onResetSecurityState: () => Promise<void>;
}

const ALGO_LABELS: Record<RateLimitAlgorithm, string> = {
  fixed_window: 'Fixed Window',
  token_bucket: 'Token Bucket',
  sliding_window: 'Sliding Window',
  adaptive: 'Adaptive Controller',
};

function formatUptime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export const ServerDashboard: React.FC<ServerDashboardProps> = ({
  snapshot,
  config,
  loadTest,
  slidingWindowOverride,
  selectedSlidingUser,
  onSelectSlidingUser,
  onSelectAlgorithm,
  onUpdateConfig,
  onPauseApi,
  onResumeApi,
  onStopLoadTest,
  onClearDashboard,
  onResetExperiment,
  onResetSecurityState,
}) => {
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [alphaInput, setAlphaInput] = useState(config.adaptiveAlpha);
  const [betaInput, setBetaInput] = useState(config.adaptiveBeta);
  const [gammaInput, setGammaInput] = useState(config.adaptiveGamma);
  const [baseLimitInput, setBaseLimitInput] = useState(config.adaptiveBaseLimit);
  const [savingConfig, setSavingConfig] = useState(false);

  const slidingData = slidingWindowOverride ?? snapshot.slidingWindow;
  const traffic = snapshot.trafficIndicator;

  const trafficBannerStyle =
    traffic.state === 'RED'
      ? {
          wrap: 'bg-red-50 border-red-300 text-red-900',
          label: 'RED — CRITICAL',
          Icon: OctagonAlert,
          iconColor: 'text-red-600',
        }
      : traffic.state === 'ORANGE'
        ? {
            wrap: 'bg-amber-50 border-amber-300 text-amber-900',
            label: 'ORANGE — HIGH',
            Icon: AlertTriangle,
            iconColor: 'text-amber-600',
          }
        : {
            wrap: 'bg-emerald-50 border-emerald-300 text-emerald-900',
            label: 'GREEN — NORMAL',
            Icon: CheckCircle2,
            iconColor: 'text-emerald-600',
          };

  const TrafficIcon = trafficBannerStyle.Icon;

  const handleSaveAdaptiveParams = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await onUpdateConfig({
        adaptiveAlpha: Number(alphaInput),
        adaptiveBeta: Number(betaInput),
        adaptiveGamma: Number(gammaInput),
        adaptiveBaseLimit: Number(baseLimitInput),
      });
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* API Paused Alert Banner */}
      {snapshot.apiPaused && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-red-50 border border-red-300 rounded-lg text-red-900">
          <div className="flex items-center gap-2.5 text-sm font-medium">
            <OctagonAlert className="w-4 h-4 text-red-600 shrink-0" />
            <span>
              API request processing is currently paused. Protected endpoints are returning HTTP 503 while monitoring remains active.
            </span>
          </div>
          <button
            onClick={onResumeApi}
            className="px-3 py-1.5 text-xs font-medium bg-red-700 text-white rounded-md hover:bg-red-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Resume API
          </button>
        </div>
      )}

      {/* Control Bar & Algorithm Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white border border-slate-200 rounded-lg">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Active Algorithm</span>
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(Object.keys(ALGO_LABELS) as RateLimitAlgorithm[]).map((algo) => {
              const active = snapshot.activeAlgorithm === algo;
              return (
                <button
                  key={algo}
                  onClick={() => onSelectAlgorithm(algo)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {ALGO_LABELS[algo]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onStopLoadTest}
            disabled={!loadTest.running}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              loadTest.running
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700 cursor-pointer'
                : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span>Stop Load Test</span>
          </button>

          {snapshot.apiPaused ? (
            <button
              onClick={onResumeApi}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Resume API</span>
            </button>
          ) : (
            <button
              onClick={onPauseApi}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause API</span>
            </button>
          )}

          <button
            onClick={() => setConfirmClearOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Dashboard Data</span>
          </button>

          <button
            onClick={onResetExperiment}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Experiment</span>
          </button>

          <button
            onClick={onResetSecurityState}
            title="Clears active rate-limit counters and sliding windows"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Reset Limits</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Clear Dashboard Data */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-6 shadow-lg space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Clear Dashboard Monitoring Data?
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              This resets displayed aggregate counters, charts, and request history logs and records a monitoring reset event. Active rate-limit counters, security buckets, and algorithm configuration remain intact.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmClearOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await onClearDashboard();
                  setConfirmClearOpen(false);
                }}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
              >
                Confirm Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* B. Live Traffic Intensity Indicator */}
      <div className={`p-4 border rounded-lg ${trafficBannerStyle.wrap}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <TrafficIcon className={`w-5 h-5 mt-0.5 shrink-0 ${trafficBannerStyle.iconColor}`} />
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span>Traffic Intensity: {trafficBannerStyle.label}</span>
                <span className="font-normal opacity-75">·</span>
                <span className="font-normal text-xs opacity-90">
                  State changed {new Date(traffic.changedAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs mt-1 opacity-90">{traffic.reason}</p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs font-mono tabular-nums">
            <div>
              <div className="opacity-75">Current RPS</div>
              <div className="text-base font-semibold">{traffic.currentRps} req/s</div>
            </div>
            <div>
              <div className="opacity-75">Critical Threshold</div>
              <div className="text-base font-semibold">{traffic.thresholdRps} req/s</div>
            </div>
            <div>
              <div className="opacity-75">Threshold Used</div>
              <div className="text-base font-semibold">{traffic.percentOfThreshold}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* A. 10 Main Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Incoming Requests', value: snapshot.totals.incoming.toLocaleString() },
          { label: 'Accepted Requests', value: snapshot.totals.accepted.toLocaleString(), tone: 'text-emerald-700' },
          { label: 'Rejected Requests (429)', value: snapshot.totals.rejected.toLocaleString(), tone: 'text-red-700' },
          { label: 'Requests Per Second', value: `${snapshot.totals.currentRps} req/s` },
          { label: 'Active API Users (60s)', value: snapshot.totals.activeUsers.toLocaleString() },
          { label: 'Avg Response Time', value: `${snapshot.totals.avgResponseTimeMs} ms` },
          { label: 'CPU Utilisation', value: `${snapshot.resources.cpuPercent}%` },
          { label: 'Memory Utilisation', value: `${snapshot.resources.memoryPercent}%` },
          { label: 'Current Adaptive Limit', value: `${snapshot.adaptive.currentLimit} req` },
          { label: 'Total Server Errors (5xx)', value: snapshot.totals.serverErrors.toLocaleString(), tone: snapshot.totals.serverErrors > 0 ? 'text-red-700' : undefined },
        ].map((metric) => (
          <div
            key={metric.label}
            className="p-4 bg-white border border-slate-200 rounded-lg space-y-1.5"
          >
            <div className="text-xs text-slate-500 truncate">{metric.label}</div>
            <div className={`text-xl font-semibold font-mono tabular-nums ${metric.tone ?? 'text-slate-900'}`}>
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      {snapshot.lastResetEvent && (
        <div className="text-xs text-slate-500 font-mono">{snapshot.lastResetEvent}</div>
      )}

      {/* C. Incoming Request Monitor & D. HTTP Status Code Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 p-5 bg-white border border-slate-200 rounded-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Incoming Request Monitor</h2>
              <p className="text-xs text-slate-500">
                Accepted: {snapshot.totals.accepted} · Rejected: {snapshot.totals.rejected} · 2xx Success: {snapshot.totals.successful} · Other Failures: {snapshot.totals.failed}
              </p>
            </div>
          </div>
          <TimeSeriesChart
            data={snapshot.timeSeries}
            unit=" rps"
            series={[
              { key: 'incomingRps', label: 'Incoming', color: '#0f172a' },
              { key: 'acceptedRps', label: 'Accepted', color: '#16a34a' },
              { key: 'rejectedRps', label: 'Rejected (429)', color: '#dc2626' },
            ]}
          />
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">HTTP Status Code Monitor</h2>
            <p className="text-xs text-slate-500">Live distribution across all responses</p>
          </div>
          <StatusCodeBarChart statusCodes={snapshot.statusCodes} />
        </div>
      </div>

      {/* G. Server Resource Monitoring & H. Adaptive Controller Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Server Resource & Latency Monitoring</h2>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                Avail Mem: {snapshot.resources.availableMemoryMb} MB · P95: {snapshot.totals.p95ResponseTimeMs} ms · P99: {snapshot.totals.p99ResponseTimeMs} ms · Uptime: {formatUptime(snapshot.uptimeSeconds)}
              </p>
            </div>
          </div>

          <TimeSeriesChart
            data={snapshot.timeSeries}
            unit="%"
            height={175}
            yMaxOverride={100}
            series={[
              { key: 'cpuPercent', label: 'CPU %', color: '#2563eb' },
              { key: 'memoryPercent', label: 'Memory %', color: '#7c3aed' },
            ]}
          />

          <TimeSeriesChart
            data={snapshot.timeSeries}
            unit="ms"
            height={160}
            series={[
              { key: 'avgLatencyMs', label: 'Avg Latency', color: '#0f766e' },
              { key: 'p95LatencyMs', label: 'P95 Latency', color: '#d97706' },
              { key: 'p99LatencyMs', label: 'P99 Latency', color: '#dc2626' },
            ]}
          />
        </div>

        {/* H. Adaptive Controller Monitor */}
        <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Adaptive Controller Monitor</h2>
            <p className="text-xs text-slate-500">
              Limit = Base × (1 + α·Demand − β·Abuse − γ·Resource) bounded to [{snapshot.adaptive.minLimit}, {snapshot.adaptive.maxLimit}]
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-xs text-slate-500">Demand Score</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
                {snapshot.adaptive.demandScore.toFixed(3)}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-xs text-slate-500">Abuse Risk Score</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-amber-700">
                {snapshot.adaptive.abuseRiskScore.toFixed(3)}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-xs text-slate-500">Resource Pressure</div>
              <div className="text-lg font-semibold font-mono tabular-nums text-blue-700">
                {snapshot.adaptive.resourcePressureScore.toFixed(3)}
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 space-y-1">
            <div className="font-medium text-slate-900">Controller Decision Rationale</div>
            <p>{snapshot.adaptive.reason}</p>
            <div className="font-mono tabular-nums text-slate-500 pt-1">
              Base: {snapshot.adaptive.baseLimit} · Current Adaptive: {snapshot.adaptive.currentLimit} · Bounds: [{snapshot.adaptive.minLimit}, {snapshot.adaptive.maxLimit}]
            </div>
          </div>

          <TimeSeriesChart
            data={snapshot.timeSeries}
            unit=" req"
            height={145}
            series={[
              { key: 'adaptiveLimit', label: 'Adaptive Limit', color: '#2563eb' },
            ]}
          />

          <form onSubmit={handleSaveAdaptiveParams} className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 items-end">
            <label className="block text-xs text-slate-600">
              Base Limit
              <input
                type="number"
                min={5}
                max={500}
                value={baseLimitInput}
                onChange={(e) => setBaseLimitInput(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              α (Demand)
              <input
                type="number"
                step="0.05"
                min={0}
                max={3}
                value={alphaInput}
                onChange={(e) => setAlphaInput(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              β (Abuse)
              <input
                type="number"
                step="0.05"
                min={0}
                max={3}
                value={betaInput}
                onChange={(e) => setBetaInput(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              γ (Resource)
              <input
                type="number"
                step="0.05"
                min={0}
                max={3}
                value={gammaInput}
                onChange={(e) => setGammaInput(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <button
              type="submit"
              disabled={savingConfig}
              className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              {savingConfig ? 'Saving...' : 'Apply Weights'}
            </button>
          </form>
        </div>
      </div>

      {/* E. Sliding Window Visualisation */}
      <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Sliding Window Visualisation</h2>
            <p className="text-xs text-slate-500">
              Tracks exact request timestamps inside the moving {slidingData.windowSeconds}s window and prunes expired requests automatically.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="sliding-user-select" className="text-slate-500">
              Inspect User
            </label>
            <select
              id="sliding-user-select"
              value={selectedSlidingUser}
              onChange={(e) => onSelectSlidingUser(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white font-mono text-xs text-slate-800"
            >
              <option value="">Latest active ({snapshot.slidingWindow.userId})</option>
              {snapshot.users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.userId} ({u.category})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
            <div className="text-slate-500">Target User</div>
            <div className="font-mono font-semibold text-slate-900 truncate">{slidingData.userId}</div>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
            <div className="text-slate-500">Window Limit</div>
            <div className="font-mono tabular-nums font-semibold text-slate-900">{slidingData.limit} req</div>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
            <div className="text-slate-500">Window Duration</div>
            <div className="font-mono tabular-nums font-semibold text-slate-900">{slidingData.windowSeconds}s</div>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
            <div className="text-slate-500">Inside Window</div>
            <div className="font-mono tabular-nums font-semibold text-blue-700">{slidingData.inWindowCount}</div>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
            <div className="text-slate-500">Remaining</div>
            <div className="font-mono tabular-nums font-semibold text-emerald-700">{slidingData.remaining}</div>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
            <div className="text-slate-500">Expired Count</div>
            <div className="font-mono tabular-nums font-semibold text-slate-700">{slidingData.expiredCount}</div>
          </div>
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
            <div className="text-slate-500">Accept / Reject</div>
            <div className="font-mono tabular-nums font-semibold text-slate-900">
              {slidingData.acceptedCount} / {slidingData.rejectedCount}
            </div>
          </div>
        </div>

        <SlidingWindowChart snapshot={slidingData} />
      </div>

      {/* F. User Request Weightage & Recent API Request Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">User Request Weightage & Fair Allocation</h2>
            <p className="text-xs text-slate-500">
              Premium (3) · Standard (2) · Basic (1) — Priority scales quotas under global safety limits
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">User ID</th>
                  <th className="py-2 px-2 font-medium">Category</th>
                  <th className="py-2 px-2 font-medium text-right">Weight</th>
                  <th className="py-2 px-2 font-medium text-right">Total</th>
                  <th className="py-2 px-2 font-medium text-right">Accept</th>
                  <th className="py-2 px-2 font-medium text-right">Reject</th>
                  <th className="py-2 px-2 font-medium text-right">Limit</th>
                  <th className="py-2 pl-2 font-medium text-right">Abuse Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {snapshot.users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center font-sans text-slate-400">
                      No user traffic recorded yet. Send an API request or start a load test.
                    </td>
                  </tr>
                ) : (
                  snapshot.users.map((u) => (
                    <tr key={u.userId} className="hover:bg-slate-50">
                      <td className="py-2 pr-3 text-slate-900">{u.userId}</td>
                      <td className="py-2 px-2 font-sans capitalize text-slate-700">{u.category}</td>
                      <td className="py-2 px-2 text-right">{u.priorityWeight}</td>
                      <td className="py-2 px-2 text-right">{u.totalRequests}</td>
                      <td className="py-2 px-2 text-right text-emerald-700">{u.acceptedRequests}</td>
                      <td className="py-2 px-2 text-right text-red-700">{u.rejectedRequests}</td>
                      <td className="py-2 px-2 text-right">{u.currentLimit}</td>
                      <td
                        className={`py-2 pl-2 text-right ${
                          u.abuseRiskScore >= 0.5
                            ? 'text-red-700 font-semibold'
                            : u.abuseRiskScore >= 0.25
                              ? 'text-amber-700'
                              : 'text-slate-600'
                        }`}
                      >
                        {u.abuseRiskScore.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent API Request Log */}
        <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent API Request Log</h2>
            <p className="text-xs text-slate-500">
              Bounded to latest 200 requests · Sensitive keys are masked automatically
            </p>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-2 font-medium">Time</th>
                  <th className="py-2 px-2 font-medium">Client</th>
                  <th className="py-2 px-2 font-medium">Request</th>
                  <th className="py-2 px-2 font-medium text-right">Status</th>
                  <th className="py-2 px-2 font-medium text-right">Latency</th>
                  <th className="py-2 pl-2 font-medium">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {snapshot.recentLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center font-sans text-slate-400">
                      No API requests logged yet.
                    </td>
                  </tr>
                ) : (
                  snapshot.recentLogs.slice(0, 40).map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-1.5 pr-2 text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-1.5 px-2 text-slate-800 truncate max-w-[110px]">
                        {log.clientId}
                      </td>
                      <td className="py-1.5 px-2 text-slate-700 whitespace-nowrap">
                        {log.method} {log.endpoint}
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right font-semibold ${
                          log.statusCode === 429 || log.statusCode >= 500
                            ? 'text-red-700'
                            : log.statusCode >= 400
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                        }`}
                      >
                        {log.statusCode}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-600">
                        {log.responseTimeMs.toFixed(1)} ms
                      </td>
                      <td className="py-1.5 pl-2 font-sans">
                        <span
                          className={
                            log.decision === 'Accepted'
                              ? 'text-emerald-700'
                              : log.decision === 'Rejected'
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }
                        >
                          {log.decision}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Play, Square } from 'lucide-react';
import type {
  ComparisonRunState,
  RateLimitAlgorithm,
  TrafficScenario,
} from '../../backend/types.ts';

interface ComparisonViewProps {
  comparison: ComparisonRunState;
  onStartComparison: (params: {
    algorithms: RateLimitAlgorithm[];
    totalRequests: number;
    virtualUsers: number;
    targetRps: number;
    scenario: TrafficScenario;
    endpoint: string;
  }) => Promise<void>;
  onStopLoadTest: () => Promise<void>;
}

const ALL_ALGORITHMS: { id: RateLimitAlgorithm; label: string }[] = [
  { id: 'fixed_window', label: 'Fixed Window' },
  { id: 'token_bucket', label: 'Token Bucket' },
  { id: 'sliding_window', label: 'Sliding Window' },
  { id: 'adaptive', label: 'Adaptive Rate Limiting' },
];

const ALGO_NAMES: Record<RateLimitAlgorithm, string> = {
  fixed_window: 'Fixed Window',
  token_bucket: 'Token Bucket',
  sliding_window: 'Sliding Window',
  adaptive: 'Adaptive Limiter',
};

export const ComparisonView: React.FC<ComparisonViewProps> = ({
  comparison,
  onStartComparison,
  onStopLoadTest,
}) => {
  const [selectedAlgos, setSelectedAlgos] = useState<RateLimitAlgorithm[]>([
    'fixed_window',
    'token_bucket',
    'sliding_window',
    'adaptive',
  ]);
  const [totalRequests, setTotalRequests] = useState(140);
  const [virtualUsers, setVirtualUsers] = useState(8);
  const [targetRps, setTargetRps] = useState(50);
  const [scenario, setScenario] = useState<TrafficScenario>('distributed_abuse');
  const [endpoint, setEndpoint] = useState('/api/products');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleAlgo = (id: RateLimitAlgorithm) => {
    setSelectedAlgos((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (selectedAlgos.length === 0) {
      setErrorMsg('Select at least one algorithm to run the comparison.');
      return;
    }
    try {
      await onStartComparison({
        algorithms: selectedAlgos,
        totalRequests,
        virtualUsers,
        targetRps,
        scenario,
        endpoint,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start comparison.');
    }
  };

  const results = comparison.results;
  const maxThroughput = Math.max(1, ...results.map((r) => r.throughputRps));
  const maxP95 = Math.max(1, ...results.map((r) => r.p95LatencyMs));

  return (
    <div className="space-y-6">
      <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Algorithm Comparison Runner (Controlled Experiment)
          </h2>
          <p className="text-xs text-slate-500">
            Executes the identical workload sequentially across each selected algorithm with isolated enforcement resets between runs. All metrics are computed strictly from real measured HTTP responses.
          </p>
        </div>

        <form onSubmit={handleRun} className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-slate-600">Algorithms:</span>
            {ALL_ALGORITHMS.map((algo) => {
              const checked = selectedAlgos.includes(algo.id);
              return (
                <label
                  key={algo.id}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs border rounded-md cursor-pointer transition-colors ${
                    checked
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAlgo(algo.id)}
                    className="sr-only"
                  />
                  <span>{algo.label}</span>
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <label className="block text-xs text-slate-600">
              Requests per Run
              <input
                type="number"
                min={20}
                max={400}
                value={totalRequests}
                onChange={(e) => setTotalRequests(Number(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Virtual Users
              <input
                type="number"
                min={1}
                max={20}
                value={virtualUsers}
                onChange={(e) => setVirtualUsers(Number(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Target RPS
              <input
                type="number"
                min={5}
                max={120}
                value={targetRps}
                onChange={(e) => setTargetRps(Number(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Workload Scenario
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value as TrafficScenario)}
                className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="distributed_abuse">Distributed Abuse</option>
                <option value="single_abuse">Single-User Abuse</option>
                <option value="spike">Sudden Traffic Spike</option>
                <option value="burst">Burst Traffic</option>
                <option value="normal">Normal Traffic</option>
                <option value="recovery">Recovery Test</option>
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Endpoint
              <select
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              >
                <option value="/api/products">/api/products</option>
                <option value="/api/users">/api/users</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs text-slate-600">
              {comparison.running ? (
                <span className="font-medium text-blue-700">
                  Benchmarking {comparison.currentAlgorithm ? ALGO_NAMES[comparison.currentAlgorithm] : '...'} ({comparison.completedAlgorithms.length}/{selectedAlgos.length} complete)
                </span>
              ) : results.length > 0 ? (
                <span>
                  Last comparison finished {comparison.finishedAt ? new Date(comparison.finishedAt).toLocaleTimeString() : ''}
                </span>
              ) : (
                <span>Configure consistent parameters and run the experiment across all algorithms.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={comparison.running}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  comparison.running
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-900 text-white hover:bg-slate-800 cursor-pointer'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run Full Comparison</span>
              </button>
              <button
                type="button"
                onClick={onStopLoadTest}
                disabled={!comparison.running}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                  comparison.running
                    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700 cursor-pointer'
                    : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                }`}
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </div>
          </div>
        </form>

        {(errorMsg || comparison.error) && (
          <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
            {errorMsg || comparison.error}
          </div>
        )}
      </div>

      {/* Experimental Comparison Table */}
      <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Measured Experimental Metrics</h2>
          <p className="text-xs text-slate-500">
            Legitimate Blocking Rate = (Legit Rejected / Total Legit) × 100 · Abuse Blocking Rate = (Abuse Rejected / Total Abuse) × 100
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Algorithm</th>
                <th className="py-2 px-2 font-medium text-right">Total</th>
                <th className="py-2 px-2 font-medium text-right">Accepted</th>
                <th className="py-2 px-2 font-medium text-right">Rejected</th>
                <th className="py-2 px-2 font-medium text-right">Legit Blocked</th>
                <th className="py-2 px-2 font-medium text-right">Abuse Blocked</th>
                <th className="py-2 px-2 font-medium text-right">Avg Lat</th>
                <th className="py-2 px-2 font-medium text-right">P95 Lat</th>
                <th className="py-2 px-2 font-medium text-right">P99 Lat</th>
                <th className="py-2 px-2 font-medium text-right">Throughput</th>
                <th className="py-2 px-2 font-medium text-right">CPU Avg/Pk</th>
                <th className="py-2 px-2 font-medium text-right">Mem Avg</th>
                <th className="py-2 pl-2 font-medium text-right">Recovery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center font-sans text-slate-400">
                    No comparison results recorded yet. Click Run Full Comparison to benchmark all 4 algorithms.
                  </td>
                </tr>
              ) : (
                results.map((row) => (
                  <tr key={row.algorithm} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-sans font-semibold text-slate-900">
                      {ALGO_NAMES[row.algorithm]}
                    </td>
                    <td className="py-2.5 px-2 text-right">{row.totalRequests}</td>
                    <td className="py-2.5 px-2 text-right text-emerald-700">{row.acceptedRequests}</td>
                    <td className="py-2.5 px-2 text-right text-red-700">
                      {row.rejectedRequests} ({row.rejectionPercent}%)
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {row.legitimateBlocked}/{row.legitimateTotal} ({row.legitimateBlockingRate}%)
                    </td>
                    <td className="py-2.5 px-2 text-right font-semibold text-blue-700">
                      {row.abuseBlocked}/{row.abuseTotal} ({row.abuseBlockingRate}%)
                    </td>
                    <td className="py-2.5 px-2 text-right">{row.avgLatencyMs} ms</td>
                    <td className="py-2.5 px-2 text-right">{row.p95LatencyMs} ms</td>
                    <td className="py-2.5 px-2 text-right">{row.p99LatencyMs} ms</td>
                    <td className="py-2.5 px-2 text-right font-semibold">{row.throughputRps} rps</td>
                    <td className="py-2.5 px-2 text-right">
                      {row.cpuAvgPercent}% / {row.cpuPeakPercent}%
                    </td>
                    <td className="py-2.5 px-2 text-right">{row.memoryAvgPercent}%</td>
                    <td className="py-2.5 pl-2 text-right">{row.recoveryTimeMs} ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Comparison Charts */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Abuse vs. Legitimate Blocking Rate (%)
            </h3>
            <div className="space-y-3">
              {results.map((r) => (
                <div key={r.algorithm} className="space-y-1 text-xs">
                  <div className="flex justify-between font-medium text-slate-700">
                    <span>{ALGO_NAMES[r.algorithm]}</span>
                    <span className="font-mono tabular-nums">
                      Abuse {r.abuseBlockingRate}% · Legit {r.legitimateBlockingRate}%
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-blue-600"
                        style={{ width: `${r.abuseBlockingRate}%` }}
                      />
                    </div>
                    <div className="h-2 bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${r.legitimateBlockingRate}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1">
                <span>Blue: Abuse Blocked % (higher = stronger protection)</span>
                <span>Amber: Legit Blocked % (lower = better fairness)</span>
              </div>
            </div>
          </div>

          <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Measured Throughput (Accepted req/s)
            </h3>
            <div className="space-y-3">
              {results.map((r) => (
                <div key={r.algorithm} className="space-y-1 text-xs">
                  <div className="flex justify-between text-slate-700">
                    <span>{ALGO_NAMES[r.algorithm]}</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {r.throughputRps} req/s
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-emerald-600"
                      style={{ width: `${(r.throughputRps / maxThroughput) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              P95 Response Latency (ms)
            </h3>
            <div className="space-y-3">
              {results.map((r) => (
                <div key={r.algorithm} className="space-y-1 text-xs">
                  <div className="flex justify-between text-slate-700">
                    <span>{ALGO_NAMES[r.algorithm]}</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {r.p95LatencyMs} ms
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-slate-800"
                      style={{ width: `${(r.p95LatencyMs / maxP95) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { Play, Send, Square } from 'lucide-react';
import type {
  LoadTestConfig,
  LoadTestProgress,
  RateLimitAlgorithm,
  TrafficScenario,
  UserCategory,
} from '../../backend/types.ts';

interface HistoryEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  latencyMs: number;
  ok: boolean;
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
}

interface CustomerTesterProps {
  activeAlgorithm: RateLimitAlgorithm;
  loadTest: LoadTestProgress;
  onStartLoadTest: (config: LoadTestConfig) => Promise<void>;
  onStopLoadTest: () => Promise<void>;
}

const ENDPOINT_PRESETS = [
  { label: 'GET /api/products', method: 'GET' as const, url: '/api/products', body: '' },
  { label: 'GET /api/users', method: 'GET' as const, url: '/api/users', body: '' },
  { label: 'GET /api/health', method: 'GET' as const, url: '/api/health', body: '' },
  {
    label: 'POST /api/orders',
    method: 'POST' as const,
    url: '/api/orders',
    body: JSON.stringify({ product_id: 1, quantity: 2 }, null, 2),
  },
  {
    label: 'POST /api/products',
    method: 'POST' as const,
    url: '/api/products',
    body: JSON.stringify(
      { name: 'Edge Optical Transceiver', category: 'hardware', priceUsd: 189.0, inStock: true },
      null,
      2,
    ),
  },
  {
    label: 'PUT /api/products/1',
    method: 'PUT' as const,
    url: '/api/products/1',
    body: JSON.stringify({ priceUsd: 134.99, inStock: true }, null, 2),
  },
  { label: 'DELETE /api/products/4', method: 'DELETE' as const, url: '/api/products/4', body: '' },
  { label: 'GET /api/simulate-status/500', method: 'GET' as const, url: '/api/simulate-status/500', body: '' },
];

const SCENARIO_INFO: Record<TrafficScenario, { label: string; desc: string }> = {
  normal: {
    label: '1. Normal Traffic',
    desc: 'Simulates ordinary multi-user activity within healthy operating thresholds.',
  },
  spike: {
    label: '2. Sudden Traffic Spike',
    desc: 'Sharp 4x traffic surge in the middle phase followed by cooldown.',
  },
  burst: {
    label: '3. Burst Traffic',
    desc: 'High-concurrency bursts sent in rapid short intervals.',
  },
  single_abuse: {
    label: '4. Single-User Abuse',
    desc: 'One aggressive API identity flooding requests alongside legitimate users.',
  },
  distributed_abuse: {
    label: '5. Distributed Abuse',
    desc: '12 rotating bot identities generating coordinated abuse alongside legitimate traffic.',
  },
  high_load: {
    label: '6. High Server Load',
    desc: 'Sustained high-pressure workload to observe CPU, memory, and latency curves.',
  },
  recovery: {
    label: '7. Recovery Test',
    desc: 'Heavy load surge in phase 1 followed by normal traffic in phase 2 to verify recovery.',
  },
};

export const CustomerTester: React.FC<CustomerTesterProps> = ({
  activeAlgorithm,
  loadTest,
  onStartLoadTest,
  onStopLoadTest,
}) => {
  // Postman-like state
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET');
  const [url, setUrl] = useState('/api/products');
  const [apiKey, setApiKey] = useState('customer-demo-01');
  const [userCategory, setUserCategory] = useState<UserCategory>('standard');
  const [customHeaders, setCustomHeaders] = useState('{\n  "Accept": "application/json"\n}');
  const [requestBody, setRequestBody] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [postmanError, setPostmanError] = useState<string | null>(null);

  // Automated load test state
  const [ltTotalRequests, setLtTotalRequests] = useState(180);
  const [ltVirtualUsers, setLtVirtualUsers] = useState(10);
  const [ltTargetRps, setLtTargetRps] = useState(40);
  const [ltDuration, setLtDuration] = useState(20);
  const [ltAlgorithm, setLtAlgorithm] = useState<RateLimitAlgorithm>(activeAlgorithm);
  const [ltCategory, setLtCategory] = useState<UserCategory>('standard');
  const [ltScenario, setLtScenario] = useState<TrafficScenario>('distributed_abuse');
  const [ltEndpoint, setLtEndpoint] = useState('/api/products');
  const [ltError, setLtError] = useState<string | null>(null);

  const activeResponse =
    history.find((h) => h.id === selectedHistoryId) ?? history[0] ?? null;

  const applyPreset = (preset: (typeof ENDPOINT_PRESETS)[number]) => {
    setMethod(preset.method);
    setUrl(preset.url);
    setRequestBody(preset.body);
    setPostmanError(null);
  };

  const handleSendRequest = async () => {
    setPostmanError(null);
    let parsedHeaders: Record<string, string> = {};
    if (customHeaders.trim()) {
      try {
        parsedHeaders = JSON.parse(customHeaders);
      } catch {
        setPostmanError('Custom Headers must be valid JSON.');
        return;
      }
    }

    if ((method === 'POST' || method === 'PUT') && requestBody.trim()) {
      try {
        JSON.parse(requestBody);
      } catch {
        setPostmanError('Request Body must be valid JSON.');
        return;
      }
    }

    const reqHeaders: Record<string, string> = {
      ...parsedHeaders,
      'X-API-Key': apiKey.trim() || 'anonymous',
      'X-User-Category': userCategory,
    };
    if (method === 'POST' || method === 'PUT') {
      reqHeaders['Content-Type'] = 'application/json';
    }

    setSending(true);
    const t0 = performance.now();
    try {
      const targetUrl = url.startsWith('/') ? url : `/${url}`;
      const res = await fetch(targetUrl, {
        method,
        headers: reqHeaders,
        body: method === 'POST' || method === 'PUT' ? requestBody || '{}' : undefined,
      });
      const latencyMs = Number((performance.now() - t0).toFixed(2));
      const rawText = await res.text();
      let formattedBody = rawText;
      try {
        formattedBody = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        // Keep raw text if non-JSON
      }

      const respHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        respHeaders[key] = value;
      });

      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        method,
        url: targetUrl,
        status: res.status,
        latencyMs,
        ok: res.ok,
        requestHeaders: reqHeaders,
        requestBody,
        responseHeaders: respHeaders,
        responseBody: formattedBody,
      };

      setHistory((prev) => [entry, ...prev].slice(0, 50));
      setSelectedHistoryId(entry.id);
    } catch (err) {
      setPostmanError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSending(false);
    }
  };

  const handleStartLoad = async (e: React.FormEvent) => {
    e.preventDefault();
    setLtError(null);
    try {
      await onStartLoadTest({
        totalRequests: ltTotalRequests,
        virtualUsers: ltVirtualUsers,
        targetRps: ltTargetRps,
        durationSeconds: ltDuration,
        algorithm: ltAlgorithm,
        userCategory: ltCategory,
        scenario: ltScenario,
        endpoint: ltEndpoint,
        method: ltEndpoint === '/api/orders' ? 'POST' : 'GET',
      });
    } catch (err) {
      setLtError(err instanceof Error ? err.message : 'Could not start load test.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Postman-like API Testing Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 p-5 bg-white border border-slate-200 rounded-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">API Request Tester</h2>
              <p className="text-xs text-slate-500">
                Send manual HTTP requests to protected FastAPI/Express endpoints and inspect rate-limit headers.
              </p>
            </div>
          </div>

          {/* Quick Endpoint Presets */}
          <div className="flex flex-wrap gap-1.5">
            {ENDPOINT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="px-2.5 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* URL Bar */}
          <div className="flex flex-wrap sm:flex-nowrap gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'GET' | 'POST' | 'PUT' | 'DELETE')}
              className="px-3 py-2 text-xs font-mono font-semibold border border-slate-300 rounded-md bg-white text-slate-900"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/api/products"
              className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-md bg-white text-slate-900"
            />
            <button
              type="button"
              onClick={handleSendRequest}
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sending ? 'Sending...' : 'Send Request'}</span>
            </button>
          </div>

          {/* Identity & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs text-slate-600">
              API Key / Client Identifier (X-API-Key)
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="mt-1 w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              User Category (X-User-Category)
              <select
                value={userCategory}
                onChange={(e) => setUserCategory(e.target.value as UserCategory)}
                className="mt-1 w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="premium">Premium (Priority 3)</option>
                <option value="standard">Standard (Priority 2)</option>
                <option value="basic">Basic (Priority 1)</option>
              </select>
            </label>
          </div>

          {/* Headers & Body Editors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs text-slate-600">
              Headers (JSON)
              <textarea
                rows={4}
                value={customHeaders}
                onChange={(e) => setCustomHeaders(e.target.value)}
                className="mt-1 w-full p-2.5 text-xs font-mono border border-slate-300 rounded-md bg-slate-50"
              />
            </label>
            <label className="block text-xs text-slate-600">
              JSON Request Body (POST / PUT)
              <textarea
                rows={4}
                value={requestBody}
                onChange={(e) => setRequestBody(e.target.value)}
                placeholder='{"product_id": 1, "quantity": 2}'
                className="mt-1 w-full p-2.5 text-xs font-mono border border-slate-300 rounded-md bg-slate-50"
              />
            </label>
          </div>

          {postmanError && (
            <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
              {postmanError}
            </div>
          )}

          {/* Response Viewer */}
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-900">Response Viewer</span>
              {activeResponse && (
                <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                  <span
                    className={`font-semibold ${
                      activeResponse.status === 429 || activeResponse.status >= 500
                        ? 'text-red-700'
                        : activeResponse.ok
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                    }`}
                  >
                    HTTP {activeResponse.status} {activeResponse.ok ? 'Success' : 'Rejected/Error'}
                  </span>
                  <span className="text-slate-500">{activeResponse.latencyMs} ms</span>
                  <span className="text-slate-500">
                    {new Date(activeResponse.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>

            {!activeResponse ? (
              <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-md">
                Click Send Request above to inspect the live response body and rate-limit headers.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-medium text-slate-500 mb-1">Response Body</div>
                  <pre className="p-3 text-[11px] font-mono bg-slate-900 text-slate-100 rounded-md overflow-x-auto max-h-56 overflow-y-auto">
                    {activeResponse.responseBody}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500 mb-1">Response Headers</div>
                  <pre className="p-3 text-[11px] font-mono bg-slate-50 border border-slate-200 text-slate-800 rounded-md overflow-x-auto max-h-56 overflow-y-auto">
                    {JSON.stringify(activeResponse.responseHeaders, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Request History Table */}
        <div className="lg:col-span-5 p-5 bg-white border border-slate-200 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Client Request History</h2>
              <p className="text-xs text-slate-500">Click any row to inspect full headers and payload</p>
            </div>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistory([])}
                className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-2 font-medium">Time</th>
                  <th className="py-2 px-2 font-medium">Endpoint</th>
                  <th className="py-2 px-2 font-medium text-right">Status</th>
                  <th className="py-2 pl-2 font-medium text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center font-sans text-slate-400">
                      No manual requests sent in this session yet.
                    </td>
                  </tr>
                ) : (
                  history.map((item) => {
                    const selected = activeResponse?.id === item.id;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedHistoryId(item.id)}
                        className={`cursor-pointer transition-colors ${
                          selected ? 'bg-slate-100' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2 pr-2 text-slate-500 whitespace-nowrap">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-2 text-slate-800 truncate max-w-[170px]">
                          {item.method} {item.url}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-semibold ${
                            item.status === 429 || item.status >= 500
                              ? 'text-red-700'
                              : item.ok
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {item.status}
                        </td>
                        <td className="py-2 pl-2 text-right text-slate-600">
                          {item.latencyMs} ms
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 2: Automated Load Testing & Traffic Scenarios */}
      <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Automated Load Generator & Traffic Scenarios
            </h2>
            <p className="text-xs text-slate-500">
              Generates concurrent HTTP traffic automatically against the backend rate-limiting pipeline with bounded safety caps.
            </p>
          </div>
        </div>

        <form onSubmit={handleStartLoad} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <label className="block text-xs text-slate-600">
              Total Requests
              <input
                type="number"
                min={10}
                max={1500}
                value={ltTotalRequests}
                onChange={(e) => setLtTotalRequests(Number(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Virtual Users
              <input
                type="number"
                min={1}
                max={30}
                value={ltVirtualUsers}
                onChange={(e) => setLtVirtualUsers(Number(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Target RPS
              <input
                type="number"
                min={1}
                max={150}
                value={ltTargetRps}
                onChange={(e) => setLtTargetRps(Number(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Duration (sec)
              <input
                type="number"
                min={3}
                max={90}
                value={ltDuration}
                onChange={(e) => setLtDuration(Number(e.target.value))}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              />
            </label>
            <label className="block text-xs text-slate-600">
              Algorithm
              <select
                value={ltAlgorithm}
                onChange={(e) => setLtAlgorithm(e.target.value as RateLimitAlgorithm)}
                className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="fixed_window">Fixed Window</option>
                <option value="token_bucket">Token Bucket</option>
                <option value="sliding_window">Sliding Window</option>
                <option value="adaptive">Adaptive Limiter</option>
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              User Category
              <select
                value={ltCategory}
                onChange={(e) => setLtCategory(e.target.value as UserCategory)}
                className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="premium">Premium (3)</option>
                <option value="standard">Standard (2)</option>
                <option value="basic">Basic (1)</option>
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Target Endpoint
              <select
                value={ltEndpoint}
                onChange={(e) => setLtEndpoint(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
              >
                <option value="/api/products">/api/products</option>
                <option value="/api/users">/api/users</option>
                <option value="/api/orders">/api/orders</option>
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Traffic Scenario
              <select
                value={ltScenario}
                onChange={(e) => setLtScenario(e.target.value as TrafficScenario)}
                className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                {(Object.keys(SCENARIO_INFO) as TrafficScenario[]).map((key) => (
                  <option key={key} value={key}>
                    {SCENARIO_INFO[key].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <p className="text-xs text-slate-600">
              <span className="font-medium text-slate-800">{SCENARIO_INFO[ltScenario].label}:</span>{' '}
              {SCENARIO_INFO[ltScenario].desc}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={loadTest.running}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  loadTest.running
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-900 text-white hover:bg-slate-800 cursor-pointer'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                <span>Start Load Test</span>
              </button>
              <button
                type="button"
                onClick={onStopLoadTest}
                disabled={!loadTest.running}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                  loadTest.running
                    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700 cursor-pointer'
                    : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                }`}
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop Load Test</span>
              </button>
            </div>
          </div>
        </form>

        {ltError && (
          <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
            {ltError}
          </div>
        )}

        {/* Live Load Test Progress */}
        <div className="border-t border-slate-200 pt-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">
              {loadTest.running
                ? `Running ${loadTest.scenario} under ${loadTest.algorithm}...`
                : loadTest.stopReason
                  ? `Last test finished: ${loadTest.stopReason}`
                  : 'Ready to run automated traffic scenario'}
            </span>
            <span className="font-mono tabular-nums text-slate-700">
              {loadTest.progressPercent}% ({loadTest.completed} / {loadTest.targetRequests})
            </span>
          </div>

          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${loadTest.progressPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
            {[
              { label: 'Sent', value: loadTest.sent },
              { label: 'Completed', value: loadTest.completed },
              { label: 'Accepted', value: loadTest.accepted, cls: 'text-emerald-700' },
              { label: 'Rejected (429)', value: loadTest.rejected, cls: 'text-red-700' },
              { label: 'Current RPS', value: `${loadTest.currentRps}` },
              { label: 'Success %', value: `${loadTest.successPercent}%` },
              { label: 'Rejection %', value: `${loadTest.rejectionPercent}%` },
              { label: 'Avg Latency', value: `${loadTest.avgResponseTimeMs} ms` },
            ].map((stat) => (
              <div key={stat.label} className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-500">{stat.label}</div>
                <div className={`font-mono tabular-nums font-semibold ${stat.cls ?? 'text-slate-900'}`}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

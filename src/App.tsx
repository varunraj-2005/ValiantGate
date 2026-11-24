import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Laptop,
  Menu,
  Send,
  X,
} from 'lucide-react';
import type {
  ComparisonRunState,
  LoadTestConfig,
  LoadTestProgress,
  MonitoringSnapshot,
  RateLimitAlgorithm,
  RateLimitConfig,
  SlidingWindowSnapshot,
  TrafficScenario,
} from '../backend/types.ts';
import { ComparisonView } from './components/ComparisonView.tsx';
import { CustomerTester } from './components/CustomerTester.tsx';
import { PythonGuideView } from './components/PythonGuideView.tsx';
import { ServerDashboard } from './components/ServerDashboard.tsx';

type WorkspaceTab = 'monitor' | 'customer' | 'comparison' | 'python';

interface SnapshotApiResponse {
  snapshot: MonitoringSnapshot;
  config: RateLimitConfig;
  loadTest: LoadTestProgress;
  comparison: ComparisonRunState;
}

const ADMIN_TOKEN = 'arl-admin-local';

const NAV_ITEMS: { id: WorkspaceTab; label: string; Icon: typeof Activity }[] = [
  { id: 'monitor', label: 'Server Monitor', Icon: Activity },
  { id: 'customer', label: 'Customer & Load Test', Icon: Send },
  { id: 'comparison', label: 'Algorithm Comparison', Icon: BarChart3 },
  { id: 'python', label: 'Two-Laptop Python', Icon: Laptop },
];

const WORKSPACE_TITLES: Record<WorkspaceTab, string> = {
  monitor: 'Operations / Server Monitoring Console',
  customer: 'Client / API Tester & Load Generator',
  comparison: 'Research / Algorithm Comparison',
  python: 'Deployment / Two-Laptop Python Setup',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('monitor');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [data, setData] = useState<SnapshotApiResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [selectedSlidingUser, setSelectedSlidingUser] = useState('');
  const [slidingWindowOverride, setSlidingWindowOverride] =
    useState<SlidingWindowSnapshot | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/snapshot');
      if (!res.ok) {
        throw new Error(`Monitoring API returned HTTP ${res.status}`);
      }
      const json = (await res.json()) as SnapshotApiResponse;
      setData(json);
      setFetchError(null);

      if (selectedSlidingUser) {
        const swRes = await fetch(
          `/api/monitoring/sliding-window?userId=${encodeURIComponent(selectedSlidingUser)}`,
        );
        if (swRes.ok) {
          setSlidingWindowOverride((await swRes.json()) as SlidingWindowSnapshot);
        }
      } else {
        setSlidingWindowOverride(null);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Unable to reach backend server.');
    }
  }, [selectedSlidingUser]);

  useEffect(() => {
    void fetchSnapshot();
    const timer = setInterval(() => {
      void fetchSnapshot();
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchSnapshot]);

  const adminPost = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || errJson.error || `HTTP ${res.status}`);
    }
    await fetchSnapshot();
    return res.json();
  };

  const handleSelectAlgorithm = async (algo: RateLimitAlgorithm) => {
    await adminPost('/api/admin/algorithm', { algorithm: algo });
    setActionNotice(`Switched active rate limiter to ${algo.replace('_', ' ')}.`);
  };

  const handleUpdateConfig = async (patch: Partial<RateLimitConfig>) => {
    await adminPost('/api/admin/config', patch);
    setActionNotice('Adaptive controller parameters updated.');
  };

  const handlePauseApi = async () => {
    await adminPost('/api/admin/pause');
    setActionNotice('API paused — business endpoints now return HTTP 503.');
  };

  const handleResumeApi = async () => {
    await adminPost('/api/admin/resume');
    setActionNotice('API processing resumed.');
  };

  const handleStopLoadTest = async () => {
    const res = await fetch('/api/load-test/stop', { method: 'POST' });
    if (res.ok) {
      setActionNotice('Load test stop signal sent.');
      await fetchSnapshot();
    }
  };

  const handleClearDashboard = async () => {
    await adminPost('/api/admin/clear-dashboard');
    setActionNotice('Dashboard history cleared; active rate-limit enforcement preserved.');
  };

  const handleResetExperiment = async () => {
    await adminPost('/api/admin/reset-experiment');
    setActionNotice('Experiment metrics reset for a new run.');
  };

  const handleResetSecurityState = async () => {
    await adminPost('/api/admin/reset-security');
    setActionNotice('Rate-limit buckets, windows, and abuse penalties cleared.');
  };

  const handleStartLoadTest = async (config: LoadTestConfig) => {
    const res = await fetch('/api/load-test/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `HTTP ${res.status}`);
    }
    setActionNotice(`Started ${config.scenario} load test (${config.totalRequests} requests).`);
    await fetchSnapshot();
  };

  const handleStartComparison = async (params: {
    algorithms: RateLimitAlgorithm[];
    totalRequests: number;
    virtualUsers: number;
    targetRps: number;
    scenario: TrafficScenario;
    endpoint: string;
  }) => {
    const res = await fetch('/api/comparison/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `HTTP ${res.status}`);
    }
    setActionNotice('Started sequential 4-algorithm comparison benchmark.');
    await fetchSnapshot();
  };

  const handleQuickSpikeDemo = async () => {
    if (data?.loadTest.running) {
      await handleStopLoadTest();
      return;
    }
    await handleStartLoadTest({
      totalRequests: 160,
      virtualUsers: 10,
      targetRps: 45,
      durationSeconds: 15,
      algorithm: data?.snapshot.activeAlgorithm ?? 'adaptive',
      userCategory: 'standard',
      scenario: 'distributed_abuse',
      endpoint: '/api/products',
      method: 'GET',
    });
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Workspace Sidebar (248px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[248px] bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="font-semibold text-sm tracking-tight text-slate-900 whitespace-nowrap">
            Adaptive Rate Limiter
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-500 hover:text-slate-900"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div className="font-medium text-slate-700">Live Engine</div>
          <div className="font-mono tabular-nums">
            Algorithm: {data?.snapshot.activeAlgorithm ?? 'loading'}
          </div>
          <div className="font-mono tabular-nums">
            State: {data?.snapshot.trafficIndicator.state ?? 'GREEN'}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb on left + 1 primary action on right */}
        <header className="bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 border border-slate-200 rounded-md text-slate-600 hover:text-slate-900"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-sm font-semibold text-slate-900 truncate">
              {WORKSPACE_TITLES[activeTab]}
            </h1>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleQuickSpikeDemo}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                data?.loadTest.running
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {data?.loadTest.running ? 'Stop Active Traffic' : 'Simulate Distributed Abuse'}
            </button>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-6 max-w-[1440px] w-full mx-auto space-y-4">
          {fetchError && (
            <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md">
              Backend connection error: {fetchError}. Ensure the server is running on port 3000.
            </div>
          )}

          {actionNotice && (
            <div className="flex items-center justify-between gap-4 px-3.5 py-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-md">
              <span>{actionNotice}</span>
              <button
                type="button"
                onClick={() => setActionNotice(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {!data ? (
            <div className="p-10 bg-white border border-slate-200 rounded-lg text-center text-sm text-slate-500">
              Connecting to live rate-limiting backend...
            </div>
          ) : (
            <>
              {activeTab === 'monitor' && (
                <ServerDashboard
                  snapshot={data.snapshot}
                  config={data.config}
                  loadTest={data.loadTest}
                  slidingWindowOverride={slidingWindowOverride}
                  selectedSlidingUser={selectedSlidingUser}
                  onSelectSlidingUser={setSelectedSlidingUser}
                  onSelectAlgorithm={handleSelectAlgorithm}
                  onUpdateConfig={handleUpdateConfig}
                  onPauseApi={handlePauseApi}
                  onResumeApi={handleResumeApi}
                  onStopLoadTest={handleStopLoadTest}
                  onClearDashboard={handleClearDashboard}
                  onResetExperiment={handleResetExperiment}
                  onResetSecurityState={handleResetSecurityState}
                />
              )}

              {activeTab === 'customer' && (
                <CustomerTester
                  activeAlgorithm={data.snapshot.activeAlgorithm}
                  loadTest={data.loadTest}
                  onStartLoadTest={handleStartLoadTest}
                  onStopLoadTest={handleStopLoadTest}
                />
              )}

              {activeTab === 'comparison' && (
                <ComparisonView
                  comparison={data.comparison}
                  onStartComparison={handleStartComparison}
                  onStopLoadTest={handleStopLoadTest}
                />
              )}

              {activeTab === 'python' && <PythonGuideView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

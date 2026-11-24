import React from 'react';

export const PythonGuideView: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Python Two-Laptop Deployment Reference (Stage 1 Generated in adaptive-rate-limiter/)
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
          While this live web console runs the full-stack Express + React implementation directly in your browser preview, the modular Python FastAPI + Redis Stage 1 codebase has also been generated under <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">adaptive-rate-limiter/</code> for your two-laptop Windows Wi-Fi demonstration.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Laptop 1 — Server Side (Windows PowerShell)</h3>
          <p className="text-xs text-slate-500">
            Runs Redis (localhost-only 127.0.0.1:6379) and FastAPI bound to 0.0.0.0:8000.
          </p>
          <pre className="p-3.5 text-xs font-mono bg-slate-900 text-slate-100 rounded-md overflow-x-auto leading-relaxed">
{`cd adaptive-rate-limiter
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r server\\requirements.txt
Copy-Item .env.example .env

# Start Redis locally (Docker or WSL2)
docker compose up -d redis

# Find Wi-Fi IPv4 address & open port 8000
ipconfig
New-NetFirewallRule -DisplayName "Adaptive Rate Limiter" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private

# Start FastAPI server on LAN
uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload`}
          </pre>
        </div>

        <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Laptop 2 — Customer Verification (Same Wi-Fi)</h3>
          <p className="text-xs text-slate-500">
            Replace 192.168.1.10 with Laptop 1&apos;s IPv4 address from ipconfig. Redis stays hidden on Laptop 1.
          </p>
          <pre className="p-3.5 text-xs font-mono bg-slate-900 text-slate-100 rounded-md overflow-x-auto leading-relaxed">
{`# Verify FastAPI + Redis health from Laptop 2
Invoke-RestMethod -Uri "http://192.168.1.10:8000/api/health"

# Verify sample business endpoint
Invoke-RestMethod -Uri "http://192.168.1.10:8000/api/products"

# Run Stage 1 automated pytest suite on Laptop 1
pytest server\\tests\\test_stage1_health.py -v`}
          </pre>
        </div>
      </div>

      <div className="p-5 bg-white border border-slate-200 rounded-lg space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">Adaptive Controller Formula Used in Both Runtimes</h3>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded font-mono text-xs text-slate-800">
          Adaptive Limit = Base Limit × (1 + α × Demand Score − β × Abuse Risk Score − γ × Resource Pressure Score)
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          All scores are normalized to [0, 1] and smoothed via exponential moving average (EMA). The controller applies slew-rate damping and enforces [Min Limit, Max Limit] boundaries along with per-user priority weights (Premium 3, Standard 2, Basic 1) and a global safety cap.
        </p>
      </div>
    </div>
  );
};

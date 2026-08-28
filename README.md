<div align="center">

<img src="Picture1.png" alt="Adaptive API Rate Limiting Banner" width="450"/>

# `< A D A P T I V E _ R A T E _ L I M I T E R />`
### ⚙️ PROTECTING WEB APIs AGAINST VARIABLE TRAFFIC AND ABUSE ⚙️

```
[ SYSTEM STATUS ]   ONLINE
[ MODULE ]          RATE-LIMIT-ENGINE-v1.0
[ AUTHORS ]         VARUNRAJ // SUDHARSAN
[ TYPE ]            FINAL YEAR RESEARCH PROJECT
```

![Status](https://img.shields.io/badge/STATUS-ACTIVE-00c0ff?style=for-the-badge&logo=statuspage)
![Research](https://img.shields.io/badge/TYPE-RESEARCH_PAPER-1e3a8a?style=for-the-badge&logo=readthedocs)
![Language](https://img.shields.io/badge/BUILT_WITH-PYTHON_%7C_NODE-0d1117?style=for-the-badge&logo=python)
![License](https://img.shields.io/badge/LICENSE-MIT-lightgrey?style=for-the-badge)

</div>

---

## 📡 `01_SYSTEM_OVERVIEW`

```
┌──────────────────────────────────────────────────────────┐
│  PROBLEM :: STATIC RATE LIMITS FAIL UNDER DYNAMIC LOAD    │
│  SOLUTION :: SELF-ADJUSTING, BEHAVIOR-AWARE RATE ENGINE   │
└──────────────────────────────────────────────────────────┘
```

Traditional API rate limiting enforces a **fixed ceiling** —
`100 requests / minute / user` — regardless of context.

This breaks down in two real scenarios:

| SCENARIO | FIXED LIMIT BEHAVIOR | REAL-WORLD IMPACT |
|---|---|---|
| 🟢 Legitimate burst (e.g., dashboard refresh, bulk export) | Blocked at 101st request | Frustrated genuine users |
| 🔴 Distributed abuse (many accounts, low rate each) | Never triggers threshold | Undetected attack traffic |

**`ADAPTIVE_RATE_LIMITER`** solves this by dynamically recalibrating
limits per client based on live traffic behavior, historical patterns,
and system load — instead of one static number for everyone.

---

## 🧠 `02_RESEARCH_TITLE`

> **"Adaptive Rate Limiting for Protecting Web APIs Against
> Variable Traffic and Abuse"**

---

## 🧩 `03_ARCHITECTURE_PIPELINE`

```
   ┌────────────────┐
   │  FIXED LIMIT    │   Baseline :: static threshold, no memory
   └───────┬────────┘
           ▼
   ┌────────────────┐
   │  TOKEN BUCKET   │   Allows controlled bursts via refill rate
   └───────┬────────┘
           ▼
   ┌────────────────┐
   │ SLIDING WINDOW  │   Smooths edge-of-window burst exploits
   └───────┬────────┘
           ▼
   ┌────────────────┐
   │ ★ ADAPTIVE RL ★ │   Learns + reacts to behavior in real time
   └────────────────┘
```

Each stage is implemented, benchmarked, and compared —
not just described. This project is **empirical**, not theoretical.

---

## ⚡ `04_ADAPTIVE_ENGINE_LOGIC`

The adaptive layer recalculates a client's allowed rate using a
rolling behavior score, instead of a hardcoded number:

```python
def compute_adaptive_limit(client):
    base_limit      = 100
    trust_score     = get_trust_score(client)      # 0.0 – 1.0
    server_load     = get_current_cpu_load()        # 0.0 – 1.0
    burst_history   = get_recent_burst_pattern(client)

    adjusted_limit = base_limit * trust_score * (1 - server_load)

    if is_suspicious_pattern(burst_history):
        adjusted_limit *= 0.2   # throttle hard on abuse signals

    return max(adjusted_limit, MIN_SAFE_LIMIT)
```

`trust_score` factors in: account age, past violation history,
geographic/IP consistency, and request entropy across a time window.

---

## 📊 `05_EVALUATION_METRICS`

```
[ METRIC ]                        [ WHY IT MATTERS ]
─────────────────────────────────────────────────────────────
Legitimate Requests Blocked   →   False positive rate
Attack Requests Blocked       →   True positive / detection rate
Response Time (ms)            →   Overhead cost of the algorithm
Server CPU Usage (%)          →   Computational efficiency
Memory Consumption (MB)       →   Scalability at high user count
```

Each strategy (Fixed → Token Bucket → Sliding Window → Adaptive)
is run against **identical simulated traffic** so results are
directly comparable.

---

## 🧪 `06_EXPERIMENTAL_SETUP`

```
┌─ TRAFFIC SIMULATION ───────────────────────────────┐
│  • Legitimate load generator  → Locust / k6         │
│  • Burst simulation           → sudden spike script │
│  • Distributed attack sim     → multi-IP low-rate   │
│    request flooder (custom script)                  │
└─────────────────────────────────────────────────────┘

┌─ TEST ENVIRONMENT ─────────────────────────────────┐
│  • API server        : Node.js / Express (or Flask) │
│  • Rate limit store   : Redis (in-memory counters)  │
│  • Monitoring         : Prometheus + Grafana         │
│  • Load testing       : Locust / k6                  │
└─────────────────────────────────────────────────────┘
```

---

## 🗂️ `07_PROJECT_STRUCTURE`

```
adaptive-rate-limiter/
├── src/
│   ├── strategies/
│   │   ├── fixed_limit.py
│   │   ├── token_bucket.py
│   │   ├── sliding_window.py
│   │   └── adaptive_limiter.py
│   ├── server/
│   │   └── api_gateway.js
│   └── utils/
│       └── trust_score.py
├── simulations/
│   ├── legitimate_traffic_sim.py
│   └── distributed_attack_sim.py
├── results/
│   ├── metrics_comparison.csv
│   └── graphs/
├── paper/
│   └── Adaptive_Rate_Limiting_Research_Paper.pdf
├── assets/
│   └── Picture1.png
└── README.md
```

---

## 🚀 `08_QUICKSTART`

```bash
# clone the repository
git clone https://github.com/<your-repo>/adaptive-rate-limiter.git
cd adaptive-rate-limiter

# install dependencies
pip install -r requirements.txt
npm install

# run the API gateway with a chosen strategy
python src/server/run_gateway.py --strategy adaptive

# simulate traffic
python simulations/legitimate_traffic_sim.py
python simulations/distributed_attack_sim.py

# view collected metrics
python results/generate_report.py
```

---

## 🏁 `09_EXPECTED_OUTCOME`

```
> Adaptive strategy reduces false-positive blocking of
  legitimate users by an expected margin over fixed limiting

> Adaptive strategy improves detection of distributed,
  low-and-slow abuse patterns that static thresholds miss

> Trade-off analyzed: adaptive logic adds CPU/memory overhead
  vs. fixed and token-bucket baselines — quantified, not assumed
```

---

## 👥 `10_AUTHORS`

```
┌──────────────────────────────┐
│   VARUNRAJ.P                 │
│   SUDHARSAN.C                │
│   — Final Year B.Tech — IT   │
└──────────────────────────────┘
```

---

<div align="center">

```
[ END OF README ]   //   SYSTEM READY FOR DEPLOYMENT
```

</div>

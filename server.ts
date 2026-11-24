import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { RateLimiterEngine } from './backend/algorithms.ts';
import { LoadTestService } from './backend/loadRunner.ts';
import { MonitoringService } from './backend/monitor.ts';
import type {
  LoadTestConfig,
  RateLimitAlgorithm,
  RateLimitConfig,
  TrafficScenario,
  UserCategory,
} from './backend/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'arl-admin-local';

const INITIAL_CONFIG: RateLimitConfig = {
  activeAlgorithm: 'adaptive',
  fixedWindowLimit: 25,
  fixedWindowSeconds: 15,
  tokenBucketCapacity: 25,
  tokenBucketRefillRate: 3,
  slidingWindowLimit: 25,
  slidingWindowSeconds: 15,
  adaptiveBaseLimit: 25,
  adaptiveMinLimit: 6,
  adaptiveMaxLimit: 80,
  adaptiveAlpha: 0.5,
  adaptiveBeta: 0.65,
  adaptiveGamma: 0.5,
  globalSafetyCapRps: 110,
  normalRpsThreshold: 18,
  criticalRpsThreshold: 55,
  criticalCpuThreshold: 85,
  criticalMemoryThreshold: 88,
  criticalLatencyMsThreshold: 120,
};

interface ProductRecord {
  id: number;
  sku: string;
  name: string;
  category: string;
  priceUsd: number;
  inStock: boolean;
}

const productsStore: ProductRecord[] = [
  { id: 1, sku: 'ARL-1001', name: 'Edge Gateway Sensor', category: 'hardware', priceUsd: 129.99, inStock: true },
  { id: 2, sku: 'ARL-1002', name: 'Telemetry Relay Module', category: 'hardware', priceUsd: 74.5, inStock: true },
  { id: 3, sku: 'ARL-2001', name: 'API Traffic Analyzer License', category: 'software', priceUsd: 299.0, inStock: true },
  { id: 4, sku: 'ARL-2002', name: 'Distributed Guardrail Pack', category: 'software', priceUsd: 149.0, inStock: false },
];

const usersStore = [
  { id: 'usr-prem-01', name: 'Aarav Nair', category: 'premium', priority: 3, region: 'ap-south' },
  { id: 'usr-std-02', name: 'Maya Chen', category: 'standard', priority: 2, region: 'us-east' },
  { id: 'usr-basic-03', name: 'Liam Brooks', category: 'basic', priority: 1, region: 'eu-west' },
];

const VALID_ALGORITHMS = new Set<RateLimitAlgorithm>([
  'fixed_window',
  'token_bucket',
  'sliding_window',
  'adaptive',
]);

const VALID_CATEGORIES = new Set<UserCategory>(['basic', 'standard', 'premium']);

function parseCategory(raw: string | undefined): UserCategory {
  const norm = (raw ?? 'standard').trim().toLowerCase() as UserCategory;
  return VALID_CATEGORIES.has(norm) ? norm : 'standard';
}

function parseAlgorithmHeader(raw: string | undefined): RateLimitAlgorithm | undefined {
  if (!raw) return undefined;
  const norm = raw.trim().toLowerCase() as RateLimitAlgorithm;
  return VALID_ALGORITHMS.has(norm) ? norm : undefined;
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.header('X-Admin-Token');
  if (!token || token !== ADMIN_TOKEN) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid X-Admin-Token header required for administrative actions.',
    });
    return;
  }
  next();
}

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const limiter = new RateLimiterEngine(INITIAL_CONFIG);
  const monitor = new MonitoringService(limiter);
  const loadRunner = new LoadTestService(PORT, limiter, monitor);
  monitor.startSampler();

  // Rate-limiting + monitoring middleware for protected business API endpoints
  const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const startNs = process.hrtime.bigint();
    const clientId = (req.header('X-API-Key') || req.ip || 'anonymous').trim();
    const category = parseCategory(req.header('X-User-Category'));
    const algoOverride = parseAlgorithmHeader(req.header('X-RateLimit-Algorithm'));
    const effectiveAlgo = algoOverride ?? limiter.getConfig().activeAlgorithm;

    if (monitor.isApiPaused()) {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      monitor.recordRequest({
        clientId,
        category,
        endpoint: req.originalUrl.split('?')[0],
        method: req.method,
        statusCode: 503,
        responseTimeMs: elapsedMs,
        algorithm: effectiveAlgo,
        decision: 'Paused',
      });
      res.setHeader('Retry-After', '5');
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'API processing is temporarily paused by the server administrator.',
      });
      return;
    }

    const decision = limiter.evaluate(clientId, category, algoOverride);
    res.setHeader('X-RateLimit-Algorithm', decision.algorithm);
    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      limiter.recordRequestOutcome(clientId, 429);
      monitor.recordRequest({
        clientId,
        category,
        endpoint: req.originalUrl.split('?')[0],
        method: req.method,
        statusCode: 429,
        responseTimeMs: elapsedMs,
        algorithm: decision.algorithm,
        decision: 'Rejected',
      });
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      res.status(429).json({
        error: 'Too Many Requests',
        algorithm: decision.algorithm,
        limit: decision.limit,
        remaining: 0,
        retry_after_seconds: decision.retryAfterSeconds,
        reason: decision.reason,
      });
      return;
    }

    res.on('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      limiter.recordRequestOutcome(clientId, res.statusCode);
      monitor.recordRequest({
        clientId,
        category,
        endpoint: req.originalUrl.split('?')[0],
        method: req.method,
        statusCode: res.statusCode,
        responseTimeMs: elapsedMs,
        algorithm: decision.algorithm,
        decision: res.statusCode >= 500 ? 'Error' : 'Accepted',
      });
    });

    next();
  };

  // --- Core Health Route ---
  app.get('/api/health', (_req: Request, res: Response) => {
    const snap = monitor.getSnapshot();
    res.status(snap.apiPaused ? 503 : 200).json({
      status: snap.apiPaused ? 'paused' : 'healthy',
      active_algorithm: snap.activeAlgorithm,
      api_paused: snap.apiPaused,
      uptime_seconds: snap.uptimeSeconds,
      resources: snap.resources,
      timestamp: new Date().toISOString(),
    });
  });

  // --- Protected Business API Endpoints ---
  app.get('/api/products', rateLimitMiddleware, (req: Request, res: Response) => {
    const categoryFilter = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
    const items = categoryFilter
      ? productsStore.filter((p) => p.category.toLowerCase() === categoryFilter)
      : productsStore;
    res.json({ count: items.length, items, timestamp: new Date().toISOString() });
  });

  app.post('/api/products', rateLimitMiddleware, (req: Request, res: Response) => {
    const { name, category, priceUsd, sku, inStock } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: 'Product "name" is required.' });
      return;
    }
    const nextId = productsStore.length > 0 ? Math.max(...productsStore.map((p) => p.id)) + 1 : 1;
    const created: ProductRecord = {
      id: nextId,
      sku: typeof sku === 'string' && sku ? sku : `ARL-${3000 + nextId}`,
      name: name.slice(0, 80),
      category: typeof category === 'string' && category ? category : 'general',
      priceUsd: typeof priceUsd === 'number' && priceUsd >= 0 ? priceUsd : 49.0,
      inStock: typeof inStock === 'boolean' ? inStock : true,
    };
    productsStore.push(created);
    res.status(201).json({ message: 'Product created', item: created });
  });

  app.put('/api/products/:id', rateLimitMiddleware, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const target = productsStore.find((p) => p.id === id);
    if (!target) {
      res.status(404).json({ error: 'Not Found', message: `Product ${req.params.id} not found.` });
      return;
    }
    const { name, priceUsd, inStock, category } = req.body ?? {};
    if (typeof name === 'string' && name.trim()) target.name = name.trim().slice(0, 80);
    if (typeof category === 'string' && category.trim()) target.category = category.trim();
    if (typeof priceUsd === 'number' && priceUsd >= 0) target.priceUsd = priceUsd;
    if (typeof inStock === 'boolean') target.inStock = inStock;
    res.json({ message: 'Product updated', item: target });
  });

  app.delete('/api/products/:id', rateLimitMiddleware, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const idx = productsStore.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Not Found', message: `Product ${req.params.id} not found.` });
      return;
    }
    const [removed] = productsStore.splice(idx, 1);
    res.json({ message: 'Product deleted', item: removed });
  });

  app.get('/api/users', rateLimitMiddleware, (_req: Request, res: Response) => {
    res.json({ count: usersStore.length, items: usersStore, timestamp: new Date().toISOString() });
  });

  app.post('/api/orders', rateLimitMiddleware, (req: Request, res: Response) => {
    const { product_id, quantity } = req.body ?? {};
    if (typeof product_id !== 'number' || typeof quantity !== 'number' || quantity <= 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Valid numeric "product_id" and positive "quantity" are required.',
      });
      return;
    }
    const product = productsStore.find((p) => p.id === product_id);
    if (!product) {
      res.status(404).json({ error: 'Not Found', message: `Product ${product_id} does not exist.` });
      return;
    }
    res.status(201).json({
      order_id: `ORD-${Date.now().toString(36).toUpperCase()}`,
      product_id: product.id,
      product_name: product.name,
      quantity,
      total_usd: Number((product.priceUsd * quantity).toFixed(2)),
      status: 'confirmed',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/simulate-status/:code', rateLimitMiddleware, (req: Request, res: Response) => {
    const code = Number(req.params.code);
    const allowedCodes = [200, 201, 400, 401, 403, 404, 500];
    const finalCode = allowedCodes.includes(code) ? code : 400;
    res.status(finalCode).json({
      simulated_status: finalCode,
      message: `Endpoint returned HTTP ${finalCode} for status monitoring verification.`,
    });
  });

  // --- Monitoring Endpoints (Always Live) ---
  app.get('/api/monitoring/snapshot', (_req: Request, res: Response) => {
    res.json({
      snapshot: monitor.getSnapshot(),
      config: limiter.getConfig(),
      loadTest: loadRunner.getProgress(),
      comparison: loadRunner.getComparisonState(),
    });
  });

  app.get('/api/monitoring/sliding-window', (req: Request, res: Response) => {
    const userId = typeof req.query.userId === 'string' && req.query.userId.trim()
      ? req.query.userId.trim()
      : undefined;
    res.json(limiter.getSlidingWindowSnapshot(userId));
  });

  // --- Protected Admin Control Endpoints ---
  app.post('/api/admin/pause', requireAdmin, (_req: Request, res: Response) => {
    monitor.setApiPaused(true);
    res.json({ apiPaused: true, message: 'API request processing paused (HTTP 503 active).' });
  });

  app.post('/api/admin/resume', requireAdmin, (_req: Request, res: Response) => {
    monitor.setApiPaused(false);
    res.json({ apiPaused: false, message: 'API request processing resumed.' });
  });

  app.post('/api/admin/clear-dashboard', requireAdmin, (_req: Request, res: Response) => {
    monitor.clearDashboardData();
    res.json({
      cleared: true,
      message: 'Dashboard metrics and logs cleared; active rate-limit state preserved.',
    });
  });

  app.post('/api/admin/reset-experiment', requireAdmin, (_req: Request, res: Response) => {
    loadRunner.stopLoadTest('Experiment reset by operator');
    monitor.resetExperimentMetrics();
    res.json({ reset: true, message: 'Experiment metrics reset for a new test run.' });
  });

  app.post('/api/admin/reset-security', requireAdmin, (_req: Request, res: Response) => {
    limiter.resetEnforcementState();
    res.json({ reset: true, message: 'Active rate-limit counters and windows cleared.' });
  });

  app.post('/api/admin/algorithm', requireAdmin, (req: Request, res: Response) => {
    const algo = req.body?.algorithm as RateLimitAlgorithm;
    if (!VALID_ALGORITHMS.has(algo)) {
      res.status(400).json({ error: 'Invalid algorithm specified.' });
      return;
    }
    limiter.updateConfig({ activeAlgorithm: algo });
    res.json({ activeAlgorithm: algo, config: limiter.getConfig() });
  });

  app.post('/api/admin/config', requireAdmin, (req: Request, res: Response) => {
    const patch = req.body ?? {};
    const sanitized: Partial<RateLimitConfig> = {};
    const numField = (k: keyof RateLimitConfig, min: number, max: number) => {
      if (typeof patch[k] === 'number' && Number.isFinite(patch[k])) {
        (sanitized as Record<string, number>)[k] = Math.max(min, Math.min(max, patch[k]));
      }
    };
    numField('fixedWindowLimit', 1, 500);
    numField('fixedWindowSeconds', 1, 300);
    numField('tokenBucketCapacity', 1, 500);
    numField('tokenBucketRefillRate', 0.1, 100);
    numField('slidingWindowLimit', 1, 500);
    numField('slidingWindowSeconds', 1, 300);
    numField('adaptiveBaseLimit', 2, 500);
    numField('adaptiveMinLimit', 1, 200);
    numField('adaptiveMaxLimit', 5, 1000);
    numField('adaptiveAlpha', 0, 3);
    numField('adaptiveBeta', 0, 3);
    numField('adaptiveGamma', 0, 3);
    numField('normalRpsThreshold', 1, 500);
    numField('criticalRpsThreshold', 5, 1000);

    limiter.updateConfig(sanitized);
    res.json({ config: limiter.getConfig() });
  });

  // --- Load Test & Comparison Endpoints ---
  app.get('/api/load-test/status', (_req: Request, res: Response) => {
    res.json(loadRunner.getProgress());
  });

  app.post('/api/load-test/start', async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const config: LoadTestConfig = {
        totalRequests: Number(body.totalRequests ?? 150),
        virtualUsers: Number(body.virtualUsers ?? 8),
        targetRps: Number(body.targetRps ?? 30),
        durationSeconds: Number(body.durationSeconds ?? 15),
        algorithm: VALID_ALGORITHMS.has(body.algorithm)
          ? body.algorithm
          : limiter.getConfig().activeAlgorithm,
        userCategory: parseCategory(body.userCategory),
        scenario: (body.scenario as TrafficScenario) ?? 'normal',
        endpoint: typeof body.endpoint === 'string' && body.endpoint.startsWith('/api/')
          ? body.endpoint
          : '/api/products',
        method: body.method === 'POST' ? 'POST' : 'GET',
      };
      const progress = await loadRunner.startLoadTest(config);
      res.json(progress);
    } catch (err) {
      res.status(409).json({
        error: 'Conflict',
        message: err instanceof Error ? err.message : 'Unable to start load test.',
      });
    }
  });

  app.post('/api/load-test/stop', (_req: Request, res: Response) => {
    const progress = loadRunner.stopLoadTest('Stopped via dashboard control');
    res.json(progress);
  });

  app.get('/api/comparison/status', (_req: Request, res: Response) => {
    res.json(loadRunner.getComparisonState());
  });

  app.post('/api/comparison/start', async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const algorithms = Array.isArray(body.algorithms)
        ? body.algorithms.filter((a: RateLimitAlgorithm) => VALID_ALGORITHMS.has(a))
        : (['fixed_window', 'token_bucket', 'sliding_window', 'adaptive'] as RateLimitAlgorithm[]);

      const state = await loadRunner.startComparison({
        algorithms,
        totalRequests: Number(body.totalRequests ?? 120),
        virtualUsers: Number(body.virtualUsers ?? 8),
        targetRps: Number(body.targetRps ?? 45),
        scenario: (body.scenario as TrafficScenario) ?? 'distributed_abuse',
        endpoint: typeof body.endpoint === 'string' && body.endpoint.startsWith('/api/')
          ? body.endpoint
          : '/api/products',
      });
      res.json(state);
    } catch (err) {
      res.status(409).json({
        error: 'Conflict',
        message: err instanceof Error ? err.message : 'Unable to start comparison.',
      });
    }
  });

  // --- Vite / Static Frontend Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Adaptive Rate Limiter full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

void bootstrap();

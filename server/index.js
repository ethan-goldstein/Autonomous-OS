/**
 * Autonomous OS: the orchestrator process.
 *
 * Serves the dashboard, the REST surface, and the SSE stream. Binds to loopback
 * by default; exposing it is left to whatever private network you put in front.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agents, agentById, startSchedulers } from './registry.js';
import { addClient } from './sse.js';
import {
  getRuns, getLatestRun, getLogsForRun, saveChat, getChat,
  saveMemory, seedMemory, getMemory, fleetTelemetry,
} from './db.js';
import {
  getApprovals, approvalCounts, approve, reject,
  approvalSettings, setApprovalSetting,
} from './lib/approvals.js';
import { checkLLM, chatMessages } from './lib/llm.js';
import {
  passcodeConfigured, issueSession, verifySession, readCookie,
  setSessionCookie, clearSessionCookie, rateLimited, recordFailure,
  clearFailures, checkPasscode, requireAuth,
} from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

/* ── Auth gate ────────────────────────────────────────────────────────────
 * Mounted BEFORE any route is declared. A route added below this line cannot
 * ship unauthenticated by omission, which is the entire point: security by
 * construction rather than by remembering.
 *
 * There is deliberately no localhost bypass. TLS terminates on this same host
 * and proxies to loopback, so exempting 127.0.0.1 would silently disable auth
 * for every device on the private network. Do not add one.
 * ------------------------------------------------------------------------ */
const AUTH_PUBLIC = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me']);
app.use((req, res, next) => {
  if (AUTH_PUBLIC.has(req.path)) return next();
  // Allowlist by PREFIX, not per route. A new /api endpoint added later is
  // guarded by default rather than by remembering to guard it.
  const guarded = req.path.startsWith('/api/') || req.path === '/events';
  if (!guarded) return next(); // app shell, manifest, service worker, icons
  return requireAuth(req, res, next);
});

app.get('/api/auth/me', (req, res) => {
  res.json({ configured: passcodeConfigured(), authed: !!verifySession(readCookie(req)) });
});

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'local';
  if (rateLimited(ip)) return res.status(429).json({ error: 'too many attempts' });
  if (!checkPasscode(String(req.body?.passcode ?? ''))) {
    recordFailure(ip);
    return res.status(401).json({ error: 'bad passcode' });
  }
  clearFailures(ip);
  setSessionCookie(req, res, issueSession());
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

/* ── Realtime ─────────────────────────────────────────────────────────────── */
app.get('/events', (req, res) => addClient(res));

/* ── Fleet ────────────────────────────────────────────────────────────────── */
app.get('/api/status', async (_req, res) => {
  res.json({ llm: await checkLLM(), uptimeMs: Math.round(process.uptime() * 1000) });
});

app.get('/api/fleet/telemetry', (_req, res) => res.json(fleetTelemetry()));

app.get('/api/agents', (_req, res) => {
  res.json(agents.map((a) => ({ ...a.toJSON(), latest: getLatestRun(a.id) })));
});

app.get('/api/agents/:id', (req, res) => {
  const a = agentById.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'no such agent' });
  res.json({ ...a.toJSON(), latest: getLatestRun(a.id), runs: getRuns(a.id) });
});

app.post('/api/agents/:id/run', (req, res) => {
  const a = agentById.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'no such agent' });
  a.run({ trigger: 'manual' }).catch((e) => console.error(a.id, e));
  res.json({ ok: true });
});

app.get('/api/runs/:runId/logs', (req, res) => res.json(getLogsForRun(Number(req.params.runId))));

/* ── Approval queue: the single egress path ───────────────────────────────── */
app.get('/api/approvals', (req, res) => {
  res.json({ items: getApprovals({ status: req.query.status || null }), counts: approvalCounts() });
});
app.post('/api/approvals/:id/approve', async (req, res) => res.json(await approve(Number(req.params.id))));
app.post('/api/approvals/:id/reject', (req, res) => res.json(reject(Number(req.params.id))));
app.get('/api/approvals/settings', (_req, res) => res.json(approvalSettings()));
app.post('/api/approvals/settings', (req, res) => {
  try {
    setApprovalSetting(req.body?.lane, !!req.body?.enabled);
    res.json(approvalSettings());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ── Operator chat ────────────────────────────────────────────────────────── */
app.get('/api/chat', (_req, res) => res.json(getChat()));
app.post('/api/chat', async (req, res) => {
  const msg = String(req.body?.message ?? '').slice(0, 4000);
  if (!msg) return res.status(400).json({ error: 'empty message' });
  saveChat('user', msg);
  const reply = await chatMessages([
    { role: 'system', content: `Known facts:\n${getMemory(40).map((m) => `- ${m.fact}`).join('\n')}` },
    ...getChat(20).map((m) => ({ role: m.role, content: m.content })),
  ]);
  saveChat('assistant', reply);
  res.json({ reply });
});

app.get('/api/memory', (_req, res) => res.json(getMemory()));
app.post('/api/memory', (req, res) => {
  saveMemory(String(req.body?.fact ?? '').slice(0, 500), 'operator');
  res.json({ ok: true });
});

/* ── Dashboard ────────────────────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, '..', 'web', 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html')));

const PORT = Number(process.env.SERVER_PORT || 8787);
const BIND = process.env.BIND_ADDR || '127.0.0.1';

seedMemory(['The fleet runs unattended and reports through the dashboard.']);

app.listen(PORT, BIND, () => {
  console.log(`\n  Autonomous OS`);
  console.log(`  listening  http://${BIND}:${PORT}`);
  startSchedulers();
});

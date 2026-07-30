/**
 * Persistence for the fleet.
 *
 * Node's built-in `node:sqlite`, deliberately: no ORM, no native build step,
 * no migration tooling to maintain. Six tables is not a problem that needs
 * Prisma.
 *
 * Two settings here were not chosen up front. WAL journaling and the 5-second
 * busy timeout were both added after concurrent writes from overlapping agent
 * runs started failing at boot. The default rollback journal takes a write lock
 * across the whole database, so a scheduled agent writing logs while another
 * finished a run would collide. WAL lets readers and one writer proceed
 * together; the busy timeout absorbs the rest.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'fleet.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL,
    result_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    agent_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_run ON logs(run_id);
  CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);

  CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact TEXT NOT NULL UNIQUE,
    source TEXT,
    ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    lane TEXT NOT NULL,
    agent_id TEXT,
    title TEXT NOT NULL,
    summary TEXT,
    payload TEXT,
    ref_table TEXT,
    ref_id INTEGER,
    risk TEXT NOT NULL,
    status TEXT NOT NULL,
    error_msg TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    posted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_appr_status ON approvals(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_appr_ref ON approvals(ref_table, ref_id);
`);

/* ------------------------------- kv ------------------------------------- */
export function getKV(key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setKV(key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

/* ------------------------------ runs + logs ------------------------------ */
export function saveRun(run) {
  const info = db.prepare(
    'INSERT INTO runs (agent_id, started_at, finished_at, status, result_json) VALUES (?, ?, ?, ?, ?)'
  ).run(run.agentId, run.startedAt, run.finishedAt ?? null, run.status, JSON.stringify(run.result ?? null));
  return Number(info.lastInsertRowid);
}

export function saveLog(entry, runId = null) {
  db.prepare('INSERT INTO logs (run_id, agent_id, ts, level, message) VALUES (?, ?, ?, ?, ?)')
    .run(runId, entry.agentId, entry.ts, entry.level, entry.message);
}

const hydrate = (r) => r && ({
  id: r.id, agentId: r.agent_id, startedAt: r.started_at,
  finishedAt: r.finished_at, status: r.status,
  result: r.result_json ? JSON.parse(r.result_json) : null,
});

export function getRuns(agentId, limit = 20) {
  return db.prepare('SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(agentId, limit).map(hydrate);
}
export function getLatestRun(agentId) {
  return hydrate(db.prepare('SELECT * FROM runs WHERE agent_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1')
    .get(agentId, 'done'));
}
export function getLatestAnyRun(agentId) {
  return hydrate(db.prepare('SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1').get(agentId));
}
export function getLogsForRun(runId) {
  return db.prepare('SELECT agent_id AS agentId, ts, level, message FROM logs WHERE run_id = ? ORDER BY id').all(runId);
}

/* -------------------------------- chat ---------------------------------- */
export function saveChat(role, content) {
  db.prepare('INSERT INTO chat (role, content, ts) VALUES (?, ?, ?)').run(role, content, Date.now());
}
export function getChat(limit = 50) {
  return db.prepare('SELECT role, content, ts FROM chat ORDER BY id DESC LIMIT ?').all(limit).reverse();
}

/* ------------------------------- memory ---------------------------------
 * Deduplicated on `fact` so a re-learned fact is a no-op rather than a
 * duplicate row. This is what keeps the memory table from growing without
 * bound as agents re-observe the same things.
 * ------------------------------------------------------------------------ */
export function saveMemory(fact, source = null) {
  db.prepare('INSERT INTO memory (fact, source, ts) VALUES (?, ?, ?) ON CONFLICT(fact) DO NOTHING')
    .run(fact, source, Date.now());
}
export function seedMemory(facts = []) { facts.forEach((f) => saveMemory(f, 'seed')); }
export function getMemory(limit = 200) {
  return db.prepare('SELECT fact, source, ts FROM memory ORDER BY id DESC LIMIT ?').all(limit);
}

/* ------------------------------ approvals -------------------------------- */
export function insertApproval(a) {
  const info = db.prepare(`INSERT INTO approvals
    (kind, lane, agent_id, title, summary, payload, ref_table, ref_id, risk, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.kind, a.lane, a.agent_id, a.title, a.summary, a.payload,
         a.ref_table, a.ref_id, a.risk, a.status, Date.now());
  return Number(info.lastInsertRowid);
}
export function getApproval(id) {
  return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
}
export function getApprovals({ status = null, limit = 100 } = {}) {
  return status
    ? db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?').all(limit);
}
export function getPendingApprovalByRef(refTable, refId) {
  return db.prepare("SELECT * FROM approvals WHERE ref_table = ? AND ref_id = ? AND status = 'pending'")
    .get(refTable, refId);
}
export function approvalCounts() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM approvals GROUP BY status').all();
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
export function setApprovalStatus(id, status, extra = {}) {
  db.prepare('UPDATE approvals SET status = ?, decided_at = COALESCE(?, decided_at), posted_at = COALESCE(?, posted_at), error_msg = COALESCE(?, error_msg) WHERE id = ?')
    .run(status, extra.decided_at ?? null, extra.posted_at ?? null, extra.error_msg ?? null, id);
}

/* ------------------------------ telemetry -------------------------------- */
export function fleetTelemetry() {
  const since = Date.now() - 24 * 3600_000;
  const tempo = db.prepare(`
    SELECT CAST(strftime('%H', started_at / 1000, 'unixepoch') AS INTEGER) AS h,
           SUM(status = 'done') AS ok, SUM(status = 'error') AS err
    FROM runs WHERE started_at > ? GROUP BY h ORDER BY h`).all(since);

  const byAgent = db.prepare(`
    SELECT agent_id AS id, COUNT(*) AS runs,
           SUM(status = 'done') AS ok, SUM(status = 'error') AS err,
           CAST(AVG(finished_at - started_at) AS INTEGER) AS avgMs
    FROM runs WHERE started_at > ? AND finished_at IS NOT NULL
    GROUP BY agent_id ORDER BY avgMs DESC`).all(since);

  const traffic = db.prepare(`
    SELECT CAST((? - ts) / 60000 AS INTEGER) AS m,
           SUM(level = 'info') AS info, SUM(level = 'warn') AS warn, SUM(level = 'error') AS error
    FROM logs WHERE ts > ? GROUP BY m ORDER BY m DESC LIMIT 60`).all(Date.now(), Date.now() - 3600_000);

  const t = db.prepare(`
    SELECT COUNT(*) AS runs24h, SUM(status = 'done') AS ok24h, SUM(status = 'error') AS err24h,
           CAST(AVG(finished_at - started_at) AS INTEGER) AS avgMs
    FROM runs WHERE started_at > ?`).get(since);

  const runs24h = t?.runs24h ?? 0;
  return {
    tempo, byAgent, traffic,
    approvals: approvalCounts(),
    totals: {
      runs24h, ok24h: t?.ok24h ?? 0, err24h: t?.err24h ?? 0,
      avgMs: t?.avgMs ?? 0,
      successPct: runs24h ? Math.round(((t.ok24h ?? 0) / runs24h) * 100) : 100,
    },
  };
}

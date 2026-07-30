// Headless Claude Code client — the premium "brain" that runs on the owner's
// Claude subscription via the local `claude` CLI (no API key, no extra cost).
// Same rule as ollama.js: every call goes out with the security guardrails,
// injected here via --append-system-prompt so agents can't bypass them.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withGuardrails } from './guardrails.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path required: the launchd service does not have ~/.local/bin on PATH.
export const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
export const CLAUDE_ENABLED = process.env.CLAUDE_ENABLED !== '0';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 120000);

// Neutral cwd so headless runs never ingest a project CLAUDE.md as context.
const SCRATCH_DIR = path.join(__dirname, '..', 'data', 'claude-scratch');
mkdirSync(SCRATCH_DIR, { recursive: true });

let availableCache = null; // { ok, at }
let probeInFlight = null;
const OK_TTL_MS = 5 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000; // recover fast after a bad probe

/** Cached probe: is the claude CLI installed and runnable? A cold start of
 *  the CLI can take >10s, so the timeout is generous and probes coalesce. */
export function claudeAvailable() {
  if (!CLAUDE_ENABLED) return Promise.resolve(false);
  if (availableCache && Date.now() - availableCache.at < (availableCache.ok ? OK_TTL_MS : FAIL_TTL_MS)) {
    return Promise.resolve(availableCache.ok);
  }
  if (probeInFlight) return probeInFlight;
  probeInFlight = new Promise((resolve) => {
    execFile(CLAUDE_BIN, ['--version'], { timeout: 20000 }, (err) => {
      availableCache = { ok: !err, at: Date.now() };
      probeInFlight = null;
      resolve(!err);
    });
  });
  return probeInFlight;
}

// The fleet chains agents; don't fork a pile of Claude processes on a laptop.
const MAX_CONCURRENT = 2;
let running = 0;
const waiters = [];
function acquire() {
  if (running < MAX_CONCURRENT) { running += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve));
}
function release() {
  running -= 1;
  const next = waiters.shift();
  if (next) { running += 1; next(); }
}

/**
 * One-shot prompt through `claude -p`. Returns the result text.
 * Throws on non-zero exit, error envelope, unparsable output, or timeout.
 */
export async function claudeChat({ system, prompt, json = false, timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
  const userPrompt = json
    ? `${prompt}\n\nRespond with STRICT JSON only — a single JSON object, no prose, no markdown fences.`
    : prompt;
  const args = [
    '-p',
    '--output-format', 'json',
    '--max-turns', '1',
    '--model', CLAUDE_MODEL,
    '--strict-mcp-config',
    '--append-system-prompt', withGuardrails(system),
  ];
  await acquire();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(CLAUDE_BIN, args, { cwd: SCRATCH_DIR, env: process.env });
      let out = '';
      let errOut = '';
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        child.kill('SIGKILL');
        reject(new Error(`claude timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { errOut += d; });
      child.on('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Even on exit 1 the CLI emits a JSON envelope whose .result explains
        // the failure (e.g. expired OAuth login) — surface that, not just a code.
        let envelope = null;
        try { envelope = JSON.parse(out); } catch { /* no envelope */ }
        if (envelope) {
          if (envelope.is_error || code !== 0) {
            return reject(new Error(`claude error: ${String(envelope.result ?? `exit ${code}`).slice(0, 300)}`));
          }
          return resolve(envelope.result ?? '');
        }
        reject(new Error(code !== 0
          ? `claude exited ${code}: ${errOut.slice(0, 300)}`
          : `claude returned unparsable output: ${out.slice(0, 200)}`));
      });
      // Prompt via stdin — keeps large prompts clear of ARG_MAX.
      child.stdin.write(userPrompt);
      child.stdin.end();
    });
  } finally {
    release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-user authentication for the dashboard.
//
// Until now every route was open and the server bound 0.0.0.0, so anyone on the
// same WiFi could read the CRM, trigger agents, approve queued actions and POST
// any outbound route to act as the operator. This closes that, and is
// what makes it safe to reach the app from a phone.
//
// ── DO NOT ADD A LOCALHOST BYPASS ───────────────────────────────────────────
// It looks harmless to skip auth for 127.0.0.1 so the Mac itself doesn't need
// to log in. It is not: `tailscale serve` terminates TLS on this machine and
// proxies to loopback, so EVERY request from the phone also arrives as
// 127.0.0.1. A localhost exemption silently disables authentication for the
// entire tailnet. There is deliberately no local bypass anywhere in this file.
//
// No dependencies — node:crypto only. Sessions are stateless signed cookies, so
// nothing to store and they survive restarts.
import crypto from 'node:crypto';
import { getKV, setKV } from '../db.js';

const COOKIE = 'dp_session';
// How long a login lasts. Short by default: this dashboard can send mail and
// spend money, so "remember me for a month" was the wrong trade. Tune with
// SESSION_HOURS in .env if you want fewer prompts.
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);
const MAX_AGE_MS = SESSION_HOURS * 3600e3;
const RATE_MAX = 5;                  // failed logins…
const RATE_WINDOW_MS = 15 * 60e3;    // …per window

/**
 * HMAC key, generated once and persisted in the kv table so sessions outlive a
 * restart. The passcode's own hash is folded in, so changing the passcode
 * invalidates every session that was issued under the old one.
 */
function signingKey() {
  let secret = getKV('auth:secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setKV('auth:secret', secret);
  }
  const pass = process.env.DASHBOARD_PASSCODE || '';
  return crypto.createHash('sha256').update(secret + '|' + pass).digest();
}

const sign = (payload) => crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');

/** Constant-time string compare that tolerates length differences. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function passcodeConfigured() {
  return !!(process.env.DASHBOARD_PASSCODE || '').trim();
}

export function issueSession() {
  const exp = Date.now() + MAX_AGE_MS;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const payload = `${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const exp = Number(payload.split('.')[0]);
  return Number.isFinite(exp) && Date.now() < exp;
}

/** Minimal cookie parser — avoids pulling in cookie-parser for one header. */
export function readCookie(req, name = COOKIE) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setSessionCookie(req, res, token) {
  // Secure only over real HTTPS — Tailscale Serve terminates TLS and sets
  // x-forwarded-proto. Marking Secure on plain http://127.0.0.1 would make the
  // browser drop the cookie and lock you out locally.
  const https = req.headers['x-forwarded-proto'] === 'https' || req.secure;
  // NO Max-Age on purpose — this is a session cookie, so closing the browser
  // (or swiping the app away on the phone) drops it and you get asked again.
  // The signed token also carries a hard SESSION_HOURS expiry, so a webview
  // that never really "closes" still can't stay logged in indefinitely.
  res.setHeader('Set-Cookie', [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    https ? 'Secure' : null,
  ].filter(Boolean).join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ── Login rate limiting ─────────────────────────────────────────────────────
// Keyed by IP, but note every tailnet request arrives from 127.0.0.1 (see the
// header comment), so in practice this is a global lockout. Fine for one user.
const attempts = new Map();

export function rateLimited(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { attempts.delete(ip); return false; }
  return rec.count >= RATE_MAX;
}

export function recordFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + RATE_WINDOW_MS });
  } else {
    rec.count++;
  }
}

export function clearFailures(ip) { attempts.delete(ip); }

export function checkPasscode(candidate) {
  const real = (process.env.DASHBOARD_PASSCODE || '').trim();
  if (!real) return false;
  return safeEqual(String(candidate || '').trim(), real);
}

/**
 * Guards every protected route. Anything not explicitly public requires a valid
 * session — including requests from loopback.
 */
export function requireAuth(req, res, next) {
  if (verifySession(readCookie(req))) return next();
  res.status(401).json({ error: 'unauthorized' });
}

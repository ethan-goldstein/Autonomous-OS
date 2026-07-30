import { useEffect, useState } from 'react';

// Wraps the whole dashboard. Nothing inside mounts until the session is
// confirmed — which matters because <App> opens an EventSource and starts
// polling on mount, and those would 401-loop against the auth gate.
//
// Also installs a fetch interceptor so an expired session anywhere in the app
// drops straight back to the passcode screen instead of silently showing stale
// or empty panels.

type State = 'checking' | 'locked' | 'open';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>('checking');
  const [configured, setConfigured] = useState(true);
  const [passcode, setPasscode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Always ask for the passcode when the app opens ────────────────────────
  // Relying on cookie lifetime doesn't work: Safari (and an installed PWA's
  // webview) restore session cookies when they reopen, so "session cookie" is
  // not the same as "asks again". So don't infer — every fresh load of the app
  // explicitly ends the server session first, then shows the lock screen.
  // Navigating inside the app doesn't remount this, so it only fires on a real
  // open/refresh.
  useEffect(() => {
    let alive = true;
    (async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* offline */ }
      try {
        const r = await fetch('/api/auth/me').then((x) => x.json());
        if (alive) setConfigured(r.configured !== false);
      } catch { /* ignore */ }
      if (alive) setState('locked');
    })();
    return () => { alive = false; };
  }, []);

  // On a phone, iOS often keeps the webview alive when you switch apps, so
  // coming back isn't a fresh load. Re-lock if it was backgrounded for a while.
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        setState('locked');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Any 401 from our own API means the session died — re-lock.
  useEffect(() => {
    const orig = window.fetch;
    window.fetch = async (...args) => {
      const res = await orig(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
        if (res.status === 401 && new URL(url, location.origin).pathname.startsWith('/api/')) {
          setState('locked');
        }
      } catch { /* non-URL input — ignore */ }
      return res;
    };
    return () => { window.fetch = orig; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Login failed.');
      setPasscode('');
      setState('open');
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  if (state === 'checking') {
    return <div className="lockscreen"><div className="lock-box"><div className="lock-title">◉ AUTHENTICATING</div></div></div>;
  }
  if (state === 'open') return <>{children}</>;

  return (
    <div className="lockscreen">
      <form className="lock-box" onSubmit={submit}>
        <div className="lock-title">▚ CLASSIFIED // NOFORN</div>
        <div className="lock-sub">Autonomous OS</div>
        {!configured ? (
          <div className="lock-err">
            DASHBOARD_PASSCODE is not set in .env — the dashboard cannot be unlocked
            until it is. Add it and restart the orchestrator.
          </div>
        ) : (
          <>
            <input
              className="lock-input"
              type="password"
              inputMode="text"
              autoComplete="current-password"
              placeholder="PASSCODE"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
            />
            <button className="lock-btn" type="submit" disabled={busy || !passcode}>
              {busy ? 'VERIFYING…' : 'UNLOCK'}
            </button>
            {err && <div className="lock-err">{err}</div>}
          </>
        )}
      </form>
    </div>
  );
}

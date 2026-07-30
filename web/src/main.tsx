import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import { DemoBanner } from './components/DemoBanner';
import { installMockServer } from './demo/mockServer';
import './theme.css';
import './ops-theme.css';

// Public demo build (GitHub Pages): stand up a fake backend and skip the
// passcode gate, since there is no server and nothing real to protect.
// Static import, not dynamic: the shim has to be installed synchronously before
// React mounts, or the first fetches race it. Vite replaces import.meta.env at
// build time, so the non-demo build evaluates `if (false)` and tree-shakes this
// module out entirely.
const DEMO = import.meta.env.VITE_DEMO === '1';
if (DEMO) installMockServer();

// Register the service worker so the app installs to the home screen and
// launches instantly. Only in production — in dev it would serve a stale shell
// over Vite's HMR. Failure is non-fatal; the app works fine without it.
if ('serviceWorker' in navigator && import.meta.env.PROD && !DEMO) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// If anything throws during render, show the error instead of a blank page.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 30, color: '#ff5d73', fontFamily: 'monospace', maxWidth: 800, margin: '40px auto' }}>
          <h2 style={{ color: '#3df0ff' }}>Autonomous OS — render error</h2>
          <p>Something threw while rendering. This is usually a cached old page — try a hard refresh (⌘⇧R).</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(255,93,115,0.1)', padding: 14, borderRadius: 8 }}>
            {String(this.state.err?.stack || this.state.err)}
          </pre>
          <button onClick={() => location.reload()} style={{ padding: '8px 16px', cursor: 'pointer' }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {DEMO ? (
        <>
          <DemoBanner />
          <App />
        </>
      ) : (
        <AuthGate>
          <App />
        </AuthGate>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);

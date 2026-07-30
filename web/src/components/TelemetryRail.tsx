import { useEffect, useState } from 'react';
import type { Telemetry } from '../types';

// Hand-rolled SVG in the spirit of MiniChart.tsx — dependency-free, viewBox +
// width="100%", no chart library. Every panel is black with a hairline green
// border; color is signal (green ok, red fault, white live).
const G = '#2bff88';
const R = '#ff2d3f';
const W = '#e9f0ea';
const DIM = '#0d5f34';
const GREY = '#4a5750';

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/** 24 hourly buckets of runs, error count stacked on top in red. */
function OpsTempo({ t }: { t: Telemetry }) {
  const bars = t.tempo;
  const max = Math.max(1, ...bars.map((b) => b.ok + b.err));
  const bw = 100 / bars.length;
  return (
    <svg viewBox="0 0 100 42" width="100%" height="72" preserveAspectRatio="none">
      <line x1="0" y1="36" x2="100" y2="36" stroke={DIM} strokeWidth="0.3" />
      {bars.map((b, i) => {
        const okH = (b.ok / max) * 34;
        const errH = (b.err / max) * 34;
        const x = i * bw + bw * 0.15;
        const w = bw * 0.7;
        return (
          <g key={i}>
            <rect x={x} y={36 - okH} width={w} height={Math.max(okH, b.ok ? 0.6 : 0)} fill={G} opacity="0.75" />
            {errH > 0 && <rect x={x} y={36 - okH - errH} width={w} height={Math.max(errH, 0.8)} fill={R} />}
          </g>
        );
      })}
      <text x="0" y="41" fontSize="3" fill={GREY} fontFamily="var(--mono)">-24H</text>
      <text x="100" y="41" fontSize="3" fill={GREY} fontFamily="var(--mono)" textAnchor="end">NOW</text>
    </svg>
  );
}

/** Big success percentage over a stacked ok/error bar. */
function SuccessRatio({ t }: { t: Telemetry }) {
  const { successPct, ok24h, err24h, runs24h } = t.totals;
  const okW = runs24h ? (ok24h / runs24h) * 100 : 100;
  const bad = successPct < 90;
  return (
    <div className="tr-body">
      <div className="tr-big" style={{ color: bad ? R : G }}>
        {successPct}<span className="tr-unit">%</span>
      </div>
      <svg viewBox="0 0 100 6" width="100%" height="10" preserveAspectRatio="none">
        <rect x="0" y="0" width="100" height="6" fill={R} opacity={err24h ? 0.85 : 0.15} />
        <rect x="0" y="0" width={okW} height="6" fill={G} opacity="0.8" />
      </svg>
      <div className="tr-legend">
        <span style={{ color: G }}>OK {ok24h}</span>
        <span style={{ color: err24h ? R : GREY }}>ERR {err24h}</span>
      </div>
    </div>
  );
}

/** Per-agent run volume, longest bar first, with mean duration alongside. */
function AgentLoad({ t }: { t: Telemetry }) {
  const rows = t.byAgent.slice(0, 6);
  const max = Math.max(1, ...rows.map((r) => r.runs));
  if (!rows.length) return <div className="tr-empty">NO RUNS LOGGED</div>;
  return (
    <div className="tr-body">
      {rows.map((r) => (
        <div className="tr-row" key={r.id}>
          <span className="tr-row-k">{r.id.toUpperCase()}</span>
          <span className="tr-bar">
            <i style={{ width: `${(r.runs / max) * 100}%`, background: r.err ? R : G }} />
          </span>
          <span className="tr-row-v">{fmtMs(r.avgMs)}</span>
        </div>
      ))}
    </div>
  );
}

/** 60 minutes of log throughput as a filled area, errors marked underneath. */
function SignalTraffic({ t }: { t: Telemetry }) {
  const pts = t.traffic;
  const max = Math.max(1, ...pts.map((p) => p.info + p.warn + p.error));
  const step = 100 / (pts.length - 1);
  const line = pts
    .map((p, i) => `${(i * step).toFixed(2)},${(34 - ((p.info + p.warn + p.error) / max) * 32).toFixed(2)}`)
    .join(' ');
  const total = pts.reduce((s, p) => s + p.info + p.warn + p.error, 0);
  return (
    <div className="tr-body">
      <svg viewBox="0 0 100 40" width="100%" height="68" preserveAspectRatio="none">
        <polyline points={`0,34 ${line} 100,34`} fill={G} opacity="0.14" />
        <polyline points={line} fill="none" stroke={G} strokeWidth="0.6" />
        {pts.map((p, i) =>
          p.error ? <rect key={i} x={i * step - 0.4} y="35" width="0.8" height="4" fill={R} /> : null
        )}
        <line x1="0" y1="34" x2="100" y2="34" stroke={DIM} strokeWidth="0.3" />
      </svg>
      <div className="tr-legend">
        <span style={{ color: GREY }}>60M WINDOW</span>
        <span style={{ color: W }}>{total} LINES</span>
      </div>
    </div>
  );
}

/** Approval queue by disposition. */
function QueueDepth({ t }: { t: Telemetry }) {
  const a = t.approvals || {};
  const rows: [string, number, string][] = [
    ['PENDING', a.pending ?? 0, a.pending ? R : GREY],
    ['POSTED', (a.posted ?? 0) + (a.auto_posted ?? 0), G],
    ['REJECTED', a.rejected ?? 0, GREY],
    ['FAULT', a.error ?? 0, a.error ? R : GREY],
  ];
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="tr-body">
      {rows.map(([k, v, c]) => (
        <div className="tr-row" key={k}>
          <span className="tr-row-k">{k}</span>
          <span className="tr-bar">
            <i style={{ width: `${(v / max) * 100}%`, background: c }} />
          </span>
          <span className="tr-row-v" style={{ color: c }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Mean run duration per agent, slowest first — where the time actually goes. */
function Latency({ t }: { t: Telemetry }) {
  const rows = t.byAgent.filter((r) => r.avgMs > 0).sort((x, y) => y.avgMs - x.avgMs).slice(0, 6);
  if (!rows.length) return <div className="tr-empty">NO TIMING DATA</div>;
  const max = Math.max(1, ...rows.map((r) => r.avgMs));
  return (
    <div className="tr-body">
      <div className="tr-legend" style={{ marginBottom: 4 }}>
        <span style={{ color: GREY }}>MEAN EXEC</span>
        <span style={{ color: W }}>FLEET {fmtMs(t.totals.avgMs)}</span>
      </div>
      {rows.map((r) => (
        <div className="tr-row" key={r.id}>
          <span className="tr-row-k">{r.id.toUpperCase()}</span>
          <span className="tr-bar">
            <i style={{ width: `${(r.avgMs / max) * 100}%`, background: r.avgMs > 30000 ? R : G }} />
          </span>
          <span className="tr-row-v">{fmtMs(r.avgMs)}</span>
        </div>
      ))}
    </div>
  );
}

const DECK = [
  { key: 'OPS TEMPO', render: (t: Telemetry) => <OpsTempo t={t} /> },
  { key: 'SUCCESS RATIO', render: (t: Telemetry) => <SuccessRatio t={t} /> },
  { key: 'AGENT LOAD', render: (t: Telemetry) => <AgentLoad t={t} /> },
  { key: 'SIGNAL TRAFFIC', render: (t: Telemetry) => <SignalTraffic t={t} /> },
  { key: 'QUEUE DEPTH', render: (t: Telemetry) => <QueueDepth t={t} /> },
  { key: 'EXEC LATENCY', render: (t: Telemetry) => <Latency t={t} /> },
];

/**
 * One panel cycling through the deck. `offset` staggers which chart each panel
 * starts on and `phase` staggers WHEN it flips, so the three panels never turn
 * over together.
 */
function Panel({ t, offset, phase }: { t: Telemetry; offset: number; phase: number }) {
  const [i, setI] = useState(offset);
  const [wipe, setWipe] = useState(false);

  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | undefined;
    let wipeT: ReturnType<typeof setTimeout> | undefined;
    // Step by 1 so every panel eventually shows every chart; the fixed offsets
    // (0/2/4) keep the three panels on distinct cards at all times.
    const advance = () => {
      setWipe(true);
      setI((n) => (n + 1) % DECK.length);
      wipeT = setTimeout(() => setWipe(false), 320);
    };
    const start = setTimeout(() => {
      advance();
      iv = setInterval(advance, 9000);
    }, phase);
    return () => { clearTimeout(start); if (wipeT) clearTimeout(wipeT); if (iv) clearInterval(iv); };
  }, [phase]);

  const idx = i % DECK.length;
  const card = DECK[idx];
  return (
    <div className={`tr-panel ${wipe ? 'wiping' : ''}`}>
      <div className="tr-head">
        <span className="tr-title">{card.key}</span>
        <span className="tr-idx">{String(idx + 1).padStart(2, '0')}/{DECK.length}</span>
      </div>
      {card.render(t)}
    </div>
  );
}

/**
 * The left instrument rail. Three panels, each rotating through six real-data
 * charts on a staggered timer.
 */
export function TelemetryRail({ telemetry }: { telemetry: Telemetry | null }) {
  if (!telemetry) {
    return (
      <div className="tel-rail">
        <div className="tr-panel">
          <div className="tr-head"><span className="tr-title">TELEMETRY</span></div>
          <div className="tr-empty">NO SIGNAL — UPLINK DOWN</div>
        </div>
      </div>
    );
  }
  return (
    <div className="tel-rail">
      <Panel t={telemetry} offset={0} phase={0} />
      <Panel t={telemetry} offset={2} phase={3000} />
      <Panel t={telemetry} offset={4} phase={6000} />
    </div>
  );
}

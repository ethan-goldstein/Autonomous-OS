/**
 * Demo-only replacement for AgentPage.
 *
 * The real agent view renders what each agent actually did, which is not
 * something to publish. In the demo build the roster is anonymised to numbered
 * units and this panel stands in: it shows the shape of the system (schedule,
 * uptime, guardrails, egress policy) without disclosing any workflow.
 */
import { useEffect, useState } from 'react';
import type { Agent, LogEntry } from '../types';

const REDACTED = '█';

/** Deterministic per-agent values so the panel is stable across renders. */
function seeded(id: string, lo: number, hi: number, salt = 1) {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return lo + (h % (hi - lo + 1));
}

function block(n: number) {
  return REDACTED.repeat(n);
}

export function ClassifiedAgentPage({
  agent,
  logs,
  onBack,
}: {
  agent: Agent;
  logs: LogEntry[];
  onBack: () => void;
}) {
  const [scan, setScan] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setScan((s) => (s + 1) % 100), 90);
    return () => clearInterval(t);
  }, []);

  const clearance = seeded(agent.id, 3, 5);
  const runs = seeded(agent.id, 180, 900, 7);
  const uptime = (99 + seeded(agent.id, 0, 9, 13) / 10).toFixed(1);

  const rows: [string, string][] = [
    ['Designation', agent.name],
    ['Function', `CLASSIFIED // ${block(seeded(agent.id, 8, 16, 3))}`],
    ['Schedule', agent.schedule ?? 'EVENT-CHAINED'],
    ['Runs (30d)', String(runs)],
    ['Uptime', `${uptime}%`],
    ['Data sources', `${block(seeded(agent.id, 6, 12, 5))} · ${block(seeded(agent.id, 4, 9, 11))}`],
    ['Output channel', `SEALED · approval queue`],
  ];

  return (
    <div style={S.wrap}>
      <button className="ghost-btn" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        &larr; NEXUS
      </button>

      <div style={S.panel}>
        <div style={{ ...S.scanline, top: `${scan}%` }} aria-hidden="true" />

        <header style={S.head}>
          <div style={S.stamp}>RESTRICTED</div>
          <h1 style={S.title}>Private Automation Workflow</h1>
          <p style={S.sub}>
            Operational detail for this unit is withheld from the public demo.
          </p>
        </header>

        <div style={S.sealRow}>
          <div style={S.seal}>
            <div style={S.sealInner}>
              <span style={S.sealNum}>{agent.name.replace(/[^0-9]/g, '') || '00'}</span>
              <span style={S.sealLbl}>UNIT</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <table style={S.table}>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td style={S.k}>{k}</td>
                    <td style={S.v}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={S.grid}>
          <Fact label="Clearance" value={`L${clearance}`} note="required to view workflow" />
          <Fact label="Guardrails" value="ACTIVE" note="injection defense on every call" tone="ok" />
          <Fact label="Egress" value="GATED" note="human approval before any action" tone="ok" />
          <Fact label="Autonomy" value="SUPERVISED" note="no unilateral outbound" />
        </div>

        <section>
          <div style={S.secHead}>Signal log</div>
          <div style={S.term}>
            {(logs.length ? logs.slice(-7) : PLACEHOLDER).map((l, i) => (
              <div key={i} style={S.line}>
                <span style={S.ts}>
                  {new Date('ts' in l ? l.ts : Date.now()).toISOString().slice(11, 19)}
                </span>
                <span style={S.lvl}>{('level' in l ? l.level : 'info').toUpperCase()}</span>
                <span style={S.msg}>{block(seeded(agent.id, 22, 44, i + 2))}</span>
              </div>
            ))}
          </div>
          <p style={S.foot}>
            Message bodies are redacted in the public build. The full pipeline, its data
            sources, and its outputs run only on private infrastructure.
          </p>
        </section>
      </div>
    </div>
  );
}

const PLACEHOLDER = Array.from({ length: 7 }, () => ({ ts: Date.now(), level: 'info' as const }));

function Fact({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'ok' }) {
  return (
    <div style={S.fact}>
      <div style={S.factLabel}>{label}</div>
      <div style={{ ...S.factValue, color: tone === 'ok' ? '#4ade80' : '#3df0ff' }}>{value}</div>
      <div style={S.factNote}>{note}</div>
    </div>
  );
}

const mono = "'Share Tech Mono', ui-monospace, monospace";

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 14, padding: '10px 4px 70px' },
  panel: {
    position: 'relative', overflow: 'hidden',
    border: '1px solid rgba(61,240,255,0.28)', borderRadius: 14,
    background: 'linear-gradient(160deg, rgba(8,14,20,0.96), rgba(4,8,12,0.99))',
    boxShadow: '0 0 60px -20px rgba(61,240,255,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
    padding: 'clamp(18px, 3vw, 34px)', display: 'flex', flexDirection: 'column', gap: 26,
  },
  scanline: {
    position: 'absolute', left: 0, right: 0, height: 2, pointerEvents: 'none',
    background: 'linear-gradient(90deg, transparent, rgba(61,240,255,0.5), transparent)',
  },
  head: { display: 'flex', flexDirection: 'column', gap: 8 },
  stamp: {
    alignSelf: 'flex-start', font: `11px/1 ${mono}`, letterSpacing: '0.32em',
    color: '#ff5d73', border: '1px solid rgba(255,93,115,0.55)', padding: '5px 10px',
    borderRadius: 3, transform: 'rotate(-1.5deg)',
  },
  title: {
    font: `700 clamp(24px, 4vw, 40px)/1.05 'Orbitron', ${mono}`,
    color: '#eaffff', letterSpacing: '0.02em', margin: 0, textTransform: 'uppercase',
  },
  sub: { font: `13px/1.6 ${mono}`, color: '#7fa6b3', margin: 0, maxWidth: 620 },
  sealRow: { display: 'flex', gap: 26, alignItems: 'center', flexWrap: 'wrap' },
  seal: {
    width: 120, height: 120, flex: '0 0 auto', borderRadius: '50%',
    border: '2px dashed rgba(61,240,255,0.45)', display: 'grid', placeItems: 'center',
    background: 'radial-gradient(circle, rgba(61,240,255,0.12), transparent 70%)',
  },
  sealInner: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  sealNum: { font: `700 34px/1 'Orbitron', ${mono}`, color: '#3df0ff' },
  sealLbl: { font: `10px/1 ${mono}`, letterSpacing: '0.3em', color: '#5d7f8a' },
  table: { width: '100%', borderCollapse: 'collapse', font: `13px/1.9 ${mono}` },
  k: { color: '#5d7f8a', textTransform: 'uppercase', letterSpacing: '0.12em', paddingRight: 18, whiteSpace: 'nowrap', verticalAlign: 'top' },
  v: { color: '#cfeff7', width: '100%' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 },
  fact: {
    border: '1px solid rgba(61,240,255,0.16)', borderRadius: 9, padding: '12px 14px',
    background: 'rgba(61,240,255,0.04)',
  },
  factLabel: { font: `10px/1 ${mono}`, letterSpacing: '0.22em', color: '#5d7f8a', textTransform: 'uppercase' },
  factValue: { font: `700 20px/1.4 'Orbitron', ${mono}` },
  factNote: { font: `11px/1.45 ${mono}`, color: '#6d8f9c' },
  secHead: {
    font: `11px/1 ${mono}`, letterSpacing: '0.26em', color: '#5d7f8a',
    textTransform: 'uppercase', marginBottom: 8,
  },
  term: {
    border: '1px solid rgba(61,240,255,0.16)', borderRadius: 9, padding: 14,
    background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 5,
  },
  line: { display: 'flex', gap: 12, alignItems: 'baseline', font: `12px/1.5 ${mono}` },
  ts: { color: '#3d5b66', flex: '0 0 auto' },
  lvl: { color: '#3df0ff', flex: '0 0 auto', letterSpacing: '0.1em' },
  msg: { color: 'rgba(61,240,255,0.35)', letterSpacing: '0.06em', overflow: 'hidden', whiteSpace: 'nowrap' },
  foot: { font: `11.5px/1.6 ${mono}`, color: '#5d7f8a', marginTop: 10, maxWidth: 620 },
};

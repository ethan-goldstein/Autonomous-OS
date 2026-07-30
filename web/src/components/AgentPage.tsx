/**
 * Generic agent detail view.
 *
 * The framework makes no assumption about what an agent returns, so this
 * renders the run envelope (status, timing, trigger) plus whatever JSON the
 * agent produced. Build a bespoke view per agent if you want one; nothing here
 * requires it.
 */
import type { Agent, LogEntry } from '../types';

const mono = "'Share Tech Mono', ui-monospace, monospace";

export function AgentPage({
  agent, logs, onRun, onBack,
}: { agent: Agent; logs: LogEntry[]; onRun: () => void; onBack: () => void }) {
  const run = agent.latest;
  const took = run?.finishedAt && run?.startedAt
    ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s` : '--';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '10px 4px 70px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="ghost-btn" onClick={onBack}>&larr; NEXUS</button>
        <button className="ghost-btn" onClick={onRun}>RUN NOW</button>
      </div>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ font: `700 clamp(22px,4vw,34px)/1.1 'Orbitron', ${mono}`, color: '#eaffff', margin: 0 }}>
          {agent.icon} {agent.name}
        </h1>
        <p style={{ font: `13px/1.6 ${mono}`, color: '#7fa6b3', margin: 0 }}>{agent.description}</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        <Stat label="Status" value={agent.status.toUpperCase()} />
        <Stat label="Schedule" value={agent.schedule ?? 'CHAINED'} />
        <Stat label="Last run" value={agent.lastRunAt ? new Date(agent.lastRunAt).toLocaleTimeString() : '--'} />
        <Stat label="Duration" value={took} />
      </div>

      <Section title="Result">
        <pre style={{
          margin: 0, font: `12px/1.6 ${mono}`, color: '#cfeff7',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto',
        }}>
          {run?.result ? JSON.stringify(run.result, null, 2) : 'No run yet.'}
        </pre>
      </Section>

      <Section title="Activity">
        {logs.length === 0 ? (
          <div style={{ font: `12px/1.6 ${mono}`, color: '#5d7f8a' }}>No activity this session.</div>
        ) : logs.slice(-40).map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, font: `12px/1.55 ${mono}` }}>
            <span style={{ color: '#3d5b66', flex: '0 0 auto' }}>
              {new Date(l.ts).toISOString().slice(11, 19)}
            </span>
            <span style={{ color: LEVEL[l.level] ?? '#3df0ff', flex: '0 0 auto' }}>{l.level.toUpperCase()}</span>
            <span style={{ color: '#cfeff7' }}>{l.message}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

const LEVEL: Record<string, string> = {
  info: '#3df0ff', success: '#4ade80', warn: '#fbbf24', error: '#ff5d73',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid rgba(61,240,255,0.16)', borderRadius: 9, padding: '10px 13px', background: 'rgba(61,240,255,0.04)' }}>
      <div style={{ font: `10px/1 ${mono}`, letterSpacing: '0.22em', color: '#5d7f8a', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ font: `700 17px/1.5 'Orbitron', ${mono}`, color: '#3df0ff' }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ font: `11px/1 ${mono}`, letterSpacing: '0.26em', color: '#5d7f8a', textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ border: '1px solid rgba(61,240,255,0.16)', borderRadius: 9, padding: 14, background: 'rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
      </div>
    </section>
  );
}

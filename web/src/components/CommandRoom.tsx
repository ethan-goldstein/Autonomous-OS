import { AgentAvatar } from './AgentAvatar';
import type { Agent, LogEntry, AgentStatus } from '../types';

interface Props {
  agents: Agent[];
  logs: LogEntry[];
  onRun: (id: string) => void;
  onOpen: (view: string) => void;
  onBack: () => void;
}

// Pull a one-line "idea"/highlight out of each agent's latest result.
function ideasFrom(agents: Agent[]): string[] {
  const out: string[] = [];
  for (const a of agents) {
    const r = a.latest?.result;
    if (!r) continue;
    if (a.id === 'finance' && typeof r.net === 'number') {
      out.push(`Finance: net ${r.net >= 0 ? '+' : ''}$${Math.abs(r.net).toLocaleString()} this month${r.net < 0 ? ' — spending exceeds income' : ''}.`);
    }
    if (a.id === 'sourcing' && r.picks?.[0]) {
      out.push(`Sourcing: hottest find is "${r.picks[0].product}" (momentum ${r.picks[0].momentum}).`);
    }
    if (a.id === 'email' && r.all) {
      const n = r.all.filter((m: any) => m.importance >= 4).length;
      out.push(`Email: ${n} message(s) need attention out of ${r.totalFetched} scanned.`);
    }
  }
  return out;
}

export function CommandRoom({ agents, logs, onRun, onOpen, onBack }: Props) {
  const working = agents.filter((a) => a.status === 'working');
  const anyError = agents.some((a) => a.status === 'error');
  const coreStatus: AgentStatus = anyError ? 'error' : working.length ? 'working' : 'idle';

  // Anomalies: agents currently in error + recent error log lines.
  const errored = agents.filter((a) => a.status === 'error');
  const errorLogs = logs.filter((l) => l.level === 'error').slice(-4);
  const ideas = ideasFrom(agents);

  return (
    <div className="command">
      <div className="ops-file-strip">
        <span className="ops-typed">{'// FLEET COMMAND · core os · ALL CHANNELS MONITORED'}</span>
        <span className="ops-blink">● SECURE</span>
      </div>
      <div className="ap-head">
        <button className="ghost-btn" onClick={onBack}>← NEXUS</button>
        <div className="ap-id">
          <AgentAvatar icon="core" status={coreStatus} size={58} />
          <div>
            <h2 className="command-title">core os · COMMAND</h2>
            <div className="ap-role">
              Overseer ·{' '}
              <span className={`status-text s-${coreStatus}`}>
                {coreStatus === 'error' ? 'ALERT' : coreStatus === 'working' ? 'OVERSEEING' : 'ACTIVE'}
              </span>
            </div>
          </div>
        </div>
        <span className={`pill ${coreStatus}`}>{coreStatus === 'working' ? 'overseeing…' : coreStatus}</span>
      </div>

      <div className="command-boards">
        {/* Status board */}
        <div className="section glass command-board">
          <h4>Fleet Status</h4>
          {agents.map((a) => (
            <div className="board-row" key={a.id}>
              <span className={`dot ${a.status === 'error' ? 'off' : 'on'}`} />
              <span className="board-name" onClick={() => onOpen(a.id)}>{a.name}</span>
              <span className={`pill ${a.status}`}>{a.status === 'working' ? 'working…' : a.status}</span>
              <button className="ghost-btn sm" onClick={() => onRun(a.id)} disabled={a.status === 'working'}>run</button>
            </div>
          ))}
        </div>
      </div>

      {/* Anomalies & Ideas */}
      <div className="section glass">
        <h4>Anomalies &amp; Ideas</h4>
        {errored.length === 0 && errorLogs.length === 0 ? (
          <div className="idea-line ok">✓ No errors detected across the fleet.</div>
        ) : (
          <>
            {errored.map((a) => (
              <div className="idea-line bad" key={a.id}>⚠ {a.name} is in an error state — check its room.</div>
            ))}
            {errorLogs.map((l, i) => (
              <div className="idea-line bad" key={i}>⚠ {l.agentId}: {l.message}</div>
            ))}
          </>
        )}
        {ideas.map((t, i) => (
          <div className="idea-line" key={i}>💡 {t}</div>
        ))}
        {ideas.length === 0 && <div className="idea-line muted">Run the agents to surface insights here.</div>}
      </div>

      {/* Talk to the orchestrator himself */}
      </div>
  );
}

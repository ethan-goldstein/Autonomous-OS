import { useCallback, useEffect, useState } from 'react';
import { HandControl, HandStatus } from './components/HandControl';
import { useAgentStream } from './hooks/useAgentStream';
import { useTelemetry } from './hooks/useTelemetry';
import { NexusView } from './components/NexusView';
import { TelemetryRail } from './components/TelemetryRail';
import { SatWatch } from './components/SatWatch';
import { AgentPage } from './components/AgentPage';
import { ClassifiedAgentPage } from './demo/ClassifiedAgentPage';

// The demo must never render what an agent actually does.
const DEMO = import.meta.env.VITE_DEMO === '1';
import { CommandRoom } from './components/CommandRoom';
import { VoiceControl } from './components/VoiceControl';
import { ApprovalsPanel } from './components/ApprovalsPanel';

// Best-effort device label (browsers hide exact models; GPU string often reveals the Apple chip).
function detectDevice(): string {
  const ua = navigator.userAgent;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const r = dbg && gl ? String(gl.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL)) : '';
    const m = r.match(/Apple M\d\w*/);
    if (m) return 'MAC · ' + m[0].toUpperCase();
  } catch { /* ignore */ }
  if (/iPhone/.test(ua)) return 'IPHONE';
  if (/iPad/.test(ua)) return 'IPAD';
  if (/Android/.test(ua)) return 'ANDROID';
  if (/Macintosh|Mac OS X/.test(ua)) return 'MAC';
  if (/Windows/.test(ua)) return 'WINDOWS';
  if (/Linux/.test(ua)) return 'LINUX';
  return 'DEVICE';
}

function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `UP ${d}d ${h}h`;
  if (h) return `UP ${h}h ${m}m`;
  return `UP ${m}m`;
}

export function App() {
  const { agents, logs, connected, runAgent, pendingApprovals, lastApproval, resultTick } = useAgentStream();
  const telemetry = useTelemetry(resultTick);
  const [view, setView] = useState<string>('nexus'); // 'nexus' | 'core' | 'approvals' | agentId
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [llmProvider, setLlmProvider] = useState<string | null>(null);
  const [serverStart, setServerStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [device] = useState(detectDevice);
  const [battery, setBattery] = useState<{ percent: number; charging: boolean } | null>(null);
  const [handsOn, setHandsOn] = useState(false);
  const [handsStatus, setHandsStatus] = useState<HandStatus>('off');
  const onHandsStatus = useCallback((s: HandStatus) => {
    setHandsStatus(s);
    if (s === 'off') setHandsOn(false); // auto-off (5 min no hand) reverts the toggle
  }, []);

  useEffect(() => {
    const refreshStatus = () =>
      fetch('/api/status')
        .then((r) => r.json())
        .then((s) => {
          setOllamaOk(!!(s.llm?.ok ?? s.ollama?.ok));
          setLlmProvider(s.llm?.provider ?? (s.ollama?.ok ? 'ollama' : null));
          setBattery(s.battery ?? null);
          if (typeof s.uptimeMs === 'number') setServerStart(Date.now() - s.uptimeMs);
        })
        .catch(() => setOllamaOk(false));
    refreshStatus();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const status = setInterval(refreshStatus, 30000); // refresh battery + AI every 30s
    return () => { clearInterval(clock); clearInterval(status); };
  }, []);

  const selected = agents.find((a) => a.id === view);
  const working = agents.filter((a) => a.status === 'working').length;

  return (
    <div className={`shell ${view !== 'nexus' ? 'ops-theme' : ''}`}>
      <div className={`cmdbar ${view === 'nexus' ? 'cmdbar-clear' : ''}`}>
        <div className="cmd-left">
          <span className="cmd-stat class">▚ CLASSIFIED // NOFORN</span>
          <span className={`cmd-stat mob-hide ${ollamaOk ? 'ok' : 'bad'}`}>
            <span className={`dot ${ollamaOk ? 'on' : 'off'}`} />
            LLM {llmProvider === 'claude' ? 'CLAUDE' : llmProvider === 'ollama' ? 'OLLAMA' : 'OFFLINE'}
          </span>
          <span className="cmd-stat mob-hide">FLEET {agents.length || '—'}</span>
          <span className={`cmd-stat ${working ? 'live' : ''}`}>ACTIVE {working}</span>
          <span className={`cmd-stat ${connected ? 'ok' : 'bad'}`}>
            <span className={`dot ${connected ? 'on' : 'off'}`} />
            LINK {connected ? 'UP' : 'DOWN'}
          </span>
          <span
            className={`cmd-stat click ${pendingApprovals > 0 ? 'bad' : ''}`}
            onClick={() => setView('approvals')}
            title="Approval queue"
          >
            ◈ QUEUE {pendingApprovals}
          </span>
        </div>
        <div className="cmd-right">
          <span className="cmd-stat mob-hide">OPS {telemetry ? telemetry.totals.runs24h : '—'}</span>
          <span className={`cmd-stat mob-hide ${telemetry && telemetry.totals.err24h ? 'bad' : ''}`}>
            ERR {telemetry ? telemetry.totals.err24h : '—'}
          </span>
          <span
            className={`cmd-stat click mob-hide ${handsStatus === 'tracking' ? 'ok' : ''}`}
            onClick={() => setHandsOn((v) => !v)}
            title="Hands-free control (webcam gestures, 100% local)"
          >
            <span className={`dot ${handsStatus === 'tracking' ? 'on' : handsOn ? 'mid' : 'off'}`} />
            HAND {handsStatus === 'tracking' ? 'TRK' : handsOn ? 'ACQ' : 'OFF'}
          </span>
          <span className="cmd-stat mob-hide">{device}</span>
          {battery && (
            <span className={`cmd-stat mob-hide ${battery.percent <= 20 ? 'bad' : ''}`}>
              PWR {battery.percent}%{battery.charging ? ' CHG' : ''}
            </span>
          )}
          <span className="cmd-stat mob-hide">{new Date(now).toISOString().slice(0, 10)}</span>
          <span className="cmd-stat clk">{new Date(now).toISOString().slice(11, 19)}Z</span>
          <span className="cmd-stat up mob-hide">{serverStart ? fmtUptime(now - serverStart) : 'UP —'}</span>
          <span
            className="cmd-stat click"
            title="Lock the dashboard — requires the passcode again"
            onClick={() => {
              fetch('/api/auth/logout', { method: 'POST' }).finally(() => location.reload());
            }}
          >
            ⌷ LOCK
          </span>
        </div>
      </div>

      {view === 'nexus' ? (
        <div className="home-stage">
          <NexusView agents={agents} logs={logs} onOpen={setView} pendingApprovals={pendingApprovals} lastApproval={lastApproval} />
          <TelemetryRail telemetry={telemetry} />
          <SatWatch />
        </div>
      ) : (
        <div className="page">
          {view === 'core' ? (
            <CommandRoom agents={agents} logs={logs} onRun={runAgent} onOpen={setView} onBack={() => setView('nexus')} />
          ) : view === 'approvals' ? (
            <ApprovalsPanel lastApproval={lastApproval} onBack={() => setView('nexus')} />
          ) : selected ? (
            DEMO ? (
              <ClassifiedAgentPage
                agent={selected}
                logs={logs.filter((l) => l.agentId === selected.id)}
                onBack={() => setView('nexus')}
              />
            ) : (
              <AgentPage
                agent={selected}
                logs={logs.filter((l) => l.agentId === selected.id)}
                onRun={() => runAgent(selected.id)}
                onBack={() => setView('nexus')}
              />
            )
          ) : (
            // Unknown view (voice control can navigate anywhere, and it can fire
            // before /api/agents resolves). With MISSION CONTROL gone from the
            // bar, this is the only way back — don't render an empty page.
            <button className="ghost-btn" onClick={() => setView('nexus')}>← NEXUS</button>
          )}
        </div>
      )}

      <VoiceControl agents={agents} currentView={view} onNavigate={setView} onRun={runAgent} />
      <HandControl enabled={handsOn} onStatus={onHandsStatus} />
    </div>
  );
}

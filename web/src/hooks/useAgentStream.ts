import { useEffect, useRef, useState, useCallback } from 'react';
import type { Agent, AgentStatus, ApprovalEvent, LogEntry, Run } from '../types';

const MAX_LOGS = 200;

/**
 * Single source of truth for the dashboard: fetches the fleet once, then keeps
 * it live via the server's SSE stream (status flips, log lines, results).
 */
export function useAgentStream() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [lastApproval, setLastApproval] = useState<ApprovalEvent | null>(null);
  // Bumped on every finished run; the telemetry rail keys off this to refetch.
  const [resultTick, setResultTick] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/agents');
    setAgents(await res.json());
  }, []);

  useEffect(() => {
    refresh();
    // Live SSE updates are instant; this periodic refresh keeps everything fresh
    // (last-run times, results) even between events.
    const poll = setInterval(refresh, 15000);
    const es = new EventSource('/events');
    esRef.current = es;

    es.addEventListener('hello', () => setConnected(true));
    es.onerror = () => setConnected(false);

    es.addEventListener('status', (e) => {
      const { agentId, status } = JSON.parse((e as MessageEvent).data) as {
        agentId: string;
        status: AgentStatus;
      };
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, status } : a)));
    });

    es.addEventListener('log', (e) => {
      const entry = JSON.parse((e as MessageEvent).data) as LogEntry;
      setLogs((prev) => [...prev.slice(-(MAX_LOGS - 1)), entry]);
    });

    es.addEventListener('result', (e) => {
      const run = JSON.parse((e as MessageEvent).data) as Run;
      setAgents((prev) =>
        prev.map((a) =>
          a.id === run.agentId
            ? { ...a, status: run.status, lastRunAt: run.finishedAt, latest: run.status === 'done' ? run : a.latest }
            : a
        )
      );
      setResultTick((n) => n + 1);
    });

    es.addEventListener('approval', (e) => {
      const evt = JSON.parse((e as MessageEvent).data) as ApprovalEvent;
      setLastApproval(evt);
      setPendingApprovals(evt.counts?.pending ?? 0);
    });

    // Seed the badge on load (SSE only reports changes after connect).
    fetch('/api/approvals?status=pending')
      .then((r) => r.json())
      .then((d) => setPendingApprovals(d.counts?.pending ?? 0))
      .catch(() => {});

    return () => { es.close(); clearInterval(poll); };
  }, [refresh]);

  const runAgent = useCallback(async (id: string) => {
    await fetch(`/api/agents/${id}/run`, { method: 'POST' });
  }, []);

  return { agents, logs, connected, runAgent, refresh, pendingApprovals, lastApproval, resultTick };
}

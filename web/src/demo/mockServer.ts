/**
 * Demo mode: a fake backend for the public GitHub Pages build.
 *
 * The real dashboard talks to a Node server over `fetch` and an SSE stream.
 * There is no server on Pages, so this installs a shim over `window.fetch` and
 * `window.EventSource` that answers with seeded, obviously-fictional data.
 *
 * Only compiled in when VITE_DEMO=1. The production build never imports it, and
 * nothing here can reach the network: every request is answered locally.
 */
import type { Agent, Approval, LogEntry, Run, Telemetry } from '../types';

const T0 = Date.parse('2026-07-30T18:54:00Z'); // fixed clock so the demo is deterministic
const mins = (n: number) => n * 60_000;

type Seed = { id: string; name: string; description: string; icon: string; schedule: string | null };

const SEED: Seed[] = [
  // Anonymised for the public demo. Real designations and functions are not
  // published; the private system is unaffected.
  { id: 'a00', name: 'Agent 00', description: 'Classified automation unit', icon: '\u25c8', schedule: '*/5 * * * *' },
  { id: 'a01', name: 'Agent 01', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 8 * * *' },
  { id: 'a02', name: 'Agent 02', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 */6 * * *' },
  { id: 'a03', name: 'Agent 03', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 */8 * * *' },
  { id: 'a04', name: 'Agent 04', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 7 * * *' },
  { id: 'a05', name: 'Agent 05', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 */3 * * *' },
  { id: 'a06', name: 'Agent 06', description: 'Classified automation unit', icon: '\u25c8', schedule: null },
  { id: 'a07', name: 'Agent 07', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 */4 * * *' },
  { id: 'a08', name: 'Agent 08', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 9 * * *' },
  { id: 'a09', name: 'Agent 09', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 */12 * * *' },
  { id: 'a10', name: 'Agent 10', description: 'Classified automation unit', icon: '\u25c8', schedule: '0 10,18 * * *' },
];

const RESULTS: Record<string, any> = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => [`a${String(i).padStart(2, '0')}`, { classified: true }])
);

function agents(): Agent[] {
  return SEED.map((s, i) => {
    const finishedAt = T0 - mins(3 + i * 7);
    const latest: Run = {
      id: 100 + i,
      agentId: s.id,
      startedAt: finishedAt - 32_000,
      finishedAt,
      status: 'done',
      result: RESULTS[s.id] ?? {},
    };
    return { ...s, simulated: false, status: 'idle', lastRunAt: finishedAt, latest };
  });
}

const APPROVALS: Approval[] = [
  { id: 41, kind: 'public_post', lane: 'x', agent_id: 'a05', title: 'Outbound item queued for review',
    summary: 'Risky lane. Requires a human tap; no setting can auto-post this.', payload: { text: 'New set is live.' },
    ref_table: null, ref_id: null, risk: 'risky', status: 'pending', error_msg: null,
    created_at: T0 - mins(12), decided_at: null, posted_at: null },
  { id: 40, kind: 'owned_publish', lane: 'owned', agent_id: 'a05', title: 'Publish batch to an owned property',
    summary: 'Safe lane: a property I own. Auto-posted because the toggle is on.', payload: { items: 4 },
    ref_table: null, ref_id: null, risk: 'safe', status: 'auto_posted', error_msg: null,
    created_at: T0 - mins(48), decided_at: T0 - mins(47), posted_at: T0 - mins(47) },
  { id: 39, kind: 'outbound_batch', lane: 'cold_email', agent_id: 'a05', title: 'Outbound batch held for review',
    summary: 'Held for review. Daily cap and MX pre-validation applied before staging.', payload: { count: 9 },
    ref_table: null, ref_id: null, risk: 'risky', status: 'approved', error_msg: null,
    created_at: T0 - mins(90), decided_at: T0 - mins(88), posted_at: null },
];

function telemetry(): Telemetry {
  const rnd = (seed: number, lo: number, hi: number) =>
    lo + Math.floor(Math.abs(Math.sin(seed) * 10_000) % (hi - lo + 1));
  return {
    tempo: Array.from({ length: 24 }, (_, h) => ({ h, ok: rnd(h + 1, 4, 22), err: rnd(h + 91, 0, 1) })),
    byAgent: SEED.map((s, i) => ({
      id: s.id, runs: rnd(i + 3, 12, 48), ok: rnd(i + 3, 12, 47), err: rnd(i + 40, 0, 2),
      avgMs: rnd(i + 7, 6_000, 170_000),
    })),
    traffic: Array.from({ length: 60 }, (_, m) => ({ m, info: rnd(m + 5, 1, 9), warn: rnd(m + 60, 0, 1), error: 0 })),
    approvals: { pending: 1, approved: 1, auto_posted: 1 },
    totals: { runs24h: 340, ok24h: 331, err24h: 9, successPct: 97, avgMs: 32_100 },
  };
}

/** Route table. Anything unmatched falls through to a safe empty response. */
function route(path: string): unknown | undefined {
  if (path.startsWith('/api/auth/me')) return { configured: true, demo: true };
  if (path.startsWith('/api/auth/')) return { ok: true };
  if (path === '/api/agents') return agents();
  if (path.startsWith('/api/agents/')) {
    const id = path.split('/')[3];
    return agents().find((a) => a.id === id) ?? {};
  }
  if (path.startsWith('/api/status'))
    return { llm: { ok: true, provider: 'ollama' }, battery: { level: 1, charging: true }, uptimeMs: mins(966) };
  if (path.startsWith('/api/fleet/telemetry')) return telemetry();
  if (path.startsWith('/api/approvals'))
    return { items: APPROVALS, counts: { pending: 1, approved: 1, auto_posted: 1 } };
  if (path.startsWith('/api/contacts')) return { items: [], note: 'Contact data is not included in the public demo.' };
  if (path.startsWith('/api/chat'))
    return { reply: 'This is the public demo, so I am not wired to a model here. The real fleet runs a headless Claude Code CLI with a local Ollama fallback.' };
  return undefined;
}

const EMPTY_LIST = /\/(insights|gigs|listings|videos|contacts|approvals)(\?|$)/;

export function installMockServer() {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;

    if (!path.startsWith('/api/')) return realFetch(input as RequestInfo, init);

    // Writes are inert in the demo: acknowledge without changing anything.
    if (init?.method && init.method !== 'GET') {
      return json({ ok: true, demo: true, note: 'Read-only demo. No action was taken.' });
    }
    const body = route(path);
    if (body !== undefined) return json(body);
    return json(EMPTY_LIST.test(path) ? { items: [] } : {});
  };

  // SSE: replay a short, looping slice of fleet activity.
  class MockEventSource extends EventTarget {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
    readyState = MockEventSource.OPEN;
    url: string;
    onerror: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onopen: ((e: Event) => void) | null = null;
    private timers: number[] = [];

    constructor(url: string) {
      super();
      this.url = url;
      const emit = (type: string, data: unknown) =>
        this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));

      this.timers.push(window.setTimeout(() => emit('hello', { ok: true, demo: true }), 120));

      const script: [string, LogEntry['level'], string][] = [
        ['a03', 'info',    'unit online, cycle start'],
        ['a03', 'success', 'pre-flight validation passed'],
        ['a00', 'info',    'scheduled sweep complete'],
        ['a05', 'info',    'signal threshold met'],
        ['a06', 'success', 'chained task staged'],
        ['a10', 'warn',    'risky lane: queued for approval, not executed'],
        ['a09', 'success', 'artifact committed'],
        ['a04', 'info',    'fleet nominal, 1 approval pending'],
      ];

      let i = 0;
      const tick = () => {
        const [agentId, level, message] = script[i % script.length];
        emit('log', { agentId, ts: Date.now(), level, message } satisfies LogEntry);
        if (i % 3 === 0) {
          emit('status', { agentId, status: 'working' });
          this.timers.push(window.setTimeout(() => {
            emit('status', { agentId, status: 'idle' });
            emit('result', {
              agentId, startedAt: Date.now() - 4000, finishedAt: Date.now(),
              status: 'done', result: RESULTS[agentId] ?? {},
            } satisfies Run);
          }, 2200));
        }
        i++;
      };
      this.timers.push(window.setInterval(tick, 2600));
    }
    close() {
      this.readyState = MockEventSource.CLOSED;
      this.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      this.timers = [];
    }
    addEventListener(t: string, l: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
      super.addEventListener(t, l, o);
    }
  }
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

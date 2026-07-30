/**
 * The orchestrator: the fleet, its schedule table, and its chaining graph.
 *
 * Adding an agent is one import, one line in `agents`, and nothing else. It
 * inherits scheduling, persistence, live log streaming, error capture, and the
 * catch-up sweep from the shared base class and the wiring below.
 */
import cron from 'node-cron';
import { ScheduledAgent } from './agents/scheduled-agent.js';
import { ChainedAgent } from './agents/chained-agent.js';
import { OutboundAgent } from './agents/outbound-agent.js';
import { saveRun, saveLog, saveMemory, getLatestAnyRun } from './db.js';
import { broadcast } from './sse.js';
import { registerLane } from './lib/approvals.js';
import { chatJSON, checkLLM } from './lib/llm.js';

export const agents = [
  new ScheduledAgent(),
  new ChainedAgent(),
  new OutboundAgent(),
];
export const agentById = new Map(agents.map((a) => [a.id, a]));

/* ─────────────────────────── egress lanes ────────────────────────────────
 * Every outward-facing destination is declared here with its risk class and
 * the handler that performs it. Handlers live at this layer, not inside
 * lib/approvals.js, so the queue stays a pure policy engine that imports no
 * integrations.
 *
 *   safe  = a property the operator owns. autoKey names its opt-in toggle,
 *           which defaults to off.
 *   risky = public, paid, or third-party. Never auto-executes. There is no
 *           toggle, and adding one would not help: laneAutoOn() returns false
 *           for risky lanes before it reads any setting.
 * ------------------------------------------------------------------------ */
registerLane('owned-property', {
  risk: 'safe',
  autoKey: 'autopost:owned',
  handler: async (payload) => {
    // Replace with a real publish call to something you control.
    console.log('[lane:owned-property] publishing', payload);
  },
});

registerLane('public', {
  risk: 'risky',
  handler: async (payload) => {
    // Only ever reached after a human tapped approve.
    console.log('[lane:public] publishing after approval', payload);
  },
});

/* ───────────────────── persistence + live streaming ─────────────────────── */
for (const agent of agents) {
  agent.on('status', (e) => broadcast('status', e));
  agent.on('log', (entry) => broadcast('log', entry));

  agent.on('result', (run) => {
    const runId = saveRun(run);
    for (const entry of agent.logs) saveLog({ ...entry, runId }, runId);
    broadcast('result', { ...run, id: runId });
    if (run.status === 'done') learnFromRun(agent, run.result).catch(() => {});
  });
}

/* ──────────────────────────── event chaining ─────────────────────────────
 * A chained agent has no cron of its own. Sharing the upstream agent's minute
 * would race the single local model, and the catch-up sweep would double-run
 * it. Chaining instead lets it inherit the upstream schedule AND the
 * sleep-proof catch-up transitively.
 * ------------------------------------------------------------------------ */
agentById.get('scheduled').on('result', (run) => {
  if (run.status !== 'done') return;
  const next = agentById.get('chained');
  next.receive(run.result);
  next.run({ trigger: 'chain' }).catch((e) => console.error('chained', e));
});

/* ───────────────────── self-distilling long-term memory ──────────────────
 * After a successful run, ask the model for 0-2 DURABLE facts worth keeping.
 * The point is the constraint: most run output is noise from one afternoon.
 * Writes are deduped on the fact text, so re-learning is a no-op.
 * ------------------------------------------------------------------------ */
async function learnFromRun(agent, result) {
  if (!result) return;
  const out = await chatJSON({
    system:
      'Extract 0 to 2 DURABLE facts from this agent run: things that will still ' +
      'be true next month. Skip anything transient. Reply as JSON: {"facts": string[]}.',
    user: JSON.stringify(result).slice(0, 4000),
    fallback: { facts: [] },
  });
  for (const fact of (out.facts || []).slice(0, 2)) saveMemory(fact, agent.id);
}

/* ───────────────────────────── scheduling ───────────────────────────────── */
export function startSchedulers() {
  for (const agent of agents) {
    if (!agent.schedule) continue;
    cron.schedule(agent.schedule, () => {
      agent.run({ trigger: 'scheduled' }).catch((e) => console.error(agent.id, e));
    });
    console.log(`  scheduled  ${agent.name}: ${agent.schedule}`);
  }
  startCatchUp();
  checkLLM().then((s) => console.log(`  llm        ${s.ok ? s.provider : 'offline'}`));
}

/* ───────────────────────── sleep-proof catch-up ──────────────────────────
 * node-cron only fires if the process is awake at that exact minute. A laptop
 * asleep at 07:00 means no 07:00 run, ever, silently. Every 10 minutes this
 * sweeps the fleet and re-runs anything whose slot was missed.
 *
 * The 45-minute slack matters: without it, catch-up races the real cron slot
 * and you get two runs. An errored run still counts as "ran", so a broken
 * agent is not retried every 10 minutes; it waits for its next real slot.
 * ------------------------------------------------------------------------ */
function scheduleInfo(expr) {
  let m = /^0 (\d{1,2}) \* \* \*$/.exec(expr);        // daily at hour H
  if (m) return { type: 'daily', hour: Number(m[1]) };
  m = /^0 \*\/(\d{1,2}) \* \* \*$/.exec(expr);        // every N hours
  if (m) return { type: 'interval', ms: Number(m[1]) * 3600e3 };
  // every-N-minutes schedules self-heal on the next tick; nothing to catch up.
  return null;
}

function startCatchUp() {
  const SLACK = 45 * 60e3;
  setInterval(() => {
    const now = new Date();
    for (const agent of agents) {
      if (!agent.schedule || agent.status === 'working') continue;
      const info = scheduleInfo(agent.schedule);
      if (!info) continue;
      const last = getLatestAnyRun(agent.id);
      let missed = false;
      if (info.type === 'daily') {
        const slotToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), info.hour).getTime();
        missed = now.getTime() > slotToday + SLACK && (!last || last.startedAt < slotToday);
      } else {
        missed = !last || now.getTime() - last.startedAt > info.ms + SLACK;
      }
      if (missed) {
        console.log(`[catch-up] ${agent.name} missed its slot (machine asleep?), running now.`);
        agent.run({ trigger: 'catch-up' }).catch((e) => console.error(agent.id, e));
      }
    }
  }, 10 * 60e3);
  console.log('  catch-up   every 10 min, replays anything a sleeping machine missed');
}

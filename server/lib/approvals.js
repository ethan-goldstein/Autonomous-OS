/**
 * The approval queue: the ONE code path that can touch the outside world.
 *
 * Agents never act directly. They call requestAction(), which either auto-posts
 * (a `safe` lane the operator has explicitly toggled on, meaning a property
 * they own) or parks the action as a pending card awaiting a single human tap
 * (`risky` lanes: anything public, anything that costs money, anything sent to
 * a third party).
 *
 * The invariant that matters: a `risky` lane can never be auto-approved. There
 * is no setting for it. laneAutoOn() returns false for risky lanes before it
 * consults any toggle, so adding a config flag cannot subvert the rule.
 */
import {
  insertApproval, getApproval, getApprovals, approvalCounts,
  setApprovalStatus, getPendingApprovalByRef, getKV, setKV,
} from '../db.js';
import { broadcast } from '../sse.js';

/**
 * Lane policy. Register a lane here before an agent can emit into it.
 *
 *   safe  = a property the operator owns. May auto-post, but only when its
 *           toggle is explicitly on. Defaults to off.
 *   risky = public, paid, or third-party facing. ALWAYS requires a human tap.
 *
 * Handlers are injected by the host application (see registerLane) so this
 * module never imports an integration and stays a pure policy engine.
 */
const LANES = new Map();

export function registerLane(lane, { risk, handler, autoKey = null }) {
  if (!['safe', 'risky'].includes(risk)) throw new Error(`bad risk for lane ${lane}`);
  if (typeof handler !== 'function') throw new Error(`lane ${lane} needs a handler`);
  LANES.set(lane, { risk, handler, autoKey });
}

export function laneRisk(lane) {
  return LANES.get(lane)?.risk ?? 'risky'; // unknown lanes fail closed
}

/** Is this lane currently allowed to act without a human tap? */
export function laneAutoOn(lane) {
  const cfg = LANES.get(lane);
  if (!cfg) return false;
  // Checked BEFORE any toggle lookup, so no setting can flip a risky lane.
  if (cfg.risk === 'risky') return false;
  if (!cfg.autoKey) return false;
  return getKV(cfg.autoKey) === '1';
}

export function approvalSettings() {
  const out = {};
  for (const [lane, cfg] of LANES) {
    out[lane] = { risk: cfg.risk, autoPost: cfg.risk === 'safe' && laneAutoOn(lane) };
  }
  return out;
}

export function setApprovalSetting(lane, enabled) {
  const cfg = LANES.get(lane);
  if (!cfg) throw new Error('unknown lane');
  if (cfg.risk === 'risky') throw new Error('risky lanes cannot be auto-posted');
  if (!cfg.autoKey) throw new Error('lane has no toggle');
  setKV(cfg.autoKey, enabled ? '1' : '0');
}

/**
 * An agent asks to do something outward-facing. This is the only entry point.
 *
 * Returns the approval row. If the lane auto-posted, its status is already
 * `auto_posted`; otherwise it sits `pending` until a human decides.
 */
export async function requestAction({
  kind, lane, agentId = null, title, summary = null, payload = null,
  refTable = null, refId = null,
}) {
  // Idempotency: don't stack duplicate cards for the same underlying object.
  if (refTable && refId != null) {
    const existing = getPendingApprovalByRef(refTable, refId);
    if (existing) return existing;
  }

  const risk = laneRisk(lane);
  const id = insertApproval({
    kind, lane, agent_id: agentId, title, summary,
    payload: payload ? JSON.stringify(payload) : null,
    ref_table: refTable, ref_id: refId, risk, status: 'pending',
  });

  if (laneAutoOn(lane)) {
    try {
      await LANES.get(lane).handler(payload);
      setApprovalStatus(id, 'auto_posted', { posted_at: Date.now() });
    } catch (err) {
      setApprovalStatus(id, 'error', { error_msg: String(err.message || err) });
    }
  }

  const item = getApproval(id);
  broadcast('approval', { type: 'created', item, counts: approvalCounts() });
  return item;
}

/** A human tapped approve. Executes the lane handler, then records the result. */
export async function approve(id) {
  const item = getApproval(id);
  if (!item) throw new Error('no such approval');
  if (item.status !== 'pending') return item;

  const cfg = LANES.get(item.lane);
  if (!cfg) throw new Error(`lane ${item.lane} is not registered`);

  setApprovalStatus(id, 'approved', { decided_at: Date.now() });
  try {
    await cfg.handler(item.payload ? JSON.parse(item.payload) : null);
    setApprovalStatus(id, 'posted', { posted_at: Date.now() });
  } catch (err) {
    setApprovalStatus(id, 'error', { error_msg: String(err.message || err) });
  }

  const out = getApproval(id);
  broadcast('approval', { type: 'decided', item: out, counts: approvalCounts() });
  return out;
}

export function reject(id) {
  setApprovalStatus(id, 'rejected', { decided_at: Date.now() });
  const item = getApproval(id);
  broadcast('approval', { type: 'decided', item, counts: approvalCounts() });
  return item;
}

export { getApprovals, approvalCounts };

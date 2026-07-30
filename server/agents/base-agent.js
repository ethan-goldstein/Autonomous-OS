import { EventEmitter } from 'node:events';

// Small helper so simulated agents can "think" visibly in the live log.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Base class every agent extends.
 *
 * The whole "watch them work" experience flows from here: a subclass calls
 * this.log(...) as it works, and setStatus(...) flips its state. Those emit
 * events that the orchestrator persists to SQLite AND streams to the dashboard
 * over SSE. To add a brand-new agent: extend this class, implement execute(),
 * and register it in registry.js. Nothing else has to change.
 */
export class Agent extends EventEmitter {
  constructor({ id, name, role, description, icon, schedule, simulated = false }) {
    super();
    this.id = id;
    this.name = name;
    this.role = role || '';
    this.description = description;
    this.icon = icon;
    this.schedule = schedule; // cron expression, or null for manual-only
    this.simulated = simulated;
    this.status = 'idle'; // idle | working | done | error
    this.lastRunAt = null;
    this.logs = []; // logs for the current/most-recent run
  }

  log(message, level = 'info') {
    const entry = { agentId: this.id, ts: Date.now(), level, message };
    this.logs.push(entry);
    this.emit('log', entry);
    return entry;
  }

  setStatus(status) {
    this.status = status;
    this.emit('status', { agentId: this.id, status, ts: Date.now() });
  }

  /** Run the agent once. Guards against overlapping runs. */
  async run({ trigger = 'manual' } = {}) {
    if (this.status === 'working') {
      this.log('A run is already in progress — skipping.', 'warn');
      return null;
    }
    this.logs = [];
    const startedAt = Date.now();
    this.setStatus('working');
    this.log(`${this.name} engaged (${trigger}).`);

    try {
      const result = await this.execute();
      const finishedAt = Date.now();
      this.lastRunAt = finishedAt;
      this.setStatus('done');
      this.log(`Done in ${((finishedAt - startedAt) / 1000).toFixed(1)}s.`, 'success');
      const run = { agentId: this.id, startedAt, finishedAt, status: 'done', result };
      this.emit('result', run);
      return run;
    } catch (err) {
      const finishedAt = Date.now();
      this.lastRunAt = finishedAt;
      this.setStatus('error');
      this.log(`Error: ${err.message}`, 'error');
      const run = { agentId: this.id, startedAt, finishedAt, status: 'error', result: { error: err.message } };
      this.emit('result', run);
      return run;
    }
  }

  /** Subclasses implement the actual work and return a JSON-serializable result. */
  async execute() {
    throw new Error(`${this.id}: execute() not implemented`);
  }

  /** Snapshot for the API. */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      description: this.description,
      icon: this.icon,
      schedule: this.schedule,
      simulated: this.simulated,
      status: this.status,
      lastRunAt: this.lastRunAt,
    };
  }
}

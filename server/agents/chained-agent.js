import { Agent, sleep } from './base-agent.js';

/**
 * EXAMPLE: an event-chained agent.
 *
 * schedule is null, so cron never touches it. registry.js fires it whenever its
 * upstream agent finishes, and hands it that run's result. This is how a
 * research step feeds the step that acts on it without either knowing about the
 * other's internals.
 */
export class ChainedAgent extends Agent {
  constructor() {
    super({
      id: 'chained',
      name: 'Chained Example',
      role: 'Example',
      description: 'Has no schedule. Triggered by the completion of another agent.',
      icon: '◷',
      schedule: null,
    });
    this.upstream = null;
  }

  /** registry.js sets this before invoking a chained run. */
  receive(upstreamResult) {
    this.upstream = upstreamResult;
  }

  async execute() {
    if (!this.upstream) {
      this.log('No upstream result; nothing to do.', 'warn');
      return { skipped: true };
    }
    this.log(`Received ${this.upstream.count ?? 0} items from upstream.`);
    await sleep(250);
    return { processed: this.upstream.count ?? 0, from: 'scheduled' };
  }
}

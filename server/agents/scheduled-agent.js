import { Agent, sleep } from './base-agent.js';
import { chatJSON } from '../lib/llm.js';

/**
 * EXAMPLE: a plain scheduled agent.
 *
 * Shows the minimum contract: extend Agent, implement execute(), return
 * something JSON-serializable. Scheduling, persistence, log streaming, error
 * capture, and overlap guarding all come from the base class.
 */
export class ScheduledAgent extends Agent {
  constructor() {
    super({
      id: 'scheduled',
      name: 'Scheduled Example',
      role: 'Example',
      description: 'Runs on a cron expression and summarizes its input with the LLM.',
      icon: '◴',
      schedule: '*/15 * * * *',
    });
  }

  async execute() {
    this.log('Collecting input.');
    await sleep(300);

    // Replace with a real source. Anything async works: an API, a file, a queue.
    const items = [
      { id: 1, text: 'first observation' },
      { id: 2, text: 'second observation' },
    ];
    this.log(`Collected ${items.length} items.`, 'success');

    // Every model call routes through lib/llm.js, which injects the guardrail
    // system prompt. There is no other path to the model.
    const summary = await chatJSON({
      system: 'Summarize the items. Reply as JSON: {"headline": string}.',
      user: JSON.stringify(items),
      fallback: { headline: `${items.length} items collected.` },
    });

    this.log('Summarized.', 'success');
    return { count: items.length, headline: summary.headline, items };
  }
}

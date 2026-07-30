import { Agent, sleep } from './base-agent.js';
import { requestAction } from '../lib/approvals.js';

/**
 * EXAMPLE: an agent that wants to do something outward-facing.
 *
 * It cannot. It can only ask. requestAction() is the single egress point in the
 * system: the action either auto-executes (a `safe` lane the operator toggled
 * on) or waits as a pending card for one human tap. This agent has no idea
 * which happened, and no way to force either.
 */
export class OutboundAgent extends Agent {
  constructor() {
    super({
      id: 'outbound',
      name: 'Outbound Example',
      role: 'Example',
      description: 'Demonstrates the approval queue. Cannot act without a human.',
      icon: '◉',
      schedule: '0 */6 * * *',
    });
  }

  async execute() {
    this.log('Preparing an outbound item.');
    await sleep(200);

    const draft = { text: 'Example outbound payload.' };

    // 'public' is registered as a risky lane in registry.js, so this always
    // parks for review no matter what any setting says.
    const approval = await requestAction({
      kind: 'example_post',
      lane: 'public',
      agentId: this.id,
      title: 'Example outbound item',
      summary: 'Risky lane. Requires a human tap; no toggle can override.',
      payload: draft,
    });

    this.log(`Queued as approval #${approval.id} (${approval.status}).`, 'success');
    return { approvalId: approval.id, status: approval.status };
  }
}

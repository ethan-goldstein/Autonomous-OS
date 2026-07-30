export type AgentStatus = 'idle' | 'working' | 'done' | 'error';

export interface Run {
  id?: number;
  agentId: string;
  startedAt: number;
  finishedAt: number | null;
  status: AgentStatus;
  result: any;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  icon: string;
  schedule: string | null;
  simulated: boolean;
  status: AgentStatus;
  lastRunAt: number | null;
  latest?: Run | null;
}

export interface LogEntry {
  agentId: string;
  ts: number;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'posted' | 'auto_posted' | 'rejected' | 'error';

export interface Approval {
  id: number;
  kind: 'public_post' | 'owned_post' | 'owned_publish' | 'outbound_batch' | 'listing_publish' | 'service_draft';
  lane: string;
  agent_id: string | null;
  title: string;
  summary: string | null;
  payload: any;
  ref_table: string | null;
  ref_id: number | null;
  risk: 'safe' | 'risky';
  status: ApprovalStatus;
  error_msg: string | null;
  created_at: number;
  decided_at: number | null;
  posted_at: number | null;
}

export interface Telemetry {
  tempo: { h: number; ok: number; err: number }[];
  byAgent: { id: string; runs: number; ok: number; err: number; avgMs: number }[];
  traffic: { m: number; info: number; warn: number; error: number }[];
  approvals: Record<string, number>;
  totals: { runs24h: number; ok24h: number; err24h: number; successPct: number; avgMs: number };
}

export interface ApprovalEvent {
  type: 'created' | 'decided';
  item: Approval;
  counts: Record<string, number>;
}

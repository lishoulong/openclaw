export type TeamId = string;
export type TeamRunId = string;
export type TeamTaskId = string;
export type TeamMailboxId = string;
export type TeamEventId = string;

export type TeamMember = {
  agentId: string;
  /** 可选：展示名/职责等。Phase 1 MVP 不做强约束。 */
  label?: string;
};

export type TeamConfig = {
  teamId: TeamId;
  name: string;
  members: TeamMember[];
  createdAtMs: number;
  updatedAtMs: number;
};

export const TEAM_RUN_STATUSES = ["running", "completed", "canceled", "failed"] as const;
export type TeamRunStatus = (typeof TEAM_RUN_STATUSES)[number];

export type TeamRun = {
  runId: TeamRunId;
  teamId: TeamId;
  status: TeamRunStatus;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  canceledAtMs?: number;
  error?: string;
};

export const TEAM_TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "canceled",
  "failed",
] as const;
export type TeamTaskStatus = (typeof TEAM_TASK_STATUSES)[number];

export type TeamTask = {
  taskId: TeamTaskId;
  runId: TeamRunId;
  idx: number;
  label?: string;
  prompt: string;
  assignedAgentId: string;
  status: TeamTaskStatus;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  childRunId?: string;
  childSessionKey?: string;
  resultText?: string;
  error?: string;
};

export type TeamMailboxDirection = "in" | "out";

export type TeamMailboxMessage = {
  mailboxId: TeamMailboxId;
  runId: TeamRunId;
  taskId?: TeamTaskId;
  direction: TeamMailboxDirection;
  message: string;
  createdAtMs: number;
};

export type TeamEvent = {
  eventId: TeamEventId;
  runId?: TeamRunId;
  taskId?: TeamTaskId;
  type: string;
  tsMs: number;
  payload?: Record<string, unknown> | null;
};

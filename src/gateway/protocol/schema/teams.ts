import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const TeamMemberSchema = Type.Object(
  {
    agentId: NonEmptyString,
    label: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TeamConfigSchema = Type.Object(
  {
    teamId: NonEmptyString,
    name: NonEmptyString,
    members: Type.Array(TeamMemberSchema),
    createdAtMs: Type.Integer({ minimum: 0 }),
    updatedAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TeamRunSchema = Type.Object(
  {
    runId: NonEmptyString,
    teamId: NonEmptyString,
    status: Type.String({ enum: ["running", "completed", "canceled", "failed"] }),
    createdAtMs: Type.Integer({ minimum: 0 }),
    startedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    endedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    canceledAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TeamTaskSchema = Type.Object(
  {
    taskId: NonEmptyString,
    runId: NonEmptyString,
    idx: Type.Integer({ minimum: 0 }),
    label: Type.Optional(Type.String()),
    prompt: NonEmptyString,
    assignedAgentId: NonEmptyString,
    status: Type.String({ enum: ["pending", "running", "completed", "canceled", "failed"] }),
    createdAtMs: Type.Integer({ minimum: 0 }),
    startedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    endedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    childRunId: Type.Optional(Type.String()),
    childSessionKey: Type.Optional(Type.String()),
    resultText: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TeamsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const TeamsListResultSchema = Type.Object(
  {
    teams: Type.Array(TeamConfigSchema),
  },
  { additionalProperties: false },
);

export const TeamsGetParamsSchema = Type.Object(
  {
    teamId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TeamsGetResultSchema = Type.Object(
  {
    team: TeamConfigSchema,
  },
  { additionalProperties: false },
);

export const TeamsRunTaskInputSchema = Type.Object(
  {
    prompt: NonEmptyString,
    label: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TeamsRunParamsSchema = Type.Object(
  {
    teamId: NonEmptyString,
    tasks: Type.Array(TeamsRunTaskInputSchema, { minItems: 1, maxItems: 100 }),
    runId: Type.Optional(Type.String()),
    requesterSessionKey: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TeamsRunResultSchema = Type.Object(
  {
    run: TeamRunSchema,
    tasks: Type.Array(TeamTaskSchema),
  },
  { additionalProperties: false },
);

export const TeamsRunGetParamsSchema = Type.Object(
  {
    runId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TeamsRunGetResultSchema = Type.Object(
  {
    run: TeamRunSchema,
    tasks: Type.Array(TeamTaskSchema),
  },
  { additionalProperties: false },
);

export const TeamsRunCancelParamsSchema = Type.Object(
  {
    runId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TeamsRunCancelResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    run: Type.Optional(TeamRunSchema),
    canceledTasks: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TeamsTasksListParamsSchema = Type.Object(
  {
    runId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TeamsTasksListResultSchema = Type.Object(
  {
    runId: NonEmptyString,
    tasks: Type.Array(TeamTaskSchema),
  },
  { additionalProperties: false },
);

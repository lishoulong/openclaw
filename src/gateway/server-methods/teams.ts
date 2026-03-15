import { randomUUID } from "node:crypto";
import { listAgentIds } from "../../agents/agent-scope.js";
import { spawnSubagentDirect } from "../../agents/subagent-spawn.js";
import { loadConfig } from "../../config/config.js";
import { resolveMainSessionKey } from "../../config/sessions/main-session.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { TeamDb } from "../../teams/team-db.js";
import { getTeamDb } from "../../teams/team-runtime.js";
import type { TeamConfig, TeamTask } from "../../teams/types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateTeamsGetParams,
  validateTeamsListParams,
  validateTeamsRunCancelParams,
  validateTeamsRunGetParams,
  validateTeamsRunParams,
  validateTeamsTasksListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const teamDb = getTeamDb();

function ensureDefaultTeamExists(db: TeamDb): TeamConfig {
  const existing = db.getTeam("default");
  if (existing) {
    return existing;
  }
  const cfg = loadConfig();
  const members = listAgentIds(cfg).map((agentId) => ({ agentId }));
  return db.upsertTeam({ teamId: "default", name: "Default Team", members });
}

function resolveKnownTeamOrRespond(params: {
  db: TeamDb;
  teamId: string;
  respond: RespondFn;
}): TeamConfig | null {
  // Ensure "default" exists so fresh installs have a usable team.
  ensureDefaultTeamExists(params.db);

  const id = params.teamId.trim();
  if (!id) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "teamId is required"));
    return null;
  }
  const team = params.db.getTeam(id);
  if (!team) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `team not found: ${id}`),
    );
    return null;
  }
  return team;
}

function normalizeTaskInputs(params: {
  team: TeamConfig;
  tasks: Array<{ prompt: string; label?: string; agentId?: string }>;
}): Array<{ idx: number; label?: string; prompt: string; assignedAgentId: string }> {
  const cfg = loadConfig();
  const knownAgents = new Set(listAgentIds(cfg).map((id) => normalizeAgentId(id)));
  const teamAgents = params.team.members
    .map((m) => normalizeAgentId(m.agentId))
    .filter((agentId) => knownAgents.has(agentId));
  if (teamAgents.length === 0) {
    throw new Error("team has no configured agent members");
  }

  return params.tasks.map((t, idx) => {
    const prompt = t.prompt.trim();
    if (!prompt) {
      throw new Error(`task[${idx}].prompt is required`);
    }
    const label = typeof t.label === "string" && t.label.trim() ? t.label.trim() : undefined;
    const requested = typeof t.agentId === "string" && t.agentId.trim() ? t.agentId.trim() : "";
    const assignedAgentId = requested
      ? normalizeAgentId(requested)
      : teamAgents[idx % teamAgents.length];
    if (!teamAgents.includes(assignedAgentId)) {
      throw new Error(`task[${idx}].agentId is not a member of team ${params.team.teamId}`);
    }
    return {
      idx,
      ...(label ? { label } : {}),
      prompt,
      assignedAgentId,
    };
  });
}

async function spawnTaskAndRecord(params: {
  db: TeamDb;
  requesterSessionKey: string;
  task: TeamTask;
}): Promise<void> {
  const spawn = await spawnSubagentDirect(
    {
      task: params.task.prompt,
      label: params.task.label,
      agentId: params.task.assignedAgentId,
      // Team runs are orchestration-level; don't spam completion messages into sessions.
      expectsCompletionMessage: false,
    },
    {
      agentSessionKey: params.requesterSessionKey,
      // Bypass cross-agent allowlist gates: Team is explicitly configured.
      skipAllowlist: true,
    },
  );

  if (spawn.status !== "accepted" || !spawn.runId || !spawn.childSessionKey) {
    const error = spawn.error?.trim() || "spawn failed";
    params.db.markTaskTerminal({
      taskId: params.task.taskId,
      status: "failed",
      error,
    });
    return;
  }

  params.db.markTaskRunning({
    taskId: params.task.taskId,
    childRunId: spawn.runId,
    childSessionKey: spawn.childSessionKey,
  });
}

export const teamsHandlers: GatewayRequestHandlers = {
  "teams.list": ({ params, respond }) => {
    if (!validateTeamsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid teams.list params: ${formatValidationErrors(validateTeamsListParams.errors)}`,
        ),
      );
      return;
    }

    ensureDefaultTeamExists(teamDb);
    const teams = teamDb.listTeams();
    respond(true, { teams }, undefined);
  },

  "teams.get": ({ params, respond }) => {
    if (!validateTeamsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid teams.get params: ${formatValidationErrors(validateTeamsGetParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as { teamId: string };
    const team = resolveKnownTeamOrRespond({ db: teamDb, teamId: p.teamId, respond });
    if (!team) {
      return;
    }
    respond(true, { team }, undefined);
  },

  "teams.run": async ({ params, respond }) => {
    if (!validateTeamsRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid teams.run params: ${formatValidationErrors(validateTeamsRunParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as {
      teamId: string;
      tasks: Array<{ prompt: string; label?: string; agentId?: string }>;
      runId?: string;
      requesterSessionKey?: string;
    };

    const team = resolveKnownTeamOrRespond({ db: teamDb, teamId: p.teamId, respond });
    if (!team) {
      return;
    }

    const runId =
      typeof p.runId === "string" && p.runId.trim() ? p.runId.trim() : `teamrun:${randomUUID()}`;

    let normalizedTasks: Array<{
      idx: number;
      label?: string;
      prompt: string;
      assignedAgentId: string;
    }>;
    try {
      normalizedTasks = normalizeTaskInputs({ team, tasks: p.tasks });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
      return;
    }

    const created = teamDb.createRun({
      runId,
      teamId: team.teamId,
      tasks: normalizedTasks,
    });
    teamDb.updateRunStatus({ runId, status: "running", startedAtMs: Date.now() });

    const cfg = loadConfig();
    const requesterSessionKey =
      typeof p.requesterSessionKey === "string" && p.requesterSessionKey.trim()
        ? p.requesterSessionKey.trim()
        : resolveMainSessionKey(cfg);

    // Spawn tasks (Phase 1: user-provided task list only; no LLM decomposition)
    for (const task of created.tasks) {
      try {
        await spawnTaskAndRecord({ db: teamDb, requesterSessionKey, task });
      } catch (err) {
        teamDb.markTaskTerminal({
          taskId: task.taskId,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // If any task failed to start, mark the run failed immediately.
    const tasksAfterSpawn = teamDb.listTasksForRun(runId);
    if (tasksAfterSpawn.some((t) => t.status === "failed")) {
      teamDb.updateRunStatus({
        runId,
        status: "failed",
        endedAtMs: Date.now(),
        error: "one or more tasks failed to start",
      });
    }

    const run = teamDb.getRun(runId);
    respond(true, { run, tasks: tasksAfterSpawn }, undefined);
  },

  "teams.run.get": ({ params, respond }) => {
    if (!validateTeamsRunGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid teams.run.get params: ${formatValidationErrors(validateTeamsRunGetParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as { runId: string };
    const run = teamDb.getRun(p.runId);
    if (!run) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `run not found: ${p.runId}`),
      );
      return;
    }
    const tasks = teamDb.listTasksForRun(p.runId);
    respond(true, { run, tasks }, undefined);
  },

  "teams.run.cancel": ({ params, respond }) => {
    if (!validateTeamsRunCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid teams.run.cancel params: ${formatValidationErrors(
            validateTeamsRunCancelParams.errors,
          )}`,
        ),
      );
      return;
    }

    const p = params as { runId: string };
    const result = teamDb.cancelRun(p.runId);
    if (!result.run) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `run not found: ${p.runId}`),
      );
      return;
    }
    respond(true, { ok: true, run: result.run, canceledTasks: result.canceledTasks }, undefined);
  },

  "teams.tasks.list": ({ params, respond }) => {
    if (!validateTeamsTasksListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid teams.tasks.list params: ${formatValidationErrors(
            validateTeamsTasksListParams.errors,
          )}`,
        ),
      );
      return;
    }

    const p = params as { runId: string };
    const tasks = teamDb.listTasksForRun(p.runId);
    respond(true, { runId: p.runId, tasks }, undefined);
  },
};

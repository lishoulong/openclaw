import { onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { TeamDb } from "./team-db.js";

const log = createSubsystemLogger("teams/runtime");

let teamDbSingleton: TeamDb | null = null;

export function getTeamDb(): TeamDb {
  if (!teamDbSingleton) {
    teamDbSingleton = new TeamDb();
  }
  return teamDbSingleton;
}

export type TeamRuntime = {
  registerChildRun: (params: { childRunId: string; taskId: string; runId: string }) => void;
  dispose: () => void;
};

let runtimeSingleton: TeamRuntime | null = null;

export function initTeamRuntime(): TeamRuntime {
  if (runtimeSingleton) {
    return runtimeSingleton;
  }

  const db = getTeamDb();
  const taskByChildRunId = new Map<string, { taskId: string; runId: string }>();

  const handleAgentEvent = (evt: AgentEventPayload) => {
    if (!evt || evt.stream !== "lifecycle") {
      return;
    }
    const phase = evt.data?.phase;
    if (phase !== "end" && phase !== "error") {
      // Avoid reacting to transient retry errors.
      return;
    }

    const childRunId = evt.runId;
    if (!childRunId) {
      return;
    }

    const endedAtMs = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : Date.now();
    const aborted = evt.data?.aborted === true;
    const lifecycleError = typeof evt.data?.error === "string" ? evt.data.error : undefined;

    const task = db.getTaskByChildRunId(childRunId);
    if (!task) {
      return;
    }

    // 如果任务已经被取消/终止，不重复覆盖（例如 teams.run.cancel）。
    if (task.status !== "running") {
      return;
    }

    const status = phase === "error" || aborted ? "failed" : "completed";
    db.markTaskTerminal({
      taskId: task.taskId,
      status,
      endedAtMs,
      ...(lifecycleError ? { error: lifecycleError } : {}),
    });

    try {
      const run = db.getRun(task.runId);
      if (!run || run.status !== "running") {
        return;
      }
      const tasks = db.listTasksForRun(task.runId);
      const allTerminal = tasks.every((t) => t.status !== "pending" && t.status !== "running");
      if (!allTerminal) {
        return;
      }
      const anyFailed = tasks.some((t) => t.status === "failed");
      if (anyFailed) {
        db.updateRunStatus({
          runId: task.runId,
          status: "failed",
          endedAtMs,
          error: "one or more tasks failed",
        });
      } else {
        db.updateRunStatus({ runId: task.runId, status: "completed", endedAtMs });
      }
    } catch (err) {
      log.warn(
        `failed to reconcile team run completion for childRun=${childRunId}: ${String(err)}`,
      );
    } finally {
      taskByChildRunId.delete(childRunId);
    }
  };

  const unsubscribe = onAgentEvent((evt) => {
    try {
      handleAgentEvent(evt);
    } catch (err) {
      log.warn(`team runtime event handler failed: ${String(err)}`);
    }
  });

  runtimeSingleton = {
    registerChildRun: (params) => {
      const childRunId = params.childRunId.trim();
      if (!childRunId) {
        return;
      }
      taskByChildRunId.set(childRunId, { taskId: params.taskId, runId: params.runId });
    },
    dispose: () => {
      unsubscribe();
      runtimeSingleton = null;
    },
  };

  return runtimeSingleton;
}

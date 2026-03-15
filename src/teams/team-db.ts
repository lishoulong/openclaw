import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveStateDir } from "../config/paths.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { ensureTeamDbSchema } from "./team-db-schema.js";
import type {
  TeamConfig,
  TeamEvent,
  TeamMailboxMessage,
  TeamRun,
  TeamRunStatus,
  TeamTask,
  TeamTaskStatus,
} from "./types.js";

export type TeamDbOptions = {
  dbPath?: string;
  readOnly?: boolean;
};

function resolveTeamsStateDir(env: NodeJS.ProcessEnv = process.env): string {
  // Tests should never write to a real user state dir.
  if (env.VITEST || env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), "openclaw-test-state", String(process.pid));
  }
  return resolveStateDir(env);
}

export function resolveTeamDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveTeamsStateDir(env), "teams", "team.sqlite");
}

function ensureDirSync(dir: string): void {
  if (!dir) {
    return;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }
}

function safeParseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class TeamDb {
  private readonly dbPath: string;
  private readonly readOnly: boolean;
  private db: DatabaseSync | null = null;

  constructor(opts: TeamDbOptions = {}) {
    this.dbPath = opts.dbPath ?? resolveTeamDbPath(process.env);
    this.readOnly = opts.readOnly === true;
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // ignore
    }
    this.db = null;
  }

  private openDatabaseAtPath(dbPath: string): DatabaseSync {
    ensureDirSync(path.dirname(dbPath));
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(dbPath, { readOnly: this.readOnly });
    // busy_timeout is per-connection and resets to 0 on restart.
    db.exec("PRAGMA busy_timeout = 5000");
    return db;
  }

  private ensureDb(): DatabaseSync {
    if (this.db) {
      return this.db;
    }
    const db = this.openDatabaseAtPath(this.dbPath);
    ensureTeamDbSchema(db);
    this.db = db;
    return db;
  }

  private mapTeamConfigRow(row: {
    team_id: string;
    name: string;
    members_json: string;
    created_at_ms: number;
    updated_at_ms: number;
  }): TeamConfig {
    const members = (() => {
      try {
        const parsed = JSON.parse(row.members_json) as unknown;
        return Array.isArray(parsed)
          ? parsed
              .filter((m) => m && typeof m === "object")
              .map((m) => {
                const candidate = m as { agentId?: unknown; label?: unknown };
                const agentId = typeof candidate.agentId === "string" ? candidate.agentId : "";
                const label = typeof candidate.label === "string" ? candidate.label : undefined;
                return { agentId, ...(label ? { label } : {}) };
              })
              .filter((m) => m.agentId.trim())
          : [];
      } catch {
        return [];
      }
    })();

    return {
      teamId: row.team_id,
      name: row.name,
      members,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
    };
  }

  private mapRunRow(row: {
    run_id: string;
    team_id: string;
    status: string;
    created_at_ms: number;
    started_at_ms: number | null;
    ended_at_ms: number | null;
    canceled_at_ms: number | null;
    error: string | null;
  }): TeamRun {
    return {
      runId: row.run_id,
      teamId: row.team_id,
      status: row.status as TeamRunStatus,
      createdAtMs: row.created_at_ms,
      ...(typeof row.started_at_ms === "number" ? { startedAtMs: row.started_at_ms } : {}),
      ...(typeof row.ended_at_ms === "number" ? { endedAtMs: row.ended_at_ms } : {}),
      ...(typeof row.canceled_at_ms === "number" ? { canceledAtMs: row.canceled_at_ms } : {}),
      ...(typeof row.error === "string" && row.error.trim() ? { error: row.error } : {}),
    };
  }

  private mapTaskRow(row: {
    task_id: string;
    run_id: string;
    idx: number;
    label: string | null;
    prompt: string;
    assigned_agent_id: string;
    status: string;
    created_at_ms: number;
    started_at_ms: number | null;
    ended_at_ms: number | null;
    child_run_id: string | null;
    child_session_key: string | null;
    result_text: string | null;
    error: string | null;
  }): TeamTask {
    return {
      taskId: row.task_id,
      runId: row.run_id,
      idx: row.idx,
      ...(typeof row.label === "string" && row.label.trim() ? { label: row.label } : {}),
      prompt: row.prompt,
      assignedAgentId: row.assigned_agent_id,
      status: row.status as TeamTaskStatus,
      createdAtMs: row.created_at_ms,
      ...(typeof row.started_at_ms === "number" ? { startedAtMs: row.started_at_ms } : {}),
      ...(typeof row.ended_at_ms === "number" ? { endedAtMs: row.ended_at_ms } : {}),
      ...(typeof row.child_run_id === "string" && row.child_run_id.trim()
        ? { childRunId: row.child_run_id }
        : {}),
      ...(typeof row.child_session_key === "string" && row.child_session_key.trim()
        ? { childSessionKey: row.child_session_key }
        : {}),
      ...(typeof row.result_text === "string" ? { resultText: row.result_text } : {}),
      ...(typeof row.error === "string" && row.error.trim() ? { error: row.error } : {}),
    };
  }

  listTeams(): TeamConfig[] {
    const db = this.ensureDb();
    const rows = db
      .prepare(
        "SELECT team_id, name, members_json, created_at_ms, updated_at_ms FROM team_configs ORDER BY updated_at_ms DESC",
      )
      .all() as Array<{
      team_id: string;
      name: string;
      members_json: string;
      created_at_ms: number;
      updated_at_ms: number;
    }>;
    return rows.map((row) => this.mapTeamConfigRow(row));
  }

  getTeam(teamId: string): TeamConfig | null {
    const id = teamId.trim();
    if (!id) {
      return null;
    }
    const db = this.ensureDb();
    const row = db
      .prepare(
        "SELECT team_id, name, members_json, created_at_ms, updated_at_ms FROM team_configs WHERE team_id = ?",
      )
      .get(id) as
      | {
          team_id: string;
          name: string;
          members_json: string;
          created_at_ms: number;
          updated_at_ms: number;
        }
      | undefined;
    return row ? this.mapTeamConfigRow(row) : null;
  }

  upsertTeam(team: { teamId: string; name: string; members: TeamConfig["members"] }): TeamConfig {
    const db = this.ensureDb();
    const teamId = team.teamId.trim();
    if (!teamId) {
      throw new Error("teamId is required");
    }
    const name = team.name.trim();
    if (!name) {
      throw new Error("team.name is required");
    }
    const now = Date.now();

    const existing = db
      .prepare("SELECT created_at_ms FROM team_configs WHERE team_id = ?")
      .get(teamId) as { created_at_ms: number } | undefined;

    const createdAtMs = existing?.created_at_ms ?? now;
    const membersJson = JSON.stringify(team.members ?? []);

    db.prepare(
      `INSERT INTO team_configs (team_id, name, members_json, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(team_id) DO UPDATE SET
         name=excluded.name,
         members_json=excluded.members_json,
         updated_at_ms=excluded.updated_at_ms`,
    ).run(teamId, name, membersJson, createdAtMs, now);

    return {
      teamId,
      name,
      members: team.members ?? [],
      createdAtMs,
      updatedAtMs: now,
    };
  }

  createRun(params: {
    runId: string;
    teamId: string;
    tasks: Array<{ idx: number; label?: string; prompt: string; assignedAgentId: string }>;
    createdAtMs?: number;
  }): { run: TeamRun; tasks: TeamTask[] } {
    const db = this.ensureDb();
    const runId = params.runId.trim();
    if (!runId) {
      throw new Error("runId is required");
    }
    const teamId = params.teamId.trim();
    if (!teamId) {
      throw new Error("teamId is required");
    }
    const now = params.createdAtMs ?? Date.now();

    const taskRows = params.tasks.map((t) => {
      const taskId = `${runId}:task:${t.idx}`;
      return {
        taskId,
        idx: t.idx,
        label: t.label?.trim() || null,
        prompt: t.prompt,
        assignedAgentId: t.assignedAgentId,
      };
    });

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO team_runs (run_id, team_id, status, created_at_ms)
         VALUES (?, ?, ?, ?)`,
      ).run(runId, teamId, "running", now);

      const insertTask = db.prepare(
        `INSERT INTO team_tasks (
           task_id, run_id, idx, label, prompt, assigned_agent_id,
           status, created_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const row of taskRows) {
        insertTask.run(
          row.taskId,
          runId,
          row.idx,
          row.label,
          row.prompt,
          row.assignedAgentId,
          "pending",
          now,
        );
      }

      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw err;
    }

    const run: TeamRun = {
      runId,
      teamId,
      status: "running",
      createdAtMs: now,
    };

    const tasks: TeamTask[] = taskRows.map((row) => ({
      taskId: row.taskId,
      runId,
      idx: row.idx,
      ...(row.label ? { label: row.label } : {}),
      prompt: row.prompt,
      assignedAgentId: row.assignedAgentId,
      status: "pending",
      createdAtMs: now,
    }));

    return { run, tasks };
  }

  getRun(runId: string): TeamRun | null {
    const id = runId.trim();
    if (!id) {
      return null;
    }
    const db = this.ensureDb();
    const row = db
      .prepare(
        "SELECT run_id, team_id, status, created_at_ms, started_at_ms, ended_at_ms, canceled_at_ms, error FROM team_runs WHERE run_id = ?",
      )
      .get(id) as
      | {
          run_id: string;
          team_id: string;
          status: string;
          created_at_ms: number;
          started_at_ms: number | null;
          ended_at_ms: number | null;
          canceled_at_ms: number | null;
          error: string | null;
        }
      | undefined;
    return row ? this.mapRunRow(row) : null;
  }

  listTasksForRun(runId: string): TeamTask[] {
    const id = runId.trim();
    if (!id) {
      return [];
    }
    const db = this.ensureDb();
    const rows = db
      .prepare(
        `SELECT task_id, run_id, idx, label, prompt, assigned_agent_id, status, created_at_ms,
                started_at_ms, ended_at_ms, child_run_id, child_session_key, result_text, error
           FROM team_tasks
          WHERE run_id = ?
          ORDER BY idx ASC`,
      )
      .all(id) as Array<{
      task_id: string;
      run_id: string;
      idx: number;
      label: string | null;
      prompt: string;
      assigned_agent_id: string;
      status: string;
      created_at_ms: number;
      started_at_ms: number | null;
      ended_at_ms: number | null;
      child_run_id: string | null;
      child_session_key: string | null;
      result_text: string | null;
      error: string | null;
    }>;
    return rows.map((row) => this.mapTaskRow(row));
  }

  getTask(taskId: string): TeamTask | null {
    const id = taskId.trim();
    if (!id) {
      return null;
    }
    const db = this.ensureDb();
    const row = db
      .prepare(
        `SELECT task_id, run_id, idx, label, prompt, assigned_agent_id, status, created_at_ms,
                started_at_ms, ended_at_ms, child_run_id, child_session_key, result_text, error
           FROM team_tasks
          WHERE task_id = ?
          LIMIT 1`,
      )
      .get(id) as
      | {
          task_id: string;
          run_id: string;
          idx: number;
          label: string | null;
          prompt: string;
          assigned_agent_id: string;
          status: string;
          created_at_ms: number;
          started_at_ms: number | null;
          ended_at_ms: number | null;
          child_run_id: string | null;
          child_session_key: string | null;
          result_text: string | null;
          error: string | null;
        }
      | undefined;
    return row ? this.mapTaskRow(row) : null;
  }

  getTaskByChildRunId(childRunId: string): TeamTask | null {
    const id = childRunId.trim();
    if (!id) {
      return null;
    }
    const db = this.ensureDb();
    const row = db
      .prepare(
        `SELECT task_id, run_id, idx, label, prompt, assigned_agent_id, status, created_at_ms,
                started_at_ms, ended_at_ms, child_run_id, child_session_key, result_text, error
           FROM team_tasks
          WHERE child_run_id = ?
          LIMIT 1`,
      )
      .get(id) as
      | {
          task_id: string;
          run_id: string;
          idx: number;
          label: string | null;
          prompt: string;
          assigned_agent_id: string;
          status: string;
          created_at_ms: number;
          started_at_ms: number | null;
          ended_at_ms: number | null;
          child_run_id: string | null;
          child_session_key: string | null;
          result_text: string | null;
          error: string | null;
        }
      | undefined;
    return row ? this.mapTaskRow(row) : null;
  }

  markTaskRunning(params: {
    taskId: string;
    childRunId: string;
    childSessionKey: string;
    startedAtMs?: number;
  }): void {
    const db = this.ensureDb();
    const now = params.startedAtMs ?? Date.now();
    db.prepare(
      `UPDATE team_tasks
          SET status = CASE WHEN status = 'pending' THEN ? ELSE status END,
              started_at_ms = COALESCE(started_at_ms, ?),
              child_run_id = COALESCE(child_run_id, ?),
              child_session_key = COALESCE(child_session_key, ?)
        WHERE task_id = ? AND status IN ('pending', 'running')`,
    ).run("running", now, params.childRunId, params.childSessionKey, params.taskId);
  }

  markTaskTerminal(params: {
    taskId: string;
    status: Exclude<TeamTaskStatus, "pending" | "running">;
    endedAtMs?: number;
    resultText?: string | null;
    error?: string | null;
  }): void {
    const db = this.ensureDb();
    const endedAtMs = params.endedAtMs ?? Date.now();
    db.prepare(
      `UPDATE team_tasks
          SET status = ?,
              ended_at_ms = COALESCE(ended_at_ms, ?),
              result_text = COALESCE(result_text, ?),
              error = COALESCE(error, ?)
        WHERE task_id = ? AND status IN ('pending', 'running')`,
    ).run(params.status, endedAtMs, params.resultText ?? null, params.error ?? null, params.taskId);
  }

  updateRunStatus(params: {
    runId: string;
    status: TeamRunStatus;
    startedAtMs?: number | null;
    endedAtMs?: number | null;
    canceledAtMs?: number | null;
    error?: string | null;
  }): void {
    const db = this.ensureDb();
    db.prepare(
      `UPDATE team_runs
          SET status = ?,
              started_at_ms = COALESCE(started_at_ms, ?),
              ended_at_ms = COALESCE(ended_at_ms, ?),
              canceled_at_ms = COALESCE(canceled_at_ms, ?),
              error = COALESCE(?, error)
        WHERE run_id = ?`,
    ).run(
      params.status,
      params.startedAtMs ?? null,
      params.endedAtMs ?? null,
      params.canceledAtMs ?? null,
      params.error ?? null,
      params.runId,
    );
  }

  cancelRun(runId: string): { run: TeamRun | null; canceledTasks: number } {
    const db = this.ensureDb();
    const id = runId.trim();
    if (!id) {
      return { run: null, canceledTasks: 0 };
    }
    const now = Date.now();

    db.exec("BEGIN");
    let canceledTasks = 0;
    try {
      db.prepare(
        `UPDATE team_runs
            SET status = ?,
                canceled_at_ms = COALESCE(canceled_at_ms, ?),
                ended_at_ms = COALESCE(ended_at_ms, ?)
          WHERE run_id = ?`,
      ).run("canceled", now, now, id);

      const result = db
        .prepare(
          `UPDATE team_tasks
              SET status = ?,
                  ended_at_ms = COALESCE(ended_at_ms, ?)
            WHERE run_id = ? AND status IN ('pending', 'running')`,
        )
        .run("canceled", now, id) as { changes?: number };
      canceledTasks = typeof result?.changes === "number" ? result.changes : 0;
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw err;
    }

    return { run: this.getRun(id), canceledTasks };
  }

  appendEvent(event: {
    eventId: string;
    runId?: string;
    taskId?: string;
    type: string;
    tsMs?: number;
    payload?: Record<string, unknown> | null;
  }): TeamEvent {
    const db = this.ensureDb();
    const tsMs = event.tsMs ?? Date.now();
    const payloadJson = event.payload ? JSON.stringify(event.payload) : null;
    // Idempotent insert: callers may retry with the same eventId.
    db.prepare(
      `INSERT OR IGNORE INTO team_events (event_id, run_id, task_id, type, ts_ms, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(event.eventId, event.runId ?? null, event.taskId ?? null, event.type, tsMs, payloadJson);

    const row = db
      .prepare(
        "SELECT event_id, run_id, task_id, type, ts_ms, payload_json FROM team_events WHERE event_id = ?",
      )
      .get(event.eventId) as
      | {
          event_id: string;
          run_id: string | null;
          task_id: string | null;
          type: string;
          ts_ms: number;
          payload_json: string | null;
        }
      | undefined;

    if (!row) {
      throw new Error(`failed to append event ${event.eventId}`);
    }

    return {
      eventId: row.event_id,
      ...(typeof row.run_id === "string" && row.run_id.trim() ? { runId: row.run_id } : {}),
      ...(typeof row.task_id === "string" && row.task_id.trim() ? { taskId: row.task_id } : {}),
      type: row.type,
      tsMs: row.ts_ms,
      payload: safeParseJsonObject(row.payload_json),
    };
  }

  appendMailboxMessage(message: {
    mailboxId: string;
    runId: string;
    taskId?: string;
    direction: TeamMailboxMessage["direction"];
    message: string;
    createdAtMs?: number;
  }): TeamMailboxMessage {
    const db = this.ensureDb();
    const createdAtMs = message.createdAtMs ?? Date.now();
    db.prepare(
      `INSERT INTO team_mailbox (mailbox_id, run_id, task_id, direction, message, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      message.mailboxId,
      message.runId,
      message.taskId ?? null,
      message.direction,
      message.message,
      createdAtMs,
    );

    return {
      mailboxId: message.mailboxId,
      runId: message.runId,
      ...(message.taskId ? { taskId: message.taskId } : {}),
      direction: message.direction,
      message: message.message,
      createdAtMs,
    };
  }
}

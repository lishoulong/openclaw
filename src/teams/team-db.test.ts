import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { TeamDb } from "./team-db.js";

async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-teamdb-test-"));
}

describe("TeamDb", () => {
  it("在首次打开时创建 schema 表", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "team.sqlite");
    const db = new TeamDb({ dbPath });

    // 触发 ensureTeamDbSchema
    expect(db.listTeams()).toEqual([]);

    const { DatabaseSync } = requireNodeSqlite();
    const raw = new DatabaseSync(dbPath);
    try {
      const rows = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = rows.map((r) => r.name);

      expect(names).toContain("team_meta");
      expect(names).toContain("team_configs");
      expect(names).toContain("team_runs");
      expect(names).toContain("team_tasks");
      expect(names).toContain("team_mailbox");
      expect(names).toContain("team_events");
    } finally {
      raw.close();
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("支持基础 CRUD（team / run / task）", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "team.sqlite");
    const db = new TeamDb({ dbPath });

    try {
      const team = db.upsertTeam({
        teamId: "t1",
        name: "Team 1",
        members: [{ agentId: "main" }, { agentId: "coder", label: "Coder" }],
      });
      expect(team.teamId).toBe("t1");

      const got = db.getTeam("t1");
      expect(got?.name).toBe("Team 1");
      expect(got?.members.map((m) => m.agentId)).toEqual(["main", "coder"]);

      const listed = db.listTeams();
      expect(listed.map((t) => t.teamId)).toContain("t1");

      const created = db.createRun({
        runId: "run-1",
        teamId: "t1",
        tasks: [
          { idx: 0, prompt: "do a", assignedAgentId: "main" },
          { idx: 1, prompt: "do b", assignedAgentId: "coder" },
        ],
      });
      expect(created.run.runId).toBe("run-1");
      expect(created.tasks).toHaveLength(2);

      const tasksBefore = db.listTasksForRun("run-1");
      expect(tasksBefore.map((t) => t.status)).toEqual(["pending", "pending"]);

      db.markTaskRunning({
        taskId: tasksBefore[0].taskId,
        childRunId: "child-1",
        childSessionKey: "agent:main:subagent:child",
      });
      const running = db.getTask(tasksBefore[0].taskId);
      expect(running?.status).toBe("running");
      expect(running?.childRunId).toBe("child-1");

      db.markTaskTerminal({
        taskId: tasksBefore[0].taskId,
        status: "completed",
        resultText: "ok",
      });
      const completed = db.getTask(tasksBefore[0].taskId);
      expect(completed?.status).toBe("completed");
      expect(completed?.resultText).toBe("ok");

      db.updateRunStatus({ runId: "run-1", status: "completed", endedAtMs: Date.now() });
      const run = db.getRun("run-1");
      expect(run?.status).toBe("completed");
    } finally {
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("取消 run 会将 pending/running tasks 标记为 canceled，但不覆盖已完成任务", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "team.sqlite");
    const db = new TeamDb({ dbPath });

    try {
      db.upsertTeam({ teamId: "t1", name: "Team 1", members: [{ agentId: "main" }] });
      const created = db.createRun({
        runId: "run-2",
        teamId: "t1",
        tasks: [
          { idx: 0, prompt: "do a", assignedAgentId: "main" },
          { idx: 1, prompt: "do b", assignedAgentId: "main" },
        ],
      });

      db.markTaskTerminal({ taskId: created.tasks[0].taskId, status: "completed" });
      db.markTaskRunning({
        taskId: created.tasks[1].taskId,
        childRunId: "child-2",
        childSessionKey: "agent:main:subagent:child2",
      });

      const canceled = db.cancelRun("run-2");
      expect(canceled.run?.status).toBe("canceled");
      expect(canceled.canceledTasks).toBe(1);

      const tasks = db.listTasksForRun("run-2");
      expect(tasks.map((t) => t.status)).toEqual(["completed", "canceled"]);
    } finally {
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("appendEvent 对重复 eventId 是幂等的（不会抛错且保留首次写入的数据）", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "team.sqlite");
    const db = new TeamDb({ dbPath });

    try {
      const first = db.appendEvent({
        eventId: "evt-1",
        type: "run.created",
        tsMs: 111,
        payload: { a: 1 },
      });

      const second = db.appendEvent({
        eventId: "evt-1",
        type: "run.created",
        tsMs: 222,
        payload: { a: 2 },
      });

      expect(second).toEqual(first);
      expect(second.tsMs).toBe(111);
      expect(second.payload).toEqual({ a: 1 });
    } finally {
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("Task 状态迁移是幂等的：重复写入不会覆盖 startedAtMs/endedAtMs/childRunId/resultText", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "team.sqlite");
    const db = new TeamDb({ dbPath });

    try {
      db.upsertTeam({ teamId: "t1", name: "Team 1", members: [{ agentId: "main" }] });
      const created = db.createRun({
        runId: "run-3",
        teamId: "t1",
        createdAtMs: 1,
        tasks: [{ idx: 0, prompt: "do a", assignedAgentId: "main" }],
      });

      const taskId = created.tasks[0].taskId;

      db.markTaskRunning({
        taskId,
        childRunId: "child-3-a",
        childSessionKey: "agent:main:subagent:child3a",
        startedAtMs: 1000,
      });

      db.markTaskRunning({
        taskId,
        childRunId: "child-3-b",
        childSessionKey: "agent:main:subagent:child3b",
        startedAtMs: 2000,
      });

      const running = db.getTask(taskId);
      expect(running?.status).toBe("running");
      expect(running?.startedAtMs).toBe(1000);
      expect(running?.childRunId).toBe("child-3-a");
      expect(running?.childSessionKey).toBe("agent:main:subagent:child3a");

      db.markTaskTerminal({
        taskId,
        status: "completed",
        endedAtMs: 3000,
        resultText: "ok",
      });

      // 重复的 terminal 写入应该是 no-op（不覆盖既有字段）
      db.markTaskTerminal({
        taskId,
        status: "failed",
        endedAtMs: 4000,
        resultText: "override",
        error: "err",
      });

      const terminal = db.getTask(taskId);
      expect(terminal?.status).toBe("completed");
      expect(terminal?.endedAtMs).toBe(3000);
      expect(terminal?.resultText).toBe("ok");
      expect(terminal?.error).toBeUndefined();
    } finally {
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

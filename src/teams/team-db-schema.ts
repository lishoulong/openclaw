import type { DatabaseSync } from "node:sqlite";

export const TEAM_DB_SCHEMA_VERSION = 1 as const;

export function ensureTeamDbSchema(db: DatabaseSync): void {
  // Connection-level pragmas.
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_configs (
      team_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      members_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_runs (
      run_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      started_at_ms INTEGER,
      ended_at_ms INTEGER,
      canceled_at_ms INTEGER,
      error TEXT,
      FOREIGN KEY(team_id) REFERENCES team_configs(team_id) ON DELETE CASCADE
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_team_runs_team_created ON team_runs(team_id, created_at_ms DESC);",
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_tasks (
      task_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      label TEXT,
      prompt TEXT NOT NULL,
      assigned_agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      started_at_ms INTEGER,
      ended_at_ms INTEGER,
      child_run_id TEXT,
      child_session_key TEXT,
      result_text TEXT,
      error TEXT,
      FOREIGN KEY(run_id) REFERENCES team_runs(run_id) ON DELETE CASCADE
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_team_tasks_run_id_idx ON team_tasks(run_id, idx);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_team_tasks_child_run_id ON team_tasks(child_run_id);");

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_mailbox (
      mailbox_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      task_id TEXT,
      direction TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(run_id) REFERENCES team_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(task_id) REFERENCES team_tasks(task_id) ON DELETE SET NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_team_mailbox_run_created ON team_mailbox(run_id, created_at_ms DESC);",
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_events (
      event_id TEXT PRIMARY KEY,
      run_id TEXT,
      task_id TEXT,
      type TEXT NOT NULL,
      ts_ms INTEGER NOT NULL,
      payload_json TEXT,
      FOREIGN KEY(run_id) REFERENCES team_runs(run_id) ON DELETE CASCADE,
      FOREIGN KEY(task_id) REFERENCES team_tasks(task_id) ON DELETE SET NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_team_events_run_ts ON team_events(run_id, ts_ms DESC);");

  // Store schema version for future migrations.
  db.prepare("INSERT OR REPLACE INTO team_meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(TEAM_DB_SCHEMA_VERSION),
  );
}

import type { Command } from "commander";
import { formatTimeAgo } from "../../infra/format-time/format-relative.ts";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { getTerminalTableWidth, renderTable } from "../../terminal/table.js";
import { theme } from "../../terminal/theme.js";
import type { GatewayRpcOpts } from "../gateway-rpc.js";
import { addGatewayClientOptions, callGatewayFromCli } from "../gateway-rpc.js";

type TeamMember = { agentId: string; label?: string };

type TeamConfig = {
  teamId: string;
  name: string;
  members: TeamMember[];
  createdAtMs: number;
  updatedAtMs: number;
};

type TeamRun = {
  runId: string;
  teamId: string;
  status: string;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  canceledAtMs?: number;
  error?: string;
};

type TeamTask = {
  taskId: string;
  runId: string;
  idx: number;
  label?: string;
  prompt: string;
  assignedAgentId: string;
  status: string;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  childRunId?: string;
  childSessionKey?: string;
  resultText?: string;
  error?: string;
};

type TeamsListResult = { teams: TeamConfig[] };

type TeamsGetResult = { team: TeamConfig };

type TeamsRunResult = { run: TeamRun | null; tasks: TeamTask[] };

type TeamsRunCancelResult = { ok: boolean; run?: TeamRun; canceledTasks: number };

type TeamsTasksListResult = { runId: string; tasks: TeamTask[] };

type TeamsBaseOpts = GatewayRpcOpts & { json?: boolean };

type TeamsRunOpts = TeamsBaseOpts & {
  task?: string[];
  taskAgent?: string[];
  taskLabel?: string[];
  runId?: string;
  requesterSessionKey?: string;
};

type TeamsRunQueryOpts = TeamsBaseOpts & { runId?: string };

type TeamsGetOpts = TeamsBaseOpts & { teamId?: string };

type TeamsTasksOpts = TeamsBaseOpts & { runId?: string };

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function requireNonEmpty(value: unknown, name: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  return trimmed;
}

function formatTeamMembers(members: TeamMember[]): string {
  if (!members.length) {
    return "none";
  }
  return members
    .map((m) => {
      const agentId = typeof m.agentId === "string" ? m.agentId : "";
      const label = typeof m.label === "string" ? m.label.trim() : "";
      return label ? `${agentId} (${label})` : agentId;
    })
    .filter(Boolean)
    .join(", ");
}

function printTeamsTable(teams: TeamConfig[]) {
  const tableWidth = getTerminalTableWidth();
  defaultRuntime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Team", header: "Team", minWidth: 14 },
        { key: "Name", header: "Name", minWidth: 18, flex: true },
        { key: "Members", header: "Members", minWidth: 22, flex: true },
        { key: "Updated", header: "Updated", minWidth: 10 },
      ],
      rows: teams.map((team) => ({
        Team: team.teamId,
        Name: team.name,
        Members: formatTeamMembers(team.members),
        Updated:
          typeof team.updatedAtMs === "number" ? formatTimeAgo(Date.now() - team.updatedAtMs) : "",
      })),
    }).trimEnd(),
  );
}

function formatMaybeMs(ts?: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) {
    return "";
  }
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

function printRunSummary(run: TeamRun | null, tasks: TeamTask[]) {
  if (!run) {
    defaultRuntime.log(theme.muted("No run."));
    return;
  }

  const headline = `${theme.heading(run.runId)} ${theme.muted(`(${run.status})`)}`;
  defaultRuntime.log(headline);
  defaultRuntime.log(
    theme.muted(
      [
        `team=${run.teamId}`,
        run.startedAtMs ? `started=${formatMaybeMs(run.startedAtMs)}` : "",
        run.endedAtMs ? `ended=${formatMaybeMs(run.endedAtMs)}` : "",
        run.canceledAtMs ? `canceled=${formatMaybeMs(run.canceledAtMs)}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (run.error) {
    defaultRuntime.log(theme.error(run.error));
  }

  if (!tasks.length) {
    defaultRuntime.log(theme.muted("No tasks."));
    return;
  }

  const tableWidth = getTerminalTableWidth();
  defaultRuntime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Idx", header: "#", minWidth: 3 },
        { key: "Status", header: "Status", minWidth: 10 },
        { key: "Agent", header: "Agent", minWidth: 14 },
        { key: "Label", header: "Label", minWidth: 10, flex: true },
        { key: "Prompt", header: "Prompt", minWidth: 20, flex: true },
      ],
      rows: tasks.map((task) => ({
        Idx: String(task.idx),
        Status: task.status,
        Agent: task.assignedAgentId,
        Label: task.label ?? "",
        Prompt: task.prompt,
      })),
    }).trimEnd(),
  );
}

function normalizeRunTasksFromOpts(opts: TeamsRunOpts) {
  const tasks = Array.isArray(opts.task) ? opts.task : [];
  if (tasks.length === 0) {
    throw new Error("--task is required (provide one or more tasks)");
  }
  const agents = Array.isArray(opts.taskAgent) ? opts.taskAgent : [];
  const labels = Array.isArray(opts.taskLabel) ? opts.taskLabel : [];

  if (agents.length > 0 && agents.length !== tasks.length) {
    throw new Error("--task-agent count must match --task count");
  }
  if (labels.length > 0 && labels.length !== tasks.length) {
    throw new Error("--task-label count must match --task count");
  }

  return tasks.map((prompt, idx) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      throw new Error(`task[${idx}] is empty`);
    }
    const agent = agents.length > 0 ? agents[idx]?.trim() : "";
    const label = labels.length > 0 ? labels[idx]?.trim() : "";
    return {
      prompt: cleanPrompt,
      ...(label ? { label } : {}),
      ...(agent ? { agentId: agent } : {}),
    };
  });
}

export function registerTeamsCli(program: Command) {
  const teams = program
    .command("teams")
    .description("Run Agent Teams via the Gateway")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/teams", "docs.openclaw.ai/cli/teams")}\n`,
    );

  addGatewayClientOptions(
    teams
      .command("list")
      .description("List configured teams")
      .option("--json", "Output JSON", false)
      .action(async (opts: TeamsBaseOpts) => {
        try {
          const res = (await callGatewayFromCli(
            "teams.list",
            opts,
            {},
            { expectFinal: false },
          )) as TeamsListResult;
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(res, null, 2));
            return;
          }
          const teamsList = Array.isArray(res.teams) ? res.teams : [];
          if (teamsList.length === 0) {
            defaultRuntime.log(theme.muted("No teams."));
            return;
          }
          printTeamsTable(teamsList);
        } catch (err) {
          defaultRuntime.error(theme.error(normalizeError(err)));
          defaultRuntime.exit(1);
        }
      }),
  );

  addGatewayClientOptions(
    teams
      .command("get")
      .description("Get a team config")
      .argument("<teamId>", "Team id")
      .option("--json", "Output JSON", false)
      .action(async (teamId: string, opts: TeamsGetOpts) => {
        try {
          const resolvedTeamId = requireNonEmpty(teamId, "teamId");
          const res = (await callGatewayFromCli(
            "teams.get",
            opts,
            { teamId: resolvedTeamId },
            { expectFinal: false },
          )) as TeamsGetResult;
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(res, null, 2));
            return;
          }
          const team = res.team;
          defaultRuntime.log(`${theme.heading(team.teamId)} ${theme.muted(team.name)}`);
          defaultRuntime.log(theme.muted(`members: ${formatTeamMembers(team.members)}`));
        } catch (err) {
          defaultRuntime.error(theme.error(normalizeError(err)));
          defaultRuntime.exit(1);
        }
      }),
  );

  addGatewayClientOptions(
    teams
      .command("run")
      .description("Start a team run")
      .argument("<teamId>", "Team id")
      .option("--task <prompt...>", "Task prompt(s). Use quotes for spaces.")
      .option("--task-agent <agentId...>", "Optional per-task agent id(s) (same count as --task)")
      .option("--task-label <label...>", "Optional per-task label(s) (same count as --task)")
      .option("--run-id <id>", "Override run id")
      .option("--requester-session-key <key>", "Override requester session key")
      .option("--json", "Output JSON", false)
      .action(async (teamId: string, opts: TeamsRunOpts) => {
        try {
          const resolvedTeamId = requireNonEmpty(teamId, "teamId");
          const tasks = normalizeRunTasksFromOpts(opts);
          const res = (await callGatewayFromCli(
            "teams.run",
            opts,
            {
              teamId: resolvedTeamId,
              tasks,
              ...(opts.runId ? { runId: opts.runId } : {}),
              ...(opts.requesterSessionKey
                ? { requesterSessionKey: opts.requesterSessionKey }
                : {}),
            },
            { expectFinal: false },
          )) as TeamsRunResult;
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(res, null, 2));
            return;
          }
          printRunSummary(res.run, Array.isArray(res.tasks) ? res.tasks : []);
        } catch (err) {
          defaultRuntime.error(theme.error(normalizeError(err)));
          defaultRuntime.exit(1);
        }
      }),
  );

  const runs = teams.command("runs").description("Inspect team runs");

  addGatewayClientOptions(
    runs
      .command("get")
      .description("Fetch a team run")
      .argument("<runId>", "Run id")
      .option("--json", "Output JSON", false)
      .action(async (runId: string, opts: TeamsRunQueryOpts) => {
        try {
          const resolvedRunId = requireNonEmpty(runId, "runId");
          const res = (await callGatewayFromCli(
            "teams.run.get",
            opts,
            { runId: resolvedRunId },
            { expectFinal: false },
          )) as TeamsRunResult;
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(res, null, 2));
            return;
          }
          printRunSummary(res.run, Array.isArray(res.tasks) ? res.tasks : []);
        } catch (err) {
          defaultRuntime.error(theme.error(normalizeError(err)));
          defaultRuntime.exit(1);
        }
      }),
  );

  addGatewayClientOptions(
    runs
      .command("cancel")
      .description("Cancel a team run")
      .argument("<runId>", "Run id")
      .option("--json", "Output JSON", false)
      .action(async (runId: string, opts: TeamsRunQueryOpts) => {
        try {
          const resolvedRunId = requireNonEmpty(runId, "runId");
          const res = (await callGatewayFromCli(
            "teams.run.cancel",
            opts,
            { runId: resolvedRunId },
            { expectFinal: false },
          )) as TeamsRunCancelResult;
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(res, null, 2));
            return;
          }
          defaultRuntime.log(
            `${theme.warn("Canceled")} ${theme.command(resolvedRunId)} ${theme.muted(`(${res.canceledTasks} tasks)`)}`,
          );
        } catch (err) {
          defaultRuntime.error(theme.error(normalizeError(err)));
          defaultRuntime.exit(1);
        }
      }),
  );

  const tasks = teams.command("tasks").description("List tasks for a run");

  addGatewayClientOptions(
    tasks
      .command("list")
      .description("List tasks for a run")
      .argument("<runId>", "Run id")
      .option("--json", "Output JSON", false)
      .action(async (runId: string, opts: TeamsTasksOpts) => {
        try {
          const resolvedRunId = requireNonEmpty(runId, "runId");
          const res = (await callGatewayFromCli(
            "teams.tasks.list",
            opts,
            { runId: resolvedRunId },
            { expectFinal: false },
          )) as TeamsTasksListResult;
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(res, null, 2));
            return;
          }
          defaultRuntime.log(theme.heading(res.runId));
          printRunSummary(
            {
              runId: res.runId,
              teamId: "",
              status: "",
              createdAtMs: 0,
            },
            res.tasks,
          );
        } catch (err) {
          defaultRuntime.error(theme.error(normalizeError(err)));
          defaultRuntime.exit(1);
        }
      }),
  );
}

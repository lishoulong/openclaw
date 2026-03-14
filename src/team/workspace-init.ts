/**
 * OpenClaw 多 Agent 调度方案 - 工作区初始化
 * 
 * 负责创建团队工作区的目录结构和初始文件
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TeamId,
  TeamConfig,
  TeamManifest,
  CoordinatorState,
  Summary,
  WorkspaceStructure,
  WorkspaceConfig,
  TeamState,
  WorkspaceError,
} from './types';

/** 默认工作区基础路径 */
const DEFAULT_WORKSPACE_BASE = '.openclaw/workspace';

/** 团队子目录 */
const TEAMS_SUBDIR = 'teams';

/**
 * 生成默认的工作区结构配置
 */
export function generateWorkspaceStructure(teamId: TeamId): WorkspaceStructure {
  return {
    manifestPath: 'manifest.json',
    coordinatorPath: 'coordinator.md',
    summaryPath: 'summary.md',
    mailbox: {
      inbox: 'mailbox/inbox',
      outbox: 'mailbox/outbox',
    },
    tasks: {
      todo: 'tasks/todo',
      inProgress: 'tasks/in-progress',
      completed: 'tasks/completed',
    },
    agents: {
      lead: 'agents/lead',
      members: 'agents',
    },
  };
}

/**
 * 创建团队工作区初始化器
 */
export class WorkspaceInitializer {
  private basePath: string;

  constructor(basePath: string = DEFAULT_WORKSPACE_BASE) {
    this.basePath = basePath;
  }

  /**
   * 获取团队工作区的完整路径
   */
  getTeamPath(teamId: TeamId): string {
    return path.join(this.basePath, TEAMS_SUBDIR, teamId);
  }

  /**
   * 初始化团队工作区
   * 
   * @param config 团队配置
   * @returns 工作区配置
   * @throws WorkspaceError 如果初始化失败
   */
  async initialize(config: TeamConfig): Promise<WorkspaceConfig> {
    const teamPath = this.getTeamPath(config.teamId);
    const structure = generateWorkspaceStructure(config.teamId);

    try {
      // 1. 创建基础目录结构
      await this.createDirectoryStructure(teamPath, structure);

      // 2. 创建初始文件
      await this.createInitialFiles(teamPath, config, structure);

      return {
        basePath: teamPath,
        teamId: config.teamId,
        structure,
      };
    } catch (error) {
      throw new WorkspaceError(
        `Failed to initialize workspace for team ${config.teamId}`,
        teamPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 创建目录结构
   */
  private async createDirectoryStructure(
    teamPath: string,
    structure: WorkspaceStructure
  ): Promise<void> {
    const directories = [
      // Mailbox
      path.join(teamPath, structure.mailbox.inbox),
      path.join(teamPath, structure.mailbox.outbox),
      // Tasks
      path.join(teamPath, structure.tasks.todo),
      path.join(teamPath, structure.tasks.inProgress),
      path.join(teamPath, structure.tasks.completed),
      // Agents
      path.join(teamPath, structure.agents.lead),
      path.join(teamPath, structure.agents.members),
    ];

    // 并行创建所有目录
    await Promise.all(
      directories.map(async (dir) => {
        try {
          await fs.mkdir(dir, { recursive: true });
        } catch (error) {
          throw new WorkspaceError(
            `Failed to create directory: ${dir}`,
            dir,
            error instanceof Error ? error : undefined
          );
        }
      })
    );
  }

  /**
   * 创建初始文件
   */
  private async createInitialFiles(
    teamPath: string,
    config: TeamConfig,
    structure: WorkspaceStructure
  ): Promise<void> {
    const now = new Date().toISOString();

    // 1. 创建 manifest.json
    const manifest: TeamManifest = {
      teamId: config.teamId,
      createdAt: now,
      updatedAt: now,
      state: TeamState.INITIALIZING,
      config,
      members: config.members.map((m) => ({
        agentId: m.agentId,
        role: m.role,
        state: 'idle' as const,
      })),
      tasks: {
        todo: [],
        inProgress: [],
        completed: [],
        failed: [],
      },
    };

    // 如果存在 lead，添加到成员列表
    if (config.lead) {
      manifest.members.unshift({
        agentId: config.lead.agentId,
        role: config.lead.role,
        state: 'idle' as const,
      });
    }

    await this.writeJsonFile(
      path.join(teamPath, structure.manifestPath),
      manifest
    );

    // 2. 创建 coordinator.md
    const coordinatorState: CoordinatorState = {
      teamId: config.teamId,
      lastSync: now,
      activeAgents: [],
      pendingTasks: [],
      completedTasks: [],
      messages: [],
    };

    await this.writeMarkdownFile(
      path.join(teamPath, structure.coordinatorPath),
      this.generateCoordinatorMarkdown(coordinatorState, config)
    );

    // 3. 创建 summary.md
    const summary: Summary = {
      teamId: config.teamId,
      generatedAt: now,
      overallProgress: 0,
      completedTasks: 0,
      totalTasks: 0,
      keyResults: [],
      blockers: [],
      nextSteps: [],
    };

    await this.writeMarkdownFile(
      path.join(teamPath, structure.summaryPath),
      this.generateSummaryMarkdown(summary)
    );
  }

  /**
   * 生成协调器 Markdown 内容
   */
  private generateCoordinatorMarkdown(
    state: CoordinatorState,
    config: TeamConfig
  ): string {
    return `# Team Coordinator - ${config.teamId}

## 团队信息

- **Team ID**: ${config.teamId}
- **协调模式**: ${config.coordinationMode}
- **任务**: ${config.task}
- **最后同步**: ${state.lastSync}

## 团队成员

${config.lead ? `- **Lead**: ${config.lead.agentId} (${config.lead.role})` : ''}
${config.members.map(m => `- **Member**: ${m.agentId} (${m.role})`).join('\n')}

## 活跃 Agent

${state.activeAgents.length > 0 
  ? state.activeAgents.map(id => `- ${id}`).join('\n')
  : '_暂无活跃 Agent_'}

## 待处理任务

${state.pendingTasks.length > 0
  ? state.pendingTasks.map(id => `- ${id}`).join('\n')
  : '_暂无待处理任务_'}

## 已完成任务

${state.completedTasks.length > 0
  ? state.completedTasks.map(id => `- ${id}`).join('\n')
  : '_暂无已完成任务_'}

## 消息日志

${state.messages.length > 0
  ? state.messages.map(m => `- [${m.timestamp}] ${m.from}: ${m.type}`).join('\n')
  : '_暂无消息_'}

---
*此文件由协调器自动更新，请勿手动修改*
`;
  }

  /**
   * 生成摘要 Markdown 内容
   */
  private generateSummaryMarkdown(summary: Summary): string {
    return `# Team Summary - ${summary.teamId}

## 总体进度

- **完成度**: ${summary.overallProgress}%
- **已完成任务**: ${summary.completedTasks} / ${summary.totalTasks}
- **生成时间**: ${summary.generatedAt}

## 关键结果

${summary.keyResults.length > 0
  ? summary.keyResults.map(r => `- ${r}`).join('\n')
  : '_暂无关键结果_'}

## 阻塞项

${summary.blockers.length > 0
  ? summary.blockers.map(b => `- ⚠️ ${b}`).join('\n')
  : '_暂无阻塞项_'}

## 下一步计划

${summary.nextSteps.length > 0
  ? summary.nextSteps.map(s => `- ${s}`).join('\n')
  : '_待定_'}

---
*此文件由协调器自动更新，请勿手动修改*
`;
  }

  /**
   * 写入 JSON 文件
   */
  private async writeJsonFile(filePath: string, data: unknown): Promise<void> {
    try {
      await fs.writeFile(
        filePath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch (error) {
      throw new WorkspaceError(
        `Failed to write JSON file: ${filePath}`,
        filePath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 写入 Markdown 文件
   */
  private async writeMarkdownFile(filePath: string, content: string): Promise<void> {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      throw new WorkspaceError(
        `Failed to write Markdown file: ${filePath}`,
        filePath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 检查工作区是否存在
   */
  async exists(teamId: TeamId): Promise<boolean> {
    const teamPath = this.getTeamPath(teamId);
    try {
      await fs.access(teamPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 销毁工作区（删除所有文件）
   */
  async destroy(teamId: TeamId): Promise<void> {
    const teamPath = this.getTeamPath(teamId);
    try {
      await fs.rm(teamPath, { recursive: true, force: true });
    } catch (error) {
      throw new WorkspaceError(
        `Failed to destroy workspace for team ${teamId}`,
        teamPath,
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * 便捷函数：初始化团队工作区
 */
export async function initializeWorkspace(
  config: TeamConfig,
  basePath?: string
): Promise<WorkspaceConfig> {
  const initializer = new WorkspaceInitializer(basePath);
  return initializer.initialize(config);
}

/**
 * 便捷函数：检查工作区是否存在
 */
export async function workspaceExists(
  teamId: TeamId,
  basePath?: string
): Promise<boolean> {
  const initializer = new WorkspaceInitializer(basePath);
  return initializer.exists(teamId);
}

/**
 * 便捷函数：销毁工作区
 */
export async function destroyWorkspace(
  teamId: TeamId,
  basePath?: string
): Promise<void> {
  const initializer = new WorkspaceInitializer(basePath);
  return initializer.destroy(teamId);
}

// 默认导出
export default WorkspaceInitializer;

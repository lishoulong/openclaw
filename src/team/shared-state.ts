/**
 * OpenClaw 多 Agent 调度方案 - 共享状态管理
 * 
 * 负责读取/写入 coordinator.md、summary.md 和任务列表
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TeamId,
  TaskId,
  Task,
  TaskState,
  CoordinatorState,
  Summary,
  WorkspaceError,
} from './types';

/**
 * 共享状态管理器配置
 */
export interface SharedStateConfig {
  teamId: TeamId;
  basePath: string;
  manifestPath: string;
  coordinatorPath: string;
  summaryPath: string;
  tasksPath: string;
}

/**
 * Markdown 解析结果
 */
interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * 共享状态管理器
 * 
 * 管理 coordinator.md、summary.md 和任务文件的读写操作
 */
export class SharedStateManager {
  private config: SharedStateConfig;

  constructor(config: SharedStateConfig) {
    this.config = config;
  }

  /**
   * 从工作区配置创建状态管理器
   */
  static fromWorkspace(
    teamId: TeamId,
    workspacePath: string,
    structure: {
      manifestPath: string;
      coordinatorPath: string;
      summaryPath: string;
      tasks: {
        todo: string;
        inProgress: string;
        completed: string;
      };
    }
  ): SharedStateManager {
    return new SharedStateManager({
      teamId,
      basePath: workspacePath,
      manifestPath: path.join(workspacePath, structure.manifestPath),
      coordinatorPath: path.join(workspacePath, structure.coordinatorPath),
      summaryPath: path.join(workspacePath, structure.summaryPath),
      tasksPath: path.join(workspacePath, 'tasks'),
    });
  }

  // ============================================================================
  // Coordinator State 管理
  // ============================================================================

  /**
   * 读取协调器状态
   */
  async readCoordinatorState(): Promise<CoordinatorState | null> {
    try {
      const content = await fs.readFile(this.config.coordinatorPath, 'utf-8');
      return this.parseCoordinatorMarkdown(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new WorkspaceError(
        'Failed to read coordinator state',
        this.config.coordinatorPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 写入协调器状态
   */
  async writeCoordinatorState(state: CoordinatorState): Promise<void> {
    const content = this.generateCoordinatorMarkdown(state);
    try {
      await fs.writeFile(this.config.coordinatorPath, content, 'utf-8');
    } catch (error) {
      throw new WorkspaceError(
        'Failed to write coordinator state',
        this.config.coordinatorPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 解析协调器 Markdown
   */
  private parseCoordinatorMarkdown(content: string): CoordinatorState {
    const lines = content.split('\n');
    const state: Partial<CoordinatorState> = {
      teamId: this.config.teamId,
      activeAgents: [],
      pendingTasks: [],
      completedTasks: [],
      messages: [],
    };

    let currentSection: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // 解析最后同步时间
      if (trimmed.startsWith('- **最后同步**:')) {
        state.lastSync = trimmed.replace('- **最后同步**:', '').trim();
      }

      // 识别章节
      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.replace('## ', '').trim();
        continue;
      }

      // 解析活跃 Agent
      if (currentSection === '活跃 Agent' && trimmed.startsWith('- ')) {
        const agentId = trimmed.replace('- ', '').trim();
        if (agentId && !agentId.startsWith('_')) {
          state.activeAgents!.push(agentId);
        }
      }

      // 解析待处理任务
      if (currentSection === '待处理任务' && trimmed.startsWith('- ')) {
        const taskId = trimmed.replace('- ', '').trim();
        if (taskId && !taskId.startsWith('_')) {
          state.pendingTasks!.push(taskId);
        }
      }

      // 解析已完成任务
      if (currentSection === '已完成任务' && trimmed.startsWith('- ')) {
        const taskId = trimmed.replace('- ', '').trim();
        if (taskId && !taskId.startsWith('_')) {
          state.completedTasks!.push(taskId);
        }
      }
    }

    return state as CoordinatorState;
  }

  /**
   * 生成协调器 Markdown
   */
  private generateCoordinatorMarkdown(state: CoordinatorState): string {
    return `# Team Coordinator - ${state.teamId}

## 团队信息

- **Team ID**: ${state.teamId}
- **最后同步**: ${state.lastSync}

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

  // ============================================================================
  // Summary 管理
  // ============================================================================

  /**
   * 读取摘要
   */
  async readSummary(): Promise<Summary | null> {
    try {
      const content = await fs.readFile(this.config.summaryPath, 'utf-8');
      return this.parseSummaryMarkdown(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new WorkspaceError(
        'Failed to read summary',
        this.config.summaryPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 写入摘要
   */
  async writeSummary(summary: Summary): Promise<void> {
    const content = this.generateSummaryMarkdown(summary);
    try {
      await fs.writeFile(this.config.summaryPath, content, 'utf-8');
    } catch (error) {
      throw new WorkspaceError(
        'Failed to write summary',
        this.config.summaryPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 更新摘要（部分更新）
   */
  async updateSummary(updates: Partial<Omit<Summary, 'teamId' | 'generatedAt'>>): Promise<Summary> {
    const existing = await this.readSummary();
    const now = new Date().toISOString();

    const summary: Summary = {
      teamId: this.config.teamId,
      generatedAt: now,
      overallProgress: updates.overallProgress ?? existing?.overallProgress ?? 0,
      completedTasks: updates.completedTasks ?? existing?.completedTasks ?? 0,
      totalTasks: updates.totalTasks ?? existing?.totalTasks ?? 0,
      keyResults: updates.keyResults ?? existing?.keyResults ?? [],
      blockers: updates.blockers ?? existing?.blockers ?? [],
      nextSteps: updates.nextSteps ?? existing?.nextSteps ?? [],
    };

    await this.writeSummary(summary);
    return summary;
  }

  /**
   * 解析摘要 Markdown
   */
  private parseSummaryMarkdown(content: string): Summary {
    const lines = content.split('\n');
    const summary: Partial<Summary> = {
      teamId: this.config.teamId,
      keyResults: [],
      blockers: [],
      nextSteps: [],
    };

    let currentSection: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // 解析生成时间
      if (trimmed.startsWith('- **生成时间**:')) {
        summary.generatedAt = trimmed.replace('- **生成时间**:', '').trim();
      }

      // 解析完成度
      if (trimmed.startsWith('- **完成度**:')) {
        const progressStr = trimmed.replace('- **完成度**:', '').replace('%', '').trim();
        summary.overallProgress = parseInt(progressStr, 10) || 0;
      }

      // 解析任务统计
      if (trimmed.startsWith('- **已完成任务**:')) {
        const match = trimmed.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          summary.completedTasks = parseInt(match[1], 10) || 0;
          summary.totalTasks = parseInt(match[2], 10) || 0;
        }
      }

      // 识别章节
      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.replace('## ', '').trim();
        continue;
      }

      // 解析列表项
      if (trimmed.startsWith('- ') && !trimmed.startsWith('_')) {
        const item = trimmed.replace('- ', '').replace('⚠️ ', '').trim();
        
        switch (currentSection) {
          case '关键结果':
            summary.keyResults!.push(item);
            break;
          case '阻塞项':
            summary.blockers!.push(item);
            break;
          case '下一步计划':
            summary.nextSteps!.push(item);
            break;
        }
      }
    }

    return summary as Summary;
  }

  /**
   * 生成摘要 Markdown
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

  // ============================================================================
  // 任务列表管理
  // ============================================================================

  /**
   * 获取任务文件路径
   */
  private getTaskPath(taskId: TaskId, state: TaskState): string {
    const stateDir = {
      [TaskState.TODO]: 'todo',
      [TaskState.IN_PROGRESS]: 'in-progress',
      [TaskState.COMPLETED]: 'completed',
      [TaskState.FAILED]: 'todo', // 失败的任务暂时回到 todo
      [TaskState.CANCELLED]: 'completed', // 取消的任务放入 completed
    }[state];

    return path.join(this.config.tasksPath, stateDir, `${taskId}.json`);
  }

  /**
   * 创建任务
   */
  async createTask(task: Task): Promise<void> {
    const taskPath = this.getTaskPath(task.taskId, task.state);
    
    try {
      await fs.writeFile(
        taskPath,
        JSON.stringify(task, null, 2),
        'utf-8'
      );
    } catch (error) {
      throw new WorkspaceError(
        `Failed to create task ${task.taskId}`,
        taskPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 读取任务
   */
  async readTask(taskId: TaskId, state: TaskState): Promise<Task | null> {
    const taskPath = this.getTaskPath(taskId, state);
    
    try {
      const content = await fs.readFile(taskPath, 'utf-8');
      return JSON.parse(content) as Task;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new WorkspaceError(
        `Failed to read task ${taskId}`,
        taskPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 更新任务（会自动移动文件到对应状态目录）
   */
  async updateTask(task: Task): Promise<void> {
    // 先尝试在所有可能的位置找到旧任务
    const states: TaskState[] = [
      TaskState.TODO,
      TaskState.IN_PROGRESS,
      TaskState.COMPLETED,
      TaskState.FAILED,
    ];

    // 删除旧状态文件
    for (const state of states) {
      const oldPath = this.getTaskPath(task.taskId, state);
      try {
        await fs.unlink(oldPath);
      } catch {
        // 忽略不存在的错误
      }
    }

    // 写入新状态
    task.updatedAt = new Date();
    await this.createTask(task);
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: TaskId, state: TaskState): Promise<void> {
    const taskPath = this.getTaskPath(taskId, state);
    
    try {
      await fs.unlink(taskPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new WorkspaceError(
          `Failed to delete task ${taskId}`,
          taskPath,
          error instanceof Error ? error : undefined
        );
      }
    }
  }

  /**
   * 列出所有任务
   */
  async listTasks(state?: TaskState): Promise<Task[]> {
    const states = state ? [state] : [
      TaskState.TODO,
      TaskState.IN_PROGRESS,
      TaskState.COMPLETED,
    ];

    const tasks: Task[] = [];

    for (const s of states) {
      const dirPath = path.join(
        this.config.tasksPath,
        {
          [TaskState.TODO]: 'todo',
          [TaskState.IN_PROGRESS]: 'in-progress',
          [TaskState.COMPLETED]: 'completed',
          [TaskState.FAILED]: 'todo',
          [TaskState.CANCELLED]: 'completed',
        }[s]
      );

      try {
        const files = await fs.readdir(dirPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
          const taskId = file.replace('.json', '');
          const task = await this.readTask(taskId, s);
          if (task) {
            tasks.push(task);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new WorkspaceError(
            `Failed to list tasks in state ${s}`,
            dirPath,
            error instanceof Error ? error : undefined
          );
        }
      }
    }

    return tasks;
  }

  /**
   * 移动任务到不同状态
   */
  async moveTask(taskId: TaskId, fromState: TaskState, toState: TaskState): Promise<void> {
    const task = await this.readTask(taskId, fromState);
    if (!task) {
      throw new WorkspaceError(
        `Task ${taskId} not found in state ${fromState}`,
        this.getTaskPath(taskId, fromState)
      );
    }

    task.state = toState;
    if (toState === TaskState.COMPLETED) {
      task.completedAt = new Date();
    }

    await this.updateTask(task);
  }

  /**
   * 获取任务统计
   */
  async getTaskStats(): Promise<{
    todo: number;
    inProgress: number;
    completed: number;
    failed: number;
    total: number;
  }> {
    const [todo, inProgress, completed] = await Promise.all([
      this.listTasks(TaskState.TODO),
      this.listTasks(TaskState.IN_PROGRESS),
      this.listTasks(TaskState.COMPLETED),
    ]);

    return {
      todo: todo.length,
      inProgress: inProgress.length,
      completed: completed.length,
      failed: 0, // 失败的任务在 todo 中
      total: todo.length + inProgress.length + completed.length,
    };
  }

  // ============================================================================
  // 批量操作
  // ============================================================================

  /**
   * 批量创建任务
   */
  async batchCreateTasks(tasks: Task[]): Promise<void> {
    await Promise.all(tasks.map(task => this.createTask(task)));
  }

  /**
   * 批量更新任务
   */
  async batchUpdateTasks(tasks: Task[]): Promise<void> {
    await Promise.all(tasks.map(task => this.updateTask(task)));
  }

  /**
   * 批量删除任务
   */
  async batchDeleteTasks(taskIds: Array<{ taskId: TaskId; state: TaskState }>): Promise<void> {
    await Promise.all(taskIds.map(({ taskId, state }) => this.deleteTask(taskId, state)));
  }
}

/**
 * 创建共享状态管理器的便捷函数
 */
export function createSharedStateManager(
  config: SharedStateConfig
): SharedStateManager {
  return new SharedStateManager(config);
}

// 默认导出
export default SharedStateManager;

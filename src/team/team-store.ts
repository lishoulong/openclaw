/**
 * Team Store - 团队存储管理
 * 负责团队配置的持久化存储和读取
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  Team,
  TeamConfig,
  TeamManifest,
  TeamState,
  TeamStats,
  TeamError,
  TeamErrorCode,
} from './types.js';

export interface StoreOptions {
  basePath?: string;
}

export class TeamStore {
  private readonly basePath: string;
  private readonly version = '1.0.0';

  constructor(options: StoreOptions = {}) {
    this.basePath = options.basePath || this.getDefaultBasePath();
  }

  /**
   * 获取默认存储路径
   */
  private getDefaultBasePath(): string {
    return path.join(os.homedir(), '.openclaw', 'workspace', 'teams');
  }

  /**
   * 确保存储目录存在
   */
  private async ensureBaseDir(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
    } catch (error) {
      throw new TeamError(
        TeamErrorCode.WORKSPACE_ERROR,
        `Failed to create teams directory: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 获取团队目录路径
   */
  private getTeamDir(teamId: string): string {
    return path.join(this.basePath, teamId);
  }

  /**
   * 获取 manifest 文件路径
   */
  private getManifestPath(teamId: string): string {
    return path.join(this.getTeamDir(teamId), 'manifest.json');
  }

  /**
   * 检查团队是否存在
   */
  async exists(teamId: string): Promise<boolean> {
    try {
      const manifestPath = this.getManifestPath(teamId);
      await fs.access(manifestPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建团队目录结构
   */
  async createWorkspace(teamId: string): Promise<void> {
    const teamDir = this.getTeamDir(teamId);
    const dirs = [
      teamDir,
      path.join(teamDir, 'mailbox'),
      path.join(teamDir, 'tasks'),
      path.join(teamDir, 'agents'),
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        throw new TeamError(
          TeamErrorCode.WORKSPACE_ERROR,
          `Failed to create workspace directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        );
      }
    }

    // 创建默认文件
    const files = [
      { path: path.join(teamDir, 'coordinator.md'), content: `# Coordinator Notes\n\nTeam: ${teamId}\nCreated: ${new Date().toISOString()}\n` },
      { path: path.join(teamDir, 'summary.md'), content: `# Team Summary\n\nTeam: ${teamId}\nStatus: pending\n\n## Progress\n\n- [ ] Initial planning\n- [ ] Task assignment\n- [ ] Execution\n- [ ] Review\n` },
    ];

    for (const file of files) {
      try {
        await fs.writeFile(file.path, file.content, 'utf-8');
      } catch (error) {
        throw new TeamError(
          TeamErrorCode.WORKSPACE_ERROR,
          `Failed to create file ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        );
      }
    }
  }

  /**
   * 删除团队工作区
   */
  async removeWorkspace(teamId: string): Promise<void> {
    const teamDir = this.getTeamDir(teamId);
    
    try {
      await fs.rm(teamDir, { recursive: true, force: true });
    } catch (error) {
      // 目录不存在不算错误
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new TeamError(
          TeamErrorCode.WORKSPACE_ERROR,
          `Failed to remove workspace for team ${teamId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        );
      }
    }
  }

  /**
   * 保存团队 manifest
   */
  async saveManifest(team: Team): Promise<void> {
    await this.ensureBaseDir();
    
    const manifest: TeamManifest = {
      version: this.version,
      teamId: team.teamId,
      name: team.name,
      state: team.state,
      config: team.config,
      createdAt: team.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
      agentIds: Array.from(team.agentStates.keys()),
      stats: team.stats,
    };

    const manifestPath = this.getManifestPath(team.teamId);
    
    try {
      await fs.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        'utf-8'
      );
    } catch (error) {
      throw new TeamError(
        TeamErrorCode.STORE_ERROR,
        `Failed to save manifest for team ${team.teamId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 加载团队 manifest
   */
  async loadManifest(teamId: string): Promise<TeamManifest> {
    const manifestPath = this.getManifestPath(teamId);

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as TeamManifest;
      
      // 验证版本兼容性
      if (!manifest.version) {
        throw new TeamError(
          TeamErrorCode.STORE_ERROR,
          `Manifest for team ${teamId} is missing version field`
        );
      }
      
      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TeamError(
          TeamErrorCode.TEAM_NOT_FOUND,
          `Team ${teamId} not found`
        );
      }
      
      if (error instanceof TeamError) {
        throw error;
      }
      
      throw new TeamError(
        TeamErrorCode.STORE_ERROR,
        `Failed to load manifest for team ${teamId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 从 manifest 创建 Team 对象
   */
  manifestToTeam(manifest: TeamManifest): Team {
    const agentStates = new Map();
    
    // 从 lead 和 members 初始化 agent 状态
    if (manifest.config.lead) {
      agentStates.set(manifest.config.lead.agentId, {
        agentId: manifest.config.lead.agentId,
        status: 'idle',
        retryCount: 0,
      });
    }
    
    for (const member of manifest.config.members) {
      agentStates.set(member.agentId, {
        agentId: member.agentId,
        status: 'idle',
        retryCount: 0,
      });
    }

    return {
      teamId: manifest.teamId,
      name: manifest.name,
      state: manifest.state,
      config: manifest.config,
      createdAt: new Date(manifest.createdAt),
      updatedAt: new Date(manifest.updatedAt),
      agentStates,
      stats: manifest.stats || {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalRetries: 0,
        averageTaskTime: 0,
      },
      version: 1,
    };
  }

  /**
   * 加载团队
   */
  async load(teamId: string): Promise<Team> {
    const manifest = await this.loadManifest(teamId);
    return this.manifestToTeam(manifest);
  }

  /**
   * 列出所有团队
   */
  async list(): Promise<TeamManifest[]> {
    await this.ensureBaseDir();

    try {
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      const teams: TeamManifest[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const manifest = await this.loadManifest(entry.name);
            teams.push(manifest);
          } catch (error) {
            // 跳过无效的目录
            if (!(error instanceof TeamError && error.code === TeamErrorCode.TEAM_NOT_FOUND)) {
              console.warn(`Failed to load team ${entry.name}:`, error);
            }
          }
        }
      }

      // 按更新时间排序
      return teams.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      
      throw new TeamError(
        TeamErrorCode.STORE_ERROR,
        `Failed to list teams: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 更新团队状态
   */
  async updateState(teamId: string, state: TeamState): Promise<void> {
    const team = await this.load(teamId);
    team.state = state;
    team.updatedAt = new Date();
    await this.saveManifest(team);
  }

  /**
   * 获取团队工作区路径
   */
  getWorkspacePath(teamId: string): string {
    return this.getTeamDir(teamId);
  }

  /**
   * 获取团队邮箱路径
   */
  getMailboxPath(teamId: string): string {
    return path.join(this.getTeamDir(teamId), 'mailbox');
  }

  /**
   * 获取团队任务路径
   */
  getTasksPath(teamId: string): string {
    return path.join(this.getTeamDir(teamId), 'tasks');
  }

  /**
   * 获取 Agent 配置路径
   */
  getAgentPath(teamId: string, agentId: string): string {
    return path.join(this.getTeamDir(teamId), 'agents', agentId);
  }

  /**
   * 保存 Agent 配置
   */
  async saveAgentConfig(teamId: string, agentId: string, config: Record<string, unknown>): Promise<void> {
    const agentDir = this.getAgentPath(teamId, agentId);
    
    try {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        path.join(agentDir, 'config.json'),
        JSON.stringify(config, null, 2),
        'utf-8'
      );
    } catch (error) {
      throw new TeamError(
        TeamErrorCode.STORE_ERROR,
        `Failed to save agent config for ${agentId} in team ${teamId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}

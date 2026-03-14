/**
 * Team Manager - 团队管理器
 * OpenClaw 多 Agent 调度方案核心组件
 * 负责团队的创建、销毁、暂停、恢复等生命周期管理
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import {
  Team,
  TeamConfig,
  TeamState,
  AgentRuntimeState,
  OperationResult,
  TeamListItem,
  TeamError,
  TeamErrorCode,
  AgentConfig,
} from './types.js';
import { TeamStore } from './team-store.js';
import { ConfigParser } from './config-parser.js';

export interface TeamManagerOptions {
  store?: TeamStore;
  configParser?: ConfigParser;
  workspaceBasePath?: string;
}

export class TeamManager extends EventEmitter {
  private store: TeamStore;
  private configParser: ConfigParser;
  private teams: Map<string, Team> = new Map();
  private readonly workspaceBasePath: string;

  constructor(options: TeamManagerOptions = {}) {
    super();
    this.workspaceBasePath = options.workspaceBasePath || 
      path.join(os.homedir(), '.openclaw', 'workspace');
    this.store = options.store || new TeamStore({ basePath: path.join(this.workspaceBasePath, 'teams') });
    this.configParser = options.configParser || new ConfigParser();
  }

  /**
   * 创建团队
   * @param config 团队配置
   * @returns 操作结果
   */
  async createTeam(config: TeamConfig): Promise<OperationResult<Team>> {
    try {
      // 检查团队是否已存在
      const exists = await this.store.exists(config.teamId);
      if (exists) {
        return {
          success: false,
          error: `Team ${config.teamId} already exists`,
          code: TeamErrorCode.TEAM_ALREADY_EXISTS,
        };
      }

      // 创建团队目录结构
      await this.store.createWorkspace(config.teamId);

      // 创建 Agent 状态映射
      const agentStates = new Map<string, AgentRuntimeState>();

      // 初始化 lead
      if (config.lead) {
        agentStates.set(config.lead.agentId, {
          agentId: config.lead.agentId,
          status: 'idle',
          retryCount: 0,
        });
        
        // 保存 Agent 配置
        await this.store.saveAgentConfig(config.teamId, config.lead.agentId, {
          ...config.lead,
          isLead: true,
        });
      }

      // 初始化 members
      for (const member of config.members) {
        agentStates.set(member.agentId, {
          agentId: member.agentId,
          status: 'idle',
          retryCount: 0,
        });

        // 保存 Agent 配置
        await this.store.saveAgentConfig(config.teamId, member.agentId, {
          ...member,
          isLead: false,
        });
      }

      // 创建 Team 对象
      const now = new Date();
      const team: Team = {
        teamId: config.teamId,
        name: config.name,
        state: TeamState.PENDING,
        config,
        createdAt: now,
        updatedAt: now,
        agentStates,
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        version: 1,
      };

      // 保存到存储
      await this.store.saveManifest(team);

      // 缓存到内存
      this.teams.set(config.teamId, team);

      // 触发事件
      this.emit('team:created', { teamId: team.teamId, config });

      return {
        success: true,
        data: team,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.STORE_ERROR;
      
      return {
        success: false,
        error: `Failed to create team: ${errorMessage}`,
        code: errorCode,
      };
    }
  }

  /**
   * 从配置文件创建团队
   * @param filePath YAML 配置文件路径
   * @returns 操作结果
   */
  async createTeamFromConfig(filePath: string): Promise<OperationResult<Team>> {
    try {
      const config = await this.configParser.parseFromFile(filePath);
      return await this.createTeam(config);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.CONFIG_INVALID;
      
      return {
        success: false,
        error: `Failed to create team from config: ${errorMessage}`,
        code: errorCode,
      };
    }
  }

  /**
   * 销毁团队
   * @param teamId 团队 ID
   * @param force 是否强制销毁（即使团队正在运行）
   * @returns 操作结果
   */
  async destroyTeam(teamId: string, force: boolean = false): Promise<OperationResult<void>> {
    try {
      // 加载团队
      const team = await this.loadTeam(teamId);
      
      // 检查状态
      if (!force && team.state === TeamState.RUNNING) {
        return {
          success: false,
          error: `Team ${teamId} is currently running. Stop it first or use force=true`,
          code: TeamErrorCode.TEAM_STATE_INVALID,
        };
      }

      // 如果正在运行，先停止
      if (team.state === TeamState.RUNNING) {
        const stopResult = await this.pauseTeam(teamId);
        if (!stopResult.success) {
          return stopResult;
        }
      }

      // 更新状态为 STOPPING
      team.state = TeamState.STOPPING;
      await this.store.saveManifest(team);

      // 触发事件
      this.emit('team:destroying', { teamId });

      // 删除工作区
      await this.store.removeWorkspace(teamId);

      // 从内存中移除
      this.teams.delete(teamId);

      // 触发事件
      this.emit('team:destroyed', { teamId });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.STORE_ERROR;
      
      return {
        success: false,
        error: `Failed to destroy team: ${errorMessage}`,
        code: errorCode,
      };
    }
  }

  /**
   * 获取团队信息
   * @param teamId 团队 ID
   * @returns 操作结果
   */
  async getTeam(teamId: string): Promise<OperationResult<Team>> {
    try {
      const team = await this.loadTeam(teamId);
      return {
        success: true,
        data: team,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.TEAM_NOT_FOUND;
      
      return {
        success: false,
        error: errorMessage,
        code: errorCode,
      };
    }
  }

  /**
   * 列出所有团队
   * @returns 操作结果
   */
  async listTeams(): Promise<OperationResult<TeamListItem[]>> {
    try {
      const manifests = await this.store.list();
      
      const items: TeamListItem[] = manifests.map(m => ({
        teamId: m.teamId,
        name: m.name,
        state: m.state,
        memberCount: m.agentIds.length,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt),
      }));

      return {
        success: true,
        data: items,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        error: `Failed to list teams: ${errorMessage}`,
        code: TeamErrorCode.STORE_ERROR,
      };
    }
  }

  /**
   * 暂停团队
   * @param teamId 团队 ID
   * @returns 操作结果
   */
  async pauseTeam(teamId: string): Promise<OperationResult<void>> {
    return this.transitionState(teamId, TeamState.PAUSED, [TeamState.RUNNING]);
  }

  /**
   * 恢复团队
   * @param teamId 团队 ID
   * @returns 操作结果
   */
  async resumeTeam(teamId: string): Promise<OperationResult<void>> {
    return this.transitionState(teamId, TeamState.RUNNING, [TeamState.PAUSED, TeamState.PENDING, TeamState.ERROR]);
  }

  /**
   * 启动团队
   * @param teamId 团队 ID
   * @returns 操作结果
   */
  async startTeam(teamId: string): Promise<OperationResult<void>> {
    return this.transitionState(teamId, TeamState.RUNNING, [TeamState.PENDING, TeamState.PAUSED, TeamState.ERROR]);
  }

  /**
   * 停止团队
   * @param teamId 团队 ID
   * @returns 操作结果
   */
  async stopTeam(teamId: string): Promise<OperationResult<void>> {
    return this.transitionState(teamId, TeamState.STOPPED, [TeamState.RUNNING, TeamState.PAUSED, TeamState.ERROR]);
  }

  /**
   * 更新团队配置
   * @param teamId 团队 ID
   * @param updates 配置更新
   * @returns 操作结果
   */
  async updateTeamConfig(teamId: string, updates: Partial<TeamConfig>): Promise<OperationResult<Team>> {
    try {
      const team = await this.loadTeam(teamId);

      // 不允许在运行时修改某些关键配置
      if (team.state === TeamState.RUNNING) {
        const forbiddenFields = ['teamId', 'coordinationMode'];
        for (const field of forbiddenFields) {
          if (field in updates) {
            return {
              success: false,
              error: `Cannot modify ${field} while team is running`,
              code: TeamErrorCode.TEAM_STATE_INVALID,
            };
          }
        }
      }

      // 应用更新
      team.config = { ...team.config, ...updates };
      team.updatedAt = new Date();
      team.version += 1;

      // 保存
      await this.store.saveManifest(team);
      this.teams.set(teamId, team);

      // 触发事件
      this.emit('team:updated', { teamId, updates });

      return {
        success: true,
        data: team,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.STORE_ERROR;
      
      return {
        success: false,
        error: `Failed to update team: ${errorMessage}`,
        code: errorCode,
      };
    }
  }

  /**
   * 添加 Agent 到团队
   * @param teamId 团队 ID
   * @param agentConfig Agent 配置
   * @returns 操作结果
   */
  async addAgent(teamId: string, agentConfig: AgentConfig): Promise<OperationResult<Team>> {
    try {
      const team = await this.loadTeam(teamId);

      // 检查 Agent 是否已存在
      if (team.agentStates.has(agentConfig.agentId)) {
        return {
          success: false,
          error: `Agent ${agentConfig.agentId} already exists in team ${teamId}`,
          code: TeamErrorCode.AGENT_ALREADY_EXISTS,
        };
      }

      // 添加 Agent
      team.config.members.push(agentConfig);
      team.agentStates.set(agentConfig.agentId, {
        agentId: agentConfig.agentId,
        status: 'idle',
        retryCount: 0,
      });

      // 保存 Agent 配置
      await this.store.saveAgentConfig(teamId, agentConfig.agentId, {
        ...agentConfig,
        isLead: false,
      });

      team.updatedAt = new Date();
      await this.store.saveManifest(team);
      this.teams.set(teamId, team);

      // 触发事件
      this.emit('agent:added', { teamId, agentId: agentConfig.agentId });

      return {
        success: true,
        data: team,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.STORE_ERROR;
      
      return {
        success: false,
        error: `Failed to add agent: ${errorMessage}`,
        code: errorCode,
      };
    }
  }

  /**
   * 从团队移除 Agent
   * @param teamId 团队 ID
   * @param agentId Agent ID
   * @returns 操作结果
   */
  async removeAgent(teamId: string, agentId: string): Promise<OperationResult<Team>> {
    try {
      const team = await this.loadTeam(teamId);

      // 检查是否是 lead
      if (team.config.lead?.agentId === agentId) {
        return {
          success: false,
          error: `Cannot remove lead agent. Use setLead to change lead first.`,
          code: TeamErrorCode.AGENT_NOT_FOUND,
        };
      }

      // 从 members 中移除
      const index = team.config.members.findIndex(m => m.agentId === agentId);
      if (index === -1) {
        return {
          success: false,
          error: `Agent ${agentId} not found in team ${teamId}`,
          code: TeamErrorCode.AGENT_NOT_FOUND,
        };
      }

      team.config.members.splice(index, 1);
      team.agentStates.delete(agentId);
      
      team.updatedAt = new Date();
      await this.store.saveManifest(team);
      this.teams.set(teamId, team);

      // 触发事件
      this.emit('agent:removed', { teamId, agentId });

      return {
        success: true,
        data: team,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.STORE_ERROR;
      
      return {
        success: false,
        error: `Failed to remove agent: ${errorMessage}`,
        code: errorCode,
      };
    }
  }

  /**
   * 获取团队工作区路径
   * @param teamId 团队 ID
   * @returns 工作区路径
   */
  getWorkspacePath(teamId: string): string {
    return this.store.getWorkspacePath(teamId);
  }

  /**
   * 获取团队邮箱路径
   * @param teamId 团队 ID
   * @returns 邮箱路径
   */
  getMailboxPath(teamId: string): string {
    return this.store.getMailboxPath(teamId);
  }

  /**
   * 获取团队任务路径
   * @param teamId 团队 ID
   * @returns 任务路径
   */
  getTasksPath(teamId: string): string {
    return this.store.getTasksPath(teamId);
  }

  /**
   * 状态转换辅助方法
   */
  private async transitionState(
    teamId: string,
    targetState: TeamState,
    allowedFrom: TeamState[]
  ): Promise<OperationResult<void>> {
    try {
      const team = await this.loadTeam(teamId);

      // 检查当前状态是否允许转换
      if (!allowedFrom.includes(team.state)) {
        return {
          success: false,
          error: `Cannot transition from ${team.state} to ${targetState}`,
          code: TeamErrorCode.TEAM_STATE_INVALID,
        };
      }

      // 更新状态
      const oldState = team.state;
      team.state = targetState;
      team.updatedAt = new Date();

      await this.store.saveManifest(team);

      // 触发事件
      this.emit('team:stateChanged', { 
        teamId, 
        oldState, 
        newState: targetState 
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof TeamError ? error.code : TeamErrorCode.STORE_ERROR;
      
      return {
        success: false,
        error: errorMessage,
        code: errorCode,
      };
    }
  }

  /**
   * 加载团队（带缓存）
   */
  private async loadTeam(teamId: string): Promise<Team> {
    // 检查内存缓存
    const cached = this.teams.get(teamId);
    if (cached) {
      return cached;
    }

    // 从存储加载
    const team = await this.store.load(teamId);
    this.teams.set(teamId, team);
    return team;
  }

  /**
   * 重新加载所有团队到内存
   */
  async reloadTeams(): Promise<void> {
    this.teams.clear();
    const manifests = await this.store.list();
    
    for (const manifest of manifests) {
      const team = this.store.manifestToTeam(manifest);
      this.teams.set(team.teamId, team);
    }
  }

  /**
   * 获取团队统计信息
   */
  async getTeamStats(teamId: string): Promise<OperationResult<{
    state: TeamState;
    agentCount: number;
    activeAgents: number;
    stats: Record<string, unknown>;
  }>> {
    try {
      const team = await this.loadTeam(teamId);
      
      const activeAgents = Array.from(team.agentStates.values())
        .filter(a => a.status === 'working').length;

      return {
        success: true,
        data: {
          state: team.state,
          agentCount: team.agentStates.size,
          activeAgents,
          stats: team.stats,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        error: errorMessage,
        code: error instanceof TeamError ? error.code : TeamErrorCode.TEAM_NOT_FOUND,
      };
    }
  }
}

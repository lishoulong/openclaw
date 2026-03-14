/**
 * OpenClaw 多 Agent 调度方案 - Hub-and-Spoke 协调器
 * 
 * 实现中心化的任务分配、结果汇总和状态同步机制
 */

import {
  TeamId,
  AgentId,
  TaskId,
  Task,
  TaskState,
  TaskResult,
  AgentState,
  TeamMember,
  CoordinatorMessage,
  CoordinatorState,
  CoordinatorError,
  CoordinationMode,
} from './types';
import { SharedStateManager } from './shared-state';

/**
 * 任务分配策略
 */
export type AssignmentStrategy = 'round-robin' | 'least-loaded' | 'role-based' | 'manual';

/**
 * 任务分配结果
 */
export interface AssignmentResult {
  success: boolean;
  taskId?: TaskId;
  assignee?: AgentId;
  error?: string;
}

/**
 * 结果汇总回调
 */
export type ResultAggregator = (results: TaskResult[]) => TaskResult;

/**
 * 协调器配置
 */
export interface CoordinatorConfig {
  teamId: TeamId;
  mode: CoordinationMode;
  assignmentStrategy: AssignmentStrategy;
  maxConcurrentTasks?: number;
  resultAggregator?: ResultAggregator;
}

/**
 * Hub-and-Spoke 协调器
 * 
 * 所有 Agent 通过中心协调器进行通信，协调器负责任务分配和结果汇总
 */
export class Coordinator {
  private config: CoordinatorConfig;
  private stateManager: SharedStateManager;
  private members: Map<AgentId, TeamMember> = new Map();
  private tasks: Map<TaskId, Task> = new Map();
  private messageQueue: CoordinatorMessage[] = [];
  private assignmentIndex: number = 0;

  constructor(config: CoordinatorConfig, stateManager: SharedStateManager) {
    this.config = config;
    this.stateManager = stateManager;
  }

  /**
   * 初始化协调器
   */
  async initialize(): Promise<void> {
    // 从共享状态加载现有数据
    const state = await this.stateManager.readCoordinatorState();
    
    // 恢复活跃 Agent 列表
    if (state) {
      for (const agentId of state.activeAgents) {
        this.members.set(agentId, {
          agentId,
          role: 'custom',
          state: AgentState.IDLE,
        });
      }
    }

    await this.syncState();
  }

  /**
   * 注册 Agent
   */
  async registerAgent(member: TeamMember): Promise<void> {
    this.members.set(member.agentId, member);
    
    // 发送注册消息
    await this.sendMessage({
      messageId: this.generateMessageId(),
      type: 'status_update',
      from: member.agentId,
      timestamp: new Date(),
      payload: {
        event: 'agent_registered',
        role: member.role,
      },
    });

    await this.syncState();
  }

  /**
   * 注销 Agent
   */
  async unregisterAgent(agentId: AgentId): Promise<void> {
    const member = this.members.get(agentId);
    if (!member) {
      throw new CoordinatorError(`Agent ${agentId} not found`);
    }

    // 如果 Agent 有正在执行的任务，需要处理
    if (member.assignedTask) {
      await this.handleTaskFailure(member.assignedTask, `Agent ${agentId} unregistered`);
    }

    this.members.delete(agentId);

    await this.sendMessage({
      messageId: this.generateMessageId(),
      type: 'status_update',
      from: agentId,
      timestamp: new Date(),
      payload: {
        event: 'agent_unregistered',
      },
    });

    await this.syncState();
  }

  /**
   * 创建任务
   */
  async createTask(
    title: string,
    description: string,
    options?: {
      priority?: number;
      parentTaskId?: TaskId;
      assignee?: AgentId;
    }
  ): Promise<Task> {
    const taskId = this.generateTaskId();
    const now = new Date();

    const task: Task = {
      taskId,
      title,
      description,
      state: TaskState.TODO,
      createdAt: now,
      updatedAt: now,
      priority: options?.priority ?? 0,
      parentTaskId: options?.parentTaskId,
    };

    this.tasks.set(taskId, task);

    // 如果指定了分配对象，直接分配
    if (options?.assignee) {
      await this.assignTask(taskId, options.assignee);
    }

    await this.syncState();
    return task;
  }

  /**
   * 分配任务
   */
  async assignTask(taskId: TaskId, assignee?: AgentId): Promise<AssignmentResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    if (task.state !== TaskState.TODO) {
      return { success: false, error: `Task ${taskId} is not in TODO state` };
    }

    // 确定分配目标
    let targetAgent: AgentId | undefined = assignee;
    if (!targetAgent) {
      targetAgent = this.selectAgentForTask(task);
    }

    if (!targetAgent) {
      return { success: false, error: 'No available agent for task assignment' };
    }

    const member = this.members.get(targetAgent);
    if (!member) {
      return { success: false, error: `Agent ${targetAgent} not found` };
    }

    if (member.state !== AgentState.IDLE) {
      return { success: false, error: `Agent ${targetAgent} is not available` };
    }

    // 更新任务状态
    task.state = TaskState.IN_PROGRESS;
    task.assignee = targetAgent;
    task.updatedAt = new Date();

    // 更新 Agent 状态
    member.state = AgentState.ASSIGNED;
    member.assignedTask = taskId;

    // 发送任务分配消息
    await this.sendMessage({
      messageId: this.generateMessageId(),
      type: 'task_assignment',
      from: 'coordinator',
      to: targetAgent,
      timestamp: new Date(),
      payload: {
        taskId,
        title: task.title,
        description: task.description,
      },
    });

    await this.syncState();

    return {
      success: true,
      taskId,
      assignee: targetAgent,
    };
  }

  /**
   * 提交任务结果
   */
  async submitTaskResult(
    agentId: AgentId,
    taskId: TaskId,
    result: TaskResult
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new CoordinatorError(`Task ${taskId} not found`);
    }

    if (task.assignee !== agentId) {
      throw new CoordinatorError(
        `Task ${taskId} is not assigned to agent ${agentId}`,
        agentId
      );
    }

    const member = this.members.get(agentId);
    if (!member) {
      throw new CoordinatorError(`Agent ${agentId} not found`, agentId);
    }

    // 更新任务状态
    task.state = result.success ? TaskState.COMPLETED : TaskState.FAILED;
    task.result = result;
    task.updatedAt = new Date();
    if (result.success) {
      task.completedAt = new Date();
    }

    // 更新 Agent 状态
    member.state = AgentState.IDLE;
    member.assignedTask = undefined;

    // 发送结果消息
    await this.sendMessage({
      messageId: this.generateMessageId(),
      type: 'task_result',
      from: agentId,
      to: 'coordinator',
      timestamp: new Date(),
      payload: {
        taskId,
        result,
      },
    });

    await this.syncState();
  }

  /**
   * 处理任务失败
   */
  async handleTaskFailure(taskId: TaskId, reason: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new CoordinatorError(`Task ${taskId} not found`);
    }

    // 释放 Agent
    if (task.assignee) {
      const member = this.members.get(task.assignee);
      if (member) {
        member.state = AgentState.IDLE;
        member.assignedTask = undefined;
      }
    }

    task.state = TaskState.FAILED;
    task.result = {
      success: false,
      error: reason,
    };
    task.updatedAt = new Date();

    await this.syncState();
  }

  /**
   * 重新分配失败的任务
   */
  async reassignTask(taskId: TaskId, newAssignee?: AgentId): Promise<AssignmentResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    if (task.state !== TaskState.FAILED) {
      return { success: false, error: `Task ${taskId} is not in FAILED state` };
    }

    // 重置任务状态
    task.state = TaskState.TODO;
    task.assignee = undefined;
    task.result = undefined;
    task.updatedAt = new Date();

    return this.assignTask(taskId, newAssignee);
  }

  /**
   * 汇总所有任务结果
   */
  async aggregateResults(): Promise<TaskResult> {
    const results: TaskResult[] = [];
    
    for (const task of this.tasks.values()) {
      if (task.result) {
        results.push(task.result);
      }
    }

    // 使用配置的聚合器或默认聚合逻辑
    if (this.config.resultAggregator) {
      return this.config.resultAggregator(results);
    }

    // 默认聚合逻辑
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

    return {
      success: failedCount === 0,
      output: `Completed ${successCount}/${results.length} tasks`,
      summary: results
        .filter(r => r.summary)
        .map(r => r.summary!)
        .join('\n'),
    };
  }

  /**
   * 广播消息给所有 Agent
   */
  async broadcast(from: AgentId, payload: unknown): Promise<void> {
    await this.sendMessage({
      messageId: this.generateMessageId(),
      type: 'broadcast',
      from,
      timestamp: new Date(),
      payload,
    });
  }

  /**
   * 获取 Agent 列表
   */
  getAgents(): TeamMember[] {
    return Array.from(this.members.values());
  }

  /**
   * 获取任务列表
   */
  getTasks(state?: TaskState): Task[] {
    const tasks = Array.from(this.tasks.values());
    if (state) {
      return tasks.filter(t => t.state === state);
    }
    return tasks;
  }

  /**
   * 获取特定任务
   */
  getTask(taskId: TaskId): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取协调器状态
   */
  async getState(): Promise<CoordinatorState> {
    return {
      teamId: this.config.teamId,
      lastSync: new Date().toISOString(),
      activeAgents: this.getAgents()
        .filter(m => m.state !== AgentState.OFFLINE)
        .map(m => m.agentId),
      pendingTasks: this.getTasks(TaskState.IN_PROGRESS).map(t => t.taskId),
      completedTasks: this.getTasks(TaskState.COMPLETED).map(t => t.taskId),
      messages: this.messageQueue.slice(-100), // 保留最近 100 条消息
    };
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 根据策略选择 Agent
   */
  private selectAgentForTask(task: Task): AgentId | undefined {
    const availableAgents = this.getAgents().filter(
      m => m.state === AgentState.IDLE
    );

    if (availableAgents.length === 0) {
      return undefined;
    }

    switch (this.config.assignmentStrategy) {
      case 'round-robin':
        return this.selectRoundRobin(availableAgents);
      case 'least-loaded':
        return this.selectLeastLoaded(availableAgents);
      case 'role-based':
        return this.selectByRole(availableAgents, task);
      case 'manual':
        return undefined; // 手动分配，不自动选择
      default:
        return this.selectRoundRobin(availableAgents);
    }
  }

  /**
   * 轮询选择
   */
  private selectRoundRobin(agents: TeamMember[]): AgentId {
    const index = this.assignmentIndex % agents.length;
    this.assignmentIndex++;
    return agents[index].agentId;
  }

  /**
   * 选择负载最小的 Agent
   */
  private selectLeastLoaded(agents: TeamMember[]): AgentId {
    // 简化实现：选择第一个空闲的
    // 实际应用中可以根据历史任务数量、执行时间等更复杂的指标
    return agents[0].agentId;
  }

  /**
   * 基于角色选择
   */
  private selectByRole(agents: TeamMember[], task: Task): AgentId | undefined {
    // 根据任务类型匹配最合适的角色
    // 简化实现：返回第一个可用 Agent
    return agents[0]?.agentId;
  }

  /**
   * 发送消息
   */
  private async sendMessage(message: CoordinatorMessage): Promise<void> {
    this.messageQueue.push(message);
    
    // 限制消息队列大小
    if (this.messageQueue.length > 1000) {
      this.messageQueue = this.messageQueue.slice(-500);
    }
  }

  /**
   * 同步状态到共享存储
   */
  private async syncState(): Promise<void> {
    const state = await this.getState();
    await this.stateManager.writeCoordinatorState(state);
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): TaskId {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成消息 ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * 创建协调器的便捷函数
 */
export function createCoordinator(
  config: CoordinatorConfig,
  stateManager: SharedStateManager
): Coordinator {
  return new Coordinator(config, stateManager);
}

// 默认导出
export default Coordinator;

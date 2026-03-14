/**
 * OpenClaw Team Module - Team State Management
 * 
 * 本文件实现团队状态管理功能，包括：
 * - 状态转换规则和验证
 * - 状态机实现
 * - 状态变更事件处理
 */

import {
  TeamState,
  AgentState,
  TaskState,
  TeamRuntimeInfo,
  AgentRuntimeInfo,
  Task,
  TeamConfig,
  HookType,
  HookContext,
  HookCallback,
} from './types';

/**
 * 状态转换规则接口
 * @description 定义允许的状态转换路径
 */
interface StateTransition {
  /** 源状态 */
  from: TeamState | AgentState | TaskState;
  /** 目标状态 */
  to: TeamState | AgentState | TaskState;
  /** 转换条件（可选） */
  condition?: () => boolean;
}

/**
 * 团队状态转换图
 * @description 定义 TeamState 的合法状态转换路径
 */
const TEAM_STATE_TRANSITIONS: Map<TeamState, TeamState[]> = new Map([
  // 从 CREATED 可以转换到 INITIALIZING 或 TERMINATED
  [TeamState.CREATED, [TeamState.INITIALIZING, TeamState.TERMINATED]],
  
  // 从 INITIALIZING 可以转换到 READY、ERROR 或 TERMINATED
  [TeamState.INITIALIZING, [TeamState.READY, TeamState.ERROR, TeamState.TERMINATED]],
  
  // 从 READY 可以转换到 RUNNING、PAUSED、SHUTTING_DOWN 或 ERROR
  [TeamState.READY, [TeamState.RUNNING, TeamState.PAUSED, TeamState.SHUTTING_DOWN, TeamState.ERROR]],
  
  // 从 RUNNING 可以转换到 READY、PAUSED、SHUTTING_DOWN 或 ERROR
  [TeamState.RUNNING, [TeamState.READY, TeamState.PAUSED, TeamState.SHUTTING_DOWN, TeamState.ERROR]],
  
  // 从 PAUSED 可以转换到 RUNNING、READY 或 SHUTTING_DOWN
  [TeamState.PAUSED, [TeamState.RUNNING, TeamState.READY, TeamState.SHUTTING_DOWN]],
  
  // 从 SHUTTING_DOWN 可以转换到 TERMINATED 或 ERROR
  [TeamState.SHUTTING_DOWN, [TeamState.TERMINATED, TeamState.ERROR]],
  
  // 从 ERROR 可以转换到 READY、RUNNING 或 SHUTTING_DOWN
  [TeamState.ERROR, [TeamState.READY, TeamState.RUNNING, TeamState.SHUTTING_DOWN]],
  
  // TERMINATED 是终止状态，不能转换到其他状态
  [TeamState.TERMINATED, []],
]);

/**
 * Agent 状态转换图
 * @description 定义 AgentState 的合法状态转换路径
 */
const AGENT_STATE_TRANSITIONS: Map<AgentState, AgentState[]> = new Map([
  // 从 CREATED 可以转换到 STARTING 或 TERMINATED
  [AgentState.CREATED, [AgentState.STARTING, AgentState.TERMINATED]],
  
  // 从 STARTING 可以转换到 IDLE、ERROR 或 TERMINATED
  [AgentState.STARTING, [AgentState.IDLE, AgentState.ERROR, AgentState.TERMINATED]],
  
  // 从 IDLE 可以转换到 BUSY、WAITING_APPROVAL、ERROR 或 SHUTTING_DOWN
  [AgentState.IDLE, [AgentState.BUSY, AgentState.WAITING_APPROVAL, AgentState.ERROR, AgentState.SHUTTING_DOWN]],
  
  // 从 BUSY 可以转换到 IDLE、STUCK、WAITING_APPROVAL、ERROR 或 SHUTTING_DOWN
  [AgentState.BUSY, [AgentState.IDLE, AgentState.STUCK, AgentState.WAITING_APPROVAL, AgentState.ERROR, AgentState.SHUTTING_DOWN]],
  
  // 从 WAITING_APPROVAL 可以转换到 BUSY、IDLE、ERROR
  [AgentState.WAITING_APPROVAL, [AgentState.BUSY, AgentState.IDLE, AgentState.ERROR]],
  
  // 从 STUCK 可以转换到 BUSY、IDLE、ERROR 或 SHUTTING_DOWN
  [AgentState.STUCK, [AgentState.BUSY, AgentState.IDLE, AgentState.ERROR, AgentState.SHUTTING_DOWN]],
  
  // 从 ERROR 可以转换到 IDLE、BUSY 或 SHUTTING_DOWN
  [AgentState.ERROR, [AgentState.IDLE, AgentState.BUSY, AgentState.SHUTTING_DOWN]],
  
  // 从 SHUTTING_DOWN 可以转换到 TERMINATED
  [AgentState.SHUTTING_DOWN, [AgentState.TERMINATED]],
  
  // TERMINATED 是终止状态
  [AgentState.TERMINATED, []],
]);

/**
 * 任务状态转换图
 * @description 定义 TaskState 的合法状态转换路径
 */
const TASK_STATE_TRANSITIONS: Map<TaskState, TaskState[]> = new Map([
  // 从 PENDING 可以转换到 ASSIGNED、CANCELLED 或 DEAD_LETTER
  [TaskState.PENDING, [TaskState.ASSIGNED, TaskState.CANCELLED, TaskState.DEAD_LETTER]],
  
  // 从 ASSIGNED 可以转换到 RUNNING、PENDING、CANCELLED
  [TaskState.ASSIGNED, [TaskState.RUNNING, TaskState.PENDING, TaskState.CANCELLED]],
  
  // 从 RUNNING 可以转换到 COMPLETED、FAILED、CANCELLED、AWAITING_APPROVAL
  [TaskState.RUNNING, [TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED, TaskState.AWAITING_APPROVAL]],
  
  // 从 AWAITING_APPROVAL 可以转换到 RUNNING、COMPLETED、CANCELLED
  [TaskState.AWAITING_APPROVAL, [TaskState.RUNNING, TaskState.COMPLETED, TaskState.CANCELLED]],
  
  // 从 FAILED 可以转换到 PENDING（重试）、DEAD_LETTER 或 CANCELLED
  [TaskState.FAILED, [TaskState.PENDING, TaskState.DEAD_LETTER, TaskState.CANCELLED]],
  
  // COMPLETED 是终止状态
  [TaskState.COMPLETED, []],
  
  // CANCELLED 是终止状态
  [TaskState.CANCELLED, []],
  
  // DEAD_LETTER 可以转换到 PENDING（人工干预后重试）或 CANCELLED
  [TaskState.DEAD_LETTER, [TaskState.PENDING, TaskState.CANCELLED]],
]);

/**
 * 状态变更监听器类型
 */
type StateChangeListener = (context: HookContext) => void | Promise<void>;

/**
 * 团队状态管理器类
 * @description 管理团队和 Agent 的状态转换，确保状态转换的合法性
 */
export class TeamStateManager {
  private teamState: TeamState = TeamState.CREATED;
  private agentStates: Map<string, AgentState> = new Map();
  private taskStates: Map<string, TaskState> = new Map();
  private listeners: Map<HookType, StateChangeListener[]> = new Map();
  private teamId: string;
  private teamInfo: Partial<TeamRuntimeInfo> = {};

  /**
   * 创建团队状态管理器实例
   * @param teamId - 团队唯一标识符
   */
  constructor(teamId: string) {
    this.teamId = teamId;
  }

  /**
   * 获取当前团队状态
   * @returns 当前团队状态
   */
  getCurrentState(): TeamState {
    return this.teamState;
  }

  /**
   * 获取指定 Agent 的当前状态
   * @param agentId - Agent 唯一标识符
   * @returns Agent 当前状态，如果 Agent 不存在则返回 undefined
   */
  getAgentState(agentId: string): AgentState | undefined {
    return this.agentStates.get(agentId);
  }

  /**
   * 获取指定任务的当前状态
   * @param taskId - 任务唯一标识符
   * @returns 任务当前状态，如果任务不存在则返回 undefined
   */
  getTaskState(taskId: string): TaskState | undefined {
    return this.taskStates.get(taskId);
  }

  /**
   * 获取所有 Agent 的状态
   * @returns Agent 状态映射表
   */
  getAllAgentStates(): Map<string, AgentState> {
    return new Map(this.agentStates);
  }

  /**
   * 获取所有任务的状态
   * @returns 任务状态映射表
   */
  getAllTaskStates(): Map<string, TaskState> {
    return new Map(this.taskStates);
  }

  /**
   * 检查团队状态转换是否合法
   * @param newState - 目标状态
   * @returns 是否允许转换
   */
  canTransitionTo(newState: TeamState): boolean {
    const allowedStates = TEAM_STATE_TRANSITIONS.get(this.teamState);
    return allowedStates?.includes(newState) ?? false;
  }

  /**
   * 检查 Agent 状态转换是否合法
   * @param agentId - Agent 唯一标识符
   * @param newState - 目标状态
   * @returns 是否允许转换
   */
  canAgentTransitionTo(agentId: string, newState: AgentState): boolean {
    const currentState = this.agentStates.get(agentId);
    if (!currentState) {
      return newState === AgentState.CREATED;
    }
    const allowedStates = AGENT_STATE_TRANSITIONS.get(currentState);
    return allowedStates?.includes(newState) ?? false;
  }

  /**
   * 检查任务状态转换是否合法
   * @param taskId - 任务唯一标识符
   * @param newState - 目标状态
   * @returns 是否允许转换
   */
  canTaskTransitionTo(taskId: string, newState: TaskState): boolean {
    const currentState = this.taskStates.get(taskId);
    if (!currentState) {
      return newState === TaskState.PENDING;
    }
    const allowedStates = TASK_STATE_TRANSITIONS.get(currentState);
    return allowedStates?.includes(newState) ?? false;
  }

  /**
   * 执行团队状态转换
   * @param newState - 目标状态
   * @param data - 额外的上下文数据
   * @returns 转换是否成功
   * @throws 如果转换不合法会抛出错误
   */
  async transitionTo(newState: TeamState, data?: Record<string, unknown>): Promise<boolean> {
    if (!this.canTransitionTo(newState)) {
      throw new Error(
        `Invalid team state transition from ${this.teamState} to ${newState}`
      );
    }

    const oldState = this.teamState;
    this.teamState = newState;

    // 触发状态变更事件
    await this.emitStateChange(HookType.TEAM_STATE_CHANGE, {
      oldState,
      newState,
      data,
    });

    return true;
  }

  /**
   * 执行 Agent 状态转换
   * @param agentId - Agent 唯一标识符
   * @param newState - 目标状态
   * @param data - 额外的上下文数据
   * @returns 转换是否成功
   * @throws 如果转换不合法会抛出错误
   */
  async transitionAgentTo(
    agentId: string,
    newState: AgentState,
    data?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.canAgentTransitionTo(agentId, newState)) {
      const currentState = this.agentStates.get(agentId);
      throw new Error(
        `Invalid agent state transition for ${agentId} from ${currentState} to ${newState}`
      );
    }

    const oldState = this.agentStates.get(agentId);
    this.agentStates.set(agentId, newState);

    // 触发状态变更事件
    await this.emitStateChange(HookType.TASK_STATE_CHANGE, {
      agentId,
      oldState,
      newState,
      data,
    });

    // 触发特定状态的事件
    if (newState === AgentState.IDLE) {
      await this.emit(HookType.AGENT_IDLE, { agentId, newState, data });
    } else if (newState === AgentState.STUCK) {
      await this.emit(HookType.AGENT_STUCK, { agentId, newState, data });
    }

    return true;
  }

  /**
   * 执行任务状态转换
   * @param taskId - 任务唯一标识符
   * @param newState - 目标状态
   * @param data - 额外的上下文数据
   * @returns 转换是否成功
   * @throws 如果转换不合法会抛出错误
   */
  async transitionTaskTo(
    taskId: string,
    newState: TaskState,
    data?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.canTaskTransitionTo(taskId, newState)) {
      const currentState = this.taskStates.get(taskId);
      throw new Error(
        `Invalid task state transition for ${taskId} from ${currentState} to ${newState}`
      );
    }

    const oldState = this.taskStates.get(taskId);
    this.taskStates.set(taskId, newState);

    // 触发状态变更事件
    await this.emitStateChange(HookType.TASK_STATE_CHANGE, {
      taskId,
      oldState,
      newState,
      data,
    });

    return true;
  }

  /**
   * 注册 Agent
   * @param agentId - Agent 唯一标识符
   * @returns 是否注册成功
   */
  registerAgent(agentId: string): boolean {
    if (this.agentStates.has(agentId)) {
      return false;
    }
    this.agentStates.set(agentId, AgentState.CREATED);
    return true;
  }

  /**
   * 注销 Agent
   * @param agentId - Agent 唯一标识符
   */
  unregisterAgent(agentId: string): void {
    this.agentStates.delete(agentId);
  }

  /**
   * 注册任务
   * @param taskId - 任务唯一标识符
   * @returns 是否注册成功
   */
  registerTask(taskId: string): boolean {
    if (this.taskStates.has(taskId)) {
      return false;
    }
    this.taskStates.set(taskId, TaskState.PENDING);
    return true;
  }

  /**
   * 注销任务
   * @param taskId - 任务唯一标识符
   */
  unregisterTask(taskId: string): void {
    this.taskStates.delete(taskId);
  }

  /**
   * 添加状态变更监听器
   * @param hookType - 钩子类型
   * @param listener - 监听器函数
   */
  addListener(hookType: HookType, listener: StateChangeListener): void {
    if (!this.listeners.has(hookType)) {
      this.listeners.set(hookType, []);
    }
    this.listeners.get(hookType)!.push(listener);
  }

  /**
   * 移除状态变更监听器
   * @param hookType - 钩子类型
   * @param listener - 监听器函数
   */
  removeListener(hookType: HookType, listener: StateChangeListener): void {
    const listeners = this.listeners.get(hookType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   * @param hookType - 钩子类型
   * @param data - 事件数据
   */
  private async emit(
    hookType: HookType,
    data: {
      agentId?: string;
      taskId?: string;
      newState?: TeamState | AgentState | TaskState;
      oldState?: TeamState | AgentState | TaskState;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    const listeners = this.listeners.get(hookType);
    if (!listeners || listeners.length === 0) {
      return;
    }

    const context: HookContext = {
      type: hookType,
      teamId: this.teamId,
      agentId: data.agentId,
      taskId: data.taskId,
      oldState: data.oldState,
      newState: data.newState!,
      timestamp: new Date(),
      data: data.data,
    };

    // 并行执行所有监听器
    await Promise.all(listeners.map((listener) => listener(context)));
  }

  /**
   * 触发状态变更事件
   * @param hookType - 钩子类型
   * @param data - 事件数据
   */
  private async emitStateChange(
    hookType: HookType,
    data: {
      agentId?: string;
      taskId?: string;
      newState: TeamState | AgentState | TaskState;
      oldState?: TeamState | AgentState | TaskState;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.emit(hookType, data);
  }

  /**
   * 获取团队运行时信息
   * @returns 团队运行时信息
   */
  getTeamRuntimeInfo(): Partial<TeamRuntimeInfo> {
    return {
      ...this.teamInfo,
      teamId: this.teamId,
      state: this.teamState,
    };
  }

  /**
   * 更新团队运行时信息
   * @param info - 要更新的信息
   */
  updateTeamRuntimeInfo(info: Partial<TeamRuntimeInfo>): void {
    this.teamInfo = { ...this.teamInfo, ...info };
  }

  /**
   * 检查团队是否处于活动状态
   * @returns 团队是否活动
   */
  isActive(): boolean {
    return (
      this.teamState === TeamState.READY ||
      this.teamState === TeamState.RUNNING ||
      this.teamState === TeamState.PAUSED
    );
  }

  /**
   * 检查团队是否已终止
   * @returns 团队是否已终止
   */
  isTerminated(): boolean {
    return this.teamState === TeamState.TERMINATED;
  }

  /**
   * 获取处于特定状态的 Agent 列表
   * @param state - 要查询的状态
   * @returns Agent ID 列表
   */
  getAgentsByState(state: AgentState): string[] {
    const result: string[] = [];
    for (const [agentId, agentState] of this.agentStates.entries()) {
      if (agentState === state) {
        result.push(agentId);
      }
    }
    return result;
  }

  /**
   * 获取处于特定状态的任务列表
   * @param state - 要查询的状态
   * @returns 任务 ID 列表
   */
  getTasksByState(state: TaskState): string[] {
    const result: string[] = [];
    for (const [taskId, taskState] of this.taskStates.entries()) {
      if (taskState === state) {
        result.push(taskId);
      }
    }
    return result;
  }

  /**
   * 获取团队状态统计
   * @returns 状态统计信息
   */
  getStateStats(): {
    teamState: TeamState;
    agentCount: number;
    agentStateCounts: Record<AgentState, number>;
    taskCount: number;
    taskStateCounts: Record<TaskState, number>;
  } {
    const agentStateCounts: Record<AgentState, number> = {
      [AgentState.CREATED]: 0,
      [AgentState.STARTING]: 0,
      [AgentState.IDLE]: 0,
      [AgentState.BUSY]: 0,
      [AgentState.WAITING_APPROVAL]: 0,
      [AgentState.STUCK]: 0,
      [AgentState.ERROR]: 0,
      [AgentState.SHUTTING_DOWN]: 0,
      [AgentState.TERMINATED]: 0,
    };

    const taskStateCounts: Record<TaskState, number> = {
      [TaskState.PENDING]: 0,
      [TaskState.ASSIGNED]: 0,
      [TaskState.RUNNING]: 0,
      [TaskState.COMPLETED]: 0,
      [TaskState.FAILED]: 0,
      [TaskState.CANCELLED]: 0,
      [TaskState.AWAITING_APPROVAL]: 0,
      [TaskState.DEAD_LETTER]: 0,
    };

    for (const state of this.agentStates.values()) {
      agentStateCounts[state]++;
    }

    for (const state of this.taskStates.values()) {
      taskStateCounts[state]++;
    }

    return {
      teamState: this.teamState,
      agentCount: this.agentStates.size,
      agentStateCounts,
      taskCount: this.taskStates.size,
      taskStateCounts,
    };
  }

  /**
   * 序列化状态为 JSON
   * @returns 序列化后的状态对象
   */
  serialize(): {
    teamId: string;
    teamState: TeamState;
    agentStates: Record<string, AgentState>;
    taskStates: Record<string, TaskState>;
  } {
    return {
      teamId: this.teamId,
      teamState: this.teamState,
      agentStates: Object.fromEntries(this.agentStates),
      taskStates: Object.fromEntries(this.taskStates),
    };
  }

  /**
   * 从 JSON 反序列化状态
   * @param data - 序列化后的状态对象
   */
  deserialize(data: {
    teamId: string;
    teamState: TeamState;
    agentStates: Record<string, AgentState>;
    taskStates: Record<string, TaskState>;
  }): void {
    this.teamId = data.teamId;
    this.teamState = data.teamState;
    this.agentStates = new Map(Object.entries(data.agentStates));
    this.taskStates = new Map(Object.entries(data.taskStates));
  }
}

/**
 * 获取状态的中文描述
 * @param state - 状态值
 * @returns 中文描述
 */
export function getTeamStateDescription(state: TeamState): string {
  const descriptions: Record<TeamState, string> = {
    [TeamState.CREATED]: '已创建',
    [TeamState.INITIALIZING]: '初始化中',
    [TeamState.READY]: '就绪',
    [TeamState.RUNNING]: '运行中',
    [TeamState.PAUSED]: '已暂停',
    [TeamState.SHUTTING_DOWN]: '关闭中',
    [TeamState.TERMINATED]: '已终止',
    [TeamState.ERROR]: '错误',
  };
  return descriptions[state] || state;
}

/**
 * 获取 Agent 状态的中文描述
 * @param state - 状态值
 * @returns 中文描述
 */
export function getAgentStateDescription(state: AgentState): string {
  const descriptions: Record<AgentState, string> = {
    [AgentState.CREATED]: '已创建',
    [AgentState.STARTING]: '启动中',
    [AgentState.IDLE]: '空闲',
    [AgentState.BUSY]: '忙碌',
    [AgentState.WAITING_APPROVAL]: '等待审批',
    [AgentState.STUCK]: '卡住',
    [AgentState.ERROR]: '错误',
    [AgentState.SHUTTING_DOWN]: '关闭中',
    [AgentState.TERMINATED]: '已终止',
  };
  return descriptions[state] || state;
}

/**
 * 获取任务状态的中文描述
 * @param state - 状态值
 * @returns 中文描述
 */
export function getTaskStateDescription(state: TaskState): string {
  const descriptions: Record<TaskState, string> = {
    [TaskState.PENDING]: '待处理',
    [TaskState.ASSIGNED]: '已分配',
    [TaskState.RUNNING]: '执行中',
    [TaskState.COMPLETED]: '已完成',
    [TaskState.FAILED]: '失败',
    [TaskState.CANCELLED]: '已取消',
    [TaskState.AWAITING_APPROVAL]: '等待审批',
    [TaskState.DEAD_LETTER]: '死信队列',
  };
  return descriptions[state] || state;
}

/**
 * 验证团队配置的状态是否合法
 * @param config - 团队配置
 * @returns 验证结果
 */
export function validateTeamConfigState(config: Partial<TeamConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.teamId) {
    errors.push('teamId is required');
  }

  if (!config.task) {
    errors.push('task is required');
  }

  if (config.members && !Array.isArray(config.members)) {
    errors.push('members must be an array');
  }

  // 验证 Agent ID 唯一性
  const agentIds = new Set<string>();
  if (config.lead) {
    if (agentIds.has(config.lead.agentId)) {
      errors.push(`Duplicate agentId: ${config.lead.agentId}`);
    }
    agentIds.add(config.lead.agentId);
  }

  if (config.members) {
    for (const member of config.members) {
      if (agentIds.has(member.agentId)) {
        errors.push(`Duplicate agentId: ${member.agentId}`);
      }
      agentIds.add(member.agentId);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default TeamStateManager;

/**
 * OpenClaw Team Module - Core Type Definitions
 * 
 * 本文件定义了多 Agent 调度方案的核心类型和接口，
 * 包括团队配置、Agent 配置、状态管理和各种配置选项。
 */

/**
 * 团队协作模式枚举
 * @description 定义团队中 Agent 之间的协调方式
 */
export enum CoordinationMode {
  /** Hub-and-Spoke 模式：团队成员通过中心协调者（Lead）进行通信，所有消息都经过 Lead */
  HUB_AND_SPOKE = 'hub-and-spoke',
  /** Mesh 模式：团队成员之间可以点对点直接通信，无需经过中心节点 */
  MESH = 'mesh',
}

/**
 * Agent 角色类型
 * @description 预定义的 Agent 角色，每个角色有不同的职责
 */
export enum AgentRole {
  /** 团队领导者，负责任务分配、协调和决策 */
  LEAD = 'lead',
  /** 规划者，负责制定执行计划和任务分解 */
  PLANNING = 'planning',
  /** 编码者，负责实际的代码实现 */
  CODING = 'coding',
  /** 审查者，负责代码审查和质量把控 */
  REVIEW = 'review',
  /** 测试者，负责测试和验证 */
  TESTING = 'testing',
  /** 自定义角色，由用户自行定义职责 */
  CUSTOM = 'custom',
}

/**
 * 团队状态枚举
 * @description 描述团队的生命周期状态
 */
export enum TeamState {
  /** 团队已创建，尚未初始化完成 */
  CREATED = 'created',
  /** 团队正在初始化中，Agent 正在被创建和配置 */
  INITIALIZING = 'initializing',
  /** 团队已就绪，可以开始执行任务 */
  READY = 'ready',
  /** 团队正在运行中，正在执行任务 */
  RUNNING = 'running',
  /** 团队已暂停，所有 Agent 暂停工作 */
  PAUSED = 'paused',
  /** 团队正在关闭中，正在进行清理工作 */
  SHUTTING_DOWN = 'shutting_down',
  /** 团队已终止，所有资源已释放 */
  TERMINATED = 'terminated',
  /** 团队遇到错误，需要人工干预 */
  ERROR = 'error',
}

/**
 * Agent 状态枚举
 * @description 描述单个 Agent 的生命周期状态
 */
export enum AgentState {
  /** Agent 已创建，尚未开始运行 */
  CREATED = 'created',
  /** Agent 正在启动中 */
  STARTING = 'starting',
  /** Agent 空闲状态，等待任务分配 */
  IDLE = 'idle',
  /** Agent 正在执行任务 */
  BUSY = 'busy',
  /** Agent 正在等待计划审批 */
  WAITING_APPROVAL = 'waiting_approval',
  /** Agent 遇到问题，无法继续工作 */
  STUCK = 'stuck',
  /** Agent 遇到错误，需要处理 */
  ERROR = 'error',
  /** Agent 正在关闭中 */
  SHUTTING_DOWN = 'shutting_down',
  /** Agent 已终止 */
  TERMINATED = 'terminated',
}

/**
 * 任务状态枚举
 * @description 描述任务的生命周期状态
 */
export enum TaskState {
  /** 任务已创建，等待分配 */
  PENDING = 'pending',
  /** 任务已分配给 Agent */
  ASSIGNED = 'assigned',
  /** 任务正在执行中 */
  RUNNING = 'running',
  /** 任务已完成 */
  COMPLETED = 'completed',
  /** 任务执行失败 */
  FAILED = 'failed',
  /** 任务已取消 */
  CANCELLED = 'cancelled',
  /** 任务需要人工审批 */
  AWAITING_APPROVAL = 'awaiting_approval',
  /** 任务已进入死信队列，需要人工处理 */
  DEAD_LETTER = 'dead_letter',
}

/**
 * 心跳状态枚举
 * @description 描述心跳检测的结果状态
 */
export enum HeartbeatStatus {
  /** 心跳正常，Agent 健康 */
  HEALTHY = 'healthy',
  /** 心跳超时，Agent 可能无响应 */
  TIMEOUT = 'timeout',
  /** 心跳失败，Agent 遇到错误 */
  FAILED = 'failed',
  /** 心跳检查被暂停 */
  PAUSED = 'paused',
  /** 心跳检查已停止 */
  STOPPED = 'stopped',
}

/**
 * Agent 配置接口
 * @description 定义单个 Agent 的配置参数
 */
export interface AgentConfig {
  /**
   * Agent 唯一标识符
   * @example "agent-001", "coder-backend"
   */
  agentId: string;

  /**
   * Agent 角色
   * @description 预定义角色或自定义角色
   * @default AgentRole.CUSTOM
   */
  role: AgentRole;

  /**
   * Agent 使用的模型
   * @description 可以是模型名称、模型别名或模型 ID
   * @example "gpt-4", "claude-3-opus", "modelhub/gemini-3-flash-preview"
   * @optional
   */
  model?: string;

  /**
   * 系统提示词
   * @description 定义 Agent 的行为准则和能力边界
   * @optional
   */
  systemPrompt?: string;

  /**
   * 是否需要人工审批
   * @description 如果为 true，该 Agent 生成的计划需要人工审批后才能执行
   * @default false
   * @optional
   */
  requiresApproval?: boolean;

  /**
   * Agent 能力标签
   * @description 用于任务分配时匹配 Agent 能力
   * @example ["typescript", "react", "database"]
   * @optional
   */
  capabilities?: string[];

  /**
   * Agent 优先级
   * @description 数值越高优先级越高，用于任务分配时的选择
   * @default 0
   * @optional
   */
  priority?: number;

  /**
   * Agent 专属配置
   * @description 特定角色或自定义 Agent 的额外配置
   * @optional
   */
  metadata?: Record<string, unknown>;
}

/**
 * 心跳配置接口
 * @description 定义心跳监控的行为参数
 */
export interface HeartbeatConfig {
  /**
   * 心跳间隔（毫秒）
   * @description Agent 发送心跳的时间间隔
   * @default 30000 (30秒)
   */
  intervalMs: number;

  /**
   * 心跳超时时间（毫秒）
   * @description 超过此时间未收到心跳则认为超时
   * @default 120000 (2分钟)
   */
  timeoutMs: number;

  /**
   * 最大重试次数
   * @description 心跳超时后的最大重试次数
   * @default 3
   */
  maxRetries: number;

  /**
   * 退避倍数
   * @description 每次重试的间隔时间倍数，用于指数退避
   * @default 2
   */
  backoffMultiplier: number;

  /**
   * 初始重试延迟（毫秒）
   * @description 第一次重试的等待时间
   * @default 5000 (5秒)
   * @optional
   */
  initialRetryDelayMs?: number;

  /**
   * 是否启用自动恢复
   * @description 心跳失败后是否自动尝试恢复 Agent
   * @default true
   * @optional
   */
  autoRecovery?: boolean;
}

/**
 * 计划审批配置接口
 * @description 定义计划审批的行为参数
 */
export interface PlanApprovalConfig {
  /**
   * 是否启用计划审批
   * @description 全局开关，控制是否需要人工审批计划
   * @default false
   */
  enabled: boolean;

  /**
   * 需要审批的角色列表
   * @description 指定哪些角色的计划需要审批
   * @example [AgentRole.LEAD, AgentRole.PLANNING]
   * @optional
   */
  requireApprovalForRoles?: AgentRole[];

  /**
   * 需要审批的任务类型
   * @description 指定哪些类型的任务需要审批
   * @example ["code", "deploy", "delete"]
   * @optional
   */
  requireApprovalForTaskTypes?: string[];

  /**
   * 审批超时时间（毫秒）
   * @description 审批请求的超时时间，超时后自动拒绝
   * @default 300000 (5分钟)
   * @optional
   */
  approvalTimeoutMs?: number;

  /**
   * 审批模式
   * @description 审批流程的方式
   * - 'any': 任一审批人批准即可
   * - 'all': 所有审批人必须批准
   * @default 'any'
   * @optional
   */
  approvalMode?: 'any' | 'all';

  /**
   * 审批人列表
   * @description 可以批准计划的用户列表
   * @optional
   */
  approvers?: string[];

  /**
   * 是否允许自动拒绝
   * @description 超时后是否自动拒绝计划
   * @default true
   * @optional
   */
  autoRejectOnTimeout?: boolean;
}

/**
 * 恢复策略枚举
 * @description 定义 Agent 失败后的恢复策略
 */
export enum RecoveryStrategy {
  /** 直接重试 */
  RETRY = 'retry',
  /** 使用退避策略重试 */
  RETRY_WITH_BACKOFF = 'retry_with_backoff',
  /** 重新创建 Agent */
  RECREATE = 'recreate',
  /** 分配给另一个 Agent */
  REASSIGN = 'reassign',
  /** 跳过失败任务 */
  SKIP = 'skip',
  /** 进入死信队列，等待人工处理 */
  DEAD_LETTER = 'dead_letter',
}

/**
 * 恢复配置接口
 * @description 定义故障恢复的行为参数
 */
export interface RecoveryConfig {
  /**
   * 最大重试次数
   * @description 任务失败后的最大重试次数
   * @default 3
   */
  maxRetries: number;

  /**
   * 重试策略
   * @description 失败后的恢复策略
   * @default RecoveryStrategy.RETRY_WITH_BACKOFF
   */
  strategy: RecoveryStrategy;

  /**
   * 基础退避时间（毫秒）
   * @description 指数退避的初始等待时间
   * @default 1000 (1秒)
   * @optional
   */
  baseBackoffMs?: number;

  /**
   * 最大退避时间（毫秒）
   * @description 指数退避的最大等待时间
   * @default 60000 (1分钟)
   * @optional
   */
  maxBackoffMs?: number;

  /**
   * 失败阈值
   * @description Agent 连续失败多少次后进入死信队列
   * @default 5
   * @optional
   */
  failureThreshold?: number;

  /**
   * 是否启用死信队列
   * @description 是否将失败任务放入死信队列
   * @default true
   * @optional
   */
  enableDeadLetterQueue?: boolean;

  /**
   * 死信队列最大容量
   * @description 死信队列中保存的最大失败任务数
   * @default 100
   * @optional
   */
  deadLetterQueueCapacity?: number;

  /**
   * 自动清理成功任务
   * @description 是否自动清理已成功完成的任务记录
   * @default true
   * @optional
   */
  autoCleanupCompletedTasks?: boolean;
}

/**
 * 团队配置接口
 * @description 定义整个团队的配置参数
 */
export interface TeamConfig {
  /**
   * 团队唯一标识符
   * @example "team-backend-refactor", "team-feature-auth"
   */
  teamId: string;

  /**
   * 团队任务描述
   * @description 团队需要完成的主要任务目标
   * @example "重构用户认证模块，提升安全性和性能"
   */
  task: string;

  /**
   * 协调模式
   * @description 团队成员之间的通信协调方式
   * @default CoordinationMode.HUB_AND_SPOKE
   */
  coordinationMode: CoordinationMode;

  /**
   * 团队领导者配置
   * @description 负责协调整个团队的 Agent 配置
   * @optional
   */
  lead?: AgentConfig;

  /**
   * 团队成员配置列表
   * @description 除 Lead 外的其他 Agent 配置
   */
  members: AgentConfig[];

  /**
   * 共享工作区路径
   * @description 团队成员共享的文件目录路径
   * @example "/workspace/teams/team-001"
   */
  sharedWorkspace: string;

  /**
   * 计划审批配置
   * @description 控制计划审批的行为
   * @optional
   */
  planApproval?: PlanApprovalConfig;

  /**
   * 心跳配置
   * @description 控制心跳监控的行为
   * @optional
   */
  heartbeat?: HeartbeatConfig;

  /**
   * 恢复配置
   * @description 控制故障恢复的行为
   * @optional
   */
  recovery?: RecoveryConfig;

  /**
   * 团队元数据
   * @description 额外的团队配置信息
   * @optional
   */
  metadata?: Record<string, unknown>;

  /**
   * 创建时间
   * @description 团队创建的时间戳
   * @optional
   */
  createdAt?: Date;

  /**
   * 过期时间（毫秒）
   * @description 团队自动清理前的空闲时间，0 表示不过期
   * @default 0
   * @optional
   */
  ttlMs?: number;
}

/**
 * Agent 运行时信息接口
 * @description 描述 Agent 的运行时状态
 */
export interface AgentRuntimeInfo {
  /**
   * Agent 唯一标识符
   */
  agentId: string;

  /**
   * Agent 角色
   */
  role: AgentRole;

  /**
   * 当前状态
   */
  state: AgentState;

  /**
   * 最后活跃时间
   * @description 最后一次收到心跳的时间
   * @optional
   */
  lastHeartbeatAt?: Date;

  /**
   * 当前任务 ID
   * @description 正在执行的任务 ID，如果没有则为 null
   * @optional
   */
  currentTaskId?: string | null;

  /**
   * 已完成的任务数
   * @default 0
   * @optional
   */
  completedTasks?: number;

  /**
   * 失败的任务数
   * @default 0
   * @optional
   */
  failedTasks?: number;

  /**
   * 错误信息
   * @description 如果状态为 ERROR，包含错误详情
   * @optional
   */
  errorMessage?: string;

  /**
   * Agent 启动时间
   * @optional
   */
  startedAt?: Date;
}

/**
 * 团队运行时信息接口
 * @description 描述团队的完整运行时状态
 */
export interface TeamRuntimeInfo {
  /**
   * 团队唯一标识符
   */
  teamId: string;

  /**
   * 当前团队状态
   */
  state: TeamState;

  /**
   * 团队配置
   */
  config: TeamConfig;

  /**
   * 团队成员运行时信息
   * @description 包括 Lead 和所有成员的实时状态
   */
  agents: AgentRuntimeInfo[];

  /**
   * 任务统计
   * @description 团队任务的整体统计信息
   * @optional
   */
  taskStats?: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    deadLetter: number;
  };

  /**
   * 创建时间
   * @optional
   */
  createdAt?: Date;

  /**
   * 最后更新时间
   * @optional
   */
  updatedAt?: Date;
}

/**
 * 任务接口
 * @description 定义团队任务的完整信息
 */
export interface Task {
  /**
   * 任务唯一标识符
   */
  taskId: string;

  /**
   * 任务描述
   */
  description: string;

  /**
   * 任务类型
   * @example "code", "review", "test", "research"
   */
  type: string;

  /**
   * 任务状态
   * @default TaskState.PENDING
   */
  state: TaskState;

  /**
   * 分配给哪个 Agent
   * @description Agent 的 agentId
   * @optional
   */
  assignedTo?: string;

  /**
   * 任务创建者
   * @description 创建任务的 Agent 或用户 ID
   */
  createdBy: string;

  /**
   * 父任务 ID
   * @description 如果是子任务，指向父任务的 ID
   * @optional
   */
  parentTaskId?: string;

  /**
   * 子任务列表
   * @description 分解后的子任务 ID 列表
   * @optional
   */
  subtasks?: string[];

  /**
   * 任务优先级
   * @description 数值越高优先级越高
   * @default 0
   * @optional
   */
  priority?: number;

  /**
   * 任务依赖
   * @description 必须先完成这些任务才能执行此任务
   * @optional
   */
  dependencies?: string[];

  /**
   * 任务结果
   * @description 任务执行完成后的结果
   * @optional
   */
  result?: unknown;

  /**
   * 错误信息
   * @description 如果任务失败，包含错误详情
   * @optional
   */
  error?: string;

  /**
   * 创建时间
   * @optional
   */
  createdAt?: Date;

  /**
   * 开始执行时间
   * @optional
   */
  startedAt?: Date;

  /**
   * 完成时间
   * @optional
   */
  completedAt?: Date;

  /**
   * 重试次数
   * @default 0
   * @optional
   */
  retryCount?: number;

  /**
   * 任务元数据
   * @description 额外的任务信息
   * @optional
   */
  metadata?: Record<string, unknown>;
}

/**
 * 心跳记录接口
 * @description 记录 Agent 的心跳信息
 */
export interface HeartbeatRecord {
  /**
   * Agent ID
   */
  agentId: string;

  /**
   * 心跳状态
   */
  status: HeartbeatStatus;

  /**
   * 心跳时间戳
   */
  timestamp: Date;

  /**
   * Agent 当前状态
   * @optional
   */
  agentState?: AgentState;

  /**
   * 当前任务 ID
   * @optional
   */
  currentTaskId?: string | null;

  /**
   * 额外信息
   * @description Agent 上报的额外状态信息
   * @optional
   */
  payload?: Record<string, unknown>;
}

/**
 * 死信任务接口
 * @description 进入死信队列的失败任务
 */
export interface DeadLetterTask {
  /**
   * 原始任务
   */
  task: Task;

  /**
   * 失败原因
   */
  failureReason: string;

  /**
   * 失败次数
   */
  failureCount: number;

  /**
   * 最后失败时间
   */
  lastFailedAt: Date;

  /**
   * 进入死信队列的时间
   */
  enteredDeadLetterAt: Date;

  /**
   * 最后一次错误堆栈
   * @optional
   */
  lastErrorStack?: string;

  /**
   * 是否已人工处理
   * @default false
   * @optional
   */
  isHandled?: boolean;

  /**
   * 处理人
   * @optional
   */
  handledBy?: string;

  /**
   * 处理时间
   * @optional
   */
  handledAt?: Date;
}

/**
 * 钩子类型枚举
 * @description 支持的生命周期钩子类型
 */
export enum HookType {
  /** Agent 进入空闲状态 */
  AGENT_IDLE = 'agent:idle',
  /** Agent 完成任务 */
  AGENT_COMPLETED = 'agent:completed',
  /** Agent 卡住（无响应） */
  AGENT_STUCK = 'agent:stuck',
  /** 团队同步事件 */
  TEAM_SYNC = 'team:sync',
  /** 团队状态变化 */
  TEAM_STATE_CHANGE = 'team:state:change',
  /** 任务状态变化 */
  TASK_STATE_CHANGE = 'task:state:change',
  /** Agent 错误 */
  AGENT_ERROR = 'agent:error',
  /** 计划需要审批 */
  PLAN_REQUIRES_APPROVAL = 'plan:requires:approval',
}

/**
 * 钩子回调函数类型
 */
export type HookCallback = (context: HookContext) => void | Promise<void>;

/**
 * 钩子上下文接口
 * @description 传递给钩子回调函数的上下文信息
 */
export interface HookContext {
  /**
   * 钩子类型
   */
  type: HookType;

  /**
   * 团队 ID
   */
  teamId: string;

  /**
   * Agent ID（如果适用）
   * @optional
   */
  agentId?: string;

  /**
   * 任务 ID（如果适用）
   * @optional
   */
  taskId?: string;

  /**
   * 旧状态（状态变化钩子）
   * @optional
   */
  oldState?: TeamState | AgentState | TaskState;

  /**
   * 新状态（状态变化钩子）
   */
  newState: TeamState | AgentState | TaskState;

  /**
   * 时间戳
   */
  timestamp: Date;

  /**
   * 额外数据
   * @optional
   */
  data?: Record<string, unknown>;
}

/**
 * 模型路由规则接口
 * @description 定义角色到模型的映射规则
 */
export interface ModelRouteRule {
  /**
   * 匹配的角色
   */
  role: AgentRole;

  /**
   * 匹配的模型（如果指定了模型）
   * @optional
   */
  model?: string;

  /**
   * 目标模型
   * @description 实际使用的模型
   */
  targetModel: string;

  /**
   * 优先级
   * @description 规则匹配优先级，数值越高越优先
   * @default 0
   * @optional
   */
  priority?: number;

  /**
   * 回退链
   * @description 主模型不可用时依次尝试的模型列表
   * @optional
   */
  fallbackChain?: string[];
}

/**
 * 团队存储数据结构接口
 * @description 团队持久化存储的数据结构
 */
export interface TeamStorageData {
  /**
   * 团队配置
   */
  config: TeamConfig;

  /**
   * 当前团队状态
   */
  state: TeamState;

  /**
   * Agent 运行时信息
   */
  agents: AgentRuntimeInfo[];

  /**
   * 任务列表
   */
  tasks: Task[];

  /**
   * 死信队列
   */
  deadLetterQueue: DeadLetterTask[];

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 最后更新时间
   */
  updatedAt: Date;

  /**
   * 版本号
   * @description 用于数据迁移
   */
  version: string;
}

/**
 * 创建团队的参数接口
 * @description 创建新团队时的参数
 */
export interface CreateTeamParams {
  /**
   * 团队任务描述
   */
  task: string;

  /**
   * 协调模式
   * @default CoordinationMode.HUB_AND_SPOKE
   * @optional
   */
  coordinationMode?: CoordinationMode;

  /**
   * 团队领导者配置
   * @optional
   */
  lead?: AgentConfig;

  /**
   * 团队成员配置列表
   * @optional
   */
  members?: AgentConfig[];

  /**
   * 共享工作区路径
   * @optional
   */
  sharedWorkspace?: string;

  /**
   * 计划审批配置
   * @optional
   */
  planApproval?: PlanApprovalConfig;

  /**
   * 心跳配置
   * @optional
   */
  heartbeat?: HeartbeatConfig;

  /**
   * 恢复配置
   * @optional
   */
  recovery?: RecoveryConfig;

  /**
   * 团队元数据
   * @optional
   */
  metadata?: Record<string, unknown>;
}

/**
 * 默认配置常量
 */
export const DEFAULTS = {
  /** 默认心跳间隔：30秒 */
  HEARTBEAT_INTERVAL_MS: 30000,
  /** 默认心跳超时：2分钟 */
  HEARTBEAT_TIMEOUT_MS: 120000,
  /** 默认最大重试次数：3 */
  MAX_RETRIES: 3,
  /** 默认退避倍数：2 */
  BACKOFF_MULTIPLIER: 2,
  /** 默认初始重试延迟：5秒 */
  INITIAL_RETRY_DELAY_MS: 5000,
  /** 默认基础退避时间：1秒 */
  BASE_BACKOFF_MS: 1000,
  /** 默认最大退避时间：1分钟 */
  MAX_BACKOFF_MS: 60000,
  /** 默认失败阈值：5 */
  FAILURE_THRESHOLD: 5,
  /** 默认死信队列容量：100 */
  DEAD_LETTER_QUEUE_CAPACITY: 100,
  /** 默认审批超时：5分钟 */
  APPROVAL_TIMEOUT_MS: 300000,
  /** 数据版本 */
  STORAGE_VERSION: '1.0.0',
} as const;

/**
 * 操作结果接口
 * @description 统一的操作结果返回格式
 */
export interface OperationResult<T = void> {
  /** 操作是否成功 */
  success: boolean;
  /** 返回的数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 错误代码 */
  code?: string;
}

/**
 * 团队列表项接口
 * @description 团队列表中显示的简化信息
 */
export interface TeamListItem {
  /** 团队 ID */
  teamId: string;
  /** 团队名称 */
  name?: string;
  /** 团队状态 */
  state: TeamState;
  /** 成员数量 */
  memberCount: number;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/**
 * Agent 运行时状态接口
 * @description Agent 在团队中的运行时状态（与枚举 AgentState 区分）
 */
export interface AgentRuntimeState {
  /** Agent ID */
  agentId: string;
  /** 当前状态: idle | working | stuck | completed | error */
  status: 'idle' | 'working' | 'stuck' | 'completed' | 'error';
  /** 最后心跳时间 */
  lastHeartbeat?: Date;
  /** 当前任务 ID */
  currentTask?: string;
  /** Session ID */
  sessionId?: string;
  /** 重试次数 */
  retryCount: number;
}

/**
 * 团队运行时对象
 * @description TeamManager 使用的完整团队运行时对象
 */
export interface Team {
  /** 团队 ID */
  teamId: string;
  /** 团队名称 */
  name?: string;
  /** 当前状态 */
  state: TeamState;
  /** 团队配置 */
  config: TeamConfig;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
  /** Agent 状态映射 */
  agentStates: Map<string, AgentRuntimeState>;
  /** 当前任务信息 */
  currentTask?: TaskInfo;
  /** 团队统计 */
  stats: TeamStats;
  /** 版本号 */
  version: number;
}

/**
 * 任务信息接口
 * @description 团队当前执行的任务信息
 */
export interface TaskInfo {
  /** 任务 ID */
  taskId: string;
  /** 任务描述 */
  description: string;
  /** 分配给哪些 Agent */
  assignedTo: string[];
  /** 任务状态 */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** 创建时间 */
  createdAt: Date;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
}

/**
 * 团队统计信息
 * @description 团队的统计信息
 */
export interface TeamStats {
  /** 总任务数 */
  totalTasks: number;
  /** 已完成任务数 */
  completedTasks: number;
  /** 失败任务数 */
  failedTasks: number;
  /** 总重试次数 */
  totalRetries: number;
  /** 平均任务执行时间（毫秒） */
  averageTaskTime: number;
}

/**
 * Manifest 文件结构
 * @description 存储在磁盘上的团队清单文件格式
 */
export interface TeamManifest {
  /** 版本 */
  version: string;
  /** 团队 ID */
  teamId: string;
  /** 团队名称 */
  name?: string;
  /** 团队状态 */
  state: TeamState;
  /** 团队配置 */
  config: TeamConfig;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** Agent ID 列表 */
  agentIds: string[];
  /** 统计信息 */
  stats: TeamStats;
}

/**
 * 错误代码枚举
 * @description 团队管理相关的错误代码
 */
export enum TeamErrorCode {
  /** 团队已存在 */
  TEAM_ALREADY_EXISTS = 'TEAM_ALREADY_EXISTS',
  /** 团队不存在 */
  TEAM_NOT_FOUND = 'TEAM_NOT_FOUND',
  /** 团队状态无效 */
  TEAM_STATE_INVALID = 'TEAM_STATE_INVALID',
  /** Agent 已存在 */
  AGENT_ALREADY_EXISTS = 'AGENT_ALREADY_EXISTS',
  /** Agent 不存在 */
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  /** 配置无效 */
  CONFIG_INVALID = 'CONFIG_INVALID',
  /** 存储错误 */
  STORE_ERROR = 'STORE_ERROR',
  /** 工作区错误 */
  WORKSPACE_ERROR = 'WORKSPACE_ERROR',
  /** 解析错误 */
  PARSE_ERROR = 'PARSE_ERROR',
}

/**
 * 团队错误类
 * @description 团队管理相关的错误
 */
export class TeamError extends Error {
  constructor(
    /** 错误代码 */
    public code: TeamErrorCode,
    /** 错误消息 */
    message: string,
    /** 原始错误 */
    public cause?: Error
  ) {
    super(message);
    this.name = 'TeamError';
  }
}

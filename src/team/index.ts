/**
 * OpenClaw Team Module - Entry Point
 * 
 * 本文件是团队模块的入口，统一导出所有类型和功能。
 */

// 导出所有类型定义
export * from './types.js';

// 导出团队管理器
export {
  TeamManager,
  type TeamManagerOptions,
} from './team-manager.js';

// 导出团队存储
export {
  TeamStore,
  type StoreOptions,
} from './team-store.js';

// 导出配置解析器
export {
  ConfigParser,
  type ParseOptions,
} from './config-parser.js';

// 导出团队状态管理
export {
  TeamStateManager,
  getTeamStateDescription,
  getAgentStateDescription,
  getTaskStateDescription,
  validateTeamConfigState,
} from './team-state.js';

// 导出工作区初始化
export {
  WorkspaceInitializer,
  initializeWorkspace,
  workspaceExists,
  destroyWorkspace,
  generateWorkspaceStructure,
} from './workspace-init.js';

// 导出协调器
export {
  Coordinator,
  createCoordinator,
  AssignmentStrategy,
  AssignmentResult,
  CoordinatorConfig,
  ResultAggregator,
} from './coordinator.js';

// 导出共享状态管理
export {
  SharedStateManager,
  createSharedStateManager,
  SharedStateConfig,
} from './shared-state.js';

// 导出计划审批机制
export {
  configureApproval,
  getApprovalConfig,
  registerNotificationHandler,
  createExecutionPlan,
  submitForApproval,
  approvePlan,
  rejectPlan,
  getApprovalRequest,
  getPendingApprovals,
  getAgentApprovalHistory,
  cancelApproval,
  cleanupExpiredApprovals,
  formatApprovalRequest,
  createConsoleNotificationHandler,
} from './plan-approval.js';

// 导出 Hooks 管理
export {
  registerHook,
  registerHookOnce,
  unregisterHook,
  unregisterAllHooksOfType,
  triggerHook,
  triggerAgentIdle,
  triggerAgentCompleted,
  triggerAgentStuck,
  triggerTeamSync,
  listHooks,
  getHookStats,
  clearAllHooks,
  waitForHook,
  createStandardMonitoringHooks,
} from './hooks-manager.js';

// 导出心跳监控
export {
  HeartbeatMonitor,
  createHeartbeatMonitor,
  type HeartbeatMonitorConfig,
  type HeartbeatEvent,
} from './heartbeat-monitor.js';

// 导出恢复管理器
export {
  RecoveryManager,
  createRecoveryManager,
  type RecoveryManagerConfig,
  type RecoveryEvent,
} from './recovery-manager.js';

// 导出死信队列
export {
  DeadLetterQueue,
  createDeadLetterQueue,
  type DeadLetterQueueConfig,
  type DeadLetterEntry,
} from './dead-letter-queue.js';

// 默认导出 TeamManager
export { TeamManager as default } from './team-manager.js';

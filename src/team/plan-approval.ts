/**
 * 计划审批机制
 * 实现人机协作的分层控制模型
 */

import { randomUUID } from 'crypto';
import {
  type ApprovalRequest,
  type ApprovalStatus,
  type ExecutionPlan,
  type PlanApprovalConfig,
  type PlanStep,
} from './types.js';

/** 审批请求存储 */
const approvalStore = new Map<string, ApprovalRequest>();

/** 默认审批配置 */
const defaultConfig: PlanApprovalConfig = {
  enabled: true,
  timeoutMs: 30 * 60 * 1000, // 30分钟
  notificationChannels: ['log'],
  autoApprove: false,
};

/** 当前审批配置 */
let currentConfig: PlanApprovalConfig = { ...defaultConfig };

/** 用户通知回调 */
const notificationHandlers: Array<(request: ApprovalRequest) => void | Promise<void>> = [];

/**
 * 配置审批系统
 */
export function configureApproval(config: Partial<PlanApprovalConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * 获取当前审批配置
 */
export function getApprovalConfig(): PlanApprovalConfig {
  return { ...currentConfig };
}

/**
 * 注册通知处理器
 */
export function registerNotificationHandler(
  handler: (request: ApprovalRequest) => void | Promise<void>
): () => void {
  notificationHandlers.push(handler);
  return () => {
    const index = notificationHandlers.indexOf(handler);
    if (index > -1) notificationHandlers.splice(index, 1);
  };
}

/**
 * 创建执行计划
 */
export function createExecutionPlan(
  title: string,
  description: string,
  steps: Omit<PlanStep, 'order'>[],
  options?: Partial<Omit<ExecutionPlan, 'title' | 'description' | 'steps'>>
): ExecutionPlan {
  return {
    title,
    description,
    steps: steps.map((step, index) => ({ ...step, order: index + 1 })),
    estimatedDuration: options?.estimatedDuration,
    riskLevel: options?.riskLevel ?? 'low',
  };
}

/**
 * 提交计划进行审批
 * @returns 审批请求对象。如果配置了 autoApprove，直接返回已批准状态
 */
export async function submitForApproval(
  teamId: string,
  agentId: string,
  role: string,
  plan: ExecutionPlan
): Promise<ApprovalRequest> {
  const requestId = randomUUID();

  // 检查是否需要审批
  const requiresApproval =
    currentConfig.enabled &&
    (!currentConfig.requireApprovalFor || currentConfig.requireApprovalFor.includes(role));

  // 自动审批模式（用于测试）
  if (currentConfig.autoApprove) {
    const approvedRequest: ApprovalRequest = {
      requestId,
      teamId,
      agentId,
      role,
      plan,
      status: 'approved',
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + currentConfig.timeoutMs),
      respondedAt: new Date(),
      respondedBy: 'system',
      comment: 'Auto-approved (autoApprove mode)',
    };
    approvalStore.set(requestId, approvedRequest);
    return approvedRequest;
  }

  // 不需要审批，直接通过
  if (!requiresApproval) {
    const autoApprovedRequest: ApprovalRequest = {
      requestId,
      teamId,
      agentId,
      role,
      plan,
      status: 'approved',
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + currentConfig.timeoutMs),
      respondedAt: new Date(),
      respondedBy: 'system',
      comment: 'Auto-approved (no approval required for this role)',
    };
    approvalStore.set(requestId, autoApprovedRequest);
    return autoApprovedRequest;
  }

  // 需要审批
  const request: ApprovalRequest = {
    requestId,
    teamId,
    agentId,
    role,
    plan,
    status: 'pending',
    submittedAt: new Date(),
    expiresAt: new Date(Date.now() + currentConfig.timeoutMs),
  };

  approvalStore.set(requestId, request);

  // 发送通知
  await notifyUser(request);

  return request;
}

/**
 * 批准计划
 */
export async function approvePlan(
  requestId: string,
  approverId: string,
  comment?: string
): Promise<ApprovalRequest | null> {
  const request = approvalStore.get(requestId);
  if (!request) return null;
  if (request.status !== 'pending') return null;

  // 检查是否过期
  if (new Date() > request.expiresAt) {
    request.status = 'expired';
    return request;
  }

  request.status = 'approved';
  request.respondedAt = new Date();
  request.respondedBy = approverId;
  request.comment = comment;

  await notifyUser(request);

  return request;
}

/**
 * 拒绝计划
 */
export async function rejectPlan(
  requestId: string,
  approverId: string,
  comment?: string
): Promise<ApprovalRequest | null> {
  const request = approvalStore.get(requestId);
  if (!request) return null;
  if (request.status !== 'pending') return null;

  request.status = 'rejected';
  request.respondedAt = new Date();
  request.respondedBy = approverId;
  request.comment = comment;

  await notifyUser(request);

  return request;
}

/**
 * 获取审批请求
 */
export function getApprovalRequest(requestId: string): ApprovalRequest | undefined {
  const request = approvalStore.get(requestId);
  if (!request) return undefined;

  // 检查过期状态
  if (request.status === 'pending' && new Date() > request.expiresAt) {
    request.status = 'expired';
  }

  return request;
}

/**
 * 获取团队的待审批请求
 */
export function getPendingApprovals(teamId: string): ApprovalRequest[] {
  const results: ApprovalRequest[] = [];
  const now = new Date();

  for (const request of approvalStore.values()) {
    if (request.teamId === teamId) {
      // 检查过期
      if (request.status === 'pending' && now > request.expiresAt) {
        request.status = 'expired';
      }
      if (request.status === 'pending') {
        results.push(request);
      }
    }
  }

  return results.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
}

/**
 * 获取 Agent 的审批历史
 */
export function getAgentApprovalHistory(
  agentId: string,
  options?: { limit?: number; status?: ApprovalStatus }
): ApprovalRequest[] {
  const results: ApprovalRequest[] = [];

  for (const request of approvalStore.values()) {
    if (request.agentId === agentId) {
      if (!options?.status || request.status === options.status) {
        results.push(request);
      }
    }
  }

  results.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

  if (options?.limit) {
    return results.slice(0, options.limit);
  }

  return results;
}

/**
 * 取消审批请求
 */
export function cancelApproval(requestId: string, reason?: string): boolean {
  const request = approvalStore.get(requestId);
  if (!request || request.status !== 'pending') return false;

  request.status = 'rejected';
  request.respondedAt = new Date();
  request.respondedBy = 'system';
  request.comment = reason ?? 'Cancelled by system';

  return true;
}

/**
 * 清理过期的审批请求
 */
export function cleanupExpiredApprovals(): number {
  let count = 0;
  const now = new Date();

  for (const [id, request] of approvalStore) {
    if (request.status === 'pending' && now > request.expiresAt) {
      request.status = 'expired';
      count++;
    }
  }

  return count;
}

/**
 * 通知用户有新的审批请求
 */
async function notifyUser(request: ApprovalRequest): Promise<void> {
  for (const handler of notificationHandlers) {
    try {
      await handler(request);
    } catch (error) {
      console.error('Notification handler failed:', error);
    }
  }
}

/**
 * 格式化审批请求为可读文本
 */
export function formatApprovalRequest(request: ApprovalRequest): string {
  const lines = [
    `📋 审批请求 #${request.requestId.slice(0, 8)}`,
    `状态: ${getStatusEmoji(request.status)} ${request.status}`,
    `团队: ${request.teamId}`,
    `Agent: ${request.agentId} (${request.role})`,
    `提交时间: ${request.submittedAt.toLocaleString()}`,
    ``,
    `📌 ${request.plan.title}`,
    `${request.plan.description}`,
    ``,
    `执行步骤:`,
    ...request.plan.steps.map((s) => `  ${s.order}. ${s.description}`),
  ];

  if (request.plan.estimatedDuration) {
    lines.push(`\n预计耗时: ${request.plan.estimatedDuration}`);
  }

  if (request.plan.riskLevel) {
    lines.push(`风险等级: ${request.plan.riskLevel}`);
  }

  if (request.respondedAt) {
    lines.push(
      `\n✓ ${request.status === 'approved' ? '批准' : '拒绝'}于 ${request.respondedAt.toLocaleString()}`
    );
    if (request.respondedBy) lines.push(`审批人: ${request.respondedBy}`);
    if (request.comment) lines.push(`备注: ${request.comment}`);
  } else {
    lines.push(`\n⏰ 过期时间: ${request.expiresAt.toLocaleString()}`);
  }

  return lines.join('\n');
}

function getStatusEmoji(status: ApprovalStatus): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'approved':
      return '✅';
    case 'rejected':
      return '❌';
    case 'expired':
      return '⌛';
    default:
      return '❓';
  }
}

/**
 * 创建控制台通知处理器
 */
export function createConsoleNotificationHandler(): void {
  registerNotificationHandler((request) => {
    console.log('\n' + '='.repeat(60));
    console.log(formatApprovalRequest(request));
    console.log('='.repeat(60) + '\n');
  });
}

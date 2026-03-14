/**
 * Hooks 管理系统
 * 实现事件驱动的 Agent 状态监控和团队同步
 */

import type {
  AgentCompletedPayload,
  AgentIdlePayload,
  AgentStuckPayload,
  HookHandler,
  HookHandlerFunction,
  HookPayload,
  HookType,
  TeamSyncPayload,
} from './types.js';

/** 存储所有注册的 hooks */
const hookRegistry = new Map<HookType, Map<string, HookHandler>>();

/** 全局 hook 计数器，用于生成唯一 ID */
let hookIdCounter = 0;

/**
 * 初始化 Hook 注册表
 */
function ensureHookTypeRegistry(type: HookType): Map<string, HookHandler> {
  if (!hookRegistry.has(type)) {
    hookRegistry.set(type, new Map());
  }
  return hookRegistry.get(type)!;
}

/**
 * 注册一个 Hook 处理器
 * @param type - Hook 类型
 * @param handler - 处理函数
 * @param options - 可选配置
 * @returns 取消注册的函数
 */
export function registerHook(
  type: HookType,
  handler: HookHandlerFunction,
  options?: {
    priority?: number;
    once?: boolean;
  }
): () => void {
  const registry = ensureHookTypeRegistry(type);
  const id = `hook_${++hookIdCounter}_${Date.now()}`;

  const hookHandler: HookHandler = {
    id,
    type,
    handler,
    priority: options?.priority ?? 100,
    once: options?.once ?? false,
  };

  registry.set(id, hookHandler);

  // 返回取消注册函数
  return () => {
    registry.delete(id);
  };
}

/**
 * 注册一次性 Hook（执行后自动移除）
 * @param type - Hook 类型
 * @param handler - 处理函数
 * @param options - 可选配置
 * @returns 取消注册的函数
 */
export function registerHookOnce(
  type: HookType,
  handler: HookHandlerFunction,
  options?: { priority?: number }
): () => void {
  return registerHook(type, handler, { ...options, once: true });
}

/**
 * 注销特定 Hook
 * @param hookId - Hook ID
 */
export function unregisterHook(hookId: string): boolean {
  for (const registry of hookRegistry.values()) {
    if (registry.has(hookId)) {
      registry.delete(hookId);
      return true;
    }
  }
  return false;
}

/**
 * 注销指定类型的所有 Hooks
 * @param type - Hook 类型
 */
export function unregisterAllHooksOfType(type: HookType): number {
  const registry = hookRegistry.get(type);
  if (!registry) return 0;

  const count = registry.size;
  registry.clear();
  return count;
}

/**
 * 触发 Hook
 * @param type - Hook 类型
 * @param payload - 事件数据
 */
export async function triggerHook<T extends HookPayload>(type: T['type'], payload: Omit<T, 'type' | 'timestamp'>): Promise<void> {
  const fullPayload = {
    ...payload,
    type,
    timestamp: new Date(),
  } as T;

  const registry = hookRegistry.get(type as HookType);
  if (!registry || registry.size === 0) return;

  // 按优先级排序
  const handlers = Array.from(registry.values()).sort(
    (a, b) => a.priority - b.priority
  );

  // 收集需要移除的一次性 handlers
  const toRemove: string[] = [];

  for (const hook of handlers) {
    try {
      await hook.handler(fullPayload as unknown as HookPayload);

      if (hook.once) {
        toRemove.push(hook.id);
      }
    } catch (error) {
      console.error(`Hook handler failed for ${type}:`, error);
    }
  }

  // 移除一次性 handlers
  for (const id of toRemove) {
    registry.delete(id);
  }
}

/**
 * 触发 agent:idle Hook
 */
export async function triggerAgentIdle(
  teamId: string,
  agentId: string,
  data: AgentIdlePayload['data']
): Promise<void> {
  await triggerHook<AgentIdlePayload>('agent:idle', {
    teamId,
    agentId,
    data,
  });
}

/**
 * 触发 agent:completed Hook
 */
export async function triggerAgentCompleted(
  teamId: string,
  agentId: string,
  data: AgentCompletedPayload['data']
): Promise<void> {
  await triggerHook<AgentCompletedPayload>('agent:completed', {
    teamId,
    agentId,
    data,
  });
}

/**
 * 触发 agent:stuck Hook
 */
export async function triggerAgentStuck(
  teamId: string,
  agentId: string,
  data: AgentStuckPayload['data']
): Promise<void> {
  await triggerHook<AgentStuckPayload>('agent:stuck', {
    teamId,
    agentId,
    data,
  });
}

/**
 * 触发 team:sync Hook
 */
export async function triggerTeamSync(
  teamId: string,
  data: TeamSyncPayload['data']
): Promise<void> {
  await triggerHook<TeamSyncPayload>('team:sync', {
    teamId,
    data,
  });
}

/**
 * 获取已注册的 Hook 列表
 * @param type - 可选，指定 Hook 类型
 */
export function listHooks(type?: HookType): HookHandler[] {
  if (type) {
    const registry = hookRegistry.get(type);
    return registry ? Array.from(registry.values()) : [];
  }

  const all: HookHandler[] = [];
  for (const registry of hookRegistry.values()) {
    all.push(...registry.values());
  }
  return all;
}

/**
 * 获取 Hook 统计信息
 */
export function getHookStats(): Record<HookType | 'total', number> {
  const stats: Record<string, number> = { total: 0 };

  for (const [type, registry] of hookRegistry) {
    const count = registry.size;
    stats[type] = count;
    stats.total += count;
  }

  return stats as Record<HookType | 'total', number>;
}

/**
 * 清空所有 Hooks
 */
export function clearAllHooks(): void {
  hookRegistry.clear();
  hookIdCounter = 0;
}

/**
 * 等待特定类型的 Hook 被触发（一次性的 Promise 封装）
 * @param type - Hook 类型
 * @param timeoutMs - 超时时间
 * @returns Promise 解析为 payload
 */
export function waitForHook<T extends HookPayload>(
  type: T['type'],
  timeoutMs = 30000,
  filter?: (payload: T) => boolean
): Promise<T> {
  return new Promise((resolve, reject) => {
    let cleanup: (() => void) | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    const handler = (payload: HookPayload) => {
      if (filter && !filter(payload as T)) return;

      if (cleanup) cleanup();
      if (timeoutId) clearTimeout(timeoutId);

      resolve(payload as T);
    };

    cleanup = registerHook(type as HookType, handler, { once: true });

    timeoutId = setTimeout(() => {
      if (cleanup) cleanup();
      reject(new Error(`Timeout waiting for hook ${type} after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * 创建标准的监控 Hooks 组合
 * 用于快速设置常见的监控场景
 */
export function createStandardMonitoringHooks(options: {
  onIdle?: (payload: AgentIdlePayload) => void | Promise<void>;
  onCompleted?: (payload: AgentCompletedPayload) => void | Promise<void>;
  onStuck?: (payload: AgentStuckPayload) => void | Promise<void>;
  onSync?: (payload: TeamSyncPayload) => void | Promise<void>;
}): () => void {
  const cleanups: Array<() => void> = [];

  if (options.onIdle) {
    cleanups.push(
      registerHook('agent:idle', options.onIdle as HookHandlerFunction)
    );
  }

  if (options.onCompleted) {
    cleanups.push(
      registerHook('agent:completed', options.onCompleted as HookHandlerFunction)
    );
  }

  if (options.onStuck) {
    cleanups.push(
      registerHook('agent:stuck', options.onStuck as HookHandlerFunction)
    );
  }

  if (options.onSync) {
    cleanups.push(
      registerHook('team:sync', options.onSync as HookHandlerFunction)
    );
  }

  // 返回一个可以清理所有 hooks 的函数
  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

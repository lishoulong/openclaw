/**
 * 模型路由
 * 实现角色驱动的模型选择和回退链
 */

import type {
  ModelRouterConfig,
  ModelSelectionResult,
  ModelTier,
  RoleModelMapping,
} from './types.js';

/** 默认角色-模型映射配置 */
const defaultMappings: RoleModelMapping[] = [
  {
    role: 'lead',
    primaryModel: 'gpt-4o',
    fallbackChain: ['claude-3-5-sonnet', 'gpt-4o-mini'],
    tier: 'capable',
  },
  {
    role: 'planning',
    primaryModel: 'claude-3-5-sonnet',
    fallbackChain: ['gpt-4o', 'gpt-4o-mini'],
    tier: 'capable',
  },
  {
    role: 'coding',
    primaryModel: 'claude-3-5-sonnet',
    fallbackChain: ['gpt-4o', 'deepseek-chat'],
    tier: 'capable',
  },
  {
    role: 'review',
    primaryModel: 'claude-3-5-sonnet',
    fallbackChain: ['gpt-4o', 'gpt-4o-mini'],
    tier: 'capable',
  },
  {
    role: 'testing',
    primaryModel: 'gpt-4o-mini',
    fallbackChain: ['claude-3-haiku', 'deepseek-chat'],
    tier: 'balanced',
  },
  {
    role: 'custom',
    primaryModel: 'gpt-4o-mini',
    fallbackChain: ['deepseek-chat', 'claude-3-haiku'],
    tier: 'balanced',
  },
];

/** 默认路由配置 */
const defaultConfig: ModelRouterConfig = {
  defaultModel: 'gpt-4o-mini',
  mappings: defaultMappings,
  fallbackStrategy: 'chain',
  allowUserOverride: true,
  userOverrideWhitelist: [],
};

/** 当前路由配置 */
let currentConfig: ModelRouterConfig = { ...defaultConfig, mappings: [...defaultMappings] };

/** 模型可用性状态 */
const modelAvailability = new Map<string, { available: boolean; lastCheck: Date; error?: string }>();

/** 用户覆盖映射 */
const userOverrides = new Map<string, string>();

/**
 * 配置模型路由
 */
export function configureModelRouter(config: Partial<ModelRouterConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...config,
    mappings: config.mappings ?? currentConfig.mappings,
  };
}

/**
 * 获取当前路由配置
 */
export function getRouterConfig(): ModelRouterConfig {
  return {
    ...currentConfig,
    mappings: [...currentConfig.mappings],
  };
}

/**
 * 获取角色的模型映射
 */
export function getRoleMapping(role: string): RoleModelMapping | undefined {
  return currentConfig.mappings.find((m) => m.role === role);
}

/**
 * 添加或更新角色映射
 */
export function setRoleMapping(mapping: RoleModelMapping): void {
  const index = currentConfig.mappings.findIndex((m) => m.role === mapping.role);
  if (index >= 0) {
    currentConfig.mappings[index] = mapping;
  } else {
    currentConfig.mappings.push(mapping);
  }
}

/**
 * 移除角色映射
 */
export function removeRoleMapping(role: string): boolean {
  const index = currentConfig.mappings.findIndex((m) => m.role === role);
  if (index >= 0) {
    currentConfig.mappings.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * 选择模型
 * @param role - Agent 角色
 * @param userId - 用户 ID（用于检查用户覆盖）
 * @param preferredTier - 偏好的模型层级
 * @returns 模型选择结果
 */
export function selectModel(
  role: string,
  userId?: string,
  preferredTier?: ModelTier
): ModelSelectionResult {
  // 检查用户覆盖
  if (userId && currentConfig.allowUserOverride) {
    const override = userOverrides.get(userId);
    if (override) {
      // 检查白名单
      if (
        currentConfig.userOverrideWhitelist!.length === 0 ||
        currentConfig.userOverrideWhitelist!.includes(override)
      ) {
        return {
          model: override,
          reason: 'User override',
          isUserOverride: true,
        };
      }
    }
  }

  // 获取角色映射
  const mapping = getRoleMapping(role);
  if (!mapping) {
    // 使用默认模型
    return {
      model: currentConfig.defaultModel,
      reason: `No mapping found for role "${role}", using default model`,
      isUserOverride: false,
    };
  }

  // 检查层级偏好
  if (preferredTier && mapping.tier !== preferredTier) {
    // 尝试找到匹配层级的映射
    const tierMapping = currentConfig.mappings.find((m) => m.role === role && m.tier === preferredTier);
    if (tierMapping) {
      const model = findAvailableModel(tierMapping);
      return {
        model,
        reason: `Selected based on preferred tier "${preferredTier}"`,
        isUserOverride: false,
        originalMapping: tierMapping,
      };
    }
  }

  // 使用角色映射选择模型
  const model = findAvailableModel(mapping);

  return {
    model,
    reason: `Selected based on role "${role}" mapping`,
    isUserOverride: false,
    originalMapping: mapping,
  };
}

/**
 * 根据回退策略查找可用模型
 */
function findAvailableModel(mapping: RoleModelMapping): string {
  const allModels = [mapping.primaryModel, ...mapping.fallbackChain];

  switch (currentConfig.fallbackStrategy) {
    case 'chain':
      // 按顺序查找第一个可用模型
      for (const model of allModels) {
        if (isModelAvailable(model)) {
          return model;
        }
      }
      break;

    case 'fastest':
      // 返回第一个已知最快的可用模型
      // 这里简化处理，实际应该基于历史响应时间
      for (const model of allModels) {
        if (isModelAvailable(model)) {
          return model;
        }
      }
      break;

    case 'cheapest':
      // 返回成本最低的可用模型
      // 这里简化处理，实际应该有成本配置
      for (const model of allModels) {
        if (isModelAvailable(model)) {
          return model;
        }
      }
      break;
  }

  // 如果都不可用，返回主模型（让调用方处理失败）
  return mapping.primaryModel;
}

/**
 * 检查模型是否可用
 */
function isModelAvailable(model: string): boolean {
  const status = modelAvailability.get(model);
  if (!status) return true; // 默认假设可用
  return status.available;
}

/**
 * 更新模型可用性状态
 */
export function updateModelAvailability(
  model: string,
  available: boolean,
  error?: string
): void {
  modelAvailability.set(model, {
    available,
    lastCheck: new Date(),
    error,
  });
}

/**
 * 批量更新模型可用性
 */
export function batchUpdateAvailability(
  updates: Array<{ model: string; available: boolean; error?: string }>
): void {
  for (const update of updates) {
    updateModelAvailability(update.model, update.available, update.error);
  }
}

/**
 * 获取模型可用性状态
 */
export function getModelAvailability(model: string): { available: boolean; lastCheck?: Date; error?: string } | undefined {
  const status = modelAvailability.get(model);
  if (!status) return undefined;
  return { ...status };
}

/**
 * 设置用户模型覆盖
 */
export function setUserOverride(userId: string, model: string): boolean {
  if (!currentConfig.allowUserOverride) return false;

  // 检查白名单
  if (
    currentConfig.userOverrideWhitelist!.length > 0 &&
    !currentConfig.userOverrideWhitelist!.includes(model)
  ) {
    return false;
  }

  userOverrides.set(userId, model);
  return true;
}

/**
 * 清除用户模型覆盖
 */
export function clearUserOverride(userId: string): boolean {
  return userOverrides.delete(userId);
}

/**
 * 获取用户模型覆盖
 */
export function getUserOverride(userId: string): string | undefined {
  return userOverrides.get(userId);
}

/**
 * 获取回退链
 * @param role - 角色
 * @param startFrom - 从哪个模型开始（如果从主模型失败后开始）
 * @returns 回退链列表
 */
export function getFallbackChain(role: string, startFrom?: string): string[] {
  const mapping = getRoleMapping(role);
  if (!mapping) return [currentConfig.defaultModel];

  const allModels = [mapping.primaryModel, ...mapping.fallbackChain];

  if (startFrom) {
    const index = allModels.indexOf(startFrom);
    if (index >= 0) {
      return allModels.slice(index + 1);
    }
  }

  return allModels;
}

/**
 * 获取下一个回退模型
 */
export function getNextFallback(role: string, currentModel: string): string | undefined {
  const chain = getFallbackChain(role, currentModel);
  return chain.length > 0 ? chain[0] : undefined;
}

/**
 * 列出所有角色映射
 */
export function listRoleMappings(): RoleModelMapping[] {
  return [...currentConfig.mappings];
}

/**
 * 根据层级筛选角色映射
 */
export function getMappingsByTier(tier: ModelTier): RoleModelMapping[] {
  return currentConfig.mappings.filter((m) => m.tier === tier);
}

/**
 * 重置路由配置为默认值
 */
export function resetToDefaults(): void {
  currentConfig = {
    ...defaultConfig,
    mappings: [...defaultMappings],
  };
  modelAvailability.clear();
  userOverrides.clear();
}

/**
 * 获取路由统计信息
 */
export function getRouterStats(): {
  totalMappings: number;
  availableModels: number;
  unavailableModels: number;
  userOverridesCount: number;
} {
  let availableModels = 0;
  let unavailableModels = 0;

  for (const status of modelAvailability.values()) {
    if (status.available) {
      availableModels++;
    } else {
      unavailableModels++;
    }
  }

  return {
    totalMappings: currentConfig.mappings.length,
    availableModels,
    unavailableModels,
    userOverridesCount: userOverrides.size,
  };
}

/**
 * 验证模型配置
 */
export function validateConfiguration(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 检查默认模型
  if (!currentConfig.defaultModel) {
    errors.push('Default model is required');
  }

  // 检查角色映射
  for (const mapping of currentConfig.mappings) {
    if (!mapping.primaryModel) {
      errors.push(`Role "${mapping.role}" has no primary model`);
    }
    if (!mapping.fallbackChain) {
      errors.push(`Role "${mapping.role}" has no fallback chain`);
    }
  }

  // 检查白名单配置
  if (
    currentConfig.allowUserOverride &&
    currentConfig.userOverrideWhitelist &&
    !Array.isArray(currentConfig.userOverrideWhitelist)
  ) {
    errors.push('User override whitelist must be an array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

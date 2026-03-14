/**
 * 自然语言解析器
 * 从自然语言中提取团队创建意图和参数
 */

import type {
  NLPParserConfig,
  ParsedRole,
  ParsedTeamRequest,
  TeamCreationParams,
  TeamIntent,
} from './types.js';

/** 默认解析配置 */
const defaultConfig: NLPParserConfig = {
  useLLM: false,
  minConfidence: 0.6,
  roleKeywords: {
    lead: ['负责人', '组长', '领导', 'lead', 'manager', 'coordinator', '主管'],
    planning: ['规划', '策划', '设计', '架构', 'planning', 'architect', 'designer'],
    coding: ['开发', '编码', '编程', 'coding', 'developer', 'engineer', 'programmer', '实现'],
    review: ['审查', '审核', '检查', 'review', 'reviewer', 'auditor', 'code review'],
    testing: ['测试', 'QA', 'testing', 'tester', '质量保证', '验证'],
    custom: ['自定义', '辅助', '支持', 'custom', 'assistant', 'helper'],
  },
  modeKeywords: {
    'hub-and-spoke': ['中心', 'hub', '集中', 'coordinator'],
    mesh: ['网状', 'mesh', '点对点', 'p2p', '对等'],
  },
};

/** 当前配置 */
let currentConfig: NLPParserConfig = { ...defaultConfig };

/**
 * 配置解析器
 */
export function configureParser(config: Partial<NLPParserConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...config,
    roleKeywords: { ...currentConfig.roleKeywords, ...config.roleKeywords },
    modeKeywords: { ...currentConfig.modeKeywords, ...config.modeKeywords },
  };
}

/**
 * 获取当前配置
 */
export function getParserConfig(): NLPParserConfig {
  return {
    ...currentConfig,
    roleKeywords: { ...currentConfig.roleKeywords },
    modeKeywords: { ...currentConfig.modeKeywords },
  };
}

/**
 * 解析自然语言团队创建请求
 * @param input - 用户输入的自然语言
 * @returns 解析结果
 */
export function parseTeamRequest(input: string): ParsedTeamRequest {
  if (!input || typeof input !== 'string') {
    return {
      success: false,
      error: 'Input is required and must be a string',
      intent: 'unknown',
      parameters: {},
      confidence: 0,
    };
  }

  const normalizedInput = input.toLowerCase().trim();

  // 1. 意图识别
  const intent = detectIntent(normalizedInput);

  // 如果不是创建团队的意图
  if (intent !== 'create_team') {
    return {
      success: true,
      intent,
      parameters: extractGenericParameters(normalizedInput),
      confidence: 0.5,
    };
  }

  // 2. 提取参数
  const params = extractTeamCreationParams(normalizedInput);

  // 3. 计算置信度
  const confidence = calculateConfidence(normalizedInput, params);

  // 4. 检查最低置信度
  if (confidence < currentConfig.minConfidence) {
    return {
      success: false,
      error: `Confidence ${confidence.toFixed(2)} is below threshold ${currentConfig.minConfidence}`,
      intent,
      parameters: params,
      confidence,
    };
  }

  return {
    success: true,
    intent,
    parameters: params,
    confidence,
  };
}

/**
 * 检测意图
 */
function detectIntent(input: string): TeamIntent {
  const createPatterns = [
    /创建.*团队/,
    /新建.*团队/,
    /创建.*team/,
    /create.*team/,
    /组建.*团队/,
    /成立.*团队/,
    /安排.*agent/,
    /分配.*任务/,
  ];

  const addMemberPatterns = [/添加.*成员/, /增加.*agent/, /add.*member/, /加入.*成员/];

  const removeMemberPatterns = [/移除.*成员/, /删除.*agent/, /remove.*member/, /踢出.*成员/];

  const updateConfigPatterns = [/更新.*配置/, /修改.*设置/, /update.*config/, /调整.*参数/];

  for (const pattern of createPatterns) {
    if (pattern.test(input)) return 'create_team';
  }

  for (const pattern of addMemberPatterns) {
    if (pattern.test(input)) return 'add_member';
  }

  for (const pattern of removeMemberPatterns) {
    if (pattern.test(input)) return 'remove_member';
  }

  for (const pattern of updateConfigPatterns) {
    if (pattern.test(input)) return 'update_config';
  }

  // 如果没有明确匹配，检查是否包含团队相关关键词
  if (input.includes('团队') || input.includes('team') || input.includes('agent')) {
    return 'create_team'; // 默认假设是创建团队
  }

  return 'unknown';
}

/**
 * 提取团队创建参数
 */
function extractTeamCreationParams(input: string): TeamCreationParams {
  const params: TeamCreationParams = {};

  // 提取任务描述
  params.task = extractTaskDescription(input);

  // 提取团队名称
  params.name = extractTeamName(input);

  // 提取协调模式
  params.coordinationMode = extractCoordinationMode(input);

  // 提取角色
  params.roles = extractRoles(input);

  // 提取团队规模
  params.size = extractTeamSize(input);

  return params;

}

/**
 * 提取任务描述
 */
function extractTaskDescription(input: string): string | undefined {
  // 匹配 "做...", "负责...", "任务是...", "开发..." 等模式
  const patterns = [
    /(?:任务|目的|目标|做|负责|开发|实现|完成)[:：]?\s*(.+?)(?:[,，。]|$)/,
    /(?:for|to)\s+(.+?)(?:[,，。]|$)/i,
    /(?:做|完成|开发)\s*(.+?)(?:[,，。]|$)/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      const description = match[1].trim();
      // 过滤掉过短的描述
      if (description.length > 3) {
        return description;
      }
    }
  }

  // 如果没有明确标记，取整句话作为任务描述
  return input.length > 10 ? input : undefined;
}

/**
 * 提取团队名称
 */
function extractTeamName(input: string): string | undefined {
  // 匹配 "叫...", "名为...", "名称是..." 等模式
  const patterns = [
    /(?:叫|名为|名称是|名字是)[:：]?\s*[""']?([^""'，。,]+)[""']?/,
    /(?:team|团队)\s+[""']?([^""'，。,]+)[""']?/i,
    /[""']([^""']+)[""']\s*(?:team|团队)/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * 提取协调模式
 */
function extractCoordinationMode(input: string): 'hub-and-spoke' | 'mesh' | undefined {
  for (const [mode, keywords] of Object.entries(currentConfig.modeKeywords)) {
    for (const keyword of keywords) {
      if (input.includes(keyword.toLowerCase())) {
        return mode as 'hub-and-spoke' | 'mesh';
      }
    }
  }

  // 默认模式
  return 'hub-and-spoke';
}

/**
 * 提取角色
 */
function extractRoles(input: string): ParsedRole[] {
  const roles: ParsedRole[] = [];
  const foundRoles = new Set<string>();

  // 1. 通过关键词匹配
  for (const [roleType, keywords] of Object.entries(currentConfig.roleKeywords)) {
    for (const keyword of keywords) {
      if (input.includes(keyword.toLowerCase())) {
        if (!foundRoles.has(roleType)) {
          const count = extractRoleCount(input, keyword);
          roles.push({
            name: capitalize(roleType),
            type: roleType as ParsedRole['type'],
            count,
          });
          foundRoles.add(roleType);
        }
        break;
      }
    }
  }

  // 2. 如果没有找到任何角色，添加默认角色
  if (roles.length === 0) {
    // 尝试提取数量信息，如 "3个开发人员"
    const countMatch = input.match(/(\d+)\s*个?\s*(开发|程序|工程|测试|审核)/);
    if (countMatch) {
      const count = parseInt(countMatch[1], 10);
      const roleHint = countMatch[2];
      let roleType: ParsedRole['type'] = 'custom';

      if (roleHint.includes('开发') || roleHint.includes('程序')) {
        roleType = 'coding';
      } else if (roleHint.includes('测试')) {
        roleType = 'testing';
      } else if (roleHint.includes('审核')) {
        roleType = 'review';
      }

      roles.push({
        name: capitalize(roleType),
        type: roleType,
        count,
      });
    }
  }

  // 3. 确保至少有一个角色
  if (roles.length === 0) {
    roles.push({
      name: 'Developer',
      type: 'coding',
      count: 1,
    });
  }

  return roles;
}

/**
 * 提取角色数量
 */
function extractRoleCount(input: string, keyword: string): number | undefined {
  // 匹配 "N个keyword" 或 "keyword N个" 的模式
  const patterns = [
    new RegExp(`(\\d+)\\s*个?\\s*${keyword}`),
    new RegExp(`${keyword}\\s*(\\d+)\\s*个?`),
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return undefined;
}

/**
 * 提取团队规模
 */
function extractTeamSize(input: string): number | undefined {
  // 匹配 "N个人", "N个agent", "规模为N" 等模式
  const patterns = [
    /(\d+)\s*个?\s*(?:人|agent|成员|member)/i,
    /规模[:：]?\s*(\d+)/,
    /size[:：]?\s*(\d+)/i,
    /一共[:：]?\s*(\d+)/,
    /总共[:：]?\s*(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return undefined;
}

/**
 * 提取通用参数（用于非创建团队的意图）
 */
function extractGenericParameters(input: string): TeamCreationParams {
  return {
    task: extractTaskDescription(input),
    name: extractTeamName(input),
  };
}

/**
 * 计算置信度
 */
function calculateConfidence(input: string, params: TeamCreationParams): number {
  let score = 0;
  let factors = 0;

  // 有任务描述
  if (params.task) {
    score += 1;
    factors++;
  }

  // 有团队名称
  if (params.name) {
    score += 1;
    factors++;
  }

  // 有角色定义
  if (params.roles && params.roles.length > 0) {
    score += Math.min(params.roles.length * 0.3, 1);
    factors++;
  }

  // 有协调模式
  if (params.coordinationMode) {
    score += 0.5;
    factors++;
  }

  // 输入长度（作为质量的粗略指标）
  if (input.length > 20) {
    score += 0.5;
    factors++;
  }

  return factors > 0 ? Math.min(score / factors, 1) : 0;
}

/**
 * 添加角色关键词
 */
export function addRoleKeywords(role: string, keywords: string[]): void {
  if (!currentConfig.roleKeywords[role]) {
    currentConfig.roleKeywords[role] = [];
  }
  currentConfig.roleKeywords[role].push(...keywords);
}

/**
 * 添加协调模式关键词
 */
export function addModeKeywords(mode: string, keywords: string[]): void {
  if (!currentConfig.modeKeywords[mode]) {
    currentConfig.modeKeywords[mode] = [];
  }
  currentConfig.modeKeywords[mode].push(...keywords);
}

/**
 * 重置配置为默认值
 */
export function resetToDefaults(): void {
  currentConfig = { ...defaultConfig };
}

/**
 * 工具函数：首字母大写
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * 批量解析多个请求
 */
export function parseMultipleRequests(inputs: string[]): ParsedTeamRequest[] {
  return inputs.map((input) => parseTeamRequest(input));
}

/**
 * 获取解析统计信息
 */
export function getParserStats(): {
  roleKeywordsCount: number;
  modeKeywordsCount: number;
} {
  return {
    roleKeywordsCount: Object.keys(currentConfig.roleKeywords).length,
    modeKeywordsCount: Object.keys(currentConfig.modeKeywords).length,
  };
}

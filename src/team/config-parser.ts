/**
 * Config Parser - YAML 配置解析器
 * 负责解析和验证团队配置文件
 */

import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import {
  TeamConfig,
  AgentConfig,
  AgentRole,
  CoordinationMode,
  TeamError,
  TeamErrorCode,
} from './types.js';

// YAML 文件结构定义
interface YamlAgentConfig {
  agentId: string;
  role: string;
  model?: string;
  systemPrompt?: string;
  requiresApproval?: boolean;
  skills?: string[];
  maxRetries?: number;
  timeout?: number;
}

interface YamlTeamConfig {
  teamId: string;
  name?: string;
  task: string;
  description?: string;
  coordinationMode?: string;
  lead?: YamlAgentConfig;
  members: YamlAgentConfig[];
  sharedWorkspace?: string;
  planApproval?: {
    enabled: boolean;
    stages?: string[];
    timeout?: number;
  };
  recovery?: {
    enabled: boolean;
    maxRetries?: number;
    backoffMultiplier?: number;
  };
  heartbeat?: {
    intervalMs: number;
    timeoutMs: number;
    maxRetries?: number;
    backoffMultiplier?: number;
  };
  hooks?: {
    'agent:idle'?: string[];
    'agent:completed'?: string[];
    'agent:stuck'?: string[];
    'team:sync'?: string[];
  };
  metadata?: Record<string, unknown>;
}

// 验证 Schema
const YamlAgentConfigSchema = z.object({
  agentId: z.string().min(1, 'Agent ID cannot be empty'),
  role: z.string().min(1, 'Role cannot be empty'),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  requiresApproval: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  maxRetries: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
});

const YamlTeamConfigSchema = z.object({
  teamId: z.string().min(1, 'Team ID cannot be empty'),
  name: z.string().optional(),
  task: z.string().min(1, 'Task description cannot be empty'),
  description: z.string().optional(),
  coordinationMode: z.enum(['hub-and-spoke', 'mesh']).optional(),
  lead: YamlAgentConfigSchema.optional(),
  members: z.array(YamlAgentConfigSchema).min(1, 'At least one member is required'),
  sharedWorkspace: z.string().optional(),
  planApproval: z.object({
    enabled: z.boolean(),
    stages: z.array(z.enum(['goal', 'plan', 'result'])).optional(),
    timeout: z.number().int().positive().optional(),
  }).optional(),
  recovery: z.object({
    enabled: z.boolean(),
    maxRetries: z.number().int().positive().optional(),
    backoffMultiplier: z.number().positive().optional(),
  }).optional(),
  heartbeat: z.object({
    intervalMs: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().positive().optional(),
    backoffMultiplier: z.number().positive().optional(),
  }).optional(),
  hooks: z.object({
    'agent:idle': z.array(z.string()).optional(),
    'agent:completed': z.array(z.string()).optional(),
    'agent:stuck': z.array(z.string()).optional(),
    'team:sync': z.array(z.string()).optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export interface ParseOptions {
  validate?: boolean;
  applyDefaults?: boolean;
}

export class ConfigParser {
  private readonly defaultOptions: ParseOptions = {
    validate: true,
    applyDefaults: true,
  };

  /**
   * 从文件解析配置
   */
  async parseFromFile(filePath: string, options?: ParseOptions): Promise<TeamConfig> {
    let content: string;
    
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TeamError(
          TeamErrorCode.CONFIG_INVALID,
          `Configuration file not found: ${filePath}`
        );
      }
      
      throw new TeamError(
        TeamErrorCode.CONFIG_INVALID,
        `Failed to read configuration file: ${filePath}`,
        error instanceof Error ? error : undefined
      );
    }

    return this.parseFromString(content, options);
  }

  /**
   * 从字符串解析配置
   */
  parseFromString(content: string, options?: ParseOptions): TeamConfig {
    const opts = { ...this.defaultOptions, ...options };
    
    // 解析 YAML
    let yamlConfig: YamlTeamConfig;
    try {
      yamlConfig = yaml.load(content) as YamlTeamConfig;
    } catch (error) {
      throw new TeamError(
        TeamErrorCode.PARSE_ERROR,
        `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }

    if (!yamlConfig) {
      throw new TeamError(
        TeamErrorCode.PARSE_ERROR,
        'YAML configuration is empty'
      );
    }

    // 验证
    if (opts.validate) {
      this.validate(yamlConfig);
    }

    // 转换并应用默认值
    return this.transform(yamlConfig, opts.applyDefaults);
  }

  /**
   * 验证配置
   */
  private validate(config: YamlTeamConfig): void {
    const result = YamlTeamConfigSchema.safeParse(config);
    
    if (!result.success) {
      const errors = result.error.errors
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join('\n');
      
      throw new TeamError(
        TeamErrorCode.CONFIG_INVALID,
        `Configuration validation failed:\n${errors}`
      );
    }

    // 额外验证：检查 Agent ID 唯一性
    const agentIds = new Set<string>();
    
    if (config.lead) {
      agentIds.add(config.lead.agentId);
    }
    
    for (const member of config.members) {
      if (agentIds.has(member.agentId)) {
        throw new TeamError(
          TeamErrorCode.CONFIG_INVALID,
          `Duplicate agent ID: ${member.agentId}`
        );
      }
      agentIds.add(member.agentId);
    }

    // 验证 lead 不能同时出现在 members 中
    if (config.lead) {
      const leadInMembers = config.members.find(m => m.agentId === config.lead!.agentId);
      if (leadInMembers) {
        throw new TeamError(
          TeamErrorCode.CONFIG_INVALID,
          `Lead agent ${config.lead.agentId} cannot be in members list`
        );
      }
    }

    // 验证 heartbeat 配置
    if (config.heartbeat) {
      if (config.heartbeat.timeoutMs >= config.heartbeat.intervalMs) {
        throw new TeamError(
          TeamErrorCode.CONFIG_INVALID,
          'Heartbeat timeoutMs must be less than intervalMs'
        );
      }
    }
  }

  /**
   * 转换 YAML 配置为内部格式
   */
  private transform(config: YamlTeamConfig, applyDefaults: boolean): TeamConfig {
    const teamConfig: TeamConfig = {
      teamId: config.teamId,
      name: config.name,
      task: config.task,
      description: config.description,
      coordinationMode: (config.coordinationMode as CoordinationMode) || CoordinationMode.HUB_AND_SPOKE,
      members: config.members.map(m => this.transformAgent(m)),
      sharedWorkspace: config.sharedWorkspace || `~/.openclaw/workspace/teams/${config.teamId}`,
    };

    // 可选字段
    if (config.lead) {
      teamConfig.lead = this.transformAgent(config.lead);
    }

    if (config.planApproval) {
      teamConfig.planApproval = {
        enabled: config.planApproval.enabled,
        stages: config.planApproval.stages as ('goal' | 'plan' | 'result')[] || ['goal', 'plan', 'result'],
        timeout: config.planApproval.timeout || 3600,
      };
    }

    if (config.recovery) {
      teamConfig.recovery = {
        enabled: config.recovery.enabled,
        maxRetries: config.recovery.maxRetries || 3,
        backoffMultiplier: config.recovery.backoffMultiplier || 2,
      };
    }

    if (config.heartbeat) {
      teamConfig.heartbeat = {
        intervalMs: config.heartbeat.intervalMs,
        timeoutMs: config.heartbeat.timeoutMs,
        maxRetries: config.heartbeat.maxRetries || 3,
        backoffMultiplier: config.heartbeat.backoffMultiplier || 2,
      };
    } else if (applyDefaults) {
      teamConfig.heartbeat = {
        intervalMs: 30000,
        timeoutMs: 60000,
        maxRetries: 3,
        backoffMultiplier: 2,
      };
    }

    if (config.hooks) {
      teamConfig.hooks = config.hooks;
    }

    if (config.metadata) {
      teamConfig.metadata = config.metadata;
    }

    return teamConfig;
  }

  /**
   * 转换 Agent 配置
   */
  private transformAgent(agent: YamlAgentConfig): AgentConfig {
    return {
      agentId: agent.agentId,
      role: agent.role as AgentRole,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      requiresApproval: agent.requiresApproval ?? false,
      skills: agent.skills,
      maxRetries: agent.maxRetries,
      timeout: agent.timeout,
    };
  }

  /**
   * 生成默认配置模板
   */
  generateTemplate(): string {
    return `# OpenClaw Team Configuration Template
# 团队配置模板

# 团队基本信息
teamId: my-team
name: My Development Team
task: Implement a new feature for the product
description: A team of agents working on feature development

# 协调模式: hub-and-spoke | mesh
coordinationMode: hub-and-spoke

# 团队领导 (可选)
lead:
  agentId: lead-agent
  role: lead
  model: gpt-4
  systemPrompt: You are the team lead responsible for coordinating the team.
  requiresApproval: true

# 团队成员 (必需)
members:
  - agentId: planner
    role: planning
    model: gpt-4
    systemPrompt: You are a planning specialist.
    
  - agentId: coder
    role: coding
    model: gpt-4
    systemPrompt: You are a coding specialist.
    
  - agentId: reviewer
    role: review
    model: gpt-4
    systemPrompt: You are a code reviewer.

# 共享工作区路径 (可选)
sharedWorkspace: ~/.openclaw/workspace/teams/my-team

# 计划审批配置 (可选)
planApproval:
  enabled: true
  stages:
    - goal
    - plan
    - result
  timeout: 3600

# 恢复配置 (可选)
recovery:
  enabled: true
  maxRetries: 3
  backoffMultiplier: 2

# 心跳配置 (可选)
heartbeat:
  intervalMs: 30000
  timeoutMs: 60000
  maxRetries: 3
  backoffMultiplier: 2

# 钩子配置 (可选)
hooks:
  agent:idle:
    - notify_lead
  agent:completed:
    - notify_team
  agent:stuck:
    - escalate
  team:sync:
    - update_summary

# 元数据 (可选)
metadata:
  priority: high
  project: example-project
`;
  }

  /**
   * 验证并返回错误列表（不抛出异常）
   */
  validateWithErrors(config: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    try {
      const yamlConfig = yaml.load(config) as YamlTeamConfig;
      
      if (!yamlConfig) {
        return { valid: false, errors: ['Configuration is empty'] };
      }

      const result = YamlTeamConfigSchema.safeParse(yamlConfig);
      
      if (!result.success) {
        errors.push(...result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
      }

      // 检查 Agent ID 唯一性
      const agentIds = new Set<string>();
      
      if (yamlConfig.lead) {
        agentIds.add(yamlConfig.lead.agentId);
      }
      
      for (const member of yamlConfig.members || []) {
        if (agentIds.has(member.agentId)) {
          errors.push(`Duplicate agent ID: ${member.agentId}`);
        }
        agentIds.add(member.agentId);
      }

      return { valid: errors.length === 0, errors };
    } catch (error) {
      errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
      return { valid: false, errors };
    }
  }
}

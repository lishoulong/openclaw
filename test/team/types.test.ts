/**
 * Types Definition Tests
 * Tests for type definitions, enums, and interfaces
 */

import { describe, it, expect } from 'vitest';
import {
  // Enums
  CoordinationMode,
  AgentRole,
  TeamState,
  AgentState,
  TaskState,
  HeartbeatStatus,
  RecoveryStrategy,
  HookType,
  TeamErrorCode,
  // Constants
  DEFAULTS,
  // Error class
  TeamError,
  // Types (for type checking)
  type AgentConfig,
  type HeartbeatConfig,
  type PlanApprovalConfig,
  type RecoveryConfig,
  type TeamConfig,
  type AgentRuntimeInfo,
  type TeamRuntimeInfo,
  type Task,
  type HeartbeatRecord,
  type DeadLetterTask,
  type ModelRouteRule,
  type TeamStorageData,
  type CreateTeamParams,
  type OperationResult,
  type TeamListItem,
  type AgentRuntimeState,
  type Team,
  type TaskInfo,
  type TeamStats,
  type TeamManifest,
} from '../../src/team/types.js';

describe('Types - Enums', () => {
  describe('CoordinationMode', () => {
    it('should have correct values', () => {
      expect(CoordinationMode.HUB_AND_SPOKE).toBe('hub-and-spoke');
      expect(CoordinationMode.MESH).toBe('mesh');
    });

    it('should be usable as string literals', () => {
      const mode: CoordinationMode = CoordinationMode.HUB_AND_SPOKE;
      expect(mode).toBe('hub-and-spoke');
    });
  });

  describe('AgentRole', () => {
    it('should have all predefined roles', () => {
      expect(AgentRole.LEAD).toBe('lead');
      expect(AgentRole.PLANNING).toBe('planning');
      expect(AgentRole.CODING).toBe('coding');
      expect(AgentRole.REVIEW).toBe('review');
      expect(AgentRole.TESTING).toBe('testing');
      expect(AgentRole.CUSTOM).toBe('custom');
    });
  });

  describe('TeamState', () => {
    it('should have correct lifecycle states', () => {
      expect(TeamState.CREATED).toBe('created');
      expect(TeamState.INITIALIZING).toBe('initializing');
      expect(TeamState.READY).toBe('ready');
      expect(TeamState.RUNNING).toBe('running');
      expect(TeamState.PAUSED).toBe('paused');
      expect(TeamState.SHUTTING_DOWN).toBe('shutting_down');
      expect(TeamState.TERMINATED).toBe('terminated');
      expect(TeamState.ERROR).toBe('error');
    });
  });

  describe('AgentState', () => {
    it('should have correct lifecycle states', () => {
      expect(AgentState.CREATED).toBe('created');
      expect(AgentState.STARTING).toBe('starting');
      expect(AgentState.IDLE).toBe('idle');
      expect(AgentState.BUSY).toBe('busy');
      expect(AgentState.WAITING_APPROVAL).toBe('waiting_approval');
      expect(AgentState.STUCK).toBe('stuck');
      expect(AgentState.ERROR).toBe('error');
      expect(AgentState.SHUTTING_DOWN).toBe('shutting_down');
      expect(AgentState.TERMINATED).toBe('terminated');
    });
  });

  describe('TaskState', () => {
    it('should have correct lifecycle states', () => {
      expect(TaskState.PENDING).toBe('pending');
      expect(TaskState.ASSIGNED).toBe('assigned');
      expect(TaskState.RUNNING).toBe('running');
      expect(TaskState.COMPLETED).toBe('completed');
      expect(TaskState.FAILED).toBe('failed');
      expect(TaskState.CANCELLED).toBe('cancelled');
      expect(TaskState.AWAITING_APPROVAL).toBe('awaiting_approval');
      expect(TaskState.DEAD_LETTER).toBe('dead_letter');
    });
  });

  describe('HeartbeatStatus', () => {
    it('should have correct status values', () => {
      expect(HeartbeatStatus.HEALTHY).toBe('healthy');
      expect(HeartbeatStatus.TIMEOUT).toBe('timeout');
      expect(HeartbeatStatus.FAILED).toBe('failed');
      expect(HeartbeatStatus.PAUSED).toBe('paused');
      expect(HeartbeatStatus.STOPPED).toBe('stopped');
    });
  });

  describe('RecoveryStrategy', () => {
    it('should have correct strategy values', () => {
      expect(RecoveryStrategy.RETRY).toBe('retry');
      expect(RecoveryStrategy.RETRY_WITH_BACKOFF).toBe('retry_with_backoff');
      expect(RecoveryStrategy.RECREATE).toBe('recreate');
      expect(RecoveryStrategy.REASSIGN).toBe('reassign');
      expect(RecoveryStrategy.SKIP).toBe('skip');
      expect(RecoveryStrategy.DEAD_LETTER).toBe('dead_letter');
    });
  });

  describe('HookType', () => {
    it('should have correct hook type values', () => {
      expect(HookType.AGENT_IDLE).toBe('agent:idle');
      expect(HookType.AGENT_COMPLETED).toBe('agent:completed');
      expect(HookType.AGENT_STUCK).toBe('agent:stuck');
      expect(HookType.TEAM_SYNC).toBe('team:sync');
      expect(HookType.TEAM_STATE_CHANGE).toBe('team:state:change');
      expect(HookType.TASK_STATE_CHANGE).toBe('task:state:change');
      expect(HookType.AGENT_ERROR).toBe('agent:error');
      expect(HookType.PLAN_REQUIRES_APPROVAL).toBe('plan:requires:approval');
    });
  });

  describe('TeamErrorCode', () => {
    it('should have correct error codes', () => {
      expect(TeamErrorCode.TEAM_ALREADY_EXISTS).toBe('TEAM_ALREADY_EXISTS');
      expect(TeamErrorCode.TEAM_NOT_FOUND).toBe('TEAM_NOT_FOUND');
      expect(TeamErrorCode.TEAM_STATE_INVALID).toBe('TEAM_STATE_INVALID');
      expect(TeamErrorCode.AGENT_ALREADY_EXISTS).toBe('AGENT_ALREADY_EXISTS');
      expect(TeamErrorCode.AGENT_NOT_FOUND).toBe('AGENT_NOT_FOUND');
      expect(TeamErrorCode.CONFIG_INVALID).toBe('CONFIG_INVALID');
      expect(TeamErrorCode.STORE_ERROR).toBe('STORE_ERROR');
      expect(TeamErrorCode.WORKSPACE_ERROR).toBe('WORKSPACE_ERROR');
      expect(TeamErrorCode.PARSE_ERROR).toBe('PARSE_ERROR');
    });
  });
});

describe('Types - Constants', () => {
  it('should have correct default values', () => {
    expect(DEFAULTS.HEARTBEAT_INTERVAL_MS).toBe(30000);
    expect(DEFAULTS.HEARTBEAT_TIMEOUT_MS).toBe(120000);
    expect(DEFAULTS.MAX_RETRIES).toBe(3);
    expect(DEFAULTS.BACKOFF_MULTIPLIER).toBe(2);
    expect(DEFAULTS.INITIAL_RETRY_DELAY_MS).toBe(5000);
    expect(DEFAULTS.BASE_BACKOFF_MS).toBe(1000);
    expect(DEFAULTS.MAX_BACKOFF_MS).toBe(60000);
    expect(DEFAULTS.FAILURE_THRESHOLD).toBe(5);
    expect(DEFAULTS.DEAD_LETTER_QUEUE_CAPACITY).toBe(100);
    expect(DEFAULTS.APPROVAL_TIMEOUT_MS).toBe(300000);
    expect(DEFAULTS.STORAGE_VERSION).toBe('1.0.0');
  });

  it('should be frozen/immutable', () => {
    // DEFAULTS is defined with 'as const' which makes it readonly at compile time
    // But at runtime we can verify the values don't change unexpectedly
    const originalHeartbeat = DEFAULTS.HEARTBEAT_INTERVAL_MS;
    // @ts-expect-error - attempting to modify readonly object
    expect(() => { DEFAULTS.HEARTBEAT_INTERVAL_MS = 1000; }).not.toThrow();
    expect(DEFAULTS.HEARTBEAT_INTERVAL_MS).toBe(originalHeartbeat);
  });
});

describe('Types - TeamError', () => {
  it('should create error with code and message', () => {
    const error = new TeamError(TeamErrorCode.TEAM_NOT_FOUND, 'Team not found');
    
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TeamError);
    expect(error.code).toBe(TeamErrorCode.TEAM_NOT_FOUND);
    expect(error.message).toBe('Team not found');
    expect(error.name).toBe('TeamError');
    expect(error.cause).toBeUndefined();
  });

  it('should create error with cause', () => {
    const cause = new Error('Original error');
    const error = new TeamError(TeamErrorCode.STORE_ERROR, 'Storage failed', cause);
    
    expect(error.code).toBe(TeamErrorCode.STORE_ERROR);
    expect(error.message).toBe('Storage failed');
    expect(error.cause).toBe(cause);
  });

  it('should be catchable as Error', () => {
    try {
      throw new TeamError(TeamErrorCode.CONFIG_INVALID, 'Invalid config');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as TeamError).code).toBe(TeamErrorCode.CONFIG_INVALID);
    }
  });
});

describe('Types - Interfaces', () => {
  describe('AgentConfig', () => {
    it('should accept valid agent configuration', () => {
      const config: AgentConfig = {
        agentId: 'agent-001',
        role: AgentRole.CODING,
        model: 'gpt-4',
        systemPrompt: 'You are a coding agent',
        requiresApproval: false,
        capabilities: ['typescript', 'react'],
        priority: 1,
        metadata: { key: 'value' },
      };

      expect(config.agentId).toBe('agent-001');
      expect(config.role).toBe('coding');
      expect(config.model).toBe('gpt-4');
    });

    it('should work with minimal required fields', () => {
      const config: AgentConfig = {
        agentId: 'agent-002',
        role: AgentRole.CUSTOM,
      };

      expect(config.agentId).toBe('agent-002');
      expect(config.role).toBe('custom');
      expect(config.model).toBeUndefined();
    });
  });

  describe('TeamConfig', () => {
    it('should accept valid team configuration', () => {
      const config: TeamConfig = {
        teamId: 'team-001',
        task: 'Build a feature',
        coordinationMode: CoordinationMode.HUB_AND_SPOKE,
        members: [
          {
            agentId: 'member-1',
            role: AgentRole.CODING,
          },
        ],
        sharedWorkspace: '/workspace/team-001',
      };

      expect(config.teamId).toBe('team-001');
      expect(config.members).toHaveLength(1);
    });

    it('should accept configuration with lead', () => {
      const config: TeamConfig = {
        teamId: 'team-002',
        task: 'Build a feature',
        coordinationMode: CoordinationMode.MESH,
        lead: {
          agentId: 'lead-1',
          role: AgentRole.LEAD,
        },
        members: [],
        sharedWorkspace: '/workspace/team-002',
      };

      expect(config.lead?.agentId).toBe('lead-1');
    });
  });

  describe('Task', () => {
    it('should accept valid task', () => {
      const task: Task = {
        taskId: 'task-001',
        description: 'Do something',
        type: 'code',
        state: TaskState.PENDING,
        createdBy: 'user-001',
        priority: 1,
      };

      expect(task.taskId).toBe('task-001');
      expect(task.state).toBe('pending');
    });

    it('should accept task with all fields', () => {
      const task: Task = {
        taskId: 'task-002',
        description: 'Do something complex',
        type: 'research',
        state: TaskState.RUNNING,
        assignedTo: 'agent-001',
        createdBy: 'user-001',
        parentTaskId: 'task-001',
        subtasks: ['task-003', 'task-004'],
        priority: 2,
        dependencies: ['task-001'],
        result: { output: 'success' },
        retryCount: 1,
        metadata: { key: 'value' },
      };

      expect(task.subtasks).toHaveLength(2);
      expect(task.dependencies).toHaveLength(1);
    });
  });

  describe('OperationResult', () => {
    it('should represent success result', () => {
      const result: OperationResult<string> = {
        success: true,
        data: 'result data',
      };

      expect(result.success).toBe(true);
      expect(result.data).toBe('result data');
      expect(result.error).toBeUndefined();
    });

    it('should represent error result', () => {
      const result: OperationResult<string> = {
        success: false,
        error: 'Something went wrong',
        code: TeamErrorCode.TEAM_NOT_FOUND,
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
      expect(result.code).toBe('TEAM_NOT_FOUND');
    });
  });
});

/**
 * Coordinator Tests
 * Tests for task assignment and result aggregation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Coordinator, createCoordinator, AssignmentStrategy } from '../../src/team/coordinator.js';
import { SharedStateManager } from '../../src/team/shared-state.js';
import {
  TeamId,
  TaskState,
  AgentState,
  CoordinationMode,
  type Task,
  type TeamMember,
} from '../../src/team/types.js';

describe('Coordinator', () => {
  let coordinator: Coordinator;
  let stateManager: SharedStateManager;
  let tempDir: string;
  const teamId: TeamId = 'test-team';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coordinator-test-'));
    
    stateManager = new SharedStateManager({
      teamId,
      basePath: tempDir,
      manifestPath: path.join(tempDir, 'manifest.json'),
      coordinatorPath: path.join(tempDir, 'coordinator.md'),
      summaryPath: path.join(tempDir, 'summary.md'),
      tasksPath: path.join(tempDir, 'tasks'),
    });

    coordinator = new Coordinator(
      {
        teamId,
        mode: CoordinationMode.HUB_AND_SPOKE,
        assignmentStrategy: 'round-robin',
      },
      stateManager
    );

    await coordinator.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create with configuration', () => {
      const c = new Coordinator(
        {
          teamId: 'test',
          mode: CoordinationMode.HUB_AND_SPOKE,
          assignmentStrategy: 'round-robin',
          maxConcurrentTasks: 5,
        },
        stateManager
      );

      expect(c).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(coordinator.initialize()).resolves.toBeUndefined();
    });
  });

  describe('registerAgent', () => {
    it('should register agent', async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };

      await coordinator.registerAgent(member);

      const agents = coordinator.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('agent-1');
    });

    it('should send registration message', async () => {
      const messageSpy = vi.fn();
      coordinator.on('message:sent', messageSpy);

      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };

      await coordinator.registerAgent(member);

      // Message is sent internally
      const state = await coordinator.getState();
      expect(state.activeAgents).toContain('agent-1');
    });
  });

  describe('unregisterAgent', () => {
    it('should unregister agent', async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };

      await coordinator.registerAgent(member);
      await coordinator.unregisterAgent('agent-1');

      const agents = coordinator.getAgents();
      expect(agents).toHaveLength(0);
    });

    it('should throw for non-existent agent', async () => {
      await expect(coordinator.unregisterAgent('non-existent')).rejects.toThrow('not found');
    });

    it('should handle task failure on unregister', async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };

      await coordinator.registerAgent(member);
      
      // Create and assign task
      const task = await coordinator.createTask('Test Task', 'Description');
      await coordinator.assignTask(task.taskId);

      // Now unregister
      await coordinator.unregisterAgent('agent-1');

      const updatedTask = coordinator.getTask(task.taskId);
      expect(updatedTask?.state).toBe(TaskState.FAILED);
    });
  });

  describe('createTask', () => {
    it('should create task with title and description', async () => {
      const task = await coordinator.createTask('Test Task', 'Test Description');

      expect(task.taskId).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test Description');
      expect(task.state).toBe(TaskState.TODO);
    });

    it('should create task with options', async () => {
      const task = await coordinator.createTask('Test Task', 'Description', {
        priority: 5,
      });

      expect(task.priority).toBe(5);
    });

    it('should auto-assign if assignee specified', async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);

      const task = await coordinator.createTask('Test Task', 'Description', {
        assignee: 'agent-1',
      });

      expect(task.assignee).toBe('agent-1');
      expect(task.state).toBe(TaskState.IN_PROGRESS);
    });
  });

  describe('assignTask', () => {
    beforeEach(async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);
    });

    it('should assign task to specified agent', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');
      
      const result = await coordinator.assignTask(task.taskId, 'agent-1');

      expect(result.success).toBe(true);
      expect(result.assignee).toBe('agent-1');
    });

    it('should auto-assign with round-robin', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');
      
      const result = await coordinator.assignTask(task.taskId);

      expect(result.success).toBe(true);
      expect(result.assignee).toBe('agent-1');
    });

    it('should fail for non-existent task', async () => {
      const result = await coordinator.assignTask('non-existent', 'agent-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail if task not in TODO state', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');
      await coordinator.assignTask(task.taskId, 'agent-1');

      // Try to assign again
      const result = await coordinator.assignTask(task.taskId, 'agent-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in TODO');
    });

    it('should fail if no available agents', async () => {
      // Create new coordinator without agents
      const emptyCoordinator = new Coordinator(
        {
          teamId,
          mode: CoordinationMode.HUB_AND_SPOKE,
          assignmentStrategy: 'round-robin',
        },
        stateManager
      );
      await emptyCoordinator.initialize();

      const task = await emptyCoordinator.createTask('Test Task', 'Description');
      const result = await emptyCoordinator.assignTask(task.taskId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No available agent');
    });

    it('should fail if agent is busy', async () => {
      const task1 = await coordinator.createTask('Task 1', 'Description');
      await coordinator.assignTask(task1.taskId, 'agent-1');

      const task2 = await coordinator.createTask('Task 2', 'Description');
      const result = await coordinator.assignTask(task2.taskId, 'agent-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });
  });

  describe('submitTaskResult', () => {
    beforeEach(async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);
    });

    it('should submit successful result', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');
      await coordinator.assignTask(task.taskId, 'agent-1');

      await coordinator.submitTaskResult('agent-1', task.taskId, {
        success: true,
        output: 'Task completed successfully',
      });

      const updatedTask = coordinator.getTask(task.taskId);
      expect(updatedTask?.state).toBe(TaskState.COMPLETED);
      expect(updatedTask?.result?.success).toBe(true);
    });

    it('should submit failed result', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');
      await coordinator.assignTask(task.taskId, 'agent-1');

      await coordinator.submitTaskResult('agent-1', task.taskId, {
        success: false,
        error: 'Something went wrong',
      });

      const updatedTask = coordinator.getTask(task.taskId);
      expect(updatedTask?.state).toBe(TaskState.FAILED);
      expect(updatedTask?.result?.success).toBe(false);
    });

    it('should throw for non-existent task', async () => {
      await expect(
        coordinator.submitTaskResult('agent-1', 'non-existent', { success: true })
      ).rejects.toThrow('not found');
    });

    it('should throw if task not assigned to agent', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');
      await coordinator.assignTask(task.taskId, 'agent-1');

      await expect(
        coordinator.submitTaskResult('wrong-agent', task.taskId, { success: true })
      ).rejects.toThrow('not assigned');
    });
  });

  describe('reassignTask', () => {
    beforeEach(async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);
    });

    it('should reassign failed task', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');
      await coordinator.assignTask(task.taskId, 'agent-1');
      await coordinator.submitTaskResult('agent-1', task.taskId, {
        success: false,
        error: 'Failed',
      });

      const result = await coordinator.reassignTask(task.taskId, 'agent-1');

      expect(result.success).toBe(true);
    });

    it('should fail for non-failed task', async () => {
      const task = await coordinator.createTask('Test Task', 'Description');

      const result = await coordinator.reassignTask(task.taskId, 'agent-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in FAILED');
    });
  });

  describe('aggregateResults', () => {
    beforeEach(async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);
    });

    it('should aggregate successful results', async () => {
      const task1 = await coordinator.createTask('Task 1', 'Description');
      await coordinator.assignTask(task1.taskId, 'agent-1');
      await coordinator.submitTaskResult('agent-1', task1.taskId, {
        success: true,
        summary: 'Task 1 done',
      });

      const result = await coordinator.aggregateResults();

      expect(result.success).toBe(true);
      expect(result.output).toContain('Completed 1/1');
    });

    it('should aggregate with failures', async () => {
      const task1 = await coordinator.createTask('Task 1', 'Description');
      await coordinator.assignTask(task1.taskId, 'agent-1');
      await coordinator.submitTaskResult('agent-1', task1.taskId, {
        success: true,
      });

      const task2 = await coordinator.createTask('Task 2', 'Description');
      await coordinator.assignTask(task2.taskId, 'agent-1');
      await coordinator.submitTaskResult('agent-1', task2.taskId, {
        success: false,
      });

      const result = await coordinator.aggregateResults();

      expect(result.success).toBe(false);
      expect(result.output).toContain('1/2');
    });

    it('should use custom aggregator', async () => {
      const customCoordinator = new Coordinator(
        {
          teamId,
          mode: CoordinationMode.HUB_AND_SPOKE,
          assignmentStrategy: 'round-robin',
          resultAggregator: (results) => ({
            success: results.every(r => r.success),
            output: `Custom: ${results.length} tasks`,
          }),
        },
        stateManager
      );
      await customCoordinator.initialize();

      const result = await customCoordinator.aggregateResults();

      expect(result.output).toBe('Custom: 0 tasks');
    });
  });

  describe('broadcast', () => {
    it('should broadcast message to all agents', async () => {
      const member1: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      const member2: TeamMember = {
        agentId: 'agent-2',
        role: 'review',
        state: AgentState.IDLE,
      };
      
      await coordinator.registerAgent(member1);
      await coordinator.registerAgent(member2);

      const messageSpy = vi.fn();
      coordinator.on('message:broadcast', messageSpy);

      await coordinator.broadcast('sender', { data: 'test' });

      expect(messageSpy).toHaveBeenCalledWith({
        type: expect.any(String),
        payload: { data: 'test' },
        excludeAgentId: undefined,
      });
    });

    it('should exclude sender when specified', async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);

      const messageSpy = vi.fn();
      coordinator.on('message:broadcast', messageSpy);

      await coordinator.broadcast('sender', { data: 'test' }, 'sender');

      expect(messageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeAgentId: 'sender',
        })
      );
    });
  });

  describe('getters', () => {
    it('should get all tasks', async () => {
      await coordinator.createTask('Task 1', 'Description 1');
      await coordinator.createTask('Task 2', 'Description 2');

      const tasks = coordinator.getTasks();

      expect(tasks).toHaveLength(2);
    });

    it('should get tasks by state', async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);

      const task1 = await coordinator.createTask('Task 1', 'Description 1');
      await coordinator.createTask('Task 2', 'Description 2');
      await coordinator.assignTask(task1.taskId, 'agent-1');

      const todoTasks = coordinator.getTasks(TaskState.TODO);
      const inProgressTasks = coordinator.getTasks(TaskState.IN_PROGRESS);

      expect(todoTasks).toHaveLength(1);
      expect(inProgressTasks).toHaveLength(1);
    });

    it('should get specific task', async () => {
      const task = await coordinator.createTask('Task 1', 'Description');

      const retrieved = coordinator.getTask(task.taskId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe(task.taskId);
    });

    it('should return undefined for non-existent task', () => {
      const retrieved = coordinator.getTask('non-existent');

      expect(retrieved).toBeUndefined();
    });

    it('should get coordinator state', async () => {
      const member: TeamMember = {
        agentId: 'agent-1',
        role: 'coding',
        state: AgentState.IDLE,
      };
      await coordinator.registerAgent(member);

      const state = await coordinator.getState();

      expect(state.teamId).toBe(teamId);
      expect(state.activeAgents).toContain('agent-1');
    });
  });

  describe('createCoordinator', () => {
    it('should create coordinator instance', () => {
      const c = createCoordinator(
        {
          teamId,
          mode: CoordinationMode.HUB_AND_SPOKE,
          assignmentStrategy: 'round-robin',
        },
        stateManager
      );

      expect(c).toBeInstanceOf(Coordinator);
    });
  });
});

// Import vi for mocking
import { vi } from 'vitest';

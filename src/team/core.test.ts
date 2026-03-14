/**
 * OpenClaw 多 Agent 调度方案 - 核心模块测试
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import {
  WorkspaceInitializer,
  initializeWorkspace,
  workspaceExists,
  destroyWorkspace,
} from './workspace-init';
import {
  Coordinator,
  createCoordinator,
} from './coordinator';
import {
  SharedStateManager,
  createSharedStateManager,
} from './shared-state';
import {
  TeamConfig,
  TeamState,
  AgentRole,
  TaskState,
} from './types';

const TEST_BASE_PATH = path.join(__dirname, '../../test-workspace');

describe('Team Module Core', () => {
  const testTeamId = 'test-team-001';
  let workspaceInit: WorkspaceInitializer;

  beforeAll(() => {
    workspaceInit = new WorkspaceInitializer(TEST_BASE_PATH);
  });

  afterEach(async () => {
    // 清理测试工作区
    try {
      await destroyWorkspace(testTeamId, TEST_BASE_PATH);
    } catch {
      // 忽略清理错误
    }
  });

  describe('WorkspaceInitializer', () => {
    const testConfig: TeamConfig = {
      teamId: testTeamId,
      task: 'Test development task',
      coordinationMode: 'hub-and-spoke',
      members: [
        { agentId: 'agent-1', role: 'coding' as AgentRole },
        { agentId: 'agent-2', role: 'review' as AgentRole },
      ],
      sharedWorkspace: path.join(TEST_BASE_PATH, 'teams', testTeamId),
    };

    it('should initialize workspace with correct structure', async () => {
      const workspace = await initializeWorkspace(testConfig, TEST_BASE_PATH);

      // 验证目录结构
      const teamPath = workspace.basePath;
      const dirs = [
        path.join(teamPath, 'mailbox/inbox'),
        path.join(teamPath, 'mailbox/outbox'),
        path.join(teamPath, 'tasks/todo'),
        path.join(teamPath, 'tasks/in-progress'),
        path.join(teamPath, 'tasks/completed'),
        path.join(teamPath, 'agents/lead'),
        path.join(teamPath, 'agents'),
      ];

      for (const dir of dirs) {
        const stats = await fs.stat(dir);
        expect(stats.isDirectory()).toBe(true);
      }
    });

    it('should create manifest.json with correct content', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const manifestPath = path.join(
        workspaceInit.getTeamPath(testTeamId),
        'manifest.json'
      );
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.teamId).toBe(testTeamId);
      expect(manifest.state).toBe(TeamState.INITIALIZING);
      expect(manifest.members).toHaveLength(2);
    });

    it('should create coordinator.md', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const coordinatorPath = path.join(
        workspaceInit.getTeamPath(testTeamId),
        'coordinator.md'
      );
      const content = await fs.readFile(coordinatorPath, 'utf-8');

      expect(content).toContain(`Team Coordinator - ${testTeamId}`);
      expect(content).toContain('agent-1');
      expect(content).toContain('agent-2');
    });

    it('should create summary.md', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const summaryPath = path.join(
        workspaceInit.getTeamPath(testTeamId),
        'summary.md'
      );
      const content = await fs.readFile(summaryPath, 'utf-8');

      expect(content).toContain(`Team Summary - ${testTeamId}`);
      expect(content).toContain('总体进度');
    });

    it('should check workspace existence correctly', async () => {
      expect(await workspaceExists(testTeamId, TEST_BASE_PATH)).toBe(false);
      
      await initializeWorkspace(testConfig, TEST_BASE_PATH);
      
      expect(await workspaceExists(testTeamId, TEST_BASE_PATH)).toBe(true);
    });

    it('should destroy workspace correctly', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);
      expect(await workspaceExists(testTeamId, TEST_BASE_PATH)).toBe(true);

      await destroyWorkspace(testTeamId, TEST_BASE_PATH);
      expect(await workspaceExists(testTeamId, TEST_BASE_PATH)).toBe(false);
    });
  });

  describe('SharedStateManager', () => {
    const testConfig: TeamConfig = {
      teamId: testTeamId,
      task: 'Test task',
      coordinationMode: 'hub-and-spoke',
      members: [{ agentId: 'agent-1', role: 'coding' as AgentRole }],
      sharedWorkspace: path.join(TEST_BASE_PATH, 'teams', testTeamId),
    };

    it('should read and write coordinator state', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const workspacePath = workspaceInit.getTeamPath(testTeamId);
      const stateManager = SharedStateManager.fromWorkspace(
        testTeamId,
        workspacePath,
        {
          manifestPath: 'manifest.json',
          coordinatorPath: 'coordinator.md',
          summaryPath: 'summary.md',
          tasks: {
            todo: 'tasks/todo',
            inProgress: 'tasks/in-progress',
            completed: 'tasks/completed',
          },
        }
      );

      // 读取初始状态
      const initialState = await stateManager.readCoordinatorState();
      expect(initialState).not.toBeNull();
      expect(initialState?.teamId).toBe(testTeamId);
      expect(initialState?.activeAgents).toEqual([]);

      // 写入新状态
      const newState = {
        teamId: testTeamId,
        lastSync: new Date().toISOString(),
        activeAgents: ['agent-1', 'agent-2'],
        pendingTasks: ['task-1'],
        completedTasks: [],
        messages: [],
      };

      await stateManager.writeCoordinatorState(newState);

      // 重新读取验证
      const updatedState = await stateManager.readCoordinatorState();
      expect(updatedState?.activeAgents).toEqual(['agent-1', 'agent-2']);
      expect(updatedState?.pendingTasks).toEqual(['task-1']);
    });

    it('should read and write summary', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const workspacePath = workspaceInit.getTeamPath(testTeamId);
      const stateManager = SharedStateManager.fromWorkspace(
        testTeamId,
        workspacePath,
        {
          manifestPath: 'manifest.json',
          coordinatorPath: 'coordinator.md',
          summaryPath: 'summary.md',
          tasks: {
            todo: 'tasks/todo',
            inProgress: 'tasks/in-progress',
            completed: 'tasks/completed',
          },
        }
      );

      const newSummary = {
        teamId: testTeamId,
        generatedAt: new Date().toISOString(),
        overallProgress: 50,
        completedTasks: 2,
        totalTasks: 4,
        keyResults: ['Feature A completed', 'Feature B in progress'],
        blockers: ['Waiting for API documentation'],
        nextSteps: ['Implement Feature C', 'Write tests'],
      };

      await stateManager.writeSummary(newSummary);

      const readSummary = await stateManager.readSummary();
      expect(readSummary?.overallProgress).toBe(50);
      expect(readSummary?.completedTasks).toBe(2);
      expect(readSummary?.keyResults).toContain('Feature A completed');
    });

    it('should create and list tasks', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const workspacePath = workspaceInit.getTeamPath(testTeamId);
      const stateManager = SharedStateManager.fromWorkspace(
        testTeamId,
        workspacePath,
        {
          manifestPath: 'manifest.json',
          coordinatorPath: 'coordinator.md',
          summaryPath: 'summary.md',
          tasks: {
            todo: 'tasks/todo',
            inProgress: 'tasks/in-progress',
            completed: 'tasks/completed',
          },
        }
      );

      const task = {
        taskId: 'task-001',
        title: 'Test Task',
        description: 'This is a test task',
        state: TaskState.TODO,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await stateManager.createTask(task);

      const tasks = await stateManager.listTasks(TaskState.TODO);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].taskId).toBe('task-001');
    });
  });

  describe('Coordinator', () => {
    const testConfig: TeamConfig = {
      teamId: testTeamId,
      task: 'Test coordination',
      coordinationMode: 'hub-and-spoke',
      members: [
        { agentId: 'agent-1', role: 'coding' as AgentRole },
        { agentId: 'agent-2', role: 'review' as AgentRole },
      ],
      sharedWorkspace: path.join(TEST_BASE_PATH, 'teams', testTeamId),
    };

    it('should register and unregister agents', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const workspacePath = workspaceInit.getTeamPath(testTeamId);
      const stateManager = SharedStateManager.fromWorkspace(
        testTeamId,
        workspacePath,
        {
          manifestPath: 'manifest.json',
          coordinatorPath: 'coordinator.md',
          summaryPath: 'summary.md',
          tasks: {
            todo: 'tasks/todo',
            inProgress: 'tasks/in-progress',
            completed: 'tasks/completed',
          },
        }
      );

      const coordinator = createCoordinator(
        {
          teamId: testTeamId,
          mode: 'hub-and-spoke',
          assignmentStrategy: 'round-robin',
        },
        stateManager
      );

      await coordinator.initialize();

      // 注册 Agent
      await coordinator.registerAgent({
        agentId: 'agent-1',
        role: 'coding',
        state: 'idle' as any,
      });

      const agents = coordinator.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('agent-1');

      // 注销 Agent
      await coordinator.unregisterAgent('agent-1');
      expect(coordinator.getAgents()).toHaveLength(0);
    });

    it('should create and assign tasks', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const workspacePath = workspaceInit.getTeamPath(testTeamId);
      const stateManager = SharedStateManager.fromWorkspace(
        testTeamId,
        workspacePath,
        {
          manifestPath: 'manifest.json',
          coordinatorPath: 'coordinator.md',
          summaryPath: 'summary.md',
          tasks: {
            todo: 'tasks/todo',
            inProgress: 'tasks/in-progress',
            completed: 'tasks/completed',
          },
        }
      );

      const coordinator = createCoordinator(
        {
          teamId: testTeamId,
          mode: 'hub-and-spoke',
          assignmentStrategy: 'round-robin',
        },
        stateManager
      );

      await coordinator.initialize();

      // 注册 Agent
      await coordinator.registerAgent({
        agentId: 'agent-1',
        role: 'coding',
        state: 'idle' as any,
      });

      // 创建任务
      const task = await coordinator.createTask(
        'Implement feature',
        'Implement the core feature'
      );

      expect(task.title).toBe('Implement feature');
      expect(task.state).toBe(TaskState.TODO);

      // 分配任务
      const assignment = await coordinator.assignTask(task.taskId);
      expect(assignment.success).toBe(true);
      expect(assignment.assignee).toBe('agent-1');

      // 验证任务状态
      const updatedTask = coordinator.getTask(task.taskId);
      expect(updatedTask?.state).toBe(TaskState.IN_PROGRESS);
      expect(updatedTask?.assignee).toBe('agent-1');
    });

    it('should handle task results', async () => {
      await initializeWorkspace(testConfig, TEST_BASE_PATH);

      const workspacePath = workspaceInit.getTeamPath(testTeamId);
      const stateManager = SharedStateManager.fromWorkspace(
        testTeamId,
        workspacePath,
        {
          manifestPath: 'manifest.json',
          coordinatorPath: 'coordinator.md',
          summaryPath: 'summary.md',
          tasks: {
            todo: 'tasks/todo',
            inProgress: 'tasks/in-progress',
            completed: 'tasks/completed',
          },
        }
      );

      const coordinator = createCoordinator(
        {
          teamId: testTeamId,
          mode: 'hub-and-spoke',
          assignmentStrategy: 'round-robin',
        },
        stateManager
      );

      await coordinator.initialize();

      // 注册 Agent
      await coordinator.registerAgent({
        agentId: 'agent-1',
        role: 'coding',
        state: 'idle' as any,
      });

      // 创建并分配任务
      const task = await coordinator.createTask(
        'Test task',
        'Test description'
      );
      await coordinator.assignTask(task.taskId);

      // 提交结果
      await coordinator.submitTaskResult('agent-1', task.taskId, {
        success: true,
        output: 'Task completed successfully',
        summary: 'All tests passed',
      });

      // 验证任务完成
      const completedTask = coordinator.getTask(task.taskId);
      expect(completedTask?.state).toBe(TaskState.COMPLETED);
      expect(completedTask?.result?.success).toBe(true);
    });
  });
});

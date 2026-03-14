/**
 * Shared State Manager Tests
 * Tests for coordinator.md, summary.md and task list operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SharedStateManager, createSharedStateManager } from '../../src/team/shared-state.js';
import {
  TaskState,
  type Task,
  type CoordinatorState,
  type Summary,
} from '../../src/team/types.js';

describe('SharedStateManager', () => {
  let stateManager: SharedStateManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-state-test-'));
    
    stateManager = new SharedStateManager({
      teamId: 'test-team',
      basePath: tempDir,
      manifestPath: path.join(tempDir, 'manifest.json'),
      coordinatorPath: path.join(tempDir, 'coordinator.md'),
      summaryPath: path.join(tempDir, 'summary.md'),
      tasksPath: path.join(tempDir, 'tasks'),
    });

    // Create tasks directories
    await fs.mkdir(path.join(tempDir, 'tasks', 'todo'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'tasks', 'in-progress'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'tasks', 'completed'), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('fromWorkspace', () => {
    it('should create from workspace structure', () => {
      const sm = SharedStateManager.fromWorkspace('test-team', tempDir, {
        manifestPath: 'manifest.json',
        coordinatorPath: 'coordinator.md',
        summaryPath: 'summary.md',
        tasks: {
          todo: 'tasks/todo',
          inProgress: 'tasks/in-progress',
          completed: 'tasks/completed',
        },
      });

      expect(sm).toBeDefined();
    });
  });

  describe('Coordinator State', () => {
    it('should return null when no coordinator state exists', async () => {
      const state = await stateManager.readCoordinatorState();
      expect(state).toBeNull();
    });

    it('should write and read coordinator state', async () => {
      const state: CoordinatorState = {
        teamId: 'test-team',
        lastSync: new Date().toISOString(),
        activeAgents: ['agent-1', 'agent-2'],
        pendingTasks: ['task-1', 'task-2'],
        completedTasks: ['task-3'],
        messages: [
          { from: 'agent-1', type: 'status', timestamp: new Date().toISOString() },
        ],
      };

      await stateManager.writeCoordinatorState(state);
      const readState = await stateManager.readCoordinatorState();

      expect(readState).toBeDefined();
      expect(readState?.teamId).toBe('test-team');
      expect(readState?.activeAgents).toEqual(['agent-1', 'agent-2']);
      expect(readState?.pendingTasks).toEqual(['task-1', 'task-2']);
      expect(readState?.completedTasks).toEqual(['task-3']);
    });

    it('should parse coordinator markdown correctly', async () => {
      const content = `# Team Coordinator - test-team

## 团队信息

- **Team ID**: test-team
- **最后同步**: 2024-01-15T10:00:00Z

## 活跃 Agent

- agent-1
- agent-2

## 待处理任务

- task-1
- task-2

## 已完成任务

- task-3

## 消息日志

- [2024-01-15T10:00:00Z] agent-1: status

---
*此文件由协调器自动更新，请勿手动修改*
`;

      await fs.writeFile(path.join(tempDir, 'coordinator.md'), content, 'utf-8');

      const state = await stateManager.readCoordinatorState();

      expect(state?.activeAgents).toContain('agent-1');
      expect(state?.activeAgents).toContain('agent-2');
      expect(state?.pendingTasks).toContain('task-1');
      expect(state?.completedTasks).toContain('task-3');
    });

    it('should handle empty sections', async () => {
      const content = `# Team Coordinator - test-team

## 活跃 Agent

_暂无活跃 Agent_

## 待处理任务

_暂无待处理任务_
`;

      await fs.writeFile(path.join(tempDir, 'coordinator.md'), content, 'utf-8');

      const state = await stateManager.readCoordinatorState();

      expect(state?.activeAgents).toHaveLength(0);
      expect(state?.pendingTasks).toHaveLength(0);
    });
  });

  describe('Summary', () => {
    it('should return null when no summary exists', async () => {
      const summary = await stateManager.readSummary();
      expect(summary).toBeNull();
    });

    it('should write and read summary', async () => {
      const summary: Summary = {
        teamId: 'test-team',
        generatedAt: new Date().toISOString(),
        overallProgress: 50,
        completedTasks: 5,
        totalTasks: 10,
        keyResults: ['Result 1', 'Result 2'],
        blockers: ['Blocker 1'],
        nextSteps: ['Step 1'],
      };

      await stateManager.writeSummary(summary);
      const readSummary = await stateManager.readSummary();

      expect(readSummary).toBeDefined();
      expect(readSummary?.overallProgress).toBe(50);
      expect(readSummary?.completedTasks).toBe(5);
      expect(readSummary?.totalTasks).toBe(10);
      expect(readSummary?.keyResults).toEqual(['Result 1', 'Result 2']);
    });

    it('should parse summary markdown correctly', async () => {
      const content = `# Team Summary - test-team

## 总体进度

- **完成度**: 75%
- **已完成任务**: 15 / 20
- **生成时间**: 2024-01-15T10:00:00Z

## 关键结果

- Result 1
- Result 2

## 阻塞项

- ⚠️ Blocker 1

## 下一步计划

- Step 1
- Step 2

---
*此文件由协调器自动更新，请勿手动修改*
`;

      await fs.writeFile(path.join(tempDir, 'summary.md'), content, 'utf-8');

      const summary = await stateManager.readSummary();

      expect(summary?.overallProgress).toBe(75);
      expect(summary?.completedTasks).toBe(15);
      expect(summary?.totalTasks).toBe(20);
      expect(summary?.keyResults).toContain('Result 1');
      expect(summary?.blockers).toContain('Blocker 1');
      expect(summary?.nextSteps).toContain('Step 1');
    });

    it('should update summary partially', async () => {
      const initialSummary: Summary = {
        teamId: 'test-team',
        generatedAt: new Date().toISOString(),
        overallProgress: 0,
        completedTasks: 0,
        totalTasks: 0,
        keyResults: [],
        blockers: [],
        nextSteps: [],
      };

      await stateManager.writeSummary(initialSummary);

      const updated = await stateManager.updateSummary({
        overallProgress: 50,
        completedTasks: 5,
        totalTasks: 10,
        keyResults: ['New Result'],
      });

      expect(updated.overallProgress).toBe(50);
      expect(updated.completedTasks).toBe(5);
      expect(updated.keyResults).toEqual(['New Result']);
    });

    it('should preserve existing values in partial update', async () => {
      const initialSummary: Summary = {
        teamId: 'test-team',
        generatedAt: new Date().toISOString(),
        overallProgress: 25,
        completedTasks: 2,
        totalTasks: 8,
        keyResults: ['Existing Result'],
        blockers: ['Existing Blocker'],
        nextSteps: ['Existing Step'],
      };

      await stateManager.writeSummary(initialSummary);

      const updated = await stateManager.updateSummary({
        overallProgress: 50,
      });

      expect(updated.overallProgress).toBe(50);
      expect(updated.completedTasks).toBe(2);
      expect(updated.keyResults).toEqual(['Existing Result']);
      expect(updated.blockers).toEqual(['Existing Blocker']);
    });
  });

  describe('Tasks', () => {
    const createTestTask = (id: string, state: TaskState = TaskState.TODO): Task => ({
      taskId: id,
      description: `Task ${id}`,
      type: 'code',
      state,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    describe('createTask', () => {
      it('should create task file', async () => {
        const task = createTestTask('task-1');

        await stateManager.createTask(task);

        const taskPath = path.join(tempDir, 'tasks', 'todo', 'task-1.json');
        const content = await fs.readFile(taskPath, 'utf-8');
        const savedTask = JSON.parse(content);

        expect(savedTask.taskId).toBe('task-1');
        expect(savedTask.state).toBe(TaskState.TODO);
      });
    });

    describe('readTask', () => {
      it('should read existing task', async () => {
        const task = createTestTask('task-1');
        await stateManager.createTask(task);

        const readTask = await stateManager.readTask('task-1', TaskState.TODO);

        expect(readTask).toBeDefined();
        expect(readTask?.taskId).toBe('task-1');
      });

      it('should return null for non-existent task', async () => {
        const task = await stateManager.readTask('non-existent', TaskState.TODO);

        expect(task).toBeNull();
      });
    });

    describe('updateTask', () => {
      it('should update task in same state', async () => {
        const task = createTestTask('task-1');
        await stateManager.createTask(task);

        task.description = 'Updated description';
        await stateManager.updateTask(task);

        const readTask = await stateManager.readTask('task-1', TaskState.TODO);
        expect(readTask?.description).toBe('Updated description');
      });

      it('should move task to different state', async () => {
        const task = createTestTask('task-1', TaskState.TODO);
        await stateManager.createTask(task);

        task.state = TaskState.IN_PROGRESS;
        await stateManager.updateTask(task);

        const oldTask = await stateManager.readTask('task-1', TaskState.TODO);
        const newTask = await stateManager.readTask('task-1', TaskState.IN_PROGRESS);

        expect(oldTask).toBeNull();
        expect(newTask).toBeDefined();
        expect(newTask?.state).toBe(TaskState.IN_PROGRESS);
      });

      it('should update updatedAt timestamp', async () => {
        const task = createTestTask('task-1');
        await stateManager.createTask(task);

        const oldUpdatedAt = task.updatedAt;
        await new Promise(resolve => setTimeout(resolve, 10));
        
        await stateManager.updateTask(task);

        expect(task.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
      });
    });

    describe('deleteTask', () => {
      it('should delete task file', async () => {
        const task = createTestTask('task-1');
        await stateManager.createTask(task);

        await stateManager.deleteTask('task-1', TaskState.TODO);

        const taskPath = path.join(tempDir, 'tasks', 'todo', 'task-1.json');
        await expect(fs.access(taskPath)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      });

      it('should not throw for non-existent task', async () => {
        await expect(
          stateManager.deleteTask('non-existent', TaskState.TODO)
        ).resolves.toBeUndefined();
      });
    });

    describe('listTasks', () => {
      it('should list tasks by state', async () => {
        await stateManager.createTask(createTestTask('task-1', TaskState.TODO));
        await stateManager.createTask(createTestTask('task-2', TaskState.TODO));
        await stateManager.createTask(createTestTask('task-3', TaskState.IN_PROGRESS));

        const todoTasks = await stateManager.listTasks(TaskState.TODO);

        expect(todoTasks).toHaveLength(2);
        expect(todoTasks.map(t => t.taskId)).toContain('task-1');
        expect(todoTasks.map(t => t.taskId)).toContain('task-2');
      });

      it('should list all tasks when no state specified', async () => {
        await stateManager.createTask(createTestTask('task-1', TaskState.TODO));
        await stateManager.createTask(createTestTask('task-2', TaskState.IN_PROGRESS));
        await stateManager.createTask(createTestTask('task-3', TaskState.COMPLETED));

        const allTasks = await stateManager.listTasks();

        expect(allTasks).toHaveLength(3);
      });

      it('should return empty array for empty directory', async () => {
        const tasks = await stateManager.listTasks(TaskState.TODO);
        expect(tasks).toHaveLength(0);
      });
    });

    describe('moveTask', () => {
      it('should move task between states', async () => {
        const task = createTestTask('task-1', TaskState.TODO);
        await stateManager.createTask(task);

        await stateManager.moveTask('task-1', TaskState.TODO, TaskState.IN_PROGRESS);

        const oldTask = await stateManager.readTask('task-1', TaskState.TODO);
        const newTask = await stateManager.readTask('task-1', TaskState.IN_PROGRESS);

        expect(oldTask).toBeNull();
        expect(newTask).toBeDefined();
        expect(newTask?.state).toBe(TaskState.IN_PROGRESS);
      });

      it('should set completedAt when moving to completed', async () => {
        const task = createTestTask('task-1', TaskState.IN_PROGRESS);
        await stateManager.createTask(task);

        await stateManager.moveTask('task-1', TaskState.IN_PROGRESS, TaskState.COMPLETED);

        const completedTask = await stateManager.readTask('task-1', TaskState.COMPLETED);
        expect(completedTask?.completedAt).toBeDefined();
      });
    });

    describe('getTaskStats', () => {
      it('should return correct stats', async () => {
        await stateManager.createTask(createTestTask('task-1', TaskState.TODO));
        await stateManager.createTask(createTestTask('task-2', TaskState.TODO));
        await stateManager.createTask(createTestTask('task-3', TaskState.IN_PROGRESS));
        await stateManager.createTask(createTestTask('task-4', TaskState.COMPLETED));

        const stats = await stateManager.getTaskStats();

        expect(stats.todo).toBe(2);
        expect(stats.inProgress).toBe(1);
        expect(stats.completed).toBe(1);
        expect(stats.total).toBe(4);
      });
    });
  });

  describe('Batch Operations', () => {
    const createTestTask = (id: string, state: TaskState = TaskState.TODO): Task => ({
      taskId: id,
      description: `Task ${id}`,
      type: 'code',
      state,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should batch create tasks', async () => {
      const tasks = [
        createTestTask('task-1'),
        createTestTask('task-2'),
        createTestTask('task-3'),
      ];

      await stateManager.batchCreateTasks(tasks);

      const listed = await stateManager.listTasks(TaskState.TODO);
      expect(listed).toHaveLength(3);
    });

    it('should batch update tasks', async () => {
      const tasks = [
        createTestTask('task-1'),
        createTestTask('task-2'),
      ];
      await stateManager.batchCreateTasks(tasks);

      tasks[0].description = 'Updated 1';
      tasks[1].description = 'Updated 2';

      await stateManager.batchUpdateTasks(tasks);

      const task1 = await stateManager.readTask('task-1', TaskState.TODO);
      const task2 = await stateManager.readTask('task-2', TaskState.TODO);

      expect(task1?.description).toBe('Updated 1');
      expect(task2?.description).toBe('Updated 2');
    });

    it('should batch delete tasks', async () => {
      const tasks = [
        createTestTask('task-1'),
        createTestTask('task-2'),
        createTestTask('task-3'),
      ];
      await stateManager.batchCreateTasks(tasks);

      await stateManager.batchDeleteTasks([
        { taskId: 'task-1', state: TaskState.TODO },
        { taskId: 'task-2', state: TaskState.TODO },
      ]);

      const listed = await stateManager.listTasks(TaskState.TODO);
      expect(listed).toHaveLength(1);
    });
  });

  describe('createSharedStateManager', () => {
    it('should create shared state manager', () => {
      const sm = createSharedStateManager({
        teamId: 'test',
        basePath: tempDir,
        manifestPath: path.join(tempDir, 'manifest.json'),
        coordinatorPath: path.join(tempDir, 'coordinator.md'),
        summaryPath: path.join(tempDir, 'summary.md'),
        tasksPath: path.join(tempDir, 'tasks'),
      });

      expect(sm).toBeInstanceOf(SharedStateManager);
    });
  });
});

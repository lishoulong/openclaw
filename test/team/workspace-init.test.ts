/**
 * Workspace Initialization Tests
 * Tests for team workspace directory structure and file creation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  WorkspaceInitializer,
  initializeWorkspace,
  workspaceExists,
  destroyWorkspace,
  generateWorkspaceStructure,
} from '../../src/team/workspace-init.js';
import {
  TeamState,
  AgentRole,
  CoordinationMode,
  type TeamConfig,
} from '../../src/team/types.js';

describe('Workspace Initialization', () => {
  let tempDir: string;

  const createTestConfig = (teamId: string): TeamConfig => ({
    teamId,
    task: 'Test task',
    coordinationMode: CoordinationMode.HUB_AND_SPOKE,
    sharedWorkspace: path.join(tempDir, teamId),
    members: [
      {
        agentId: 'agent-1',
        role: AgentRole.CODING,
        model: 'gpt-4',
      },
    ],
    lead: {
      agentId: 'lead-1',
      role: AgentRole.LEAD,
      model: 'gpt-4o',
    },
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('generateWorkspaceStructure', () => {
    it('should generate structure with correct paths', () => {
      const structure = generateWorkspaceStructure('test-team');

      expect(structure.manifestPath).toBe('manifest.json');
      expect(structure.coordinatorPath).toBe('coordinator.md');
      expect(structure.summaryPath).toBe('summary.md');
      expect(structure.mailbox.inbox).toBe('mailbox/inbox');
      expect(structure.mailbox.outbox).toBe('mailbox/outbox');
      expect(structure.tasks.todo).toBe('tasks/todo');
      expect(structure.tasks.inProgress).toBe('tasks/in-progress');
      expect(structure.tasks.completed).toBe('tasks/completed');
      expect(structure.agents.lead).toBe('agents/lead');
      expect(structure.agents.members).toBe('agents');
    });
  });

  describe('WorkspaceInitializer', () => {
    it('should create with custom base path', () => {
      const initializer = new WorkspaceInitializer('/custom/path');
      expect(initializer.getTeamPath('test')).toBe('/custom/path/teams/test');
    });

    it('should create with default base path', () => {
      const initializer = new WorkspaceInitializer();
      const teamPath = initializer.getTeamPath('test');
      expect(teamPath).toContain('.openclaw');
      expect(teamPath).toContain('workspace');
    });
  });

  describe('initialize', () => {
    it('should create directory structure', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');

      await initializer.initialize(config);

      const teamPath = path.join(tempDir, 'teams', 'test-team');
      const mailboxPath = path.join(teamPath, 'mailbox');
      const tasksPath = path.join(teamPath, 'tasks');
      const agentsPath = path.join(teamPath, 'agents');

      await expect(fs.access(mailboxPath)).resolves.toBeUndefined();
      await expect(fs.access(tasksPath)).resolves.toBeUndefined();
      await expect(fs.access(agentsPath)).resolves.toBeUndefined();
    });

    it('should create inbox and outbox directories', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');

      await initializer.initialize(config);

      const teamPath = path.join(tempDir, 'teams', 'test-team');
      const inboxPath = path.join(teamPath, 'mailbox', 'inbox');
      const outboxPath = path.join(teamPath, 'mailbox', 'outbox');

      await expect(fs.access(inboxPath)).resolves.toBeUndefined();
      await expect(fs.access(outboxPath)).resolves.toBeUndefined();
    });

    it('should create task directories', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');

      await initializer.initialize(config);

      const teamPath = path.join(tempDir, 'teams', 'test-team');
      const todoPath = path.join(teamPath, 'tasks', 'todo');
      const inProgressPath = path.join(teamPath, 'tasks', 'in-progress');
      const completedPath = path.join(teamPath, 'tasks', 'completed');

      await expect(fs.access(todoPath)).resolves.toBeUndefined();
      await expect(fs.access(inProgressPath)).resolves.toBeUndefined();
      await expect(fs.access(completedPath)).resolves.toBeUndefined();
    });

    it('should create manifest.json', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');

      await initializer.initialize(config);

      const manifestPath = path.join(tempDir, 'teams', 'test-team', 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.teamId).toBe('test-team');
      expect(manifest.state).toBe(TeamState.INITIALIZING);
      expect(manifest.members).toHaveLength(2); // lead + member
      expect(manifest.members[0].agentId).toBe('lead-1');
    });

    it('should create coordinator.md', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');

      await initializer.initialize(config);

      const coordinatorPath = path.join(tempDir, 'teams', 'test-team', 'coordinator.md');
      const content = await fs.readFile(coordinatorPath, 'utf-8');

      expect(content).toContain('Team Coordinator - test-team');
      expect(content).toContain('Team ID: test-team');
      expect(content).toContain('Lead: lead-1');
      expect(content).toContain('Member: agent-1');
    });

    it('should create summary.md', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');

      await initializer.initialize(config);

      const summaryPath = path.join(tempDir, 'teams', 'test-team', 'summary.md');
      const content = await fs.readFile(summaryPath, 'utf-8');

      expect(content).toContain('Team Summary - test-team');
      expect(content).toContain('完成度: 0%');
      expect(content).toContain('已完成任务: 0 / 0');
    });

    it('should return workspace config', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');

      const workspaceConfig = await initializer.initialize(config);

      expect(workspaceConfig.teamId).toBe('test-team');
      expect(workspaceConfig.basePath).toBe(path.join(tempDir, 'teams', 'test-team'));
      expect(workspaceConfig.structure.manifestPath).toBe('manifest.json');
    });

    it('should handle team without lead', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      delete config.lead;

      await initializer.initialize(config);

      const manifestPath = path.join(tempDir, 'teams', 'test-team', 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.members).toHaveLength(1);
      expect(manifest.members[0].agentId).toBe('agent-1');
    });

    it('should throw on permission error', async () => {
      const initializer = new WorkspaceInitializer('/root/invalid');
      const config = createTestConfig('test-team');

      await expect(initializer.initialize(config)).rejects.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing workspace', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      await initializer.initialize(config);

      const exists = await initializer.exists('test-team');

      expect(exists).toBe(true);
    });

    it('should return false for non-existing workspace', async () => {
      const initializer = new WorkspaceInitializer(tempDir);

      const exists = await initializer.exists('non-existing');

      expect(exists).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should remove workspace directory', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      await initializer.initialize(config);

      await initializer.destroy('test-team');

      const teamPath = path.join(tempDir, 'teams', 'test-team');
      await expect(fs.access(teamPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('should throw on error', async () => {
      const initializer = new WorkspaceInitializer('/non-existent/path');

      await expect(initializer.destroy('test-team')).rejects.toThrow();
    });
  });

  describe('convenience functions', () => {
    describe('initializeWorkspace', () => {
      it('should initialize workspace', async () => {
        const config = createTestConfig('test-team');

        const workspaceConfig = await initializeWorkspace(config, tempDir);

        expect(workspaceConfig.teamId).toBe('test-team');
        const manifestPath = path.join(tempDir, 'teams', 'test-team', 'manifest.json');
        await expect(fs.access(manifestPath)).resolves.toBeUndefined();
      });
    });

    describe('workspaceExists', () => {
      it('should check existence', async () => {
        const config = createTestConfig('test-team');
        await initializeWorkspace(config, tempDir);

        const exists = await workspaceExists('test-team', tempDir);

        expect(exists).toBe(true);
      });
    });

    describe('destroyWorkspace', () => {
      it('should destroy workspace', async () => {
        const config = createTestConfig('test-team');
        await initializeWorkspace(config, tempDir);

        await destroyWorkspace('test-team', tempDir);

        const teamPath = path.join(tempDir, 'teams', 'test-team');
        await expect(fs.access(teamPath)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      });
    });
  });

  describe('coordinator.md content', () => {
    it('should include all sections', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      await initializer.initialize(config);

      const coordinatorPath = path.join(tempDir, 'teams', 'test-team', 'coordinator.md');
      const content = await fs.readFile(coordinatorPath, 'utf-8');

      expect(content).toContain('团队信息');
      expect(content).toContain('团队成员');
      expect(content).toContain('活跃 Agent');
      expect(content).toContain('待处理任务');
      expect(content).toContain('已完成任务');
      expect(content).toContain('消息日志');
    });

    it('should include coordination mode', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      await initializer.initialize(config);

      const coordinatorPath = path.join(tempDir, 'teams', 'test-team', 'coordinator.md');
      const content = await fs.readFile(coordinatorPath, 'utf-8');

      expect(content).toContain('协调模式');
      expect(content).toContain(CoordinationMode.HUB_AND_SPOKE);
    });

    it('should include task description', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      await initializer.initialize(config);

      const coordinatorPath = path.join(tempDir, 'teams', 'test-team', 'coordinator.md');
      const content = await fs.readFile(coordinatorPath, 'utf-8');

      expect(content).toContain('Test task');
    });
  });

  describe('summary.md content', () => {
    it('should include all sections', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      await initializer.initialize(config);

      const summaryPath = path.join(tempDir, 'teams', 'test-team', 'summary.md');
      const content = await fs.readFile(summaryPath, 'utf-8');

      expect(content).toContain('总体进度');
      expect(content).toContain('关键结果');
      expect(content).toContain('阻塞项');
      expect(content).toContain('下一步计划');
    });

    it('should include warning note', async () => {
      const initializer = new WorkspaceInitializer(tempDir);
      const config = createTestConfig('test-team');
      await initializer.initialize(config);

      const summaryPath = path.join(tempDir, 'teams', 'test-team', 'summary.md');
      const content = await fs.readFile(summaryPath, 'utf-8');

      expect(content).toContain('请勿手动修改');
    });
  });
});

/**
 * Team Store Tests
 * Tests for team persistence and storage operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TeamStore } from '../../src/team/team-store.js';
import {
  TeamState,
  AgentRole,
  CoordinationMode,
  TeamErrorCode,
  type Team,
  type TeamConfig,
  type TeamManifest,
} from '../../src/team/types.js';

describe('TeamStore', () => {
  let store: TeamStore;
  let tempDir: string;

  const createTestTeam = (teamId: string): Team => {
    const config: TeamConfig = {
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
    };

    return {
      teamId,
      name: 'Test Team',
      state: TeamState.PENDING,
      config,
      createdAt: new Date(),
      updatedAt: new Date(),
      agentStates: new Map([
        ['lead-1', { agentId: 'lead-1', status: 'idle', retryCount: 0 }],
        ['agent-1', { agentId: 'agent-1', status: 'idle', retryCount: 0 }],
      ]),
      stats: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalRetries: 0,
        averageTaskTime: 0,
      },
      version: 1,
    };
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-store-test-'));
    store = new TeamStore({ basePath: tempDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create with custom base path', () => {
      const customStore = new TeamStore({ basePath: '/custom/path' });
      expect(customStore).toBeDefined();
      expect(customStore.getWorkspacePath('test')).toBe('/custom/path/test');
    });

    it('should create with default base path', () => {
      const defaultStore = new TeamStore();
      expect(defaultStore).toBeDefined();
      // Default path includes .openclaw/workspace/teams
      expect(defaultStore.getWorkspacePath('test')).toContain('teams');
    });
  });

  describe('exists', () => {
    it('should return false for non-existent team', async () => {
      const exists = await store.exists('non-existent');
      expect(exists).toBe(false);
    });

    it('should return true for existing team', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      const exists = await store.exists('test-team');
      expect(exists).toBe(true);
    });
  });

  describe('createWorkspace', () => {
    it('should create directory structure', async () => {
      await store.createWorkspace('test-team');

      // Check that directories exist
      const teamPath = path.join(tempDir, 'test-team');
      const mailboxPath = path.join(teamPath, 'mailbox');
      const tasksPath = path.join(teamPath, 'tasks');
      const agentsPath = path.join(teamPath, 'agents');

      await expect(fs.access(mailboxPath)).resolves.toBeUndefined();
      await expect(fs.access(tasksPath)).resolves.toBeUndefined();
      await expect(fs.access(agentsPath)).resolves.toBeUndefined();
    });

    it('should create initial files', async () => {
      await store.createWorkspace('test-team');

      const teamPath = path.join(tempDir, 'test-team');
      const coordinatorPath = path.join(teamPath, 'coordinator.md');
      const summaryPath = path.join(teamPath, 'summary.md');

      const coordinatorContent = await fs.readFile(coordinatorPath, 'utf-8');
      const summaryContent = await fs.readFile(summaryPath, 'utf-8');

      expect(coordinatorContent).toContain('Team: test-team');
      expect(summaryContent).toContain('Team: test-team');
    });
  });

  describe('saveManifest', () => {
    it('should save team manifest', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      const manifestPath = path.join(tempDir, 'test-team', 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as TeamManifest;

      expect(manifest.teamId).toBe('test-team');
      expect(manifest.state).toBe(TeamState.PENDING);
      expect(manifest.agentIds).toContain('lead-1');
      expect(manifest.agentIds).toContain('agent-1');
    });

    it('should include version in manifest', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      const manifestPath = path.join(tempDir, 'test-team', 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content) as TeamManifest;

      expect(manifest.version).toBe('1.0.0');
    });
  });

  describe('loadManifest', () => {
    it('should load existing manifest', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      const manifest = await store.loadManifest('test-team');

      expect(manifest.teamId).toBe('test-team');
      expect(manifest.config.members).toHaveLength(1);
      expect(manifest.config.lead).toBeDefined();
    });

    it('should throw error for non-existent team', async () => {
      await expect(store.loadManifest('non-existent')).rejects.toMatchObject({
        code: TeamErrorCode.TEAM_NOT_FOUND,
      });
    });

    it('should throw error for invalid manifest', async () => {
      const teamDir = path.join(tempDir, 'invalid-team');
      await fs.mkdir(teamDir, { recursive: true });
      await fs.writeFile(
        path.join(teamDir, 'manifest.json'),
        'invalid json',
        'utf-8'
      );

      await expect(store.loadManifest('invalid-team')).rejects.toMatchObject({
        code: TeamErrorCode.STORE_ERROR,
      });
    });
  });

  describe('manifestToTeam', () => {
    it('should convert manifest to team', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      const manifest = await store.loadManifest('test-team');
      const convertedTeam = store.manifestToTeam(manifest);

      expect(convertedTeam.teamId).toBe('test-team');
      expect(convertedTeam.agentStates.size).toBe(2);
      expect(convertedTeam.agentStates.has('lead-1')).toBe(true);
      expect(convertedTeam.agentStates.has('agent-1')).toBe(true);
    });

    it('should initialize default stats when missing', async () => {
      const team = createTestTeam('test-team');
      team.stats = undefined as unknown as typeof team.stats;
      await store.createWorkspace('test-team');
      
      // Manually save manifest without stats
      const manifestPath = path.join(tempDir, 'test-team', 'manifest.json');
      const manifest = {
        version: '1.0.0',
        teamId: 'test-team',
        state: TeamState.PENDING,
        config: team.config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        agentIds: ['lead-1', 'agent-1'],
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      const loadedManifest = await store.loadManifest('test-team');
      const convertedTeam = store.manifestToTeam(loadedManifest);

      expect(convertedTeam.stats).toBeDefined();
      expect(convertedTeam.stats.totalTasks).toBe(0);
    });
  });

  describe('load', () => {
    it('should load complete team object', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      const loadedTeam = await store.load('test-team');

      expect(loadedTeam.teamId).toBe('test-team');
      expect(loadedTeam.agentStates.size).toBe(2);
    });
  });

  describe('list', () => {
    it('should return empty array when no teams', async () => {
      const teams = await store.list();
      expect(teams).toHaveLength(0);
    });

    it('should list all teams', async () => {
      const team1 = createTestTeam('team-1');
      const team2 = createTestTeam('team-2');

      await store.createWorkspace('team-1');
      await store.createWorkspace('team-2');
      await store.saveManifest(team1);
      await store.saveManifest(team2);

      const teams = await store.list();

      expect(teams).toHaveLength(2);
      expect(teams.map(t => t.teamId)).toContain('team-1');
      expect(teams.map(t => t.teamId)).toContain('team-2');
    });

    it('should sort by updated time desc', async () => {
      const team1 = createTestTeam('team-1');
      const team2 = createTestTeam('team-2');

      await store.createWorkspace('team-1');
      await store.createWorkspace('team-2');
      await store.saveManifest(team1);
      
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.saveManifest(team2);

      const teams = await store.list();

      expect(teams[0].teamId).toBe('team-2');
      expect(teams[1].teamId).toBe('team-1');
    });
  });

  describe('updateState', () => {
    it('should update team state', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      await store.updateState('test-team', TeamState.RUNNING);

      const updatedTeam = await store.load('test-team');
      expect(updatedTeam.state).toBe(TeamState.RUNNING);
    });
  });

  describe('removeWorkspace', () => {
    it('should remove team directory', async () => {
      const team = createTestTeam('test-team');
      await store.createWorkspace('test-team');
      await store.saveManifest(team);

      await store.removeWorkspace('test-team');

      const teamPath = path.join(tempDir, 'test-team');
      await expect(fs.access(teamPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('should not throw for non-existent team', async () => {
      await expect(store.removeWorkspace('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('path helpers', () => {
    it('should return correct workspace path', () => {
      const path = store.getWorkspacePath('test-team');
      expect(path).toBe(path.join(tempDir, 'test-team'));
    });

    it('should return correct mailbox path', () => {
      const path = store.getMailboxPath('test-team');
      expect(path).toBe(path.join(tempDir, 'test-team', 'mailbox'));
    });

    it('should return correct tasks path', () => {
      const path = store.getTasksPath('test-team');
      expect(path).toBe(path.join(tempDir, 'test-team', 'tasks'));
    });

    it('should return correct agent path', () => {
      const path = store.getAgentPath('test-team', 'agent-1');
      expect(path).toBe(path.join(tempDir, 'test-team', 'agents', 'agent-1'));
    });
  });

  describe('saveAgentConfig', () => {
    it('should save agent configuration', async () => {
      await store.createWorkspace('test-team');

      const agentConfig = {
        agentId: 'agent-1',
        role: AgentRole.CODING,
        model: 'gpt-4',
        isLead: false,
      };

      await store.saveAgentConfig('test-team', 'agent-1', agentConfig);

      const agentPath = path.join(tempDir, 'test-team', 'agents', 'agent-1');
      const configPath = path.join(agentPath, 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const savedConfig = JSON.parse(content);

      expect(savedConfig.agentId).toBe('agent-1');
      expect(savedConfig.isLead).toBe(false);
    });

    it('should create agent directory if not exists', async () => {
      await store.createWorkspace('test-team');

      const agentConfig = {
        agentId: 'new-agent',
        role: AgentRole.TESTING,
      };

      await store.saveAgentConfig('test-team', 'new-agent', agentConfig);

      const agentPath = path.join(tempDir, 'test-team', 'agents', 'new-agent');
      await expect(fs.access(agentPath)).resolves.toBeUndefined();
    });
  });
});

/**
 * Team Manager Tests
 * Tests for team creation, lifecycle management, and operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TeamManager } from '../../src/team/team-manager.js';
import { TeamStore } from '../../src/team/team-store.js';
import { ConfigParser } from '../../src/team/config-parser.js';
import {
  TeamState,
  AgentState,
  AgentRole,
  CoordinationMode,
  TeamErrorCode,
  type TeamConfig,
  type AgentConfig,
} from '../../src/team/types.js';

describe('TeamManager', () => {
  let manager: TeamManager;
  let mockStore: TeamStore;
  let mockConfigParser: ConfigParser;
  const testWorkspacePath = '/tmp/test-workspace';

  const createTestConfig = (teamId: string): TeamConfig => ({
    teamId,
    task: 'Test task',
    coordinationMode: CoordinationMode.HUB_AND_SPOKE,
    sharedWorkspace: `${testWorkspacePath}/${teamId}`,
    members: [
      {
        agentId: 'agent-1',
        role: AgentRole.CODING,
        model: 'gpt-4',
      },
      {
        agentId: 'agent-2',
        role: AgentRole.REVIEW,
        model: 'gpt-4',
      },
    ],
    lead: {
      agentId: 'lead-1',
      role: AgentRole.LEAD,
      model: 'gpt-4o',
    },
  });

  beforeEach(() => {
    mockStore = {
      exists: vi.fn().mockResolvedValue(false),
      createWorkspace: vi.fn().mockResolvedValue(undefined),
      saveManifest: vi.fn().mockResolvedValue(undefined),
      saveAgentConfig: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(null),
      loadManifest: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      removeWorkspace: vi.fn().mockResolvedValue(undefined),
      updateState: vi.fn().mockResolvedValue(undefined),
      getWorkspacePath: vi.fn().mockReturnValue(`${testWorkspacePath}/team-001`),
      getMailboxPath: vi.fn().mockReturnValue(`${testWorkspacePath}/team-001/mailbox`),
      getTasksPath: vi.fn().mockReturnValue(`${testWorkspacePath}/team-001/tasks`),
      manifestToTeam: vi.fn(),
    } as unknown as TeamStore;

    mockConfigParser = {
      parseFromFile: vi.fn().mockResolvedValue(createTestConfig('from-file')),
      parseFromString: vi.fn(),
      generateTemplate: vi.fn(),
      validateWithErrors: vi.fn(),
    } as unknown as ConfigParser;

    manager = new TeamManager({
      store: mockStore,
      configParser: mockConfigParser,
      workspaceBasePath: testWorkspacePath,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createTeam', () => {
    it('should create a team successfully', async () => {
      const config = createTestConfig('team-001');
      
      const result = await manager.createTeam(config);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.teamId).toBe('team-001');
      expect(result.data?.state).toBe(TeamState.PENDING);
      expect(mockStore.createWorkspace).toHaveBeenCalledWith('team-001');
      expect(mockStore.saveManifest).toHaveBeenCalled();
    });

    it('should fail when team already exists', async () => {
      const config = createTestConfig('team-001');
      vi.mocked(mockStore.exists).mockResolvedValueOnce(true);

      const result = await manager.createTeam(config);

      expect(result.success).toBe(false);
      expect(result.code).toBe(TeamErrorCode.TEAM_ALREADY_EXISTS);
      expect(mockStore.createWorkspace).not.toHaveBeenCalled();
    });

    it('should initialize agent states correctly', async () => {
      const config = createTestConfig('team-001');
      
      const result = await manager.createTeam(config);

      expect(result.success).toBe(true);
      expect(result.data?.agentStates.size).toBe(3); // lead + 2 members
      expect(result.data?.agentStates.has('lead-1')).toBe(true);
      expect(result.data?.agentStates.has('agent-1')).toBe(true);
      expect(result.data?.agentStates.has('agent-2')).toBe(true);
    });

    it('should emit team:created event', async () => {
      const config = createTestConfig('team-001');
      const eventSpy = vi.fn();
      manager.on('team:created', eventSpy);

      await manager.createTeam(config);

      expect(eventSpy).toHaveBeenCalledWith({
        teamId: 'team-001',
        config,
      });
    });

    it('should handle store errors gracefully', async () => {
      const config = createTestConfig('team-001');
      vi.mocked(mockStore.createWorkspace).mockRejectedValueOnce(new Error('Disk full'));

      const result = await manager.createTeam(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Disk full');
    });
  });

  describe('createTeamFromConfig', () => {
    it('should create team from config file', async () => {
      const filePath = '/path/to/config.yaml';
      
      const result = await manager.createTeamFromConfig(filePath);

      expect(mockConfigParser.parseFromFile).toHaveBeenCalledWith(filePath);
      expect(result.success).toBe(true);
    });

    it('should handle config parse errors', async () => {
      vi.mocked(mockConfigParser.parseFromFile).mockRejectedValueOnce(
        new Error('Invalid YAML')
      );

      const result = await manager.createTeamFromConfig('/invalid/config.yaml');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid YAML');
    });
  });

  describe('destroyTeam', () => {
    it('should destroy a team successfully', async () => {
      const config = createTestConfig('team-001');
      config.state = TeamState.PENDING;
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const result = await manager.destroyTeam('team-001');

      expect(result.success).toBe(true);
      expect(mockStore.removeWorkspace).toHaveBeenCalledWith('team-001');
    });

    it('should require force to destroy running team', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.RUNNING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const result = await manager.destroyTeam('team-001');

      expect(result.success).toBe(false);
      expect(result.code).toBe(TeamErrorCode.TEAM_STATE_INVALID);
    });

    it('should destroy running team with force=true', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.RUNNING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const result = await manager.destroyTeam('team-001', true);

      expect(result.success).toBe(true);
      expect(mockStore.removeWorkspace).toHaveBeenCalled();
    });

    it('should emit team:destroying and team:destroyed events', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const destroyingSpy = vi.fn();
      const destroyedSpy = vi.fn();
      manager.on('team:destroying', destroyingSpy);
      manager.on('team:destroyed', destroyedSpy);

      await manager.destroyTeam('team-001');

      expect(destroyingSpy).toHaveBeenCalledWith({ teamId: 'team-001' });
      expect(destroyedSpy).toHaveBeenCalledWith({ teamId: 'team-001' });
    });
  });

  describe('getTeam', () => {
    it('should return team when found', async () => {
      const config = createTestConfig('team-001');
      const teamData = {
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      };
      
      vi.mocked(mockStore.load).mockResolvedValueOnce(teamData);

      const result = await manager.getTeam('team-001');

      expect(result.success).toBe(true);
      expect(result.data?.teamId).toBe('team-001');
    });

    it('should return error when team not found', async () => {
      vi.mocked(mockStore.load).mockRejectedValueOnce(
        new Error('Team not found')
      );

      const result = await manager.getTeam('non-existent');

      expect(result.success).toBe(false);
    });
  });

  describe('listTeams', () => {
    it('should return list of teams', async () => {
      vi.mocked(mockStore.list).mockResolvedValueOnce([
        {
          teamId: 'team-001',
          name: 'Team One',
          state: TeamState.PENDING,
          agentIds: ['agent-1', 'agent-2'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          config: createTestConfig('team-001'),
          stats: {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            totalRetries: 0,
            averageTaskTime: 0,
          },
          version: '1.0.0',
        },
      ]);

      const result = await manager.listTeams();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].teamId).toBe('team-001');
    });

    it('should return empty list when no teams', async () => {
      vi.mocked(mockStore.list).mockResolvedValueOnce([]);

      const result = await manager.listTeams();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe('state transitions', () => {
    const setupTeam = (state: TeamState) => {
      const config = createTestConfig('team-001');
      vi.mocked(mockStore.load).mockResolvedValue({
        teamId: 'team-001',
        state,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });
    };

    it('should start team from pending state', async () => {
      setupTeam(TeamState.PENDING);
      const eventSpy = vi.fn();
      manager.on('team:stateChanged', eventSpy);

      const result = await manager.startTeam('team-001');

      expect(result.success).toBe(true);
      expect(mockStore.saveManifest).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalledWith({
        teamId: 'team-001',
        oldState: TeamState.PENDING,
        newState: TeamState.RUNNING,
      });
    });

    it('should pause running team', async () => {
      setupTeam(TeamState.RUNNING);

      const result = await manager.pauseTeam('team-001');

      expect(result.success).toBe(true);
    });

    it('should resume paused team', async () => {
      setupTeam(TeamState.PAUSED);

      const result = await manager.resumeTeam('team-001');

      expect(result.success).toBe(true);
    });

    it('should stop running team', async () => {
      setupTeam(TeamState.RUNNING);

      const result = await manager.stopTeam('team-001');

      expect(result.success).toBe(true);
    });

    it('should reject invalid state transitions', async () => {
      setupTeam(TeamState.PENDING);

      const result = await manager.stopTeam('team-001');

      expect(result.success).toBe(false);
      expect(result.code).toBe(TeamErrorCode.TEAM_STATE_INVALID);
    });
  });

  describe('updateTeamConfig', () => {
    it('should update team configuration', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const updates = { task: 'Updated task' };
      const result = await manager.updateTeamConfig('team-001', updates);

      expect(result.success).toBe(true);
      expect(result.data?.config.task).toBe('Updated task');
    });

    it('should prevent modifying forbidden fields while running', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.RUNNING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const updates = { teamId: 'new-id' };
      const result = await manager.updateTeamConfig('team-001', updates);

      expect(result.success).toBe(false);
      expect(result.code).toBe(TeamErrorCode.TEAM_STATE_INVALID);
    });
  });

  describe('addAgent', () => {
    it('should add agent to team', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const newAgent: AgentConfig = {
        agentId: 'agent-3',
        role: AgentRole.TESTING,
        model: 'gpt-4',
      };

      const result = await manager.addAgent('team-001', newAgent);

      expect(result.success).toBe(true);
      expect(result.data?.agentStates.has('agent-3')).toBe(true);
      expect(mockStore.saveAgentConfig).toHaveBeenCalled();
    });

    it('should fail when agent already exists', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map([['agent-1', { agentId: 'agent-1', status: 'idle', retryCount: 0 }]]),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const duplicateAgent: AgentConfig = {
        agentId: 'agent-1',
        role: AgentRole.CODING,
      };

      const result = await manager.addAgent('team-001', duplicateAgent);

      expect(result.success).toBe(false);
      expect(result.code).toBe(TeamErrorCode.AGENT_ALREADY_EXISTS);
    });
  });

  describe('removeAgent', () => {
    it('should remove agent from team', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map([
          ['agent-1', { agentId: 'agent-1', status: 'idle', retryCount: 0 }],
          ['agent-2', { agentId: 'agent-2', status: 'idle', retryCount: 0 }],
        ]),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const result = await manager.removeAgent('team-001', 'agent-1');

      expect(result.success).toBe(true);
      expect(result.data?.agentStates.has('agent-1')).toBe(false);
      expect(result.data?.agentStates.has('agent-2')).toBe(true);
    });

    it('should prevent removing lead agent', async () => {
      const config = createTestConfig('team-001');
      
      vi.mocked(mockStore.load).mockResolvedValueOnce({
        teamId: 'team-001',
        state: TeamState.PENDING,
        config,
        agentStates: new Map([['lead-1', { agentId: 'lead-1', status: 'idle', retryCount: 0 }]]),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          totalRetries: 0,
          averageTaskTime: 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const result = await manager.removeAgent('team-001', 'lead-1');

      expect(result.success).toBe(false);
    });
  });

  describe('path helpers', () => {
    it('should return correct workspace path', () => {
      const path = manager.getWorkspacePath('team-001');
      expect(path).toBe(`${testWorkspacePath}/team-001`);
    });

    it('should return correct mailbox path', () => {
      const path = manager.getMailboxPath('team-001');
      expect(path).toBe(`${testWorkspacePath}/team-001/mailbox`);
    });

    it('should return correct tasks path', () => {
      const path = manager.getTasksPath('team-001');
      expect(path).toBe(`${testWorkspacePath}/team-001/tasks`);
    });
  });
});

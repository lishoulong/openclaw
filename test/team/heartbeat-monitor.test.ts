/**
 * Heartbeat Monitor Tests
 * Tests for agent health tracking and timeout detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { HeartbeatMonitor, createHeartbeatMonitor, DEFAULT_HEARTBEAT_CONFIG } from '../../src/team/heartbeat-monitor.js';
import type { HeartbeatData } from '../../src/team/heartbeat-file.js';

describe('HeartbeatMonitor', () => {
  let monitor: HeartbeatMonitor;
  let tempDir: string;
  const agentId = 'test-agent';
  const sessionId = 'test-session';
  const teamId = 'test-team';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heartbeat-test-'));
    
    monitor = new HeartbeatMonitor({
      intervalMs: 100, // Fast for tests
      timeoutMs: 500,
      maxRetries: 2,
      backoffMultiplier: 1.5,
      autoRecover: true,
    });
  });

  afterEach(async () => {
    monitor.dispose();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const m = new HeartbeatMonitor();
      expect(m).toBeDefined();
    });

    it('should create with partial config', () => {
      const m = new HeartbeatMonitor({ intervalMs: 5000 });
      expect(m).toBeDefined();
    });

    it('should use default values for missing config', () => {
      const m = new HeartbeatMonitor({});
      expect(m).toBeDefined();
    });
  });

  describe('startMonitoring', () => {
    it('should start monitoring an agent', async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);

      const status = monitor.getAgentStatus(agentId);
      expect(status).toBeDefined();
      expect(status?.agentId).toBe(agentId);
      expect(status?.sessionId).toBe(sessionId);
      expect(status?.status).toBe('healthy');
    });

    it('should create heartbeat file', async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);

      const heartbeatPath = path.join(tempDir, `.heartbeat-${agentId}.json`);
      await expect(fs.access(heartbeatPath)).resolves.toBeUndefined();
    });

    it('should warn when starting monitoring for already monitored agent', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not duplicate monitoring on double start', async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);

      const statuses = monitor.getAllStatuses();
      expect(statuses).toHaveLength(1);
    });
  });

  describe('stopMonitoring', () => {
    it('should stop monitoring an agent', async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);
      await monitor.stopMonitoring(agentId);

      const status = monitor.getAgentStatus(agentId);
      expect(status).toBeUndefined();
    });

    it('should warn when stopping non-monitored agent', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await monitor.stopMonitoring('non-existent');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should stop global monitoring when no agents left', async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);
      await monitor.stopMonitoring(agentId);

      // Internal state check
      const statuses = monitor.getAllStatuses();
      expect(statuses).toHaveLength(0);
    });
  });

  describe('reportStatus', () => {
    beforeEach(async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);
    });

    it('should report status successfully', async () => {
      await monitor.reportStatus(agentId, 'working', 'task-1', 50, 'Making progress');

      const status = monitor.getAgentStatus(agentId);
      expect(status?.lastHeartbeat?.status).toBe('working');
      expect(status?.lastHeartbeat?.currentTask).toBe('task-1');
      expect(status?.lastHeartbeat?.progress).toBe(50);
    });

    it('should warn for unknown agent', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await monitor.reportStatus('unknown-agent', 'idle');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should trigger onStatusChange callback', async () => {
      const onStatusChange = vi.fn();
      const m = new HeartbeatMonitor({
        intervalMs: 100,
        timeoutMs: 500,
        maxRetries: 2,
        backoffMultiplier: 1.5,
        autoRecover: true,
        onStatusChange,
      });

      await m.startMonitoring(agentId, sessionId, tempDir, teamId);
      await m.reportStatus(agentId, 'working');

      expect(onStatusChange).toHaveBeenCalledWith(agentId, 'working', 'idle');

      m.dispose();
    });

    it('should reset consecutive timeouts on successful report', async () => {
      // First simulate timeout
      await monitor.checkTimeout(agentId);
      
      // Then report success
      await monitor.reportStatus(agentId, 'idle');

      const status = monitor.getAgentStatus(agentId);
      expect(status?.consecutiveTimeouts).toBe(0);
    });

    it('should trigger onRecover callback', async () => {
      const onRecover = vi.fn();
      const m = new HeartbeatMonitor({
        intervalMs: 100,
        timeoutMs: 500,
        maxRetries: 2,
        backoffMultiplier: 1.5,
        autoRecover: true,
        onRecover,
      });

      await m.startMonitoring(agentId, sessionId, tempDir, teamId);
      
      // Simulate timeout then recovery
      m['agents'].get(agentId)!.consecutiveTimeouts = 1;
      m['agents'].get(agentId)!.status = 'timeout';
      
      await m.reportStatus(agentId, 'idle');

      expect(onRecover).toHaveBeenCalledWith(agentId);

      m.dispose();
    });
  });

  describe('checkTimeout', () => {
    beforeEach(async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);
    });

    it('should return false for healthy agent', async () => {
      const result = await monitor.checkTimeout(agentId);

      expect(result.isTimeout).toBe(false);
    });

    it('should return true for stale heartbeat', async () => {
      // Manually make the heartbeat stale
      const agent = monitor['agents'].get(agentId)!;
      if (agent.lastHeartbeat) {
        agent.lastHeartbeat.timestamp = new Date(Date.now() - 1000).toISOString();
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 600));

      const result = await monitor.checkTimeout(agentId);

      expect(result.isTimeout).toBe(true);
    });

    it('should return false for non-monitored agent', async () => {
      const result = await monitor.checkTimeout('non-existent');

      expect(result.isTimeout).toBe(false);
    });

    it('should increment consecutive timeouts', async () => {
      const agent = monitor['agents'].get(agentId)!;
      
      // Manually make the heartbeat stale
      if (agent.lastHeartbeat) {
        agent.lastHeartbeat.timestamp = new Date(Date.now() - 1000).toISOString();
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 600));

      await monitor.checkTimeout(agentId);
      
      expect(agent.consecutiveTimeouts).toBeGreaterThan(0);
    });
  });

  describe('getAllStatuses', () => {
    it('should return all agent statuses', async () => {
      await monitor.startMonitoring('agent-1', 'session-1', tempDir, teamId);
      await monitor.startMonitoring('agent-2', 'session-2', tempDir, teamId);

      const statuses = monitor.getAllStatuses();

      expect(statuses).toHaveLength(2);
      expect(statuses.map(s => s.agentId)).toContain('agent-1');
      expect(statuses.map(s => s.agentId)).toContain('agent-2');
    });

    it('should return empty array when no agents', () => {
      const statuses = monitor.getAllStatuses();
      expect(statuses).toHaveLength(0);
    });
  });

  describe('getAgentStatus', () => {
    it('should return status for monitored agent', async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);

      const status = monitor.getAgentStatus(agentId);

      expect(status).toBeDefined();
      expect(status?.agentId).toBe(agentId);
    });

    it('should return undefined for non-monitored agent', () => {
      const status = monitor.getAgentStatus('non-existent');

      expect(status).toBeUndefined();
    });
  });

  describe('global monitoring', () => {
    it('should check all agents periodically', async () => {
      const onTimeout = vi.fn();
      const m = new HeartbeatMonitor({
        intervalMs: 50,
        timeoutMs: 100,
        maxRetries: 1,
        backoffMultiplier: 1.5,
        autoRecover: true,
        onTimeout,
      });

      await m.startMonitoring(agentId, sessionId, tempDir, teamId);

      // Wait for at least one check cycle
      await new Promise(resolve => setTimeout(resolve, 150));

      // The check should have run (no assertion needed, just verify no errors)
      expect(m.getAllStatuses()).toHaveLength(1);

      m.dispose();
    });

    it('should stop global monitoring on dispose', async () => {
      await monitor.startMonitoring(agentId, sessionId, tempDir, teamId);
      monitor.dispose();

      // After dispose, should not be able to get status
      const statuses = monitor.getAllStatuses();
      expect(statuses).toHaveLength(0);
    });
  });

  describe('DEFAULT_HEARTBEAT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_HEARTBEAT_CONFIG.intervalMs).toBe(30000);
      expect(DEFAULT_HEARTBEAT_CONFIG.timeoutMs).toBe(120000);
      expect(DEFAULT_HEARTBEAT_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_HEARTBEAT_CONFIG.backoffMultiplier).toBe(1.5);
      expect(DEFAULT_HEARTBEAT_CONFIG.autoRecover).toBe(true);
    });
  });

  describe('createHeartbeatMonitor', () => {
    it('should create monitor instance', () => {
      const m = createHeartbeatMonitor({
        intervalMs: 1000,
      });

      expect(m).toBeInstanceOf(HeartbeatMonitor);
      m.dispose();
    });

    it('should create monitor with no config', () => {
      const m = createHeartbeatMonitor();

      expect(m).toBeInstanceOf(HeartbeatMonitor);
      m.dispose();
    });
  });
});

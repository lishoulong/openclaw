/**
 * Config Parser Tests
 * Tests for YAML configuration parsing and validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigParser } from '../../src/team/config-parser.js';
import {
  AgentRole,
  CoordinationMode,
  TeamErrorCode,
} from '../../src/team/types.js';

describe('ConfigParser', () => {
  let parser: ConfigParser;

  beforeEach(() => {
    parser = new ConfigParser();
  });

  describe('parseFromString', () => {
    it('should parse minimal valid config', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
      `;

      const config = parser.parseFromString(yaml);

      expect(config.teamId).toBe('test-team');
      expect(config.task).toBe('Build a feature');
      expect(config.members).toHaveLength(1);
      expect(config.members[0].agentId).toBe('agent-1');
      expect(config.members[0].role).toBe('coding');
    });

    it('should parse config with lead', () => {
      const yaml = `
teamId: test-team
task: Build a feature
lead:
  agentId: lead-1
  role: lead
members:
  - agentId: agent-1
    role: coding
      `;

      const config = parser.parseFromString(yaml);

      expect(config.lead).toBeDefined();
      expect(config.lead?.agentId).toBe('lead-1');
      expect(config.lead?.role).toBe('lead');
    });

    it('should parse config with coordination mode', () => {
      const yaml = `
teamId: test-team
task: Build a feature
coordinationMode: mesh
members:
  - agentId: agent-1
    role: coding
      `;

      const config = parser.parseFromString(yaml);

      expect(config.coordinationMode).toBe(CoordinationMode.MESH);
    });

    it('should default to hub-and-spoke mode', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
      `;

      const config = parser.parseFromString(yaml);

      expect(config.coordinationMode).toBe(CoordinationMode.HUB_AND_SPOKE);
    });

    it('should parse config with all options', () => {
      const yaml = `
teamId: test-team
name: My Test Team
task: Build a feature
description: A test team
coordinationMode: hub-and-spoke
sharedWorkspace: /custom/path
lead:
  agentId: lead-1
  role: lead
  model: gpt-4o
  systemPrompt: You are the lead
  requiresApproval: true
members:
  - agentId: agent-1
    role: coding
    model: gpt-4
    systemPrompt: You are a coder
    requiresApproval: false
planApproval:
  enabled: true
  stages:
    - goal
    - plan
  timeout: 3600
recovery:
  enabled: true
  maxRetries: 5
heartbeat:
  intervalMs: 60000
  timeoutMs: 180000
  maxRetries: 3
metadata:
  key: value
      `;

      const config = parser.parseFromString(yaml);

      expect(config.name).toBe('My Test Team');
      expect(config.description).toBe('A test team');
      expect(config.sharedWorkspace).toBe('/custom/path');
      expect(config.lead?.requiresApproval).toBe(true);
      expect(config.members[0].requiresApproval).toBe(false);
      expect(config.planApproval?.enabled).toBe(true);
      expect(config.recovery?.enabled).toBe(true);
      expect(config.heartbeat?.intervalMs).toBe(60000);
      expect(config.metadata?.key).toBe('value');
    });

    it('should throw on invalid YAML', () => {
      const yaml = `
teamId: test-team
  invalid indentation
    more invalid
      `;

      expect(() => parser.parseFromString(yaml)).toThrow();
    });

    it('should throw on empty YAML', () => {
      expect(() => parser.parseFromString('')).toThrow();
    });

    it('should apply defaults when applyDefaults is true', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
      `;

      const config = parser.parseFromString(yaml, { applyDefaults: true });

      expect(config.heartbeat).toBeDefined();
      expect(config.heartbeat?.intervalMs).toBe(30000);
      expect(config.heartbeat?.maxRetries).toBe(3);
    });

    it('should not apply defaults when applyDefaults is false', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
      `;

      const config = parser.parseFromString(yaml, { applyDefaults: false });

      expect(config.heartbeat).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('should require teamId', () => {
      const yaml = `
task: Build a feature
members:
  - agentId: agent-1
    role: coding
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('teamId');
    });

    it('should require task', () => {
      const yaml = `
teamId: test-team
members:
  - agentId: agent-1
    role: coding
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('task');
    });

    it('should require at least one member', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members: []
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('members');
    });

    it('should require agentId for members', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - role: coding
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('agentId');
    });

    it('should require role for members', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('role');
    });

    it('should reject duplicate agent IDs', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
  - agentId: agent-1
    role: testing
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('Duplicate');
    });

    it('should reject lead in members list', () => {
      const yaml = `
teamId: test-team
task: Build a feature
lead:
  agentId: agent-1
  role: lead
members:
  - agentId: agent-1
    role: coding
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('Lead');
    });

    it('should validate heartbeat config', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
heartbeat:
  intervalMs: 5000
  timeoutMs: 10000
      `;

      expect(() => parser.parseFromString(yaml)).toThrow('timeoutMs must be less');
    });

    it('should skip validation when validate is false', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
  - agentId: agent-1
    role: testing
      `;

      const config = parser.parseFromString(yaml, { validate: false });

      expect(config.members).toHaveLength(2);
    });
  });

  describe('validateWithErrors', () => {
    it('should return valid for correct config', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
      `;

      const result = parser.validateWithErrors(yaml);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for invalid config', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members: []
      `;

      const result = parser.validateWithErrors(yaml);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect duplicate agent IDs', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
  - agentId: agent-1
    role: testing
      `;

      const result = parser.validateWithErrors(yaml);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
    });

    it('should return parse error for invalid YAML', () => {
      const yaml = 'invalid: yaml: [';

      const result = parser.validateWithErrors(yaml);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Parse'))).toBe(true);
    });
  });

  describe('generateTemplate', () => {
    it('should generate valid YAML template', () => {
      const template = parser.generateTemplate();

      expect(template).toContain('teamId:');
      expect(template).toContain('members:');
      expect(template).toContain('lead:');
      expect(template).toContain('coordinationMode:');
      expect(template).toContain('planApproval:');
      expect(template).toContain('recovery:');
      expect(template).toContain('heartbeat:');
    });

    it('should generate parseable template', () => {
      const template = parser.generateTemplate();

      // Should not throw
      expect(() => parser.parseFromString(template, { validate: false })).not.toThrow();
    });
  });

  describe('parseFromFile', () => {
    // Note: File system operations would require integration tests
    // This test verifies the method signature and error handling

    it('should throw on missing file', async () => {
      await expect(parser.parseFromFile('/non/existent/file.yaml')).rejects.toMatchObject({
        code: TeamErrorCode.CONFIG_INVALID,
      });
    });
  });

  describe('agent transformation', () => {
    it('should transform agent config correctly', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
    model: gpt-4
    systemPrompt: You are a coder
    requiresApproval: true
    skills:
      - typescript
      - react
    maxRetries: 5
    timeout: 60000
      `;

      const config = parser.parseFromString(yaml);

      const agent = config.members[0];
      expect(agent.agentId).toBe('agent-1');
      expect(agent.role).toBe('coding');
      expect(agent.model).toBe('gpt-4');
      expect(agent.systemPrompt).toBe('You are a coder');
      expect(agent.requiresApproval).toBe(true);
      expect(agent.skills).toEqual(['typescript', 'react']);
      expect(agent.maxRetries).toBe(5);
      expect(agent.timeout).toBe(60000);
    });

    it('should default requiresApproval to false', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
      `;

      const config = parser.parseFromString(yaml);

      expect(config.members[0].requiresApproval).toBe(false);
    });
  });

  describe('plan approval config', () => {
    it('should default stages', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
planApproval:
  enabled: true
      `;

      const config = parser.parseFromString(yaml);

      expect(config.planApproval?.stages).toEqual(['goal', 'plan', 'result']);
      expect(config.planApproval?.timeout).toBe(3600);
    });
  });

  describe('recovery config', () => {
    it('should apply defaults', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
recovery:
  enabled: true
      `;

      const config = parser.parseFromString(yaml);

      expect(config.recovery?.maxRetries).toBe(3);
      expect(config.recovery?.backoffMultiplier).toBe(2);
    });
  });

  describe('heartbeat config', () => {
    it('should apply defaults for optional fields', () => {
      const yaml = `
teamId: test-team
task: Build a feature
members:
  - agentId: agent-1
    role: coding
heartbeat:
  intervalMs: 30000
  timeoutMs: 60000
      `;

      const config = parser.parseFromString(yaml);

      expect(config.heartbeat?.maxRetries).toBe(3);
      expect(config.heartbeat?.backoffMultiplier).toBe(2);
    });
  });
});

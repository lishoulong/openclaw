/**
 * Gateway Mock
 * Mock implementation of Gateway for testing
 */

import { EventEmitter } from 'events';

export interface MockGatewayConfig {
  port?: number;
  host?: string;
  autoConnect?: boolean;
}

export interface MockMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: Date;
}

export interface MockAgentSession {
  agentId: string;
  sessionId: string;
  connected: boolean;
  lastActivity: Date;
}

export class MockGateway extends EventEmitter {
  private config: MockGatewayConfig;
  private connected = false;
  private sessions: Map<string, MockAgentSession> = new Map();
  private messages: MockMessage[] = [];
  private messageCounter = 0;

  constructor(config: MockGatewayConfig = {}) {
    super();
    this.config = {
      port: 8080,
      host: 'localhost',
      autoConnect: false,
      ...config,
    };

    if (this.config.autoConnect) {
      this.connect();
    }
  }

  /**
   * Connect to gateway
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Simulate connection delay
    await this.delay(10);
    
    this.connected = true;
    this.emit('connected', { host: this.config.host, port: this.config.port });
  }

  /**
   * Disconnect from gateway
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    // Clear all sessions
    for (const session of this.sessions.values()) {
      session.connected = false;
    }

    this.connected = false;
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Register agent session
   */
  async registerAgent(agentId: string): Promise<string> {
    if (!this.connected) {
      throw new Error('Gateway not connected');
    }

    const sessionId = `session-${agentId}-${Date.now()}`;
    
    this.sessions.set(agentId, {
      agentId,
      sessionId,
      connected: true,
      lastActivity: new Date(),
    });

    this.emit('agent:registered', { agentId, sessionId });
    
    return sessionId;
  }

  /**
   * Unregister agent session
   */
  async unregisterAgent(agentId: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Agent ${agentId} not registered`);
    }

    session.connected = false;
    this.sessions.delete(agentId);
    
    this.emit('agent:unregistered', { agentId, sessionId: session.sessionId });
  }

  /**
   * Send message to agent
   */
  async sendToAgent(agentId: string, type: string, payload: unknown): Promise<void> {
    if (!this.connected) {
      throw new Error('Gateway not connected');
    }

    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (!session.connected) {
      throw new Error(`Agent ${agentId} not connected`);
    }

    const message: MockMessage = {
      id: `msg-${++this.messageCounter}`,
      type,
      payload,
      timestamp: new Date(),
    };

    this.messages.push(message);
    session.lastActivity = new Date();

    this.emit('message:sent', { agentId, message });
  }

  /**
   * Broadcast message to all agents
   */
  async broadcast(type: string, payload: unknown, excludeAgentId?: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Gateway not connected');
    }

    const promises: Promise<void>[] = [];
    
    for (const [agentId, session] of this.sessions) {
      if (agentId !== excludeAgentId && session.connected) {
        promises.push(this.sendToAgent(agentId, type, payload));
      }
    }

    await Promise.all(promises);
    
    this.emit('message:broadcast', { type, payload, excludeAgentId });
  }

  /**
   * Simulate receiving message from agent
   */
  simulateMessage(agentId: string, type: string, payload: unknown): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.lastActivity = new Date();
    }

    const message: MockMessage = {
      id: `msg-${++this.messageCounter}`,
      type,
      payload,
      timestamp: new Date(),
    };

    this.messages.push(message);
    this.emit('message:received', { agentId, message });
  }

  /**
   * Get agent session
   */
  getSession(agentId: string): MockAgentSession | undefined {
    return this.sessions.get(agentId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): MockAgentSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get connected agents
   */
  getConnectedAgents(): string[] {
    return Array.from(this.sessions.entries())
      .filter(([, session]) => session.connected)
      .map(([agentId]) => agentId);
  }

  /**
   * Get all messages
   */
  getMessages(): MockMessage[] {
    return [...this.messages];
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * Simulate agent disconnection
   */
  simulateDisconnection(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.connected = false;
      this.emit('agent:disconnected', { agentId, sessionId: session.sessionId });
    }
  }

  /**
   * Simulate agent reconnection
   */
  simulateReconnection(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.connected = true;
      session.lastActivity = new Date();
      this.emit('agent:reconnected', { agentId, sessionId: session.sessionId });
    }
  }

  /**
   * Simulate error
   */
  simulateError(error: Error): void {
    this.emit('error', error);
  }

  /**
   * Update agent activity
   */
  updateAgentActivity(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Get gateway stats
   */
  getStats(): {
    connected: boolean;
    totalAgents: number;
    connectedAgents: number;
    totalMessages: number;
  } {
    return {
      connected: this.connected,
      totalAgents: this.sessions.size,
      connectedAgents: this.getConnectedAgents().length,
      totalMessages: this.messages.length,
    };
  }

  /**
   * Reset gateway state
   */
  reset(): void {
    this.sessions.clear();
    this.messages = [];
    this.messageCounter = 0;
    this.connected = false;
  }

  /**
   * Utility: delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a mock gateway instance
 */
export function createMockGateway(config?: MockGatewayConfig): MockGateway {
  return new MockGateway(config);
}

/**
 * Mock Gateway Server
 * Simulates the server-side gateway for tests
 */
export class MockGatewayServer extends EventEmitter {
  private port: number;
  private running = false;
  private gateways: Map<string, MockGateway> = new Map();

  constructor(port: number = 8080) {
    super();
    this.port = port;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.delay(10);
    this.running = true;
    this.emit('started', { port: this.port });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Disconnect all gateways
    for (const gateway of this.gateways.values()) {
      await gateway.disconnect();
    }

    this.running = false;
    this.emit('stopped');
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Create and register a gateway
   */
  createGateway(id: string, config?: MockGatewayConfig): MockGateway {
    const gateway = new MockGateway({ ...config, port: this.port });
    this.gateways.set(id, gateway);
    
    gateway.on('connected', () => {
      this.emit('gateway:connected', { id, gateway });
    });

    gateway.on('disconnected', () => {
      this.emit('gateway:disconnected', { id, gateway });
    });

    return gateway;
  }

  /**
   * Get gateway by ID
   */
  getGateway(id: string): MockGateway | undefined {
    return this.gateways.get(id);
  }

  /**
   * Get all gateways
   */
  getAllGateways(): MockGateway[] {
    return Array.from(this.gateways.values());
  }

  /**
   * Broadcast to all gateways
   */
  async broadcastToAll(type: string, payload: unknown): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const gateway of this.gateways.values()) {
      if (gateway.isConnected()) {
        promises.push(gateway.broadcast(type, payload));
      }
    }

    await Promise.all(promises);
  }

  /**
   * Utility: delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

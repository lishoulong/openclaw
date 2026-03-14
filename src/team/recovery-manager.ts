/**
 * Recovery Manager for Agent Failure Handling
 * Implements automatic recovery strategies, retry mechanisms, and state management
 */

import { logDebug, logError, logInfo, logWarn } from "../logger.js";
import { HeartbeatMonitor, type HeartbeatData } from "./heartbeat-monitor.js";

/**
 * Recovery strategy types
 */
export type RecoveryStrategy = "restart" | "retry" | "delegate" | "escalate" | "ignore";

/**
 * Recovery configuration
 */
export interface RecoveryConfig {
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number;
  /** Backoff multiplier for retry delays (default: 2) */
  backoffMultiplier: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Recovery strategy (default: "retry") */
  strategy: RecoveryStrategy;
  /** Delegate to this agent ID when using "delegate" strategy */
  delegateTo?: string;
  /** Callback when recovery succeeds */
  onRecoverySuccess?: (agentId: string, attempt: number) => void;
  /** Callback when recovery fails */
  onRecoveryFailure?: (agentId: string, error: Error, finalAttempt: boolean) => void;
  /** Callback when escalation is needed */
  onEscalation?: (agentId: string, reason: string) => void;
}

/**
 * Default recovery configuration
 */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  strategy: "retry",
};

/**
 * Recovery state for an agent
 */
interface AgentRecoveryState {
  agentId: string;
  retryCount: number;
  lastError?: Error;
  lastRecoveryAttempt?: Date;
  recoveryInProgress: boolean;
  consecutiveFailures: number;
  totalFailures: number;
  recoveryHistory: Array<{
    timestamp: Date;
    attempt: number;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Recovery attempt result
 */
export interface RecoveryResult {
  success: boolean;
  agentId: string;
  attempts: number;
  finalState: "recovered" | "failed" | "escalated" | "delegated";
  error?: Error;
  delegatedTo?: string;
}

/**
 * Recovery Manager class
 * Manages recovery strategies for failed agents
 */
export class RecoveryManager {
  private states = new Map<string, AgentRecoveryState>();
  private config: RecoveryConfig;
  private heartbeatMonitor?: HeartbeatMonitor;

  constructor(config: Partial<RecoveryConfig> = {}) {
    this.config = { ...DEFAULT_RECOVERY_CONFIG, ...config };
  }

  /**
   * Set the heartbeat monitor for integration
   */
  setHeartbeatMonitor(monitor: HeartbeatMonitor): void {
    this.heartbeatMonitor = monitor;
  }

  /**
   * Register an agent for recovery management
   * @param agentId - Agent ID
   */
  registerAgent(agentId: string): void {
    if (this.states.has(agentId)) {
      logDebug(`[recovery-manager] Agent ${agentId} already registered`);
      return;
    }

    const state: AgentRecoveryState = {
      agentId,
      retryCount: 0,
      recoveryInProgress: false,
      consecutiveFailures: 0,
      totalFailures: 0,
      recoveryHistory: [],
    };

    this.states.set(agentId, state);
    logInfo(`[recovery-manager] Registered agent ${agentId}`);
  }

  /**
   * Unregister an agent from recovery management
   * @param agentId - Agent ID
   */
  unregisterAgent(agentId: string): void {
    this.states.delete(agentId);
    logDebug(`[recovery-manager] Unregistered agent ${agentId}`);
  }

  /**
   * Attempt to recover a failed agent
   * @param agentId - Agent ID to recover
   * @param heartbeat - Last known heartbeat data
   * @param recoveryFn - Optional custom recovery function
   */
  async attemptRecovery(
    agentId: string,
    heartbeat: HeartbeatData,
    recoveryFn?: () => Promise<void>
  ): Promise<RecoveryResult> {
    const state = this.getOrCreateState(agentId);

    if (state.recoveryInProgress) {
      logWarn(`[recovery-manager] Recovery already in progress for ${agentId}`);
      return {
        success: false,
        agentId,
        attempts: state.retryCount,
        finalState: "failed",
        error: new Error("Recovery already in progress"),
      };
    }

    state.recoveryInProgress = true;
    state.lastRecoveryAttempt = new Date();

    logInfo(`[recovery-manager] Starting recovery for ${agentId} with strategy: ${this.config.strategy}`);

    try {
      const result = await this.executeRecovery(agentId, heartbeat, recoveryFn);
      return result;
    } finally {
      state.recoveryInProgress = false;
    }
  }

  /**
   * Execute recovery based on strategy
   */
  private async executeRecovery(
    agentId: string,
    heartbeat: HeartbeatData,
    recoveryFn?: () => Promise<void>
  ): Promise<RecoveryResult> {
    const state = this.getOrCreateState(agentId);

    switch (this.config.strategy) {
      case "restart":
        return this.executeRestartStrategy(agentId, heartbeat, recoveryFn);
      case "retry":
        return this.executeRetryStrategy(agentId, heartbeat, recoveryFn);
      case "delegate":
        return this.executeDelegateStrategy(agentId, heartbeat);
      case "escalate":
        return this.executeEscalateStrategy(agentId, heartbeat);
      case "ignore":
        logWarn(`[recovery-manager] Ignoring failure for ${agentId} (strategy: ignore)`);
        return { success: true, agentId, attempts: 0, finalState: "recovered" };
      default:
        return this.executeRetryStrategy(agentId, heartbeat, recoveryFn);
    }
  }

  /**
   * Execute restart strategy - restart the agent
   */
  private async executeRestartStrategy(
    agentId: string,
    _heartbeat: HeartbeatData,
    recoveryFn?: () => Promise<void>
  ): Promise<RecoveryResult> {
    const state = this.getOrCreateState(agentId);

    logInfo(`[recovery-manager] Attempting to restart agent ${agentId}`);

    try {
      if (recoveryFn) {
        await this.retryWithBackoff(agentId, recoveryFn);
      } else {
        // Default restart behavior - wait and check
        await this.delay(this.config.initialDelayMs);
      }

      state.consecutiveFailures = 0;
      this.recordRecoverySuccess(state);
      this.config.onRecoverySuccess?.(agentId, state.retryCount);

      return {
        success: true,
        agentId,
        attempts: state.retryCount,
        finalState: "recovered",
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recordRecoveryFailure(state, err);
      this.config.onRecoveryFailure?.(agentId, err, true);

      return {
        success: false,
        agentId,
        attempts: state.retryCount,
        finalState: "failed",
        error: err,
      };
    }
  }

  /**
   * Execute retry strategy - retry with backoff
   */
  private async executeRetryStrategy(
    agentId: string,
    _heartbeat: HeartbeatData,
    recoveryFn?: () => Promise<void>
  ): Promise<RecoveryResult> {
    const state = this.getOrCreateState(agentId);

    logInfo(`[recovery-manager] Attempting to retry agent ${agentId}`);

    const operation = recoveryFn || (() => this.checkAgentHealth(agentId));

    try {
      await this.retryWithBackoff(agentId, operation);

      state.consecutiveFailures = 0;
      this.recordRecoverySuccess(state);
      this.config.onRecoverySuccess?.(agentId, state.retryCount);

      return {
        success: true,
        agentId,
        attempts: state.retryCount,
        finalState: "recovered",
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recordRecoveryFailure(state, err);
      this.config.onRecoveryFailure?.(agentId, err, state.retryCount >= this.config.maxRetries);

      return {
        success: false,
        agentId,
        attempts: state.retryCount,
        finalState: "failed",
        error: err,
      };
    }
  }

  /**
   * Execute delegate strategy - delegate to another agent
   */
  private async executeDelegateStrategy(
    agentId: string,
    heartbeat: HeartbeatData
  ): Promise<RecoveryResult> {
    const delegateTo = this.config.delegateTo;

    if (!delegateTo) {
      logError(`[recovery-manager] No delegate target configured for ${agentId}`);
      return {
        success: false,
        agentId,
        attempts: 0,
        finalState: "failed",
        error: new Error("No delegate target configured"),
      };
    }

    logInfo(`[recovery-manager] Delegating agent ${agentId} to ${delegateTo}`);

    // TODO: Implement actual delegation logic
    // This would involve transferring state and task to the delegate agent

    return {
      success: true,
      agentId,
      attempts: 0,
      finalState: "delegated",
      delegatedTo: delegateTo,
    };
  }

  /**
   * Execute escalate strategy - escalate to human
   */
  private async executeEscalateStrategy(
    agentId: string,
    heartbeat: HeartbeatData
  ): Promise<RecoveryResult> {
    const reason = `Agent ${agentId} failed with status: ${heartbeat.status}`;
    logWarn(`[recovery-manager] Escalating agent ${agentId}: ${reason}`);

    this.config.onEscalation?.(agentId, reason);

    return {
      success: false,
      agentId,
      attempts: 0,
      finalState: "escalated",
      error: new Error(reason),
    };
  }

  /**
   * Retry an operation with exponential backoff
   * @param agentId - Agent ID
   * @param operation - Operation to retry
   * @returns Promise that resolves on success or rejects after max retries
   */
  async retryWithBackoff<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const state = this.getOrCreateState(agentId);
    let delay = this.config.initialDelayMs;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      state.retryCount = attempt;

      try {
        logDebug(`[recovery-manager] Retry attempt ${attempt}/${this.config.maxRetries} for ${agentId}`);
        const result = await operation();
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.config.maxRetries) {
          logError(`[recovery-manager] All ${this.config.maxRetries} retries exhausted for ${agentId}: ${err.message}`);
          throw err;
        }

        logWarn(`[recovery-manager] Attempt ${attempt} failed for ${agentId}, retrying in ${delay}ms: ${err.message}`);
        await this.delay(delay);

        // Calculate next delay with backoff
        delay = Math.min(delay * this.config.backoffMultiplier, this.config.maxDelayMs);
      }
    }

    throw new Error("Retry loop exited unexpectedly");
  }

  /**
   * Check if agent is healthy (placeholder for actual health check)
   */
  private async checkAgentHealth(_agentId: string): Promise<void> {
    // Placeholder - actual implementation would check agent process/connection
    await this.delay(100);
  }

  /**
   * Get or create recovery state for an agent
   */
  private getOrCreateState(agentId: string): AgentRecoveryState {
    let state = this.states.get(agentId);
    if (!state) {
      state = {
        agentId,
        retryCount: 0,
        recoveryInProgress: false,
        consecutiveFailures: 0,
        totalFailures: 0,
        recoveryHistory: [],
      };
      this.states.set(agentId, state);
    }
    return state;
  }

  /**
   * Record a successful recovery
   */
  private recordRecoverySuccess(state: AgentRecoveryState): void {
    state.recoveryHistory.push({
      timestamp: new Date(),
      attempt: state.retryCount,
      success: true,
    });
    state.retryCount = 0;
  }

  /**
   * Record a failed recovery
   */
  private recordRecoveryFailure(state: AgentRecoveryState, error: Error): void {
    state.recoveryHistory.push({
      timestamp: new Date(),
      attempt: state.retryCount,
      success: false,
      error: error.message,
    });
    state.consecutiveFailures++;
    state.totalFailures++;
  }

  /**
   * Get recovery state for an agent
   */
  getRecoveryState(agentId: string): AgentRecoveryState | undefined {
    return this.states.get(agentId);
  }

  /**
   * Get all recovery states
   */
  getAllRecoveryStates(): AgentRecoveryState[] {
    return Array.from(this.states.values());
  }

  /**
   * Reset recovery state for an agent
   */
  resetRecoveryState(agentId: string): void {
    const state = this.states.get(agentId);
    if (state) {
      state.retryCount = 0;
      state.consecutiveFailures = 0;
      state.recoveryInProgress = false;
      state.lastError = undefined;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Dispose of the recovery manager
   */
  dispose(): void {
    this.states.clear();
    logInfo("[recovery-manager] Disposed");
  }
}

/**
 * Create a recovery manager instance
 */
export function createRecoveryManager(config?: Partial<RecoveryConfig>): RecoveryManager {
  return new RecoveryManager(config);
}

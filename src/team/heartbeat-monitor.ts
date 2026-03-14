/**
 * Heartbeat Monitor for Agent Health Tracking
 * Monitors agent heartbeats, detects timeouts, and reports status
 */

import { logDebug, logError, logInfo, logWarn } from "../logger.js";
import {
  readHeartbeat,
  writeHeartbeat,
  updateHeartbeat,
  isHeartbeatStale,
  getHeartbeatFilePath,
  type HeartbeatData,
} from "./heartbeat-file.js";

/**
 * Heartbeat monitor configuration
 */
export interface HeartbeatMonitorConfig {
  /** Heartbeat interval in milliseconds (default: 30000) */
  intervalMs: number;
  /** Timeout threshold in milliseconds (default: 120000) */
  timeoutMs: number;
  /** Maximum retries before marking agent as failed (default: 3) */
  maxRetries: number;
  /** Backoff multiplier for retry delays (default: 1.5) */
  backoffMultiplier: number;
  /** Whether to auto-recover on timeout (default: true) */
  autoRecover: boolean;
  /** Callback when agent timeout is detected */
  onTimeout?: (agentId: string, heartbeat: HeartbeatData) => void;
  /** Callback when agent recovers */
  onRecover?: (agentId: string) => void;
  /** Callback for status updates */
  onStatusChange?: (agentId: string, status: HeartbeatData["status"], previousStatus: HeartbeatData["status"]) => void;
}

/**
 * Default heartbeat monitor configuration
 */
export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatMonitorConfig = {
  intervalMs: 30000, // 30 seconds
  timeoutMs: 120000, // 2 minutes
  maxRetries: 3,
  backoffMultiplier: 1.5,
  autoRecover: true,
};

/**
 * Monitored agent state
 */
interface MonitoredAgent {
  agentId: string;
  sessionId: string;
  teamId?: string;
  workspacePath: string;
  filePath: string;
  lastHeartbeat: HeartbeatData | null;
  status: "healthy" | "warning" | "timeout" | "recovering" | "failed";
  retryCount: number;
  consecutiveTimeouts: number;
  checkInterval?: NodeJS.Timeout;
}

/**
 * Heartbeat Monitor class
 * Manages heartbeat monitoring for multiple agents
 */
export class HeartbeatMonitor {
  private agents = new Map<string, MonitoredAgent>();
  private config: HeartbeatMonitorConfig;
  private isRunning = false;
  private globalCheckInterval?: NodeJS.Timeout;

  constructor(config: Partial<HeartbeatMonitorConfig> = {}) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
  }

  /**
   * Start monitoring an agent
   * @param agentId - Agent ID
   * @param sessionId - Session ID
   * @param workspacePath - Base workspace path
   * @param teamId - Optional team ID
   */
  async startMonitoring(
    agentId: string,
    sessionId: string,
    workspacePath: string,
    teamId?: string
  ): Promise<void> {
    if (this.agents.has(agentId)) {
      logWarn(`[heartbeat-monitor] Agent ${agentId} is already being monitored`);
      return;
    }

    const filePath = getHeartbeatFilePath(workspacePath, agentId);

    // Initialize heartbeat file
    await writeHeartbeat(filePath, {
      agentId,
      sessionId,
      teamId,
      status: "idle",
    });

    const agent: MonitoredAgent = {
      agentId,
      sessionId,
      teamId,
      workspacePath,
      filePath,
      lastHeartbeat: null,
      status: "healthy",
      retryCount: 0,
      consecutiveTimeouts: 0,
    };

    this.agents.set(agentId, agent);
    logInfo(`[heartbeat-monitor] Started monitoring agent ${agentId}`);

    // Start global monitor if not running
    if (!this.isRunning) {
      this.startGlobalMonitoring();
    }
  }

  /**
   * Stop monitoring an agent
   * @param agentId - Agent ID
   */
  async stopMonitoring(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logWarn(`[heartbeat-monitor] Agent ${agentId} is not being monitored`);
      return;
    }

    this.agents.delete(agentId);
    logInfo(`[heartbeat-monitor] Stopped monitoring agent ${agentId}`);

    // Stop global monitor if no agents left
    if (this.agents.size === 0 && this.isRunning) {
      this.stopGlobalMonitoring();
    }
  }

  /**
   * Update agent heartbeat status
   * @param agentId - Agent ID
   * @param status - New status
   * @param currentTask - Optional current task
   * @param progress - Optional progress (0-100)
   * @param lastOutput - Optional last output
   */
  async reportStatus(
    agentId: string,
    status: HeartbeatData["status"],
    currentTask?: string,
    progress?: number,
    lastOutput?: string
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logWarn(`[heartbeat-monitor] Cannot report status for unknown agent ${agentId}`);
      return;
    }

    const previousStatus = agent.lastHeartbeat?.status || "idle";

    await writeHeartbeat(agent.filePath, {
      agentId,
      sessionId: agent.sessionId,
      teamId: agent.teamId,
      status,
      currentTask,
      progress,
      lastOutput,
    });

    agent.lastHeartbeat = await readHeartbeat(agent.filePath);

    // Reset consecutive timeouts on successful heartbeat
    if (agent.consecutiveTimeouts > 0 && status !== "error") {
      agent.consecutiveTimeouts = 0;
      agent.retryCount = 0;
      if (agent.status === "timeout" || agent.status === "recovering") {
        const oldStatus = agent.status;
        agent.status = "healthy";
        logInfo(`[heartbeat-monitor] Agent ${agentId} recovered from ${oldStatus}`);
        this.config.onRecover?.(agentId);
      }
    }

    // Notify status change
    if (previousStatus !== status) {
      this.config.onStatusChange?.(agentId, status, previousStatus);
    }

    logDebug(`[heartbeat-monitor] Status reported for ${agentId}: ${status}`);
  }

  /**
   * Check if an agent has timed out
   * @param agentId - Agent ID
   * @returns Timeout status
   */
  async checkTimeout(agentId: string): Promise<{ isTimeout: boolean; staleMs?: number }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { isTimeout: false };
    }

    const heartbeat = await readHeartbeat(agent.filePath);
    if (!heartbeat) {
      return { isTimeout: true };
    }

    agent.lastHeartbeat = heartbeat;

    if (isHeartbeatStale(heartbeat, this.config.timeoutMs)) {
      const staleMs = Date.now() - new Date(heartbeat.timestamp).getTime();
      agent.consecutiveTimeouts++;

      if (agent.consecutiveTimeouts >= this.config.maxRetries) {
        agent.status = "failed";
      } else if (agent.consecutiveTimeouts === 1) {
        agent.status = "timeout";
      }

      return { isTimeout: true, staleMs };
    }

    return { isTimeout: false };
  }

  /**
   * Get current status of all monitored agents
   */
  getAllStatuses(): Array<{
    agentId: string;
    status: MonitoredAgent["status"];
    lastHeartbeat: HeartbeatData | null;
    retryCount: number;
    consecutiveTimeouts: number;
  }> {
    return Array.from(this.agents.values()).map((agent) => ({
      agentId: agent.agentId,
      status: agent.status,
      lastHeartbeat: agent.lastHeartbeat,
      retryCount: agent.retryCount,
      consecutiveTimeouts: agent.consecutiveTimeouts,
    }));
  }

  /**
   * Get status of a specific agent
   */
  getAgentStatus(agentId: string): MonitoredAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Start global monitoring loop
   */
  private startGlobalMonitoring(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    logInfo("[heartbeat-monitor] Started global monitoring");

    // Use a single interval to check all agents
    this.globalCheckInterval = setInterval(() => {
      this.checkAllAgents();
    }, this.config.intervalMs);
  }

  /**
   * Stop global monitoring loop
   */
  private stopGlobalMonitoring(): void {
    this.isRunning = false;

    if (this.globalCheckInterval) {
      clearInterval(this.globalCheckInterval);
      this.globalCheckInterval = undefined;
    }

    logInfo("[heartbeat-monitor] Stopped global monitoring");
  }

  /**
   * Check all monitored agents for timeouts
   */
  private async checkAllAgents(): Promise<void> {
    for (const [agentId, agent] of this.agents) {
      try {
        const { isTimeout, staleMs } = await this.checkTimeout(agentId);

        if (isTimeout) {
          logWarn(
            `[heartbeat-monitor] Agent ${agentId} timeout detected (stale for ${staleMs}ms, consecutive: ${agent.consecutiveTimeouts})`
          );

          this.config.onTimeout?.(agentId, agent.lastHeartbeat!);

          if (agent.consecutiveTimeouts >= this.config.maxRetries) {
            logError(`[heartbeat-monitor] Agent ${agentId} marked as failed after ${this.config.maxRetries} timeouts`);
          }
        }
      } catch (error) {
        logError(`[heartbeat-monitor] Error checking agent ${agentId}: ${error}`);
      }
    }
  }

  /**
   * Dispose of the monitor and clean up resources
   */
  dispose(): void {
    this.stopGlobalMonitoring();
    this.agents.clear();
    logInfo("[heartbeat-monitor] Disposed");
  }
}

/**
 * Create a heartbeat monitor instance
 */
export function createHeartbeatMonitor(config?: Partial<HeartbeatMonitorConfig>): HeartbeatMonitor {
  return new HeartbeatMonitor(config);
}

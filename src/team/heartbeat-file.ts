/**
 * Heartbeat file management for agent monitoring
 * Handles reading and writing heartbeat files in JSON format
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { logDebug, logError } from "../logger.js";

/**
 * Heartbeat data structure
 */
export interface HeartbeatData {
  /** Timestamp of the heartbeat (ISO 8601 format) */
  timestamp: string;
  /** Current status of the agent */
  status: "idle" | "working" | "error" | "recovering" | "terminated";
  /** Current task being processed */
  currentTask?: string;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Last output from the agent */
  lastOutput?: string;
  /** Agent ID */
  agentId: string;
  /** Session ID */
  sessionId: string;
  /** Team ID */
  teamId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Default heartbeat data
 */
const DEFAULT_HEARTBEAT: Partial<HeartbeatData> = {
  status: "idle",
  progress: 0,
};

/**
 * Ensure directory exists for the heartbeat file
 */
async function ensureDirectory(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Read heartbeat data from file
 * @param filePath - Path to the heartbeat file
 * @returns Heartbeat data or null if file doesn't exist or is invalid
 */
export async function readHeartbeat(filePath: string): Promise<HeartbeatData | null> {
  try {
    if (!existsSync(filePath)) {
      logDebug(`[heartbeat-file] Heartbeat file not found: ${filePath}`);
      return null;
    }

    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content) as HeartbeatData;

    // Validate required fields
    if (!data.timestamp || !data.agentId || !data.sessionId) {
      logError(`[heartbeat-file] Invalid heartbeat data in ${filePath}: missing required fields`);
      return null;
    }

    logDebug(`[heartbeat-file] Read heartbeat from ${filePath}: ${data.status}`);
    return data;
  } catch (error) {
    logError(`[heartbeat-file] Failed to read heartbeat from ${filePath}: ${error}`);
    return null;
  }
}

/**
 * Write heartbeat data to file
 * @param filePath - Path to the heartbeat file
 * @param data - Heartbeat data to write
 */
export async function writeHeartbeat(
  filePath: string,
  data: Omit<HeartbeatData, "timestamp"> & { timestamp?: string }
): Promise<void> {
  try {
    await ensureDirectory(filePath);

    const heartbeat: HeartbeatData = {
      ...DEFAULT_HEARTBEAT,
      ...data,
      timestamp: data.timestamp || new Date().toISOString(),
    };

    await writeFile(filePath, JSON.stringify(heartbeat, null, 2), "utf-8");
    logDebug(`[heartbeat-file] Wrote heartbeat to ${filePath}: ${heartbeat.status}`);
  } catch (error) {
    logError(`[heartbeat-file] Failed to write heartbeat to ${filePath}: ${error}`);
    throw error;
  }
}

/**
 * Update specific fields in heartbeat file
 * @param filePath - Path to the heartbeat file
 * @param updates - Partial heartbeat data to update
 * @returns Updated heartbeat data or null if file doesn't exist
 */
export async function updateHeartbeat(
  filePath: string,
  updates: Partial<Omit<HeartbeatData, "timestamp" | "agentId" | "sessionId">>
): Promise<HeartbeatData | null> {
  try {
    const existing = await readHeartbeat(filePath);
    if (!existing) {
      return null;
    }

    const updated: HeartbeatData = {
      ...existing,
      ...updates,
      timestamp: new Date().toISOString(),
      agentId: existing.agentId,
      sessionId: existing.sessionId,
    };

    await writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
    logDebug(`[heartbeat-file] Updated heartbeat in ${filePath}: ${updated.status}`);
    return updated;
  } catch (error) {
    logError(`[heartbeat-file] Failed to update heartbeat in ${filePath}: ${error}`);
    return null;
  }
}

/**
 * Delete heartbeat file
 * @param filePath - Path to the heartbeat file
 */
export async function deleteHeartbeat(filePath: string): Promise<void> {
  try {
    if (existsSync(filePath)) {
      await import("node:fs/promises").then((fs) => fs.unlink(filePath));
      logDebug(`[heartbeat-file] Deleted heartbeat file: ${filePath}`);
    }
  } catch (error) {
    logError(`[heartbeat-file] Failed to delete heartbeat file ${filePath}: ${error}`);
  }
}

/**
 * Check if heartbeat is stale (exceeded timeout)
 * @param heartbeat - Heartbeat data
 * @param timeoutMs - Timeout in milliseconds
 * @returns true if heartbeat is stale
 */
export function isHeartbeatStale(heartbeat: HeartbeatData, timeoutMs: number): boolean {
  const lastHeartbeat = new Date(heartbeat.timestamp).getTime();
  const now = Date.now();
  return now - lastHeartbeat > timeoutMs;
}

/**
 * Get heartbeat file path for an agent
 * @param workspacePath - Base workspace path
 * @param agentId - Agent ID
 * @returns Full path to heartbeat file
 */
export function getHeartbeatFilePath(workspacePath: string, agentId: string): string {
  return `${workspacePath}/teams/agents/${agentId}/heartbeat.json`;
}

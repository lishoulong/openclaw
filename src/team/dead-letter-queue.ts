/**
 * Dead Letter Queue for Failed Tasks
 * Stores failed tasks for later inspection and manual resolution
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { logDebug, logError, logInfo, logWarn } from "../logger.js";

/**
 * Dead letter entry (failed task)
 */
export interface DeadLetterEntry {
  /** Unique entry ID */
  id: string;
  /** Agent ID that failed */
  agentId: string;
  /** Team ID */
  teamId?: string;
  /** Original task description */
  task: string;
  /** Error message */
  error: string;
  /** Error stack trace */
  stack?: string;
  /** Timestamp when failed */
  failedAt: string;
  /** Timestamp when moved to DLQ */
  enqueuedAt: string;
  /** Number of retry attempts made */
  retryCount: number;
  /** Last heartbeat data (JSON) */
  lastHeartbeat?: string;
  /** Status in DLQ */
  status: "pending" | "resolved" | "escalated" | "discarded";
  /** Resolution notes (when resolved) */
  resolutionNotes?: string;
  /** Resolved by (user ID) */
  resolvedBy?: string;
  /** Resolution timestamp */
  resolvedAt?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Dead letter queue configuration
 */
export interface DeadLetterQueueConfig {
  /** Maximum number of entries to keep (default: 1000) */
  maxEntries: number;
  /** Directory to store DLQ files */
  storagePath: string;
  /** Callback when new entry is added */
  onEntryAdded?: (entry: DeadLetterEntry) => void;
  /** Callback when entry is resolved */
  onEntryResolved?: (entry: DeadLetterEntry) => void;
  /** Auto-archive resolved entries (default: true) */
  autoArchive: boolean;
}

/**
 * Default DLQ configuration
 */
export const DEFAULT_DLQ_CONFIG: DeadLetterQueueConfig = {
  maxEntries: 1000,
  storagePath: "./.openclaw/dead-letter-queue",
  autoArchive: true,
};

/**
 * Query filters for listing dead letters
 */
export interface DeadLetterFilter {
  status?: DeadLetterEntry["status"];
  agentId?: string;
  teamId?: string;
  since?: string;
  until?: string;
}

/**
 * Dead Letter Queue class
 * Manages storage and retrieval of failed tasks
 */
export class DeadLetterQueue {
  private entries = new Map<string, DeadLetterEntry>();
  private config: DeadLetterQueueConfig;
  private initialized = false;
  private storageFile: string;

  constructor(config: Partial<DeadLetterQueueConfig> = {}) {
    this.config = { ...DEFAULT_DLQ_CONFIG, ...config };
    this.storageFile = `${this.config.storagePath}/dlq.json`;
  }

  /**
   * Initialize the DLQ (load existing entries)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.ensureStorage();
      await this.loadEntries();
      this.initialized = true;
      logInfo(`[dead-letter-queue] Initialized with ${this.entries.size} entries`);
    } catch (error) {
      logError(`[dead-letter-queue] Failed to initialize: ${error}`);
      throw error;
    }
  }

  /**
   * Add a failed task to the dead letter queue
   * @param entry - Dead letter entry (without id, enqueuedAt, status)
   * @returns The created entry with generated ID
   */
  async enqueue(
    entry: Omit<DeadLetterEntry, "id" | "enqueuedAt" | "status">
  ): Promise<DeadLetterEntry> {
    await this.initialize();

    const id = this.generateId();
    const fullEntry: DeadLetterEntry = {
      ...entry,
      id,
      enqueuedAt: new Date().toISOString(),
      status: "pending",
    };

    // Enforce max entries limit (remove oldest pending entries)
    if (this.entries.size >= this.config.maxEntries) {
      this.removeOldestEntry();
    }

    this.entries.set(id, fullEntry);
    await this.saveEntries();

    logWarn(`[dead-letter-queue] Added entry ${id} for agent ${entry.agentId}: ${entry.error}`);
    this.config.onEntryAdded?.(fullEntry);

    return fullEntry;
  }

  /**
   * List dead letter entries with optional filtering
   * @param filter - Query filters
   * @returns Filtered entries
   */
  async listDeadLetters(filter?: DeadLetterFilter): Promise<DeadLetterEntry[]> {
    await this.initialize();

    let results = Array.from(this.entries.values());

    if (filter?.status) {
      results = results.filter((e) => e.status === filter.status);
    }

    if (filter?.agentId) {
      results = results.filter((e) => e.agentId === filter.agentId);
    }

    if (filter?.teamId) {
      results = results.filter((e) => e.teamId === filter.teamId);
    }

    if (filter?.since) {
      const since = new Date(filter.since).getTime();
      results = results.filter((e) => new Date(e.failedAt).getTime() >= since);
    }

    if (filter?.until) {
      const until = new Date(filter.until).getTime();
      results = results.filter((e) => new Date(e.failedAt).getTime() <= until);
    }

    // Sort by failedAt descending (newest first)
    results.sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime());

    return results;
  }

  /**
   * Get a specific dead letter entry
   * @param id - Entry ID
   */
  async getDeadLetter(id: string): Promise<DeadLetterEntry | null> {
    await this.initialize();
    return this.entries.get(id) || null;
  }

  /**
   * Resolve a dead letter entry (manual intervention)
 * @param id - Entry ID
   * @param resolution - Resolution details
   * @returns Updated entry or null if not found
   */
  async resolveDeadLetter(
    id: string,
    resolution: {
      notes: string;
      resolvedBy: string;
      discard?: boolean;
    }
  ): Promise<DeadLetterEntry | null> {
    await this.initialize();

    const entry = this.entries.get(id);
    if (!entry) {
      logWarn(`[dead-letter-queue] Entry ${id} not found for resolution`);
      return null;
    }

    if (entry.status === "resolved" || entry.status === "discarded") {
      logWarn(`[dead-letter-queue] Entry ${id} is already ${entry.status}`);
      return entry;
    }

    entry.status = resolution.discard ? "discarded" : "resolved";
    entry.resolutionNotes = resolution.notes;
    entry.resolvedBy = resolution.resolvedBy;
    entry.resolvedAt = new Date().toISOString();

    await this.saveEntries();

    if (this.config.autoArchive && entry.status === "resolved") {
      await this.archiveEntry(entry);
    }

    logInfo(`[dead-letter-queue] Resolved entry ${id} by ${resolution.resolvedBy}`);
    this.config.onEntryResolved?.(entry);

    return entry;
  }

  /**
   * Requeue a dead letter entry for retry
   * @param id - Entry ID
   * @param newAgentId - Optional new agent ID to assign
   * @returns Updated entry or null if not found
   */
  async requeueDeadLetter(id: string, newAgentId?: string): Promise<DeadLetterEntry | null> {
    await this.initialize();

    const entry = this.entries.get(id);
    if (!entry) {
      return null;
    }

    if (entry.status !== "pending") {
      logWarn(`[dead-letter-queue] Cannot requeue entry ${id} with status ${entry.status}`);
      return null;
    }

    // Create new entry with updated info
    const newEntry = await this.enqueue({
      agentId: newAgentId || entry.agentId,
      teamId: entry.teamId,
      task: entry.task,
      error: `Requeued from ${id}`,
      failedAt: new Date().toISOString(),
      retryCount: entry.retryCount + 1,
      lastHeartbeat: entry.lastHeartbeat,
      metadata: { ...entry.metadata, requeuedFrom: id },
    });

    // Mark original as resolved
    entry.status = "resolved";
    entry.resolutionNotes = `Requeued as ${newEntry.id}`;
    await this.saveEntries();

    return newEntry;
  }

  /**
   * Delete a dead letter entry
   * @param id - Entry ID
   */
  async deleteDeadLetter(id: string): Promise<boolean> {
    await this.initialize();

    const deleted = this.entries.delete(id);
    if (deleted) {
      await this.saveEntries();
      logDebug(`[dead-letter-queue] Deleted entry ${id}`);
    }

    return deleted;
  }

  /**
   * Get DLQ statistics
   */
  async getStatistics(): Promise<{
    total: number;
    pending: number;
    resolved: number;
    escalated: number;
    discarded: number;
    byAgent: Record<string, number>;
    byTeam: Record<string, number>;
  }> {
    await this.initialize();

    const entries = Array.from(this.entries.values());
    const byAgent: Record<string, number> = {};
    const byTeam: Record<string, number> = {};

    for (const entry of entries) {
      byAgent[entry.agentId] = (byAgent[entry.agentId] || 0) + 1;
      if (entry.teamId) {
        byTeam[entry.teamId] = (byTeam[entry.teamId] || 0) + 1;
      }
    }

    return {
      total: entries.length,
      pending: entries.filter((e) => e.status === "pending").length,
      resolved: entries.filter((e) => e.status === "resolved").length,
      escalated: entries.filter((e) => e.status === "escalated").length,
      discarded: entries.filter((e) => e.status === "discarded").length,
      byAgent,
      byTeam,
    };
  }

  /**
   * Clear all entries (use with caution)
   */
  async clear(): Promise<void> {
    await this.initialize();

    this.entries.clear();
    await this.saveEntries();
    logInfo("[dead-letter-queue] All entries cleared");
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorage(): Promise<void> {
    if (!existsSync(this.config.storagePath)) {
      await mkdir(this.config.storagePath, { recursive: true });
    }
  }

  /**
   * Load entries from storage
   */
  private async loadEntries(): Promise<void> {
    try {
      if (!existsSync(this.storageFile)) {
        return;
      }

      const content = await readFile(this.storageFile, "utf-8");
      const data = JSON.parse(content) as DeadLetterEntry[];

      this.entries.clear();
      for (const entry of data) {
        this.entries.set(entry.id, entry);
      }

      logDebug(`[dead-letter-queue] Loaded ${this.entries.size} entries from storage`);
    } catch (error) {
      logError(`[dead-letter-queue] Failed to load entries: ${error}`);
    }
  }

  /**
   * Save entries to storage
   */
  private async saveEntries(): Promise<void> {
    try {
      const data = Array.from(this.entries.values());
      await writeFile(this.storageFile, JSON.stringify(data, null, 2), "utf-8");
      logDebug(`[dead-letter-queue] Saved ${data.length} entries to storage`);
    } catch (error) {
      logError(`[dead-letter-queue] Failed to save entries: ${error}`);
      throw error;
    }
  }

  /**
   * Archive a resolved entry
   */
  private async archiveEntry(entry: DeadLetterEntry): Promise<void> {
    try {
      const archiveFile = `${this.config.storagePath}/archive-${new Date().toISOString().split("T")[0]}.json`;
      let archive: DeadLetterEntry[] = [];

      if (existsSync(archiveFile)) {
        const content = await readFile(archiveFile, "utf-8");
        archive = JSON.parse(content) as DeadLetterEntry[];
      }

      archive.push(entry);
      await writeFile(archiveFile, JSON.stringify(archive, null, 2), "utf-8");
      logDebug(`[dead-letter-queue] Archived entry ${entry.id}`);
    } catch (error) {
      logError(`[dead-letter-queue] Failed to archive entry: ${error}`);
    }
  }

  /**
   * Remove oldest entry when at capacity
   */
  private removeOldestEntry(): void {
    let oldest: DeadLetterEntry | null = null;
    let oldestId = "";

    for (const [id, entry] of this.entries) {
      if (!oldest || new Date(entry.enqueuedAt) < new Date(oldest.enqueuedAt)) {
        oldest = entry;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.entries.delete(oldestId);
      logWarn(`[dead-letter-queue] Removed oldest entry ${oldestId} to make room`);
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Dispose of the DLQ
   */
  dispose(): void {
    this.entries.clear();
    this.initialized = false;
    logInfo("[dead-letter-queue] Disposed");
  }
}

/**
 * Create a dead letter queue instance
 */
export function createDeadLetterQueue(config?: Partial<DeadLetterQueueConfig>): DeadLetterQueue {
  return new DeadLetterQueue(config);
}

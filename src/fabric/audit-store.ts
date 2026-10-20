/**
 * audit-store.ts — a bounded, queryable in-process store for Fabric execution
 * audit records (the read side of R9, powering the platform observability UI).
 *
 * The canonical audit "store" in this codebase is the gateway's unified log
 * (`formatFabricAuditLine`); this module adds a small in-memory ring buffer so
 * the platform admin surface can list/query recent decisions without scraping
 * logs. It is intentionally NOT a durable database — it keeps the most recent
 * `capacity` records (newest-first) and derives lightweight stats. A durable
 * sink can implement the same `FabricAuditStore` port later without UI changes.
 *
 * Records are already redacted at build time (`buildExecutionRecord` →
 * `snapshotRequest`), so the store never holds plaintext secrets.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.7.
 */

import { type AuditQuery, type FabricExecutionRecord, queryRecords } from "./audit.js";

/** Aggregate counters over the retained window (cheap, recomputed on demand). */
export interface FabricAuditStats {
  total: number;
  byDecision: { ALLOW: number; DENY: number; MODIFY: number };
  byStatus: Record<string, number>;
  /** Sum of recorded costUsd over the retained window. */
  costUsd: number;
}

/** Read/write port for Fabric audit records (the platform UI consumes the read side). */
export interface FabricAuditStore {
  /** Append a completed execution record (called from the service `onRecord`). */
  append(record: FabricExecutionRecord): void;
  /** Most-recent-first records, optionally filtered + limited. */
  query(query?: AuditQuery, limit?: number): FabricExecutionRecord[];
  /** Aggregate counters over the retained window (optionally tenant-scoped). */
  stats(query?: AuditQuery): FabricAuditStats;
  /** Total retained records (post-eviction). */
  size(): number;
}

const DEFAULT_CAPACITY = 1000;
const DEFAULT_QUERY_LIMIT = 100;

/**
 * Create a bounded in-memory audit store. Retains the newest `capacity` records;
 * older records are evicted once the buffer is full (FIFO by insertion order).
 */
export function createFabricAuditStore(capacity = DEFAULT_CAPACITY): FabricAuditStore {
  // Insertion order (oldest → newest). We read newest-first on query.
  const buffer: FabricExecutionRecord[] = [];

  function snapshot(query?: AuditQuery): FabricExecutionRecord[] {
    // queryRecords keeps insertion order; reverse for newest-first.
    const matched = query ? queryRecords(buffer, query) : buffer;
    return [...matched].toReversed();
  }

  return {
    append(record: FabricExecutionRecord): void {
      buffer.push(record);
      if (buffer.length > capacity) {
        buffer.splice(0, buffer.length - capacity);
      }
    },

    query(query?: AuditQuery, limit = DEFAULT_QUERY_LIMIT): FabricExecutionRecord[] {
      const newestFirst = snapshot(query);
      return limit > 0 ? newestFirst.slice(0, limit) : newestFirst;
    },

    stats(query?: AuditQuery): FabricAuditStats {
      const matched = query ? queryRecords(buffer, query) : buffer;
      const stats: FabricAuditStats = {
        total: matched.length,
        byDecision: { ALLOW: 0, DENY: 0, MODIFY: 0 },
        byStatus: {},
        costUsd: 0,
      };
      for (const r of matched) {
        stats.byDecision[r.decision.decision] += 1;
        stats.byStatus[r.result.status] = (stats.byStatus[r.result.status] ?? 0) + 1;
        if (typeof r.costUsd === "number") {
          stats.costUsd += r.costUsd;
        }
      }
      return stats;
    },

    size(): number {
      return buffer.length;
    },
  };
}

/**
 * Local row snapshot written by a finished connector sync.
 *
 * Sync already pages under the connector's own caps. Aggregate materialization
 * reads this snapshot so the Feed is the accumulated pull, not the first live
 * page. Incremental windows merge by a stable row key. A full window replaces.
 * A truncated or failed window does not call this.
 */

import type { ConnectorSyncSnapshot, EnterpriseDataStore } from "./types.js";

/** Per-stream cap. Above one connector page (100) and below an unbounded archive. */
export const CONNECTOR_SYNC_SNAPSHOT_ROW_CAP = 2000;

const SENSITIVE_KEY_RE =
  /token|secret|password|passwd|appkey|appsecret|credential|opentoken|authorization/i;

export function connectorSyncSnapshotId(sourceId: string, streamKey: string): string {
  return `${sourceId}::${streamKey}`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Drop credential-like keys before the snapshot is stored. */
export function stripSensitiveSyncRow(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stripSensitiveSyncRow(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  const record = objectRecord(value);
  if (!record) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      continue;
    }
    const next = stripSensitiveSyncRow(child, depth + 1);
    if (next !== undefined) {
      out[key] = next;
    }
  }
  return out;
}

function rowIdentity(row: unknown): string | null {
  if (Array.isArray(row)) {
    const first = row.find((cell) => typeof cell === "string" && cell.trim());
    return typeof first === "string" ? `cell:${first.trim()}` : null;
  }
  const record = objectRecord(row);
  if (!record) {
    return null;
  }
  for (const key of ["Code", "code", "ID", "Id", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return `${key}:${value.trim()}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${key}:${value}`;
    }
  }
  return null;
}

function mergeRows(existing: unknown[], incoming: unknown[]): unknown[] {
  const keyed = new Map<string, unknown>();
  const anonymous: unknown[] = [];
  const place = (row: unknown) => {
    const key = rowIdentity(row);
    if (!key) {
      anonymous.push(row);
      return;
    }
    keyed.set(key, row);
  };
  for (const row of existing) {
    place(row);
  }
  for (const row of incoming) {
    place(row);
  }
  return [...keyed.values(), ...anonymous];
}

function snapshots(store: EnterpriseDataStore): Record<string, ConnectorSyncSnapshot> {
  store.connectorSyncSnapshots ??= {};
  return store.connectorSyncSnapshots;
}

export function readConnectorSyncSnapshotForAction(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  connectorId: string;
  actionKey: string;
}): ConnectorSyncSnapshot | null {
  const connectorId = params.connectorId.trim().toLowerCase();
  const actionKey = params.actionKey.trim();
  for (const snapshot of Object.values(params.store.connectorSyncSnapshots ?? {})) {
    if (snapshot.tenantId !== params.tenantId || snapshot.sourceId !== params.sourceId) {
      continue;
    }
    if (snapshot.connectorId.trim().toLowerCase() !== connectorId) {
      continue;
    }
    if ((snapshot.actionKey ?? "") !== actionKey) {
      continue;
    }
    return snapshot;
  }
  return null;
}

/**
 * Replace (full / always-full streams) or merge (incremental window) then cap.
 * `truncated` on the result is the cap, not a failed connector window.
 */
export function writeConnectorSyncSnapshot(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  connectorId: string;
  streamKey: string;
  actionKey?: string;
  rows: unknown[];
  mode: "replace" | "merge";
  watermark?: string;
  nowIso: string;
}): ConnectorSyncSnapshot {
  const snapshotId = connectorSyncSnapshotId(params.sourceId, params.streamKey);
  const bucket = snapshots(params.store);
  const existing = bucket[snapshotId];
  const incoming = params.rows
    .map((row) => stripSensitiveSyncRow(row))
    .filter((row) => row !== undefined);
  const sameTenant =
    existing && existing.tenantId === params.tenantId && existing.sourceId === params.sourceId;
  let combined: unknown[];
  if (params.mode === "merge" && sameTenant && incoming.length === 0) {
    combined = existing.rows;
  } else if (params.mode === "merge" && sameTenant) {
    combined = mergeRows(existing.rows, incoming);
  } else {
    combined = incoming;
  }
  const truncated = combined.length > CONNECTOR_SYNC_SNAPSHOT_ROW_CAP;
  const rows = truncated ? combined.slice(0, CONNECTOR_SYNC_SNAPSHOT_ROW_CAP) : combined;
  const snapshot: ConnectorSyncSnapshot = {
    snapshotId,
    tenantId: params.tenantId,
    sourceId: params.sourceId,
    connectorId: params.connectorId.trim().toLowerCase(),
    streamKey: params.streamKey,
    actionKey: params.actionKey,
    rows,
    recordCount: rows.length,
    truncated,
    watermark: params.watermark ?? (params.mode === "merge" ? existing?.watermark : undefined),
    syncedAt: params.nowIso,
  };
  bucket[snapshotId] = snapshot;
  return snapshot;
}

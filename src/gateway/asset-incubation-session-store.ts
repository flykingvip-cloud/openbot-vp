import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

const BASE_DIR = path.join(CONFIG_DIR, "asset-incubation");
const SESSION_EVENTS_FILE = path.join(BASE_DIR, "session-events.json");
const EDIT_PATTERNS_FILE = path.join(BASE_DIR, "edit-patterns.json");
const EXTERNALIZATIONS_FILE = path.join(BASE_DIR, "externalizations.json");

const MAX_SESSION_EVENTS = 500;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type AssetIncubationSessionEventRecord = {
  id: string;
  ownerKey: string;
  sessionKey: string;
  contextId: string | null;
  clusterId: string;
  intentKey: string;
  label: string;
  suggestedAssetType: string;
  outputSchemaHash?: string;
  workflowSignature?: string;
  occurredAt: number;
};

export type EditPatternStabilityRecord = {
  ownerKey: string;
  transformId: string;
  repeatCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

export type ExternalizationSignalRecord = {
  id: string;
  ownerKey: string;
  kind: "copy" | "download" | "share" | "submit";
  contextId: string | null;
  sessionKey: string | null;
  occurredAt: number;
};

export type AssetIncubationEvidenceSummary = {
  ownerKey: string;
  clusterId: string | null;
  recurrenceCount: number;
  externalizationCount: number;
  editPatternStabilityCount: number;
  collaborationReuseCount: number;
};

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function normalizeOwnerKey(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : "local";
}

export function listSessionEvents(
  ownerKey: string,
  now = Date.now(),
): AssetIncubationSessionEventRecord[] {
  const owner = normalizeOwnerKey(ownerKey);
  const cutoff = now - RETENTION_MS;
  return readJsonFile<AssetIncubationSessionEventRecord[]>(SESSION_EVENTS_FILE, []).filter(
    (entry) => entry.ownerKey === owner && entry.occurredAt >= cutoff,
  );
}

export function appendSessionEvent(
  event: AssetIncubationSessionEventRecord,
): AssetIncubationSessionEventRecord[] {
  const owner = normalizeOwnerKey(event.ownerKey);
  const all = readJsonFile<AssetIncubationSessionEventRecord[]>(SESSION_EVENTS_FILE, []);
  const ownerEvents = all.filter((entry) => entry.ownerKey === owner && entry.id !== event.id);
  const otherOwners = all.filter((entry) => entry.ownerKey !== owner);
  const nextOwnerEvents = [...ownerEvents, { ...event, ownerKey: owner }].slice(
    -MAX_SESSION_EVENTS,
  );
  atomicWriteJson(SESSION_EVENTS_FILE, [...otherOwners, ...nextOwnerEvents]);
  return nextOwnerEvents;
}

export function recordEditPatternStability(params: {
  ownerKey: string;
  transformId: string;
  occurredAt?: number;
}): EditPatternStabilityRecord {
  const owner = normalizeOwnerKey(params.ownerKey);
  const transformId = params.transformId.trim();
  const occurredAt = params.occurredAt ?? Date.now();
  const all = readJsonFile<EditPatternStabilityRecord[]>(EDIT_PATTERNS_FILE, []);
  const idx = all.findIndex(
    (entry) => entry.ownerKey === owner && entry.transformId === transformId,
  );
  if (idx >= 0) {
    const existing = all[idx];
    const updated: EditPatternStabilityRecord = {
      ...existing,
      repeatCount: existing.repeatCount + 1,
      lastSeenAt: occurredAt,
    };
    all[idx] = updated;
    atomicWriteJson(EDIT_PATTERNS_FILE, all);
    return updated;
  }
  const created: EditPatternStabilityRecord = {
    ownerKey: owner,
    transformId,
    repeatCount: 1,
    firstSeenAt: occurredAt,
    lastSeenAt: occurredAt,
  };
  atomicWriteJson(EDIT_PATTERNS_FILE, [...all, created]);
  return created;
}

export function listEditPatternStability(ownerKey: string): EditPatternStabilityRecord[] {
  const owner = normalizeOwnerKey(ownerKey);
  return readJsonFile<EditPatternStabilityRecord[]>(EDIT_PATTERNS_FILE, []).filter(
    (entry) => entry.ownerKey === owner,
  );
}

export function recordExternalizationSignal(params: {
  ownerKey: string;
  kind: ExternalizationSignalRecord["kind"];
  contextId?: string | null;
  sessionKey?: string | null;
  occurredAt?: number;
}): ExternalizationSignalRecord {
  const owner = normalizeOwnerKey(params.ownerKey);
  const occurredAt = params.occurredAt ?? Date.now();
  const record: ExternalizationSignalRecord = {
    id: `${owner}:${params.kind}:${occurredAt}:${Math.random().toString(36).slice(2, 8)}`,
    ownerKey: owner,
    kind: params.kind,
    contextId: params.contextId?.trim() || null,
    sessionKey: params.sessionKey?.trim() || null,
    occurredAt,
  };
  const all = readJsonFile<ExternalizationSignalRecord[]>(EXTERNALIZATIONS_FILE, []);
  atomicWriteJson(EXTERNALIZATIONS_FILE, [...all, record].slice(-1000));
  return record;
}

export function listExternalizationSignals(
  ownerKey: string,
  now = Date.now(),
): ExternalizationSignalRecord[] {
  const owner = normalizeOwnerKey(ownerKey);
  const cutoff = now - RETENTION_MS;
  return readJsonFile<ExternalizationSignalRecord[]>(EXTERNALIZATIONS_FILE, []).filter(
    (entry) => entry.ownerKey === owner && entry.occurredAt >= cutoff,
  );
}

export function summarizeEvidence(params: {
  ownerKey: string;
  clusterId?: string | null;
  now?: number;
}): AssetIncubationEvidenceSummary {
  const owner = normalizeOwnerKey(params.ownerKey);
  const now = params.now ?? Date.now();
  const clusterId = params.clusterId?.trim() || null;
  const events = listSessionEvents(owner, now);
  const recurrenceCount = clusterId
    ? events.filter((entry) => entry.clusterId === clusterId).length
    : events.length;
  const externalizations = listExternalizationSignals(owner, now);
  const externalizationCount = clusterId
    ? externalizations.filter((entry) => entry.contextId === clusterId).length
    : externalizations.length;
  const editPatterns = listEditPatternStability(owner);
  const editPatternStabilityCount = editPatterns.reduce(
    (max, entry) => Math.max(max, entry.repeatCount >= 3 ? entry.repeatCount : 0),
    0,
  );
  const collaborationReuseCount = events.filter((entry) =>
    entry.sessionKey.startsWith("space:"),
  ).length;

  return {
    ownerKey: owner,
    clusterId,
    recurrenceCount,
    externalizationCount,
    editPatternStabilityCount,
    collaborationReuseCount,
  };
}

export function clusterSessionEventsForReview(events: AssetIncubationSessionEventRecord[]): Array<{
  fingerprint: string;
  label: string;
  sessionIds: string[];
  recurrenceCount: number;
  lastSeenAt: number;
  suggestedAssetType: string;
}> {
  const grouped = new Map<
    string,
    {
      fingerprint: string;
      label: string;
      sessionIds: string[];
      recurrenceCount: number;
      lastSeenAt: number;
      suggestedAssetType: string;
    }
  >();
  for (const event of events) {
    const key = event.clusterId || event.intentKey;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        fingerprint: key,
        label: event.label,
        sessionIds: event.sessionKey ? [event.sessionKey] : [],
        recurrenceCount: 1,
        lastSeenAt: event.occurredAt,
        suggestedAssetType: event.suggestedAssetType,
      });
      continue;
    }
    existing.recurrenceCount += 1;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, event.occurredAt);
    if (event.sessionKey && !existing.sessionIds.includes(event.sessionKey)) {
      existing.sessionIds.push(event.sessionKey);
    }
  }
  return [...grouped.values()].toSorted((left, right) => {
    if (right.recurrenceCount !== left.recurrenceCount) {
      return right.recurrenceCount - left.recurrenceCount;
    }
    return right.lastSeenAt - left.lastSeenAt;
  });
}

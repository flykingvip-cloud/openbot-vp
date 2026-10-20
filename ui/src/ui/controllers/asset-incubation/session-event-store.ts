import type { AssetType } from "../skill-models.ts";
import type { PatternFingerprint } from "./types.ts";

export type SessionIncubationEvent = {
  id: string;
  sessionKey: string;
  contextId: string | null;
  /** Phase 1.5 intent bucket — kept for labels */
  intentKey: string;
  /** Phase 2 cluster identity */
  clusterId: string;
  label: string;
  suggestedAssetType: AssetType;
  outputSchemaHash?: string;
  workflowSignature?: string;
  occurredAt: number;
};

const STORAGE_KEY = "openbot.asset-incubation.session-events.v1";
const MAX_EVENTS = 500;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function parseEvents(raw: string | null): SessionIncubationEvent[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const intentKey = typeof record.intentKey === "string" ? record.intentKey.trim() : "";
      const clusterId = typeof record.clusterId === "string" ? record.clusterId.trim() : intentKey;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const occurredAt = typeof record.occurredAt === "number" ? record.occurredAt : 0;
      if ((!clusterId && !intentKey) || !occurredAt) {
        return [];
      }
      return [
        {
          id: typeof record.id === "string" ? record.id : `${clusterId}:${occurredAt}`,
          sessionKey: typeof record.sessionKey === "string" ? record.sessionKey : "",
          contextId: typeof record.contextId === "string" ? record.contextId : null,
          intentKey: intentKey || clusterId,
          clusterId: clusterId || intentKey,
          label: label || intentKey || clusterId,
          suggestedAssetType:
            record.suggestedAssetType === "prompt" ||
            record.suggestedAssetType === "template" ||
            record.suggestedAssetType === "workflow" ||
            record.suggestedAssetType === "knowledge" ||
            record.suggestedAssetType === "agent" ||
            record.suggestedAssetType === "capability"
              ? record.suggestedAssetType
              : "capability",
          outputSchemaHash:
            typeof record.outputSchemaHash === "string" ? record.outputSchemaHash : undefined,
          workflowSignature:
            typeof record.workflowSignature === "string" ? record.workflowSignature : undefined,
          occurredAt,
        } satisfies SessionIncubationEvent,
      ];
    });
  } catch {
    return [];
  }
}

export function countClusterRecurrenceEvents(clusterId: string, now = Date.now()): number {
  const normalized = clusterId.trim();
  if (!normalized) {
    return 0;
  }
  return loadSessionIncubationEvents(now).filter(
    (entry) => entry.clusterId === normalized || entry.intentKey === normalized,
  ).length;
}

export function projectedClusterRecurrenceCount(clusterId: string, now = Date.now()): number {
  return countClusterRecurrenceEvents(clusterId, now) + 1;
}

export function loadSessionIncubationEvents(now = Date.now()): SessionIncubationEvent[] {
  if (!canUseStorage()) {
    return [];
  }
  const events = parseEvents(localStorage.getItem(STORAGE_KEY));
  const cutoff = now - RETENTION_MS;
  return events.filter((event) => event.occurredAt >= cutoff);
}

export function saveSessionIncubationEvents(events: SessionIncubationEvent[]): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // best-effort
  }
}

export function appendSessionIncubationEvent(
  event: SessionIncubationEvent,
  now = Date.now(),
): SessionIncubationEvent[] {
  const existing = loadSessionIncubationEvents(now).filter((entry) => entry.id !== event.id);
  const next = [...existing, event].slice(-MAX_EVENTS);
  saveSessionIncubationEvents(next);
  return next;
}

export function clearSessionIncubationEventsForTests(): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}

export function sessionEventFromFingerprint(params: {
  sessionKey: string;
  contextId: string | null;
  fingerprint: PatternFingerprint & {
    clusterId: string;
    intentKey: string;
    label: string;
    suggestedAssetType: AssetType;
  };
  occurredAt?: number;
  /** Avoid collapsing multiple finals that share session + cluster within the same ms. */
  disambiguator?: string | null;
}): SessionIncubationEvent {
  const occurredAt = params.occurredAt ?? Date.now();
  const disambiguator = params.disambiguator?.trim();
  return {
    id: disambiguator
      ? `${params.fingerprint.clusterId}:${params.sessionKey}:${occurredAt}:${disambiguator}`
      : `${params.fingerprint.clusterId}:${params.sessionKey}:${occurredAt}`,
    sessionKey: params.sessionKey,
    contextId: params.contextId,
    intentKey: params.fingerprint.intentKey,
    clusterId: params.fingerprint.clusterId,
    label: params.fingerprint.label,
    suggestedAssetType: params.fingerprint.suggestedAssetType,
    outputSchemaHash: params.fingerprint.outputSchemaHash,
    workflowSignature: params.fingerprint.workflowSignature,
    occurredAt,
  };
}

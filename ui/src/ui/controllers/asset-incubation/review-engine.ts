import type { AssetType } from "../skill-models.ts";
import {
  MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS,
  isKnowledgeAssetReviewSuggestion,
} from "./review-suggestion-scope.ts";
import { deriveIncubationDecision } from "./scorer.ts";
import {
  appendSessionIncubationEvent,
  loadSessionIncubationEvents,
  type SessionIncubationEvent,
} from "./session-event-store.ts";
import type { AssetIncubationDecision } from "./types.ts";
import { DEFAULT_INCUBATION_THRESHOLDS } from "./types.ts";

export type ReviewCluster = {
  fingerprint: string;
  label: string;
  sessionIds: string[];
  recurrenceCount: number;
  lastSeenAt: number;
  suggestedAssetType: AssetType;
};

export type AssetReviewSuggestion = {
  cluster: ReviewCluster;
  decision: AssetIncubationDecision;
  summary: string;
};

export type ReviewScheduleResult = {
  reviewedAt: number;
  windowDays: number;
  clusters: ReviewCluster[];
  suggestions: AssetReviewSuggestion[];
};

const DISMISS_STORAGE_KEY = "openbot.asset-incubation.review-dismiss.v1";

function loadDismissedFingerprints(): Set<string> {
  if (typeof localStorage === "undefined") {
    return new Set();
  }
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

export function dismissReviewSuggestion(fingerprint: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const dismissed = loadDismissedFingerprints();
  dismissed.add(fingerprint.trim());
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // best-effort
  }
}

export function clearReviewDismissalsForTests(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(DISMISS_STORAGE_KEY);
}

export function clusterSessionEvents(events: SessionIncubationEvent[]): ReviewCluster[] {
  const grouped = new Map<string, ReviewCluster>();
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

export function buildReviewSuggestion(cluster: ReviewCluster): AssetReviewSuggestion {
  const decision = deriveIncubationDecision({
    evidence: {
      recurrenceCount: cluster.recurrenceCount,
      reviewEngineStableCluster: true,
    },
    source: "review-engine",
    contextId: cluster.sessionIds[0] ?? cluster.fingerprint,
  });
  const summary = `过去 30 天内「${cluster.label}」出现了 ${cluster.recurrenceCount} 次，是否沉淀为标准流程？`;
  return { cluster, decision, summary };
}

export function scheduleReview(params?: {
  now?: number;
  windowDays?: number;
  topLimit?: number;
  minRecurrence?: number;
}): ReviewScheduleResult {
  const now = params?.now ?? Date.now();
  const windowDays = params?.windowDays ?? 30;
  const topLimit = params?.topLimit ?? MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS;
  const minRecurrence = params?.minRecurrence ?? DEFAULT_INCUBATION_THRESHOLDS.recurrenceForL3;
  const events = loadSessionIncubationEvents(now);
  const clusters = clusterSessionEvents(events);
  const dismissed = loadDismissedFingerprints();
  const suggestions = clusters
    .filter(
      (cluster) =>
        cluster.recurrenceCount >= minRecurrence &&
        !dismissed.has(cluster.fingerprint) &&
        !isKnowledgeAssetReviewSuggestion(cluster),
    )
    .slice(0, topLimit)
    .map((cluster) => buildReviewSuggestion(cluster));
  return {
    reviewedAt: now,
    windowDays,
    clusters,
    suggestions,
  };
}

export function recordSessionIncubationFromChat(params: {
  sessionKey: string;
  contextId: string | null;
  intentKey: string;
  label: string;
  suggestedAssetType: AssetType;
  occurredAt?: number;
}): void {
  const occurredAt = params.occurredAt ?? Date.now();
  appendSessionIncubationEvent({
    id: `${params.intentKey}:${params.sessionKey}:${occurredAt}`,
    sessionKey: params.sessionKey,
    contextId: params.contextId,
    intentKey: params.intentKey,
    clusterId: params.intentKey,
    label: params.label,
    suggestedAssetType: params.suggestedAssetType,
    occurredAt,
  });
}

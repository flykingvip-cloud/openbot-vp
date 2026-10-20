import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  loadLocalAdoptionOverlay,
  localUserInitiatedSaveCount,
  mergeAdoptionEvidence,
} from "./adoption-sync.ts";
import {
  deriveEditTransformSignature,
  maxStableEditPatternCount,
  recordLocalEditPattern,
} from "./edit-pattern-stability.ts";
import { countExternalizationSignals } from "./externalization-tracker.ts";
import {
  MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS,
  selectVisibleAssetReviewSuggestions,
} from "./review-suggestion-scope.ts";
import {
  appendSessionIncubationEvent,
  countClusterRecurrenceEvents,
  loadSessionIncubationEvents,
  projectedClusterRecurrenceCount,
  type SessionIncubationEvent,
} from "./session-event-store.ts";
import type { AssetEvidence } from "./types.ts";
import { createEmptyAdoptionEvidence } from "./types.ts";

export function loadLocalEvidenceOverlay(params: {
  clusterId?: string | null;
  contextId?: string | null;
  sessionKey?: string | null;
  capabilityId?: string | null;
  shareVisibility?: string | null;
  now?: number;
  /** Count the in-flight occurrence before the event is persisted post-decision. */
  includePendingOccurrence?: boolean;
}): Partial<AssetEvidence> {
  const now = params.now ?? Date.now();
  const events = loadSessionIncubationEvents(now);
  const clusterId = params.clusterId?.trim();
  const recurrenceCount = clusterId
    ? params.includePendingOccurrence
      ? projectedClusterRecurrenceCount(clusterId, now)
      : countClusterRecurrenceEvents(clusterId, now)
    : params.sessionKey
      ? events.filter((entry) => entry.sessionKey === params.sessionKey).length
      : 0;
  const externalizationCount = countExternalizationSignals(
    params.contextId ?? clusterId ?? null,
    now,
  );
  const editPatternStabilityCount = maxStableEditPatternCount();
  const collaborationReuseCount = events.filter((entry) =>
    entry.sessionKey.startsWith("space:"),
  ).length;
  const adoption = loadLocalAdoptionOverlay({
    capabilityId: params.capabilityId,
    shareVisibility: params.shareVisibility,
  });
  const userInitiatedSaveCount = localUserInitiatedSaveCount(params.contextId ?? clusterId ?? null);

  return {
    recurrenceCount,
    externalizationCount,
    editPatternStabilityCount,
    collaborationReuseCount,
    userInitiatedSaveCount,
    adoption,
  };
}

export async function fetchGatewayEvidenceSummary(
  client: GatewayBrowserClient | null | undefined,
  params?: {
    clusterId?: string | null;
    contextId?: string | null;
    capabilityId?: string | null;
  },
): Promise<Partial<AssetEvidence> | null> {
  if (!client) {
    return null;
  }
  try {
    const response = await client.request<{
      summary?: {
        recurrenceCount?: number;
        externalizationCount?: number;
        editPatternStabilityCount?: number;
        collaborationReuseCount?: number;
        userInitiatedSaveCount?: number;
        adoption?: AssetEvidence["adoption"];
      };
    }>("asset-incubation.evidence.summary", {
      clusterId: params?.clusterId ?? params?.contextId ?? null,
      contextId: params?.contextId ?? null,
      capabilityId: params?.capabilityId ?? null,
    });
    const summary = response?.summary;
    if (!summary) {
      return null;
    }
    return {
      recurrenceCount: summary.recurrenceCount ?? 0,
      externalizationCount: summary.externalizationCount ?? 0,
      editPatternStabilityCount: summary.editPatternStabilityCount ?? 0,
      collaborationReuseCount: summary.collaborationReuseCount ?? 0,
      userInitiatedSaveCount: summary.userInitiatedSaveCount ?? 0,
      adoption: summary.adoption,
    };
  } catch {
    return null;
  }
}

export function mergeEvidenceLayers(
  base: Partial<AssetEvidence>,
  local: Partial<AssetEvidence>,
  remote: Partial<AssetEvidence> | null,
): Partial<AssetEvidence> {
  const pickMax = (key: keyof AssetEvidence) => {
    if (key === "adoption") {
      return undefined;
    }
    const values = [base[key], local[key], remote?.[key]].filter(
      (value): value is number => typeof value === "number",
    );
    return values.length > 0 ? Math.max(...values) : 0;
  };
  const emptyAdoption = createEmptyAdoptionEvidence();
  const adoption = mergeAdoptionEvidence(
    mergeAdoptionEvidence(base.adoption ?? emptyAdoption, local.adoption ?? emptyAdoption),
    remote?.adoption ?? emptyAdoption,
  );
  return {
    ...base,
    recurrenceCount: pickMax("recurrenceCount"),
    externalizationCount: pickMax("externalizationCount"),
    editPatternStabilityCount: pickMax("editPatternStabilityCount"),
    collaborationReuseCount: pickMax("collaborationReuseCount"),
    userInitiatedSaveCount: pickMax("userInitiatedSaveCount"),
    adoption,
  };
}

export function persistSessionEventLocally(event: SessionIncubationEvent): void {
  appendSessionIncubationEvent(event);
}

export async function syncSessionEventToGateway(
  client: GatewayBrowserClient | null | undefined,
  event: SessionIncubationEvent,
): Promise<void> {
  persistSessionEventLocally(event);
  if (!client) {
    return;
  }
  try {
    await client.request("asset-incubation.session-events.append", {
      event: {
        id: event.id,
        sessionKey: event.sessionKey,
        contextId: event.contextId,
        clusterId: event.clusterId,
        intentKey: event.intentKey,
        label: event.label,
        suggestedAssetType: event.suggestedAssetType,
        outputSchemaHash: event.outputSchemaHash,
        workflowSignature: event.workflowSignature,
        occurredAt: event.occurredAt,
      },
    });
  } catch {
    // best-effort
  }
}

export async function syncEditPatternToGateway(
  client: GatewayBrowserClient | null | undefined,
  before: string,
  after: string,
): Promise<number> {
  const transformId = deriveEditTransformSignature(before, after);
  if (!transformId) {
    return 0;
  }
  const record = recordLocalEditPattern(transformId);
  if (client) {
    void client
      .request("asset-incubation.edit-pattern.record", { transformId })
      .catch(() => undefined);
  }
  return record.repeatCount;
}

export type ReviewSuggestionView = {
  fingerprint: string;
  label: string;
  summary: string;
  recurrenceCount: number;
  suggestedAssetType: SessionIncubationEvent["suggestedAssetType"];
};

export async function scheduleReviewWithSync(params: {
  client?: GatewayBrowserClient | null;
  topLimit?: number;
  minRecurrence?: number;
}): Promise<ReviewSuggestionView[]> {
  const topLimit = params.topLimit ?? MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS;
  if (params.client) {
    try {
      const remote = await params.client.request<{
        suggestions?: ReviewSuggestionView[];
      }>("asset-incubation.review.schedule", {
        topLimit,
        minRecurrence: params.minRecurrence ?? 3,
      });
      if (remote?.suggestions?.length) {
        return selectVisibleAssetReviewSuggestions(remote.suggestions, topLimit);
      }
    } catch {
      // fall through to local
    }
  }
  const { scheduleReview } = await import("./review-engine.ts");
  const local = scheduleReview({
    topLimit,
    minRecurrence: params.minRecurrence,
  });
  return selectVisibleAssetReviewSuggestions(
    local.suggestions.map((entry) => ({
      fingerprint: entry.cluster.fingerprint,
      label: entry.cluster.label,
      summary: entry.summary,
      recurrenceCount: entry.cluster.recurrenceCount,
      suggestedAssetType: entry.cluster.suggestedAssetType,
    })),
    topLimit,
  );
}

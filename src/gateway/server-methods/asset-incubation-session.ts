import { parseGuidanceEventInput, toGuidanceSessionEvent } from "../agent-growth/guidance-event.js";
import {
  countUserInitiatedSaves,
  linkContextToCapability,
  recordAdoptionSignal,
  recordUserInitiatedSave,
  summarizeAdoptionEvidence,
} from "../asset-incubation-adoption-store.js";
import { buildWeeklyDigest } from "../asset-incubation-digest.js";
import {
  appendSessionEvent,
  clusterSessionEventsForReview,
  listSessionEvents,
  recordEditPatternStability,
  recordExternalizationSignal,
  summarizeEvidence,
  type AssetIncubationSessionEventRecord,
} from "../asset-incubation-session-store.js";
import {
  MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS,
  selectVisibleAssetReviewSuggestions,
} from "../asset-review-suggestion-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function respondInvalid(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function respondUnavailable(respond: RespondFn, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}

function resolveOwnerKey(clientUser: string | undefined): string {
  return clientUser?.trim().toLowerCase() || "local";
}

function parseSessionEvent(
  value: unknown,
  ownerKey: string,
): AssetIncubationSessionEventRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const clusterId = typeof record.clusterId === "string" ? record.clusterId.trim() : "";
  const intentKey = typeof record.intentKey === "string" ? record.intentKey.trim() : "";
  const occurredAt = typeof record.occurredAt === "number" ? record.occurredAt : Date.now();
  if (!clusterId && !intentKey) {
    return null;
  }
  return {
    id:
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `${clusterId || intentKey}:${occurredAt}`,
    ownerKey,
    sessionKey: typeof record.sessionKey === "string" ? record.sessionKey : "",
    contextId: typeof record.contextId === "string" ? record.contextId : null,
    clusterId: clusterId || intentKey,
    intentKey: intentKey || clusterId,
    label: typeof record.label === "string" ? record.label : clusterId || intentKey,
    suggestedAssetType:
      typeof record.suggestedAssetType === "string" ? record.suggestedAssetType : "capability",
    outputSchemaHash:
      typeof record.outputSchemaHash === "string" ? record.outputSchemaHash : undefined,
    workflowSignature:
      typeof record.workflowSignature === "string" ? record.workflowSignature : undefined,
    occurredAt,
  };
}

export const assetIncubationSessionHandlers: GatewayRequestHandlers = {
  "asset-incubation.session-events.list": ({ client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      respond(true, { events: listSessionEvents(ownerKey) });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.session-events.append": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const event = parseSessionEvent(params?.event, ownerKey);
      if (!event) {
        respondInvalid(respond, "event.clusterId or event.intentKey is required");
        return;
      }
      const events = appendSessionEvent(event);
      respond(true, { ok: true, count: events.length });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  /**
   * Record a user-guidance-protocol lifecycle event for asset incubation.
   * Params: { event: GuidanceEventInput } (see agent-growth/guidance-event.ts).
   */
  "asset-incubation.guidance.record": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      // Accept either { event: GuidanceEventInput } or a flat GuidanceEventInput payload.
      const raw = params?.event && typeof params.event === "object" ? params.event : params;
      const parsed = parseGuidanceEventInput(raw);
      if (!parsed) {
        respondInvalid(
          respond,
          "event must include event(guidance_*), scenario, contextConfidence; step failures also need stepId + failureReason",
        );
        return;
      }
      const record = toGuidanceSessionEvent(parsed, ownerKey);
      const events = appendSessionEvent(record);
      respond(true, { ok: true, record, count: events.length });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.edit-pattern.record": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const transformId = typeof params?.transformId === "string" ? params.transformId.trim() : "";
      if (!transformId) {
        respondInvalid(respond, "transformId is required");
        return;
      }
      const record = recordEditPatternStability({ ownerKey, transformId });
      respond(true, { record });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.externalization.record": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const kind = params?.kind;
      if (kind !== "copy" && kind !== "download" && kind !== "share" && kind !== "submit") {
        respondInvalid(respond, "kind must be copy, download, share, or submit");
        return;
      }
      const record = recordExternalizationSignal({
        ownerKey,
        kind,
        contextId: typeof params?.contextId === "string" ? params.contextId : null,
        sessionKey: typeof params?.sessionKey === "string" ? params.sessionKey : null,
      });
      respond(true, { record });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.evidence.summary": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const clusterId = typeof params?.clusterId === "string" ? params.clusterId : null;
      const contextId = typeof params?.contextId === "string" ? params.contextId : null;
      const capabilityId = typeof params?.capabilityId === "string" ? params.capabilityId : null;
      const baseSummary = summarizeEvidence({ ownerKey, clusterId });
      const adoption = summarizeAdoptionEvidence({
        ownerKey,
        capabilityId,
        contextId: contextId ?? clusterId,
      });
      const userInitiatedSaveCount = countUserInitiatedSaves({
        ownerKey,
        contextId: contextId ?? clusterId,
        capabilityId,
      });
      respond(true, {
        summary: {
          ...baseSummary,
          userInitiatedSaveCount,
          adoption,
        },
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.adoption.record": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const capabilityId =
        typeof params?.capabilityId === "string" ? params.capabilityId.trim() : "";
      const kind = params?.kind;
      if (!capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }
      if (
        kind !== "share_to_group" &&
        kind !== "enterprise_submit" &&
        kind !== "member_use" &&
        kind !== "admin_recommend"
      ) {
        respondInvalid(
          respond,
          "kind must be share_to_group, enterprise_submit, member_use, or admin_recommend",
        );
        return;
      }
      const record = recordAdoptionSignal({
        ownerKey,
        capabilityId,
        kind,
        memberId: typeof params?.memberId === "string" ? params.memberId : null,
      });
      respond(true, { record });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.adoption.summary": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const capabilityId = typeof params?.capabilityId === "string" ? params.capabilityId : null;
      const contextId = typeof params?.contextId === "string" ? params.contextId : null;
      respond(true, {
        adoption: summarizeAdoptionEvidence({ ownerKey, capabilityId, contextId }),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.context.link": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const contextId = typeof params?.contextId === "string" ? params.contextId.trim() : "";
      const capabilityId =
        typeof params?.capabilityId === "string" ? params.capabilityId.trim() : "";
      if (!contextId || !capabilityId) {
        respondInvalid(respond, "contextId and capabilityId are required");
        return;
      }
      const link = linkContextToCapability({ ownerKey, contextId, capabilityId });
      respond(true, { link });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.user-initiated.record": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const record = recordUserInitiatedSave({
        ownerKey,
        contextId: typeof params?.contextId === "string" ? params.contextId : null,
        capabilityId: typeof params?.capabilityId === "string" ? params.capabilityId : null,
      });
      respond(true, { record });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.review.schedule": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const topLimit =
        typeof params?.topLimit === "number"
          ? Math.max(1, params.topLimit)
          : MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS;
      const minRecurrence = typeof params?.minRecurrence === "number" ? params.minRecurrence : 3;
      const events = listSessionEvents(ownerKey);
      const clusters = clusterSessionEventsForReview(events);
      const suggestions = selectVisibleAssetReviewSuggestions(
        clusters
          .filter((cluster) => cluster.recurrenceCount >= minRecurrence)
          .map((cluster) => ({
            fingerprint: cluster.fingerprint,
            label: cluster.label,
            recurrenceCount: cluster.recurrenceCount,
            suggestedAssetType: cluster.suggestedAssetType,
            summary: `过去 30 天内「${cluster.label}」出现了 ${cluster.recurrenceCount} 次，是否沉淀为标准流程？`,
          })),
        topLimit,
      );
      respond(true, {
        reviewedAt: Date.now(),
        windowDays: 30,
        clusters: suggestions.map((entry) => ({
          fingerprint: entry.fingerprint,
          label: entry.label,
          recurrenceCount: entry.recurrenceCount,
          suggestedAssetType: entry.suggestedAssetType,
        })),
        suggestions,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "asset-incubation.digest.build": ({ params, client, respond }) => {
    try {
      const ownerKey = resolveOwnerKey(client?.user);
      const topLimit = typeof params?.topLimit === "number" ? Math.max(1, params.topLimit) : 8;
      const minRecurrence = typeof params?.minRecurrence === "number" ? params.minRecurrence : 3;
      const digest = buildWeeklyDigest({ ownerKey, topLimit, minRecurrence });
      respond(true, digest);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};

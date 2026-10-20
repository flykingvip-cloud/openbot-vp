/**
 * Retention / storage tier evaluation (CL-P4-03).
 * Does not auto-purge unless enforceEnabled; legal hold always blocks purge transitions.
 */
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import { createEtag } from "./ids.js";
import { buildDefaultRetentionPolicy } from "./retention.js";
import type {
  ConversationRecord,
  ConversationRetentionPolicy,
  ConversationStorageTier,
  ConversationTenantContext,
} from "./types.js";

export type RetentionAction =
  | { type: "NONE" }
  | { type: "SET_STORAGE_TIER"; tier: ConversationStorageTier }
  | { type: "MARK_EXPIRING" }
  | { type: "SUGGEST_ARCHIVE" }
  | { type: "SUGGEST_PURGE" }
  | { type: "SKIP_LEGAL_HOLD" };

export type RetentionEvaluation = {
  conversationId: string;
  idleDays: number;
  actions: RetentionAction[];
  enforceWouldMutate: boolean;
};

/** Parse ISO-8601 duration like P7D / P30D (days only for MVP). */
export function parseDurationToDays(iso: string | null | undefined): number | null {
  if (!iso?.trim()) {
    return null;
  }
  const m = iso.trim().match(/^P(?:(\d+)D)?$/i);
  if (!m?.[1]) {
    return null;
  }
  return Number(m[1]);
}

function daysSince(iso: string | null, nowMs: number): number {
  if (!iso) {
    return 0;
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return 0;
  }
  return Math.max(0, (nowMs - t) / (24 * 60 * 60 * 1000));
}

export function evaluateConversationRetention(params: {
  record: ConversationRecord;
  policy: ConversationRetentionPolicy;
  nowMs?: number;
}): RetentionEvaluation {
  const nowMs = params.nowMs ?? Date.now();
  const anchor = params.record.lastMessageAt ?? params.record.updatedAt;
  const idleDays = daysSince(anchor, nowMs);
  const actions: RetentionAction[] = [];

  if (params.record.retentionState === "LEGAL_HOLD") {
    return {
      conversationId: params.record.conversationId,
      idleDays,
      actions: [{ type: "SKIP_LEGAL_HOLD" }],
      enforceWouldMutate: false,
    };
  }
  if (params.record.lifecycleStatus === "DELETED") {
    return {
      conversationId: params.record.conversationId,
      idleDays,
      actions: [{ type: "NONE" }],
      enforceWouldMutate: false,
    };
  }

  const warmAfter = parseDurationToDays(params.policy.warmAfter) ?? 30;
  const coldAfter = parseDurationToDays(params.policy.coldAfter) ?? 90;
  const archiveAfter = parseDurationToDays(params.policy.archiveAfter);
  const purgeAfter = parseDurationToDays(params.policy.purgeAfter);

  let desiredTier: ConversationStorageTier = "HOT";
  if (idleDays >= coldAfter) {
    desiredTier = "COLD";
  } else if (idleDays >= warmAfter) {
    desiredTier = "WARM";
  }
  if (desiredTier !== params.record.storageTier) {
    actions.push({ type: "SET_STORAGE_TIER", tier: desiredTier });
  }

  if (archiveAfter != null && idleDays >= archiveAfter && params.policy.archiveEnabled) {
    if (params.record.lifecycleStatus !== "ARCHIVED") {
      actions.push({ type: "SUGGEST_ARCHIVE" });
      actions.push({ type: "MARK_EXPIRING" });
    }
  }
  if (
    purgeAfter != null &&
    idleDays >= purgeAfter &&
    params.policy.userDeleteMode === "PURGE_ALLOWED"
  ) {
    actions.push({ type: "SUGGEST_PURGE" });
  }
  if (actions.length === 0) {
    actions.push({ type: "NONE" });
  }

  const enforceWouldMutate = actions.some(
    (a) => a.type === "SET_STORAGE_TIER" || a.type === "MARK_EXPIRING",
  );

  return {
    conversationId: params.record.conversationId,
    idleDays,
    actions,
    enforceWouldMutate,
  };
}

/**
 * Apply safe mutations (tier / expiring). Archive/purge remain suggestions unless
 * caller explicitly runs those jobs. Legal hold always wins.
 */
export async function applyRetentionEvaluation(params: {
  catalog: ConversationCatalogRepository;
  record: ConversationRecord;
  evaluation: RetentionEvaluation;
  enforce: boolean;
}): Promise<ConversationRecord> {
  if (!params.enforce) {
    return params.record;
  }
  if (
    params.record.retentionState === "LEGAL_HOLD" ||
    params.record.retentionState === "PURGE_PENDING"
  ) {
    return params.record;
  }

  let next = { ...params.record };
  let changed = false;
  for (const action of params.evaluation.actions) {
    if (action.type === "SET_STORAGE_TIER" && next.storageTier !== action.tier) {
      next.storageTier = action.tier;
      changed = true;
    }
    if (action.type === "MARK_EXPIRING" && next.retentionState === "RETAIN") {
      next.retentionState = "EXPIRING";
      changed = true;
    }
  }
  if (!changed) {
    return params.record;
  }
  next = {
    ...next,
    updatedAt: new Date().toISOString(),
    etag: createEtag(),
  };
  return params.catalog.updateConversation(next, params.record.etag);
}

export async function scanRetentionBatch(params: {
  catalog: ConversationCatalogRepository;
  ctx: ConversationTenantContext;
  policy?: ConversationRetentionPolicy;
  enforce: boolean;
  limit?: number;
  nowMs?: number;
}): Promise<{
  evaluated: RetentionEvaluation[];
  mutated: number;
}> {
  const policy =
    params.policy ??
    buildDefaultRetentionPolicy({
      dataPlaneId: params.ctx.dataPlaneId,
      tenantId: params.ctx.tenantId,
    });
  const page = await params.catalog.listConversations({
    dataPlaneId: params.ctx.dataPlaneId,
    tenantId: params.ctx.tenantId,
    lifecycleStatus: ["ACTIVE", "CLOSED", "ARCHIVED"],
    limit: params.limit ?? 100,
  });
  const evaluated: RetentionEvaluation[] = [];
  let mutated = 0;
  for (const record of page.rows) {
    const evaluation = evaluateConversationRetention({
      record,
      policy,
      nowMs: params.nowMs,
    });
    evaluated.push(evaluation);
    if (params.enforce && evaluation.enforceWouldMutate) {
      try {
        const next = await applyRetentionEvaluation({
          catalog: params.catalog,
          record,
          evaluation,
          enforce: true,
        });
        if (next.etag !== record.etag) {
          mutated += 1;
        }
      } catch {
        // concurrent update — skip
      }
    }
  }
  return { evaluated, mutated };
}

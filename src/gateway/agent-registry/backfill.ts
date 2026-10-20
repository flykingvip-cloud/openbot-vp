// Feature: shared-agent-identity-access-control-plane

import { quarantineAmbiguousLegacyAgentId, resolveLegacyAgentId } from "./legacy-resolver.js";
import { findPrimaryOwnerBinding, setPrimaryOwner } from "./ownership.js";
import { createAgentAsset, findAgentAssetBySlug } from "./registry.js";
import type { AgentRegistryStore } from "./types.js";

/**
 * One existing enterprise agent, as known before the Registry existed.
 *
 * Sourced from the ownership store (`tenantId` + agent `subjectId` + owning seat),
 * which is the authoritative record of who owns a legacy agent.
 */
export type LegacyEnterpriseAgent = {
  tenantId: string;
  legacyAgentId: string;
  seatId: string;
  displayName?: string;
};

export type BackfillAction =
  /** A new canonical asset was created and its seat owner bound. */
  | { action: "created"; legacyAgentId: string; tenantId: string; agentAssetId: string }
  /** The asset already existed; only the missing owner binding was added. */
  | { action: "owner-bound"; legacyAgentId: string; tenantId: string; agentAssetId: string }
  /** Already fully backfilled; nothing to do. */
  | { action: "already-present"; legacyAgentId: string; tenantId: string; agentAssetId: string }
  /** Several assets claim the same legacy id; quarantined for adjudication. */
  | { action: "quarantined"; legacyAgentId: string; tenantId: string; candidates: string[] }
  /**
   * The slug is taken by an asset that is not this legacy agent. Skipped rather than
   * renamed or re-pointed, because either choice would guess a canonical identity.
   */
  | { action: "slug-conflict"; legacyAgentId: string; tenantId: string; agentAssetId: string }
  /** Input was unusable (missing tenant, agent id, or seat). */
  | { action: "skipped-invalid"; legacyAgentId: string; tenantId: string; reason: string }
  /**
   * A universal builtin agent. Every employee gets a private instance, so it is not an
   * enterprise asset and must never be given a canonical identity or an owner
   * (ADR amendment 2).
   */
  | { action: "skipped-builtin"; legacyAgentId: string; tenantId: string };

export type BackfillReport = {
  actions: BackfillAction[];
  counts: Record<BackfillAction["action"], number>;
};

function emptyCounts(): BackfillReport["counts"] {
  return {
    created: 0,
    "owner-bound": 0,
    "already-present": 0,
    quarantined: 0,
    "slug-conflict": 0,
    "skipped-invalid": 0,
    "skipped-builtin": 0,
  };
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Backfills canonical assets for agents that predate the Registry.
 *
 * Idempotent by construction: it keys on `legacyAgentId` inside the enterprise, so a
 * second run reports `already-present` instead of creating duplicates. Nothing is
 * guessed — an ambiguous legacy id is quarantined and a taken slug is reported.
 *
 * The store is mutated in place; the caller persists it and decides whether to apply
 * the result at all (a dry run simply discards the store copy).
 */
export function applyAgentRegistryBackfill(params: {
  store: AgentRegistryStore;
  agents: LegacyEnterpriseAgent[];
  nowIso: string;
}): BackfillReport {
  const actions: BackfillAction[] = [];
  const counts = emptyCounts();
  const record = (action: BackfillAction): void => {
    actions.push(action);
    counts[action.action] += 1;
  };

  for (const agent of params.agents) {
    const tenantId = trimmed(agent.tenantId);
    const legacyAgentId = trimmed(agent.legacyAgentId);
    const seatId = trimmed(agent.seatId);
    if (!tenantId || !legacyAgentId || !seatId) {
      record({
        action: "skipped-invalid",
        legacyAgentId,
        tenantId,
        reason: !tenantId
          ? "missing tenantId"
          : !legacyAgentId
            ? "missing agentId"
            : "missing seatId",
      });
      continue;
    }

    const resolution = resolveLegacyAgentId({
      store: params.store,
      enterpriseId: tenantId,
      legacyAgentId,
    });
    if (resolution.kind === "builtin-universal") {
      record({ action: "skipped-builtin", legacyAgentId, tenantId });
      continue;
    }

    if (resolution.kind === "ambiguous") {
      quarantineAmbiguousLegacyAgentId({
        store: params.store,
        enterpriseId: tenantId,
        legacyAgentId,
        candidateAgentAssetIds: resolution.candidateAgentAssetIds,
        nowIso: params.nowIso,
      });
      record({
        action: "quarantined",
        legacyAgentId,
        tenantId,
        candidates: resolution.candidateAgentAssetIds,
      });
      continue;
    }

    if (resolution.kind === "resolved") {
      const ref = resolution.ref;
      if (findPrimaryOwnerBinding(params.store, ref)) {
        record({
          action: "already-present",
          legacyAgentId,
          tenantId,
          agentAssetId: ref.agentAssetId,
        });
        continue;
      }
      setPrimaryOwner({
        store: params.store,
        ref,
        ownerType: "seat",
        ownerId: seatId,
        nowIso: params.nowIso,
      });
      record({ action: "owner-bound", legacyAgentId, tenantId, agentAssetId: ref.agentAssetId });
      continue;
    }

    // No asset carries this legacy id yet. The slug must still be free, otherwise a
    // different asset already owns that enterprise-local alias.
    const slugHolder = findAgentAssetBySlug(params.store, tenantId, legacyAgentId);
    if (slugHolder) {
      record({
        action: "slug-conflict",
        legacyAgentId,
        tenantId,
        agentAssetId: slugHolder.agentAssetId,
      });
      continue;
    }

    const asset = createAgentAsset({
      store: params.store,
      enterpriseId: tenantId,
      agentSlug: legacyAgentId,
      displayName: trimmed(agent.displayName) || legacyAgentId,
      nowIso: params.nowIso,
      legacyAgentId,
    });
    setPrimaryOwner({
      store: params.store,
      ref: { enterpriseId: tenantId, agentAssetId: asset.agentAssetId },
      ownerType: "seat",
      ownerId: seatId,
      nowIso: params.nowIso,
    });
    record({ action: "created", legacyAgentId, tenantId, agentAssetId: asset.agentAssetId });
  }

  return { actions, counts };
}

/**
 * Projects ownership records onto the backfill input. Only active agent bindings are
 * eligible: a revoked or transferred record no longer states current ownership.
 */
export function selectBackfillCandidates(
  records: Array<{
    tenantId: string;
    subjectKind: string;
    subjectId: string;
    positionId: string;
    bindingStatus: string;
  }>,
  displayNameFor?: (agentId: string) => string | undefined,
): LegacyEnterpriseAgent[] {
  return records
    .filter((entry) => entry.subjectKind === "agent" && entry.bindingStatus === "active")
    .map((entry) => ({
      tenantId: entry.tenantId,
      legacyAgentId: entry.subjectId,
      seatId: entry.positionId,
      ...(displayNameFor?.(entry.subjectId)
        ? { displayName: displayNameFor(entry.subjectId) as string }
        : {}),
    }));
}

// Feature: shared-agent-identity-access-control-plane

import { randomUUID } from "node:crypto";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import type { AgentRef, AgentRegistryQuarantineEntry, AgentRegistryStore } from "./types.js";

/**
 * Four state resolution of a legacy identifier.
 *
 * `ambiguous` is deliberately distinct from `not-found`: guessing by slug,
 * recency, or first match is forbidden, so an ambiguous legacy id must be
 * quarantined for explicit adjudication instead of silently resolving.
 *
 * `builtin-universal` is also distinct from `not-found`: the id is perfectly
 * well known, it simply has no enterprise asset identity by model decision
 * (ADR amendment 2). Callers must not treat it as a missing asset.
 */
export type LegacyAgentResolution =
  | { kind: "resolved"; ref: AgentRef }
  | { kind: "not-found" }
  | { kind: "ambiguous"; candidateAgentAssetIds: string[] }
  | { kind: "builtin-universal" };

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * True for an agent every employee gets a private instance of, which therefore has no
 * enterprise asset identity, no owner, and no policy (ADR amendment 2).
 */
export function isUniversalBuiltinAgentId(legacyAgentId: string | null | undefined): boolean {
  return isBuiltinStewardAgent(legacyAgentId);
}

/**
 * Resolves a legacy `agentId` to a canonical ref inside one enterprise.
 *
 * Only an exact `legacyAgentId` match counts. The human readable `agentSlug` is
 * never consulted here, because it is an alias that enterprises may reassign.
 *
 * A universal builtin short-circuits before the store is consulted, so a stray asset
 * carrying that legacy id can never be resolved into the ownership or policy model.
 */
export function resolveLegacyAgentId(params: {
  store: AgentRegistryStore;
  enterpriseId: string;
  legacyAgentId: string;
}): LegacyAgentResolution {
  const enterpriseId = normalize(params.enterpriseId);
  const legacyAgentId = normalize(params.legacyAgentId);
  if (!enterpriseId || !legacyAgentId) {
    return { kind: "not-found" };
  }
  if (isUniversalBuiltinAgentId(legacyAgentId)) {
    return { kind: "builtin-universal" };
  }
  const candidates = Object.values(params.store.assets).filter(
    (asset) => asset.enterpriseId === enterpriseId && asset.legacyAgentId === legacyAgentId,
  );
  if (candidates.length === 0) {
    return { kind: "not-found" };
  }
  if (candidates.length > 1) {
    return {
      kind: "ambiguous",
      candidateAgentAssetIds: candidates.map((asset) => asset.agentAssetId).toSorted(),
    };
  }
  const [asset] = candidates;
  return { kind: "resolved", ref: { enterpriseId, agentAssetId: asset.agentAssetId } };
}

/**
 * Records an ambiguous legacy id for adjudication. Repeated detections reuse the
 * open entry so a hot path cannot flood the quarantine list.
 */
export function quarantineAmbiguousLegacyAgentId(params: {
  store: AgentRegistryStore;
  enterpriseId: string;
  legacyAgentId: string;
  candidateAgentAssetIds: string[];
  nowIso: string;
}): AgentRegistryQuarantineEntry {
  const existing = Object.values(params.store.quarantine).find(
    (entry) =>
      entry.enterpriseId === params.enterpriseId &&
      entry.legacyAgentId === params.legacyAgentId &&
      !entry.resolvedAt,
  );
  if (existing) {
    existing.candidateAgentAssetIds = params.candidateAgentAssetIds.toSorted();
    return existing;
  }
  const entry: AgentRegistryQuarantineEntry = {
    quarantineId: randomUUID(),
    enterpriseId: params.enterpriseId,
    legacyAgentId: params.legacyAgentId,
    reason: "ambiguous-legacy-id",
    candidateAgentAssetIds: params.candidateAgentAssetIds.toSorted(),
    detectedAt: params.nowIso,
  };
  params.store.quarantine[entry.quarantineId] = entry;
  return entry;
}

/**
 * Resolve and, when ambiguous, quarantine in one step. Returns the same three
 * state result so callers still have to handle every branch explicitly.
 */
export function resolveLegacyAgentIdWithQuarantine(params: {
  store: AgentRegistryStore;
  enterpriseId: string;
  legacyAgentId: string;
  nowIso: string;
}): LegacyAgentResolution {
  const resolution = resolveLegacyAgentId(params);
  if (resolution.kind === "ambiguous") {
    quarantineAmbiguousLegacyAgentId({
      store: params.store,
      enterpriseId: params.enterpriseId.trim(),
      legacyAgentId: params.legacyAgentId.trim(),
      candidateAgentAssetIds: resolution.candidateAgentAssetIds,
      nowIso: params.nowIso,
    });
  }
  return resolution;
}

export function listOpenQuarantineEntries(
  store: AgentRegistryStore,
  enterpriseId: string,
): AgentRegistryQuarantineEntry[] {
  return Object.values(store.quarantine)
    .filter((entry) => entry.enterpriseId === enterpriseId && !entry.resolvedAt)
    .toSorted((left, right) => left.detectedAt.localeCompare(right.detectedAt));
}

/** Marks a quarantine entry adjudicated. Resolution itself stays a human decision. */
export function resolveQuarantineEntry(params: {
  store: AgentRegistryStore;
  quarantineId: string;
  nowIso: string;
}): AgentRegistryQuarantineEntry | undefined {
  const entry = params.store.quarantine[params.quarantineId];
  if (!entry || entry.resolvedAt) {
    return undefined;
  }
  entry.resolvedAt = params.nowIso;
  return entry;
}

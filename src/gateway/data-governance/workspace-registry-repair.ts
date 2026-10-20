/**
 * Registry-side repair for legacy slug-keyed agent assets (pre-Item-7 data).
 */
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { findPrimaryOwnerBinding, setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset, findAgentAssetBySlug } from "../agent-registry/registry.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOpaqueAgentAssetId(agentAssetId: string): boolean {
  return UUID_RE.test(agentAssetId.trim());
}

/** True when the registry row uses a legacy slug as the map key / agentAssetId. */
export function isMalformedRegistryAssetEntry(params: {
  agentAssetId: string;
  legacyAgentId?: string | null;
  agentSlug?: string | null;
}): boolean {
  const id = params.agentAssetId.trim();
  if (!id) {
    return false;
  }
  if (isOpaqueAgentAssetId(id)) {
    return false;
  }
  const legacy = params.legacyAgentId?.trim();
  const slug = params.agentSlug?.trim();
  return id === legacy || id === slug || !isOpaqueAgentAssetId(id);
}

/**
 * Replace a slug-keyed registry asset with a UUID asset carrying the same legacyAgentId.
 * Mutates the store in place; caller persists when apply=true.
 */
export function repairMalformedRegistryAsset(params: {
  store: AgentRegistryStore;
  tenantId: string;
  legacyAgentId: string;
  nowIso: string;
  displayName?: string;
  defaultOwner?: { seatId?: string | null; userId: string };
}): { repaired: boolean; agentAssetId: string | null; fromAssetId?: string } {
  const tenantId = params.tenantId.trim();
  const legacyAgentId = params.legacyAgentId.trim();
  if (!tenantId || !legacyAgentId || isBuiltinStewardAgent(legacyAgentId)) {
    return { repaired: false, agentAssetId: null };
  }

  const resolution = resolveLegacyAgentId({
    store: params.store,
    enterpriseId: tenantId,
    legacyAgentId,
  });
  if (resolution.kind === "resolved") {
    const agentAssetId = resolution.ref.agentAssetId.trim();
    if (agentAssetId && agentAssetId !== legacyAgentId && isOpaqueAgentAssetId(agentAssetId)) {
      return { repaired: false, agentAssetId };
    }
  }

  const bySlug = findAgentAssetBySlug(params.store, tenantId, legacyAgentId);
  const malformed =
    bySlug && isMalformedRegistryAssetEntry(bySlug)
      ? bySlug
      : params.store.assets[legacyAgentId] &&
          isMalformedRegistryAssetEntry(params.store.assets[legacyAgentId])
        ? params.store.assets[legacyAgentId]
        : null;
  if (!malformed) {
    return { repaired: false, agentAssetId: null };
  }

  const fromAssetId = malformed.agentAssetId;
  const openOwner = findPrimaryOwnerBinding(params.store, {
    enterpriseId: tenantId,
    agentAssetId: fromAssetId,
  });

  // Retire slug before minting UUID replacement so createAgentAsset slug check passes.
  malformed.status = "archived";
  malformed.updatedAt = params.nowIso;
  malformed.agentSlug = `${malformed.agentSlug?.trim() || legacyAgentId}__archived__${params.nowIso}`;
  if (params.store.assets[fromAssetId]) {
    delete params.store.assets[fromAssetId];
  }

  const replacement = createAgentAsset({
    store: params.store,
    enterpriseId: tenantId,
    agentSlug: legacyAgentId,
    displayName: params.displayName?.trim() || malformed.displayName || legacyAgentId,
    nowIso: params.nowIso,
    legacyAgentId,
  });

  if (openOwner) {
    setPrimaryOwner({
      store: params.store,
      ref: { enterpriseId: tenantId, agentAssetId: replacement.agentAssetId },
      ownerType: openOwner.ownerType,
      ownerId: openOwner.ownerId,
      nowIso: params.nowIso,
    });
  } else if (params.defaultOwner?.userId.trim()) {
    const seatId = params.defaultOwner.seatId?.trim();
    setPrimaryOwner({
      store: params.store,
      ref: { enterpriseId: tenantId, agentAssetId: replacement.agentAssetId },
      ownerType: seatId ? "seat" : "membership",
      ownerId: seatId || params.defaultOwner.userId.trim(),
      nowIso: params.nowIso,
    });
  }

  return {
    repaired: true,
    agentAssetId: replacement.agentAssetId,
    fromAssetId,
  };
}

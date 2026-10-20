// Feature: shared-agent-identity-access-control-plane

import { randomUUID } from "node:crypto";
import {
  type AgentAsset,
  AgentRegistryError,
  type AgentRegistryStore,
  type AgentRef,
} from "./types.js";

function requireEnterpriseId(enterpriseId: string): string {
  const trimmed = enterpriseId?.trim();
  if (!trimmed) {
    throw new AgentRegistryError("ENTERPRISE_REQUIRED", "enterpriseId is required.");
  }
  return trimmed;
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/** Enterprise scoped listing; a global scan is never exposed to callers. */
export function listAgentAssets(store: AgentRegistryStore, enterpriseId: string): AgentAsset[] {
  const scope = requireEnterpriseId(enterpriseId);
  return Object.values(store.assets)
    .filter((asset) => asset.enterpriseId === scope)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/**
 * Reads an asset only inside its enterprise. A matching id from another
 * enterprise resolves to nothing rather than leaking the record.
 */
export function findAgentAsset(store: AgentRegistryStore, ref: AgentRef): AgentAsset | undefined {
  const asset = store.assets[ref.agentAssetId];
  return asset && asset.enterpriseId === ref.enterpriseId ? asset : undefined;
}

export function findAgentAssetBySlug(
  store: AgentRegistryStore,
  enterpriseId: string,
  agentSlug: string,
): AgentAsset | undefined {
  const scope = requireEnterpriseId(enterpriseId);
  const slug = normalizeSlug(agentSlug);
  return Object.values(store.assets).find(
    (asset) => asset.enterpriseId === scope && normalizeSlug(asset.agentSlug) === slug,
  );
}

/**
 * Creates an asset with a server generated opaque id. The caller never supplies
 * the id, so no external system can pin or guess a canonical identity.
 */
export function createAgentAsset(params: {
  store: AgentRegistryStore;
  enterpriseId: string;
  agentSlug: string;
  displayName: string;
  nowIso: string;
  agentDefinitionId?: string;
  legacyAgentId?: string;
  copiedFrom?: { enterpriseId: string; agentAssetId: string };
}): AgentAsset {
  const enterpriseId = requireEnterpriseId(params.enterpriseId);
  const agentSlug = params.agentSlug.trim();
  if (!agentSlug) {
    throw new AgentRegistryError("SLUG_CONFLICT", "agentSlug is required.");
  }
  if (findAgentAssetBySlug(params.store, enterpriseId, agentSlug)) {
    throw new AgentRegistryError(
      "SLUG_CONFLICT",
      `agentSlug "${agentSlug}" already exists in enterprise "${enterpriseId}".`,
    );
  }
  const asset: AgentAsset = {
    agentAssetId: randomUUID(),
    enterpriseId,
    agentSlug,
    displayName: params.displayName.trim() || agentSlug,
    status: "active",
    ...(params.agentDefinitionId ? { agentDefinitionId: params.agentDefinitionId } : {}),
    ...(params.legacyAgentId ? { legacyAgentId: params.legacyAgentId } : {}),
    ...(params.copiedFrom ? { copiedFrom: { ...params.copiedFrom, copiedAt: params.nowIso } } : {}),
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.assets[asset.agentAssetId] = asset;
  return asset;
}

/**
 * A cross enterprise copy is a NEW asset with governed provenance. Growth
 * identity is deliberately not inherited, so history cannot cross a tenant.
 */
export function copyAgentAssetToEnterprise(params: {
  store: AgentRegistryStore;
  source: AgentRef;
  targetEnterpriseId: string;
  agentSlug: string;
  nowIso: string;
}): AgentAsset {
  const source = findAgentAsset(params.store, params.source);
  if (!source) {
    throw new AgentRegistryError("ASSET_NOT_FOUND", "Source agent asset not found.");
  }
  const targetEnterpriseId = requireEnterpriseId(params.targetEnterpriseId);
  if (targetEnterpriseId === source.enterpriseId) {
    throw new AgentRegistryError(
      "CROSS_ENTERPRISE_FORBIDDEN",
      "Use createAgentAsset for a copy inside the same enterprise.",
    );
  }
  return createAgentAsset({
    store: params.store,
    enterpriseId: targetEnterpriseId,
    agentSlug: params.agentSlug,
    displayName: source.displayName,
    nowIso: params.nowIso,
    ...(source.agentDefinitionId ? { agentDefinitionId: source.agentDefinitionId } : {}),
    copiedFrom: { enterpriseId: source.enterpriseId, agentAssetId: source.agentAssetId },
  });
}

/** Moving an asset between enterprises is never allowed. */
export function assertNoCrossEnterpriseTransfer(asset: AgentAsset, enterpriseId: string): void {
  if (asset.enterpriseId !== enterpriseId) {
    throw new AgentRegistryError(
      "CROSS_ENTERPRISE_FORBIDDEN",
      "An agent asset cannot be transferred across enterprises.",
    );
  }
}

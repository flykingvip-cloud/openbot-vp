/**
 * Prove an agent or collaboration group belongs to the caller tenant
 * before a pause or per-agent budget is stored.
 */
import { getAgent } from "../agent-runtime-store.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning/space-store.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import type { AssetControlType } from "./tenant-controls-store.js";

export type AssetLookup =
  | { status: "found" }
  | { status: "not_found" }
  | { status: "tenant_mismatch" }
  | { status: "unavailable"; message: string };

async function lookupAgent(tenantId: string, assetId: string): Promise<AssetLookup> {
  const store = await loadSeatAssetsStoreForTenantId(tenantId);
  const inSeat = Object.values(store.seats).some(
    (seat) => seat.tenantId === tenantId && seat.defaultAgentAssetIds.includes(assetId),
  );
  const inBinding = Object.values(store.assetBindings).some(
    (binding) =>
      binding.tenantId === tenantId &&
      binding.assetType === "agent" &&
      binding.assetId === assetId &&
      binding.status === "active",
  );
  if (inSeat || inBinding) {
    return { status: "found" };
  }
  const agent = getAgent(assetId);
  if (!agent) {
    return { status: "not_found" };
  }
  if (agent.tenantCoverage.includes(tenantId)) {
    return { status: "found" };
  }
  if (agent.tenantCoverage.length > 0) {
    return { status: "tenant_mismatch" };
  }
  return { status: "not_found" };
}

async function lookupGroup(tenantId: string, assetId: string): Promise<AssetLookup> {
  const listed = await listGatewayCollaborationSpaces();
  const space = listed.spaces.find((entry) => entry.groupId === assetId);
  if (!space) {
    return { status: "not_found" };
  }
  if (space.tenantId && space.tenantId !== tenantId) {
    return { status: "tenant_mismatch" };
  }
  if (space.tenantId === tenantId) {
    return { status: "found" };
  }
  return { status: "not_found" };
}

export async function lookupEnterpriseAsset(params: {
  tenantId: string;
  assetType: AssetControlType;
  assetId: string;
}): Promise<AssetLookup> {
  try {
    if (params.assetType === "agent") {
      return await lookupAgent(params.tenantId, params.assetId);
    }
    return await lookupGroup(params.tenantId, params.assetId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "asset lookup failed";
    return { status: "unavailable", message };
  }
}

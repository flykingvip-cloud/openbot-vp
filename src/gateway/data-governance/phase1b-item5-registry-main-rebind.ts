/**
 * Item 5: rebind registry main asset to a membership owner derived from the
 * ended seat binding + current seat occupancy + platform-auth membership.
 * Does not invent owners. Does not flip wiredToProductionResolver.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listOwnerBindingHistory, setPrimaryOwner } from "../agent-registry/ownership.js";
import {
  loadAgentRegistryStore,
  saveAgentRegistryStore,
  resolveAgentRegistryStorePath,
} from "../agent-registry/store.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { resolveLegacyAgentAssetId } from "../workspace-ownership/classify-registry.js";
import {
  buildClassifiedCatalogRecord,
  type AuthorityCandidateRow,
} from "./phase1b-classified-persist.js";
import { hashOpaqueId } from "./phase1b-item5-candidate-utils.js";
import { persistUserOwnedHostCatalogRows } from "./phase1b-runtime-catalog-persist.js";

export const ITEM5_DEPLOY_EXECUTION_DECISION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-decision.json",
);

export type DeployExecutionDecision = {
  deployExecution: "authorized" | "not-authorized";
  path: string;
  executed: boolean;
  deployAuthorized: boolean;
  productionContainerWrite: boolean;
  registryMainRebind: boolean;
  wiredToProductionResolver: boolean;
  live: string;
};

export function loadDeployExecutionDecision(
  filePath: string = ITEM5_DEPLOY_EXECUTION_DECISION_PATH,
): DeployExecutionDecision {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as DeployExecutionDecision;
}

export function assertDeployExecutionAuthorized(
  decision: DeployExecutionDecision = loadDeployExecutionDecision(),
): void {
  if (decision.deployExecution !== "authorized") {
    throw new Error("deploy_execution_not_authorized");
  }
  if (decision.path !== "authorize-production-container-write-and-registry-main-rebind") {
    throw new Error("deploy_execution_path_forbidden");
  }
  if (!decision.deployAuthorized) {
    throw new Error("deploy_execution_requires_deploy_authorized");
  }
  if (!decision.productionContainerWrite) {
    throw new Error("deploy_execution_requires_production_container_write_flag");
  }
  if (!decision.registryMainRebind) {
    throw new Error("deploy_execution_requires_registry_main_rebind");
  }
  if (decision.wiredToProductionResolver) {
    throw new Error("deploy_execution_must_not_flip_wire");
  }
}

export type MainMembershipRebindDerivation = {
  tenantId: string;
  agentAssetId: string;
  userId: string;
  seatId: string;
  proof: "historical_seat_binding_occupancy_membership";
  hashedUserId: string;
  hashedSeatId: string;
};

export function deriveMainAssetMembershipRebind(params: {
  store: AgentRegistryStore;
  memberships: Array<{ userId?: string; enterpriseId?: string }>;
  seatOccupants: Array<{ seatId?: string; userId?: string; enterpriseId?: string }>;
}): MainMembershipRebindDerivation | null {
  const membershipKeys = new Set(
    params.memberships
      .filter((row) => row.userId?.trim() && row.enterpriseId?.trim())
      .map((row) => `${row.enterpriseId!.trim()}:${row.userId!.trim()}`),
  );
  const occupantBySeat = new Map<string, { userId: string; tenantId: string }>();
  for (const row of params.seatOccupants) {
    const seatId = row.seatId?.trim() ?? "";
    const userId = row.userId?.trim() ?? "";
    const tenantId = row.enterpriseId?.trim() ?? "";
    if (!seatId || !userId || !tenantId) {
      continue;
    }
    occupantBySeat.set(seatId, { userId, tenantId });
  }

  for (const asset of Object.values(params.store.assets)) {
    if (asset.legacyAgentId?.trim() !== "main") {
      continue;
    }
    const tenantId = asset.enterpriseId.trim();
    const agentAssetId = asset.agentAssetId.trim();
    if (!tenantId || !agentAssetId) {
      continue;
    }
    const history = listOwnerBindingHistory(params.store, { enterpriseId: tenantId, agentAssetId });
    const endedSeat = history.find(
      (binding) =>
        binding.ownerType === "seat" && binding.endedAt && binding.endedReason === "asset_archived",
    );
    if (!endedSeat) {
      continue;
    }
    const seatId = endedSeat.ownerId.trim();
    const occupant = occupantBySeat.get(seatId);
    if (!occupant || occupant.tenantId !== tenantId) {
      continue;
    }
    if (!membershipKeys.has(`${tenantId}:${occupant.userId}`)) {
      continue;
    }
    return {
      tenantId,
      agentAssetId,
      userId: occupant.userId,
      seatId,
      proof: "historical_seat_binding_occupancy_membership",
      hashedUserId: hashOpaqueId(occupant.userId),
      hashedSeatId: hashOpaqueId(seatId),
    };
  }
  return null;
}

export function buildMainAssetCatalogCandidate(
  derivation: MainMembershipRebindDerivation,
): AuthorityCandidateRow {
  return {
    resourceId: `ws:${derivation.tenantId}:user:${derivation.userId}:asset:${derivation.agentAssetId}`,
    classification: "classified",
    workspaceKind: "agent_primary",
    tenantId: derivation.tenantId,
    userId: derivation.userId,
    ownerType: "membership",
    agentAssetId: derivation.agentAssetId,
  };
}

export type RegistryMainRebindResult = {
  derivation: MainMembershipRebindDerivation;
  assetReactivated: boolean;
  membershipBindingCreated: boolean;
  catalogCandidate: AuthorityCandidateRow;
  registryStorePath: string;
  wiredToProductionResolver: false;
  item5: "not-met";
};

export async function executeRegistryMainMembershipRebind(params?: {
  store?: AgentRegistryStore;
  storePath?: string;
  memberships?: Array<{ userId?: string; enterpriseId?: string }>;
  seatOccupants?: Array<{ seatId?: string; userId?: string; enterpriseId?: string }>;
  now?: string;
}): Promise<RegistryMainRebindResult> {
  assertDeployExecutionAuthorized();
  const storePath = params?.storePath ?? resolveAgentRegistryStorePath();
  const store = params?.store ?? (await loadAgentRegistryStore(storePath));
  const derivation = deriveMainAssetMembershipRebind({
    store,
    memberships: params?.memberships ?? [],
    seatOccupants: params?.seatOccupants ?? [],
  });
  if (!derivation) {
    throw new Error("main_asset_membership_rebind_derivation_missing");
  }

  const asset = Object.values(store.assets).find(
    (row) =>
      row.agentAssetId === derivation.agentAssetId && row.enterpriseId === derivation.tenantId,
  );
  if (!asset) {
    throw new Error("main_asset_not_found_in_registry");
  }
  const resolved = resolveLegacyAgentAssetId({
    store,
    tenantId: derivation.tenantId,
    agentId: "main",
  });
  if (resolved.kind !== "resolved" || resolved.agentAssetId !== derivation.agentAssetId) {
    throw new Error("main_asset_legacy_mapping_mismatch");
  }

  const now = params?.now ?? new Date().toISOString();
  const wasArchived = asset.status === "archived";
  if (asset.status !== "active") {
    asset.status = "active";
    asset.updatedAt = now;
  }
  setPrimaryOwner({
    store,
    ref: { enterpriseId: derivation.tenantId, agentAssetId: derivation.agentAssetId },
    ownerType: "membership",
    ownerId: derivation.userId,
    nowIso: now,
  });
  await saveAgentRegistryStore(store, storePath);

  return {
    derivation,
    assetReactivated: wasArchived,
    membershipBindingCreated: true,
    catalogCandidate: buildMainAssetCatalogCandidate(derivation),
    registryStorePath: storePath,
    wiredToProductionResolver: false,
    item5: "not-met",
  };
}

export async function persistMainAssetCatalogRow(params: {
  stateDir: string;
  derivation: MainMembershipRebindDerivation;
  now?: string;
}): Promise<{ persisted: number; compareAndPutConfirmed: number }> {
  assertDeployExecutionAuthorized();
  const now = params.now ?? new Date().toISOString();
  const candidate = buildMainAssetCatalogCandidate(params.derivation);
  const record = buildClassifiedCatalogRecord(candidate, now);
  const result = await persistUserOwnedHostCatalogRows({
    stateDir: params.stateDir,
    records: [record],
    now,
  });
  return {
    persisted: result.persisted.length,
    compareAndPutConfirmed: result.compareAndPutConfirmed.length,
  };
}

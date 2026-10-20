/**
 * Item 5: deploy-authorized production execution with unified state target.
 * All prechecks run before any registry or Catalog write.
 */
import path from "node:path";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import type { AuthorityCandidateRow } from "./phase1b-classified-persist.js";
import {
  assertProductionDeployTargetFilesystemReady,
  classifyProductionWriteTargetError,
  resolveProductionDeployTarget,
  type ProductionDeployTarget,
  type ProductionWriteTargetErrorCode,
} from "./phase1b-item5-deploy-production-target.js";
import {
  executeAuthorizedProductionContainerWrite,
  type ProductionContainerWriteResult,
} from "./phase1b-item5-production-container-write.js";
import {
  assertDeployExecutionAuthorized,
  deriveMainAssetMembershipRebind,
  executeRegistryMainMembershipRebind,
  loadDeployExecutionDecision,
  type MainMembershipRebindDerivation,
  type RegistryMainRebindResult,
} from "./phase1b-item5-registry-main-rebind.js";

export type DeploySeatOccupant = {
  seatId?: string;
  userId?: string;
  enterpriseId?: string;
};

export function normalizeDeployOccupants(dump: {
  seatOccupants?: DeploySeatOccupant[];
  seatOccupancies?: DeploySeatOccupant[];
}): DeploySeatOccupant[] {
  if (Array.isArray(dump.seatOccupants) && dump.seatOccupants.length > 0) {
    return dump.seatOccupants;
  }
  return Array.isArray(dump.seatOccupancies) ? dump.seatOccupancies : [];
}

export function isUnredactedDeployDump(dump: {
  identifierPolicy?: string;
  gitWrite?: boolean;
}): boolean {
  return (
    (dump.identifierPolicy === "unredacted-memory-only" ||
      dump.identifierPolicy === "in-memory-unredacted") &&
    dump.gitWrite !== true
  );
}

export type DeployExecutionPreflight = {
  target: ProductionDeployTarget;
  derivation: MainMembershipRebindDerivation;
};

export async function preflightAuthorizedDeployExecution(params: {
  memberships: Array<{ userId?: string; enterpriseId?: string }>;
  seatOccupants?: DeploySeatOccupant[];
  seatOccupancies?: DeploySeatOccupant[];
  env?: NodeJS.ProcessEnv;
}): Promise<DeployExecutionPreflight> {
  assertDeployExecutionAuthorized(loadDeployExecutionDecision());
  const target = resolveProductionDeployTarget(params.env);
  assertProductionDeployTargetFilesystemReady(target);

  const store = await loadAgentRegistryStore(target.registryStorePath);
  const seatOccupants = normalizeDeployOccupants(params);
  const derivation = deriveMainAssetMembershipRebind({
    store,
    memberships: params.memberships,
    seatOccupants,
  });
  if (!derivation) {
    throw new Error("main_asset_membership_rebind_derivation_missing");
  }

  return { target, derivation };
}

export type DeployExecutionResult = {
  target: ProductionDeployTarget;
  registryMainRebind: RegistryMainRebindResult;
  productionContainerWrite: ProductionContainerWriteResult;
  wiredToProductionResolver: false;
  item5: "not-met";
};

export async function executeAuthorizedDeployProduction(params: {
  candidates: AuthorityCandidateRow[];
  memberships: Array<{ userId?: string; enterpriseId?: string }>;
  seatOccupants?: DeploySeatOccupant[];
  seatOccupancies?: DeploySeatOccupant[];
  env?: NodeJS.ProcessEnv;
  now?: string;
}): Promise<DeployExecutionResult> {
  const seatOccupants = normalizeDeployOccupants(params);
  const preflight = await preflightAuthorizedDeployExecution({
    memberships: params.memberships,
    seatOccupants,
    env: params.env,
  });

  const rebind = await executeRegistryMainMembershipRebind({
    storePath: preflight.target.registryStorePath,
    memberships: params.memberships,
    seatOccupants,
    now: params.now,
  });

  if (path.dirname(rebind.registryStorePath) !== preflight.target.stateDir) {
    throw new Error("production_registry_catalog_state_dir_inconsistent");
  }

  const catalog = await executeAuthorizedProductionContainerWrite({
    candidates: params.candidates,
    mainDerivation: rebind.derivation,
    deployTarget: preflight.target,
    now: params.now,
    env: params.env,
  });

  return {
    target: preflight.target,
    registryMainRebind: rebind,
    productionContainerWrite: catalog,
    wiredToProductionResolver: false,
    item5: "not-met",
  };
}

export type DeployExecutionBlocked = {
  status: "blocked";
  code:
    | ProductionWriteTargetErrorCode
    | "unknown"
    | "main_asset_membership_rebind_derivation_missing";
  message: string;
  productionTargetConfigured: boolean;
};

export function blockedDeployExecution(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env,
): DeployExecutionBlocked {
  const envConfigured = Boolean(env.OPENBOT_PRODUCTION_STATE_DIR?.trim());
  if (
    error instanceof Error &&
    error.message === "main_asset_membership_rebind_derivation_missing"
  ) {
    return {
      status: "blocked",
      code: "main_asset_membership_rebind_derivation_missing",
      message: error.message,
      productionTargetConfigured: envConfigured,
    };
  }
  const code = classifyProductionWriteTargetError(error);
  return {
    status: "blocked",
    code,
    message: error instanceof Error ? error.message : "deploy_execution_blocked",
    productionTargetConfigured: envConfigured,
  };
}

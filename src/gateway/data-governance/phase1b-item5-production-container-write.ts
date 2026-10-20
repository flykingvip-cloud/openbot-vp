/**
 * Item 5: authorized production container Catalog write.
 * Requires deployAuthorized=true and explicit production deploy target.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import {
  buildClassifiedCatalogRecord,
  type AuthorityCandidateRow,
} from "./phase1b-classified-persist.js";
import { isUserOwnedAgentPrimaryCandidate } from "./phase1b-item5-candidate-utils.js";
import {
  PRODUCTION_STATE_DIR_ENV,
  resolveProductionDeployTarget,
  type ProductionDeployTarget,
} from "./phase1b-item5-deploy-production-target.js";
import {
  assertDeployExecutionAuthorized,
  buildMainAssetCatalogCandidate,
  type MainMembershipRebindDerivation,
} from "./phase1b-item5-registry-main-rebind.js";
import { persistUserOwnedHostCatalogRows } from "./phase1b-runtime-catalog-persist.js";

export {
  PRODUCTION_STATE_DIR_ENV,
  inspectProductionWriteTarget,
  productionWriteTargetReachable,
  resolveProductionDeployTarget,
  assertProductionStateDirNotLocalHost,
  resolveProductionWriteTarget,
  ProductionWriteTargetError,
  classifyProductionWriteTargetError,
} from "./phase1b-item5-deploy-production-target.js";

export type ProductionWriteTarget = { kind: "state_dir"; stateDir: string };

export type ProductionContainerWriteResult = {
  target: "production_state_dir";
  persisted: number;
  compareAndPutConfirmed: number;
  catalogPresent: boolean;
  productionContainerWrite: true;
  wiredToProductionResolver: false;
  item5: "not-met";
};

export async function executeAuthorizedProductionContainerWrite(params: {
  candidates: AuthorityCandidateRow[];
  mainDerivation?: MainMembershipRebindDerivation;
  target?: ProductionWriteTarget;
  deployTarget?: ProductionDeployTarget;
  now?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProductionContainerWriteResult> {
  assertDeployExecutionAuthorized();
  const now = params.now ?? new Date().toISOString();
  const deployTarget =
    params.deployTarget ??
    (params.target
      ? {
          stateDir: params.target.stateDir,
          registryStorePath: path.join(params.target.stateDir, "openbot-agent-registry.json"),
          catalogPath: resolveDataGovernanceCatalogPath(params.target.stateDir),
        }
      : resolveProductionDeployTarget(params.env));
  const merged = [...params.candidates];
  if (params.mainDerivation) {
    merged.push(buildMainAssetCatalogCandidate(params.mainDerivation));
  }
  const userOwned = merged.filter(isUserOwnedAgentPrimaryCandidate);
  if (userOwned.length === 0) {
    throw new Error("production_write_zero_user_owned_candidates");
  }

  fs.mkdirSync(path.dirname(deployTarget.catalogPath), { recursive: true });
  const records = userOwned.map((row) => buildClassifiedCatalogRecord(row, now));
  const result = await persistUserOwnedHostCatalogRows({
    stateDir: deployTarget.stateDir,
    records,
    now,
  });
  return {
    target: "production_state_dir",
    persisted: result.persisted.length,
    compareAndPutConfirmed: result.compareAndPutConfirmed.length,
    catalogPresent: fs.existsSync(deployTarget.catalogPath),
    productionContainerWrite: true,
    wiredToProductionResolver: false,
    item5: "not-met",
  };
}

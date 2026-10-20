#!/usr/bin/env bun
/**
 * Execute deploy-authorized registry main rebind + production Catalog write.
 * Requires OPENBOT_PRODUCTION_STATE_DIR + OPENBOT_PRODUCTION_EXECUTION_MODE=production.
 */
import fs from "node:fs";
import path from "node:path";
import {
  blockedDeployExecution,
  executeAuthorizedDeployProduction,
  isUnredactedDeployDump,
  normalizeDeployOccupants,
  preflightAuthorizedDeployExecution,
} from "../../../src/gateway/data-governance/phase1b-item5-deploy-execution.ts";
import { resetSharedDataGovernanceCatalogForTests } from "../../../src/gateway/data-governance/runtime-catalog.ts";
import { extractAuthorityCandidate } from "./memory-workspace-phase1b-authority-extract.mjs";
import {
  buildProductionAuthorityDump,
  collectLocalAuthorityStores,
} from "./memory-workspace-phase1b-production-authority-dump.mjs";

const DIR = path.dirname(import.meta.filename);
const OUTPUT = path.join(DIR, "memory-workspace-phase1b-item5-deploy-execution.json");
const DECISION = path.join(DIR, "memory-workspace-phase1b-item5-deploy-execution-decision.json");

resetSharedDataGovernanceCatalogForTests();
const local = collectLocalAuthorityStores();
const dump = buildProductionAuthorityDump(local, { opaque: false });
if (!isUnredactedDeployDump(dump)) {
  throw new Error("deploy_execution_unredacted_dump_must_not_be_git_writable");
}
const extracted = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });
const seatOccupants = normalizeDeployOccupants(dump);

let production:
  | {
      status: "executed";
      target: string;
      stateDir: string;
      registryStorePath: string;
      catalogPath: string;
      persisted: number;
      compareAndPutConfirmed: number;
      catalogPresent: boolean;
      registryMainRebind: {
        assetReactivated: boolean;
        membershipBindingCreated: boolean;
        proof: string;
        hashedUserId: string;
        hashedSeatId: string;
      };
    }
  | {
      status: "blocked";
      code: string;
      reason: string;
      productionTargetConfigured: boolean;
    };

try {
  await preflightAuthorizedDeployExecution({
    memberships: dump.memberships ?? [],
    seatOccupants,
  });
  const executed = await executeAuthorizedDeployProduction({
    candidates: extracted.candidates ?? [],
    memberships: dump.memberships ?? [],
    seatOccupants,
  });
  production = {
    status: "executed",
    target: executed.productionContainerWrite.target,
    stateDir: executed.target.stateDir,
    registryStorePath: executed.target.registryStorePath,
    catalogPath: executed.target.catalogPath,
    persisted: executed.productionContainerWrite.persisted,
    compareAndPutConfirmed: executed.productionContainerWrite.compareAndPutConfirmed,
    catalogPresent: executed.productionContainerWrite.catalogPresent,
    registryMainRebind: {
      assetReactivated: executed.registryMainRebind.assetReactivated,
      membershipBindingCreated: executed.registryMainRebind.membershipBindingCreated,
      proof: executed.registryMainRebind.derivation.proof,
      hashedUserId: executed.registryMainRebind.derivation.hashedUserId,
      hashedSeatId: executed.registryMainRebind.derivation.hashedSeatId,
    },
  };
} catch (error) {
  const blocked = blockedDeployExecution(error);
  production = {
    status: "blocked",
    code: blocked.code,
    reason: blocked.message,
    productionTargetConfigured: blocked.productionTargetConfigured,
  };
}

const packet = {
  schema: "memory-workspace-phase1b-item5-deploy-execution/v2",
  item: 5,
  status: "not-met",
  owner: "cursor-data-governance",
  path: "authorize-production-container-write-and-registry-main-rebind",
  deployAuthorized: true,
  wiredToProductionResolver: false,
  identifierPolicy: "hashed",
  gitWrite: false,
  executed: {
    productionContainerWrite: production,
  },
  note: "Production deploy uses one explicit OPENBOT_PRODUCTION_STATE_DIR for registry and Catalog. Set OPENBOT_PRODUCTION_EXECUTION_MODE=production. On gateway host set OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1 when stateDir equals process resolveStateDir(). wiredToProductionResolver was not flipped. Item 5 stays not-met until production live traffic is measured independently.",
  explicitlyForbidden: [
    "set wiredToProductionResolver=true from this execution alone",
    "score item 5 met from this execution",
    "write unredacted identifiers into git",
  ],
};
const raw = JSON.stringify(packet);
if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw)) {
  throw new Error("deploy_execution_evidence_contains_uuid");
}
fs.writeFileSync(OUTPUT, `${JSON.stringify(packet, null, 2)}\n`);
const decision = JSON.parse(fs.readFileSync(DECISION, "utf8"));
decision.executed = production.status === "executed";
fs.writeFileSync(DECISION, `${JSON.stringify(decision, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
resetSharedDataGovernanceCatalogForTests();

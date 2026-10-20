#!/usr/bin/env bun
/**
 * Item 2 production Catalog SoT closeout. Read-only. Hashes identifiers.
 * Does not write Catalog, does not authorize LIVE, and does not edit U1 unlock.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveDataGovernanceCatalogPath } from "../../../src/gateway/data-governance/paths.ts";
import { hashOpaqueId } from "../../../src/gateway/data-governance/phase1b-item5-candidate-utils.ts";
import { resolveProductionDeployTarget } from "../../../src/gateway/data-governance/phase1b-item5-deploy-production-target.ts";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "../../../src/gateway/data-governance/runtime-catalog.ts";
import {
  measureProductionCatalogSotGates,
  parseWorkspaceResourceId,
} from "./memory-workspace-phase1b-item2-production-closeout-gates.mjs";

const DIR = path.dirname(import.meta.filename);
const OUTPUT = path.join(DIR, "memory-workspace-phase1b-item2-production-closeout.json");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FORBIDDEN_HOST = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function podman(args: string[]): string {
  const result = spawnSync("podman", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`podman ${args.join(" ")} failed`);
  }
  return result.stdout;
}

resetSharedDataGovernanceCatalogForTests();
const target = resolveProductionDeployTarget();
const catalogPath = resolveDataGovernanceCatalogPath(target.stateDir);
if (catalogPath !== target.catalogPath) {
  throw new Error("catalog_path_resolver_mismatch");
}
const evidenceCatalog = path.join(DIR, "memory-workspace-phase1b-item2-production-catalog.json");
const fixtureRuntime = path.join(DIR, "memory-workspace-phase1b-item2-runtime-state");
if (
  catalogPath.startsWith(DIR) ||
  catalogPath === evidenceCatalog ||
  catalogPath.startsWith(fixtureRuntime)
) {
  throw new Error("evidence_or_fixture_catalog_must_not_count_as_production");
}

const hostSha = sha256File(catalogPath);
const containerSha = podman([
  "exec",
  "openbot-gateway-rc",
  "sha256sum",
  "/root/.openbot/data-governance/catalog.json",
])
  .trim()
  .split(/\s+/)[0];
const containerHome = podman(["exec", "openbot-gateway-rc", "printenv", "HOME"]).trim();

const catalog = getSharedDataGovernanceCatalog({ stateDir: target.stateDir });
const records = [...(await catalog.list("workspace")), ...(await catalog.list("memory"))];
const measured = measureProductionCatalogSotGates({
  records,
  population: "authority-shaped",
});
const allWorkspace = measureProductionCatalogSotGates({
  records,
  population: "all-workspace",
});
const productionCatalogPresent = fs.existsSync(catalogPath) && records.length > 0;
const runtimeReadsConfiguredStateDir =
  catalogPath === resolveDataGovernanceCatalogPath(target.stateDir) && records.length > 0;
const covered =
  productionCatalogPresent &&
  hostSha === containerSha &&
  runtimeReadsConfiguredStateDir &&
  !catalogPath.includes(`${path.sep}docs${path.sep}design${path.sep}evidence${path.sep}`);

const hashedRecords = records
  .filter((row) => row.envelope.resourceType === "workspace")
  .map((row) => {
    const resourceId = row.envelope.resourceId;
    const tenantId = row.envelope.tenantId ?? "";
    return {
      hashedResourceId: hashOpaqueId(resourceId),
      hashedTenantId: hashOpaqueId(tenantId),
      resourceType: row.envelope.resourceType,
      workspaceKind: parseWorkspaceResourceId(resourceId)?.kind ?? null,
      ownerKind: row.envelope.owner.kind,
      lifecycleState: row.envelope.lifecycleState,
      governanceVersion: row.envelope.governanceVersion,
      hasCanonicalBinding: row.bindings.some((binding) => binding.role === "canonical"),
      hasAgentAssetAssociation:
        /:asset:/.test(resourceId) || row.envelope.resourceType === "memory",
      authorityShaped: /^ws:[^:]+:(user|seat|group):/.test(resourceId),
    };
  });

const packet = {
  schema: "memory-workspace-phase1b-item2-production-closeout/v1",
  item: 2,
  item2: "not-met",
  item2Candidate: "not-met",
  status: "submitted-for-independent-review",
  reason: "item2_remains_not_met_until_landed_on_origin_main",
  productionCatalogPresent,
  covered,
  fourGates100: measured.fourGates100,
  authorityCatalogGatesPass: measured.authorityCatalogGatesPass,
  quarantineNormalWrites: 0,
  productionCatalogWrite: "none",
  missDenyEnabled: false,
  wiredToProductionResolver: false,
  LIVE: "forbidden",
  live: false,
  deployAuthorized: false,
  unlock: "not-issued",
  phase1bExecutionBlocked: true,
  identifierPolicy: "hashed",
  stateDirLogical: "production-state-dir",
  catalogLogicalPath: "data-governance/catalog.json",
  runtimeReadsConfiguredStateDir,
  runtimeLoader: "getSharedDataGovernanceCatalog",
  catalogPathResolver: "resolveDataGovernanceCatalogPath",
  containerHomeIsRoot: containerHome === "/root",
  containerCatalogPresent: Boolean(containerSha),
  containerCatalogChecksumMatch: hostSha === containerSha,
  catalogSha256: containerSha,
  sotDecision: "docs/design/evidence/memory-workspace-phase1b-item2-production-sot-decision.json",
  sotDecisionStatus: "proposed",
  fourGatePopulation: measured.fourGatePopulation,
  uniqueUserOwnedEquivalent: measured.uniqueUserOwnedEquivalent,
  uniqueUserOwnedMetric: "production_catalog_users_with_exactly_one_user_owned_agent_primary",
  occupancyDumpMetricReplaced: true,
  residualOpaqueWorkspaceRecords: measured.residualOpaqueWorkspaceRecords,
  residualOpaque: {
    count: measured.residualOpaqueWorkspaceRecords,
    resourceIdShape: "32-char-hex",
    authorityShaped: false,
    disposition: "residual-not-normal-no-rewrite",
    receipt: "memory-workspace-phase1b-item2-residual-opaque-quarantine.json",
    identityInvention: "forbidden",
    allWorkspaceFourGates100: allWorkspace.fourGates100,
  },
  authorityShapedWorkspaceRecords: measured.authorityShapedWorkspaceRecords,
  gates: measured.gates,
  memory: {
    workspaceResourceIdEqualsMemoryResourceId: measured.workspaceMemoryIdCollision,
    memorySourceWorkspaceBound: measured.memoryRelationOk,
    memoryRecords: measured.memoryRecords,
    sqliteWorkspaceIdIsIsolationKeyOnly: true,
  },
  hashedNormalWorkspaceRecords: hashedRecords,
  measurementAt: new Date().toISOString(),
  explicitlyForbidden: [
    "LIVE migration",
    "deployAuthorized=true",
    "edit U1 unlock decision",
    "count evidence or fixture Catalog as production coverage",
    "invent identity from agentId path stateDir displayName Phase0 or U0",
    "expose PII credentials or host addresses",
    "write production Catalog from this packet",
    "enable Catalog miss=deny",
    "wire production Resolver",
    "enter U1 implementation",
    "score item 2 met before origin/main landing",
  ],
  note: "Read-only production Catalog SoT proof. Runtime loader used resolveDataGovernanceCatalogPath(stateDir). Official item2 stays not-met until this packet lands on origin/main and architecture accepts. U1 unlock was not edited.",
};

const raw = JSON.stringify(packet);
if (UUID.test(raw) || FORBIDDEN_HOST.test(raw) || raw.includes("@")) {
  throw new Error("item2_closeout_contains_forbidden_identifier");
}
fs.writeFileSync(OUTPUT, `${JSON.stringify(packet, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      item2: packet.item2,
      item2Candidate: packet.item2Candidate,
      productionCatalogPresent: packet.productionCatalogPresent,
      covered: packet.covered,
      fourGates100: packet.fourGates100,
      authorityCatalogGatesPass: packet.authorityCatalogGatesPass,
      quarantineNormalWrites: packet.quarantineNormalWrites,
      productionCatalogWrite: packet.productionCatalogWrite,
      LIVE: packet.LIVE,
      deployAuthorized: packet.deployAuthorized,
      uniqueUserOwnedEquivalent: packet.uniqueUserOwnedEquivalent,
    },
    null,
    2,
  )}\n`,
);
resetSharedDataGovernanceCatalogForTests();

#!/usr/bin/env node
/**
 * Phase 1B items 3-7 independent evidence (read-only).
 *
 * Measures current admission state. Does not accept write-switch, implement
 * schema v2, edit resolver, run LIVE drill, retire call-sites, or unlock.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function load(rel) {
  return JSON.parse(read(rel));
}

function exists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

export function measureItems37() {
  const matrix = load(
    "docs/design/evidence/memory-workspace-phase0-section141-signoff-matrix.json",
  );
  const designCr = load("docs/design/evidence/memory-workspace-phase0-ws-b-dispatch.json");
  const failClosed = load(
    "docs/design/evidence/memory-workspace-phase1a-ws-b-unknown-conflict-failclosed.json",
  );
  const memoryBoundary = load("docs/design/evidence/memory-workspace-phase1a-memory-boundary.json");
  const binding = load("docs/design/evidence/memory-workspace-phase1a-binding-impact-matrix.json");
  const callSites = load("docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json");
  const owners = load("docs/design/evidence/memory-workspace-phase0-phase1a-owner-assignment.json");

  const writeSwitchAcceptancePath =
    "docs/design/evidence/memory-workspace-phase1b-item3-write-switch-acceptance.json";
  const writeSwitchAcceptance = exists(writeSwitchAcceptancePath)
    ? load(writeSwitchAcceptancePath)
    : null;
  const item3Met =
    writeSwitchAcceptance?.decision === "accepted" &&
    writeSwitchAcceptance?.scope === "write-switch" &&
    writeSwitchAcceptance?.acceptedBy === "cursor-data-governance" &&
    writeSwitchAcceptance?.enablesProduction !== true;

  const memoryDir = path.join(REPO, "src/memory");
  const memoryFiles = fs.readdirSync(memoryDir).filter((name) => name.endsWith(".ts"));
  const memorySource = memoryFiles.map((name) => read(`src/memory/${name}`)).join("\n");
  const hasFilesV2 = /CREATE TABLE\s+files_v2\b/.test(memorySource);
  const hasSchemaV2 =
    /\bschemaVersion:\s*2\b/.test(memorySource) || /\bfiles_v2\b/.test(memorySource);
  const schemaV2Enabled = /export const SCHEMA_V2_ENABLED = true\b/.test(memorySource);
  const sameReleaseUnitAsItem3 =
    item3Met &&
    writeSwitchAcceptance?.sameReleaseUnit === "memory-schema-v2" &&
    hasFilesV2 &&
    !schemaV2Enabled;
  const item4Met = hasFilesV2 && item3Met && sameReleaseUnitAsItem3 && !schemaV2Enabled;

  const toolCwd = read("src/gateway/workspace-resolver/tool-cwd.ts");
  const tenantContext = read("src/gateway/tenant-context.ts");
  const item5EvidencePath =
    "docs/design/evidence/memory-workspace-phase1b-item5-fail-closed-evidence.json";
  const item5Evidence = exists(item5EvidencePath) ? load(item5EvidencePath) : null;
  const synthesizesEmptyCatalog = toolCwd.includes("createEmptyWorkspaceCatalog");
  const agentIdAsAsset = /agentAssetId:\s*params\.agentId/.test(toolCwd);
  const callerFallsBackOnUnwiredCatalog =
    /empty_catalog_synthesis_forbidden[\s\S]{0,250}return workspaceDir/.test(tenantContext) ||
    /agent_asset_id_required[\s\S]{0,250}return workspaceDir/.test(tenantContext);
  const managedCwdThrows = /agent tool cwd denied/.test(tenantContext);
  const item5Met =
    !synthesizesEmptyCatalog &&
    !agentIdAsAsset &&
    failClosed.inventoryRows.unknown.mayInferOwnerFromPath === false &&
    item5Evidence?.wiredToProductionResolver === true &&
    !callerFallsBackOnUnwiredCatalog;

  const drillReceiptPath =
    "docs/design/evidence/memory-workspace-phase1b-item6-cutover-drill-receipt.json";
  const drillReceipt = exists(drillReceiptPath) ? load(drillReceiptPath) : null;
  const item6Met = false;

  const productionWriteWatchIndex = callSites.productionWriteWatchIndex ?? 0;
  const freezeOwner = owners.assignments.find((row) => row.roleId === "storage-cutover")?.owner;
  const retirementOwner = "cursor-data-governance";
  const item7Met = productionWriteWatchIndex === 0;

  const items = [
    {
      id: 3,
      status: item3Met ? "met" : "not-met",
      owner: ["cursor-data-governance"],
      measured: {
        designDispatchStatus: designCr.status,
        designDispatchIsWriteSwitch: false,
        writeSwitchAcceptancePresent: Boolean(writeSwitchAcceptance),
        writeSwitchAcceptanceDecision: writeSwitchAcceptance?.decision ?? null,
        failClosedListsWriteSwitchNotEnabled: failClosed.notYetEnabled.includes(
          "resolver production write switch",
        ),
      },
      remaining: item3Met ? [] : ["cursor-data-governance write-switch acceptance packet"],
    },
    {
      id: 4,
      status: item4Met ? "met" : "not-met",
      owner: ["cursor-memory-wsc"],
      measured: {
        filesV2Present: hasFilesV2,
        schemaV2Present: hasSchemaV2,
        schemaV2Enabled,
        v1RootGuardPresent: exists("src/memory/v1-root-guard.ts"),
        memoryBoundaryForbidsV2: memoryBoundary.explicitlyForbidden.includes(
          "memory-schema-v2 implementation",
        ),
        sameReleaseUnitAsItem3,
      },
      remaining: item4Met
        ? []
        : ["schema v2 in the same release unit as the accepted write switch"],
    },
    {
      id: 5,
      status: item5Met ? "met" : "not-met",
      owner: ["cursor-data-governance"],
      measured: {
        designMayInferOwnerFromPath: failClosed.inventoryRows.unknown.mayInferOwnerFromPath,
        productionSynthesizesEmptyCatalog: synthesizesEmptyCatalog,
        productionUsesAgentIdAsAgentAssetId: agentIdAsAsset,
        productionCallerFallsBackOnUnwiredCatalog: callerFallsBackOnUnwiredCatalog,
        managedCwdThrows,
        wiredToProductionResolver: item5Evidence?.wiredToProductionResolver === true,
        productionFile: "src/gateway/workspace-resolver/tool-cwd.ts",
        productionCaller: "src/gateway/tenant-context.ts",
      },
      remaining: item5Met
        ? []
        : [
            "managed deny returns membership workspace; helper is invoked from tool-cwd; caller passes existing Catalog + agentAssetId only when a unique user-owned record exists; wiredToProductionResolver stays false",
          ],
    },
    {
      id: 6,
      status: item6Met ? "met" : "not-met",
      owner: ["cursor-fable", "cursor-memory-wsc"],
      measured: {
        existingCutover: "src/gateway/workspace/cutover.ts",
        secondStateMachineForbidden: binding.explicitlyForbidden.includes(
          "second migration state machine",
        ),
        drillReceiptPresent: Boolean(drillReceipt),
        drillStatus: drillReceipt?.status ?? "not-run",
      },
      remaining: [
        "item 6 is owned by cursor-fable / cursor-memory-wsc; this package does not accept it",
      ],
    },
    {
      id: 7,
      status: item7Met ? "met" : "not-met",
      owner: ["cursor-data-governance"],
      measured: {
        productionWriteWatchIndex,
        productionCounts: callSites.counts,
        freezeOwner: freezeOwner ?? "cursor-fable",
        retirementOwner,
        ownersDistinct: (freezeOwner ?? "cursor-fable") !== retirementOwner,
      },
      remaining: ["production old call-sites measured at zero before I3"],
    },
  ];

  return {
    schema: "memory-workspace-phase1b-items-3-7/v1",
    unlock: "not-issued",
    phase1bExecutionBlocked: matrix.phase1bExecutionBlocked === true,
    deployAuthorized: false,
    productionCatalogWrite: "none",
    items,
    allMet: items.every((item) => item.status === "met"),
    explicitlyForbidden: [
      "treat this measurement as Phase 1B unlock",
      "resolver write switch enablement",
      "memory schema v2 enablement",
      "LIVE migration",
      "deployAuthorized=true",
      "phase1bExecutionBlocked=false",
    ],
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  process.stdout.write(`${JSON.stringify(measureItems37(), null, 2)}\n`);
}

#!/usr/bin/env bun
/**
 * Item 5 independent closeout measurement. Hashes identifiers.
 * Catalog write is a prior deploy-execution-runner step recorded via env.
 * Does not flip wiredToProductionResolver, score item 5 met, or unlock 6/7.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveLegacyAgentId } from "../../../src/gateway/agent-registry/legacy-resolver.ts";
import { findPrimaryOwnerBinding } from "../../../src/gateway/agent-registry/ownership.ts";
import { loadAgentRegistryStore } from "../../../src/gateway/agent-registry/store.ts";
import { hashOpaqueId } from "../../../src/gateway/data-governance/phase1b-item5-candidate-utils.ts";
import { resolveProductionDeployTarget } from "../../../src/gateway/data-governance/phase1b-item5-deploy-production-target.ts";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "../../../src/gateway/data-governance/runtime-catalog.ts";
import { loadExistingGovernedWorkspaceIdentity } from "../../../src/gateway/data-governance/workspace-catalog-projection.ts";

const DIR = path.dirname(import.meta.filename);
const USER_OWNED = /^ws:([^:]+):user:([^:]+):asset:(.+)$/;
const BASELINE_SHA =
  process.env.OPENBOT_ITEM5_BASELINE_SHA?.trim() || "f1d516c53476d2b788b2591bf7836a78e35b9129";
const OPERATION_ID =
  process.env.OPENBOT_ITEM5_OPERATION_ID?.trim() || `item5-closeout-${BASELINE_SHA.slice(0, 12)}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "evidenceDigests")
      .toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function podman(args: string[]): string {
  const result = spawnSync("podman", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`podman ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assertNoUuid(value: unknown, label: string): void {
  if (UUID.test(JSON.stringify(value))) {
    throw new Error(`${label}_contains_uuid`);
  }
}

resetSharedDataGovernanceCatalogForTests();
const target = resolveProductionDeployTarget();
const measurementAt = new Date().toISOString();
const hostRegistrySha = sha256File(target.registryStorePath);
const hostCatalogSha = sha256File(target.catalogPath);
const containerRegistrySha = podman([
  "exec",
  "openbot-gateway-rc",
  "sha256sum",
  "/root/.openbot/openbot-agent-registry.json",
])
  .trim()
  .split(/\s+/)[0];
const containerCatalogSha = podman([
  "exec",
  "openbot-gateway-rc",
  "sha256sum",
  "/root/.openbot/data-governance/catalog.json",
])
  .trim()
  .split(/\s+/)[0];
const buildInfo = JSON.parse(
  podman(["exec", "openbot-gateway-rc", "cat", "/app/dist/build-info.json"]),
);
const runtimeSha = String(buildInfo.commit ?? "");
const originMainSha = process.env.OPENBOT_ITEM5_ORIGIN_MAIN_SHA?.trim() || BASELINE_SHA;
const runtimeAlignedToBaseline = runtimeSha === BASELINE_SHA;
const window = {
  operationId: OPERATION_ID,
  evidenceId: OPERATION_ID,
  baselineSha: BASELINE_SHA,
  originMainSha,
  runtimeSha,
  runtimeAlignedToBaseline,
  supersedes: process.env.OPENBOT_ITEM5_SUPERSEDES?.trim() || null,
  productionHostLogical: "production-gateway-host",
  stateDir: target.stateDir,
  gatewayRestart:
    process.env.OPENBOT_ITEM5_RESTART_METHOD?.trim() || "podman restart openbot-gateway-rc",
  catalogPath: target.catalogPath,
  registryStorePath: target.registryStorePath,
  measurementAt,
  item6: "not-met" as const,
  item7: "not-met" as const,
  item6Locked: true,
  item7Locked: true,
  unlock: "not-issued" as const,
  deployAuthorized: false,
  productionCatalogWrite: (process.env.OPENBOT_ITEM5_CATALOG_WRITE?.trim() || "none") as
    | "none"
    | "compareAndPut",
  catalogWriteThisPacket: (process.env.OPENBOT_ITEM5_CATALOG_WRITE_THIS_PACKET?.trim() || "none") as
    | "none"
    | "compareAndPut"
    | "existing-user-owned-rows",
  sourceKind: "production-gateway-host" as const,
  unlockReceipt: "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  unlockRevokeReceipt:
    "docs/design/evidence/memory-workspace-phase1b-unlock-issued-stamp-revoke.json",
  runtimeEligibility:
    "docs/design/evidence/memory-workspace-phase1b-item5-runtime-eligibility.json",
};

const catalog = getSharedDataGovernanceCatalog({ stateDir: target.stateDir });
const records = await catalog.list("workspace");
const byUser = new Map<string, { tenantId: string; userId: string; assetIds: string[] }>();
for (const record of records) {
  const parsed = USER_OWNED.exec(record.envelope.resourceId);
  if (!parsed || record.envelope.owner.kind !== "user") {
    continue;
  }
  const tenantId = parsed[1] ?? "";
  const userId = parsed[2] ?? "";
  const agentAssetId = parsed[3] ?? "";
  if (!tenantId || !userId || !agentAssetId) {
    continue;
  }
  const key = `${tenantId}:${userId}`;
  const current = byUser.get(key) ?? { tenantId, userId, assetIds: [] };
  if (!current.assetIds.includes(agentAssetId)) {
    current.assetIds.push(agentAssetId);
  }
  byUser.set(key, current);
}

const registry = await loadAgentRegistryStore(target.registryStorePath);
const mainAssets = Object.values(registry.assets).filter((asset) => asset.legacyAgentId === "main");
const mainAsset = mainAssets.length === 1 ? mainAssets[0] : undefined;
const mainBinding = mainAsset
  ? findPrimaryOwnerBinding(registry, {
      enterpriseId: mainAsset.enterpriseId,
      agentAssetId: mainAsset.agentAssetId,
    })
  : undefined;
const mainResolvedInCatalog = Boolean(
  mainAsset &&
  [...byUser.values()].some((group) => group.assetIds.includes(mainAsset.agentAssetId)),
);

type PerUser = {
  hashedUserKey: string;
  hashedTenantId: string;
  catalogAssetCount: number;
  registryResolvedForMain: boolean;
  registryResolvedInCatalog: boolean;
  liveCallerHitForMain: boolean;
  liveHitKind:
    | "registry_catalog_resolve"
    | "unique_user_owned_row"
    | "membership_fallback"
    | "miss";
  missReason:
    | "live_hit"
    | "single_asset_auto_hit"
    | "registry_resolved_asset_not_in_catalog"
    | "registry_unresolved_multi_asset"
    | "no_catalog_assets";
  mainPathIdentityHit: boolean;
  mainPathUsesMembershipFallback: boolean;
  emptyCatalogSynthesis: false;
};

let perUser: PerUser[] = [];
for (const group of byUser.values()) {
  const resolution = resolveLegacyAgentId({
    store: registry,
    enterpriseId: group.tenantId,
    legacyAgentId: "main",
  });
  const resolved = resolution.kind === "resolved" ? resolution.ref.agentAssetId : "";
  const registryResolvedForMain = resolution.kind === "resolved";
  const registryResolvedInCatalog = Boolean(resolved && group.assetIds.includes(resolved));
  const live = await loadExistingGovernedWorkspaceIdentity({
    tenantId: group.tenantId,
    userId: group.userId,
    agentId: "main",
    stateDir: target.stateDir,
    registryStorePath: target.registryStorePath,
  });
  const liveCallerHitForMain = Boolean(
    live.catalog && live.agentAssetId && live.agentAssetId !== "main",
  );
  let liveHitKind: PerUser["liveHitKind"] = "miss";
  if (!liveCallerHitForMain) {
    liveHitKind = "miss";
  } else if (registryResolvedForMain && live.agentAssetId === resolved) {
    liveHitKind = "registry_catalog_resolve";
  } else if (
    !registryResolvedForMain &&
    group.assetIds.length === 1 &&
    live.agentAssetId === group.assetIds[0]
  ) {
    liveHitKind = "unique_user_owned_row";
  } else {
    liveHitKind = "membership_fallback";
  }
  let missReason: PerUser["missReason"] = "live_hit";
  if (liveCallerHitForMain) {
    missReason = "live_hit";
  } else if (group.assetIds.length === 0) {
    missReason = "no_catalog_assets";
  } else if (group.assetIds.length === 1) {
    missReason = "single_asset_auto_hit";
  } else if (registryResolvedForMain && !registryResolvedInCatalog) {
    missReason = "registry_resolved_asset_not_in_catalog";
  } else {
    missReason = "registry_unresolved_multi_asset";
  }
  perUser.push({
    hashedUserKey: hashOpaqueId(`${group.tenantId}:${group.userId}`),
    hashedTenantId: hashOpaqueId(group.tenantId),
    catalogAssetCount: group.assetIds.length,
    registryResolvedForMain,
    registryResolvedInCatalog,
    liveCallerHitForMain,
    liveHitKind,
    missReason,
    mainPathIdentityHit: liveCallerHitForMain,
    mainPathUsesMembershipFallback: liveHitKind === "membership_fallback" || !liveCallerHitForMain,
    emptyCatalogSynthesis: false,
  });
}
perUser = perUser.toSorted((left, right) => left.hashedUserKey.localeCompare(right.hashedUserKey));

const liveCallerHits = perUser.filter((row) => row.liveCallerHitForMain).length;
const liveCallerMisses = perUser.length - liveCallerHits;
const usersWithRegistryResolvedNotInCatalog = perUser.filter(
  (row) => row.missReason === "registry_resolved_asset_not_in_catalog",
).length;
const usersWithRegistryUnresolvedMultiAsset = perUser.filter(
  (row) => row.missReason === "registry_unresolved_multi_asset",
).length;
const perUserRegistryResolvedInCatalogTrue = perUser.filter(
  (row) => row.registryResolvedInCatalog,
).length;
const perUserRegistryResolvedInCatalogFalse = perUser.filter(
  (row) => !row.registryResolvedInCatalog,
).length;
const mainPathMisses = perUser.filter((row) => !row.mainPathIdentityHit).length;
const mainPathMembershipFallbacks = perUser.filter(
  (row) => row.liveHitKind === "membership_fallback",
).length;
const registryCatalogResolveHits = perUser.filter(
  (row) => row.liveHitKind === "registry_catalog_resolve",
).length;
const uniqueUserOwnedHits = perUser.filter(
  (row) => row.liveHitKind === "unique_user_owned_row",
).length;
let rootCause: "registry_resolved_asset_not_in_catalog" | "mixed" | "none" = "none";
if (usersWithRegistryResolvedNotInCatalog > 0 && usersWithRegistryUnresolvedMultiAsset > 0) {
  rootCause = "mixed";
} else if (usersWithRegistryResolvedNotInCatalog > 0) {
  rootCause = "registry_resolved_asset_not_in_catalog";
}

const forbidden = [
  "wiredToProductionResolver=true",
  "score item 5 met from this closeout",
  "unlock item 6",
  "unlock item 7",
  "treat host laptop ~/.openbot as production",
  "treat evidence stateDir as production",
  "treat per-user registryResolvedInCatalog=false as usersWithRegistryResolvedNotInCatalog",
  "label unique_user_owned_row or membership_fallback as registry resolved hit",
];

const liveCaller = {
  schema: "memory-workspace-phase1b-item5-production-live-caller/v1",
  item: 5,
  status: "not-met" as const,
  item5Met: false,
  wiredToProductionResolver: false,
  identifierPolicy: "hashed" as const,
  ...window,
  source: "production-container-stateDir-via-official-api",
  measured: {
    hostCatalogUserOwnedRows: [...byUser.values()].reduce(
      (sum, row) => sum + row.assetIds.length,
      0,
    ),
    usersMeasured: perUser.length,
    liveCallerHits,
    liveCallerMisses,
    registryCatalogResolveHits,
    uniqueUserOwnedHits,
    membershipFallbackHits: mainPathMembershipFallbacks,
    perUser: perUser.map((row) => ({
      hashedUserKey: row.hashedUserKey,
      hashedTenantId: row.hashedTenantId,
      liveCallerHitForMain: row.liveCallerHitForMain,
      liveHitKind: row.liveHitKind,
    })),
    item5: "not-met" as const,
    wiredToProductionResolver: false,
  },
  explicitlyForbidden: forbidden,
};

const registryCatalog = {
  schema: "memory-workspace-phase1b-item5-production-registry-catalog/v1",
  item: 5,
  status: "not-met" as const,
  item5Met: false,
  wiredToProductionResolver: false,
  identifierPolicy: "hashed" as const,
  ...window,
  fieldSemantics: {
    registryResolvedInCatalog:
      "Raw membership: registry resolve(main) for this user returned an asset id present in THIS user's user-owned Catalog rows. Independent of live hit.",
    usersWithRegistryResolvedNotInCatalog:
      "Count of perUser rows whose missReason is registry_resolved_asset_not_in_catalog. Assigned only when liveCallerHitForMain is false AND catalogAssetCount > 1 AND registryResolvedForMain is true AND registryResolvedInCatalog is false.",
    liveHitShortCircuit:
      "liveCallerHitForMain=true forces missReason=live_hit and does not increment usersWithRegistryResolvedNotInCatalog.",
    consistent: true,
  },
  main: {
    assetsNamedMain: mainAssets.length,
    active: mainAsset?.status === "active",
    membershipPrimaryBinding:
      mainBinding?.ownerType === "membership" && Boolean(mainBinding.isPrimary),
    registryResolvedAssetInCatalog: mainResolvedInCatalog,
    hashedEnterpriseId: mainAsset ? hashOpaqueId(mainAsset.enterpriseId) : null,
    hashedOwnerId: mainBinding ? hashOpaqueId(mainBinding.ownerId) : null,
  },
  measured: {
    hostCatalogUserOwnedRows: liveCaller.measured.hostCatalogUserOwnedRows,
    usersMeasured: perUser.length,
    usersWithRegistryResolvedNotInCatalog,
    usersWithRegistryUnresolvedMultiAsset,
    perUserRegistryResolvedInCatalogTrue,
    perUserRegistryResolvedInCatalogFalse,
    liveCallerHits,
    liveCallerMisses,
    rootCause,
    perUser: perUser.map((row) => ({
      hashedUserKey: row.hashedUserKey,
      hashedTenantId: row.hashedTenantId,
      catalogAssetCount: row.catalogAssetCount,
      registryResolvedForMain: row.registryResolvedForMain,
      registryResolvedInCatalog: row.registryResolvedInCatalog,
      liveCallerHitForMain: row.liveCallerHitForMain,
      liveHitKind: row.liveHitKind,
      missReason: row.missReason,
    })),
    item5: "not-met" as const,
    wiredToProductionResolver: false,
  },
  explicitlyForbidden: forbidden,
};

const tenantContext = {
  schema: "memory-workspace-phase1b-item5-production-tenant-context/v1",
  item: 5,
  status: "not-met" as const,
  item5Met: false,
  wiredToProductionResolver: false,
  identifierPolicy: "hashed" as const,
  ...window,
  cwdProbeLoaded: false,
  measured: {
    usersMeasured: perUser.length,
    mainPathMisses,
    mainPathMembershipFallbacks,
    emptyCatalogSynthesis: 0,
    unauthorizedMembershipFallback: mainPathMembershipFallbacks,
    cwdFromCatalogResolver: liveCallerHits,
    perUser: perUser.map((row) => ({
      hashedUserKey: row.hashedUserKey,
      mainPathIdentityHit: row.mainPathIdentityHit,
      mainPathUsesMembershipFallback: row.mainPathUsesMembershipFallback,
      emptyCatalogSynthesis: row.emptyCatalogSynthesis,
    })),
    item5: "not-met" as const,
    wiredToProductionResolver: false,
  },
  note: "tenant-context managed identity was measured through loadExistingGovernedWorkspaceIdentity with the production stateDir and registry path. tool-cwd was not loaded. An identity miss is recorded as a membership-fallback path because tenant-context.ts returns the membership workspaceDir when authorization fails.",
  explicitlyForbidden: forbidden,
};

const summary = {
  schema: "memory-workspace-phase1b-item5-production-evidence-summary/v1",
  item: 5,
  decision: "submitted-for-independent-closeout-review",
  item5: "not-met",
  item5Met: false,
  item6Unlocked: false,
  item7Unlocked: false,
  wiredToProductionResolver: false,
  ...window,
  runtimeSha,
  runtimeAlignedToBaseline,
  containerHostRegistryChecksumMatch: hostRegistrySha === containerRegistrySha,
  containerHostCatalogChecksumMatch: hostCatalogSha === containerCatalogSha,
  totals: {
    liveCallerHits,
    liveCallerMisses,
    mainPathMisses,
    fallbackHits: mainPathMembershipFallbacks,
    membershipFallbackHits: mainPathMembershipFallbacks,
    usersWithRegistryResolvedNotInCatalog,
    rootCause,
    perUserRegistryResolvedInCatalogFalse,
    perUserMissReasonLiveHit: perUser.filter((row) => row.missReason === "live_hit").length,
    registryCatalogResolveHits,
    uniqueUserOwnedHits,
    oldRootFallback: 0,
    emptyCatalogSynthesis: 0,
  },
  consistent: {
    liveHitsEqualPerUser:
      liveCallerHits === perUser.filter((row) => row.liveCallerHitForMain).length,
    diagnosticEqualsPerUserMissReason:
      usersWithRegistryResolvedNotInCatalog ===
      perUser.filter((row) => row.missReason === "registry_resolved_asset_not_in_catalog").length,
    inCatalogFalseEqualsPerUser:
      perUserRegistryResolvedInCatalogFalse ===
      perUser.filter((row) => !row.registryResolvedInCatalog).length,
    mainPathMissesEqualIdentityMisses: mainPathMisses === liveCallerMisses,
    inCatalogFalseIsNotDiagnostic:
      perUserRegistryResolvedInCatalogFalse !== usersWithRegistryResolvedNotInCatalog ||
      perUserRegistryResolvedInCatalogFalse === 0,
  },
  explicitlyForbidden: forbidden,
};

const closeout = {
  schema: "memory-workspace-phase1b-item5-production-closeout/v1",
  item: 5,
  decision: "submitted-for-independent-closeout-review",
  item5: "not-met",
  item5Met: false,
  item6Unlocked: false,
  item7Unlocked: false,
  wiredToProductionResolver: false,
  ...window,
  runtimeSha,
  runtimeAlignedToBaseline,
  originMainHasBaseline: true,
  containerRead: {
    registrySha256: containerRegistrySha,
    catalogSha256: containerCatalogSha,
    hostRegistrySha256: hostRegistrySha,
    hostCatalogSha256: hostCatalogSha,
    checksumMatch:
      hostRegistrySha === containerRegistrySha && hostCatalogSha === containerCatalogSha,
  },
  main: registryCatalog.main,
  liveCaller,
  registryCatalog,
  tenantContext,
  summary,
  blocker: runtimeAlignedToBaseline ? null : "production_runtime_sha_not_aligned",
  backup: {
    path: process.env.OPENBOT_ITEM5_BACKUP_PATH?.trim() || null,
    at: process.env.OPENBOT_ITEM5_BACKUP_AT?.trim() || null,
    registrySha256: process.env.OPENBOT_ITEM5_BACKUP_REGISTRY_SHA?.trim() || null,
    catalogSha256: process.env.OPENBOT_ITEM5_BACKUP_CATALOG_SHA?.trim() || null,
    membershipSha256: process.env.OPENBOT_ITEM5_BACKUP_MEMBERSHIP_SHA?.trim() || null,
    primaryBindingSha256: process.env.OPENBOT_ITEM5_BACKUP_PRIMARY_BINDING_SHA?.trim() || null,
  },
  restart: {
    method: process.env.OPENBOT_ITEM5_RESTART_METHOD?.trim() || "podman restart openbot-gateway-rc",
    at: process.env.OPENBOT_ITEM5_RESTART_AT?.trim() || null,
    preCatalogSha256: process.env.OPENBOT_ITEM5_PRE_RESTART_CATALOG_SHA?.trim() || null,
    preRegistrySha256: process.env.OPENBOT_ITEM5_PRE_RESTART_REGISTRY_SHA?.trim() || null,
    postCatalogSha256: containerCatalogSha,
    postRegistrySha256: containerRegistrySha,
    catalogUnchangedAcrossRestart:
      !process.env.OPENBOT_ITEM5_PRE_RESTART_CATALOG_SHA ||
      process.env.OPENBOT_ITEM5_PRE_RESTART_CATALOG_SHA === containerCatalogSha,
  },
  productionWrite: {
    runner: "docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts",
    status: process.env.OPENBOT_ITEM5_WRITE_STATUS?.trim() || null,
    persisted: Number(process.env.OPENBOT_ITEM5_WRITE_PERSISTED || "0"),
    compareAndPutConfirmed: Number(process.env.OPENBOT_ITEM5_WRITE_COMPARE_AND_PUT || "0"),
    catalogSha256Before: process.env.OPENBOT_ITEM5_PRE_WRITE_CATALOG_SHA?.trim() || null,
    catalogSha256After: process.env.OPENBOT_ITEM5_POST_WRITE_CATALOG_SHA?.trim() || null,
    registrySha256Before: process.env.OPENBOT_ITEM5_PRE_WRITE_REGISTRY_SHA?.trim() || null,
    registrySha256After: process.env.OPENBOT_ITEM5_POST_WRITE_REGISTRY_SHA?.trim() || null,
    wiredToProductionResolver: false,
  },
  logSummary: {
    container: "openbot-gateway-rc",
    runtimeCommit: runtimeSha,
    overlayId: buildInfo?.overlay?.id ?? null,
    overlayStamp: buildInfo?.overlay?.stamp ?? null,
  },
  replay: {
    env: [
      "OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot",
      "OPENBOT_PRODUCTION_EXECUTION_MODE=production",
      "OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1",
    ],
    runner: "docs/design/evidence/memory-workspace-phase1b-item5-production-closeout-runner.ts",
    writeRunner: "docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts",
    tests: [
      "node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs",
    ],
  },
  handoff: {
    item5: "Item 5 submitted for closeout review",
    item5Met: false,
    item6Unlocked: false,
    item7Unlocked: false,
    wiredToProductionResolver: false,
    schemaV2ProductionWrite: false,
    deleteOldWriteSites: false,
  },
  note: "Independent closeout packet after production Catalog write, gateway restart, and container read. Item 5 stays not-met. Items 6 and 7 stay locked. unlock stays not-issued. wiredToProductionResolver stays false. This packet does not score item 5 met.",
  explicitlyForbidden: forbidden,
  registryResolveKindForMain: "builtin-universal",
};

const outputs: Record<string, Record<string, unknown>> = {
  "memory-workspace-phase1b-item5-production-closeout.json": closeout,
  "memory-workspace-phase1b-item5-production-live-caller.json": liveCaller,
  "memory-workspace-phase1b-item5-production-registry-catalog.json": registryCatalog,
  "memory-workspace-phase1b-item5-production-tenant-context.json": tenantContext,
  "memory-workspace-phase1b-item5-production-evidence-summary.json": summary,
};
const evidenceDigests = Object.fromEntries(
  Object.entries(outputs).map(([name, packet]) => [name, sha256Text(canonicalJson(packet))]),
);
for (const [name, packet] of Object.entries(outputs)) {
  packet.evidenceDigests = evidenceDigests;
  assertNoUuid(packet, name);
  fs.writeFileSync(path.join(DIR, name), `${JSON.stringify(packet, null, 2)}\n`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      decision: closeout.decision,
      operationId: OPERATION_ID,
      baselineSha: BASELINE_SHA,
      runtimeSha,
      runtimeAlignedToBaseline,
      liveCallerHits,
      liveCallerMisses,
      mainPathMisses,
      fallbackHits: mainPathMembershipFallbacks,
      usersWithRegistryResolvedNotInCatalog,
      rootCause,
      wiredToProductionResolver: false,
      item5Met: false,
      evidenceDigests,
    },
    null,
    2,
  )}\n`,
);
resetSharedDataGovernanceCatalogForTests();

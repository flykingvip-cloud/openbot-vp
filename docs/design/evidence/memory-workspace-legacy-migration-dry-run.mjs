#!/usr/bin/env node --no-warnings
/**
 * Legacy data migration inventory + dry-run simulator.
 *
 * READ-ONLY. Reads committed evidence in the repo tree. Never writes Catalog,
 * never moves/deletes/modifies production files, never mints bindings.
 *
 *   node docs/design/evidence/memory-workspace-legacy-migration-dry-run.mjs
 *
 * Stdout: JSON packet + manifests. No filesystem writes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TASK_ID =
  "memory-workspace-platform-remediation:kiro-data-governance-legacy-migration-dry-run";
export const OWNER = "kiro-data-governance";
export const ORIGIN_MAIN = "61c3cb90e4199ee765089631ea5fb70f8ba12652";
export const SCHEMA = "memory-workspace-legacy-migration-dry-run/v1";
export const REQUIRED_DOMAINS = [
  "workspace",
  "agent",
  "memory",
  "knowledge",
  "conversationArchive",
  "knownLegacyRoot",
  "compatibilityBinding",
];

const CATALOG_CANDIDATE =
  "docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json";
const LIVE_SUMMARY = "docs/design/evidence/memory-workspace-phase0-live-20260814.summary.json";
const RETIREMENT_SCAN = "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json";

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value), null, 2) + "\n";
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).toSorted()) {
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}

export function parseResourceId(resourceId) {
  if (!resourceId || typeof resourceId !== "string") {
    return {
      tenantId: null,
      ownerScope: "unknown",
      ownerId: null,
      agentAssetId: null,
    };
  }
  const parts = resourceId.split(":");
  const tenantId = parts[1] && parts[1] !== "unknown" ? parts[1] : parts[1] || null;
  let ownerScope = "unknown";
  let ownerId = null;
  let agentAssetId = null;
  if (parts[2] === "user" || parts[2] === "seat" || parts[2] === "group") {
    ownerScope = parts[2];
    ownerId = parts[3] && parts[3] !== "unknown" ? parts[3] : null;
    if (parts[4] === "asset" && parts[5]) {
      agentAssetId = parts[5];
    }
  } else if (parts[2] === "unknown") {
    ownerScope = "unknown";
    ownerId = null;
  }
  return { tenantId: tenantId || null, ownerScope, ownerId, agentAssetId };
}

export function detectCrossTenant(resourceId, locator) {
  const parsed = parseResourceId(resourceId);
  const match = String(locator ?? "").match(/tenants\/([^/]+)\//);
  if (!parsed.tenantId || !match) {
    return false;
  }
  const locTenant = match[1];
  if (
    locTenant === "<tid>" ||
    locTenant === "<tenantId>" ||
    locTenant === "<id>" ||
    parsed.tenantId === "host" ||
    parsed.tenantId === "unknown"
  ) {
    return false;
  }
  return locTenant !== parsed.tenantId;
}

export function decideMigration(record, ctx) {
  const legalHold =
    record.legalHold === true ||
    record.retention === true ||
    record.tombstone === true ||
    record.lifecycle === "legal_hold" ||
    record.lifecycle === "tombstone" ||
    record.lifecycle === "retention";
  if (legalHold) {
    return {
      migrationDecision: "preserve",
      blocker: "legal-hold-or-retention-or-tombstone",
    };
  }

  const unknownOwner =
    record.classification !== "classified" ||
    !record.ownerId ||
    record.ownerScope === "unknown" ||
    record.ownerId === "unknown";
  if (unknownOwner) {
    return { migrationDecision: "quarantine", blocker: "unknown-ownership" };
  }

  const locatorKey = record.canonicalBinding?.locator ?? record.sourceLocator;
  const dupLocator =
    record.canonicalBinding?.role === "canonical" &&
    (ctx.canonicalLocatorCounts.get(locatorKey) ?? 0) > 1;
  const dupResource =
    record.canonicalBinding?.role === "canonical" &&
    record.resourceId &&
    (ctx.canonicalResourceIdCounts.get(record.resourceId) ?? 0) > 1;
  if (dupLocator || dupResource) {
    return {
      migrationDecision: "block",
      blocker: "duplicate-canonical-binding",
    };
  }

  if (record.crossTenant === true) {
    return { migrationDecision: "block", blocker: "cross-tenant" };
  }

  if (!ctx.catalogExists || record.catalogBindingPresent !== true) {
    return {
      migrationDecision: "do-not-mint",
      blocker: "missing-catalog-binding",
    };
  }

  return {
    migrationDecision: "eligible-dry-run-only",
    blocker: "dry-run-not-executed",
  };
}

function domainForWorkspaceKind(kind) {
  if (kind === "agent_primary") {
    return "agent";
  }
  return "workspace";
}

function loadJson(repoRoot, rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

function extraPatternRecords() {
  return [
    {
      candidateId: "pattern-knowledge-department",
      domain: "knowledge",
      sourceLocator: "tenants/<tenantId>/organization/departments/<departmentId>/knowledge/",
      resourceId: null,
      classification: "unknown",
      ownerScope: "unknown",
      ownerId: null,
      agentAssetId: null,
      tenantId: null,
      canonicalBinding: null,
      catalogBindingPresent: false,
      fileCount: 0,
      byteCount: 0,
      legalHold: false,
      retention: false,
      tombstone: false,
      proof: "design-layout-only; production knowledge roots not enumerated",
    },
    {
      candidateId: "pattern-conversation-user-private",
      domain: "conversationArchive",
      sourceLocator: "tenants/<tenantId>/users/<userId>/private/conversations/",
      resourceId: null,
      classification: "unknown",
      ownerScope: "unknown",
      ownerId: null,
      agentAssetId: null,
      tenantId: null,
      canonicalBinding: null,
      catalogBindingPresent: false,
      fileCount: 0,
      byteCount: 0,
      legalHold: false,
      retention: false,
      tombstone: false,
      proof: "design-layout-only; production conversation roots not enumerated",
    },
    {
      candidateId: "pattern-conversation-agent-asset",
      domain: "conversationArchive",
      sourceLocator: "tenants/<tenantId>/agent-assets/<agentAssetId>/conversations/",
      resourceId: null,
      classification: "unknown",
      ownerScope: "unknown",
      ownerId: null,
      agentAssetId: null,
      tenantId: null,
      canonicalBinding: null,
      catalogBindingPresent: false,
      fileCount: 0,
      byteCount: 0,
      legalHold: false,
      retention: false,
      tombstone: false,
      proof: "design-layout-only; production conversation roots not enumerated",
    },
    {
      candidateId: "pattern-conversation-tenant-archive",
      domain: "conversationArchive",
      sourceLocator: "tenants/<tenantId>/archive/",
      resourceId: null,
      classification: "unknown",
      ownerScope: "unknown",
      ownerId: null,
      agentAssetId: null,
      tenantId: null,
      canonicalBinding: null,
      catalogBindingPresent: false,
      fileCount: 0,
      byteCount: 0,
      legalHold: false,
      retention: true,
      tombstone: false,
      lifecycle: "retention",
      proof: "design-layout tenant archive; retention preserved, not migrated",
    },
    {
      candidateId: "pattern-legacy-host-workspace",
      domain: "knownLegacyRoot",
      sourceLocator: "{stateDir}/workspace",
      resourceId: "ws:host:unknown:host-root-has-no-enterprise:main",
      classification: "conflict",
      ownerScope: "unknown",
      ownerId: null,
      agentAssetId: null,
      tenantId: "host",
      canonicalBinding: {
        role: "compatibility",
        state: "read_only",
        locator: "{stateDir}/workspace",
      },
      catalogBindingPresent: false,
      fileCount: 0,
      byteCount: 0,
      legalHold: false,
      retention: false,
      tombstone: false,
      proof: "P1 host canonical workspace root (Phase 0 inventory)",
    },
    {
      candidateId: "pattern-legacy-p8-sqlite",
      domain: "memory",
      sourceLocator: "{stateDir}/memory/<agentId>.sqlite",
      resourceId: null,
      classification: "unknown",
      ownerScope: "unknown",
      ownerId: null,
      agentAssetId: null,
      tenantId: null,
      canonicalBinding: {
        role: "compatibility",
        state: "read_only",
        locator: "{stateDir}/memory/<agentId>.sqlite",
      },
      catalogBindingPresent: false,
      fileCount: 0,
      byteCount: 0,
      legalHold: false,
      retention: false,
      tombstone: false,
      proof: "P8 unpartitioned memory sqlite; no workspace_id",
    },
    {
      candidateId: "pattern-w1-dark-tombstone",
      domain: "memory",
      sourceLocator: "src/memory/item7-w1-dark-tombstone.ts",
      resourceId: null,
      classification: "classified",
      ownerScope: "platform",
      ownerId: "cursor-data-governance",
      agentAssetId: null,
      tenantId: "platform",
      canonicalBinding: null,
      catalogBindingPresent: false,
      fileCount: 0,
      byteCount: 0,
      legalHold: false,
      retention: false,
      tombstone: true,
      lifecycle: "tombstone",
      proof: "W1 dark tombstone policy; preserve, do not delete on migration",
    },
  ];
}

function compatibilityBindingFromScan(site, index) {
  return {
    candidateId: "scan-compat-" + String(index + 1).padStart(2, "0"),
    domain: "compatibilityBinding",
    sourceLocator: site.file + ":" + site.line,
    resourceId: null,
    classification: "unknown",
    ownerScope: "unknown",
    ownerId: null,
    agentAssetId: null,
    tenantId: null,
    canonicalBinding: {
      role: "compatibility",
      state: "read_only",
      locator: site.file + ":" + site.line + ":" + site.symbol,
    },
    catalogBindingPresent: false,
    fileCount: 0,
    byteCount: 0,
    legalHold: false,
    retention: false,
    tombstone: false,
    proof:
      "Item 7 remaining live site " +
      site.pathId +
      " " +
      site.symbol +
      "; missing Catalog binding, do not mint",
    scanSite: site,
  };
}

function sqliteRecords(liveSummary) {
  const rows = Array.isArray(liveSummary.sqlite) ? liveSummary.sqlite : [];
  return rows.map((row, index) => ({
    candidateId: "memory-sqlite-" + String(index + 1).padStart(2, "0"),
    domain: "memory",
    sourceLocator: "{stateDir}/memory/" + row.agentId + ".sqlite",
    resourceId: null,
    classification: "unknown",
    ownerScope: "unknown",
    ownerId: null,
    agentAssetId: null,
    tenantId: null,
    canonicalBinding: {
      role: "compatibility",
      state: "read_only",
      locator: "{stateDir}/memory/" + row.agentId + ".sqlite",
    },
    catalogBindingPresent: false,
    fileCount: 1,
    byteCount: Number(row.bytes) || 0,
    legalHold: false,
    retention: false,
    tombstone: false,
    proof: "Phase 0 LIVE summary sqlite inventory (hashed agentId; ownership not guessed)",
    dualTree: row.dualTree === true,
  }));
}

function fromCandidate(candidate) {
  const parsed = parseResourceId(candidate.resourceId);
  const locator = candidate.binding?.locator ?? candidate.pathPattern;
  const classified = candidate.classification === "classified";
  return {
    candidateId: candidate.candidateId,
    domain: domainForWorkspaceKind(candidate.workspaceKind),
    workspaceKind: candidate.workspaceKind,
    sourceLocator: locator,
    resourceId: candidate.resourceId ?? null,
    tenantId: parsed.tenantId,
    ownerScope: classified ? parsed.ownerScope : "unknown",
    ownerId: classified ? parsed.ownerId : null,
    agentAssetId: classified ? parsed.agentAssetId : null,
    classification: candidate.classification,
    canonicalBinding: candidate.binding
      ? {
          role: candidate.binding.role,
          state: candidate.binding.state,
          locator: candidate.binding.locator,
        }
      : null,
    catalogBindingPresent: false,
    fileCount: 0,
    byteCount: 0,
    legalHold: false,
    retention: false,
    tombstone: false,
    proof: candidate.proof ?? candidate.related?.lookupReason ?? null,
    writable: candidate.writable === true,
    crossTenant: detectCrossTenant(candidate.resourceId, locator),
  };
}

function contentHashFor(record) {
  return sha256Text(
    JSON.stringify({
      sourceLocator: record.sourceLocator,
      resourceId: record.resourceId,
      classification: record.classification,
      domain: record.domain,
      candidateId: record.candidateId,
    }),
  );
}

function isPlaceholderLocator(locator) {
  return /<(tid|uid|slug|groupId|tenantId|userId|agentId|agentAssetId|departmentId|id)>/.test(
    String(locator ?? ""),
  );
}

function buildCounts(rawRecords) {
  const canonicalLocatorCounts = new Map();
  const canonicalResourceIdCounts = new Map();
  for (const record of rawRecords) {
    if (record.canonicalBinding?.role !== "canonical") {
      continue;
    }
    const locator = record.canonicalBinding.locator ?? record.sourceLocator;
    // Redacted Phase 0 locators share placeholder tokens; do not treat that
    // as a proven duplicate canonical binding.
    if (!isPlaceholderLocator(locator)) {
      canonicalLocatorCounts.set(locator, (canonicalLocatorCounts.get(locator) ?? 0) + 1);
    }
    if (record.resourceId) {
      canonicalResourceIdCounts.set(
        record.resourceId,
        (canonicalResourceIdCounts.get(record.resourceId) ?? 0) + 1,
      );
    }
  }
  return { canonicalLocatorCounts, canonicalResourceIdCounts };
}

function finalizeRecord(record, ctx) {
  const decision = decideMigration(record, ctx);
  return {
    sourceLocator: record.sourceLocator,
    resourceId: record.resourceId,
    tenantId: record.tenantId ?? null,
    ownerScope: record.ownerScope,
    ownerId: record.ownerId,
    agentAssetId: record.agentAssetId,
    classification: record.classification,
    canonicalBinding: record.canonicalBinding,
    contentHash: contentHashFor(record),
    fileCount: record.fileCount,
    byteCount: record.byteCount,
    migrationDecision: decision.migrationDecision,
    blocker: decision.blocker,
    domain: record.domain,
    candidateId: record.candidateId,
    legalHold: record.legalHold === true,
    retention: record.retention === true,
    tombstone: record.tombstone === true,
    catalogBindingPresent: false,
    catalogMinted: false,
    productionTouched: false,
  };
}

export function evaluateLegacyMigrationDryRun(repoRoot) {
  const catalog = loadJson(repoRoot, CATALOG_CANDIDATE);
  const liveSummary = loadJson(repoRoot, LIVE_SUMMARY);
  const scan = loadJson(repoRoot, RETIREMENT_SCAN);

  const raw = [
    ...catalog.candidates.map(fromCandidate),
    ...sqliteRecords(liveSummary),
    ...extraPatternRecords(),
    ...scan.sites.map(compatibilityBindingFromScan),
  ];

  const ctx = {
    catalogExists: false,
    ...buildCounts(raw),
  };

  const records = raw
    .map((record) => finalizeRecord(record, ctx))
    .toSorted((a, b) => String(a.candidateId).localeCompare(String(b.candidateId)));

  const decisionCounts = {};
  const domainCounts = {};
  const blockerCounts = {};
  for (const record of records) {
    decisionCounts[record.migrationDecision] = (decisionCounts[record.migrationDecision] ?? 0) + 1;
    domainCounts[record.domain] = (domainCounts[record.domain] ?? 0) + 1;
    blockerCounts[record.blocker] = (blockerCounts[record.blocker] ?? 0) + 1;
  }

  const quarantineRecords = records.filter((row) => row.migrationDecision === "quarantine");
  const blockedRecords = records.filter((row) => row.migrationDecision === "block");
  const preserveRecords = records.filter((row) => row.migrationDecision === "preserve");
  const doNotMintRecords = records.filter((row) => row.migrationDecision === "do-not-mint");

  const migrationManifest = {
    schema: "memory-workspace-legacy-migration-manifest/v1",
    mode: "dry-run",
    replayable: true,
    executed: false,
    catalogMutation: false,
    productionWrite: false,
    delete: false,
    cutover: false,
    recordCount: records.length,
    records,
  };
  const rollbackManifest = {
    schema: "memory-workspace-legacy-migration-rollback/v1",
    mode: "dry-run",
    executed: false,
    identityRollback: true,
    executedMoves: [],
    executedDeletes: [],
    executedCatalogMutations: [],
    rollbackActions: [],
    note: "Dry-run executed nothing; rollback is a no-op identity.",
  };
  const quarantineManifest = {
    schema: "memory-workspace-legacy-migration-quarantine/v1",
    mode: "dry-run",
    executed: false,
    guessedOwnership: false,
    recordCount: quarantineRecords.length,
    records: quarantineRecords,
  };

  const checksums = {
    migrationManifest: sha256Text(stableStringify(migrationManifest)),
    rollbackManifest: sha256Text(stableStringify(rollbackManifest)),
    quarantineManifest: sha256Text(stableStringify(quarantineManifest)),
    catalogCandidate: sha256Text(readFileSync(join(repoRoot, CATALOG_CANDIDATE))),
    retirementScan: sha256Text(readFileSync(join(repoRoot, RETIREMENT_SCAN))),
  };

  const packet = {
    schema: SCHEMA,
    kind: "legacy-migration-dry-run",
    taskId: TASK_ID,
    owner: OWNER,
    role: "legacy-migration-inventory-dry-run",
    preparedAt: "2026-08-30T15:20:00.000Z",
    originMain: ORIGIN_MAIN,
    selfAccepted: false,
    productionWrite: false,
    catalogMutation: false,
    migrationExecuted: false,
    delete: false,
    cutover: false,
    remaining: 10,
    liveWriteWatchIndex: 10,
    implementationVerified: false,
    deployAuthorized: false,
    live: "forbidden",
    item7: "not-met",
    locks: {
      productionWrite: false,
      catalogMutation: false,
      migrationExecuted: false,
      delete: false,
      cutover: false,
      remaining: 10,
      liveWriteWatchIndex: 10,
      implementationVerified: false,
      deployAuthorized: false,
      live: "forbidden",
      item7: "not-met",
      phase1b: "blocked",
      i3: "not executed",
      productionCatalogWrite: "none",
    },
    persistentGovernanceCatalogExists: false,
    catalogMinted: false,
    guessedOwnership: false,
    recordCount: records.length,
    decisionCounts,
    domainCounts,
    blockerCounts,
    coveredDomains: REQUIRED_DOMAINS,
    checksums,
    inputs: [CATALOG_CANDIDATE, LIVE_SUMMARY, RETIREMENT_SCAN],
    citedReusableAssets: [
      "src/gateway/item7-stage-c-identity-shadow.ts",
      "src/memory/item7-stage-d-readiness.ts",
      "src/gateway/data-governance/s01-steward-workspace-identity.ts",
      "src/gateway/data-governance/s01-authorized-tool-cwd.ts",
      "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
      "docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json",
      "docs/design/evidence/memory-workspace-phase0-live-20260814.summary.json",
      "docs/design/evidence/memory-workspace-phase1b-item7-shadow-dry-run-2026-08-20.json",
      "docs/design/evidence/memory-workspace-phase1b-item7-w1-dark-tombstone.json",
      "docs/design/openbot-item7-a1-canonical-workspace-binding-2026-08-26.md",
      "docs/design/memory-workspace-identity-remediation-2026-08-14.md",
    ],
    notDone: [
      "did not write Catalog",
      "did not move, delete, or modify production files",
      "did not modify get-reply.ts",
      "did not modify s01-get-reply-steward-cwd-shadow.ts",
      "did not modify Stage B shadow evidence",
      "did not modify retirement-scan.json",
      "did not modify manager-sync-ops.ts",
      "did not set implementationVerified=true",
      "did not set deployAuthorized=true",
      "did not mark Item 7 met",
      "did not unlock Phase 1B",
      "did not execute I3",
      "did not authorize LIVE",
      "did not mint missing Catalog bindings",
      "did not guess unknown ownership",
      "did not merge",
      "did not self-accept",
    ],
    rules: [
      "unknown ownership \u2192 quarantine (do not guess)",
      "duplicate canonical binding \u2192 block",
      "cross-tenant \u2192 block",
      "missing Catalog binding \u2192 do not mint",
      "preserve legal hold/retention/tombstone",
    ],
    note: "Inventory + dry-run only. Replayable manifests are checksums of in-memory records. Nothing was migrated.",
  };

  return {
    packet,
    records,
    migrationManifest,
    rollbackManifest,
    quarantineManifest,
    checksums,
    blockedRecords,
    preserveRecords,
    doNotMintRecords,
    scan,
  };
}

function repoRootFromHere() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../..");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const result = evaluateLegacyMigrationDryRun(repoRootFromHere());
  process.stdout.write(
    JSON.stringify(
      {
        packet: result.packet,
        checksums: result.checksums,
        recordCount: result.records.length,
        decisionCounts: result.packet.decisionCounts,
        domainCounts: result.packet.domainCounts,
      },
      null,
      2,
    ) + "\n",
  );
}

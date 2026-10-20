import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadValidatedCatalogRecordSync } from "./catalog-store.js";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import * as exitExportStore from "./exit-export-store.js";
import {
  destResourceIdForImport,
  refuseExitMtimeAsTruth,
  refusePlacementFromMappingReceipt,
  runExitImportDrill,
  validateExitLongevityBundle,
  type ExitLongevityBundle,
  type ExitLongevityMode,
} from "./exit-export.js";
import * as dataGovernanceBarrel from "./index.js";
import {
  resolveTenantKeyManagementAuth,
  writeTenantKeyManagementPolicyAtDeployBoundary,
  type TenantKeyManagementAuth,
} from "./key-rotation-auth.js";
import { resolveDataGovernanceCatalogPath, resolveExitImportCatalogPath } from "./paths.js";
import { longevityMemberChecksum, merkleRootFromLeaves } from "./restore-drill.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tenantId: string; userId: string; domain: string } | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: resolveTenantContextMock,
  resolveAuthoritativeMembership: resolveAuthoritativeMembershipMock,
  TenantContextError: class TenantContextError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

const SOURCE_TENANT = "tenant-p5d-src";
const DEST_TENANT = "tenant-p5d-dest";
const MEMBER = "user-p5d";
const RESOURCE = "res-p5d-1";
const TOMBSTONE = "res-p5d-tombstone";
const IMPORT_NOW = "2026-08-18T09:00:00.000Z";

let stateDir = "";
let destCall: GovernanceAuthenticatedCall;
let destAuth: TenantKeyManagementAuth;

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p5d-exit-export-"));
}

function sha256Bytes(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function authCall(tenantId: string, userId: string): Promise<GovernanceAuthenticatedCall> {
  resolveTenantContextMock.mockResolvedValue({
    tenantId,
    userId,
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: `${userId}@${tenantId}.test`,
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected GovernanceAuthenticatedCall");
  }
  return authenticated.call;
}

function seedPolicy(tenantId: string, userId: string): void {
  writeTenantKeyManagementPolicyAtDeployBoundary({
    stateDir,
    record: {
      schemaVersion: 1,
      tenantId,
      operators: [{ userId, role: "tenant-admin" }],
    },
  });
}

function catalogRecord(
  resourceId: string,
  tenantId: string,
  lifecycleState: CatalogRecord["envelope"]["lifecycleState"] = "active",
): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId,
      owner: { kind: "user", userId: MEMBER },
      scope: { kind: "tenant", tenantId },
      lifecycleState,
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `loc-${resourceId}`,
        state: "active",
        contentVersion: "1",
      },
    ],
  };
}

function buildExitBundle(mode: ExitLongevityMode): ExitLongevityBundle {
  const live = catalogRecord(RESOURCE, SOURCE_TENANT);
  const tombstone = catalogRecord(TOMBSTONE, SOURCE_TENANT, "purged");
  const canonical = [
    {
      resourceId: RESOURCE,
      checksum: longevityMemberChecksum(live),
      record: live,
    },
  ];
  const tombstones = [{ resourceId: TOMBSTONE, checksum: longevityMemberChecksum(tombstone) }];
  const holdRetention = [{ resourceId: RESOURCE, checksum: longevityMemberChecksum("hold") }];
  const provenance = [{ resourceId: RESOURCE, checksum: longevityMemberChecksum("prov") }];
  const continuity = [{ agentAssetId: "asset-p5d", checksum: longevityMemberChecksum("cont") }];
  const policyConsent = [
    {
      resourceId: RESOURCE,
      policyVersion: "pol-1",
      consentVersion: "con-1",
      checksum: longevityMemberChecksum("policy"),
    },
  ];
  const auditMap = [{ member: "canonical", resourceId: RESOURCE }];
  const schemaManifest = { ladderVersions: ["1", "2"], producerMatrixRef: "matrix-p5d" };
  const readerBytes = "portable-reader-p5d";
  const transforms = [
    {
      transformMember: "transforms/v1-v2.json",
      transformChecksum: sha256Bytes("step"),
      bytes: "step",
    },
  ];
  const portableReader = {
    readerMember: "readers/p5_portable_reference_importer.js",
    readerChecksum: sha256Bytes(readerBytes),
    bytes: readerBytes,
  };
  const deletionClosure = {
    tombstones,
    revocations: [] as { resourceId: string; checksum: string }[],
  };
  const merkleRoot = merkleRootFromLeaves([
    ...canonical.map((row) => ({
      id: row.resourceId,
      kind: "canonical" as const,
      checksum: row.checksum,
    })),
    ...tombstones.map((row) => ({
      id: row.resourceId,
      kind: "tombstone" as const,
      checksum: row.checksum,
    })),
    ...holdRetention.map((row) => ({
      id: row.resourceId,
      kind: "hold" as const,
      checksum: row.checksum,
    })),
  ]);
  const identity = {
    bundleId: "bundle-p5d-1",
    tenantId: SOURCE_TENANT,
    sourceTenantId: SOURCE_TENANT,
    mode,
    createdReceiptId: "backup-p5d-1",
    createdAt: "2026-08-17T12:00:00.000Z",
    snapshotEpoch: "epoch-1",
    logWatermark: "log-1",
    recordCounts: {
      canonical: canonical.length,
      tombstone: tombstones.length,
      revocation: 0,
      hold: holdRetention.length,
    },
    merkleRoot,
    schemaManifest,
  };
  const checksums: Record<string, string> = {
    "manifest.json": longevityMemberChecksum(identity),
    canonical: longevityMemberChecksum(canonical),
    deletionClosure: longevityMemberChecksum(deletionClosure),
    holdRetention: longevityMemberChecksum(holdRetention),
    provenance: longevityMemberChecksum(provenance),
    continuity: longevityMemberChecksum(continuity),
    policyConsent: longevityMemberChecksum(policyConsent),
    auditMap: longevityMemberChecksum(auditMap),
    schemaManifest: longevityMemberChecksum(schemaManifest),
    transforms: longevityMemberChecksum(transforms),
    portableReader: longevityMemberChecksum(portableReader),
  };
  return {
    kind: "p5_longevity_bundle",
    manifest: { ...identity, checksums },
    canonical,
    deletionClosure,
    holdRetention,
    provenance,
    continuity,
    policyConsent,
    auditMap,
    schemaManifest,
    transforms,
    portableReader,
  };
}

function productionCatalogBytes(): Buffer | null {
  const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
  return fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath) : null;
}

const here = path.dirname(fileURLToPath(import.meta.url));

beforeEach(async () => {
  stateDir = tmpStateDir();
  seedPolicy(DEST_TENANT, MEMBER);
  destCall = await authCall(DEST_TENANT, MEMBER);
  const resolved = resolveTenantKeyManagementAuth({ call: destCall, stateDir });
  if (!resolved.ok) {
    throw new Error("expected dest auth");
  }
  destAuth = resolved.auth;
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("P5-d exit export validation", () => {
  it("accepts cross_tenant_import bundles with full §3 closure", () => {
    const bundle = buildExitBundle("cross_tenant_import");
    expect(validateExitLongevityBundle(bundle)).toEqual({ ok: true, value: bundle });
  });

  it("accepts cross_platform_migration bundles", () => {
    const bundle = buildExitBundle("cross_platform_migration");
    expect(validateExitLongevityBundle(bundle).ok).toBe(true);
  });

  it("rejects same_tenant_dr bundles as exit imports", () => {
    const bundle = buildExitBundle("cross_tenant_import");
    const asDr = {
      ...bundle,
      manifest: {
        ...bundle.manifest,
        mode: "same_tenant_dr" as const,
      },
    };
    expect(validateExitLongevityBundle(asDr)).toEqual({
      ok: false,
      error: "mode_not_exit_import",
    });
  });
});

describe("P5-d exit import drill", () => {
  it("imports on a clean host with rewritten resourceIds and leaves production Catalog unchanged", async () => {
    const before = productionCatalogBytes();
    const bundle = buildExitBundle("cross_tenant_import");
    const imported = await runExitImportDrill({
      auth: destAuth,
      stateDir,
      bundle,
      now: IMPORT_NOW,
    });
    expect(imported.ok && imported.value.kind).toBe("p5_exit_import_drill_receipt");
    expect(imported.ok && imported.value.state).toBe("applied");
    expect(imported.ok && imported.value.sourceTenantId).toBe(SOURCE_TENANT);
    expect(imported.ok && imported.value.destTenantId).toBe(DEST_TENANT);
    const expectedId = destResourceIdForImport(DEST_TENANT, RESOURCE);
    expect(imported.ok && imported.value.importedResourceIds).toEqual([expectedId]);
    expect(productionCatalogBytes()).toEqual(before);
    const loaded = loadValidatedCatalogRecordSync({
      storePath: resolveExitImportCatalogPath(stateDir, DEST_TENANT),
      resourceId: expectedId,
    });
    expect(loaded?.record.envelope.tenantId).toBe(DEST_TENANT);
    expect(loaded?.record.envelope.resourceId).toBe(expectedId);
    expect(loaded?.record.envelope.resourceId).not.toBe(RESOURCE);
  });

  it("refuses import when destination tenant equals source tenant", async () => {
    seedPolicy(SOURCE_TENANT, MEMBER);
    const sourceCall = await authCall(SOURCE_TENANT, MEMBER);
    const sourceAuth = resolveTenantKeyManagementAuth({ call: sourceCall, stateDir });
    if (!sourceAuth.ok) {
      throw new Error("expected source auth");
    }
    expect(
      await runExitImportDrill({
        auth: sourceAuth.auth,
        stateDir,
        bundle: buildExitBundle("cross_tenant_import"),
        now: IMPORT_NOW,
      }),
    ).toEqual({ ok: false, error: "source_dest_tenant_same" });
  });

  it("stores a durable mapping receipt that cannot authorize placement", async () => {
    const bundle = buildExitBundle("cross_platform_migration");
    const imported = await runExitImportDrill({
      auth: destAuth,
      stateDir,
      bundle,
      now: IMPORT_NOW,
    });
    expect(imported.ok && imported.value.mode).toBe("cross_platform_migration");
    const state = exitExportStore.readExitImportState({
      stateDir,
      destTenantId: DEST_TENANT,
    });
    expect(
      Object.values(state?.mappingReceipts ?? {}).some(
        (receipt) => receipt.state === "applied" && receipt.destTenantId === DEST_TENANT,
      ),
    ).toBe(true);
    expect(refusePlacementFromMappingReceipt()).toEqual({
      ok: false,
      error: "placement_authority_forbidden",
    });
    expect(refuseExitMtimeAsTruth()).toEqual({ ok: false, error: "mtime_truth_forbidden" });
  });

  it("keeps exit source free of placement forks and store internals in the barrel", () => {
    const source = fs.readFileSync(path.join(here, "exit-export.ts"), "utf8");
    for (const token of [
      "decideShadowPromotion",
      "fs.stat",
      "statSync",
      "mtimeMs",
      "placement_export",
    ]) {
      expect(source.includes(token), token).toBe(false);
    }
    expect(dataGovernanceBarrel).not.toHaveProperty("mutateExitImportState");
    expect(dataGovernanceBarrel).not.toHaveProperty("writeExitImportCatalog");
    expect(dataGovernanceBarrel).toHaveProperty("runExitImportDrill");
    expect(dataGovernanceBarrel).toHaveProperty("validateExitLongevityBundle");
  });
});

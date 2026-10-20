import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileDataGovernanceCatalogStore,
  loadValidatedCatalogRecordSync,
} from "./catalog-store.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import {
  hashCanonicalBytes,
  readLocalCanonicalBytes,
  writeLocalCanonicalBytes,
} from "./cognitive-promotion-adapters.js";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import * as dataGovernanceBarrel from "./index.js";
import {
  executeContentFormatTransform,
  migrateContentFormat,
  refuseIntegrityMtimeAsTruth,
  refusePlacementFromIntegrityReceipt,
  refusePurgeFromFormatReceipt,
  scanTenantIntegrity,
} from "./integrity-format.js";
import {
  resolveTenantKeyManagementAuth,
  writeTenantKeyManagementPolicyAtDeployBoundary,
  type TenantKeyManagementAuth,
} from "./key-rotation-auth.js";
import {
  resolveDataGovernanceCatalogPath,
  resolveFormatMigrationJournalPath,
  resolveRestoreDrillCatalogPath,
} from "./paths.js";
import * as restoreDrillStore from "./restore-drill-store.js";
import {
  longevityMemberChecksum,
  merkleRootFromLeaves,
  readBackupRestoreObservability,
  refuseRestoreMtimeAsTruth,
  runRestoreDrill,
  validateLongevityBundle,
  type PortableLongevityBundle,
} from "./restore-drill.js";
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

const TENANT = "tenant-p5c";
const OTHER_TENANT = "tenant-p5c-other";
const MEMBER = "user-p5c";
const ADMIN = "user-p5c-admin";
const RESOURCE = "res-p5c-1";
const TOMBSTONE = "res-p5c-tombstone";
const MIGRATION_NOW = "2026-08-18T00:00:00.000Z";
const here = path.dirname(fileURLToPath(import.meta.url));

let stateDir = "";
let call: GovernanceAuthenticatedCall;
let adminCall: GovernanceAuthenticatedCall;
let otherCall: GovernanceAuthenticatedCall;
let auth: TenantKeyManagementAuth;
let otherAuth: TenantKeyManagementAuth;

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p5c-restore-drill-"));
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

function resolveAuth(callToResolve: GovernanceAuthenticatedCall): TenantKeyManagementAuth {
  const resolved = resolveTenantKeyManagementAuth({ call: callToResolve, stateDir });
  if (!resolved.ok) {
    throw new Error("expected TenantKeyManagementAuth");
  }
  return resolved.auth;
}

function productionCatalogBytes(): Buffer | null {
  const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
  return fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath) : null;
}

function drillCatalogExists(): boolean {
  return fs.existsSync(resolveRestoreDrillCatalogPath(stateDir, TENANT));
}

function contentLocator(resourceId: string): string {
  return path.join(stateDir, "canonical", resourceId);
}

function canonicalBinding(resourceId: string) {
  const loaded = loadValidatedCatalogRecordSync({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
    resourceId,
  });
  return loaded?.record.bindings.find((binding) => binding.role === "canonical");
}

function readCanonicalViaCatalog(resourceId: string): Buffer | null {
  const binding = canonicalBinding(resourceId);
  if (!binding) {
    return null;
  }
  return readLocalCanonicalBytes(binding.locator);
}

function formatReceiptCount(): number {
  return Object.keys(
    restoreDrillStore.readRestoreDrillState({ stateDir, tenantId: TENANT })?.formatReceipts ?? {},
  ).length;
}

function outsideEvilPath(): string {
  return path.join(stateDir, "outside-evil", "pwned");
}

function catalogRecordWithContent(
  resourceId: string,
  document: { format: string; body: string },
): CatalogRecord {
  const locator = contentLocator(resourceId);
  const record = catalogRecord(resourceId);
  const next: CatalogRecord = {
    ...record,
    bindings: record.bindings.map((binding) =>
      binding.role === "canonical" ? { ...binding, locator } : binding,
    ),
  };
  writeLocalCanonicalBytes({
    locator,
    bytes: Buffer.from(`${JSON.stringify(document)}\n`, "utf8"),
  });
  return next;
}

async function seedProduction(record: CatalogRecord): Promise<void> {
  const store = createFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
  await store.put(record);
}

function catalogRecord(
  resourceId: string,
  lifecycleState: CatalogRecord["envelope"]["lifecycleState"] = "active",
  tenantId = TENANT,
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

function buildBundle(params?: {
  extraKeys?: Record<string, unknown>;
  omitMember?: string;
  liveAsTombstone?: boolean;
  extraCanonical?: CatalogRecord;
}): PortableLongevityBundle {
  const live = catalogRecord(RESOURCE);
  const tombstone = catalogRecord(TOMBSTONE, "purged");
  const canonical = [
    {
      resourceId: RESOURCE,
      checksum: longevityMemberChecksum(live),
      record: live,
    },
    ...(params?.liveAsTombstone
      ? [
          {
            resourceId: TOMBSTONE,
            checksum: longevityMemberChecksum(catalogRecord(TOMBSTONE, "active")),
            record: catalogRecord(TOMBSTONE, "active"),
          },
        ]
      : []),
    ...(params?.extraCanonical
      ? [
          {
            resourceId: params.extraCanonical.envelope.resourceId,
            checksum: longevityMemberChecksum(params.extraCanonical),
            record: params.extraCanonical,
          },
        ]
      : []),
  ];
  const tombstones = [{ resourceId: TOMBSTONE, checksum: longevityMemberChecksum(tombstone) }];
  const revocations: { resourceId: string; checksum: string }[] = [];
  const holdRetention = [{ resourceId: RESOURCE, checksum: longevityMemberChecksum("hold") }];
  const provenance = [{ resourceId: RESOURCE, checksum: longevityMemberChecksum("prov") }];
  const continuity = [{ agentAssetId: "asset-p5c", checksum: longevityMemberChecksum("cont") }];
  const policyConsent = [
    {
      resourceId: RESOURCE,
      policyVersion: "pol-1",
      consentVersion: "con-1",
      checksum: longevityMemberChecksum("policy"),
    },
  ];
  const auditMap = [{ member: "canonical", resourceId: RESOURCE }];
  const schemaManifest = { ladderVersions: ["1", "2"], producerMatrixRef: "matrix-p5c" };
  const readerBytes = "portable-reader-p5c";
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
  const deletionClosure = { tombstones, revocations };
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
    bundleId: "bundle-p5c-1",
    tenantId: TENANT,
    mode: "same_tenant_dr" as const,
    createdReceiptId: "backup-p5c-1",
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
  if (params?.omitMember) {
    delete checksums[params.omitMember];
  }
  const bundle: PortableLongevityBundle = {
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
    ...params?.extraKeys,
  };
  return bundle;
}

beforeEach(async () => {
  stateDir = tmpStateDir();
  call = await authCall(TENANT, MEMBER);
  adminCall = await authCall(TENANT, ADMIN);
  otherCall = await authCall(OTHER_TENANT, "user-p5c-other-admin");
  seedPolicy(TENANT, ADMIN);
  seedPolicy(OTHER_TENANT, "user-p5c-other-admin");
  auth = resolveAuth(adminCall);
  otherAuth = resolveAuth(otherCall);
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("P5-c restore drill", () => {
  it("restores a valid bundle without credentials or outbox", async () => {
    const before = productionCatalogBytes();
    const bundle = buildBundle();
    expect(validateLongevityBundle(bundle).ok).toBe(true);
    const restored = await runRestoreDrill({
      auth,
      stateDir,
      bundle,
      now: "2026-08-17T13:00:00.000Z",
    });
    expect(restored.ok && restored.value.kind).toBe("p5_restore_drill_receipt");
    expect(restored.ok && restored.value.state).toBe("applied");
    expect(restored.ok && restored.value.restoredResourceIds).toEqual([RESOURCE]);
    expect(productionCatalogBytes()).toEqual(before);
    expect(drillCatalogExists()).toBe(false);
    expect(
      loadValidatedCatalogRecordSync({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
        resourceId: RESOURCE,
      }),
    ).toBeNull();
    expect(resolveRestoreDrillCatalogPath(stateDir, TENANT)).not.toBe(
      resolveDataGovernanceCatalogPath(stateDir),
    );
    const observed = readBackupRestoreObservability({ auth, stateDir });
    expect(observed.ok && observed.value.lastBackupAt).toBe("2026-08-17T12:00:00.000Z");
    expect(observed.ok && observed.value.lastRestoreAt).toBe("2026-08-17T13:00:00.000Z");
  });

  it("refuses a bundle that is missing tombstone, hold, provenance, or policy members", () => {
    for (const member of ["deletionClosure", "holdRetention", "provenance", "policyConsent"]) {
      expect(validateLongevityBundle(buildBundle({ omitMember: member }))).toEqual({
        ok: false,
        error: "bundle_member_missing",
      });
    }
  });

  it("refuses credentials and outbox members", () => {
    expect(
      validateLongevityBundle(buildBundle({ extraKeys: { credentials: { token: "x" } } })),
    ).toEqual({
      ok: false,
      error: "bundle_member_excluded",
    });
    expect(validateLongevityBundle(buildBundle({ extraKeys: { outbox: [] } }))).toEqual({
      ok: false,
      error: "bundle_member_excluded",
    });
  });

  it("does not resurrect a tombstoned or revoked asset", async () => {
    expect(validateLongevityBundle(buildBundle({ liveAsTombstone: true }))).toEqual({
      ok: false,
      error: "resurrect_forbidden",
    });
    const store = createFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
    await store.put(catalogRecord(RESOURCE, "purged"));
    const restored = await runRestoreDrill({
      auth,
      stateDir,
      bundle: buildBundle(),
      now: "2026-08-17T13:00:00.000Z",
    });
    expect(restored).toEqual({ ok: false, error: "resurrect_forbidden" });
    expect(
      loadValidatedCatalogRecordSync({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
        resourceId: RESOURCE,
      })?.record.envelope.lifecycleState,
    ).toBe("purged");
  });

  it("does not treat mtime as restore truth", async () => {
    const bundle = buildBundle();
    expect(
      (await runRestoreDrill({ auth, stateDir, bundle, now: "2026-08-17T13:00:00.000Z" })).ok,
    ).toBe(true);
    const drillPath = path.join(
      stateDir,
      "data-governance",
      "restore-drills",
      TENANT,
      "drill.json",
    );
    const past = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(drillPath, past, past);
    const observed = readBackupRestoreObservability({ auth, stateDir });
    expect(observed.ok && observed.value.lastRestoreAt).toBe("2026-08-17T13:00:00.000Z");
    expect(refuseRestoreMtimeAsTruth()).toEqual({ ok: false, error: "mtime_truth_forbidden" });
  });

  it("treats a missing backup as a fail signal, not silent zero", () => {
    expect(readBackupRestoreObservability({ auth, stateDir })).toEqual({
      ok: false,
      error: "backup_missing",
    });
  });

  it("refuses an ordinary tenant member restore drill", async () => {
    expect(
      await runRestoreDrill({
        auth: call as never,
        stateDir,
        bundle: buildBundle(),
        now: "2026-08-17T13:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(
      loadValidatedCatalogRecordSync({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
        resourceId: RESOURCE,
      }),
    ).toBeNull();
  });

  it("refuses a wire tenantId and a cross-tenant restore", async () => {
    expect(
      await runRestoreDrill({
        auth,
        stateDir,
        tenantId: OTHER_TENANT,
        bundle: buildBundle(),
        now: "2026-08-17T13:00:00.000Z",
      } as never),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(
      await runRestoreDrill({
        auth: otherAuth,
        stateDir,
        bundle: buildBundle(),
        now: "2026-08-17T13:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: "tenant_mismatch" });
  });

  it("does not modify the production Catalog and isolates the drill target", async () => {
    await seedProduction(catalogRecord(RESOURCE));
    const before = productionCatalogBytes();
    expect(before).not.toBeNull();
    const restored = await runRestoreDrill({
      auth,
      stateDir,
      bundle: buildBundle(),
      now: "2026-08-17T13:00:00.000Z",
    });
    expect(restored.ok && restored.value.state).toBe("applied");
    expect(productionCatalogBytes()).toEqual(before);
    expect(drillCatalogExists()).toBe(false);
    expect(resolveRestoreDrillCatalogPath(stateDir, TENANT)).toContain(
      `${path.sep}restore-drills${path.sep}${TENANT}${path.sep}catalog.json`,
    );
  });

  it("does not leave the first member when a later member fails", async () => {
    const before = productionCatalogBytes();
    const restored = await runRestoreDrill({
      auth,
      stateDir,
      bundle: buildBundle({ extraCanonical: catalogRecord("res-p5c-2", "active", OTHER_TENANT) }),
      now: "2026-08-17T13:00:00.000Z",
    });
    expect(restored).toEqual({ ok: false, error: "tenant_mismatch" });
    expect(productionCatalogBytes()).toEqual(before);
    expect(drillCatalogExists()).toBe(false);
    expect(
      loadValidatedCatalogRecordSync({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
        resourceId: RESOURCE,
      }),
    ).toBeNull();
    expect(
      restoreDrillStore.readRestoreDrillState({ stateDir, tenantId: TENANT })?.drillReceipts[
        `restore:${TENANT}:bundle-p5c-1:epoch-1`
      ]?.state,
    ).toBe("failed");
  });

  it("does not leave a restored Catalog when receipt persist fails", async () => {
    const spy = vi
      .spyOn(restoreDrillStore, "mutateRestoreDrillState")
      .mockImplementationOnce(() => ({ ok: false, error: "restore_drill_corrupt" }));
    try {
      const before = productionCatalogBytes();
      const restored = await runRestoreDrill({
        auth,
        stateDir,
        bundle: buildBundle(),
        now: "2026-08-17T13:00:00.000Z",
      });
      expect(restored).toEqual({ ok: false, error: "restore_drill_corrupt" });
      expect(productionCatalogBytes()).toEqual(before);
      expect(drillCatalogExists()).toBe(false);
      expect(
        restoreDrillStore.readRestoreDrillState({ stateDir, tenantId: TENANT })?.drillReceipts[
          `restore:${TENANT}:bundle-p5c-1:epoch-1`
        ]?.state,
      ).toBe("failed");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("P5-c integrity scan and format migration", () => {
  it("records an integrity scan that cannot authorize placement or purge", async () => {
    const bundle = buildBundle();
    await seedProduction(catalogRecord(RESOURCE));
    const scanned = scanTenantIntegrity({ auth, stateDir, bundle });
    expect(scanned.ok && scanned.value.kind).toBe("p5_integrity_scan_receipt");
    expect(scanned.ok && scanned.value.findings).toEqual([]);
    expect(refusePlacementFromIntegrityReceipt()).toEqual({
      ok: false,
      error: "placement_authority_forbidden",
    });
    expect(refusePurgeFromFormatReceipt()).toEqual({
      ok: false,
      error: "purge_authority_forbidden",
    });
  });

  it("migrates content format only when Catalog ownership is present", async () => {
    expect(
      await migrateContentFormat({
        call,
        stateDir,
        resourceId: RESOURCE,
        fromFormat: "markdown",
        toFormat: "json",
        contentVersion: "2",
        now: MIGRATION_NOW,
      }),
    ).toEqual({ ok: false, error: "catalog_not_found" });
    const seeded = catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" });
    await seedProduction(seeded);
    const sourceBytes = readLocalCanonicalBytes(contentLocator(RESOURCE));
    const catalogRecordChecksum = createHash("sha256")
      .update(canonicalizeCognitiveJson(seeded), "utf8")
      .digest("hex");
    const migrated = await migrateContentFormat({
      call,
      stateDir,
      resourceId: RESOURCE,
      fromFormat: "markdown",
      toFormat: "json",
      contentVersion: "2",
      now: MIGRATION_NOW,
    });
    expect(migrated.ok && migrated.value.kind).toBe("p5_content_format_migration_receipt");
    expect(migrated.ok && migrated.value.resourceId).toBe(RESOURCE);
    expect(migrated.ok && migrated.value.state).toBe("applied");
    expect(migrated.ok && migrated.value.transformId).toBe("content-format:markdown->json:v1");
    expect(migrated.ok && migrated.value.fromContentVersion).toBe("1");
    expect(migrated.ok && migrated.value.contentVersion).toBe("2");
    const resultBytes = readCanonicalViaCatalog(RESOURCE);
    expect(resultBytes).not.toBeNull();
    expect(migrated.ok && migrated.value.sourceChecksum).toBe(hashCanonicalBytes(sourceBytes!));
    expect(migrated.ok && migrated.value.checksum).toBe(hashCanonicalBytes(resultBytes!));
    expect(migrated.ok && migrated.value.checksum).not.toBe(hashCanonicalBytes(sourceBytes!));
    expect(migrated.ok && migrated.value.checksum).not.toBe(catalogRecordChecksum);
    const binding = canonicalBinding(RESOURCE);
    expect(binding?.contentVersion).toBe("2");
    expect(binding?.objectKey).toBe(migrated.ok ? migrated.value.checksum : "");
    expect(binding?.locator).toContain(`${path.sep}versions${path.sep}2-`);
    expect(fs.existsSync(contentLocator(RESOURCE))).toBe(false);
    const loaded = loadValidatedCatalogRecordSync({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
      resourceId: RESOURCE,
    });
    expect(loaded?.record.envelope.canonicalBindingId).toBe(`bind-${RESOURCE}`);
    expect(loaded?.record.envelope.resourceId).toBe(RESOURCE);
    expect(loaded?.record.envelope.updatedAt).toBe(MIGRATION_NOW);
    expect(loaded?.record.envelope.governanceVersion).toBe(2);
  });

  it("refuses fromFormat that does not match the stored content", async () => {
    await seedProduction(catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" }));
    const beforeCatalog = productionCatalogBytes();
    const beforeContent = readLocalCanonicalBytes(contentLocator(RESOURCE));
    expect(
      await migrateContentFormat({
        call,
        stateDir,
        resourceId: RESOURCE,
        fromFormat: "html",
        toFormat: "json",
        contentVersion: "2",
        now: MIGRATION_NOW,
      }),
    ).toEqual({ ok: false, error: "format_mismatch" });
    expect(productionCatalogBytes()).toEqual(beforeCatalog);
    expect(readLocalCanonicalBytes(contentLocator(RESOURCE))).toEqual(beforeContent);
  });

  it("does not return applied when the transform is not executed", async () => {
    await seedProduction(catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" }));
    const skipped = await migrateContentFormat({
      call,
      stateDir,
      resourceId: RESOURCE,
      fromFormat: "markdown",
      toFormat: "html",
      contentVersion: "2",
      now: MIGRATION_NOW,
    });
    expect(skipped).toEqual({ ok: false, error: "unsupported_transform" });
    expect(skipped.ok).toBe(false);
  });

  it("leaves canonical and Catalog unchanged when transform fails", async () => {
    await seedProduction(catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" }));
    const beforeCatalog = productionCatalogBytes();
    const beforeContent = readLocalCanonicalBytes(contentLocator(RESOURCE));
    const dir = path.dirname(contentLocator(RESOURCE));
    fs.chmodSync(dir, 0o555);
    try {
      expect(
        await migrateContentFormat({
          call,
          stateDir,
          resourceId: RESOURCE,
          fromFormat: "markdown",
          toFormat: "json",
          contentVersion: "2",
          now: MIGRATION_NOW,
        }),
      ).toEqual({ ok: false, error: "transform_failed" });
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect(productionCatalogBytes()).toEqual(beforeCatalog);
    expect(readLocalCanonicalBytes(contentLocator(RESOURCE))).toEqual(beforeContent);
    expect(
      loadValidatedCatalogRecordSync({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
        resourceId: RESOURCE,
      })?.record.bindings.find((binding) => binding.role === "canonical")?.contentVersion,
    ).toBe("1");
  });

  it("serves new bytes via Catalog immediately after CAS even before receipt finalize", async () => {
    const seeded = catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" });
    await seedProduction(seeded);
    const sourceBytes = readLocalCanonicalBytes(contentLocator(RESOURCE));
    expect(
      await migrateContentFormat({
        call,
        stateDir,
        resourceId: RESOURCE,
        fromFormat: "markdown",
        toFormat: "json",
        contentVersion: "2",
        now: MIGRATION_NOW,
        faultAfter: "catalog_cas",
      }),
    ).toEqual({ ok: false, error: "recovery_required" });
    const binding = canonicalBinding(RESOURCE);
    expect(binding?.contentVersion).toBe("2");
    expect(binding?.locator).toContain(`${path.sep}versions${path.sep}2-`);
    expect(binding?.objectKey).toBeTruthy();
    const viaCatalog = readCanonicalViaCatalog(RESOURCE);
    expect(viaCatalog).not.toEqual(sourceBytes);
    expect(JSON.parse(viaCatalog!.toString("utf8")).format).toBe("json");
    expect(hashCanonicalBytes(viaCatalog!)).toBe(binding?.objectKey);
    expect(readLocalCanonicalBytes(contentLocator(RESOURCE))).toEqual(sourceBytes);
    expect(fs.existsSync(`${contentLocator(RESOURCE)}.migrating`)).toBe(false);
    expect(fs.existsSync(resolveFormatMigrationJournalPath(stateDir, TENANT, RESOURCE))).toBe(true);
    const prepared = restoreDrillStore.readRestoreDrillState({ stateDir, tenantId: TENANT });
    expect(
      Object.values(prepared?.formatReceipts ?? {}).some(
        (receipt) => receipt.resourceId === RESOURCE && receipt.state === "prepared",
      ),
    ).toBe(true);
    const healed = await migrateContentFormat({
      call,
      stateDir,
      resourceId: RESOURCE,
      fromFormat: "markdown",
      toFormat: "json",
      contentVersion: "2",
      now: MIGRATION_NOW,
    });
    expect(healed.ok && healed.value.state).toBe("applied");
    expect(readCanonicalViaCatalog(RESOURCE)).toEqual(viaCatalog);
    expect(healed.ok && healed.value.checksum).toBe(hashCanonicalBytes(viaCatalog!));
    expect(fs.existsSync(contentLocator(RESOURCE))).toBe(false);
    expect(fs.existsSync(resolveFormatMigrationJournalPath(stateDir, TENANT, RESOURCE))).toBe(
      false,
    );
  });

  it("heals receipt finalize interruption without a second Catalog CAS", async () => {
    await seedProduction(catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" }));
    expect(
      await migrateContentFormat({
        call,
        stateDir,
        resourceId: RESOURCE,
        fromFormat: "markdown",
        toFormat: "json",
        contentVersion: "2",
        now: MIGRATION_NOW,
        faultAfter: "receipt",
      }),
    ).toEqual({ ok: false, error: "recovery_required" });
    const afterCas = loadValidatedCatalogRecordSync({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
      resourceId: RESOURCE,
    });
    expect(
      afterCas?.record.bindings.find((binding) => binding.role === "canonical")?.contentVersion,
    ).toBe("2");
    const publishedBytes = readCanonicalViaCatalog(RESOURCE);
    expect(JSON.parse(publishedBytes!.toString("utf8")).format).toBe("json");
    expect(fs.existsSync(resolveFormatMigrationJournalPath(stateDir, TENANT, RESOURCE))).toBe(true);
    const interrupted = restoreDrillStore.readRestoreDrillState({ stateDir, tenantId: TENANT });
    expect(
      Object.values(interrupted?.formatReceipts ?? {}).some(
        (receipt) => receipt.resourceId === RESOURCE && receipt.state === "prepared",
      ),
    ).toBe(true);
    expect(
      Object.values(interrupted?.formatReceipts ?? {}).some(
        (receipt) => receipt.resourceId === RESOURCE && receipt.state === "applied",
      ),
    ).toBe(false);
    const healed = await migrateContentFormat({
      call,
      stateDir,
      resourceId: RESOURCE,
      fromFormat: "markdown",
      toFormat: "json",
      contentVersion: "2",
      now: MIGRATION_NOW,
    });
    expect(healed.ok && healed.value.state).toBe("applied");
    expect(healed.ok && healed.value.checksum).toBe(hashCanonicalBytes(publishedBytes!));
    expect(
      loadValidatedCatalogRecordSync({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
        resourceId: RESOURCE,
      })?.record.envelope.governanceVersion,
    ).toBe(afterCas?.record.envelope.governanceVersion);
    expect(fs.existsSync(resolveFormatMigrationJournalPath(stateDir, TENANT, RESOURCE))).toBe(
      false,
    );
  });

  it("rejects unsafe contentVersion tokens before writing or CAS", async () => {
    await seedProduction(catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" }));
    const beforeCatalog = productionCatalogBytes();
    const beforeContent = readLocalCanonicalBytes(contentLocator(RESOURCE));
    const beforeReceipts = formatReceiptCount();
    const evilOutside = outsideEvilPath();
    for (const badVersion of ["../../outside", "/tmp/outside", "..\\outside", "v/2", "v\\2"]) {
      expect(
        await migrateContentFormat({
          call,
          stateDir,
          resourceId: RESOURCE,
          fromFormat: "markdown",
          toFormat: "json",
          contentVersion: badVersion,
          now: MIGRATION_NOW,
        }),
      ).toEqual({ ok: false, error: "content_version_invalid" });
    }
    expect(productionCatalogBytes()).toEqual(beforeCatalog);
    expect(readLocalCanonicalBytes(contentLocator(RESOURCE))).toEqual(beforeContent);
    expect(formatReceiptCount()).toBe(beforeReceipts);
    expect(fs.existsSync(evilOutside)).toBe(false);
  });

  it("rejects forged journal nextLocator without out-of-root reads or deletes", async () => {
    await seedProduction(catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" }));
    const beforeCatalog = productionCatalogBytes();
    const evilOutside = outsideEvilPath();
    restoreDrillStore.writeFormatMigrationJournal({
      stateDir,
      journal: {
        schemaVersion: 1,
        kind: "p5_content_format_migration_journal",
        tenantId: TENANT,
        resourceId: RESOURCE,
        receiptId: "cfr_forged",
        previousLocator: contentLocator(RESOURCE),
        nextLocator: evilOutside,
        fromFormat: "markdown",
        toFormat: "json",
        transformId: "content-format:markdown->json:v1",
        fromContentVersion: "1",
        contentVersion: "2",
        sourceChecksum: "6ea6462b345680938333f6f298de28aef5387d35ec19df3ba02a65d47537c6c9",
        resultChecksum: "84245eab8bd9c748be523f2dde56a1fd5081cc6db6daf5a2c425719c2659f71e",
        expectedGovernanceVersion: 1,
        operatedAt: MIGRATION_NOW,
      },
    });
    expect(
      await migrateContentFormat({
        call,
        stateDir,
        resourceId: RESOURCE,
        fromFormat: "markdown",
        toFormat: "json",
        contentVersion: "2",
        now: MIGRATION_NOW,
      }),
    ).toEqual({ ok: false, error: "recovery_required" });
    expect(productionCatalogBytes()).toEqual(beforeCatalog);
    expect(fs.existsSync(evilOutside)).toBe(false);
    expect(
      Object.values(
        restoreDrillStore.readRestoreDrillState({ stateDir, tenantId: TENANT })?.formatReceipts ??
          {},
      ).some((receipt) => receipt.state === "applied"),
    ).toBe(false);
  });

  it("requires authoritative now for governance updatedAt", async () => {
    await seedProduction(catalogRecordWithContent(RESOURCE, { format: "markdown", body: "# p5c" }));
    const beforeCatalog = productionCatalogBytes();
    expect(
      await migrateContentFormat({
        call,
        stateDir,
        resourceId: RESOURCE,
        fromFormat: "markdown",
        toFormat: "json",
        contentVersion: "2",
        now: "not-a-timestamp",
      }),
    ).toEqual({ ok: false, error: "operated_at_invalid" });
    expect(productionCatalogBytes()).toEqual(beforeCatalog);
  });

  it("keeps restore and integrity source free of placement forks and mtime truth", () => {
    const restoreSource = fs.readFileSync(path.join(here, "restore-drill.ts"), "utf8");
    const integritySource = fs.readFileSync(path.join(here, "integrity-format.ts"), "utf8");
    for (const token of [
      "decideShadowPromotion",
      "fs.stat",
      "statSync",
      "mtimeMs",
      "mtime:",
      "placement_export",
      "requestPurge",
    ]) {
      expect(restoreSource.includes(token), token).toBe(false);
      expect(integritySource.includes(token), `integrity:${token}`).toBe(false);
    }
    expect(dataGovernanceBarrel).not.toHaveProperty("mutateRestoreDrillState");
    expect(dataGovernanceBarrel).not.toHaveProperty("readRestoreDrillState");
    expect(dataGovernanceBarrel).not.toHaveProperty("writeRestoreDrillCatalog");
    expect(dataGovernanceBarrel).not.toHaveProperty("destroyRestoreDrillCatalog");
    expect(dataGovernanceBarrel).not.toHaveProperty("writeFormatMigrationJournal");
    expect(dataGovernanceBarrel).not.toHaveProperty("readFormatMigrationJournal");
    expect(dataGovernanceBarrel).not.toHaveProperty("unlinkFormatMigrationJournal");
    expect(dataGovernanceBarrel).not.toHaveProperty("executeContentFormatTransform");
    expect(dataGovernanceBarrel).toHaveProperty("runRestoreDrill");
    expect(dataGovernanceBarrel).toHaveProperty("scanTenantIntegrity");
    expect(dataGovernanceBarrel).toHaveProperty("migrateContentFormat");
    expect(refuseIntegrityMtimeAsTruth()).toEqual({ ok: false, error: "mtime_truth_forbidden" });
    expect(() =>
      executeContentFormatTransform({
        fromFormat: "markdown",
        toFormat: "html",
        body: "# p5c",
      }),
    ).toThrow("unsupported_transform");
  });
});

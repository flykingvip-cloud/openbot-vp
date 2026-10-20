/**
 * P5-c same-tenant restore drill. Validates §3 portable-bundle members, then restores.
 * Not a P5-d exit exporter. Does not use filesystem mtimes. Does not fork placement.
 */
import { createHash } from "node:crypto";
import { isGovernanceActionAllowed } from "../governance-policy.js";
import {
  createFileDataGovernanceCatalogStore,
  loadValidatedCatalogRecordSync,
} from "./catalog-store.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import { isTenantKeyManagementAuth, type TenantKeyManagementAuth } from "./key-rotation-auth.js";
import { resolveDataGovernanceCatalogPath, resolveRestoreDrillCatalogPath } from "./paths.js";
import {
  destroyRestoreDrillCatalog,
  mutateRestoreDrillState,
  readRestoreDrillState,
  writeRestoreDrillCatalog,
} from "./restore-drill-store.js";
import type { CatalogRecord, DeletionClosureProof, RestoreDrillReceipt } from "./types.js";

export type RestoreDrillDenyCode =
  | "actor_not_authorized"
  | "bundle_member_missing"
  | "bundle_member_excluded"
  | "member_checksum_mismatch"
  | "deletion_proof_missing"
  | "merkle_root_mismatch"
  | "record_count_mismatch"
  | "mode_not_same_tenant_dr"
  | "tenant_mismatch"
  | "resurrect_forbidden"
  | "post_backup_write"
  | "snapshot_contradiction"
  | "backup_missing"
  | "mtime_truth_forbidden"
  | "restore_drill_corrupt";

export type RestoreDrillResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RestoreDrillDenyCode };

export type RestoreDrillAuthParams = {
  auth: TenantKeyManagementAuth;
  stateDir: string;
  tenantId?: never;
};

export type LongevityBundleLeaf = {
  id: string;
  kind: "canonical" | "tombstone" | "revocation" | "hold";
  checksum: string;
};

export type CanonicalBundleMember = {
  resourceId: string;
  checksum: string;
  record: CatalogRecord;
};

export type ClosureMember = {
  resourceId: string;
  checksum: string;
};

export type PortableLongevityBundle = {
  kind: "p5_longevity_bundle";
  manifest: {
    bundleId: string;
    tenantId: string;
    mode: "same_tenant_dr";
    createdReceiptId: string;
    createdAt: string;
    snapshotEpoch: string;
    logWatermark: string;
    recordCounts: DeletionClosureProof["recordCounts"];
    merkleRoot: string;
    schemaManifest: { ladderVersions: readonly string[]; producerMatrixRef: string };
    checksums: Record<string, string>;
  };
  canonical: readonly CanonicalBundleMember[];
  deletionClosure: {
    tombstones: readonly ClosureMember[];
    revocations: readonly ClosureMember[];
  };
  holdRetention: readonly ClosureMember[];
  provenance: readonly ClosureMember[];
  continuity: readonly { agentAssetId: string; checksum: string }[];
  policyConsent: readonly {
    resourceId: string;
    policyVersion: string;
    consentVersion: string;
    checksum: string;
  }[];
  auditMap: readonly { member: string; resourceId: string }[];
  schemaManifest: { ladderVersions: readonly string[]; producerMatrixRef: string };
  transforms: readonly { transformMember: string; transformChecksum: string; bytes: string }[];
  portableReader: { readerMember: string; readerChecksum: string; bytes: string };
};

const REQUIRED_MEMBERS = [
  "manifest.json",
  "canonical",
  "deletionClosure",
  "holdRetention",
  "provenance",
  "continuity",
  "policyConsent",
  "auditMap",
  "schemaManifest",
  "transforms",
  "portableReader",
] as const;

const FORBIDDEN_MEMBERS = new Set(["credentials", "outbox", "cursors", "locks", "caches"]);

const BUNDLE_KEYS = new Set([
  "kind",
  "manifest",
  "canonical",
  "deletionClosure",
  "holdRetention",
  "provenance",
  "continuity",
  "policyConsent",
  "auditMap",
  "schemaManifest",
  "transforms",
  "portableReader",
]);

const CLOSED_LIFECYCLES = new Set(["purged", "deletion_pending", "retired", "quarantined"]);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function memberChecksum(value: unknown): string {
  return sha256(Buffer.from(canonicalizeCognitiveJson(value), "utf8"));
}

function manifestIdentityChecksum(manifest: PortableLongevityBundle["manifest"]): string {
  const { checksums: _checksums, ...identity } = manifest;
  void _checksums;
  return memberChecksum(identity);
}

export function longevityMemberChecksum(value: unknown): string {
  return memberChecksum(value);
}

export function merkleRootFromLeaves(leaves: readonly LongevityBundleLeaf[]): string {
  const sorted = [...leaves].toSorted((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  );
  return sha256(
    Buffer.from(
      sorted.map((leaf) => `${leaf.kind}:${leaf.id}:${leaf.checksum}`).join("\n"),
      "utf8",
    ),
  );
}

function authorizeRestore(
  params: RestoreDrillAuthParams,
): RestoreDrillResult<{ tenantId: string; auth: TenantKeyManagementAuth }> {
  if (params.tenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isTenantKeyManagementAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.auth.callerTenantId.trim();
  if (!tenantId || params.auth.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const allowed = isGovernanceActionAllowed(
    { role: params.auth.role, tenantId, userId: params.auth.actor.userId },
    "write",
    { kind: "tenant", tenantId },
  );
  if (!allowed) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { tenantId, auth: params.auth } };
}

function closureIds(members: readonly ClosureMember[]): Set<string> {
  return new Set(members.map((row) => row.resourceId));
}

export function validateLongevityBundle(
  bundle: unknown,
): RestoreDrillResult<PortableLongevityBundle> {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return { ok: false, error: "bundle_member_missing" };
  }
  const raw = bundle as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_MEMBERS.has(key)) {
      return { ok: false, error: "bundle_member_excluded" };
    }
    if (!BUNDLE_KEYS.has(key)) {
      return { ok: false, error: "bundle_member_excluded" };
    }
  }
  if (raw.kind !== "p5_longevity_bundle" || !raw.manifest || typeof raw.manifest !== "object") {
    return { ok: false, error: "bundle_member_missing" };
  }
  const manifest = raw.manifest as PortableLongevityBundle["manifest"];
  if (manifest.mode !== "same_tenant_dr") {
    return { ok: false, error: "mode_not_same_tenant_dr" };
  }
  if (
    !manifest.snapshotEpoch ||
    !manifest.logWatermark ||
    !manifest.merkleRoot ||
    !manifest.recordCounts
  ) {
    return { ok: false, error: "deletion_proof_missing" };
  }
  for (const member of REQUIRED_MEMBERS) {
    if (member === "manifest.json") {
      if (!manifest.checksums?.[member]) {
        return { ok: false, error: "bundle_member_missing" };
      }
      continue;
    }
    if (raw[member] == null || !manifest.checksums?.[member]) {
      return { ok: false, error: "bundle_member_missing" };
    }
  }
  if (manifestIdentityChecksum(manifest) !== manifest.checksums["manifest.json"]) {
    return { ok: false, error: "member_checksum_mismatch" };
  }
  const parsed = raw as unknown as PortableLongevityBundle;
  for (const member of REQUIRED_MEMBERS) {
    if (member === "manifest.json") {
      continue;
    }
    if (memberChecksum(parsed[member]) !== manifest.checksums[member]) {
      return { ok: false, error: "member_checksum_mismatch" };
    }
  }
  const leaves: LongevityBundleLeaf[] = [
    ...parsed.canonical.map((row) => ({
      id: row.resourceId,
      kind: "canonical" as const,
      checksum: row.checksum,
    })),
    ...parsed.deletionClosure.tombstones.map((row) => ({
      id: row.resourceId,
      kind: "tombstone" as const,
      checksum: row.checksum,
    })),
    ...parsed.deletionClosure.revocations.map((row) => ({
      id: row.resourceId,
      kind: "revocation" as const,
      checksum: row.checksum,
    })),
    ...parsed.holdRetention.map((row) => ({
      id: row.resourceId,
      kind: "hold" as const,
      checksum: row.checksum,
    })),
  ];
  if (merkleRootFromLeaves(leaves) !== manifest.merkleRoot) {
    return { ok: false, error: "merkle_root_mismatch" };
  }
  const counts = manifest.recordCounts;
  if (
    counts.canonical !== parsed.canonical.length ||
    counts.tombstone !== parsed.deletionClosure.tombstones.length ||
    counts.revocation !== parsed.deletionClosure.revocations.length ||
    counts.hold !== parsed.holdRetention.length
  ) {
    return { ok: false, error: "record_count_mismatch" };
  }
  const closed = new Set([
    ...closureIds(parsed.deletionClosure.tombstones),
    ...closureIds(parsed.deletionClosure.revocations),
  ]);
  if (
    parsed.canonical.some(
      (row) =>
        closed.has(row.resourceId) && !CLOSED_LIFECYCLES.has(row.record.envelope.lifecycleState),
    )
  ) {
    return { ok: false, error: "resurrect_forbidden" };
  }
  if (parsed.canonical.some((row) => memberChecksum(row.record) !== row.checksum)) {
    return { ok: false, error: "member_checksum_mismatch" };
  }
  if (
    !parsed.portableReader.bytes ||
    sha256(Buffer.from(parsed.portableReader.bytes, "utf8")) !==
      parsed.portableReader.readerChecksum
  ) {
    return { ok: false, error: "member_checksum_mismatch" };
  }
  return { ok: true, value: parsed };
}

function persistFailedRestoreDrill(params: {
  stateDir: string;
  tenantId: string;
  replayId: string;
  bundleId: string;
  snapshotEpoch: string;
  backupCreatedAt: string;
  restoredAt: string;
  error: RestoreDrillDenyCode;
}): RestoreDrillResult<never> {
  destroyRestoreDrillCatalog({ stateDir: params.stateDir, tenantId: params.tenantId });
  const receipt: RestoreDrillReceipt = {
    kind: "p5_restore_drill_receipt",
    receiptId: `rdr_${sha256(Buffer.from(params.replayId, "utf8"))}`,
    replayId: params.replayId,
    tenantId: params.tenantId,
    bundleId: params.bundleId,
    mode: "same_tenant_dr",
    snapshotEpoch: params.snapshotEpoch,
    restoredResourceIds: [],
    backupCreatedAt: params.backupCreatedAt,
    restoredAt: params.restoredAt,
    state: "failed",
  };
  mutateRestoreDrillState({
    stateDir: params.stateDir,
    tenantId: params.tenantId,
    fn: (state) => {
      const existingReceipt = state.drillReceipts[params.replayId];
      if (existingReceipt?.state === "applied") {
        return { ok: true, value: existingReceipt, state };
      }
      return {
        ok: true,
        value: receipt,
        state: {
          ...state,
          drillReceipts: { ...state.drillReceipts, [params.replayId]: receipt },
        },
      };
    },
  });
  return { ok: false, error: params.error };
}

export async function runRestoreDrill(
  params: RestoreDrillAuthParams & { bundle: unknown; now: string },
): Promise<RestoreDrillResult<RestoreDrillReceipt>> {
  const authorized = authorizeRestore(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const productionCatalogPath = resolveDataGovernanceCatalogPath(params.stateDir);
  const drillCatalogPath = resolveRestoreDrillCatalogPath(params.stateDir, tenantId);
  if (drillCatalogPath === productionCatalogPath) {
    return { ok: false, error: "restore_drill_corrupt" };
  }
  const validated = validateLongevityBundle(params.bundle);
  if (!validated.ok) {
    return validated;
  }
  const bundle = validated.value;
  if (bundle.manifest.tenantId !== tenantId) {
    return { ok: false, error: "tenant_mismatch" };
  }
  const replayId = `restore:${tenantId}:${bundle.manifest.bundleId}:${bundle.manifest.snapshotEpoch}`;
  const existingApplied = readRestoreDrillState({
    stateDir: params.stateDir,
    tenantId,
  })?.drillReceipts[replayId];
  if (existingApplied?.state === "applied") {
    return { ok: true, value: existingApplied };
  }
  const fail = (error: RestoreDrillDenyCode): RestoreDrillResult<never> =>
    persistFailedRestoreDrill({
      stateDir: params.stateDir,
      tenantId,
      replayId,
      bundleId: bundle.manifest.bundleId,
      snapshotEpoch: bundle.manifest.snapshotEpoch,
      backupCreatedAt: bundle.manifest.createdAt,
      restoredAt: params.now,
      error,
    });
  const closed = new Set([
    ...closureIds(bundle.deletionClosure.tombstones),
    ...closureIds(bundle.deletionClosure.revocations),
  ]);
  const snapshotIds = new Set([...bundle.canonical.map((row) => row.resourceId), ...closed]);
  const productionStore = createFileDataGovernanceCatalogStore({
    storePath: productionCatalogPath,
  });
  const existing = await productionStore.list();
  for (const record of existing) {
    if (record.envelope.tenantId !== tenantId) {
      continue;
    }
    const id = record.envelope.resourceId;
    if (!snapshotIds.has(id)) {
      return fail("post_backup_write");
    }
    if (CLOSED_LIFECYCLES.has(record.envelope.lifecycleState)) {
      const incoming = bundle.canonical.find((row) => row.resourceId === id);
      if (incoming && !CLOSED_LIFECYCLES.has(incoming.record.envelope.lifecycleState)) {
        return fail("resurrect_forbidden");
      }
      if (!closed.has(id)) {
        return fail("snapshot_contradiction");
      }
    }
  }
  const toRestore: CatalogRecord[] = [];
  for (const member of bundle.canonical) {
    if (member.record.envelope.tenantId !== tenantId) {
      return fail("tenant_mismatch");
    }
    if (member.record.envelope.resourceId !== member.resourceId) {
      return fail("snapshot_contradiction");
    }
    const loaded = loadValidatedCatalogRecordSync({
      storePath: productionCatalogPath,
      resourceId: member.resourceId,
    });
    if (loaded && CLOSED_LIFECYCLES.has(loaded.record.envelope.lifecycleState)) {
      if (!CLOSED_LIFECYCLES.has(member.record.envelope.lifecycleState)) {
        return fail("resurrect_forbidden");
      }
      continue;
    }
    if (CLOSED_LIFECYCLES.has(member.record.envelope.lifecycleState)) {
      continue;
    }
    toRestore.push(member.record);
  }
  try {
    writeRestoreDrillCatalog({
      stateDir: params.stateDir,
      tenantId,
      records: toRestore,
    });
    for (const record of toRestore) {
      const loaded = loadValidatedCatalogRecordSync({
        storePath: drillCatalogPath,
        resourceId: record.envelope.resourceId,
      });
      if (!loaded || memberChecksum(loaded.record) !== memberChecksum(record)) {
        return fail("snapshot_contradiction");
      }
    }
  } catch {
    return fail("restore_drill_corrupt");
  }
  const receipt: RestoreDrillReceipt = {
    kind: "p5_restore_drill_receipt",
    receiptId: `rdr_${sha256(Buffer.from(replayId, "utf8"))}`,
    replayId,
    tenantId,
    bundleId: bundle.manifest.bundleId,
    mode: "same_tenant_dr",
    snapshotEpoch: bundle.manifest.snapshotEpoch,
    restoredResourceIds: toRestore.map((row) => row.envelope.resourceId),
    backupCreatedAt: bundle.manifest.createdAt,
    restoredAt: params.now,
    state: "applied",
  };
  const mutated = mutateRestoreDrillState({
    stateDir: params.stateDir,
    tenantId,
    fn: (state) => {
      const existingReceipt = state.drillReceipts[replayId];
      if (existingReceipt?.state === "applied") {
        return { ok: true, value: existingReceipt, state };
      }
      return {
        ok: true,
        value: receipt,
        state: {
          ...state,
          lastBackupAt: bundle.manifest.createdAt,
          lastRestoreAt: params.now,
          drillReceipts: { ...state.drillReceipts, [replayId]: receipt },
        },
      };
    },
  });
  destroyRestoreDrillCatalog({ stateDir: params.stateDir, tenantId });
  if (!mutated.ok) {
    return persistFailedRestoreDrill({
      stateDir: params.stateDir,
      tenantId,
      replayId,
      bundleId: bundle.manifest.bundleId,
      snapshotEpoch: bundle.manifest.snapshotEpoch,
      backupCreatedAt: bundle.manifest.createdAt,
      restoredAt: params.now,
      error: (mutated.error as RestoreDrillDenyCode) || "restore_drill_corrupt",
    });
  }
  return { ok: true, value: mutated.value };
}

export function readBackupRestoreObservability(params: RestoreDrillAuthParams): RestoreDrillResult<{
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
  backupAgeFail: boolean;
}> {
  const authorized = authorizeRestore(params);
  if (!authorized.ok) {
    return authorized;
  }
  const state = readRestoreDrillState({
    stateDir: params.stateDir,
    tenantId: authorized.value.tenantId,
  });
  const lastBackupAt = state?.lastBackupAt ?? null;
  const lastRestoreAt = state?.lastRestoreAt ?? null;
  if (!lastBackupAt) {
    return { ok: false, error: "backup_missing" };
  }
  return {
    ok: true,
    value: { lastBackupAt, lastRestoreAt, backupAgeFail: false },
  };
}

export function refuseRestoreMtimeAsTruth(): RestoreDrillResult<never> {
  return { ok: false, error: "mtime_truth_forbidden" };
}

/**
 * P5-d tenant / platform exit export and import drills (L11 / L12).
 * Builds and validates §3 exit bundles; import rewrites ids on an isolated Catalog.
 * Not P5-c same-tenant restore. Does not fork placement. No fs mtime truth.
 */
import { createHash } from "node:crypto";
import { isGovernanceActionAllowed } from "../governance-policy.js";
import {
  createFileDataGovernanceCatalogStore,
  loadValidatedCatalogRecordSync,
} from "./catalog-store.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import {
  destroyExitImportCatalog,
  mutateExitImportState,
  readExitImportState,
  writeExitImportCatalog,
} from "./exit-export-store.js";
import { isTenantKeyManagementAuth, type TenantKeyManagementAuth } from "./key-rotation-auth.js";
import { resolveDataGovernanceCatalogPath, resolveExitImportCatalogPath } from "./paths.js";
import {
  longevityMemberChecksum,
  merkleRootFromLeaves,
  type CanonicalBundleMember,
  type ClosureMember,
  type LongevityBundleLeaf,
  type PortableLongevityBundle,
} from "./restore-drill.js";
import type { CatalogRecord, ExitImportDrillReceipt, IdMappingReceipt } from "./types.js";

export type ExitLongevityMode = "cross_tenant_import" | "cross_platform_migration";

export type ExitLongevityBundle = Omit<PortableLongevityBundle, "manifest"> & {
  manifest: Omit<PortableLongevityBundle["manifest"], "mode"> & {
    mode: ExitLongevityMode;
    sourceTenantId: string;
  };
};

export type ExitExportDenyCode =
  | "actor_not_authorized"
  | "bundle_member_missing"
  | "bundle_member_excluded"
  | "member_checksum_mismatch"
  | "deletion_proof_missing"
  | "merkle_root_mismatch"
  | "record_count_mismatch"
  | "mode_not_exit_import"
  | "source_dest_tenant_same"
  | "mapping_checksum_mismatch"
  | "mapping_signature_invalid"
  | "import_epoch_moved"
  | "post_import_write"
  | "resurrect_forbidden"
  | "exit_import_corrupt"
  | "mtime_truth_forbidden"
  | "placement_authority_forbidden";

export type ExitExportResult<T> = { ok: true; value: T } | { ok: false; error: ExitExportDenyCode };

export type ExitImportAuthParams = {
  auth: TenantKeyManagementAuth;
  stateDir: string;
  destTenantId?: never;
};

const EXIT_MODES = new Set<ExitLongevityMode>(["cross_tenant_import", "cross_platform_migration"]);
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
const PLATFORM_TEST_SIGNATURE = "platform-test-signer-v1";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function memberChecksum(value: unknown): string {
  return sha256(Buffer.from(canonicalizeCognitiveJson(value), "utf8"));
}

function manifestIdentityChecksum(manifest: ExitLongevityBundle["manifest"]): string {
  const { checksums: _checksums, ...identity } = manifest;
  void _checksums;
  return memberChecksum(identity);
}

function closureIds(members: readonly ClosureMember[]): Set<string> {
  return new Set(members.map((row) => row.resourceId));
}

function authorizeExitImport(
  params: ExitImportAuthParams,
): ExitExportResult<{ destTenantId: string; auth: TenantKeyManagementAuth }> {
  if (params.destTenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isTenantKeyManagementAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const destTenantId = params.auth.callerTenantId.trim();
  if (!destTenantId || params.auth.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const allowed = isGovernanceActionAllowed(
    { role: params.auth.role, tenantId: destTenantId, userId: params.auth.actor.userId },
    "write",
    { kind: "tenant", tenantId: destTenantId },
  );
  if (!allowed) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { destTenantId, auth: params.auth } };
}

export function validateExitLongevityBundle(
  bundle: unknown,
): ExitExportResult<ExitLongevityBundle> {
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
  const manifest = raw.manifest as ExitLongevityBundle["manifest"];
  if (!EXIT_MODES.has(manifest.mode)) {
    return { ok: false, error: "mode_not_exit_import" };
  }
  if (
    !manifest.snapshotEpoch ||
    !manifest.logWatermark ||
    !manifest.merkleRoot ||
    !manifest.recordCounts ||
    !manifest.sourceTenantId
  ) {
    return { ok: false, error: "deletion_proof_missing" };
  }
  if (manifest.sourceTenantId !== manifest.tenantId) {
    return { ok: false, error: "member_checksum_mismatch" };
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
  const parsed = raw as unknown as ExitLongevityBundle;
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

function mappingEntriesChecksum(
  entries: readonly { fromId: string; toId: string; idClass: string }[],
): string {
  const sorted = [...entries].toSorted((left, right) =>
    `${left.idClass}:${left.fromId}:${left.toId}`.localeCompare(
      `${right.idClass}:${right.fromId}:${right.toId}`,
    ),
  );
  return sha256(Buffer.from(canonicalizeCognitiveJson(sorted), "utf8"));
}

function inverseEntriesChecksum(
  entries: readonly { fromId: string; toId: string; idClass: string }[],
): string {
  const inverted = entries.map((row) => ({
    fromId: row.toId,
    toId: row.fromId,
    idClass: row.idClass,
  }));
  return mappingEntriesChecksum(inverted);
}

export function destResourceIdForImport(destTenantId: string, sourceResourceId: string): string {
  return `ximp-${destTenantId}-${sha256(Buffer.from(sourceResourceId, "utf8")).slice(0, 16)}`;
}

function buildImportMapping(params: {
  bundle: ExitLongevityBundle;
  destTenantId: string;
}): IdMappingReceipt["entries"] {
  const ids = new Set<string>();
  for (const row of params.bundle.canonical) {
    ids.add(row.resourceId);
  }
  for (const row of params.bundle.deletionClosure.tombstones) {
    ids.add(row.resourceId);
  }
  for (const row of params.bundle.deletionClosure.revocations) {
    ids.add(row.resourceId);
  }
  for (const row of params.bundle.holdRetention) {
    ids.add(row.resourceId);
  }
  return [...ids].toSorted().map((fromId) => ({
    fromId,
    toId: destResourceIdForImport(params.destTenantId, fromId),
    idClass: "resourceId",
  }));
}

function verifyMappingReceipt(receipt: IdMappingReceipt): ExitExportResult<IdMappingReceipt> {
  if (receipt.signatureRef !== PLATFORM_TEST_SIGNATURE) {
    return { ok: false, error: "mapping_signature_invalid" };
  }
  if (mappingEntriesChecksum(receipt.entries) !== receipt.checksum) {
    return { ok: false, error: "mapping_checksum_mismatch" };
  }
  if (inverseEntriesChecksum(receipt.entries) !== receipt.inverseChecksum) {
    return { ok: false, error: "mapping_checksum_mismatch" };
  }
  return { ok: true, value: receipt };
}

function rewriteRecordForImport(params: {
  record: CatalogRecord;
  destTenantId: string;
  idMap: Map<string, string>;
}): CatalogRecord {
  const resourceId = params.idMap.get(params.record.envelope.resourceId)!;
  const canonicalBindingId = `bind-${resourceId}`;
  return {
    envelope: {
      ...params.record.envelope,
      resourceId,
      tenantId: params.destTenantId,
      scope: { kind: "tenant", tenantId: params.destTenantId },
      canonicalBindingId,
      governanceVersion: 1,
    },
    bindings: params.record.bindings.map((binding) => ({
      ...binding,
      resourceId: params.idMap.get(binding.resourceId) ?? resourceId,
      bindingId:
        binding.bindingId === params.record.envelope.canonicalBindingId
          ? canonicalBindingId
          : `bind-${params.idMap.get(binding.resourceId) ?? resourceId}-${binding.role}`,
    })),
  };
}

async function destCatalogEpoch(stateDir: string, destTenantId: string): Promise<string> {
  const store = createFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
  const existing = await store.list();
  let max = 0;
  for (const record of existing) {
    if (record.envelope.tenantId === destTenantId) {
      max = Math.max(max, record.envelope.governanceVersion);
    }
  }
  return String(max);
}

function persistFailedExitImport(params: {
  stateDir: string;
  destTenantId: string;
  replayId: string;
  sourceTenantId: string;
  bundleId: string;
  mode: ExitLongevityMode;
  mappingReceiptId: string;
  importedAt: string;
  error: ExitExportDenyCode;
}): ExitExportResult<never> {
  destroyExitImportCatalog({ stateDir: params.stateDir, destTenantId: params.destTenantId });
  const receipt: ExitImportDrillReceipt = {
    kind: "p5_exit_import_drill_receipt",
    receiptId: `eid_${sha256(Buffer.from(params.replayId, "utf8"))}`,
    replayId: params.replayId,
    sourceTenantId: params.sourceTenantId,
    destTenantId: params.destTenantId,
    bundleId: params.bundleId,
    mode: params.mode,
    mappingReceiptId: params.mappingReceiptId,
    importedResourceIds: [],
    importedAt: params.importedAt,
    state: "failed",
  };
  mutateExitImportState({
    stateDir: params.stateDir,
    destTenantId: params.destTenantId,
    fn: (state) => ({
      ok: true,
      value: receipt,
      state: {
        ...state,
        importDrillReceipts: { ...state.importDrillReceipts, [params.replayId]: receipt },
      },
    }),
  });
  return { ok: false, error: params.error };
}

export async function runExitImportDrill(
  params: ExitImportAuthParams & { bundle: unknown; now: string },
): Promise<ExitExportResult<ExitImportDrillReceipt>> {
  const authorized = authorizeExitImport(params);
  if (!authorized.ok) {
    return authorized;
  }
  const destTenantId = authorized.value.destTenantId;
  const productionCatalogPath = resolveDataGovernanceCatalogPath(params.stateDir);
  const importCatalogPath = resolveExitImportCatalogPath(params.stateDir, destTenantId);
  if (importCatalogPath === productionCatalogPath) {
    return { ok: false, error: "exit_import_corrupt" };
  }
  const validated = validateExitLongevityBundle(params.bundle);
  if (!validated.ok) {
    return validated;
  }
  const bundle = validated.value;
  const sourceTenantId = bundle.manifest.sourceTenantId;
  if (sourceTenantId === destTenantId) {
    return { ok: false, error: "source_dest_tenant_same" };
  }
  const replayId = `exit-import:${destTenantId}:${bundle.manifest.bundleId}:${bundle.manifest.snapshotEpoch}`;
  const existingApplied = readExitImportState({
    stateDir: params.stateDir,
    destTenantId,
  })?.importDrillReceipts[replayId];
  if (existingApplied?.state === "applied") {
    return { ok: true, value: existingApplied };
  }
  const expectedCatalogEpoch = await destCatalogEpoch(params.stateDir, destTenantId);
  const entries = buildImportMapping({ bundle, destTenantId });
  const mappingReceiptId = `imr_${sha256(Buffer.from(`${replayId}:${destTenantId}`, "utf8"))}`;
  const mappingReceipt: IdMappingReceipt = {
    kind: "p5_id_mapping_receipt",
    receiptId: mappingReceiptId,
    mode: bundle.manifest.mode,
    sourceTenantId,
    destTenantId,
    entries,
    checksum: mappingEntriesChecksum(entries),
    signatureRef: PLATFORM_TEST_SIGNATURE,
    inverseChecksum: inverseEntriesChecksum(entries),
    expectedCatalogEpoch,
    expectedImportEpoch: String(Number(expectedCatalogEpoch) + 1),
    fenceToken: sha256(Buffer.from(replayId, "utf8")),
    state: "prepared",
  };
  const verifiedMapping = verifyMappingReceipt(mappingReceipt);
  if (!verifiedMapping.ok) {
    return verifiedMapping;
  }
  const idMap = new Map(entries.map((row) => [row.fromId, row.toId]));
  const fail = (error: ExitExportDenyCode): ExitExportResult<never> =>
    persistFailedExitImport({
      stateDir: params.stateDir,
      destTenantId,
      replayId,
      sourceTenantId,
      bundleId: bundle.manifest.bundleId,
      mode: bundle.manifest.mode,
      mappingReceiptId,
      importedAt: params.now,
      error,
    });
  const toImport: CatalogRecord[] = [];
  for (const member of bundle.canonical) {
    if (member.record.envelope.tenantId !== sourceTenantId) {
      return fail("member_checksum_mismatch");
    }
    if (CLOSED_LIFECYCLES.has(member.record.envelope.lifecycleState)) {
      continue;
    }
    toImport.push(
      rewriteRecordForImport({
        record: member.record,
        destTenantId,
        idMap,
      }),
    );
  }
  try {
    writeExitImportCatalog({
      stateDir: params.stateDir,
      destTenantId,
      records: toImport,
    });
    for (const record of toImport) {
      const loaded = loadValidatedCatalogRecordSync({
        storePath: importCatalogPath,
        resourceId: record.envelope.resourceId,
      });
      if (
        !loaded ||
        loaded.record.envelope.tenantId !== destTenantId ||
        longevityMemberChecksum(loaded.record) !== longevityMemberChecksum(record)
      ) {
        return fail("exit_import_corrupt");
      }
    }
  } catch {
    return fail("exit_import_corrupt");
  }
  const appliedMapping: IdMappingReceipt = { ...mappingReceipt, state: "applied" };
  const receipt: ExitImportDrillReceipt = {
    kind: "p5_exit_import_drill_receipt",
    receiptId: `eid_${sha256(Buffer.from(replayId, "utf8"))}`,
    replayId,
    sourceTenantId,
    destTenantId,
    bundleId: bundle.manifest.bundleId,
    mode: bundle.manifest.mode,
    mappingReceiptId,
    importedResourceIds: toImport.map((row) => row.envelope.resourceId),
    importedAt: params.now,
    state: "applied",
  };
  const mutated = mutateExitImportState({
    stateDir: params.stateDir,
    destTenantId,
    fn: (state) => {
      const existingReceipt = state.importDrillReceipts[replayId];
      if (existingReceipt?.state === "applied") {
        return { ok: true, value: existingReceipt, state };
      }
      return {
        ok: true,
        value: receipt,
        state: {
          ...state,
          mappingReceipts: { ...state.mappingReceipts, [mappingReceiptId]: appliedMapping },
          importDrillReceipts: { ...state.importDrillReceipts, [replayId]: receipt },
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: "exit_import_corrupt" };
}

export function refusePlacementFromMappingReceipt(): ExitExportResult<never> {
  return { ok: false, error: "placement_authority_forbidden" };
}

export function refuseExitMtimeAsTruth(): ExitExportResult<never> {
  return { ok: false, error: "mtime_truth_forbidden" };
}

export type { CanonicalBundleMember };

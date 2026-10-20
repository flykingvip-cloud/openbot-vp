/**
 * P5-c integrity scan and content-format migration (L17).
 * Distinct receipts. Neither authorizes placement, promotion, or purge.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { isGovernanceActionAllowed } from "../governance-policy.js";
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
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import {
  parseGovernanceOperatedAt,
  parseSafeContentVersionToken,
  resolveImmutableContentLocator,
} from "./format-migration-locator.js";
import { isTenantKeyManagementAuth } from "./key-rotation-auth.js";
import { ownershipProofFromTenantUser } from "./ownership-proof.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import {
  mutateRestoreDrillState,
  readFormatMigrationJournal,
  readRestoreDrillState,
  unlinkFormatMigrationJournal,
  writeFormatMigrationJournal,
  type FormatMigrationJournal,
} from "./restore-drill-store.js";
import { validateLongevityBundle, type RestoreDrillAuthParams } from "./restore-drill.js";
import type {
  CatalogRecord,
  ContentFormatMigrationReceipt,
  IntegrityScanReceipt,
  StorageBinding,
} from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

export type IntegrityFormatDenyCode =
  | "actor_not_authorized"
  | "catalog_not_found"
  | "envelope_tenant_mismatch"
  | "ownership_mismatch"
  | "bundle_member_missing"
  | "placement_authority_forbidden"
  | "purge_authority_forbidden"
  | "mtime_truth_forbidden"
  | "content_missing"
  | "format_mismatch"
  | "unsupported_transform"
  | "transform_failed"
  | "transform_not_executed"
  | "content_version_unchanged"
  | "content_version_invalid"
  | "operated_at_invalid"
  | "migration_locator_invalid"
  | "catalog_cas_conflict"
  | "canonical_binding_missing"
  | "recovery_required";

export type IntegrityFormatResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IntegrityFormatDenyCode };

export type FormatMigrationAuthParams = {
  call: GovernanceAuthenticatedCall;
  stateDir: string;
  tenantId?: never;
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function authorizeScan(
  params: RestoreDrillAuthParams,
): IntegrityFormatResult<{ tenantId: string }> {
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
    "read",
    { kind: "tenant", tenantId },
  );
  if (!allowed) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { tenantId } };
}

function authorizeFormat(
  params: FormatMigrationAuthParams & { resourceId: string },
): IntegrityFormatResult<{ tenantId: string; call: GovernanceAuthenticatedCall }> {
  if (params.tenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isGovernanceAuthenticatedCall(params.call)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.call.callerTenantId?.trim() ?? "";
  if (!tenantId || params.call.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const loaded = loadValidatedCatalogRecordSync({
    storePath: resolveDataGovernanceCatalogPath(params.stateDir),
    resourceId: params.resourceId,
  });
  if (!loaded) {
    return { ok: false, error: "catalog_not_found" };
  }
  if (loaded.record.envelope.tenantId !== tenantId) {
    return { ok: false, error: "envelope_tenant_mismatch" };
  }
  try {
    assertOwnershipProofMatches(
      loaded.record,
      ownershipProofFromTenantUser({
        tenantId,
        userId: params.call.actor.userId,
      }),
    );
  } catch {
    return { ok: false, error: "ownership_mismatch" };
  }
  return { ok: true, value: { tenantId, call: params.call } };
}

export function scanTenantIntegrity(
  params: RestoreDrillAuthParams & { bundle: unknown },
): IntegrityFormatResult<IntegrityScanReceipt> {
  const authorized = authorizeScan(params);
  if (!authorized.ok) {
    return authorized;
  }
  const validated = validateLongevityBundle(params.bundle);
  if (!validated.ok) {
    return { ok: false, error: "bundle_member_missing" };
  }
  const bundle = validated.value;
  if (bundle.manifest.tenantId !== authorized.value.tenantId) {
    return { ok: false, error: "envelope_tenant_mismatch" };
  }
  const catalogPath = resolveDataGovernanceCatalogPath(params.stateDir);
  const findings: { resourceId: string; code: string }[] = [];
  for (const member of bundle.canonical) {
    const loaded = loadValidatedCatalogRecordSync({
      storePath: catalogPath,
      resourceId: member.resourceId,
    });
    if (!loaded) {
      findings.push({ resourceId: member.resourceId, code: "canonical_missing" });
      continue;
    }
    if (sha256(Buffer.from(canonicalizeCognitiveJson(loaded.record), "utf8")) !== member.checksum) {
      findings.push({ resourceId: member.resourceId, code: "checksum_mismatch" });
    }
  }
  const receipt: IntegrityScanReceipt = {
    kind: "p5_integrity_scan_receipt",
    receiptId: `isr_${sha256(Buffer.from(`${authorized.value.tenantId}:${bundle.manifest.bundleId}`, "utf8"))}`,
    tenantId: authorized.value.tenantId,
    scannedChecksum: bundle.manifest.merkleRoot,
    findings,
    state: "applied",
  };
  const mutated = mutateRestoreDrillState({
    stateDir: params.stateDir,
    tenantId: authorized.value.tenantId,
    fn: (state) => ({
      ok: true,
      value: receipt,
      state: {
        ...state,
        integrityReceipts: { ...state.integrityReceipts, [receipt.receiptId]: receipt },
      },
    }),
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: "bundle_member_missing" };
}

type ContentDocument = { format: string; body: string };

function parseContentDocument(bytes: Buffer): ContentDocument | null {
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as {
      format?: unknown;
      body?: unknown;
    };
    if (typeof parsed?.format === "string" && typeof parsed?.body === "string") {
      return { format: parsed.format, body: parsed.body };
    }
  } catch {
    return null;
  }
  return null;
}

function serializeContentDocument(document: ContentDocument): Buffer {
  return Buffer.from(`${JSON.stringify(document)}\n`, "utf8");
}

function canonicalBindingOf(record: CatalogRecord): StorageBinding | undefined {
  return record.bindings.find(
    (binding) =>
      binding.bindingId === record.envelope.canonicalBindingId && binding.role === "canonical",
  );
}

/** Real content-format transform. Returning without writing is not an applied migration. */
export function executeContentFormatTransform(params: {
  fromFormat: string;
  toFormat: string;
  body: string;
}): { transformId: string; body: string } {
  if (params.fromFormat === "markdown" && params.toFormat === "json") {
    return {
      transformId: "content-format:markdown->json:v1",
      body: JSON.stringify({ markdown: params.body }),
    };
  }
  throw new Error("unsupported_transform");
}

function persistFormatReceipt(params: {
  stateDir: string;
  tenantId: string;
  receipt: ContentFormatMigrationReceipt;
}): IntegrityFormatResult<ContentFormatMigrationReceipt> {
  const mutated = mutateRestoreDrillState({
    stateDir: params.stateDir,
    tenantId: params.tenantId,
    fn: (state) => {
      const existing = state.formatReceipts[params.receipt.receiptId];
      if (existing?.state === "applied" && params.receipt.state === "applied") {
        return { ok: true, value: existing, state };
      }
      return {
        ok: true,
        value: params.receipt,
        state: {
          ...state,
          formatReceipts: { ...state.formatReceipts, [params.receipt.receiptId]: params.receipt },
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: "recovery_required" };
}

function isTestRuntime(): boolean {
  return Boolean(
    process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.OPENBOT_TEST_PROFILE,
  );
}

function unlinkIfExists(dest: string): void {
  try {
    fs.unlinkSync(dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

function bytesMatchChecksum(bytes: Buffer | null, checksum: string): boolean {
  return bytes !== null && hashCanonicalBytes(bytes) === checksum;
}

function receiptFromJournal(
  journal: FormatMigrationJournal,
  state: ContentFormatMigrationReceipt["state"],
): ContentFormatMigrationReceipt {
  return {
    kind: "p5_content_format_migration_receipt",
    receiptId: journal.receiptId,
    resourceId: journal.resourceId,
    fromFormat: journal.fromFormat,
    toFormat: journal.toFormat,
    transformId: journal.transformId,
    fromContentVersion: journal.fromContentVersion,
    contentVersion: journal.contentVersion,
    sourceChecksum: journal.sourceChecksum,
    checksum: journal.resultChecksum,
    state,
  };
}

function catalogMatchesJournal(params: {
  record: CatalogRecord;
  journal: FormatMigrationJournal;
}): boolean {
  const binding = canonicalBindingOf(params.record);
  return (
    params.record.envelope.resourceId === params.journal.resourceId &&
    binding?.contentVersion === params.journal.contentVersion &&
    binding?.locator === params.journal.nextLocator &&
    binding?.objectKey === params.journal.resultChecksum &&
    params.record.envelope.governanceVersion === params.journal.expectedGovernanceVersion + 1
  );
}

function nextRecordForJournal(params: {
  record: CatalogRecord;
  journal: FormatMigrationJournal;
}): CatalogRecord {
  const binding = canonicalBindingOf(params.record);
  return {
    envelope: {
      ...params.record.envelope,
      resourceId: params.journal.resourceId,
      governanceVersion: params.journal.expectedGovernanceVersion + 1,
      updatedAt: params.journal.operatedAt,
    },
    bindings: params.record.bindings.map((row) =>
      row.bindingId === binding?.bindingId
        ? {
            ...row,
            resourceId: params.journal.resourceId,
            locator: params.journal.nextLocator,
            contentVersion: params.journal.contentVersion,
            objectKey: params.journal.resultChecksum,
          }
        : row,
    ),
  };
}

function reclaimPreviousLocator(journal: FormatMigrationJournal): void {
  if (journal.previousLocator !== journal.nextLocator) {
    unlinkIfExists(journal.previousLocator);
  }
}

async function finalizeAppliedFromJournal(params: {
  stateDir: string;
  journal: FormatMigrationJournal;
}): Promise<IntegrityFormatResult<ContentFormatMigrationReceipt>> {
  if (
    !bytesMatchChecksum(
      readLocalCanonicalBytes(params.journal.nextLocator),
      params.journal.resultChecksum,
    )
  ) {
    return { ok: false, error: "recovery_required" };
  }
  const applied = persistFormatReceipt({
    stateDir: params.stateDir,
    tenantId: params.journal.tenantId,
    receipt: receiptFromJournal(params.journal, "applied"),
  });
  if (!applied.ok) {
    return { ok: false, error: "recovery_required" };
  }
  unlinkFormatMigrationJournal({
    stateDir: params.stateDir,
    tenantId: params.journal.tenantId,
    resourceId: params.journal.resourceId,
  });
  reclaimPreviousLocator(params.journal);
  return applied;
}

async function recoverFormatMigrationIfNeeded(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): Promise<IntegrityFormatResult<ContentFormatMigrationReceipt> | null> {
  let journal: FormatMigrationJournal | null;
  try {
    journal = readFormatMigrationJournal(params);
  } catch {
    return { ok: false, error: "recovery_required" };
  }
  if (!journal) {
    return null;
  }
  const catalogPath = resolveDataGovernanceCatalogPath(params.stateDir);
  const loaded = loadValidatedCatalogRecordSync({
    storePath: catalogPath,
    resourceId: params.resourceId,
  });
  if (!loaded) {
    return { ok: false, error: "recovery_required" };
  }
  const nextBytes = readLocalCanonicalBytes(journal.nextLocator);
  const nextReady = bytesMatchChecksum(nextBytes, journal.resultChecksum);
  if (catalogMatchesJournal({ record: loaded.record, journal })) {
    if (nextReady) {
      return finalizeAppliedFromJournal({ stateDir: params.stateDir, journal });
    }
    return { ok: false, error: "recovery_required" };
  }
  if (!nextReady) {
    return { ok: false, error: "recovery_required" };
  }
  const cas = await createFileDataGovernanceCatalogStore({ storePath: catalogPath }).compareAndPut({
    resourceId: params.resourceId,
    expectedGovernanceVersion: journal.expectedGovernanceVersion,
    next: nextRecordForJournal({ record: loaded.record, journal }),
  });
  if (!cas.ok) {
    const latest = loadValidatedCatalogRecordSync({
      storePath: catalogPath,
      resourceId: params.resourceId,
    });
    if (latest && catalogMatchesJournal({ record: latest.record, journal })) {
      return finalizeAppliedFromJournal({ stateDir: params.stateDir, journal });
    }
    return { ok: false, error: "recovery_required" };
  }
  return finalizeAppliedFromJournal({ stateDir: params.stateDir, journal });
}

function existingAppliedReceipt(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
  fromFormat: string;
  toFormat: string;
  contentVersion: string;
}): ContentFormatMigrationReceipt | null {
  const state = readRestoreDrillState({ stateDir: params.stateDir, tenantId: params.tenantId });
  if (!state) {
    return null;
  }
  return (
    Object.values(state.formatReceipts).find(
      (receipt) =>
        receipt.state === "applied" &&
        receipt.resourceId === params.resourceId &&
        receipt.fromFormat === params.fromFormat &&
        receipt.toFormat === params.toFormat &&
        receipt.contentVersion === params.contentVersion,
    ) ?? null
  );
}

export async function migrateContentFormat(
  params: FormatMigrationAuthParams & {
    resourceId: string;
    fromFormat: string;
    toFormat: string;
    contentVersion: string;
    now: string;
    faultAfter?: "catalog_cas" | "receipt";
  },
): Promise<IntegrityFormatResult<ContentFormatMigrationReceipt>> {
  const contentVersionToken = parseSafeContentVersionToken(params.contentVersion);
  if (!contentVersionToken.ok) {
    return { ok: false, error: "content_version_invalid" };
  }
  const operatedAtParsed = parseGovernanceOperatedAt(params.now);
  if (!operatedAtParsed.ok) {
    return { ok: false, error: "operated_at_invalid" };
  }
  const contentVersion = contentVersionToken.value;
  const operatedAt = operatedAtParsed.value;
  const authorized = authorizeFormat(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const recovered = await recoverFormatMigrationIfNeeded({
    stateDir: params.stateDir,
    tenantId,
    resourceId: params.resourceId,
  });
  if (recovered) {
    return recovered;
  }
  const appliedExisting = existingAppliedReceipt({
    stateDir: params.stateDir,
    tenantId,
    resourceId: params.resourceId,
    fromFormat: params.fromFormat,
    toFormat: params.toFormat,
    contentVersion,
  });
  if (appliedExisting) {
    const loadedApplied = loadValidatedCatalogRecordSync({
      storePath: resolveDataGovernanceCatalogPath(params.stateDir),
      resourceId: params.resourceId,
    });
    const bindingApplied = loadedApplied ? canonicalBindingOf(loadedApplied.record) : undefined;
    const canonicalBytes = bindingApplied ? readLocalCanonicalBytes(bindingApplied.locator) : null;
    if (
      bindingApplied?.contentVersion === appliedExisting.contentVersion &&
      bytesMatchChecksum(canonicalBytes, appliedExisting.checksum)
    ) {
      return { ok: true, value: appliedExisting };
    }
  }
  const catalogPath = resolveDataGovernanceCatalogPath(params.stateDir);
  const loaded = loadValidatedCatalogRecordSync({
    storePath: catalogPath,
    resourceId: params.resourceId,
  });
  if (!loaded) {
    return { ok: false, error: "catalog_not_found" };
  }
  const binding = canonicalBindingOf(loaded.record);
  if (!binding) {
    return { ok: false, error: "canonical_binding_missing" };
  }
  const sourceBytes = readLocalCanonicalBytes(binding.locator);
  if (!sourceBytes) {
    return { ok: false, error: "content_missing" };
  }
  const sourceChecksum = hashCanonicalBytes(sourceBytes);
  const sourceDocument = parseContentDocument(sourceBytes);
  if (!sourceDocument || sourceDocument.format !== params.fromFormat) {
    return { ok: false, error: "format_mismatch" };
  }
  if (contentVersion === binding.contentVersion) {
    return { ok: false, error: "content_version_unchanged" };
  }
  let transformed: { transformId: string; body: string };
  try {
    transformed = executeContentFormatTransform({
      fromFormat: params.fromFormat,
      toFormat: params.toFormat,
      body: sourceDocument.body,
    });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    return {
      ok: false,
      error: message === "unsupported_transform" ? "unsupported_transform" : "transform_failed",
    };
  }
  const resultBytes = serializeContentDocument({
    format: params.toFormat,
    body: transformed.body,
  });
  const resultChecksum = hashCanonicalBytes(resultBytes);
  if (resultChecksum === sourceChecksum) {
    return { ok: false, error: "transform_not_executed" };
  }
  const nextLocatorResolved = resolveImmutableContentLocator({
    currentLocator: binding.locator,
    contentVersion,
    checksum: resultChecksum,
  });
  if (!nextLocatorResolved.ok) {
    return { ok: false, error: "migration_locator_invalid" };
  }
  const nextLocator = nextLocatorResolved.locator;
  try {
    writeLocalCanonicalBytes({ locator: nextLocator, bytes: resultBytes });
  } catch {
    return { ok: false, error: "transform_failed" };
  }
  if (!bytesMatchChecksum(readLocalCanonicalBytes(nextLocator), resultChecksum)) {
    unlinkIfExists(nextLocator);
    return { ok: false, error: "transform_failed" };
  }
  const receiptId = `cfr_${sha256(Buffer.from(`${params.resourceId}:${transformed.transformId}:${contentVersion}:${resultChecksum}`, "utf8"))}`;
  const journal: FormatMigrationJournal = {
    schemaVersion: 1,
    kind: "p5_content_format_migration_journal",
    tenantId,
    resourceId: params.resourceId,
    receiptId,
    previousLocator: binding.locator,
    nextLocator,
    fromFormat: params.fromFormat,
    toFormat: params.toFormat,
    transformId: transformed.transformId,
    fromContentVersion: binding.contentVersion,
    contentVersion,
    sourceChecksum,
    resultChecksum,
    expectedGovernanceVersion: loaded.record.envelope.governanceVersion,
    operatedAt,
  };
  try {
    writeFormatMigrationJournal({ stateDir: params.stateDir, journal });
  } catch {
    unlinkIfExists(nextLocator);
    return { ok: false, error: "transform_failed" };
  }
  const prepared = persistFormatReceipt({
    stateDir: params.stateDir,
    tenantId,
    receipt: receiptFromJournal(journal, "prepared"),
  });
  if (!prepared.ok) {
    unlinkIfExists(nextLocator);
    unlinkFormatMigrationJournal({
      stateDir: params.stateDir,
      tenantId,
      resourceId: params.resourceId,
    });
    return { ok: false, error: "recovery_required" };
  }
  const nextRecord = nextRecordForJournal({ record: loaded.record, journal });
  let cas: { ok: true; record: CatalogRecord } | { ok: false; conflict: string };
  try {
    cas = await createFileDataGovernanceCatalogStore({ storePath: catalogPath }).compareAndPut({
      resourceId: params.resourceId,
      expectedGovernanceVersion: loaded.record.envelope.governanceVersion,
      next: nextRecord,
    });
  } catch {
    return { ok: false, error: "recovery_required" };
  }
  if (!cas.ok) {
    unlinkIfExists(nextLocator);
    unlinkFormatMigrationJournal({
      stateDir: params.stateDir,
      tenantId,
      resourceId: params.resourceId,
    });
    return { ok: false, error: "catalog_cas_conflict" };
  }
  if (isTestRuntime() && params.faultAfter === "catalog_cas") {
    return { ok: false, error: "recovery_required" };
  }
  if (isTestRuntime() && params.faultAfter === "receipt") {
    return { ok: false, error: "recovery_required" };
  }
  return finalizeAppliedFromJournal({ stateDir: params.stateDir, journal });
}

export function refusePlacementFromIntegrityReceipt(): IntegrityFormatResult<never> {
  return { ok: false, error: "placement_authority_forbidden" };
}

export function refusePurgeFromFormatReceipt(): IntegrityFormatResult<never> {
  return { ok: false, error: "purge_authority_forbidden" };
}

export function refuseIntegrityMtimeAsTruth(): IntegrityFormatResult<never> {
  return { ok: false, error: "mtime_truth_forbidden" };
}

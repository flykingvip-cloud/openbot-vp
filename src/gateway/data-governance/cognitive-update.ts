import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import { runPrivilegedCognitiveCatalogCas } from "./cognitive-cas-internal.js";
import { getCognitiveMutationFaultHook } from "./cognitive-fault-slot.js";
import {
  canonicalizeCognitiveJson,
  computeCognitiveMutationFingerprint,
  createCognitiveMutationReceiptUnique,
  finalizeCognitiveMutationReceipt,
  getCognitiveMutationReceipt,
} from "./cognitive-mutation-store.js";
import {
  applyCognitivePatch,
  parseCognitivePatchInput,
  patchedFieldNames,
} from "./cognitive-patch.js";
import { createCognitiveProvenanceBindingUnique } from "./cognitive-provenance-internal.js";
import { isCognitiveWriteUnlocked } from "./cognitive-write-unlock.js";
import { parseCognitiveProvenanceRef } from "./envelope-cognitive.js";
import { isLegalHoldActive } from "./envelope.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type {
  ActorRef,
  CatalogRecord,
  CognitiveGovernanceMutationReceipt,
  CognitiveProvenanceRef,
  DataGovernanceEnvelope,
  EnvelopeValidationError,
} from "./types.js";

export type CognitiveWriteLockResult = {
  ok: false;
  error: "schema_write_locked";
};

export type UpdateCognitiveGovernanceParams = {
  resourceId: string;
  expectedGovernanceVersion: number;
  actor: ActorRef;
  patch: Record<string, unknown>;
  mutationId: string;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type SupersedeCognitiveProvenanceRefParams = {
  resourceId: string;
  expectedGovernanceVersion: number;
  actor: ActorRef;
  next: Record<string, unknown>;
  mutationId?: string;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type CognitiveUpdateResult =
  | { ok: true; receipt: CognitiveGovernanceMutationReceipt; record: CatalogRecord }
  | { ok: false; error: string; receipt?: CognitiveGovernanceMutationReceipt };

const BLOCKED_LIFECYCLES = new Set([
  "purged",
  "deletion_pending",
  "recovery_required",
  "quarantined",
]);

function catalogFor(params: {
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): DataGovernanceCatalogStore {
  if (params.catalog) {
    return params.catalog;
  }
  return getOrCreateFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(params.stateDir ?? resolveStateDir()),
  });
}

function denyLifecycle(envelope: DataGovernanceEnvelope, actor: ActorRef): string | null {
  if (envelope.resourceType !== "memory") {
    return "command_denied_for_type";
  }
  if (BLOCKED_LIFECYCLES.has(envelope.lifecycleState)) {
    return "lifecycle_blocks_write";
  }
  if (envelope.activeLifecycleOperation) {
    return "active_operation_blocks_write";
  }
  if (actor.kind === "worker" && isLegalHoldActive(envelope)) {
    return "actor_not_authorized";
  }
  return null;
}

function buildNextRecord(params: {
  current: CatalogRecord;
  mutationId: string;
  expected: number;
  cognitive: Pick<
    DataGovernanceEnvelope,
    "cognitiveTier" | "preservationPriority" | "retrievalGovernance"
  >;
}): CatalogRecord {
  const now = new Date().toISOString();
  return {
    ...params.current,
    envelope: {
      ...params.current.envelope,
      schemaVersion: 2,
      governanceVersion: params.expected + 1,
      updatedAt: now,
      lastCognitiveMutationId: params.mutationId,
      ...(params.cognitive.cognitiveTier !== undefined
        ? { cognitiveTier: params.cognitive.cognitiveTier }
        : {}),
      ...(params.cognitive.preservationPriority !== undefined
        ? { preservationPriority: params.cognitive.preservationPriority }
        : {}),
      ...(params.cognitive.retrievalGovernance !== undefined
        ? { retrievalGovernance: params.cognitive.retrievalGovernance }
        : {}),
    },
  };
}

export async function recoverCognitiveMutation(params: {
  mutationId: string;
  tenantId: string | null;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): Promise<CognitiveUpdateResult> {
  const catalog = catalogFor(params);
  const receipt = getCognitiveMutationReceipt({
    mutationId: params.mutationId,
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  if (!receipt) {
    return { ok: false, error: "not_found" };
  }
  const record = await catalog.get(receipt.resourceId);
  if (receipt.status === "applied") {
    const resulting = receipt.resultingGovernanceVersion;
    if (resulting === undefined) {
      return { ok: false, error: "catalog_corrupt", receipt };
    }
    if (!record || record.envelope.governanceVersion < resulting) {
      return { ok: false, error: "catalog_corrupt", receipt };
    }
    return { ok: true, receipt, record };
  }
  if (receipt.status === "conflicted" || receipt.status === "failed") {
    return { ok: false, error: receipt.status, receipt };
  }
  if (!record) {
    const failed = await finalizeCognitiveMutationReceipt({
      mutationId: receipt.mutationId,
      tenantId: receipt.tenantId,
      status: "failed",
      stateDir: params.stateDir,
    });
    return { ok: false, error: "failed", receipt: failed };
  }
  const marker = record.envelope.lastCognitiveMutationId ?? null;
  const version = record.envelope.governanceVersion;
  const expected = receipt.expectedGovernanceVersion;
  if (marker === receipt.mutationId && version === expected + 1) {
    const applied = await finalizeCognitiveMutationReceipt({
      mutationId: receipt.mutationId,
      tenantId: receipt.tenantId,
      status: "applied",
      resultingGovernanceVersion: expected + 1,
      stateDir: params.stateDir,
    });
    return { ok: true, receipt: applied, record };
  }
  if (marker === receipt.mutationId && version !== expected + 1) {
    return { ok: false, error: "catalog_corrupt", receipt };
  }
  if (version === expected && marker !== receipt.mutationId) {
    return { ok: false, error: "prepared", receipt };
  }
  if (version > expected && marker !== receipt.mutationId) {
    const conflicted = await finalizeCognitiveMutationReceipt({
      mutationId: receipt.mutationId,
      tenantId: receipt.tenantId,
      status: "conflicted",
      stateDir: params.stateDir,
    });
    return { ok: false, error: "conflicted", receipt: conflicted };
  }
  const failed = await finalizeCognitiveMutationReceipt({
    mutationId: receipt.mutationId,
    tenantId: receipt.tenantId,
    status: "failed",
    stateDir: params.stateDir,
  });
  return { ok: false, error: "failed", receipt: failed };
}

async function fencePriorMarker(params: {
  envelope: DataGovernanceEnvelope;
  stateDir?: string;
  catalog: DataGovernanceCatalogStore;
}): Promise<{ ok: true; fencedPriorId: string | null } | { ok: false; error: string }> {
  const priorId = params.envelope.lastCognitiveMutationId;
  if (!priorId) {
    return { ok: true, fencedPriorId: null };
  }
  const prior = getCognitiveMutationReceipt({
    mutationId: priorId,
    tenantId: params.envelope.tenantId,
    stateDir: params.stateDir,
  });
  if (!prior) {
    return { ok: false, error: "prior_mutation_inflight" };
  }
  if (prior.status === "applied") {
    return { ok: true, fencedPriorId: priorId };
  }
  if (prior.status === "conflicted" || prior.status === "failed") {
    return { ok: false, error: "prior_mutation_inflight" };
  }
  const recovered = await recoverCognitiveMutation({
    mutationId: priorId,
    tenantId: params.envelope.tenantId,
    stateDir: params.stateDir,
    catalog: params.catalog,
  });
  if (!recovered.ok && recovered.error === "catalog_corrupt") {
    return { ok: false, error: "catalog_corrupt" };
  }
  if (recovered.ok && recovered.receipt.status === "applied") {
    return { ok: true, fencedPriorId: priorId };
  }
  if (recovered.receipt?.status === "conflicted" || recovered.receipt?.status === "failed") {
    const refreshed = await params.catalog.get(params.envelope.resourceId);
    const named = refreshed?.envelope.lastCognitiveMutationId ?? null;
    if (named === priorId) {
      return { ok: false, error: "prior_mutation_inflight" };
    }
    return { ok: true, fencedPriorId: named };
  }
  return { ok: false, error: "prior_mutation_inflight" };
}

export async function updateCognitiveGovernance(
  params: UpdateCognitiveGovernanceParams,
): Promise<CognitiveUpdateResult | CognitiveWriteLockResult> {
  if (!isCognitiveWriteUnlocked(params.stateDir)) {
    return { ok: false, error: "schema_write_locked" };
  }
  const catalog = catalogFor(params);
  const current = await catalog.get(params.resourceId);
  if (!current) {
    return { ok: false, error: "not_found" };
  }
  const lifecycleDeny = denyLifecycle(current.envelope, params.actor);
  if (lifecycleDeny) {
    return { ok: false, error: lifecycleDeny };
  }
  const parsed = parseCognitivePatchInput(params.patch);
  if (!parsed.ok) {
    return parsed;
  }
  const canonicalPatchJson = canonicalizeCognitiveJson(parsed.patch);
  const fingerprint = computeCognitiveMutationFingerprint({
    resourceId: params.resourceId,
    tenantId: current.envelope.tenantId,
    command: "updateCognitiveGovernance",
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    actor: params.actor,
    canonicalPatchJson,
  });
  const existing = getCognitiveMutationReceipt({
    mutationId: params.mutationId,
    tenantId: current.envelope.tenantId,
    stateDir: params.stateDir,
  });
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      return { ok: false, error: "idempotent_mismatch" };
    }
    const recovered = await recoverCognitiveMutation({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      stateDir: params.stateDir,
      catalog,
    });
    if (recovered.ok || recovered.error !== "prepared") {
      return recovered;
    }
  }
  if (current.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, error: "version_conflict" };
  }
  const appliedPatch = applyCognitivePatch({
    envelope: current.envelope,
    actor: params.actor,
    patch: parsed.patch,
  });
  if (!appliedPatch.ok) {
    return appliedPatch;
  }
  const fence = await fencePriorMarker({
    envelope: current.envelope,
    stateDir: params.stateDir,
    catalog,
  });
  if (!fence.ok) {
    return { ok: false, error: fence.error };
  }
  const unique = await createCognitiveMutationReceiptUnique({
    mutationId: params.mutationId,
    requestFingerprint: fingerprint,
    resourceId: params.resourceId,
    tenantId: current.envelope.tenantId,
    command: "updateCognitiveGovernance",
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.actor,
    executedBy: params.actor,
    patchedFields: patchedFieldNames(parsed.patch),
    stateDir: params.stateDir,
  });
  if (!unique.ok) {
    return { ok: false, error: "idempotent_mismatch" };
  }
  if (unique.receipt.status !== "prepared") {
    return recoverCognitiveMutation({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      stateDir: params.stateDir,
      catalog,
    });
  }
  if (!unique.created) {
    const recovered = await recoverCognitiveMutation({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      stateDir: params.stateDir,
      catalog,
    });
    if (recovered.ok || recovered.error !== "prepared") {
      return recovered;
    }
  }
  const next = buildNextRecord({
    current,
    mutationId: params.mutationId,
    expected: params.expectedGovernanceVersion,
    cognitive: appliedPatch.next,
  });
  await getCognitiveMutationFaultHook()?.beforeCatalogCas?.();
  const cas = await runPrivilegedCognitiveCatalogCas(catalog, {
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    expectedLastCognitiveMutationId: fence.fencedPriorId,
    next,
  });
  if (!cas.ok) {
    const conflicted = await finalizeCognitiveMutationReceipt({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      status: "conflicted",
      stateDir: params.stateDir,
    });
    return { ok: false, error: "conflicted", receipt: conflicted };
  }
  await getCognitiveMutationFaultHook()?.afterCatalogCasBeforeFinalize?.();
  const applied = await finalizeCognitiveMutationReceipt({
    mutationId: params.mutationId,
    tenantId: current.envelope.tenantId,
    status: "applied",
    resultingGovernanceVersion: params.expectedGovernanceVersion + 1,
    stateDir: params.stateDir,
  });
  return { ok: true, receipt: applied, record: cas.record };
}

function parseNextProvenanceRef(
  next: Record<string, unknown>,
): { ok: true; ref: CognitiveProvenanceRef } | { ok: false; error: "invalid_cognitive_field" } {
  const errors: EnvelopeValidationError[] = [];
  const ref = parseCognitiveProvenanceRef(next, errors);
  if (!ref || errors.length > 0) {
    return { ok: false, error: "invalid_cognitive_field" };
  }
  return { ok: true, ref };
}

function supersessionValid(
  current: CognitiveProvenanceRef | undefined,
  next: CognitiveProvenanceRef,
): boolean {
  if (!current) {
    return true;
  }
  return (
    next.schemaPackage === current.schemaPackage &&
    next.nodeType === current.nodeType &&
    next.objectId === current.objectId &&
    next.version > current.version &&
    next.provenanceHash !== current.provenanceHash
  );
}

function buildProvenanceRecord(params: {
  current: CatalogRecord;
  mutationId: string;
  expected: number;
  ref: CognitiveProvenanceRef;
  bindingId: string;
}): CatalogRecord {
  const now = new Date().toISOString();
  return {
    ...params.current,
    envelope: {
      ...params.current.envelope,
      schemaVersion: 2,
      governanceVersion: params.expected + 1,
      updatedAt: now,
      lastCognitiveMutationId: params.mutationId,
      cognitiveProvenanceRef: params.ref,
      cognitiveProvenanceBindingId: params.bindingId,
    },
  };
}

export async function supersedeCognitiveProvenanceRef(
  params: SupersedeCognitiveProvenanceRefParams,
): Promise<CognitiveUpdateResult | CognitiveWriteLockResult> {
  if (!isCognitiveWriteUnlocked(params.stateDir)) {
    return { ok: false, error: "schema_write_locked" };
  }
  if (params.actor.kind !== "operator" && params.actor.kind !== "system") {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (typeof params.mutationId !== "string" || params.mutationId.trim().length === 0) {
    return { ok: false, error: "invalid_cognitive_field" };
  }
  const parsed = parseNextProvenanceRef(params.next);
  if (!parsed.ok) {
    return parsed;
  }
  const catalog = catalogFor(params);
  const current = await catalog.get(params.resourceId);
  if (!current) {
    return { ok: false, error: "not_found" };
  }
  const lifecycleDeny = denyLifecycle(current.envelope, params.actor);
  if (lifecycleDeny) {
    return { ok: false, error: lifecycleDeny };
  }
  const canonicalPatchJson = canonicalizeCognitiveJson({ next: parsed.ref });
  const fingerprint = computeCognitiveMutationFingerprint({
    resourceId: params.resourceId,
    tenantId: current.envelope.tenantId,
    command: "supersedeCognitiveProvenanceRef",
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    actor: params.actor,
    canonicalPatchJson,
  });
  const existing = getCognitiveMutationReceipt({
    mutationId: params.mutationId,
    tenantId: current.envelope.tenantId,
    stateDir: params.stateDir,
  });
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      return { ok: false, error: "idempotent_mismatch" };
    }
    const recovered = await recoverCognitiveMutation({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      stateDir: params.stateDir,
      catalog,
    });
    if (recovered.ok || recovered.error !== "prepared") {
      return recovered;
    }
  }
  if (current.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, error: "version_conflict" };
  }
  if (!supersessionValid(current.envelope.cognitiveProvenanceRef, parsed.ref)) {
    return { ok: false, error: "provenance_supersession_invalid" };
  }
  const expectedParent = current.envelope.cognitiveProvenanceBindingId ?? null;
  const uniqueBinding = await createCognitiveProvenanceBindingUnique({
    resourceId: params.resourceId,
    tenantId: current.envelope.tenantId,
    ref: parsed.ref,
    previousBindingId: expectedParent,
    actor: params.actor,
    stateDir: params.stateDir,
  });
  if (!uniqueBinding.ok) {
    return {
      ok: false,
      error:
        uniqueBinding.error === "stale_binding"
          ? "provenance_supersession_invalid"
          : "idempotent_mismatch",
    };
  }
  if (uniqueBinding.binding.previousBindingId !== expectedParent) {
    return { ok: false, error: "provenance_supersession_invalid" };
  }
  const fence = await fencePriorMarker({
    envelope: current.envelope,
    stateDir: params.stateDir,
    catalog,
  });
  if (!fence.ok) {
    return { ok: false, error: fence.error };
  }
  const unique = await createCognitiveMutationReceiptUnique({
    mutationId: params.mutationId,
    requestFingerprint: fingerprint,
    resourceId: params.resourceId,
    tenantId: current.envelope.tenantId,
    command: "supersedeCognitiveProvenanceRef",
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.actor,
    executedBy: params.actor,
    patchedFields: ["cognitiveProvenanceRef"],
    stateDir: params.stateDir,
  });
  if (!unique.ok) {
    return { ok: false, error: "idempotent_mismatch" };
  }
  if (unique.receipt.status !== "prepared") {
    return recoverCognitiveMutation({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      stateDir: params.stateDir,
      catalog,
    });
  }
  if (!unique.created) {
    const recovered = await recoverCognitiveMutation({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      stateDir: params.stateDir,
      catalog,
    });
    if (recovered.ok || recovered.error !== "prepared") {
      return recovered;
    }
  }
  const next = buildProvenanceRecord({
    current,
    mutationId: params.mutationId,
    expected: params.expectedGovernanceVersion,
    ref: parsed.ref,
    bindingId: uniqueBinding.binding.bindingId,
  });
  await getCognitiveMutationFaultHook()?.beforeCatalogCas?.();
  const latest = await catalog.get(params.resourceId);
  const latestParent = latest?.envelope.cognitiveProvenanceBindingId ?? null;
  if (!latest || uniqueBinding.binding.previousBindingId !== latestParent) {
    const conflicted = await finalizeCognitiveMutationReceipt({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      status: "conflicted",
      stateDir: params.stateDir,
    });
    return { ok: false, error: "provenance_supersession_invalid", receipt: conflicted };
  }
  if (latest.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    const conflicted = await finalizeCognitiveMutationReceipt({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      status: "conflicted",
      stateDir: params.stateDir,
    });
    return { ok: false, error: "conflicted", receipt: conflicted };
  }
  const cas = await runPrivilegedCognitiveCatalogCas(catalog, {
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    expectedLastCognitiveMutationId: fence.fencedPriorId,
    next,
  });
  if (!cas.ok) {
    const conflicted = await finalizeCognitiveMutationReceipt({
      mutationId: params.mutationId,
      tenantId: current.envelope.tenantId,
      status: "conflicted",
      stateDir: params.stateDir,
    });
    return { ok: false, error: "conflicted", receipt: conflicted };
  }
  await getCognitiveMutationFaultHook()?.afterCatalogCasBeforeFinalize?.();
  const applied = await finalizeCognitiveMutationReceipt({
    mutationId: params.mutationId,
    tenantId: current.envelope.tenantId,
    status: "applied",
    resultingGovernanceVersion: params.expectedGovernanceVersion + 1,
    stateDir: params.stateDir,
  });
  return { ok: true, receipt: applied, record: cas.record };
}

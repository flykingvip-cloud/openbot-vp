import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  readJsonIfPresent,
  withCognitiveFileLock,
  withCognitiveFileLockAsync,
  writeJsonDurable,
} from "./cognitive-file-lock.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import {
  resolveAgentAssetManifestHistoryRoot,
  resolveAgentAssetManifestMutationRoot,
  resolveAgentAssetManifestPointerRoot,
} from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  AgentAssetContinuityManifest,
  AgentAssetManifestPointer,
  PointerMutationReceipt,
} from "./types.js";

const LOCK_TIMEOUT = "agent_asset_manifest_lock_timeout";

const FORBIDDEN_EMBEDDED_KEYS = new Set([
  "persona",
  "personaBody",
  "capability",
  "capabilityBody",
  "capabilities",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "token",
  "apiKey",
  "password",
  "operationalIdentity",
  "oiPayload",
  "payload",
  "body",
]);

function safeId(value: string, label: string): string {
  return assertSafeRecoveryReceiptToken(
    value,
    label === "operationId" ? "operationId" : "operationId",
  );
}

function historyDir(agentAssetId: string, stateDir: string): string {
  const id = safeId(agentAssetId, "operationId");
  return path.resolve(resolveAgentAssetManifestHistoryRoot(stateDir), id);
}

function historyPath(agentAssetId: string, manifestId: string, stateDir: string): string {
  const mid = safeId(manifestId, "operationId");
  return path.resolve(historyDir(agentAssetId, stateDir), `${mid}.json`);
}

function pointerPath(agentAssetId: string, stateDir: string): string {
  const id = safeId(agentAssetId, "operationId");
  return path.resolve(
    resolveAgentAssetManifestPointerRoot(stateDir),
    id,
    "active-manifest-pointer.json",
  );
}

function mutationDir(agentAssetId: string, stateDir: string): string {
  const id = safeId(agentAssetId, "operationId");
  return path.resolve(resolveAgentAssetManifestMutationRoot(stateDir), id);
}

function mutationPath(agentAssetId: string, mutationId: string, stateDir: string): string {
  const mid = safeId(mutationId, "operationId");
  return path.resolve(mutationDir(agentAssetId, stateDir), `${mid}.json`);
}

function operationIndexPath(agentAssetId: string, operationId: string, stateDir: string): string {
  const oid = safeId(operationId, "operationId");
  return path.resolve(mutationDir(agentAssetId, stateDir), `by-operation`, `${oid}.json`);
}

function contentIndexPath(agentAssetId: string, contentKey: string, stateDir: string): string {
  const key = safeId(contentKey.slice(0, 64), "operationId");
  return path.resolve(historyDir(agentAssetId, stateDir), `by-content`, `${key}.json`);
}

export function hashManifestReferencedVersions(params: {
  personaVersionRef?: string;
  identityVersionRef: string;
  capabilitySetVersionRef: string;
  workingDnaVersionRef?: string;
  policyBaselineRef: string;
  experienceCheckpointRef?: string;
  operationalIdentityBindingRefs: string[];
}): string {
  return createHash("sha256")
    .update(
      canonicalizeCognitiveJson({
        personaVersionRef: params.personaVersionRef ?? null,
        identityVersionRef: params.identityVersionRef,
        capabilitySetVersionRef: params.capabilitySetVersionRef,
        workingDnaVersionRef: params.workingDnaVersionRef ?? null,
        policyBaselineRef: params.policyBaselineRef,
        experienceCheckpointRef: params.experienceCheckpointRef ?? null,
        operationalIdentityBindingRefs: [...params.operationalIdentityBindingRefs].toSorted(),
      }),
    )
    .digest("hex");
}

export function computeManifestContentKey(params: {
  agentAssetId: string;
  referencedVersionSetHash: string;
  reasonCode: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalizeCognitiveJson({
        agentAssetId: params.agentAssetId,
        referencedVersionSetHash: params.referencedVersionSetHash,
        reasonCode: params.reasonCode,
      }),
    )
    .digest("hex");
}

export function rejectEmbeddedManifestPayload(input: Record<string, unknown>): string | null {
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_EMBEDDED_KEYS.has(key)) {
      return key;
    }
  }
  return null;
}

function parseManifest(value: unknown): AgentAssetContinuityManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as AgentAssetContinuityManifest;
  if (raw.kind !== "agent_asset_continuity_manifest" || typeof raw.manifestId !== "string") {
    return null;
  }
  return raw;
}

function parsePointer(value: unknown): AgentAssetManifestPointer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as AgentAssetManifestPointer;
  if (raw.kind !== "agent_asset_manifest_pointer" || typeof raw.agentAssetId !== "string") {
    return null;
  }
  return raw;
}

function parseMutation(value: unknown): PointerMutationReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as PointerMutationReceipt;
  if (raw.kind !== "agent_asset_manifest_mutation" || typeof raw.mutationId !== "string") {
    return null;
  }
  return raw;
}

export function readAgentAssetManifest(params: {
  agentAssetId: string;
  manifestId: string;
  stateDir: string;
}): AgentAssetContinuityManifest | null {
  return parseManifest(
    readJsonIfPresent(historyPath(params.agentAssetId, params.manifestId, params.stateDir)),
  );
}

export function readAgentAssetManifestPointer(params: {
  agentAssetId: string;
  stateDir: string;
}): AgentAssetManifestPointer | null {
  return parsePointer(readJsonIfPresent(pointerPath(params.agentAssetId, params.stateDir)));
}

export function readManifestMutation(params: {
  agentAssetId: string;
  mutationId: string;
  stateDir: string;
}): PointerMutationReceipt | null {
  return parseMutation(
    readJsonIfPresent(mutationPath(params.agentAssetId, params.mutationId, params.stateDir)),
  );
}

export function readManifestMutationByOperation(params: {
  agentAssetId: string;
  operationId: string;
  stateDir: string;
}): PointerMutationReceipt | null {
  const index = readJsonIfPresent(
    operationIndexPath(params.agentAssetId, params.operationId, params.stateDir),
  ) as { mutationId?: string } | null;
  if (!index?.mutationId) {
    return null;
  }
  return readManifestMutation({
    agentAssetId: params.agentAssetId,
    mutationId: index.mutationId,
    stateDir: params.stateDir,
  });
}

export function findManifestByContentKey(params: {
  agentAssetId: string;
  contentKey: string;
  stateDir: string;
}): AgentAssetContinuityManifest | null {
  const index = readJsonIfPresent(
    contentIndexPath(params.agentAssetId, params.contentKey, params.stateDir),
  ) as { manifestId?: string } | null;
  if (!index?.manifestId) {
    return null;
  }
  return readAgentAssetManifest({
    agentAssetId: params.agentAssetId,
    manifestId: index.manifestId,
    stateDir: params.stateDir,
  });
}

export function listAgentAssetManifests(params: {
  agentAssetId: string;
  stateDir: string;
}): AgentAssetContinuityManifest[] {
  const root = historyDir(params.agentAssetId, params.stateDir);
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: AgentAssetContinuityManifest[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const parsed = parseManifest(readJsonIfPresent(path.join(root, name)));
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export async function uniqueCreateAgentAssetManifest(params: {
  manifest: AgentAssetContinuityManifest;
  stateDir: string;
}): Promise<
  | { ok: true; manifest: AgentAssetContinuityManifest; created: boolean }
  | { ok: false; existing: AgentAssetContinuityManifest }
> {
  const contentIdx = contentIndexPath(
    params.manifest.agentAssetId,
    params.manifest.contentKey,
    params.stateDir,
  );
  const dest = historyPath(
    params.manifest.agentAssetId,
    params.manifest.manifestId,
    params.stateDir,
  );
  let existing: AgentAssetContinuityManifest | null = null;
  let created: AgentAssetContinuityManifest | null = null;
  let reused = false;
  await withCognitiveFileLock(`${contentIdx}.lock`, LOCK_TIMEOUT, () => {
    const byContent = findManifestByContentKey({
      agentAssetId: params.manifest.agentAssetId,
      contentKey: params.manifest.contentKey,
      stateDir: params.stateDir,
    });
    if (byContent) {
      existing = byContent;
      reused = true;
      return;
    }
    const prior = parseManifest(readJsonIfPresent(dest));
    if (prior) {
      existing = prior;
      return;
    }
    writeJsonDurable(dest, params.manifest);
    writeJsonDurable(contentIdx, {
      contentKey: params.manifest.contentKey,
      manifestId: params.manifest.manifestId,
    });
    created = params.manifest;
  });
  if (reused && existing) {
    return { ok: true, manifest: existing, created: false };
  }
  if (existing) {
    return { ok: false, existing };
  }
  if (!created) {
    throw new Error("agent_asset_manifest_create_failed");
  }
  return { ok: true, manifest: created, created: true };
}

/**
 * Operation-scoped receipt access. Every read/write inside a {@link withManifestOperation}
 * critical section is serialized by the **operation index** lock, so two requests carrying
 * the same `operationId` with independently generated `mutationId`s cannot both create a
 * receipt or both replace the index (B31 operation idempotency).
 */
export type ManifestOperationHandle = {
  readonly agentAssetId: string;
  readonly operationId: string;
  /** The one receipt this operation is indexed to, if any. */
  readReceipt(): PointerMutationReceipt | null;
  /** Durably create receipt-then-index; a second caller gets the indexed receipt back. */
  createReceipt(
    receipt: PointerMutationReceipt,
  ):
    | { ok: true; receipt: PointerMutationReceipt }
    | { ok: false; existing: PointerMutationReceipt };
  /** Finalize the indexed receipt. Refuses to write a receipt this operation does not own. */
  putReceipt(receipt: PointerMutationReceipt): PointerMutationReceipt;
};

/**
 * Run `fn` holding the operation-index lock for `(agentAssetId, operationId)`.
 *
 * The operation index — not the randomly generated mutation destination — is the uniqueness
 * authority, so the lock is derived from the index path and covers the whole
 * read-decide-create-finalize sequence including the pointer CAS.
 */
export async function withManifestOperation<T>(
  params: { agentAssetId: string; operationId: string; stateDir: string },
  fn: (handle: ManifestOperationHandle) => T | Promise<T>,
): Promise<T> {
  const opIdx = operationIndexPath(params.agentAssetId, params.operationId, params.stateDir);
  const handle: ManifestOperationHandle = {
    agentAssetId: params.agentAssetId,
    operationId: params.operationId,
    readReceipt: () =>
      readManifestMutationByOperation({
        agentAssetId: params.agentAssetId,
        operationId: params.operationId,
        stateDir: params.stateDir,
      }),
    createReceipt: (receipt) => {
      if (
        receipt.operationId !== params.operationId ||
        receipt.resourceKey !== params.agentAssetId
      ) {
        throw new Error("agent_asset_manifest_mutation_operation_mismatch");
      }
      const indexed = handle.readReceipt();
      if (indexed) {
        return { ok: false, existing: indexed };
      }
      const dest = mutationPath(params.agentAssetId, receipt.mutationId, params.stateDir);
      const prior = parseMutation(readJsonIfPresent(dest));
      if (prior) {
        return { ok: false, existing: prior };
      }
      // Receipt first, then its index: a crash between the two leaves an unindexed receipt,
      // never an index pointing at a receipt that does not exist.
      writeJsonDurable(dest, receipt);
      writeJsonDurable(opIdx, {
        operationId: receipt.operationId,
        mutationId: receipt.mutationId,
      });
      return { ok: true, receipt };
    },
    putReceipt: (receipt) => {
      const indexed = handle.readReceipt();
      if (!indexed || indexed.mutationId !== receipt.mutationId) {
        throw new Error("agent_asset_manifest_mutation_not_indexed");
      }
      const next: PointerMutationReceipt = { ...receipt, updatedAt: new Date().toISOString() };
      writeJsonDurable(
        mutationPath(params.agentAssetId, receipt.mutationId, params.stateDir),
        next,
      );
      return next;
    },
  };
  return withCognitiveFileLockAsync(`${opIdx}.lock`, LOCK_TIMEOUT, () => fn(handle));
}

export async function compareAndPutManifestPointer(params: {
  agentAssetId: string;
  stateDir: string;
  expectedPointerVersion: number;
  next: AgentAssetManifestPointer;
}): Promise<
  | { ok: true; pointer: AgentAssetManifestPointer }
  | { ok: false; conflict: "version_conflict"; current: AgentAssetManifestPointer | null }
> {
  const dest = pointerPath(params.agentAssetId, params.stateDir);
  let outcome:
    | { ok: true; pointer: AgentAssetManifestPointer }
    | { ok: false; conflict: "version_conflict"; current: AgentAssetManifestPointer | null }
    | null = null;
  await withCognitiveFileLock(`${dest}.lock`, LOCK_TIMEOUT, () => {
    const current = parsePointer(readJsonIfPresent(dest));
    const currentVersion = current?.pointerVersion ?? 0;
    if (currentVersion !== params.expectedPointerVersion) {
      outcome = { ok: false, conflict: "version_conflict", current };
      return;
    }
    if (params.next.pointerVersion !== params.expectedPointerVersion + 1) {
      outcome = { ok: false, conflict: "version_conflict", current };
      return;
    }
    writeJsonDurable(dest, params.next);
    outcome = { ok: true, pointer: params.next };
  });
  if (!outcome) {
    throw new Error("agent_asset_manifest_pointer_cas_failed");
  }
  return outcome;
}

export function listManifestMutations(params: {
  agentAssetId: string;
  stateDir: string;
}): PointerMutationReceipt[] {
  const root = mutationDir(params.agentAssetId, params.stateDir);
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: PointerMutationReceipt[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const parsed = parseMutation(readJsonIfPresent(path.join(root, name)));
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

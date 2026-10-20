import fs from "node:fs";
import path from "node:path";
import {
  readJsonIfPresent,
  withCognitiveFileLock,
  withCognitiveFileLockAsync,
  writeJsonDurable,
} from "./cognitive-file-lock.js";
import {
  resolveCognitiveAnchorHistoryRoot,
  resolveCognitiveAnchorMutationRoot,
  resolveCognitiveAnchorPointerRoot,
} from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  AnchorActivePointer,
  DerivedAnchorStatus,
  HumanVerifiedAnchor,
  PointerMutationReceipt,
} from "./types.js";

const LOCK_TIMEOUT = "cognitive_anchor_lock_timeout";

function safeId(value: string): string {
  return assertSafeRecoveryReceiptToken(value, "operationId");
}

function historyDir(resourceId: string, stateDir: string): string {
  return path.resolve(resolveCognitiveAnchorHistoryRoot(stateDir), safeId(resourceId));
}

function historyPath(resourceId: string, anchorId: string, stateDir: string): string {
  return path.resolve(historyDir(resourceId, stateDir), `${safeId(anchorId)}.json`);
}

function pointerPath(resourceId: string, stateDir: string): string {
  return path.resolve(
    resolveCognitiveAnchorPointerRoot(stateDir),
    safeId(resourceId),
    "active-anchor-pointer.json",
  );
}

function mutationDir(resourceId: string, stateDir: string): string {
  return path.resolve(resolveCognitiveAnchorMutationRoot(stateDir), safeId(resourceId));
}

function mutationPath(resourceId: string, mutationId: string, stateDir: string): string {
  return path.resolve(mutationDir(resourceId, stateDir), `${safeId(mutationId)}.json`);
}

function operationIndexPath(resourceId: string, operationId: string, stateDir: string): string {
  return path.resolve(
    mutationDir(resourceId, stateDir),
    "by-operation",
    `${safeId(operationId)}.json`,
  );
}

function parseAnchor(value: unknown): HumanVerifiedAnchor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as HumanVerifiedAnchor;
  if (raw.kind !== "human_verified_anchor" || typeof raw.anchorId !== "string") {
    return null;
  }
  return raw;
}

function parsePointer(value: unknown): AnchorActivePointer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as AnchorActivePointer;
  if (raw.kind !== "anchor_active_pointer" || typeof raw.resourceId !== "string") {
    return null;
  }
  return raw;
}

function parseMutation(value: unknown): PointerMutationReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as PointerMutationReceipt;
  if (raw.kind !== "anchor_mutation" || typeof raw.mutationId !== "string") {
    return null;
  }
  return raw;
}

export function readHumanVerifiedAnchor(params: {
  resourceId: string;
  anchorId: string;
  stateDir: string;
}): HumanVerifiedAnchor | null {
  return parseAnchor(
    readJsonIfPresent(historyPath(params.resourceId, params.anchorId, params.stateDir)),
  );
}

export function readAnchorPointer(params: {
  resourceId: string;
  stateDir: string;
}): AnchorActivePointer | null {
  return parsePointer(readJsonIfPresent(pointerPath(params.resourceId, params.stateDir)));
}

export function listHumanVerifiedAnchors(params: {
  resourceId: string;
  stateDir: string;
}): HumanVerifiedAnchor[] {
  const root = historyDir(params.resourceId, params.stateDir);
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: HumanVerifiedAnchor[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const parsed = parseAnchor(readJsonIfPresent(path.join(root, name)));
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export function readAnchorMutation(params: {
  resourceId: string;
  mutationId: string;
  stateDir: string;
}): PointerMutationReceipt | null {
  return parseMutation(
    readJsonIfPresent(mutationPath(params.resourceId, params.mutationId, params.stateDir)),
  );
}

export function readAnchorMutationByOperation(params: {
  resourceId: string;
  operationId: string;
  stateDir: string;
}): PointerMutationReceipt | null {
  const index = readJsonIfPresent(
    operationIndexPath(params.resourceId, params.operationId, params.stateDir),
  ) as { mutationId?: string } | null;
  if (!index?.mutationId) {
    return null;
  }
  return readAnchorMutation({
    resourceId: params.resourceId,
    mutationId: index.mutationId,
    stateDir: params.stateDir,
  });
}

export function listAnchorMutations(params: {
  resourceId: string;
  stateDir: string;
}): PointerMutationReceipt[] {
  const root = mutationDir(params.resourceId, params.stateDir);
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

export function deriveAnchorStatus(params: {
  row: HumanVerifiedAnchor;
  pointer: AnchorActivePointer | null;
  allRows: HumanVerifiedAnchor[];
}): DerivedAnchorStatus {
  const pointer = params.pointer;
  const row = params.row;
  if (pointer?.pointerState === "active" && pointer.activeAnchorId === row.anchorId) {
    return "active";
  }
  if (pointer?.pointerState === "revoked" && pointer.revokedAnchorId === row.anchorId) {
    return "revoked";
  }
  if (pointer?.pointerState === "revoked" && pointer.revocationRowId === row.anchorId) {
    return "revocation_record";
  }
  const supersededByLater = params.allRows.some(
    (other) =>
      other.supersedesAnchorId === row.anchorId &&
      other.anchorId !== row.anchorId &&
      other.createdAt >= row.createdAt,
  );
  if (
    supersededByLater &&
    pointer?.revokedAnchorId !== row.anchorId &&
    pointer?.activeAnchorId !== row.anchorId
  ) {
    return "superseded";
  }
  if (row.rowKind === "proposal") {
    const everNamed =
      pointer?.activeAnchorId === row.anchorId ||
      pointer?.revokedAnchorId === row.anchorId ||
      pointer?.revocationRowId === row.anchorId;
    if (!everNamed) {
      return "proposed";
    }
  }
  if (supersededByLater) {
    return "superseded";
  }
  return "proposed";
}

export async function uniqueCreateHumanVerifiedAnchor(params: {
  anchor: HumanVerifiedAnchor;
  stateDir: string;
}): Promise<
  { ok: true; anchor: HumanVerifiedAnchor } | { ok: false; existing: HumanVerifiedAnchor }
> {
  const dest = historyPath(params.anchor.resourceId, params.anchor.anchorId, params.stateDir);
  let existing: HumanVerifiedAnchor | null = null;
  let created: HumanVerifiedAnchor | null = null;
  await withCognitiveFileLock(`${dest}.lock`, LOCK_TIMEOUT, () => {
    const prior = parseAnchor(readJsonIfPresent(dest));
    if (prior) {
      existing = prior;
      return;
    }
    writeJsonDurable(dest, params.anchor);
    created = params.anchor;
  });
  if (existing) {
    return { ok: false, existing };
  }
  if (!created) {
    throw new Error("human_verified_anchor_create_failed");
  }
  return { ok: true, anchor: created };
}

/**
 * Operation-scoped receipt access for anchors. Same rule as the manifest store: the
 * **operation index** path is the uniqueness authority and the lock, so two requests with
 * one `operationId` and two generated `mutationId`s cannot both create a receipt.
 */
export type AnchorOperationHandle = {
  readonly resourceId: string;
  readonly operationId: string;
  readReceipt(): PointerMutationReceipt | null;
  createReceipt(
    receipt: PointerMutationReceipt,
  ):
    | { ok: true; receipt: PointerMutationReceipt }
    | { ok: false; existing: PointerMutationReceipt };
  putReceipt(receipt: PointerMutationReceipt): PointerMutationReceipt;
};

/** Run `fn` holding the `(resourceId, operationId)` operation-index lock. */
export async function withAnchorOperation<T>(
  params: { resourceId: string; operationId: string; stateDir: string },
  fn: (handle: AnchorOperationHandle) => T | Promise<T>,
): Promise<T> {
  const opIdx = operationIndexPath(params.resourceId, params.operationId, params.stateDir);
  const handle: AnchorOperationHandle = {
    resourceId: params.resourceId,
    operationId: params.operationId,
    readReceipt: () =>
      readAnchorMutationByOperation({
        resourceId: params.resourceId,
        operationId: params.operationId,
        stateDir: params.stateDir,
      }),
    createReceipt: (receipt) => {
      if (receipt.operationId !== params.operationId || receipt.resourceKey !== params.resourceId) {
        throw new Error("anchor_mutation_operation_mismatch");
      }
      const indexed = handle.readReceipt();
      if (indexed) {
        return { ok: false, existing: indexed };
      }
      const dest = mutationPath(params.resourceId, receipt.mutationId, params.stateDir);
      const prior = parseMutation(readJsonIfPresent(dest));
      if (prior) {
        return { ok: false, existing: prior };
      }
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
        throw new Error("anchor_mutation_not_indexed");
      }
      const next: PointerMutationReceipt = { ...receipt, updatedAt: new Date().toISOString() };
      writeJsonDurable(mutationPath(params.resourceId, receipt.mutationId, params.stateDir), next);
      return next;
    },
  };
  return withCognitiveFileLockAsync(`${opIdx}.lock`, LOCK_TIMEOUT, () => fn(handle));
}

export async function compareAndPutAnchorPointer(params: {
  resourceId: string;
  stateDir: string;
  expectedPointerVersion: number;
  next: AnchorActivePointer;
}): Promise<
  | { ok: true; pointer: AnchorActivePointer }
  | { ok: false; conflict: "version_conflict"; current: AnchorActivePointer | null }
> {
  const dest = pointerPath(params.resourceId, params.stateDir);
  let outcome:
    | { ok: true; pointer: AnchorActivePointer }
    | { ok: false; conflict: "version_conflict"; current: AnchorActivePointer | null }
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
    throw new Error("anchor_pointer_cas_failed");
  }
  return outcome;
}

/** True when the resource currently has a live active anchor (B12 / test 48). */
export function resourceHasActiveAnchor(params: { resourceId: string; stateDir: string }): boolean {
  const pointer = readAnchorPointer(params);
  return pointer?.pointerState === "active" && Boolean(pointer.activeAnchorId);
}

/**
 * Durable P4-b promotion receipt store. Unique by replayId.
 * Grant consumption is recorded in the same file revision as the prepared receipt.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import {
  compareAndConsumeGovernanceApprovalGrantUnlocked,
  readGovernanceApprovalGrant,
  withGovernanceApprovalGrantLockSync,
} from "./cognitive-approval-grant-store.js";
import { resolveCognitivePromotionRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type { CognitiveProjectionTombstoneReceipt, CognitivePromotionReceipt } from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

const RECEIPT_STATES = new Set<CognitivePromotionReceipt["state"]>([
  "prepared",
  "applied",
  "conflicted",
  "failed",
  "aborted",
]);

type PromotionFileShape = {
  schemaVersion: 1;
  revision: number;
  receipts: Record<string, CognitivePromotionReceipt>;
  consumedGrants: Record<string, string>;
};

export type PreparePromotionTxnResult =
  | { ok: true; receipt: CognitivePromotionReceipt; created: boolean }
  | {
      ok: false;
      conflict:
        | "grant_consumed"
        | "grant_consumed_without_receipt"
        | "grant_revoked"
        | "grant_expired"
        | "grant_not_unused"
        | "grant_not_found"
        | "recovery_required";
    };

type PrepareTxnJournal = {
  schemaVersion: 1;
  kind: "cognitive_promotion_prepare_txn";
  receipt: CognitivePromotionReceipt;
  grantTenantId: string | null;
};

type PrepareTxnRecoveryMarker = {
  schemaVersion: 1;
  kind: "cognitive_promotion_prepare_recovery";
  replayId: string;
  grantId: string;
  reason: string;
  journalPresent: true;
  createdAt: string;
};

const SUCCESS_RECEIPT_STATES = new Set(["prepared", "applied"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withExclusiveLockAsync(lockPath: string, fn: () => void): Promise<void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error("cognitive_promotion_lock_timeout");
}

function storePathFor(stateDir: string): string {
  return path.join(path.resolve(resolveCognitivePromotionRoot(stateDir)), "applies.json");
}

function emptyFile(): PromotionFileShape {
  return { schemaVersion: 1, revision: 0, receipts: {}, consumedGrants: {} };
}

export function parseCognitivePromotionReceipt(value: unknown): CognitivePromotionReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "cognitive_promotion_receipt") {
    return null;
  }
  const requiredStrings = [
    "receiptId",
    "replayId",
    "grantId",
    "recommendationId",
    "resourceId",
    "tenantId",
    "decisionReasonCode",
    "fromBindingId",
    "toCanonicalBindingId",
    "contentVersion",
    "createdAt",
    "updatedAt",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof raw[key] !== "string" || raw[key].trim() === "") {
      return null;
    }
  }
  if (raw.decision !== "recommend_admit") {
    return null;
  }
  if (
    raw.placementMode !== "local-only" &&
    raw.placementMode !== "encrypted-cloud" &&
    raw.placementMode !== "tenant-cloud" &&
    raw.placementMode !== "dedicated" &&
    raw.placementMode !== "byos" &&
    raw.placementMode !== "cold-archive"
  ) {
    return null;
  }
  if (
    raw.canonicalHome !== "local" &&
    raw.canonicalHome !== "managed_encrypted_cloud" &&
    raw.canonicalHome !== "tenant_managed_cloud" &&
    raw.canonicalHome !== "dedicated_regional" &&
    raw.canonicalHome !== "byos" &&
    raw.canonicalHome !== "cold_archive"
  ) {
    return null;
  }
  if (
    typeof raw.state !== "string" ||
    !RECEIPT_STATES.has(raw.state as CognitivePromotionReceipt["state"])
  ) {
    return null;
  }
  const optionalString = (
    key: "projectionBindingId" | "keyRefId" | "region" | "consentVersion" | "policyVersion",
  ): string | undefined => {
    if (raw[key] === undefined) {
      return undefined;
    }
    return typeof raw[key] === "string" && raw[key].trim() !== "" ? raw[key] : undefined;
  };
  if (raw.projectionBindingId !== undefined && !optionalString("projectionBindingId")) {
    return null;
  }
  if (raw.keyRefId !== undefined && !optionalString("keyRefId")) {
    return null;
  }
  if (raw.region !== undefined && !optionalString("region")) {
    return null;
  }
  if (raw.consentVersion !== undefined && !optionalString("consentVersion")) {
    return null;
  }
  if (raw.policyVersion !== undefined && !optionalString("policyVersion")) {
    return null;
  }
  // Prepared, conflicted, and aborted receipts omit checksum. P4-c hashes
  // canonical bytes at apply. A forged checksum is rejected so locator
  // metadata cannot pose as content bytes. conflicted / aborted are
  // fail-closed recovery evidence, not a replay.
  if (raw.state === "prepared" || raw.state === "conflicted" || raw.state === "aborted") {
    if (raw.checksum !== undefined) {
      return null;
    }
  } else if (typeof raw.checksum !== "string" || raw.checksum.trim() === "") {
    return null;
  }
  return {
    kind: "cognitive_promotion_receipt",
    receiptId: raw.receiptId as string,
    replayId: raw.replayId as string,
    grantId: raw.grantId as string,
    recommendationId: raw.recommendationId as string,
    resourceId: raw.resourceId as string,
    tenantId: raw.tenantId as string,
    decision: "recommend_admit",
    decisionReasonCode: raw.decisionReasonCode as string,
    placementMode: raw.placementMode,
    canonicalHome: raw.canonicalHome,
    fromBindingId: raw.fromBindingId as string,
    toCanonicalBindingId: raw.toCanonicalBindingId as string,
    ...(optionalString("projectionBindingId")
      ? { projectionBindingId: optionalString("projectionBindingId") }
      : {}),
    ...(optionalString("keyRefId") ? { keyRefId: optionalString("keyRefId") } : {}),
    ...(optionalString("region") ? { region: optionalString("region") } : {}),
    ...(optionalString("consentVersion")
      ? { consentVersion: optionalString("consentVersion") }
      : {}),
    ...(optionalString("policyVersion") ? { policyVersion: optionalString("policyVersion") } : {}),
    contentVersion: raw.contentVersion as string,
    ...(typeof raw.checksum === "string" ? { checksum: raw.checksum } : {}),
    state: raw.state as CognitivePromotionReceipt["state"],
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

function readFile(storePath: string): PromotionFileShape {
  if (!fs.existsSync(storePath)) {
    return emptyFile();
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as PromotionFileShape;
  if (
    parsed?.schemaVersion !== 1 ||
    !parsed.receipts ||
    typeof parsed.receipts !== "object" ||
    !parsed.consumedGrants ||
    typeof parsed.consumedGrants !== "object" ||
    typeof parsed.revision !== "number"
  ) {
    throw new Error("cognitive_promotion_store_corrupt");
  }
  return parsed;
}

function writeFileDurable(storePath: string, file: object): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, storePath);
}

function journalPathFor(stateDir: string): string {
  return `${storePathFor(stateDir)}.prepare-txn`;
}

function isTestRuntime(): boolean {
  return Boolean(
    process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.OPENBOT_TEST_PROFILE,
  );
}

function parsePrepareTxnJournal(value: unknown): PrepareTxnJournal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || raw.kind !== "cognitive_promotion_prepare_txn") {
    return null;
  }
  const receipt = parseCognitivePromotionReceipt(raw.receipt);
  if (!receipt || receipt.state !== "prepared") {
    return null;
  }
  const grantTenantId =
    raw.grantTenantId === null || typeof raw.grantTenantId === "string" ? raw.grantTenantId : null;
  if (raw.grantTenantId !== null && raw.grantTenantId !== grantTenantId) {
    return null;
  }
  return { schemaVersion: 1, kind: "cognitive_promotion_prepare_txn", receipt, grantTenantId };
}

function readPrepareTxnJournal(stateDir: string): PrepareTxnJournal | null {
  const dest = journalPathFor(stateDir);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parsePrepareTxnJournal(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

function writePrepareTxnJournal(stateDir: string, journal: PrepareTxnJournal): void {
  const dest = journalPathFor(stateDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

function unlinkPrepareTxnJournal(stateDir: string): void {
  try {
    fs.unlinkSync(journalPathFor(stateDir));
  } catch {
    // ignore
  }
}

function recoveryMarkerPathFor(stateDir: string): string {
  return `${storePathFor(stateDir)}.prepare-txn.recovery`;
}

function unlinkPrepareTxnRecoveryMarker(stateDir: string): void {
  try {
    fs.unlinkSync(recoveryMarkerPathFor(stateDir));
  } catch {
    // ignore
  }
}

function writePrepareTxnRecoveryMarker(stateDir: string, marker: PrepareTxnRecoveryMarker): void {
  const dest = recoveryMarkerPathFor(stateDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

function isSuccessfulReplayReceipt(receipt: CognitivePromotionReceipt | null): boolean {
  return Boolean(receipt && SUCCESS_RECEIPT_STATES.has(receipt.state));
}

function toUnsuccessfulReceipt(
  prepared: CognitivePromotionReceipt,
  reason: string,
  state: "conflicted" | "aborted",
  updatedAt: string,
): CognitivePromotionReceipt {
  return {
    kind: "cognitive_promotion_receipt",
    receiptId: prepared.receiptId,
    replayId: prepared.replayId,
    grantId: prepared.grantId,
    recommendationId: prepared.recommendationId,
    resourceId: prepared.resourceId,
    tenantId: prepared.tenantId,
    decision: "recommend_admit",
    decisionReasonCode: reason,
    placementMode: prepared.placementMode,
    canonicalHome: prepared.canonicalHome,
    fromBindingId: prepared.fromBindingId,
    toCanonicalBindingId: prepared.toCanonicalBindingId,
    ...(prepared.projectionBindingId ? { projectionBindingId: prepared.projectionBindingId } : {}),
    ...(prepared.keyRefId ? { keyRefId: prepared.keyRefId } : {}),
    ...(prepared.region ? { region: prepared.region } : {}),
    contentVersion: prepared.contentVersion,
    state,
    createdAt: prepared.createdAt,
    updatedAt,
  };
}

function isUnsuccessfulRecoveryReceipt(
  receipt: CognitivePromotionReceipt | null,
): receipt is CognitivePromotionReceipt {
  return Boolean(receipt && (receipt.state === "conflicted" || receipt.state === "aborted"));
}

function inspectPrepareTxnGrant(params: {
  grantId: string;
  tenantId: string | null;
  stateDir: string;
  journalReplayId: string;
}): { ok: true } | { ok: false; reason: string; state: "conflicted" | "aborted" } {
  const grant = readGovernanceApprovalGrant({
    grantId: params.grantId,
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  if (!grant) {
    return { ok: false, reason: "grant_not_found", state: "conflicted" };
  }
  if (grant.state === "consumed" && grant.consumedByReplayId === params.journalReplayId) {
    return { ok: true };
  }
  if (grant.revokedAt) {
    return { ok: false, reason: "grant_revoked", state: "conflicted" };
  }
  if (Date.parse(grant.expiresAt) <= Date.now()) {
    return { ok: false, reason: "grant_expired", state: "conflicted" };
  }
  if (grant.state === "consumed") {
    return {
      ok: false,
      reason: grant.consumedByReplayId
        ? "grant_consumed_by_other_replay"
        : "grant_consumed_identity_unproven",
      state: "conflicted",
    };
  }
  return { ok: false, reason: "grant_unused", state: "aborted" };
}

function commitPreparedReceipt(params: {
  storePath: string;
  receipt: CognitivePromotionReceipt;
}): PromotionFileShape {
  const file = readFile(params.storePath);
  const existing = file.receipts[params.receipt.replayId];
  if (existing) {
    return file;
  }
  const next: PromotionFileShape = {
    schemaVersion: 1,
    revision: file.revision + 1,
    receipts: { ...file.receipts, [params.receipt.replayId]: params.receipt },
    consumedGrants: { ...file.consumedGrants, [params.receipt.grantId]: params.receipt.replayId },
  };
  writeFileDurable(params.storePath, next);
  return next;
}

function commitUnsuccessfulRecovery(params: {
  storePath: string;
  stateDir: string;
  journal: PrepareTxnJournal;
  reason: string;
  receiptState: "conflicted" | "aborted";
}): void {
  const file = readFile(params.storePath);
  const existing = parseCognitivePromotionReceipt(file.receipts[params.journal.receipt.replayId]);
  if (isSuccessfulReplayReceipt(existing)) {
    return;
  }
  const now = new Date().toISOString();
  const recorded = isUnsuccessfulRecoveryReceipt(existing)
    ? existing
    : toUnsuccessfulReceipt(params.journal.receipt, params.reason, params.receiptState, now);
  if (!isUnsuccessfulRecoveryReceipt(existing)) {
    const next: PromotionFileShape = {
      schemaVersion: 1,
      revision: file.revision + 1,
      receipts: { ...file.receipts, [recorded.replayId]: recorded },
      consumedGrants: file.consumedGrants,
    };
    writeFileDurable(params.storePath, next);
  }
  writePrepareTxnRecoveryMarker(params.stateDir, {
    schemaVersion: 1,
    kind: "cognitive_promotion_prepare_recovery",
    replayId: params.journal.receipt.replayId,
    grantId: params.journal.receipt.grantId,
    reason: params.reason,
    journalPresent: true,
    createdAt: now,
  });
}

/**
 * Caller holds the promotion store lock and the journal grant lock.
 * Scheme A: grant consume CAS is the only commit point. A leftover journal is
 * speculative. Recovery may complete a prepared receipt only when the grant is
 * already consumed with consumedByReplayId === journal.replayId. An unused
 * grant, or revoked/expired/missing/identity mismatch, must not consume the
 * grant and must not mint a successful prepared receipt.
 */
function recoverPrepareTxnUnlocked(params: { stateDir: string; storePath: string }): void {
  const journal = readPrepareTxnJournal(params.stateDir);
  if (!journal) {
    return;
  }
  const file = readFile(params.storePath);
  const existing = parseCognitivePromotionReceipt(file.receipts[journal.receipt.replayId]);
  if (isSuccessfulReplayReceipt(existing)) {
    unlinkPrepareTxnJournal(params.stateDir);
    unlinkPrepareTxnRecoveryMarker(params.stateDir);
    return;
  }
  if (isUnsuccessfulRecoveryReceipt(existing)) {
    commitUnsuccessfulRecovery({
      storePath: params.storePath,
      stateDir: params.stateDir,
      journal,
      reason: existing.decisionReasonCode,
      receiptState: existing.state === "aborted" ? "aborted" : "conflicted",
    });
    return;
  }
  const inspected = inspectPrepareTxnGrant({
    grantId: journal.receipt.grantId,
    tenantId: journal.grantTenantId,
    stateDir: params.stateDir,
    journalReplayId: journal.receipt.replayId,
  });
  if (!inspected.ok) {
    commitUnsuccessfulRecovery({
      storePath: params.storePath,
      stateDir: params.stateDir,
      journal,
      reason: inspected.reason,
      receiptState: inspected.state,
    });
    return;
  }
  commitPreparedReceipt({ storePath: params.storePath, receipt: journal.receipt });
  unlinkPrepareTxnJournal(params.stateDir);
  unlinkPrepareTxnRecoveryMarker(params.stateDir);
}

function recoverPrepareTxn(params: {
  stateDir: string;
  storePath: string;
  grantId: string;
  grantTenantId: string | null;
}): void {
  withGovernanceApprovalGrantLockSync(
    { grantId: params.grantId, tenantId: params.grantTenantId, stateDir: params.stateDir },
    () => {
      recoverPrepareTxnUnlocked({ stateDir: params.stateDir, storePath: params.storePath });
    },
  );
}

export function getCognitivePromotionReceiptByReplayId(params: {
  replayId: string;
  stateDir?: string;
}): CognitivePromotionReceipt | null {
  const replayId = assertSafeRecoveryReceiptToken(params.replayId, "operationId");
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = storePathFor(stateDir);
  const lockPath = `${storePath}.lock`;
  let receipt: CognitivePromotionReceipt | null = null;
  withExclusiveLockSync(lockPath, () => {
    const journal = readPrepareTxnJournal(stateDir);
    if (journal) {
      recoverPrepareTxn({
        stateDir,
        storePath,
        grantId: journal.receipt.grantId,
        grantTenantId: journal.grantTenantId,
      });
    }
    try {
      const file = readFile(storePath);
      const raw = file.receipts[replayId];
      receipt = raw ? parseCognitivePromotionReceipt(raw) : null;
    } catch {
      receipt = null;
    }
  });
  return receipt;
}

export function getConsumedGrantReplayId(params: {
  grantId: string;
  stateDir?: string;
}): string | null {
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = storePathFor(stateDir);
  const lockPath = `${storePath}.lock`;
  let consumedBy: string | null = null;
  withExclusiveLockSync(lockPath, () => {
    const journal = readPrepareTxnJournal(stateDir);
    if (journal) {
      recoverPrepareTxn({
        stateDir,
        storePath,
        grantId: journal.receipt.grantId,
        grantTenantId: journal.grantTenantId,
      });
    }
    try {
      consumedBy = readFile(storePath).consumedGrants[params.grantId] ?? null;
    } catch {
      consumedBy = null;
    }
  });
  return consumedBy;
}

function withExclusiveLockSync(lockPath: string, fn: () => void): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const buf = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      Atomics.wait(buf, 0, 0, LOCK_RETRY_MS);
    }
  }
  throw new Error("cognitive_promotion_lock_timeout");
}

/**
 * Unique-create a prepared receipt and consume the grant in one recoverable
 * transaction. Scheme A: grant consume CAS is the only commit point. The journal
 * is speculative until CAS succeeds for this replay. Recovery must not perform
 * a fresh unused→consumed CAS; only a matching already-consumed grant may
 * complete a prepared receipt.
 */
export async function uniqueCreatePreparedPromotionReceipt(params: {
  receipt: CognitivePromotionReceipt;
  grantTenantId: string | null;
  stateDir?: string;
  faultAfter?: "journal" | "grant_consumed";
  onBeforeGrantLock?: () => void;
}): Promise<PreparePromotionTxnResult> {
  const parsed = parseCognitivePromotionReceipt(params.receipt);
  if (!parsed || parsed.state !== "prepared") {
    throw new Error("cognitive_promotion_invalid_prepared_receipt");
  }
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = storePathFor(stateDir);
  const lockPath = `${storePath}.lock`;
  let result: PreparePromotionTxnResult | null = null;
  await withExclusiveLockAsync(lockPath, () => {
    const pending = readPrepareTxnJournal(stateDir);
    if (pending) {
      withGovernanceApprovalGrantLockSync(
        {
          grantId: pending.receipt.grantId,
          tenantId: pending.grantTenantId,
          stateDir,
        },
        () => {
          recoverPrepareTxnUnlocked({ stateDir, storePath });
        },
      );
    }
    if (isTestRuntime() && params.onBeforeGrantLock) {
      params.onBeforeGrantLock();
    }
    withGovernanceApprovalGrantLockSync(
      { grantId: parsed.grantId, tenantId: params.grantTenantId, stateDir },
      () => {
        const leftover = readPrepareTxnJournal(stateDir);
        if (leftover && leftover.receipt.grantId === parsed.grantId) {
          recoverPrepareTxnUnlocked({ stateDir, storePath });
        }
        const blockingJournal = readPrepareTxnJournal(stateDir);
        if (blockingJournal && blockingJournal.receipt.replayId !== parsed.replayId) {
          result = { ok: false, conflict: "recovery_required" };
          return;
        }
        const file = readFile(storePath);
        const existing = file.receipts[parsed.replayId];
        if (existing) {
          const receipt = parseCognitivePromotionReceipt(existing);
          if (!receipt) {
            throw new Error("cognitive_promotion_store_corrupt");
          }
          if (!isSuccessfulReplayReceipt(receipt)) {
            result = { ok: false, conflict: "recovery_required" };
            return;
          }
          result = { ok: true, receipt, created: false };
          return;
        }
        const consumedBy = file.consumedGrants[parsed.grantId];
        if (consumedBy && consumedBy !== parsed.replayId) {
          result = { ok: false, conflict: "grant_consumed" };
          return;
        }
        if (consumedBy && consumedBy === parsed.replayId) {
          result = { ok: false, conflict: "grant_consumed_without_receipt" };
          return;
        }
        const currentGrant = readGovernanceApprovalGrant({
          grantId: parsed.grantId,
          tenantId: params.grantTenantId,
          stateDir,
        });
        if (!currentGrant) {
          result = { ok: false, conflict: "grant_not_found" };
          return;
        }
        if (currentGrant.revokedAt) {
          result = { ok: false, conflict: "grant_revoked" };
          return;
        }
        if (Date.parse(currentGrant.expiresAt) <= Date.now()) {
          result = { ok: false, conflict: "grant_expired" };
          return;
        }
        if (currentGrant.state === "consumed") {
          if (currentGrant.consumedByReplayId === parsed.replayId) {
            commitPreparedReceipt({ storePath, receipt: parsed });
            unlinkPrepareTxnJournal(stateDir);
            unlinkPrepareTxnRecoveryMarker(stateDir);
            result = { ok: true, receipt: parsed, created: true };
            return;
          }
          result = { ok: false, conflict: "grant_consumed_without_receipt" };
          return;
        }
        writePrepareTxnJournal(stateDir, {
          schemaVersion: 1,
          kind: "cognitive_promotion_prepare_txn",
          receipt: parsed,
          grantTenantId: params.grantTenantId,
        });
        if (isTestRuntime() && params.faultAfter === "journal") {
          throw new Error("fault_inject:journal");
        }
        const consumed = compareAndConsumeGovernanceApprovalGrantUnlocked({
          grantId: parsed.grantId,
          tenantId: params.grantTenantId,
          stateDir,
          consumedAt: parsed.createdAt,
          replayId: parsed.replayId,
        });
        if (!consumed.ok) {
          unlinkPrepareTxnJournal(stateDir);
          result = { ok: false, conflict: consumed.reason };
          return;
        }
        if (consumed.alreadyConsumed) {
          if (consumed.consumedByReplayId === parsed.replayId) {
            commitPreparedReceipt({ storePath, receipt: parsed });
            unlinkPrepareTxnJournal(stateDir);
            unlinkPrepareTxnRecoveryMarker(stateDir);
            result = { ok: true, receipt: parsed, created: true };
            return;
          }
          unlinkPrepareTxnJournal(stateDir);
          result = { ok: false, conflict: "grant_consumed_without_receipt" };
          return;
        }
        if (isTestRuntime() && params.faultAfter === "grant_consumed") {
          throw new Error("fault_inject:grant_consumed");
        }
        commitPreparedReceipt({ storePath, receipt: parsed });
        unlinkPrepareTxnJournal(stateDir);
        unlinkPrepareTxnRecoveryMarker(stateDir);
        result = { ok: true, receipt: parsed, created: true };
      },
    );
  });
  if (!result) {
    throw new Error("cognitive_promotion_unique_create_failed");
  }
  return result;
}

export type ApplyTxnJournal = {
  schemaVersion: 1;
  kind: "cognitive_promotion_apply_txn";
  replayId: string;
  resourceId: string;
  tenantId: string;
  checksum: string;
  intendedCanonicalBindingId: string;
  orphanPaths: string[];
};

function applyJournalPathFor(stateDir: string): string {
  return `${storePathFor(stateDir)}.apply-txn`;
}

function parseApplyTxnJournal(value: unknown): ApplyTxnJournal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || raw.kind !== "cognitive_promotion_apply_txn") {
    return null;
  }
  if (
    typeof raw.replayId !== "string" ||
    typeof raw.resourceId !== "string" ||
    typeof raw.tenantId !== "string" ||
    typeof raw.checksum !== "string" ||
    typeof raw.intendedCanonicalBindingId !== "string" ||
    !Array.isArray(raw.orphanPaths) ||
    !raw.orphanPaths.every((p) => typeof p === "string")
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    kind: "cognitive_promotion_apply_txn",
    replayId: raw.replayId,
    resourceId: raw.resourceId,
    tenantId: raw.tenantId,
    checksum: raw.checksum,
    intendedCanonicalBindingId: raw.intendedCanonicalBindingId,
    orphanPaths: raw.orphanPaths,
  };
}

export function readApplyTxnJournal(stateDir: string): ApplyTxnJournal | null {
  const dest = applyJournalPathFor(stateDir);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseApplyTxnJournal(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

export function writeApplyTxnJournal(stateDir: string, journal: ApplyTxnJournal): void {
  const dest = applyJournalPathFor(stateDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

export function unlinkApplyTxnJournal(stateDir: string): void {
  const dest = applyJournalPathFor(stateDir);
  if (fs.existsSync(dest)) {
    fs.unlinkSync(dest);
  }
}

export function finalizePromotionReceipt(params: {
  replayId: string;
  state: "applied" | "conflicted" | "failed";
  checksum?: string;
  decisionReasonCode?: string;
  stateDir?: string;
}): CognitivePromotionReceipt | null {
  const replayId = assertSafeRecoveryReceiptToken(params.replayId, "operationId");
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = storePathFor(stateDir);
  const lockPath = `${storePath}.lock`;
  let result: CognitivePromotionReceipt | null = null;
  withExclusiveLockSync(lockPath, () => {
    const file = readFile(storePath);
    const existing = parseCognitivePromotionReceipt(file.receipts[replayId]);
    if (!existing) {
      return;
    }
    if (existing.state === "applied" && params.state === "applied") {
      result = existing;
      return;
    }
    if (existing.state !== "prepared") {
      result = existing;
      return;
    }
    const now = new Date().toISOString();
    const next: CognitivePromotionReceipt = {
      ...existing,
      state: params.state,
      updatedAt: now,
      ...(params.decisionReasonCode ? { decisionReasonCode: params.decisionReasonCode } : {}),
      ...(params.state === "applied" && params.checksum
        ? { checksum: params.checksum }
        : params.checksum
          ? { checksum: params.checksum }
          : {}),
    };
    if (!parseCognitivePromotionReceipt(next)) {
      throw new Error("cognitive_promotion_invalid_final_receipt");
    }
    writeFileDurable(storePath, {
      schemaVersion: 1,
      revision: file.revision + 1,
      receipts: { ...file.receipts, [replayId]: next },
      consumedGrants: file.consumedGrants,
    });
    result = next;
  });
  return result;
}

type TombstoneFileShape = {
  schemaVersion: 1;
  revision: number;
  receipts: Record<string, CognitiveProjectionTombstoneReceipt>;
};

function tombstoneStorePathFor(stateDir: string): string {
  return path.join(resolveCognitivePromotionRoot(stateDir), "tombstones.json");
}

function emptyTombstoneFile(): TombstoneFileShape {
  return { schemaVersion: 1, revision: 0, receipts: {} };
}

export function parseCognitiveProjectionTombstoneReceipt(
  value: unknown,
): CognitiveProjectionTombstoneReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "cognitive_projection_tombstone_receipt") {
    return null;
  }
  for (const key of [
    "receiptId",
    "replayId",
    "grantId",
    "resourceId",
    "tenantId",
    "createdAt",
    "updatedAt",
  ] as const) {
    if (typeof raw[key] !== "string" || raw[key].trim() === "") {
      return null;
    }
  }
  if (
    typeof raw.tombstoneVersion !== "number" ||
    !Number.isInteger(raw.tombstoneVersion) ||
    raw.tombstoneVersion < 1
  ) {
    return null;
  }
  if (raw.state !== "prepared" && raw.state !== "applied" && raw.state !== "failed") {
    return null;
  }
  if (raw.state === "prepared" || raw.state === "failed") {
    if (raw.checksum !== undefined) {
      return null;
    }
  } else if (typeof raw.checksum !== "string" || raw.checksum.trim() === "") {
    return null;
  }
  return {
    kind: "cognitive_projection_tombstone_receipt",
    receiptId: raw.receiptId as string,
    replayId: raw.replayId as string,
    grantId: raw.grantId as string,
    resourceId: raw.resourceId as string,
    tenantId: raw.tenantId as string,
    tombstoneVersion: raw.tombstoneVersion,
    ...(typeof raw.checksum === "string" ? { checksum: raw.checksum } : {}),
    state: raw.state,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

function readTombstoneFile(storePath: string): TombstoneFileShape {
  if (!fs.existsSync(storePath)) {
    return emptyTombstoneFile();
  }
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as TombstoneFileShape;
  if (
    parsed?.schemaVersion !== 1 ||
    !parsed.receipts ||
    typeof parsed.receipts !== "object" ||
    typeof parsed.revision !== "number"
  ) {
    throw new Error("cognitive_projection_tombstone_store_corrupt");
  }
  return parsed;
}

export function getCognitiveProjectionTombstoneReceipt(params: {
  replayId: string;
  stateDir?: string;
}): CognitiveProjectionTombstoneReceipt | null {
  const replayId = assertSafeRecoveryReceiptToken(params.replayId, "operationId");
  const stateDir = params.stateDir ?? resolveStateDir();
  try {
    return parseCognitiveProjectionTombstoneReceipt(
      readTombstoneFile(tombstoneStorePathFor(stateDir)).receipts[replayId],
    );
  } catch {
    return null;
  }
}

export function uniqueCreateTombstoneReceipt(params: {
  receipt: CognitiveProjectionTombstoneReceipt;
  stateDir?: string;
}): { ok: true; receipt: CognitiveProjectionTombstoneReceipt; created: boolean } | { ok: false } {
  const parsed = parseCognitiveProjectionTombstoneReceipt(params.receipt);
  if (!parsed || parsed.state !== "prepared") {
    return { ok: false };
  }
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = tombstoneStorePathFor(stateDir);
  const lockPath = `${storePath}.lock`;
  let created = false;
  let result: CognitiveProjectionTombstoneReceipt | null = null;
  withExclusiveLockSync(lockPath, () => {
    const file = readTombstoneFile(storePath);
    const existing = parseCognitiveProjectionTombstoneReceipt(file.receipts[parsed.replayId]);
    if (existing) {
      result = existing;
      return;
    }
    writeFileDurable(storePath, {
      schemaVersion: 1,
      revision: file.revision + 1,
      receipts: { ...file.receipts, [parsed.replayId]: parsed },
    });
    created = true;
    result = parsed;
  });
  return result ? { ok: true, receipt: result, created } : { ok: false };
}

export function finalizeTombstoneReceipt(params: {
  replayId: string;
  state: "applied" | "failed";
  checksum?: string;
  tombstoneVersion?: number;
  stateDir?: string;
}): CognitiveProjectionTombstoneReceipt | null {
  const replayId = assertSafeRecoveryReceiptToken(params.replayId, "operationId");
  const stateDir = params.stateDir ?? resolveStateDir();
  const storePath = tombstoneStorePathFor(stateDir);
  const lockPath = `${storePath}.lock`;
  let result: CognitiveProjectionTombstoneReceipt | null = null;
  withExclusiveLockSync(lockPath, () => {
    const file = readTombstoneFile(storePath);
    const existing = parseCognitiveProjectionTombstoneReceipt(file.receipts[replayId]);
    if (!existing) {
      return;
    }
    if (existing.state === "applied" && params.state === "applied") {
      result = existing;
      return;
    }
    if (existing.state !== "prepared") {
      result = existing;
      return;
    }
    const now = new Date().toISOString();
    const next: CognitiveProjectionTombstoneReceipt = {
      ...existing,
      state: params.state,
      updatedAt: now,
      ...(params.tombstoneVersion ? { tombstoneVersion: params.tombstoneVersion } : {}),
      ...(params.state === "applied" && params.checksum ? { checksum: params.checksum } : {}),
    };
    if (!parseCognitiveProjectionTombstoneReceipt(next)) {
      throw new Error("cognitive_projection_tombstone_invalid_final_receipt");
    }
    writeFileDurable(storePath, {
      schemaVersion: 1,
      revision: file.revision + 1,
      receipts: { ...file.receipts, [replayId]: next },
    });
    result = next;
  });
  return result;
}

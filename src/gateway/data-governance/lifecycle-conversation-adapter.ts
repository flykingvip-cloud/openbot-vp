/**
 * P2-b conversation_archive domain adapter.
 *
 * Domain plane (filesystem archive / index / restore runtime) must succeed before
 * Catalog CAS to archived|active. Returns a compensate handle so the two-phase
 * coordinator can automatically roll back create-owned domain side effects when
 * Catalog CAS fails after domain success (P2-b CR).
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  verifyConversationCanonicalLocator,
  type ConversationDomainCompensateHandle,
  type ConversationTwoPhaseResult,
  runConversationArchiveTwoPhase,
  runConversationRestoreTwoPhase,
} from "./lifecycle-conversation.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type { ActorRef } from "./types.js";

export type ConversationArchiveDomainPlan = {
  resourceId: string;
  agentId: string;
  sessionId: string;
  /** Live / runtime transcript to copy from (archive) or restore into. */
  runtimePath: string;
  /** Canonical archive locator (must match Catalog binding). */
  archivePath: string;
  /** Data-space root that owns agents/<id>/conversations/index.json. */
  dataRoot: string;
  operationId: string;
  stateDir?: string;
};

type ArchiveIndexEntry = {
  sessionId: string;
  archivedAt: string;
  relativePath: string;
  bytes?: number;
};

type ArchiveIndex = {
  schemaVersion: 1;
  updatedAt: string;
  sessions: ArchiveIndexEntry[];
};

export type ArchiveIndexCompensateSnapshot = {
  indexPath: string;
  sessionId: string;
  /** Entry before this op mutated the index; null if we added a new session row. */
  priorEntry: ArchiveIndexEntry | null;
  /** True when index.json did not exist before this op. */
  createdIndexFile: boolean;
  mutated: boolean;
  /**
   * Fingerprint of the session entry AFTER this op wrote it.
   * Compensate only mutates index when the live entry still matches (else skip /
   * recovery crumb — concurrent writer won).
   */
  writtenEntryFingerprint: string;
};

export type ConversationArchiveDomainResult = {
  archivePath: string;
  indexPath: string;
  createdArchive: boolean;
  updatedIndex: boolean;
  indexSnapshot: ArchiveIndexCompensateSnapshot;
};

export type ConversationRestoreDomainResult = {
  runtimePath: string;
  createdRuntime: boolean;
};

export function fingerprintArchiveIndexEntry(entry: ArchiveIndexEntry): string {
  return JSON.stringify({
    sessionId: entry.sessionId,
    archivedAt: entry.archivedAt,
    relativePath: entry.relativePath,
    bytes: entry.bytes ?? null,
  });
}

function resolveArchiveIndexPath(dataRoot: string, agentId: string): string {
  return path.join(dataRoot, "agents", agentId, "conversations", "index.json");
}

function resolveArchiveIndexLockPath(indexPath: string): string {
  return `${path.resolve(indexPath)}.lock`;
}

const INDEX_LOCK_STALE_MS = 30_000;
const INDEX_LOCK_RETRY_MS = 20;
const INDEX_LOCK_MAX_ATTEMPTS = 250;

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Exclusive file lock shared by materialize + compensate writers for one index.json. */
async function withConversationArchiveIndexLock<T>(
  indexPath: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const lockPath = resolveArchiveIndexLockPath(indexPath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < INDEX_LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        return await fn();
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
        if (Date.now() - st.mtimeMs > INDEX_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(INDEX_LOCK_RETRY_MS);
    }
  }
  throw new Error("conversation_archive_index_lock_timeout");
}

function cloneIndexEntry(entry: ArchiveIndexEntry): ArchiveIndexEntry {
  return {
    sessionId: entry.sessionId,
    archivedAt: entry.archivedAt,
    relativePath: entry.relativePath,
    bytes: entry.bytes,
  };
}

async function readArchiveIndex(indexPath: string): Promise<ArchiveIndex> {
  try {
    const raw = await fsp.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ArchiveIndex>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sessions)) {
      return { schemaVersion: 1, updatedAt: new Date().toISOString(), sessions: [] };
    }
    return {
      schemaVersion: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      sessions: parsed.sessions.filter(
        (entry): entry is ArchiveIndexEntry =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof entry.sessionId === "string" &&
          typeof entry.archivedAt === "string" &&
          typeof entry.relativePath === "string",
      ),
    };
  } catch {
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), sessions: [] };
  }
}

async function writeArchiveIndex(indexPath: string, index: ArchiveIndex): Promise<void> {
  await fsp.mkdir(path.dirname(indexPath), { recursive: true });
  await fsp.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

/**
 * Re-read Catalog before destructive domain work (design §4).
 * Requires open archive|restore active op for this resource/operation.
 */
async function assertActiveTwoPhaseOp(params: ConversationArchiveDomainPlan): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const record = await catalog.get(params.resourceId);
  if (!record) {
    throw new Error("domain_catalog_missing");
  }
  if (record.envelope.resourceType !== "conversation_archive") {
    throw new Error("domain_wrong_resource_type");
  }
  const active = record.envelope.activeLifecycleOperation;
  if (!active || active.operationId !== params.operationId) {
    throw new Error("domain_active_operation_mismatch");
  }
  if (active.command !== "archive" && active.command !== "restore") {
    throw new Error("domain_command_not_archive_or_restore");
  }
  const canonical =
    record.bindings.find((b) => b.bindingId === record.envelope.canonicalBindingId) ??
    record.bindings.find((b) => b.role === "canonical");
  if (!canonical?.locator) {
    throw new Error("domain_canonical_binding_missing");
  }
  if (path.resolve(canonical.locator) !== path.resolve(params.archivePath)) {
    throw new Error("domain_locator_mismatch");
  }
}

/**
 * Materialize archive bytes + index under dataRoot. Does not touch Catalog lifecycle.
 */
export async function materializeConversationArchiveDomain(
  params: ConversationArchiveDomainPlan,
): Promise<ConversationArchiveDomainResult> {
  await assertActiveTwoPhaseOp(params);

  const runtimePath = path.resolve(params.runtimePath);
  const archivePath = path.resolve(params.archivePath);
  if (!fs.existsSync(runtimePath)) {
    throw new Error("domain_runtime_transcript_missing");
  }

  let createdArchive = false;
  if (!fs.existsSync(archivePath)) {
    await fsp.mkdir(path.dirname(archivePath), { recursive: true });
    await fsp.copyFile(runtimePath, archivePath);
    createdArchive = true;
  } else {
    await fsp.access(runtimePath);
  }

  const indexPath = resolveArchiveIndexPath(params.dataRoot, params.agentId);
  let indexSnapshot!: ArchiveIndexCompensateSnapshot;

  await withConversationArchiveIndexLock(indexPath, async () => {
    const createdIndexFile = !fs.existsSync(indexPath);
    const index = await readArchiveIndex(indexPath);
    const priorRaw = index.sessions.find((entry) => entry.sessionId === params.sessionId);
    const priorEntry = priorRaw ? cloneIndexEntry(priorRaw) : null;

    const relativePath = path.posix.join("archive", `${params.sessionId}.jsonl`);
    const now = new Date().toISOString();
    let bytes = 0;
    try {
      bytes = (await fsp.stat(archivePath)).size;
    } catch {
      // best-effort
    }
    if (priorRaw) {
      priorRaw.archivedAt = now;
      priorRaw.relativePath = relativePath;
      priorRaw.bytes = bytes;
    } else {
      index.sessions.push({
        sessionId: params.sessionId,
        archivedAt: now,
        relativePath,
        bytes,
      });
    }
    index.updatedAt = now;
    await writeArchiveIndex(indexPath, index);
    const written =
      index.sessions.find((entry) => entry.sessionId === params.sessionId) ??
      ({
        sessionId: params.sessionId,
        archivedAt: now,
        relativePath,
        bytes,
      } satisfies ArchiveIndexEntry);
    indexSnapshot = {
      indexPath,
      sessionId: params.sessionId,
      priorEntry,
      createdIndexFile,
      mutated: true,
      writtenEntryFingerprint: fingerprintArchiveIndexEntry(written),
    };
  });

  return {
    archivePath,
    indexPath,
    createdArchive,
    updatedIndex: true,
    indexSnapshot,
  };
}

/**
 * Restore: copy archive → runtime. Catalog canonical stays on archivePath (verify still).
 */
export async function materializeConversationRestoreDomain(
  params: ConversationArchiveDomainPlan,
): Promise<ConversationRestoreDomainResult> {
  await assertActiveTwoPhaseOp(params);
  const archivePath = path.resolve(params.archivePath);
  const runtimePath = path.resolve(params.runtimePath);
  if (!fs.existsSync(archivePath)) {
    throw new Error("domain_archive_missing");
  }
  let createdRuntime = false;
  if (!fs.existsSync(runtimePath)) {
    await fsp.mkdir(path.dirname(runtimePath), { recursive: true });
    await fsp.copyFile(archivePath, runtimePath);
    createdRuntime = true;
  }
  return { runtimePath, createdRuntime };
}

export type ArchiveIndexCompensateOutcome = "applied" | "skipped_fingerprint_mismatch" | "noop";

export type ArchiveDomainCompensateResult = {
  /** True only when index (if any) and create-owned archive were both rolled back as owned by this op. */
  compensated: boolean;
  /** True when index mismatch forced us to leave archive bytes in place (subsequent writer takeover). */
  partial?: boolean;
  indexOutcome?: ArchiveIndexCompensateOutcome;
  archiveDeleted?: boolean;
  recoveryReceiptPath?: string;
};

async function compensateArchiveIndex(
  snapshot: ArchiveIndexCompensateSnapshot,
): Promise<ArchiveIndexCompensateOutcome> {
  if (!snapshot.mutated) {
    return "noop";
  }
  const indexPath = path.resolve(snapshot.indexPath);
  return withConversationArchiveIndexLock(
    indexPath,
    async (): Promise<ArchiveIndexCompensateOutcome> => {
      if (!fs.existsSync(indexPath)) {
        return "noop";
      }
      const index = await readArchiveIndex(indexPath);
      const current = index.sessions.find((s) => s.sessionId === snapshot.sessionId);
      if (!current) {
        return "noop";
      }
      if (fingerprintArchiveIndexEntry(current) !== snapshot.writtenEntryFingerprint) {
        return "skipped_fingerprint_mismatch";
      }

      if (snapshot.priorEntry === null && snapshot.createdIndexFile) {
        const remaining = index.sessions.filter((s) => s.sessionId !== snapshot.sessionId);
        if (remaining.length === 0) {
          await fsp.unlink(indexPath);
          return "applied";
        }
        index.sessions = remaining;
        index.updatedAt = new Date().toISOString();
        await writeArchiveIndex(indexPath, index);
        return "applied";
      }

      if (snapshot.priorEntry === null) {
        index.sessions = index.sessions.filter((s) => s.sessionId !== snapshot.sessionId);
      } else {
        const idx = index.sessions.findIndex((s) => s.sessionId === snapshot.sessionId);
        if (idx >= 0) {
          index.sessions[idx] = cloneIndexEntry(snapshot.priorEntry);
        } else {
          index.sessions.push(cloneIndexEntry(snapshot.priorEntry));
        }
      }
      index.updatedAt = new Date().toISOString();
      await writeArchiveIndex(indexPath, index);
      return "applied";
    },
  );
}

/**
 * Best-effort FS compensate for archive materialization owned by this operation.
 * Rolls back create-owned archive bytes AND index mutation — unless a subsequent
 * writer already rewrote the same session index entry (fingerprint mismatch): then
 * keep both the entry and the archive bytes (no dangling index).
 */
export async function compensateConversationArchiveDomain(params: {
  plan: ConversationArchiveDomainPlan;
  createdArchive: boolean;
  indexSnapshot?: ArchiveIndexCompensateSnapshot;
  reason: string;
}): Promise<ArchiveDomainCompensateResult> {
  const archivePath = path.resolve(params.plan.archivePath);
  try {
    let indexOutcome: ArchiveIndexCompensateOutcome = "noop";
    if (params.indexSnapshot) {
      indexOutcome = await compensateArchiveIndex(params.indexSnapshot);
    }

    if (indexOutcome === "skipped_fingerprint_mismatch") {
      const recoveryReceiptPath = writeGovernanceRecoveryReceipt({
        operationId: params.plan.operationId,
        stage: "conversation_archive_index_compensate_skip",
        reason: params.reason || "index_entry_fingerprint_mismatch",
        resourceIds: [params.plan.resourceId],
        haltCompensation: false,
        stateDir: params.plan.stateDir,
      });
      return {
        compensated: false,
        partial: true,
        indexOutcome,
        archiveDeleted: false,
        recoveryReceiptPath,
      };
    }

    let archiveDeleted = false;
    if (params.createdArchive && fs.existsSync(archivePath) && fs.statSync(archivePath).isFile()) {
      await fsp.unlink(archivePath);
      archiveDeleted = true;
    }
    return {
      compensated: true,
      indexOutcome,
      archiveDeleted,
    };
  } catch (err) {
    const recoveryReceiptPath = writeGovernanceRecoveryReceipt({
      operationId: params.plan.operationId,
      stage: "conversation_archive_domain_compensate",
      reason: params.reason,
      error: String((err as Error)?.message ?? err).slice(0, 400),
      resourceIds: [params.plan.resourceId],
      haltCompensation: true,
      stateDir: params.plan.stateDir,
    });
    return { compensated: false, recoveryReceiptPath, archiveDeleted: false };
  }
}

/**
 * Best-effort FS compensate for restore materialization (create-owned runtime only).
 */
export async function compensateConversationRestoreDomain(params: {
  plan: ConversationArchiveDomainPlan;
  createdRuntime: boolean;
  reason: string;
}): Promise<{ compensated: boolean; recoveryReceiptPath?: string }> {
  if (!params.createdRuntime) {
    return { compensated: false };
  }
  const runtimePath = path.resolve(params.plan.runtimePath);
  try {
    if (fs.existsSync(runtimePath) && fs.statSync(runtimePath).isFile()) {
      await fsp.unlink(runtimePath);
    }
    return { compensated: true };
  } catch (err) {
    const recoveryReceiptPath = writeGovernanceRecoveryReceipt({
      operationId: params.plan.operationId,
      stage: "conversation_restore_domain_compensate",
      reason: params.reason,
      error: String((err as Error)?.message ?? err).slice(0, 400),
      resourceIds: [params.plan.resourceId],
      haltCompensation: true,
      stateDir: params.plan.stateDir,
    });
    return { compensated: false, recoveryReceiptPath };
  }
}

/**
 * Domain verify for archive: materialize then assert canonical locator.
 * Returns compensate handle for coordinator auto-rollback on Catalog CAS loss.
 * Also compensates immediately if verify fails after materialize.
 */
export function createConversationArchiveDomainVerifier(
  plan: ConversationArchiveDomainPlan,
): () => Promise<ConversationDomainCompensateHandle> {
  return async () => {
    let createdArchive = false;
    let indexSnapshot: ArchiveIndexCompensateSnapshot | undefined;
    try {
      const material = await materializeConversationArchiveDomain(plan);
      createdArchive = material.createdArchive;
      indexSnapshot = material.indexSnapshot;
      await verifyConversationCanonicalLocator({
        resourceId: plan.resourceId,
        stateDir: plan.stateDir,
      });
      return {
        compensate: async (reason: string) => {
          await compensateConversationArchiveDomain({
            plan,
            createdArchive,
            indexSnapshot,
            reason,
          });
        },
      };
    } catch (err) {
      await compensateConversationArchiveDomain({
        plan,
        createdArchive,
        indexSnapshot,
        reason: String((err as Error)?.message ?? err),
      });
      throw err;
    }
  };
}

/**
 * Domain verify for restore: materialize runtime copy then assert archive locator.
 * Returns compensate handle for create-owned runtime rollback.
 */
export function createConversationRestoreDomainVerifier(
  plan: ConversationArchiveDomainPlan,
): () => Promise<ConversationDomainCompensateHandle> {
  return async () => {
    let createdRuntime = false;
    try {
      const material = await materializeConversationRestoreDomain(plan);
      createdRuntime = material.createdRuntime;
      await verifyConversationCanonicalLocator({
        resourceId: plan.resourceId,
        stateDir: plan.stateDir,
      });
      return {
        compensate: async (reason: string) => {
          await compensateConversationRestoreDomain({
            plan,
            createdRuntime,
            reason,
          });
        },
      };
    } catch (err) {
      await compensateConversationRestoreDomain({
        plan,
        createdRuntime,
        reason: String((err as Error)?.message ?? err),
      });
      throw err;
    }
  };
}

/** Full archive path: two-phase + domain adapter. */
export async function archiveConversationWithGovernance(params: {
  plan: ConversationArchiveDomainPlan;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  executedBy?: ActorRef;
  onDomainFailure?: "recovery_required" | "keep_prior";
}): Promise<ConversationTwoPhaseResult> {
  return runConversationArchiveTwoPhase({
    resourceId: params.plan.resourceId,
    operationId: params.plan.operationId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.requestedBy,
    executedBy: params.executedBy,
    stateDir: params.plan.stateDir,
    onDomainFailure: params.onDomainFailure,
    verifyDomain: createConversationArchiveDomainVerifier(params.plan),
  });
}

/** Full restore path: two-phase + domain adapter. */
export async function restoreConversationWithGovernance(params: {
  plan: ConversationArchiveDomainPlan;
  expectedGovernanceVersion: number;
  requestedBy: ActorRef;
  executedBy?: ActorRef;
  onDomainFailure?: "recovery_required" | "keep_prior";
}): Promise<ConversationTwoPhaseResult> {
  return runConversationRestoreTwoPhase({
    resourceId: params.plan.resourceId,
    operationId: params.plan.operationId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    requestedBy: params.requestedBy,
    executedBy: params.executedBy,
    stateDir: params.plan.stateDir,
    onDomainFailure: params.onDomainFailure,
    verifyDomain: createConversationRestoreDomainVerifier(params.plan),
  });
}

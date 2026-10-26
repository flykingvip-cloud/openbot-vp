/**
 * T41/T42/T43/T44/T51 M3 — shared control-version CAS for stop vs dispatch eligibility,
 * business task writers, and auth revoke (preserve stopControl/controlEpoch/dispatchClaim).
 *
 * Linearization point: task authority record under a per-task control lock.
 * - stop bumps controlEpoch and clears any dispatchClaim
 * - eligibility commit is expected-version CAS on controlEpoch + OS authEpoch
 *   (+ auth fingerprint as diagnostic/secondary) under a **single-claim** model
 * - each claim carries an unconfusable claimId (generation token); take/clear compare it
 * - committed-but-not-taken may be released only when phase is still committed + claimId
 *   matches (prove unconsumed via wake-op/attempt association — never by timeout alone)
 * - taken leases must not be auto-released by timeout; clear requires matching claimId
 * - external dispatch must CAS-take the claim before invoking the dispatcher
 *
 * T51 Auth revoke **is** on a shared version plane: OS `authEpoch` is the unique auth
 * version source; claims snapshot it; commit/take refuse on authEpoch mismatch even when
 * fingerprint is held constant. Shared revoke writers bump authEpoch, then clear (and
 * optionally bump controlEpoch on) outstanding task claims under the same task lock.
 *
 * Wake-op dispatchEligibility remains an audit/mirror; the task claim is authoritative.
 * Wakes without a persisted task authority record stay wake-op-only (no task CAS).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { GatewayCollaborationGroupOperatingState } from "../collaboration-learning/operating-state-types.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveGroupWorkspacePath,
  writeGroupOperatingState,
} from "../collaboration-learning/shared.js";

/** T51: OS auth version lives on the durable operating-state object (field authEpoch). */
export type OperatingStateWithAuthEpoch = GatewayCollaborationGroupOperatingState & {
  authEpoch?: number;
};
import { withRoundLock } from "./round-store-io.js";
import { asGovernedTask, type GovernedTask, type TaskDispatchClaim } from "./task-runtime.js";
import { assertTaskNotStopped, isTaskStopAccepted } from "./task-stop-control.js";
import { wakeOpAuthFingerprint } from "./wake-op-ledger.js";

const LOCK_RETRY_MS = 20;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function readControlEpoch(task: GovernedTask): number {
  return typeof task.controlEpoch === "number" && Number.isFinite(task.controlEpoch)
    ? Number(task.controlEpoch)
    : 0;
}

/** OS authEpoch SoT; absent ⇒ 0. */
export function readOperatingStateAuthEpoch(
  state: { authEpoch?: number } | null | undefined,
): number {
  return typeof state?.authEpoch === "number" && Number.isFinite(state.authEpoch)
    ? Number(state.authEpoch)
    : 0;
}

function readClaimAuthEpoch(claim: { authEpoch?: number } | null | undefined): number {
  return typeof claim?.authEpoch === "number" && Number.isFinite(claim.authEpoch)
    ? Number(claim.authEpoch)
    : 0;
}

/** Directory holding per-task control locks (shared by stop + eligibility CAS). */
export function taskControlLockDir(params: { groupId: string; cfg?: OpenBotConfig }): string {
  const cfg = params.cfg ?? loadConfig();
  const { groupRootDir } = createWorkspaceCollaborationStores(cfg);
  return path.join(resolveGroupWorkspacePath(groupRootDir, params.groupId), "task-control");
}

function lockStemForTask(taskId: string): string {
  return createHash("sha256")
    .update(`task-control:${compact(taskId)}`)
    .digest("hex")
    .slice(0, 32);
}

export async function withTaskControlLock<T>(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  fn: () => T | Promise<T>;
}): Promise<T> {
  const dir = taskControlLockDir({ groupId: params.groupId, cfg: params.cfg });
  fs.mkdirSync(dir, { recursive: true });
  return withRoundLock(dir, lockStemForTask(params.taskId), params.fn);
}

export type CasCommitTaskDispatchEligibilityParams = {
  groupId: string;
  taskId: string;
  opKey: string;
  /** Observed controlEpoch that must still match under the lock (expected-version). */
  expectedControlEpoch: number;
  /**
   * Observed OS authEpoch that must still match under the lock (T51 shared auth version).
   * Defaults to 0 when omitted (legacy callers / OS without authEpoch).
   */
  expectedAuthEpoch?: number;
  authFingerprint: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Optional target actors for live auth fingerprint re-check inside the CAS. */
  targetActorIds?: readonly string[];
  /** Optional wake-op executionAttemptId to bind into the claim at commit. */
  executionAttemptId?: string;
  /**
   * Test-only: force the fingerprint string used for the live compare (and stamped
   * claim) so M3-REV-3 can prove authEpoch refuses even when fingerprint is held
   * constant artificially.
   */
  _testForceLiveAuthFingerprint?: string;
};

export type CasCommitTaskDispatchEligibilityResult =
  | { ok: true; task: GovernedTask; claim: TaskDispatchClaim }
  | {
      ok: false;
      reason:
        | "task_missing"
        | "task_stopped"
        | "epoch_mismatch"
        | "auth_epoch_mismatch"
        | "auth_fingerprint_mismatch"
        | "auth_source_unreadable"
        | "task_control_unreadable"
        | "claim_held";
      detail: string;
      task?: GovernedTask | null;
    };

/**
 * Expected-version CAS: under task control lock, commit dispatchClaim on the
 * task authority record iff controlEpoch and OS authEpoch still equal expected,
 * task is not stopped, and no other valid claim is held (single-claim model).
 */
export async function casCommitTaskDispatchEligibility(
  params: CasCommitTaskDispatchEligibilityParams,
): Promise<CasCommitTaskDispatchEligibilityResult> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const opKey = compact(params.opKey);
  const expected = params.expectedControlEpoch;
  const expectedAuth =
    typeof params.expectedAuthEpoch === "number" && Number.isFinite(params.expectedAuthEpoch)
      ? Number(params.expectedAuthEpoch)
      : 0;
  const wantFp = compact(params.authFingerprint);

  return withTaskControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    fn: async () => {
      let current: Task | null;
      try {
        const { objectStorage } = createWorkspaceCollaborationStores(cfg);
        current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
      } catch (error) {
        return {
          ok: false,
          reason: "task_control_unreadable",
          detail: `task read failed during eligibility CAS: ${String(error)}`,
        };
      }
      if (!current) {
        return { ok: false, reason: "task_missing", detail: "task missing at eligibility CAS" };
      }
      const governed = asGovernedTask(current);
      if (isTaskStopAccepted(governed)) {
        return {
          ok: false,
          reason: "task_stopped",
          detail: "task already stopped at eligibility CAS",
          task: governed,
        };
      }
      const liveEpoch = readControlEpoch(governed);
      if (liveEpoch !== expected) {
        return {
          ok: false,
          reason: "epoch_mismatch",
          detail: `expected controlEpoch ${expected}, live ${liveEpoch}`,
          task: governed,
        };
      }

      // T51: re-read OS authEpoch (+ fingerprint) under the same lock window so a
      // revoke that raced after the caller's observation cannot be stamped eligible.
      // authEpoch is the shared version condition; fingerprint remains secondary.
      let liveFp = wantFp;
      let liveAuthEpoch = expectedAuth;
      try {
        const { fileStore } = createWorkspaceCollaborationStores(cfg);
        const os = await readGroupOperatingState({
          fileStore,
          groupId: params.groupId,
        });
        liveAuthEpoch = readOperatingStateAuthEpoch(os);
        if (params._testForceLiveAuthFingerprint !== undefined) {
          liveFp = compact(params._testForceLiveAuthFingerprint);
        } else if (params.targetActorIds && params.targetActorIds.length > 0) {
          liveFp = wakeOpAuthFingerprint(os, params.targetActorIds);
        }
      } catch (error) {
        return {
          ok: false,
          reason: "auth_source_unreadable",
          detail: `auth source unreadable during eligibility CAS: ${String(error)}`,
          task: governed,
        };
      }
      if (liveAuthEpoch !== expectedAuth) {
        return {
          ok: false,
          reason: "auth_epoch_mismatch",
          detail: `expected authEpoch ${expectedAuth}, live ${liveAuthEpoch}`,
          task: governed,
        };
      }
      if (
        (params.targetActorIds && params.targetActorIds.length > 0) ||
        params._testForceLiveAuthFingerprint !== undefined
      ) {
        if (compact(liveFp) !== wantFp) {
          return {
            ok: false,
            reason: "auth_fingerprint_mismatch",
            detail: "auth fingerprint changed before eligibility CAS commit",
            task: governed,
          };
        }
      }

      // Single-claim model: one valid claim per task. Do not overwrite another op's
      // committed/taken claim; same-op retry must not reset taken → committed.
      const existing = governed.dispatchClaim;
      if (existing) {
        const existingOp = compact(existing.opKey);
        if (existingOp && existingOp !== opKey) {
          return {
            ok: false,
            reason: "claim_held",
            detail: `task already holds dispatchClaim for op ${existing.opKey} (phase=${existing.phase})`,
            task: governed,
          };
        }
        if (existingOp === opKey && existing.phase === "taken") {
          // Idempotent: keep taken; never reset to committed.
          return { ok: true, task: governed, claim: existing };
        }
        if (existingOp === opKey && existing.phase === "committed") {
          // Idempotent same-op retry of committed claim.
          return { ok: true, task: governed, claim: existing };
        }
      }

      const attempt = compact(params.executionAttemptId) || undefined;
      const claim: TaskDispatchClaim = {
        claimId: randomUUID(),
        opKey,
        controlEpoch: liveEpoch,
        authEpoch: liveAuthEpoch,
        authFingerprint: wantFp,
        committedAtMs: nowMs,
        phase: "committed",
        ...(attempt ? { executionAttemptId: attempt } : {}),
      };
      const updated: GovernedTask = {
        ...governed,
        controlEpoch: liveEpoch,
        dispatchClaim: claim,
        updatedAtMs: nowMs,
      };
      const { objectStorage } = createWorkspaceCollaborationStores(cfg);
      await objectStorage.writeObject(params.groupId, "task", params.taskId, updated);
      return { ok: true, task: updated, claim };
    },
  });
}

export type CasTakeTaskDispatchEligibilityParams = {
  groupId: string;
  taskId: string;
  opKey: string;
  /** Must match the claimId returned by commit (generation bind). */
  claimId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  targetActorIds?: readonly string[];
  /** Test-only: force live fingerprint string (M3-REV-3 constant-fp proof). */
  _testForceLiveAuthFingerprint?: string;
};

export type CasTakeTaskDispatchEligibilityResult =
  | { ok: true; task: GovernedTask; claim: TaskDispatchClaim }
  | {
      ok: false;
      reason:
        | "task_missing"
        | "task_stopped"
        | "claim_missing"
        | "claim_op_mismatch"
        | "claim_id_mismatch"
        | "epoch_mismatch"
        | "auth_epoch_mismatch"
        | "auth_fingerprint_mismatch"
        | "auth_source_unreadable"
        | "task_control_unreadable"
        | "already_taken";
      detail: string;
      task?: GovernedTask | null;
    };

/**
 * Before external dispatcher: CAS-take the task dispatchClaim with unoverwritable
 * version condition (controlEpoch + OS authEpoch + fingerprint). Stop that advanced
 * controlEpoch, or a revoke that bumped authEpoch, causes take to fail — dispatcher
 * must not run. Auth revoke is a shared-epoch writer via OS authEpoch (+ optional
 * task claim clear under the same lock).
 */
export async function casTakeTaskDispatchEligibility(
  params: CasTakeTaskDispatchEligibilityParams,
): Promise<CasTakeTaskDispatchEligibilityResult> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const opKey = compact(params.opKey);

  return withTaskControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    fn: async () => {
      let current: Task | null;
      try {
        const { objectStorage } = createWorkspaceCollaborationStores(cfg);
        current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
      } catch (error) {
        return {
          ok: false,
          reason: "task_control_unreadable",
          detail: `task read failed during eligibility take: ${String(error)}`,
        };
      }
      if (!current) {
        return { ok: false, reason: "task_missing", detail: "task missing at eligibility take" };
      }
      const governed = asGovernedTask(current);
      if (isTaskStopAccepted(governed)) {
        return {
          ok: false,
          reason: "task_stopped",
          detail: "task stopped before dispatch take",
          task: governed,
        };
      }
      const claim = governed.dispatchClaim;
      if (!claim) {
        return {
          ok: false,
          reason: "claim_missing",
          detail: "no task dispatchClaim to take",
          task: governed,
        };
      }
      if (compact(claim.opKey) !== opKey) {
        return {
          ok: false,
          reason: "claim_op_mismatch",
          detail: `dispatchClaim opKey mismatch: ${claim.opKey} vs ${opKey}`,
          task: governed,
        };
      }
      const wantClaimId = compact(params.claimId);
      if (!wantClaimId || compact(claim.claimId) !== wantClaimId) {
        return {
          ok: false,
          reason: "claim_id_mismatch",
          detail: `dispatchClaim claimId mismatch: ${claim.claimId ?? "<missing>"} vs ${wantClaimId || "<missing>"}`,
          task: governed,
        };
      }
      const liveEpoch = readControlEpoch(governed);
      if (liveEpoch !== claim.controlEpoch) {
        return {
          ok: false,
          reason: "epoch_mismatch",
          detail: `claim epoch ${claim.controlEpoch} != live ${liveEpoch}`,
          task: governed,
        };
      }
      if (claim.phase === "taken") {
        return {
          ok: false,
          reason: "already_taken",
          detail: "dispatchClaim already taken",
          task: governed,
        };
      }

      let liveFp = compact(claim.authFingerprint);
      let liveAuthEpoch = readClaimAuthEpoch(claim);
      try {
        const { fileStore } = createWorkspaceCollaborationStores(cfg);
        const os = await readGroupOperatingState({
          fileStore,
          groupId: params.groupId,
        });
        liveAuthEpoch = readOperatingStateAuthEpoch(os);
        if (params._testForceLiveAuthFingerprint !== undefined) {
          liveFp = compact(params._testForceLiveAuthFingerprint);
        } else if (params.targetActorIds && params.targetActorIds.length > 0) {
          liveFp = wakeOpAuthFingerprint(os, params.targetActorIds);
        }
      } catch (error) {
        return {
          ok: false,
          reason: "auth_source_unreadable",
          detail: `auth source unreadable during eligibility take: ${String(error)}`,
          task: governed,
        };
      }
      if (liveAuthEpoch !== readClaimAuthEpoch(claim)) {
        return {
          ok: false,
          reason: "auth_epoch_mismatch",
          detail: `claim authEpoch ${readClaimAuthEpoch(claim)} != live ${liveAuthEpoch}`,
          task: governed,
        };
      }
      if (
        (params.targetActorIds && params.targetActorIds.length > 0) ||
        params._testForceLiveAuthFingerprint !== undefined
      ) {
        if (compact(liveFp) !== compact(claim.authFingerprint)) {
          return {
            ok: false,
            reason: "auth_fingerprint_mismatch",
            detail: "auth fingerprint changed before dispatch take",
            task: governed,
          };
        }
      }

      const taken: TaskDispatchClaim = {
        ...claim,
        phase: "taken",
        takenAtMs: nowMs,
      };
      const updated: GovernedTask = {
        ...governed,
        dispatchClaim: taken,
        updatedAtMs: nowMs,
      };
      const { objectStorage } = createWorkspaceCollaborationStores(cfg);
      await objectStorage.writeObject(params.groupId, "task", params.taskId, updated);
      return { ok: true, task: updated, claim: taken };
    },
  });
}

/**
 * After a taken lease finishes (dispatcher returned/threw, or take won but
 * dispatch was refused before the external call), clear this claim by claimId
 * so a later op can commit under the single-claim model.
 * T43: opKey alone is insufficient — a stale finally must not clear a newer
 * same-op claim. No-op if missing / op mismatch / claimId mismatch.
 * Does not bump controlEpoch (stop remains the version bump).
 */
export async function casClearTaskDispatchClaimForOp(params: {
  groupId: string;
  taskId: string;
  opKey: string;
  /** Generation token from commit/take — required for clear. */
  claimId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ cleared: boolean; reason?: string; task: GovernedTask | null }> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const opKey = compact(params.opKey);
  const claimId = compact(params.claimId);
  return withTaskControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    fn: async () => {
      let current: Task | null;
      try {
        const { objectStorage } = createWorkspaceCollaborationStores(cfg);
        current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
      } catch {
        return { cleared: false, reason: "task_unreadable", task: null };
      }
      if (!current) {
        return { cleared: false, reason: "task_missing", task: null };
      }
      const governed = asGovernedTask(current);
      const claim = governed.dispatchClaim;
      if (!claim) {
        return { cleared: false, reason: "claim_missing", task: governed };
      }
      if (compact(claim.opKey) !== opKey) {
        return { cleared: false, reason: "op_mismatch", task: governed };
      }
      if (!claimId || compact(claim.claimId) !== claimId) {
        return { cleared: false, reason: "claim_id_mismatch", task: governed };
      }
      const updated: GovernedTask = {
        ...governed,
        dispatchClaim: undefined,
        updatedAtMs: nowMs,
      };
      const { objectStorage } = createWorkspaceCollaborationStores(cfg);
      await objectStorage.writeObject(params.groupId, "task", params.taskId, updated);
      return { cleared: true, task: updated };
    },
  });
}

/**
 * T43 recovery: release a **committed** (not taken) claim when the caller can
 * prove it was never consumed — typically via associated wake-op/attempt state
 * (failed / unknown / mirror never completed) plus matching claimId.
 *
 * Refuses taken leases (must not auto-rerun on timeout alone — use receipt or
 * keep unknown). Does not bump controlEpoch.
 */
export async function casReleaseUnconsumedCommittedClaim(params: {
  groupId: string;
  taskId: string;
  opKey: string;
  claimId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{
  released: boolean;
  reason?:
    | "task_missing"
    | "task_unreadable"
    | "claim_missing"
    | "op_mismatch"
    | "claim_id_mismatch"
    | "phase_taken"
    | "claim_id_required";
  task: GovernedTask | null;
}> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const opKey = compact(params.opKey);
  const claimId = compact(params.claimId);
  if (!claimId) {
    return { released: false, reason: "claim_id_required", task: null };
  }
  return withTaskControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    fn: async () => {
      let current: Task | null;
      try {
        const { objectStorage } = createWorkspaceCollaborationStores(cfg);
        current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
      } catch {
        return { released: false, reason: "task_unreadable", task: null };
      }
      if (!current) {
        return { released: false, reason: "task_missing", task: null };
      }
      const governed = asGovernedTask(current);
      const claim = governed.dispatchClaim;
      if (!claim) {
        return { released: false, reason: "claim_missing", task: governed };
      }
      if (compact(claim.opKey) !== opKey) {
        return { released: false, reason: "op_mismatch", task: governed };
      }
      if (compact(claim.claimId) !== claimId) {
        return { released: false, reason: "claim_id_mismatch", task: governed };
      }
      if (claim.phase === "taken") {
        return { released: false, reason: "phase_taken", task: governed };
      }
      const updated: GovernedTask = {
        ...governed,
        dispatchClaim: undefined,
        updatedAtMs: nowMs,
      };
      const { objectStorage } = createWorkspaceCollaborationStores(cfg);
      await objectStorage.writeObject(params.groupId, "task", params.taskId, updated);
      return { released: true, task: updated };
    },
  });
}

/**
 * Stop path helper: under the shared task control lock, accept stop, bump
 * controlEpoch, and clear any dispatchClaim so outstanding eligibility loses CAS.
 *
 * T42: accepts **only** the stop patch (stopControl + operator + time). The lock
 * re-reads the live task and patches control fields onto that latest record —
 * never merge a whole stale task snapshot from outside the lock.
 */
export async function applyTaskStopUnderControlLock(params: {
  groupId: string;
  taskId: string;
  stopControl: NonNullable<GovernedTask["stopControl"]>;
  updatedBy: string;
  updatedAtMs?: number;
  cfg?: OpenBotConfig;
}): Promise<GovernedTask> {
  const cfg = params.cfg ?? loadConfig();
  const updatedAtMs = params.updatedAtMs ?? Date.now();
  const updatedBy = compact(params.updatedBy) || params.updatedBy;
  return withTaskControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    fn: async () => {
      const { objectStorage } = createWorkspaceCollaborationStores(cfg);
      // Re-read under lock to serialize vs eligibility CAS / other writers.
      const current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
      if (!current) {
        throw new Error(`task not found under control lock: ${params.taskId}`);
      }
      const governed = asGovernedTask(current);
      if (isTaskStopAccepted(governed)) {
        // Already stopped — still clear any stale claim; keep live business fields.
        if (governed.dispatchClaim) {
          const cleared: GovernedTask = {
            ...governed,
            dispatchClaim: undefined,
            updatedAtMs,
          };
          await objectStorage.writeObject(params.groupId, "task", params.taskId, cleared);
          return cleared;
        }
        return governed;
      }
      const priorEpoch = readControlEpoch(governed);
      const next: GovernedTask = {
        ...governed,
        stopControl: params.stopControl,
        controlEpoch: priorEpoch + 1,
        dispatchClaim: undefined,
        updatedAtMs,
        updatedBy,
      };
      await objectStorage.writeObject(params.groupId, "task", params.taskId, next);
      return next;
    },
  });
}

/**
 * T44: business writers (state-machine / handoff apply / board claim apply) must
 * not clobber stopControl / controlEpoch / dispatchClaim via `{...stale, ...fields}`.
 *
 * Under the shared task control lock: re-read live task, optionally refuse if
 * stopped, apply only the business patch, and **always** keep control fields from
 * the live record (never from an outside snapshot or the patch object).
 */
export async function applyBusinessTaskPatchUnderControlLock(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  /** Default true — business writes refuse once stop is accepted on the live record. */
  refuseIfStopped?: boolean;
  /**
   * Build business fields from the live task under the lock.
   * Control fields in the return value are ignored; live stop/epoch/claim win.
   */
  buildPatch: (live: GovernedTask) => Partial<GovernedTask> | Promise<Partial<GovernedTask>>;
  /** Test-only: after live read under lock, before write (rare; prefer outer barrier). */
  _testAfterLiveReadBarrier?: () => Promise<void>;
}): Promise<GovernedTask> {
  const cfg = params.cfg ?? loadConfig();
  const refuseIfStopped = params.refuseIfStopped !== false;
  return withTaskControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    fn: async () => {
      const { objectStorage } = createWorkspaceCollaborationStores(cfg);
      const current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
      if (!current) {
        throw new Error(`task not found under control lock: ${params.taskId}`);
      }
      const live = asGovernedTask(current);
      if (params._testAfterLiveReadBarrier) {
        await params._testAfterLiveReadBarrier();
      }
      if (refuseIfStopped) {
        assertTaskNotStopped(live);
      }
      const patch = await params.buildPatch(live);
      // Explicitly preserve control plane — never trust patch / stale spread.
      const updated: GovernedTask = {
        ...live,
        ...patch,
        stopControl: live.stopControl,
        controlEpoch: live.controlEpoch,
        dispatchClaim: live.dispatchClaim,
      };
      await objectStorage.writeObject(params.groupId, "task", params.taskId, updated);
      return updated;
    },
  });
}

/** Test helper: brief yield so concurrent lock contenders can interleave. */

/**
 * T51: shared auth-revoke writer.
 *
 * 1) Mutate OS (member map / role / duty bindings), then bump OS `authEpoch`
 *    (unique auth version SoT) and persist.
 * 2) For each invalidateTaskId, under the **same** task control lock used by
 *    eligibility CAS: clear outstanding dispatchClaim and (by default) bump
 *    controlEpoch so revoke linearizes with stop/eligibility on the task plane.
 *
 * Call this (or an equivalent that bumps authEpoch before mapping changes) from
 * production revoke / membership / duty-change paths. Plain `writeGroupOperatingState`
 * without an authEpoch bump does **not** participate in the shared version plane.
 */
export async function applyAuthRevokeSharedCas(params: {
  groupId: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /**
   * Apply membership / role / duty mutations. Do not set authEpoch here — this
   * helper bumps it after mutate. Identity mutate (no mapping change) is valid
   * for authEpoch-only bump proofs (M3-REV-3).
   */
  mutate: (state: OperatingStateWithAuthEpoch) => OperatingStateWithAuthEpoch;
  /** Tasks whose outstanding eligibility must lose under the shared task lock. */
  invalidateTaskIds?: readonly string[];
  /**
   * When true (default), bump each invalidated task's controlEpoch (revoke ≈
   * interrupt unconsumed eligibility on the stop/eligibility version plane).
   */
  bumpTaskControlEpoch?: boolean;
}): Promise<{
  authEpoch: number;
  operatingState: OperatingStateWithAuthEpoch;
  invalidatedTasks: Array<{
    taskId: string;
    controlEpoch: number;
    clearedClaim: boolean;
  }>;
}> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const bumpTask = params.bumpTaskControlEpoch !== false;
  const { fileStore } = createWorkspaceCollaborationStores(cfg);
  const current = await readGroupOperatingState({
    fileStore,
    groupId: params.groupId,
  });
  if (!current) {
    throw new Error(`operating state missing for auth revoke: ${params.groupId}`);
  }
  const mutated = params.mutate(current);
  const nextAuth = readOperatingStateAuthEpoch(mutated) + 1;
  // If mutate already advanced authEpoch, keep the higher bump once.
  const prior = readOperatingStateAuthEpoch(current);
  const authEpoch = Math.max(nextAuth, prior + 1);
  const operatingState: OperatingStateWithAuthEpoch = {
    ...mutated,
    authEpoch,
    updatedAtMs: nowMs,
  };
  await writeGroupOperatingState({
    fileStore,
    groupId: params.groupId,
    state: operatingState,
  });

  const invalidatedTasks: Array<{
    taskId: string;
    controlEpoch: number;
    clearedClaim: boolean;
  }> = [];
  for (const rawId of params.invalidateTaskIds ?? []) {
    const taskId = compact(rawId);
    if (!taskId) {
      continue;
    }
    const result = await withTaskControlLock({
      groupId: params.groupId,
      taskId,
      cfg,
      fn: async () => {
        const { objectStorage } = createWorkspaceCollaborationStores(cfg);
        const task = await objectStorage.readObject<Task>(params.groupId, "task", taskId);
        if (!task) {
          return null;
        }
        const governed = asGovernedTask(task);
        const clearedClaim = Boolean(governed.dispatchClaim);
        const priorEpoch = readControlEpoch(governed);
        const nextEpoch = bumpTask ? priorEpoch + 1 : priorEpoch;
        const updated: GovernedTask = {
          ...governed,
          controlEpoch: nextEpoch,
          dispatchClaim: undefined,
          updatedAtMs: nowMs,
        };
        await objectStorage.writeObject(params.groupId, "task", taskId, updated);
        return {
          taskId,
          controlEpoch: nextEpoch,
          clearedClaim,
        };
      },
    });
    if (result) {
      invalidatedTasks.push(result);
    }
  }
  return { authEpoch, operatingState, invalidatedTasks };
}

export function _testTaskControlCasYieldMs(): number {
  return LOCK_RETRY_MS;
}

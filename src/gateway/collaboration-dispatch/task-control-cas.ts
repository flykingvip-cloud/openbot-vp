/**
 * T41/T42 M3 — shared control-version CAS for stop vs dispatch eligibility.
 *
 * Linearization point: task authority record under a per-task control lock.
 * - stop bumps controlEpoch and clears any dispatchClaim
 * - eligibility commit is expected-version CAS on controlEpoch (+ auth fingerprint)
 *   under a **single-claim** model (one valid claim per task; same-op retry must not
 *   reset taken → committed)
 * - external dispatch must CAS-take the claim before invoking the dispatcher
 *
 * Auth revoke is **not** on this shared version plane: commit/take re-check the live
 * auth fingerprint under the lock (refuse on mismatch). That is a fingerprint
 * condition, not OS+task single-file / shared-epoch adjudication with member revoke.
 *
 * Wake-op dispatchEligibility remains an audit/mirror; the task claim is authoritative.
 * Wakes without a persisted task authority record stay wake-op-only (no task CAS).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveGroupWorkspacePath,
} from "../collaboration-learning/shared.js";
import { withRoundLock } from "./round-store-io.js";
import { asGovernedTask, type GovernedTask, type TaskDispatchClaim } from "./task-runtime.js";
import { isTaskStopAccepted } from "./task-stop-control.js";
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
  authFingerprint: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Optional target actors for live auth fingerprint re-check inside the CAS. */
  targetActorIds?: readonly string[];
};

export type CasCommitTaskDispatchEligibilityResult =
  | { ok: true; task: GovernedTask; claim: TaskDispatchClaim }
  | {
      ok: false;
      reason:
        | "task_missing"
        | "task_stopped"
        | "epoch_mismatch"
        | "auth_fingerprint_mismatch"
        | "auth_source_unreadable"
        | "task_control_unreadable"
        | "claim_held";
      detail: string;
      task?: GovernedTask | null;
    };

/**
 * Expected-version CAS: under task control lock, commit dispatchClaim on the
 * task authority record iff controlEpoch still equals expected, task is not stopped,
 * and no other valid claim is held (single-claim model).
 */
export async function casCommitTaskDispatchEligibility(
  params: CasCommitTaskDispatchEligibilityParams,
): Promise<CasCommitTaskDispatchEligibilityResult> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const opKey = compact(params.opKey);
  const expected = params.expectedControlEpoch;
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

      // Re-read auth fingerprint under the same lock window so a revoke that
      // raced after the caller's observation cannot be stamped as eligible.
      // (Fingerprint condition only — revoke writes are not on this task CAS.)
      let liveFp = wantFp;
      if (params.targetActorIds && params.targetActorIds.length > 0) {
        try {
          const { fileStore } = createWorkspaceCollaborationStores(cfg);
          const os = await readGroupOperatingState({
            fileStore,
            groupId: params.groupId,
          });
          liveFp = wakeOpAuthFingerprint(os, params.targetActorIds);
        } catch (error) {
          return {
            ok: false,
            reason: "auth_source_unreadable",
            detail: `auth source unreadable during eligibility CAS: ${String(error)}`,
            task: governed,
          };
        }
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

      const claim: TaskDispatchClaim = {
        opKey,
        controlEpoch: liveEpoch,
        authFingerprint: wantFp,
        committedAtMs: nowMs,
        phase: "committed",
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
  cfg?: OpenBotConfig;
  nowMs?: number;
  targetActorIds?: readonly string[];
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
        | "epoch_mismatch"
        | "auth_fingerprint_mismatch"
        | "auth_source_unreadable"
        | "task_control_unreadable"
        | "already_taken";
      detail: string;
      task?: GovernedTask | null;
    };

/**
 * Before external dispatcher: CAS-take the task dispatchClaim with unoverwritable
 * version condition (epoch + fingerprint still match). Stop that advanced
 * controlEpoch (or a fingerprint mismatch from live revoke recheck) causes take
 * to fail — dispatcher must not run. Revoke itself is not a shared-epoch writer.
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

      if (params.targetActorIds && params.targetActorIds.length > 0) {
        let liveFp = "";
        try {
          const { fileStore } = createWorkspaceCollaborationStores(cfg);
          const os = await readGroupOperatingState({
            fileStore,
            groupId: params.groupId,
          });
          liveFp = wakeOpAuthFingerprint(os, params.targetActorIds);
        } catch (error) {
          return {
            ok: false,
            reason: "auth_source_unreadable",
            detail: `auth source unreadable during eligibility take: ${String(error)}`,
            task: governed,
          };
        }
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
 * dispatch was refused before the external call), clear this op's claim so a
 * later op can commit under the single-claim model. No-op if missing/mismatched.
 * Does not bump controlEpoch (stop remains the version bump).
 */
export async function casClearTaskDispatchClaimForOp(params: {
  groupId: string;
  taskId: string;
  opKey: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ cleared: boolean; task: GovernedTask | null }> {
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
      } catch {
        return { cleared: false, task: null };
      }
      if (!current) {
        return { cleared: false, task: null };
      }
      const governed = asGovernedTask(current);
      const claim = governed.dispatchClaim;
      if (!claim || compact(claim.opKey) !== opKey) {
        return { cleared: false, task: governed };
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

/** Test helper: brief yield so concurrent lock contenders can interleave. */
export function _testTaskControlCasYieldMs(): number {
  return LOCK_RETRY_MS;
}

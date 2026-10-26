/**
 * P0-2 — Wake → Mode B round-dispatch consumer (2026-10-19).
 *
 * Inventory gap: trySelfAdvance / heartbeat nudge|escalate successfully wrote
 * wake ledger rows with outcome `recorded`, but nobody opened an execution
 * round. Human `structured_mention` still required for 真回合.
 *
 * This module is the opt-in consumer for sources `self_advance` | `nudge` |
 * `escalate`. When Wake Contract is on for the group AND selfAdvance
 * writeMode=execute (mode+executeGroupAllowlist), the consumer asks an
 * injected Mode B dispatcher (reuses executeCollaborationRound — no second
 * orchestrator). Success → wake outcome `dispatched`; dry_run / flag-off /
 * allowlist miss / no consumer → `recorded`.
 *
 * Default global OFF: hangs on existing wake + selfAdvance allowlists.
 * No LIVE / Floor / multi-beat flips.
 */
import type { Task } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/types.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
} from "../collaboration-learning/shared.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import {
  casClearTaskDispatchClaimForOp,
  casCommitTaskDispatchEligibility,
  casReleaseUnconsumedCommittedClaim,
  casTakeTaskDispatchEligibility,
} from "./task-control-cas.js";
import { recheckCurrentDispatchAuthorization } from "./task-dispatch-auth-recheck.js";
import { asGovernedTask } from "./task-runtime.js";
import { isTaskStopAccepted } from "./task-stop-control.js";
import {
  isCollabTaskWakeContractEnabled,
  recordWakeEvent,
  type WakeEvent,
  type WakeOutcome,
  type WakeSource,
} from "./wake-contract.js";
import {
  claimWakeOpRunning,
  commitWakeOpDispatchEligibility,
  inspectWakeOp,
  isDispatchEligibilityCurrent,
  markWakeOpCompleted,
  markWakeOpFailed,
  markWakeOpUnknown,
  readWakeOpRecord,
  wakeOpAuthFingerprint,
  wakeOpIdempotencyKey,
  type WakeOpRecord,
} from "./wake-op-ledger.js";

export const WAKE_ROUND_DISPATCH_SOURCES = ["self_advance", "nudge", "escalate"] as const;

export type WakeRoundDispatchSource = (typeof WAKE_ROUND_DISPATCH_SOURCES)[number];

export type WakeRoundDispatchWriteMode = "dry_run" | "execute";

export type WakeRoundDispatchRequest = Readonly<{
  groupId: string;
  tenantId?: string | null;
  fromAgentId: string;
  toAgentIds: readonly string[];
  source: WakeSource;
  taskId?: string;
  itemId?: string;
  reason?: string;
  relatedId?: string;
  /** Explicit U3 idempotency key; when omitted, derived from request fields. */
  opKey?: string;
}>;

export type WakeRoundDispatchResult =
  | { ok: true; roundId: string; detail?: string }
  | { ok: false; reason: string; message?: string };

/**
 * Composition-root port. Production binds a Mode B dispatcher that calls
 * `executeCollaborationRound`. Tests inject a mock. Unbound = 无消费 → recorded.
 */
export type WakeRoundDispatcher = (
  request: WakeRoundDispatchRequest,
) => Promise<WakeRoundDispatchResult>;

let registeredDispatcher: WakeRoundDispatcher | null = null;

/** Bind / clear the process-wide Mode B wake→round dispatcher (gateway boot). */
export function setWakeRoundDispatcher(dispatcher: WakeRoundDispatcher | null): void {
  registeredDispatcher = dispatcher;
}

export function getWakeRoundDispatcher(): WakeRoundDispatcher | null {
  return registeredDispatcher;
}

export function isWakeRoundDispatchSource(source: string): source is WakeRoundDispatchSource {
  return (WAKE_ROUND_DISPATCH_SOURCES as readonly string[]).includes(source);
}

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Mirror of resolveSelfAdvanceWriteMode — kept local to avoid import cycles
 * with self-advance.ts (which consumes this module).
 */
export function resolveWakeRoundSelfAdvanceWriteMode(
  cfg: OpenBotConfig | undefined,
  groupId: string,
  tenantId?: string | null,
): WakeRoundDispatchWriteMode {
  const modeRaw = cfg?.collaboration?.task?.selfAdvance?.mode;
  const mode: WakeRoundDispatchWriteMode = modeRaw === "execute" ? "execute" : "dry_run";
  if (mode !== "execute") {
    return "dry_run";
  }
  const raw = cfg?.collaboration?.task?.selfAdvance?.executeGroupAllowlist;
  const entries = Array.isArray(raw)
    ? raw.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    : [];
  const onList = matchGrayGroupAllowlist({
    groupId,
    tenantId,
    entries,
  });
  return onList ? "execute" : "dry_run";
}

export type WakeRoundDispatchGate = Readonly<{
  allowed: boolean;
  reason: string;
  wakeEnabled: boolean;
  selfAdvanceWriteMode: WakeRoundDispatchWriteMode;
  sourceEligible: boolean;
}>;

/**
 * Pure gate. Dispatch only when:
 *   1. source ∈ self_advance|nudge|escalate
 *   2. wakeContract enabled for group (global or allowlist)
 *   3. selfAdvance writeMode=execute (mode=execute + executeGroupAllowlist)
 *
 * dry_run paths stay recorded (caller passes writeMode override).
 */
export function evaluateWakeRoundDispatchGate(params: {
  source: WakeSource;
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
  /**
   * Effective side-effect mode for this tick. When `dry_run` (or omitted while
   * selfAdvance resolves dry_run), gate refuses dispatch.
   */
  writeMode?: WakeRoundDispatchWriteMode;
}): WakeRoundDispatchGate {
  const groupId = compact(params.groupId);
  const sourceEligible = isWakeRoundDispatchSource(params.source);
  const wakeEnabled = Boolean(
    groupId && isCollabTaskWakeContractEnabled(params.cfg, groupId, params.tenantId),
  );
  const selfAdvanceWriteMode =
    params.writeMode ??
    (groupId
      ? resolveWakeRoundSelfAdvanceWriteMode(params.cfg, groupId, params.tenantId)
      : "dry_run");

  if (!sourceEligible) {
    return {
      allowed: false,
      reason: `source_not_dispatchable:${params.source}`,
      wakeEnabled,
      selfAdvanceWriteMode,
      sourceEligible: false,
    };
  }
  if (!groupId) {
    return {
      allowed: false,
      reason: "missing_group_id",
      wakeEnabled: false,
      selfAdvanceWriteMode,
      sourceEligible: true,
    };
  }
  if (!wakeEnabled) {
    return {
      allowed: false,
      reason: "wake_contract_off",
      wakeEnabled: false,
      selfAdvanceWriteMode,
      sourceEligible: true,
    };
  }
  if (selfAdvanceWriteMode !== "execute") {
    return {
      allowed: false,
      reason: "self_advance_not_execute",
      wakeEnabled: true,
      selfAdvanceWriteMode,
      sourceEligible: true,
    };
  }
  return {
    allowed: true,
    reason: "wake_round_dispatch_eligible",
    wakeEnabled: true,
    selfAdvanceWriteMode: "execute",
    sourceEligible: true,
  };
}

export type ConsumeWakeRoundDispatchParams = {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  request: WakeRoundDispatchRequest;
  /** Tick write mode (self_advance dry_run|execute). */
  writeMode?: WakeRoundDispatchWriteMode;
  /** Override process registry (tests). null = force 无消费. */
  roundDispatcher?: WakeRoundDispatcher | null;
  /** Skip dispatch attempt even when gate allows (tests). */
  skipRoundDispatch?: boolean;
  nowMs?: number;
  /**
   * Test-only barrier after durable claim, before eligibility commit (M3 order 1).
   * Production callers omit this.
   */
  _testAfterClaimBarrier?: () => Promise<void>;
  /**
   * Test-only barrier after control state (task epoch + auth fingerprint) is read,
   * before eligibility commit. Proves stop/revoke interleaved here cannot win eligibility.
   */
  _testAfterControlReadBeforeEligibilityBarrier?: () => Promise<void>;
  /**
   * Test-only barrier after pre-commit recheck completes, immediately before the
   * shared task expected-version CAS (T41). Stop/revoke here must make CAS fail.
   */
  _testAfterRecheckBeforeTaskCasBarrier?: () => Promise<void>;
  /**
   * Test-only barrier after eligibility commit, before external dispatch (M3 order 2).
   * T41: CAS take runs after this barrier — stop/revoke here must refuse take.
   */
  _testAfterEligibilityBarrier?: () => Promise<void>;
  /**
   * Test-only barrier after external dispatcher returns ok, before receipt write (M3 order 3).
   */
  _testAfterExternalBeforeReceiptBarrier?: () => Promise<void>;
  /**
   * Test-only: force task control reads in the post-eligibility gate to throw
   * (simulates store I/O / parse failure — distinct from missing task).
   */
  _testForcePostEligibilityTaskReadError?: Error | (() => Error);
  /**
   * Test-only: force operating-state / auth-source reads in the post-eligibility
   * gate to throw (must not keep the prior fingerprint).
   */
  _testForcePostEligibilityAuthSourceReadError?: Error | (() => Error);
  /**
   * Test-only: force task control read in the pre-claim U1 stop check to throw
   * (must refuse / unknown — must not silently fall through into claim).
   */
  _testForcePreClaimTaskReadError?: Error | (() => Error);
  /**
   * Test-only: force operating-state read inside pre-claim auth recheck to throw
   * (recheckCurrentDispatchAuthorization must not ok:true; no claim).
   */
  _testForcePreClaimAuthOsReadError?: Error | (() => Error);
  /**
   * Test-only: after task CAS commit succeeds, force wake-op eligibility mirror
   * to fail (simulate mirror write failure with task claim already committed).
   */
  _testForceEligibilityMirrorFailure?: boolean | Error | (() => Error);
  /**
   * Test-only: force claim clear in finally to throw (cleanup must not mask
   * completed/unknown outcome or trigger a second dispatch).
   */
  _testForceClaimClearError?: Error | (() => Error);
};

export type ConsumeWakeRoundDispatchResult = Readonly<{
  outcome: Extract<WakeOutcome, "dispatched" | "recorded">;
  dispatched: boolean;
  gate: WakeRoundDispatchGate;
  reason: string;
  wakeEvent?: WakeEvent;
  roundId?: string;
  dispatcherPresent: boolean;
  /** U3 durable op key (derived or explicit). */
  opKey?: string;
  /** U3 persistent processing snapshot when consulted. */
  wakeOp?: WakeOpRecord;
  /** True when a prior completed result was reused (no new side effect). */
  reused?: boolean;
}>;

/**
 * Attempt Mode B round dispatch when gated, then append a wake row whose
 * outcome is `dispatched` only on successful dispatch. Always best-effort on
 * the wake write; never throws into self_advance / heartbeat hot paths.
 */
export async function consumeWakeForRoundDispatch(
  params: ConsumeWakeRoundDispatchParams,
): Promise<ConsumeWakeRoundDispatchResult> {
  const request: WakeRoundDispatchRequest = {
    ...params.request,
    groupId: compact(params.request.groupId) || params.authority.groupId,
    tenantId: params.request.tenantId ?? params.authority.tenantId,
    fromAgentId: compact(params.request.fromAgentId),
    toAgentIds: params.request.toAgentIds.map((id) => compact(id)).filter(Boolean),
  };

  const keyInput = {
    groupId: request.groupId,
    source: request.source,
    fromAgentId: request.fromAgentId,
    toAgentIds: request.toAgentIds,
    taskId: request.taskId,
    itemId: request.itemId,
    opKey: request.opKey,
  };
  const opKey = wakeOpIdempotencyKey(keyInput);

  const emptyGate = (): WakeRoundDispatchGate =>
    evaluateWakeRoundDispatchGate({
      source: request.source,
      groupId: request.groupId,
      tenantId: request.tenantId,
      cfg: params.cfg,
      writeMode: params.writeMode,
    });

  // U3: durable inspect before side effects (reuse / suppress without memory-only dedup).
  let inspected = await inspectWakeOp({ authority: params.authority, keyInput });
  if (inspected.action === "reuse") {
    return {
      outcome: "dispatched",
      dispatched: true,
      gate: emptyGate(),
      reason: "idempotent_reuse",
      wakeEvent: undefined,
      roundId: inspected.record.roundId,
      dispatcherPresent: false,
      opKey: inspected.opKey,
      wakeOp: inspected.record,
      reused: true,
    };
  }
  if (inspected.action === "suppress") {
    return {
      outcome: "recorded",
      dispatched: false,
      gate: emptyGate(),
      reason: inspected.reason,
      wakeEvent: undefined,
      roundId: undefined,
      dispatcherPresent: false,
      opKey: inspected.opKey,
      wakeOp: inspected.record,
      reused: false,
    };
  }

  const stoppedTaskId = compact(request.taskId);
  if (stoppedTaskId) {
    try {
      if (params._testForcePreClaimTaskReadError) {
        const forced = params._testForcePreClaimTaskReadError;
        throw typeof forced === "function" ? forced() : forced;
      }
      const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
      const current = await objectStorage.readObject<Task>(request.groupId, "task", stoppedTaskId);
      if (current && isTaskStopAccepted(asGovernedTask(current))) {
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: "task_stopped",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey,
          reused: false,
        };
      }
      // null / absent task: never-observed → do not invent stop; distinct from throw.
    } catch {
      // store read failure: refuse before claim (≠ never-observed null).
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "task_control_unreadable",
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey,
        reused: false,
      };
    }
  }

  // U2: current-auth recheck at the same preflight position as U1 stop.
  // Independent of stop — revoked membership/duty must not dispatch.
  {
    const auth = await recheckCurrentDispatchAuthorization({
      groupId: request.groupId,
      taskId: request.taskId,
      targetActorIds: request.toAgentIds,
      cfg: params.cfg,
      _testForceOperatingStateReadError: params._testForcePreClaimAuthOsReadError,
    });
    if (!auth.ok) {
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: auth.reason,
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey,
        reused: false,
      };
    }
  }

  // U3: claim durable running only after stop+auth passed (covers resume retry).
  const claimed = await claimWakeOpRunning({
    authority: params.authority,
    keyInput,
    cfg: params.cfg,
    nowMs: params.nowMs,
  });
  if (claimed.action === "reuse") {
    return {
      outcome: "dispatched",
      dispatched: true,
      gate: emptyGate(),
      reason: "idempotent_reuse",
      wakeEvent: undefined,
      roundId: claimed.record.roundId,
      dispatcherPresent: false,
      opKey: claimed.opKey,
      wakeOp: claimed.record,
      reused: true,
    };
  }
  if (claimed.action === "suppress") {
    return {
      outcome: "recorded",
      dispatched: false,
      gate: emptyGate(),
      reason: claimed.reason,
      wakeEvent: undefined,
      roundId: undefined,
      dispatcherPresent: false,
      opKey: claimed.opKey,
      wakeOp: claimed.record,
      reused: false,
    };
  }

  let wakeOp: WakeOpRecord | undefined = claimed.record ?? undefined;

  // M3 order-1 seam: after claim, before eligibility commit.
  if (params._testAfterClaimBarrier) {
    await params._testAfterClaimBarrier();
  }

  // M3 linearization point: commit dispatch eligibility under wake-op lock after
  // stop+auth recheck. Does not hold the lock across external I/O.
  let eligibilityControlEpoch = 0;
  let eligibilityAuthFingerprint = "";
  /** True when a task record was observed for stop/epoch (distinct from missing). */
  let eligibilityTaskObserved = false;
  /** T41: task-authority CAS commit succeeded (take required before dispatcher). */
  let taskEligibilityCasCommitted = false;
  /** T43: claimId from successful commit — bind take/clear/release. */
  let taskDispatchClaimId = "";
  /** T42: take succeeded — clear this op's claim when the attempt finishes (single-claim). */
  let taskDispatchClaimTaken = false;
  /** T43: committed but not taken — must release on abandon paths (not only finally-after-take). */
  let taskDispatchClaimNeedsRelease = false;
  {
    let stoppedAfterClaim = false;
    let taskControlUnreadableAfterClaim = false;
    if (stoppedTaskId) {
      try {
        const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
        const current = await objectStorage.readObject<Task>(
          request.groupId,
          "task",
          stoppedTaskId,
        );
        if (current && isTaskStopAccepted(asGovernedTask(current))) {
          eligibilityTaskObserved = true;
          stoppedAfterClaim = true;
        } else if (current) {
          eligibilityTaskObserved = true;
          const governed = asGovernedTask(current);
          eligibilityControlEpoch =
            typeof governed.controlEpoch === "number" && Number.isFinite(governed.controlEpoch)
              ? Number(governed.controlEpoch)
              : 0;
        }
        // Missing task: no stop surface to evaluate — do NOT conclude "not stopped";
        // also do not invent a trusted control observation (epoch stays 0, flag false).
      } catch {
        // Control unreadable: refuse eligibility (do not fail-open on old/zero epoch).
        taskControlUnreadableAfterClaim = true;
      }
    }
    if (stoppedAfterClaim) {
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: "task_stopped_after_claim",
      });
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "task_stopped",
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey: claimed.opKey,
        wakeOp: failed ?? claimed.record ?? undefined,
        reused: false,
      };
    }
    if (taskControlUnreadableAfterClaim) {
      const unknown = await markWakeOpUnknown({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: "task_control_unreadable_before_eligibility",
      });
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "task_control_unreadable",
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey: claimed.opKey,
        wakeOp: unknown ?? claimed.record ?? undefined,
        reused: false,
      };
    }

    const auth = await recheckCurrentDispatchAuthorization({
      groupId: request.groupId,
      taskId: request.taskId,
      targetActorIds: request.toAgentIds,
      cfg: params.cfg,
    });
    if (!auth.ok) {
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: `${auth.reason}_after_claim`,
      });
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: auth.reason,
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey: claimed.opKey,
        wakeOp: failed ?? claimed.record ?? undefined,
        reused: false,
      };
    }

    let authSourceUnreadableBeforeEligibility = false;
    try {
      const { fileStore } = createWorkspaceCollaborationStores(params.cfg);
      const os = await readGroupOperatingState({ fileStore, groupId: request.groupId });
      eligibilityAuthFingerprint = wakeOpAuthFingerprint(os, request.toAgentIds);
    } catch {
      // Do not commit a sentinel fingerprint and fail-open; refuse eligibility.
      authSourceUnreadableBeforeEligibility = true;
    }
    if (authSourceUnreadableBeforeEligibility) {
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: "auth_source_unreadable_before_eligibility",
      });
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "auth_source_unreadable",
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey: claimed.opKey,
        wakeOp: failed ?? claimed.record ?? undefined,
        reused: false,
      };
    }

    // Barrier: control state observed; stop/revoke here must prevent eligibility win.
    if (params._testAfterControlReadBeforeEligibilityBarrier) {
      await params._testAfterControlReadBeforeEligibilityBarrier();
    }

    // Re-check stop + auth after the barrier / before commit so eligibility shares
    // the decision with control changes that raced after the initial read.
    {
      let stopBeforeCommit = false;
      let taskUnreadableBeforeCommit = false;
      let taskMissingBeforeCommit = false;
      if (stoppedTaskId) {
        try {
          const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
          const current = await objectStorage.readObject<Task>(
            request.groupId,
            "task",
            stoppedTaskId,
          );
          if (!current) {
            // Missing after we had observed a task → cannot keep "not stopped".
            if (eligibilityTaskObserved) {
              taskMissingBeforeCommit = true;
            }
          } else {
            eligibilityTaskObserved = true;
            const governed = asGovernedTask(current);
            eligibilityControlEpoch =
              typeof governed.controlEpoch === "number" && Number.isFinite(governed.controlEpoch)
                ? Number(governed.controlEpoch)
                : 0;
            if (isTaskStopAccepted(governed)) {
              stopBeforeCommit = true;
            }
          }
        } catch {
          taskUnreadableBeforeCommit = true;
        }
      }
      if (stopBeforeCommit) {
        const failed = await markWakeOpFailed({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail: "task_stopped_before_eligibility_commit",
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: "task_stopped",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: failed ?? claimed.record ?? undefined,
          reused: false,
        };
      }
      if (taskUnreadableBeforeCommit || taskMissingBeforeCommit) {
        const detail = taskUnreadableBeforeCommit
          ? "task_control_unreadable_before_eligibility_commit"
          : "task_missing_before_eligibility_commit";
        const unknown = await markWakeOpUnknown({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail,
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: taskUnreadableBeforeCommit ? "task_control_unreadable" : "task_missing",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: unknown ?? claimed.record ?? undefined,
          reused: false,
        };
      }
      const authBeforeCommit = await recheckCurrentDispatchAuthorization({
        groupId: request.groupId,
        taskId: request.taskId,
        targetActorIds: request.toAgentIds,
        cfg: params.cfg,
      });
      if (!authBeforeCommit.ok) {
        const failed = await markWakeOpFailed({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail: `${authBeforeCommit.reason}_before_eligibility_commit`,
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: authBeforeCommit.reason,
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: failed ?? claimed.record ?? undefined,
          reused: false,
        };
      }
      try {
        const { fileStore } = createWorkspaceCollaborationStores(params.cfg);
        const os = await readGroupOperatingState({ fileStore, groupId: request.groupId });
        eligibilityAuthFingerprint = wakeOpAuthFingerprint(os, request.toAgentIds);
      } catch {
        const failed = await markWakeOpFailed({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail: "auth_source_unreadable_before_eligibility_commit",
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: "auth_source_unreadable",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: failed ?? claimed.record ?? undefined,
          reused: false,
        };
      }
    }

    // T41: shared expected-version CAS on the task authority record BEFORE wake-op
    // mirror. Stop that advanced controlEpoch loses here; revoke is refused via
    // live auth fingerprint mismatch inside the CAS (not a shared-epoch writer).
    if (params._testAfterRecheckBeforeTaskCasBarrier) {
      await params._testAfterRecheckBeforeTaskCasBarrier();
    }
    // Shared CAS only when a task authority record was observed (stop surface exists).
    // taskId-without-task (legacy / no stop plane) keeps wake-op-only eligibility.
    if (stoppedTaskId && eligibilityTaskObserved) {
      const cas = await casCommitTaskDispatchEligibility({
        groupId: request.groupId,
        taskId: stoppedTaskId,
        opKey: claimed.opKey,
        expectedControlEpoch: eligibilityControlEpoch,
        authFingerprint: eligibilityAuthFingerprint,
        targetActorIds: request.toAgentIds,
        executionAttemptId: claimed.record?.executionAttemptId,
        cfg: params.cfg,
        nowMs: params.nowMs,
      });
      if (!cas.ok) {
        const detail = `task_eligibility_cas_failed:${cas.reason}:${cas.detail}`;
        const isStop = cas.reason === "task_stopped" || cas.reason === "epoch_mismatch";
        const isAuth =
          cas.reason === "auth_fingerprint_mismatch" || cas.reason === "auth_source_unreadable";
        if (cas.reason === "task_control_unreadable" || cas.reason === "task_missing") {
          const unknown = await markWakeOpUnknown({
            authority: params.authority,
            opKey: claimed.opKey,
            cfg: params.cfg,
            nowMs: params.nowMs,
            detail,
          });
          return {
            outcome: "recorded",
            dispatched: false,
            gate: emptyGate(),
            reason: cas.reason,
            wakeEvent: undefined,
            roundId: undefined,
            dispatcherPresent: false,
            opKey: claimed.opKey,
            wakeOp: unknown ?? claimed.record ?? undefined,
            reused: false,
          };
        }
        const failed = await markWakeOpFailed({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail,
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: isStop
            ? "task_stopped"
            : isAuth
              ? cas.reason === "auth_source_unreadable"
                ? "auth_source_unreadable"
                : "auth_revoked"
              : "eligibility_cas_rejected",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: failed ?? claimed.record ?? undefined,
          reused: false,
        };
      }
      taskEligibilityCasCommitted = true;
      taskDispatchClaimId = cas.claim.claimId;
      taskDispatchClaimNeedsRelease = true;
    }

    // T43: simulate wake-op mirror failure after task claim already committed.
    if (params._testForceEligibilityMirrorFailure && taskEligibilityCasCommitted) {
      const forced = params._testForceEligibilityMirrorFailure;
      const err =
        typeof forced === "function"
          ? forced()
          : forced instanceof Error
            ? forced
            : new Error("forced_eligibility_mirror_failure");
      void err;
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: "eligibility_mirror_failed",
      });
      if (stoppedTaskId && taskDispatchClaimNeedsRelease && taskDispatchClaimId) {
        taskDispatchClaimNeedsRelease = false;
        await casReleaseUnconsumedCommittedClaim({
          groupId: request.groupId,
          taskId: stoppedTaskId,
          opKey: claimed.opKey,
          claimId: taskDispatchClaimId,
          cfg: params.cfg,
          nowMs: params.nowMs,
        });
      }
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "eligibility_commit_failed",
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey: claimed.opKey,
        wakeOp: failed ?? claimed.record ?? undefined,
        reused: false,
      };
    }

    const eligible = await commitWakeOpDispatchEligibility({
      authority: params.authority,
      opKey: claimed.opKey,
      cfg: params.cfg,
      nowMs: params.nowMs,
      controlEpoch: eligibilityControlEpoch,
      authFingerprint: eligibilityAuthFingerprint,
    });
    if (!eligible?.dispatchEligibility) {
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: "eligibility_commit_failed",
      });
      // T43: task claim may already be committed — release unconsumed so others are not stuck.
      if (stoppedTaskId && taskDispatchClaimNeedsRelease && taskDispatchClaimId) {
        taskDispatchClaimNeedsRelease = false;
        await casReleaseUnconsumedCommittedClaim({
          groupId: request.groupId,
          taskId: stoppedTaskId,
          opKey: claimed.opKey,
          claimId: taskDispatchClaimId,
          cfg: params.cfg,
          nowMs: params.nowMs,
        });
      }
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "eligibility_commit_failed",
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey: claimed.opKey,
        wakeOp: failed ?? claimed.record ?? undefined,
        reused: false,
      };
    }
    wakeOp = eligible;
  }

  // M3 order-2 seam: after eligibility commit, before external request.
  if (params._testAfterEligibilityBarrier) {
    await params._testAfterEligibilityBarrier();
  }

  // T41: CAS-take task dispatchClaim (unoverwritable version condition) before any
  // external dispatcher call. Stop that advanced controlEpoch refuses take; revoke
  // mismatch is a fingerprint recheck under the same lock, not shared-epoch write.
  if (stoppedTaskId && taskEligibilityCasCommitted) {
    const take = await casTakeTaskDispatchEligibility({
      groupId: request.groupId,
      taskId: stoppedTaskId,
      opKey: claimed.opKey,
      claimId: taskDispatchClaimId,
      targetActorIds: request.toAgentIds,
      cfg: params.cfg,
      nowMs: params.nowMs,
    });
    if (!take.ok) {
      const detail = `task_eligibility_take_failed:${take.reason}:${take.detail}`;
      // T43: take refused before consumption — release committed claim (helper no-ops if
      // already cleared by stop, or refuses if somehow taken). Never timeout-infer.
      if (taskDispatchClaimNeedsRelease && taskDispatchClaimId) {
        taskDispatchClaimNeedsRelease = false;
        await casReleaseUnconsumedCommittedClaim({
          groupId: request.groupId,
          taskId: stoppedTaskId,
          opKey: claimed.opKey,
          claimId: taskDispatchClaimId,
          cfg: params.cfg,
          nowMs: params.nowMs,
        });
      }
      if (
        take.reason === "task_stopped" ||
        take.reason === "epoch_mismatch" ||
        take.reason === "claim_missing"
      ) {
        const unknown = await markWakeOpUnknown({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail,
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: "task_stopped_in_flight",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: unknown ?? wakeOp,
          reused: false,
        };
      }
      if (take.reason === "task_control_unreadable" || take.reason === "task_missing") {
        const unknown = await markWakeOpUnknown({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail,
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: take.reason,
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: unknown ?? wakeOp,
          reused: false,
        };
      }
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail,
      });
      const reason =
        take.reason === "auth_source_unreadable"
          ? "auth_source_unreadable"
          : take.reason === "auth_fingerprint_mismatch"
            ? "auth_revoked"
            : "eligibility_take_rejected";
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason,
        wakeEvent: undefined,
        roundId: undefined,
        dispatcherPresent: false,
        opKey: claimed.opKey,
        wakeOp: failed ?? wakeOp,
        reused: false,
      };
    }
    taskDispatchClaimTaken = true;
    taskDispatchClaimNeedsRelease = false;
  }

  try {
    // Post-eligibility defense-in-depth (FO unreadable paths + wake-op snapshot check).
    // Shared-version adjudication for *stop* is the CAS take above — not another recheck.
    // Revoke remains fingerprint-conditioned at commit/take (not shared-epoch with OS).
    {
      let stopAfterEligibility = false;
      let currentEpoch = eligibilityControlEpoch;
      let taskControlUnreadable = false;
      let taskMissing = false;
      if (stoppedTaskId) {
        try {
          if (params._testForcePostEligibilityTaskReadError) {
            const forced = params._testForcePostEligibilityTaskReadError;
            throw typeof forced === "function" ? forced() : forced;
          }
          const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
          const current = await objectStorage.readObject<Task>(
            request.groupId,
            "task",
            stoppedTaskId,
          );
          if (current) {
            const governed = asGovernedTask(current);
            currentEpoch =
              typeof governed.controlEpoch === "number" && Number.isFinite(governed.controlEpoch)
                ? Number(governed.controlEpoch)
                : 0;
            if (isTaskStopAccepted(governed)) {
              stopAfterEligibility = true;
            }
          } else if (eligibilityTaskObserved) {
            // Had a task at eligibility time; missing now ≠ default "not stopped".
            taskMissing = true;
          }
          // else: never observed a task record — no stop surface; do not invent stop.
        } catch {
          taskControlUnreadable = true;
        }
      }
      let authFp = eligibilityAuthFingerprint;
      let authSourceUnreadable = false;
      try {
        if (params._testForcePostEligibilityAuthSourceReadError) {
          const forced = params._testForcePostEligibilityAuthSourceReadError;
          throw typeof forced === "function" ? forced() : forced;
        }
        const { fileStore } = createWorkspaceCollaborationStores(params.cfg);
        const os = await readGroupOperatingState({ fileStore, groupId: request.groupId });
        authFp = wakeOpAuthFingerprint(os, request.toAgentIds);
      } catch {
        // Do not retain the eligibility-time fingerprint.
        authSourceUnreadable = true;
        authFp = "";
      }
      if (taskControlUnreadable || taskMissing || authSourceUnreadable) {
        const detail = taskControlUnreadable
          ? "task_control_unreadable_after_eligibility"
          : taskMissing
            ? "task_missing_after_eligibility"
            : "auth_source_unreadable_after_eligibility";
        const reason = taskControlUnreadable
          ? "task_control_unreadable"
          : taskMissing
            ? "task_missing"
            : "auth_source_unreadable";
        // Unreadable control → uncertain (unknown); unreadable auth source → clear refuse (failed).
        if (authSourceUnreadable && !taskControlUnreadable && !taskMissing) {
          const failed = await markWakeOpFailed({
            authority: params.authority,
            opKey: claimed.opKey,
            cfg: params.cfg,
            nowMs: params.nowMs,
            detail,
          });
          return {
            outcome: "recorded",
            dispatched: false,
            gate: emptyGate(),
            reason,
            wakeEvent: undefined,
            roundId: undefined,
            dispatcherPresent: false,
            opKey: claimed.opKey,
            wakeOp: failed ?? wakeOp,
            reused: false,
          };
        }
        const unknown = await markWakeOpUnknown({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail,
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason,
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: unknown ?? wakeOp,
          reused: false,
        };
      }
      const auth = await recheckCurrentDispatchAuthorization({
        groupId: request.groupId,
        taskId: request.taskId,
        targetActorIds: request.toAgentIds,
        cfg: params.cfg,
      });
      const eligibilityStillValid =
        !stopAfterEligibility &&
        auth.ok &&
        isDispatchEligibilityCurrent({
          eligibility: wakeOp?.dispatchEligibility,
          controlEpoch: currentEpoch,
          authFingerprint: authFp,
        });
      if (!eligibilityStillValid) {
        const detail = stopAfterEligibility
          ? "stop_after_eligibility_before_external"
          : !auth.ok
            ? `${auth.reason}_after_eligibility`
            : "eligibility_stale_before_external";
        // External request not sent: mark unknown (in-flight uncertainty) when stop
        // interrupted an eligible holder; auth revoke / auth-source unreadable → failed.
        if (stopAfterEligibility) {
          const unknown = await markWakeOpUnknown({
            authority: params.authority,
            opKey: claimed.opKey,
            cfg: params.cfg,
            nowMs: params.nowMs,
            detail,
          });
          return {
            outcome: "recorded",
            dispatched: false,
            gate: emptyGate(),
            reason: "task_stopped_in_flight",
            wakeEvent: undefined,
            roundId: undefined,
            dispatcherPresent: false,
            opKey: claimed.opKey,
            wakeOp: unknown ?? wakeOp,
            reused: false,
          };
        }
        const failed = await markWakeOpFailed({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail,
        });
        return {
          outcome: "recorded",
          dispatched: false,
          gate: emptyGate(),
          reason: !auth.ok ? auth.reason : "eligibility_stale",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
          opKey: claimed.opKey,
          wakeOp: failed ?? wakeOp,
          reused: false,
        };
      }
    }

    const gate = evaluateWakeRoundDispatchGate({
      source: request.source,
      groupId: request.groupId,
      tenantId: request.tenantId,
      cfg: params.cfg,
      writeMode: params.writeMode,
    });

    const dispatcher = params.skipRoundDispatch
      ? null
      : params.roundDispatcher !== undefined
        ? params.roundDispatcher
        : getWakeRoundDispatcher();
    const dispatcherPresent = typeof dispatcher === "function";

    let outcome: Extract<WakeOutcome, "dispatched" | "recorded"> = "recorded";
    let dispatched = false;
    let reason = gate.reason;
    let roundId: string | undefined;

    if (gate.allowed && dispatcherPresent && dispatcher) {
      try {
        const result = await dispatcher(request);
        if (result.ok && compact(result.roundId)) {
          // M3 order-3 seam: external sent, receipt not yet written.
          if (params._testAfterExternalBeforeReceiptBarrier) {
            await params._testAfterExternalBeforeReceiptBarrier();
          }
          // Re-validate eligibility before durable success receipt. If stop/revoke
          // advanced after the external call, keep unknown/in-flight — do not
          // silently complete as success (expired holder).
          let receiptEpoch = eligibilityControlEpoch;
          let receiptAuthFp = eligibilityAuthFingerprint;
          let stopAfterExternal = false;
          let receiptTaskMissing = false;
          let receiptTaskUnreadable = false;
          let receiptAuthUnreadable = false;
          if (stoppedTaskId) {
            try {
              const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
              const current = await objectStorage.readObject<Task>(
                request.groupId,
                "task",
                stoppedTaskId,
              );
              if (current) {
                const governed = asGovernedTask(current);
                receiptEpoch =
                  typeof governed.controlEpoch === "number" &&
                  Number.isFinite(governed.controlEpoch)
                    ? Number(governed.controlEpoch)
                    : 0;
                if (isTaskStopAccepted(governed)) {
                  stopAfterExternal = true;
                }
              } else if (eligibilityTaskObserved) {
                // Observed at eligibility; missing before receipt → cannot prove control.
                receiptTaskMissing = true;
              }
            } catch {
              receiptTaskUnreadable = true;
            }
          }
          try {
            const { fileStore } = createWorkspaceCollaborationStores(params.cfg);
            const os = await readGroupOperatingState({ fileStore, groupId: request.groupId });
            receiptAuthFp = wakeOpAuthFingerprint(os, request.toAgentIds);
          } catch {
            receiptAuthUnreadable = true;
            receiptAuthFp = "";
          }
          const receiptControlUnreadable =
            receiptTaskMissing || receiptTaskUnreadable || receiptAuthUnreadable;
          const mayComplete =
            !receiptControlUnreadable &&
            isDispatchEligibilityCurrent({
              eligibility: wakeOp?.dispatchEligibility,
              controlEpoch: receiptEpoch,
              authFingerprint: receiptAuthFp,
            });
          if (!mayComplete || stopAfterExternal) {
            reason = stopAfterExternal
              ? "external_sent_stop_before_receipt"
              : receiptTaskMissing
                ? "external_sent_task_missing_before_receipt"
                : receiptTaskUnreadable
                  ? "external_sent_task_control_unreadable_before_receipt"
                  : receiptAuthUnreadable
                    ? "external_sent_auth_source_unreadable_before_receipt"
                    : "external_sent_eligibility_stale_before_receipt";
            const unknown = await markWakeOpUnknown({
              authority: params.authority,
              opKey: claimed.opKey,
              cfg: params.cfg,
              nowMs: params.nowMs,
              detail: reason,
            });
            if (unknown) {
              wakeOp = unknown;
            }
            outcome = "recorded";
            dispatched = false;
            roundId = undefined;
          } else {
            outcome = "dispatched";
            dispatched = true;
            roundId = compact(result.roundId);
            reason = result.detail ? `dispatched:${result.detail}` : `dispatched:${request.source}`;
            const completed = await markWakeOpCompleted({
              authority: params.authority,
              opKey: claimed.opKey,
              roundId,
              cfg: params.cfg,
              nowMs: params.nowMs,
              detail: reason,
            });
            if (completed) {
              wakeOp = completed;
            }
          }
        } else {
          reason = result.ok ? "dispatch_missing_round_id" : `dispatch_failed:${result.reason}`;
          const failed = await markWakeOpFailed({
            authority: params.authority,
            opKey: claimed.opKey,
            cfg: params.cfg,
            nowMs: params.nowMs,
            detail: reason,
          });
          if (failed) {
            wakeOp = failed;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reason = `dispatch_threw:${message.slice(0, 160)}`;
        // Cannot prove whether the dispatcher side effect landed — unknown, no blind re-run.
        const unknown = await markWakeOpUnknown({
          authority: params.authority,
          opKey: claimed.opKey,
          cfg: params.cfg,
          nowMs: params.nowMs,
          detail: reason,
        });
        if (unknown) {
          wakeOp = unknown;
        }
      }
    } else if (gate.allowed && !dispatcherPresent) {
      reason = "no_consumer";
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: reason,
      });
      if (failed) {
        wakeOp = failed;
      }
    } else {
      // Gate refused after claim — release to failed so work is not stuck running.
      const failed = await markWakeOpFailed({
        authority: params.authority,
        opKey: claimed.opKey,
        cfg: params.cfg,
        nowMs: params.nowMs,
        detail: reason,
      });
      if (failed) {
        wakeOp = failed;
      }
    }

    let wakeEvent: WakeEvent | undefined;
    if (gate.wakeEnabled && request.fromAgentId && request.toAgentIds.length > 0) {
      try {
        const wake = await recordWakeEvent(
          params.authority,
          {
            groupId: request.groupId,
            fromAgentId: request.fromAgentId,
            toAgentIds: request.toAgentIds,
            source: request.source,
            outcome,
            taskId: request.taskId,
            itemId: request.itemId,
            reason: request.reason ? `${request.reason}|${reason}` : reason,
            relatedId: request.relatedId ?? roundId,
          },
          { cfg: params.cfg, nowMs: params.nowMs },
        );
        if (wake.ok) {
          wakeEvent = wake.value;
        }
      } catch {
        // wake write best-effort — if dispatch already succeeded but receipt path
        // fails later, op ledger already holds completed; if only wake write fails
        // after completed mark, reuse still works. If completed mark failed and
        // wake write failed after dispatch, resume marks unknown via stuck running
        // → inspect suppresses blind re-run.
      }
    }

    return {
      outcome,
      dispatched,
      gate,
      reason,
      wakeEvent,
      roundId,
      dispatcherPresent,
      opKey: claimed.opKey,
      wakeOp,
      reused: false,
    };
  } finally {
    // Single-claim: release this op's taken lease so a later op can commit.
    // T43: clear is claimId-bound (stale finally must not clear a newer same-op claim).
    // Clear failures must be diagnosable but must NOT mask completed/unknown results
    // or cause the caller to believe external action did not happen.
    if (taskDispatchClaimTaken && stoppedTaskId && taskDispatchClaimId) {
      taskDispatchClaimTaken = false;
      try {
        let clearError: unknown;
        if (params._testForceClaimClearError) {
          const forced = params._testForceClaimClearError;
          clearError = typeof forced === "function" ? forced() : forced;
        } else {
          try {
            await casClearTaskDispatchClaimForOp({
              groupId: request.groupId,
              taskId: stoppedTaskId,
              opKey: claimed.opKey,
              claimId: taskDispatchClaimId,
              cfg: params.cfg,
              nowMs: params.nowMs,
            });
          } catch (err) {
            clearError = err;
          }
        }
        if (clearError !== undefined) {
          // Preserve original outcome. Never downgrade completed/failed/unknown.
          try {
            const current = await readWakeOpRecord({
              authority: params.authority,
              opKey: claimed.opKey,
              cfg: params.cfg,
            });
            const status = current?.status;
            if (status === "completed" || status === "failed" || status === "unknown") {
              void clearError;
            } else {
              await markWakeOpUnknown({
                authority: params.authority,
                opKey: claimed.opKey,
                cfg: params.cfg,
                nowMs: params.nowMs,
                detail: `claim_clear_failed_after_attempt:${
                  clearError instanceof Error ? clearError.message : "non_error_clear_failure"
                }`,
              });
            }
          } catch {
            // best-effort diagnostic only
          }
        }
      } catch {
        // best-effort: never mask the try-block result via finally control-flow
      }
    }
  }
}

/** Contract: dry_run / no consumer / flag-off never claim dispatched. */
export function wakeRoundDispatchDefaultsToRecorded(): true {
  return true;
}

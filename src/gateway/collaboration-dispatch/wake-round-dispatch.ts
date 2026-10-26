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
   * Test-only barrier after eligibility commit, before external dispatch (M3 order 2).
   */
  _testAfterEligibilityBarrier?: () => Promise<void>;
  /**
   * Test-only barrier after external dispatcher returns ok, before receipt write (M3 order 3).
   */
  _testAfterExternalBeforeReceiptBarrier?: () => Promise<void>;
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
    } catch {
      // store read failure: fall through; do not invent stop
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
    });
    if (!auth.ok) {
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "auth_revoked",
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
  {
    let stoppedAfterClaim = false;
    if (stoppedTaskId) {
      try {
        const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
        const current = await objectStorage.readObject<Task>(
          request.groupId,
          "task",
          stoppedTaskId,
        );
        if (current && isTaskStopAccepted(asGovernedTask(current))) {
          stoppedAfterClaim = true;
        } else if (current) {
          const governed = asGovernedTask(current);
          eligibilityControlEpoch =
            typeof governed.controlEpoch === "number" && Number.isFinite(governed.controlEpoch)
              ? Number(governed.controlEpoch)
              : 0;
        }
      } catch {
        // store read failure: fall through; do not invent stop
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
        detail: "auth_revoked_after_claim",
      });
      return {
        outcome: "recorded",
        dispatched: false,
        gate: emptyGate(),
        reason: "auth_revoked",
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
      eligibilityAuthFingerprint = "os_unreadable";
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

  // Post-eligibility: if stop/auth advanced, do not dispatch. Record in-flight/unknown
  // (external request not yet sent — no silent success). Expired holders cannot complete.
  {
    let stopAfterEligibility = false;
    let currentEpoch = eligibilityControlEpoch;
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
          currentEpoch =
            typeof governed.controlEpoch === "number" && Number.isFinite(governed.controlEpoch)
              ? Number(governed.controlEpoch)
              : 0;
          if (isTaskStopAccepted(governed)) {
            stopAfterEligibility = true;
          }
        }
      } catch {
        // ignore
      }
    }
    let authFp = eligibilityAuthFingerprint;
    try {
      const { fileStore } = createWorkspaceCollaborationStores(params.cfg);
      const os = await readGroupOperatingState({ fileStore, groupId: request.groupId });
      authFp = wakeOpAuthFingerprint(os, request.toAgentIds);
    } catch {
      // keep prior
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
          ? "auth_revoked_after_eligibility"
          : "eligibility_stale_before_external";
      // External request not sent: mark unknown (in-flight uncertainty) when stop
      // interrupted an eligible holder; auth revoke → failed (clear refuse).
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
        reason: !auth.ok ? "auth_revoked" : "eligibility_stale",
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
                typeof governed.controlEpoch === "number" && Number.isFinite(governed.controlEpoch)
                  ? Number(governed.controlEpoch)
                  : 0;
              if (isTaskStopAccepted(governed)) {
                stopAfterExternal = true;
              }
            }
          } catch {
            // ignore
          }
        }
        try {
          const { fileStore } = createWorkspaceCollaborationStores(params.cfg);
          const os = await readGroupOperatingState({ fileStore, groupId: request.groupId });
          receiptAuthFp = wakeOpAuthFingerprint(os, request.toAgentIds);
        } catch {
          // keep
        }
        const mayComplete = isDispatchEligibilityCurrent({
          eligibility: wakeOp?.dispatchEligibility,
          controlEpoch: receiptEpoch,
          authFingerprint: receiptAuthFp,
        });
        if (!mayComplete || stopAfterExternal) {
          reason = stopAfterExternal
            ? "external_sent_stop_before_receipt"
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
}

/** Contract: dry_run / no consumer / flag-off never claim dispatched. */
export function wakeRoundDispatchDefaultsToRecorded(): true {
  return true;
}

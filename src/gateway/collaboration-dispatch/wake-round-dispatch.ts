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
import { createWorkspaceCollaborationStores } from "../collaboration-learning/shared.js";
import { matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { asGovernedTask } from "./task-runtime.js";
import { isTaskStopAccepted } from "./task-stop-control.js";
import {
  isCollabTaskWakeContractEnabled,
  recordWakeEvent,
  type WakeEvent,
  type WakeOutcome,
  type WakeSource,
} from "./wake-contract.js";

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
};

export type ConsumeWakeRoundDispatchResult = Readonly<{
  outcome: Extract<WakeOutcome, "dispatched" | "recorded">;
  dispatched: boolean;
  gate: WakeRoundDispatchGate;
  reason: string;
  wakeEvent?: WakeEvent;
  roundId?: string;
  dispatcherPresent: boolean;
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

  const stoppedTaskId = compact(request.taskId);
  if (stoppedTaskId) {
    try {
      const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
      const current = await objectStorage.readObject<Task>(request.groupId, "task", stoppedTaskId);
      if (current && isTaskStopAccepted(asGovernedTask(current))) {
        return {
          outcome: "recorded",
          dispatched: false,
          gate: evaluateWakeRoundDispatchGate({
            source: request.source,
            groupId: request.groupId,
            tenantId: request.tenantId,
            cfg: params.cfg,
            writeMode: params.writeMode,
          }),
          reason: "task_stopped",
          wakeEvent: undefined,
          roundId: undefined,
          dispatcherPresent: false,
        };
      }
    } catch {
      // store read failure: fall through; do not invent stop
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
        outcome = "dispatched";
        dispatched = true;
        roundId = compact(result.roundId);
        reason = result.detail ? `dispatched:${result.detail}` : `dispatched:${request.source}`;
      } else {
        reason = result.ok ? "dispatch_missing_round_id" : `dispatch_failed:${result.reason}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reason = `dispatch_threw:${message.slice(0, 160)}`;
    }
  } else if (gate.allowed && !dispatcherPresent) {
    reason = "no_consumer";
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
      // wake write best-effort
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
  };
}

/** Contract: dry_run / no consumer / flag-off never claim dispatched. */
export function wakeRoundDispatchDefaultsToRecorded(): true {
  return true;
}

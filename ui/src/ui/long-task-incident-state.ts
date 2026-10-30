/**
 * L2 MVP — in-session long-task incident system state.
 *
 * Pure classifier: reason + auto-recovering? + next step.
 * Reuses existing gateway connection phase and optional detectors
 * (computer occupied / sandbox stuck) when callers already have them.
 * Does not invent a parallel task SoT — board progress is separate.
 */

import type { GatewayConnectionPhase } from "./gateway-connection-phase.ts";

export type LongTaskIncidentKind =
  | "binding_fail"
  | "gateway_reconnect"
  | "gateway_offline"
  | "computer_occupied"
  | "sandbox_stuck";

export type LongTaskIncidentState = {
  kind: LongTaskIncidentKind;
  reason: string;
  autoRecovering: boolean;
  nextStep: string;
};

export type LongTaskIncidentSignals = {
  /** Latest formal team deliverable outcome for this session/group, if known. */
  deliverableRejectCode?: string | null;
  gatewayConnected?: boolean;
  gatewayConnectionPhase?: GatewayConnectionPhase | null | undefined;
  /** Shared computer bound but another seat/agent holds interactive focus. */
  computerOccupied?: boolean;
  computerOccupiedDetail?: string | null;
  /** Sandbox / exec environment stuck (detector already fired upstream). */
  sandboxStuck?: boolean;
  sandboxStuckDetail?: string | null;
};

const BINDING_FAIL_CODES = new Set([
  "execution_binding_required",
  "execution_binding_scope",
  "execution_attempt_not_current",
  "execution_attempt_unreadable",
]);

function isBindingFailCode(code: string | null | undefined): boolean {
  const c = code?.trim() ?? "";
  if (!c) {
    return false;
  }
  if (BINDING_FAIL_CODES.has(c)) {
    return true;
  }
  return c.startsWith("execution_binding_");
}

/**
 * Priority: sandbox stuck → computer occupied → binding fail → gateway offline/reconnect.
 * Returns null when nothing incident-worthy is active.
 */
export function resolveLongTaskIncidentState(
  signals: LongTaskIncidentSignals,
): LongTaskIncidentState | null {
  if (signals.sandboxStuck === true) {
    return {
      kind: "sandbox_stuck",
      reason: (signals.sandboxStuckDetail ?? "").trim() || "Sandbox or exec environment is stuck.",
      autoRecovering: false,
      nextStep: "Retry the step from the last stable persist, or free the sandbox and continue.",
    };
  }

  if (signals.computerOccupied === true) {
    return {
      kind: "computer_occupied",
      reason:
        (signals.computerOccupiedDetail ?? "").trim() ||
        "Shared computer is occupied by another seat or agent.",
      autoRecovering: false,
      nextStep: "Wait for the computer, switch to a file-only path, or reclaim the seat.",
    };
  }

  if (isBindingFailCode(signals.deliverableRejectCode)) {
    return {
      kind: "binding_fail",
      reason: `Team deliverable rejected (${signals.deliverableRejectCode!.trim()}).`,
      autoRecovering: true,
      nextStep: "Auto-continuing the next incomplete board milestone; nudge only if it stalls.",
    };
  }

  const connected = signals.gatewayConnected === true;
  const phase = signals.gatewayConnectionPhase ?? null;
  if (!connected) {
    if (phase === "reconnecting" || phase === "connecting") {
      return {
        kind: "gateway_reconnect",
        reason: "Gateway connection interrupted; client is reconnecting.",
        autoRecovering: true,
        nextStep: "Wait for reconnect; board progress is kept on disk and will auto-resume.",
      };
    }
    if (phase === "unreachable" || phase === "blocked" || phase === "idle" || phase == null) {
      return {
        kind: "gateway_offline",
        reason:
          phase === "unreachable"
            ? "Gateway unreachable after reconnect budget."
            : "Gateway is offline or not connected.",
        autoRecovering: phase === "unreachable",
        nextStep:
          phase === "unreachable"
            ? "Retry connection; unfinished board milestones remain durable."
            : "Reconnect to the gateway to continue the long task.",
      };
    }
  }

  return null;
}

/** Compact label for chat/status strip (en). */
export function formatLongTaskIncidentLabel(state: LongTaskIncidentState): string {
  const recovering = state.autoRecovering ? "auto-recovering" : "needs attention";
  return `${state.kind} (${recovering}): ${state.reason} → ${state.nextStep}`;
}

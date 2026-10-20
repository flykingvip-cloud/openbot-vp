/**
 * Orchestration Plane — pure surface router (P4.5).
 *
 * `routeStep` has no IO: it does not list nodes, load skills, call tools, or
 * write a ledger. P4.5d/e/f bind `web_read`, `browser`, `node_fs_read`, and
 * `node_exec` by symbol name in `surface-binding.ts` (no execute). Later
 * invoke PRs may call those factories; this file must stay a pure function.
 * Node select still requires exactly one bound node + input `nodeEnabled`.
 */

import { isOrchestrationDormant } from "./feature.js";
import { ORCH_REASON, type OrchReasonCode } from "./reason-codes.js";
import {
  isCapabilitySurface,
  ladderIndex,
  type ExecutionSurface,
  type NodeInventory,
  type RouteStepInput,
  type SurfaceDecision,
} from "./types.js";

function decision(
  kind: SurfaceDecision["kind"],
  reasonCodes: readonly OrchReasonCode[],
  surface?: ExecutionSurface,
): SurfaceDecision {
  return { kind, surface, reasonCodes, enqueue: false, invoke: false };
}

function selected(
  surface: ExecutionSurface,
  reasonCodes: readonly OrchReasonCode[],
): SurfaceDecision {
  return decision("selected", reasonCodes, surface);
}

function humanGate(
  reasonCodes: readonly OrchReasonCode[],
  surface?: ExecutionSurface,
): SurfaceDecision {
  return decision("human_gate", reasonCodes, surface);
}

function skip(reasonCodes: readonly OrchReasonCode[]): SurfaceDecision {
  return decision("skip", reasonCodes);
}

function blocked(reasonCodes: readonly OrchReasonCode[]): SurfaceDecision {
  return decision("blocked_policy", reasonCodes);
}

function noop(reasonCodes: readonly OrchReasonCode[]): SurfaceDecision {
  return decision("noop", reasonCodes);
}

function connectorAvailable(input: RouteStepInput): boolean {
  const connected = input.connectedConnectorIds ?? [];
  if (connected.length === 0) {
    return false;
  }
  if (input.requestedConnectorId) {
    return connected.includes(input.requestedConnectorId);
  }
  return true;
}

function routeNodeSurface(
  surface: "node_fs_read" | "node_exec",
  ladderReason: OrchReasonCode,
  input: RouteStepInput,
): SurfaceDecision {
  if (!input.flags.nodeEnabled) {
    return skip([ORCH_REASON.NODE_ENABLED_OFF]);
  }
  const inventory: NodeInventory = input.nodeInventory ?? { boundNodeIds: [], unboundCount: 0 };
  const bound = inventory.boundNodeIds;
  if (bound.length === 1) {
    return selected(surface, [ladderReason]);
  }
  if (bound.length === 0 && inventory.unboundCount === 0) {
    return humanGate([ORCH_REASON.ZERO_NODES, ORCH_REASON.HUMAN_GATE]);
  }
  if (bound.length === 0 && inventory.unboundCount > 1) {
    return humanGate([ORCH_REASON.MULTIPLE_UNBOUND_NODES, ORCH_REASON.HUMAN_GATE]);
  }
  if (bound.length === 0) {
    return humanGate([ORCH_REASON.NODE_UNBOUND, ORCH_REASON.HUMAN_GATE]);
  }
  return humanGate([ORCH_REASON.HUMAN_GATE]);
}

function applySkipAheadGuard(
  lowest: SurfaceDecision,
  requested?: ExecutionSurface,
): SurfaceDecision {
  if (!requested || lowest.kind !== "selected" || !lowest.surface) {
    return lowest;
  }
  if (requested === lowest.surface) {
    return lowest;
  }
  if (!isCapabilitySurface(requested) || !isCapabilitySurface(lowest.surface)) {
    return lowest;
  }
  if (ladderIndex(requested) > ladderIndex(lowest.surface)) {
    return blocked([ORCH_REASON.SKIP_AHEAD_BLOCKED]);
  }
  return lowest;
}

function selectLowestSurface(input: RouteStepInput): SurfaceDecision {
  const { intent } = input;

  if (input.pathKind === "workspace") {
    if (intent === "read_user_machine" || intent === "exec_user_machine") {
      return selected("memory", [ORCH_REASON.SANDBOX_IS_NOT_NODE, ORCH_REASON.LADDER_MEMORY]);
    }
    if (input.requestedSurface === "node_fs_read" || input.requestedSurface === "node_exec") {
      return blocked([ORCH_REASON.SKIP_AHEAD_BLOCKED, ORCH_REASON.SANDBOX_IS_NOT_NODE]);
    }
  }

  switch (intent) {
    case "recall_memory":
      return selected("memory", [ORCH_REASON.LADDER_MEMORY]);
    case "apply_skill":
      if (!input.skillId) {
        return humanGate([ORCH_REASON.HUMAN_GATE]);
      }
      return selected("skill", [
        ORCH_REASON.LADDER_SKILL,
        ORCH_REASON.SKILL_IS_RECIPE_NOT_EVIDENCE,
      ]);
    case "use_connector":
      if (connectorAvailable(input)) {
        return selected("connector", [ORCH_REASON.LADDER_CONNECTOR]);
      }
      return humanGate([ORCH_REASON.HUMAN_GATE]);
    case "read_web":
      if (input.requestedSurface === "browser") {
        return blocked([
          ORCH_REASON.SKIP_AHEAD_BLOCKED,
          ORCH_REASON.WEB_READ_PREFERRED_OVER_BROWSER,
        ]);
      }
      return selected("web_read", [
        ORCH_REASON.LADDER_WEB_READ,
        ORCH_REASON.WEB_READ_PREFERRED_OVER_BROWSER,
      ]);
    case "interact_web":
      if (connectorAvailable(input)) {
        if (input.requestedSurface === "browser") {
          return blocked([
            ORCH_REASON.SKIP_AHEAD_BLOCKED,
            ORCH_REASON.CONNECTOR_PREFERRED_OVER_BROWSER,
          ]);
        }
        return selected("connector", [
          ORCH_REASON.LADDER_CONNECTOR,
          ORCH_REASON.CONNECTOR_PREFERRED_OVER_BROWSER,
        ]);
      }
      if (!input.flags.browserEnabled) {
        return humanGate([ORCH_REASON.BROWSER_ENABLED_OFF, ORCH_REASON.HUMAN_GATE]);
      }
      return selected("browser", [ORCH_REASON.LADDER_BROWSER]);
    case "read_user_machine":
      return routeNodeSurface("node_fs_read", ORCH_REASON.LADDER_NODE_FS, input);
    case "exec_user_machine":
      return routeNodeSurface("node_exec", ORCH_REASON.LADDER_NODE_EXEC, input);
    case "send_message":
      return humanGate([ORCH_REASON.HUMAN_GATE], "outbound_message");
    case "write_external":
      return humanGate([ORCH_REASON.HUMAN_GATE], "external_write");
    case "broadcast":
      return humanGate([ORCH_REASON.HUMAN_GATE], "broadcast");
  }
}

/**
 * Pure ladder router. No IO. When shadow+dispatch are both OFF this is a no-op
 * so a dormant kernel cannot even compute a live surface.
 */
export function routeStep(input: RouteStepInput): SurfaceDecision {
  if (isOrchestrationDormant(input.flags)) {
    return noop([ORCH_REASON.DORMANT, ORCH_REASON.NO_INVOKE_WHEN_DORMANT]);
  }
  const lowest = selectLowestSurface(input);
  return applySkipAheadGuard(lowest, input.requestedSurface);
}

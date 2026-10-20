/**
 * streaming.ts — map execution signals to Fabric ExecutionEvent (R12).
 *
 * Reuses the existing tool-events transport: the gateway handler (task 9)
 * registers the executionId as a recipient and pushes the `ExecutionEvent`s
 * produced here. This module is the pure mapping layer:
 *  - AOR `BackendEvent` → ExecutionEvent (stdout/stderr/status),
 *  - run-state transitions → status events,
 *  - the compile-time decision → a `policy` event.
 *
 * It does NOT define a new streaming protocol (R12.2). External messaging
 * surfaces only receive the final result, never partial events (R12.3) — that
 * gating lives in the delivery layer, not here.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.9.
 */

import type { BackendEvent } from "@openbot/aor-core";
import type { ExecutionEvent, PolicyDecision } from "./contract.js";
import type { RunTransitionEvent } from "./graph/run-state.js";

/** Map a single AOR BackendEvent to a Fabric ExecutionEvent (or null to drop). */
export function fromBackendEvent(event: BackendEvent): ExecutionEvent | null {
  switch (event.kind) {
    case "assistant":
      return { type: "stdout", data: event.delta };
    case "lifecycle":
      if (event.phase === "start") {
        return { type: "status", state: "running" };
      }
      if (event.phase === "end") {
        return { type: "status", state: "done" };
      }
      // error lifecycle → stderr line.
      return { type: "stderr", data: event.detail ?? "error" };
    case "tool":
      // Tool sub-events are surfaced as stdout breadcrumbs.
      return { type: "stdout", data: event.detail ?? event.name };
    default:
      return null;
  }
}

/** Map a run-state transition to a status event (running/done) or null. */
export function fromRunTransition(event: RunTransitionEvent): ExecutionEvent | null {
  switch (event.to) {
    case "executing":
    case "streaming":
      return { type: "status", state: "running" };
    case "finalized":
      return { type: "status", state: "done" };
    case "failed":
      return { type: "stderr", data: `run ${event.runId} failed` };
    default:
      return null;
  }
}

/** Emit the compile-time decision as a `policy` event (explainability on stream). */
export function policyEvent(decision: PolicyDecision): ExecutionEvent {
  return { type: "policy", decision };
}

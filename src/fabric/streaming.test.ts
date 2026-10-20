import type { BackendEvent } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import type { PolicyDecision } from "./contract.js";
import type { RunTransitionEvent } from "./graph/run-state.js";
import { fromBackendEvent, fromRunTransition, policyEvent } from "./streaming.js";

describe("streaming — fromBackendEvent", () => {
  it("assistant delta → stdout", () => {
    const e: BackendEvent = { kind: "assistant", delta: "hello" };
    expect(fromBackendEvent(e)).toEqual({ type: "stdout", data: "hello" });
  });

  it("lifecycle start/end → status running/done", () => {
    expect(fromBackendEvent({ kind: "lifecycle", phase: "start" })).toEqual({
      type: "status",
      state: "running",
    });
    expect(fromBackendEvent({ kind: "lifecycle", phase: "end" })).toEqual({
      type: "status",
      state: "done",
    });
  });

  it("lifecycle error → stderr", () => {
    expect(fromBackendEvent({ kind: "lifecycle", phase: "error", detail: "boom" })).toEqual({
      type: "stderr",
      data: "boom",
    });
  });

  it("tool event → stdout breadcrumb", () => {
    expect(fromBackendEvent({ kind: "tool", name: "grep", detail: "running grep" })).toEqual({
      type: "stdout",
      data: "running grep",
    });
  });
});

describe("streaming — fromRunTransition", () => {
  function ev(to: RunTransitionEvent["to"]): RunTransitionEvent {
    return { runId: "r1", nodeId: "n1", from: "validated", to };
  }
  it("executing/streaming → running; finalized → done; failed → stderr", () => {
    expect(fromRunTransition(ev("executing"))?.type).toBe("status");
    expect(fromRunTransition(ev("finalized"))).toEqual({ type: "status", state: "done" });
    expect(fromRunTransition(ev("failed"))?.type).toBe("stderr");
    expect(fromRunTransition(ev("scheduled"))).toBeNull();
  });
});

describe("streaming — policyEvent", () => {
  it("wraps a decision as a policy event", () => {
    const d: PolicyDecision = {
      decision: "DENY",
      reason: "x",
      matchedRules: [],
      decisionTrace: [],
    };
    expect(policyEvent(d)).toEqual({ type: "policy", decision: d });
  });
});

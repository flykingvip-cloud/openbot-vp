import { describe, expect, it } from "vitest";
import { ExecProtocolError } from "./errors.js";
import { canTransition, reconcileTransition, transitionState } from "./state-machine.js";

describe("exec protocol state machine", () => {
  it("allows the happy path accepted -> queued -> running -> succeeded", () => {
    let state = transitionState("accepted", "queued");
    state = transitionState(state, "running");
    state = transitionState(state, "succeeded");
    expect(state).toBe("succeeded");
  });

  it("allows cancel via cancel_requested from accepted, queued, and running", () => {
    expect(transitionState("accepted", "cancel_requested")).toBe("cancel_requested");
    expect(transitionState("queued", "cancel_requested")).toBe("cancel_requested");
    expect(transitionState("running", "cancel_requested")).toBe("cancel_requested");
    expect(transitionState("cancel_requested", "cancelled")).toBe("cancelled");
  });

  it("allows failed from queued or running, and result_unconfirmed from in-flight states", () => {
    expect(transitionState("queued", "failed")).toBe("failed");
    expect(transitionState("running", "failed")).toBe("failed");
    expect(transitionState("running", "result_unconfirmed")).toBe("result_unconfirmed");
    expect(transitionState("cancel_requested", "result_unconfirmed")).toBe("result_unconfirmed");
  });

  it("forbids succeeding from any state other than running, and forbids rewriting terminal states", () => {
    expect(canTransition("accepted", "succeeded")).toBe(false);
    expect(canTransition("queued", "succeeded")).toBe(false);
    expect(() => transitionState("accepted", "succeeded")).toThrow(ExecProtocolError);
    expect(() => transitionState("succeeded", "result_unconfirmed")).toThrow(/terminal state/);
    expect(() => transitionState("failed", "running")).toThrow(/terminal state/);
    expect(() => transitionState("cancelled", "queued")).toThrow(/terminal state/);
    expect(() => transitionState("cancelled", "running")).toThrow(ExecProtocolError);
    expect(canTransition("result_unconfirmed", "succeeded")).toBe(false);
    expect(() => transitionState("result_unconfirmed", "succeeded")).toThrow(ExecProtocolError);
  });

  it("allows reconcile transitions only from result_unconfirmed", () => {
    expect(reconcileTransition("result_unconfirmed", "succeeded")).toBe("succeeded");
    expect(reconcileTransition("result_unconfirmed", "failed")).toBe("failed");
    expect(reconcileTransition("result_unconfirmed", "cancelled")).toBe("cancelled");
    expect(reconcileTransition("result_unconfirmed", "remain_unconfirmed")).toBe(
      "result_unconfirmed",
    );
    expect(() => reconcileTransition("running", "succeeded")).toThrow(ExecProtocolError);
    expect(() => reconcileTransition("cancelled", "failed")).toThrow(/reconcile cannot leave/);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  runExecutionStallContinueLoop,
  type RunExecutionStallContinueLoopParams,
} from "./stall-continuation.js";

function params(): RunExecutionStallContinueLoopParams {
  return {
    continueBudget: 2,
    isAbortedOrTimedOut: () => false,
    getProtocolBlock: () => ({}),
    resolveContinue: () => ({ kind: "progress-stall", emptyContinue: false, stopText: "progress" }),
    sendContinue: vi.fn(async () => {}),
    onContinued: vi.fn(),
  };
}
describe("bounded recovery contract", () => {
  it("honors budget and reports successful continuations", async () => {
    const p = params();
    expect(await runExecutionStallContinueLoop(p)).toEqual({ continuesSent: 2 });
    expect(p.sendContinue).toHaveBeenCalledTimes(2);
    expect(p.onContinued).toHaveBeenCalledTimes(2);
  });
  it("does not request decisions after cancellation or zero budget", async () => {
    for (const budget of [0, 2]) {
      const p = params();
      p.continueBudget = budget;
      p.isAbortedOrTimedOut = () => true;
      p.resolveContinue = vi.fn(p.resolveContinue);
      expect(await runExecutionStallContinueLoop(p)).toEqual({ continuesSent: 0 });
      expect(p.resolveContinue).not.toHaveBeenCalled();
    }
  });
  it("preserves failed-send stopping without reporting a successful continuation", async () => {
    const p = params();
    p.sendContinue = vi.fn(async () => {
      throw new Error("cancelled");
    });
    expect(await runExecutionStallContinueLoop(p)).toEqual({ continuesSent: 0 });
    expect(p.onContinued).not.toHaveBeenCalled();
  });
  it("uses empty-after-tools only when no continue kind applies", async () => {
    const p = params();
    p.continueBudget = 1;
    p.resolveContinue = () => ({ kind: null, emptyContinue: true, stopText: "" });
    await runExecutionStallContinueLoop(p);
    expect(p.sendContinue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "empty-after-tools" }),
    );
  });
});

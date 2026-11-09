import { describe, expect, it } from "vitest";
import { runExecutionStallContinueLoop } from "../agent-runtime/execution/index.js";
import { PROTOCOL_VIOLATION_STOP_REASON } from "./protocol-violation.js";

describe("runExecutionStallContinueLoop protocol isolation", () => {
  it("checks termination at loop start and after each triggerTurn", async () => {
    let calls = 0;
    let terminated = false;
    const messages: unknown[] = [{ role: "assistant", stopReason: "stop" }];
    const { continuesSent } = await runExecutionStallContinueLoop({
      continueBudget: 4,
      isAbortedOrTimedOut: () => false,
      getProtocolBlock: () => ({ boundaryTerminated: terminated, messages }),
      resolveContinue: () => ({
        kind: "progress-stall",
        emptyContinue: false,
        stopText: "…",
      }),
      sendContinue: async () => {
        calls += 1;
        if (calls === 2) {
          terminated = true;
          messages.push({ role: "assistant", stopReason: PROTOCOL_VIOLATION_STOP_REASON });
        }
      },
    });
    expect(continuesSent).toBe(2);
    expect(calls).toBe(2);
  });

  it("does not send when already terminated before loop", async () => {
    let calls = 0;
    await runExecutionStallContinueLoop({
      continueBudget: 3,
      isAbortedOrTimedOut: () => false,
      getProtocolBlock: () => ({ boundaryTerminated: true, messages: [] }),
      resolveContinue: () => ({
        kind: "progress-stall",
        emptyContinue: false,
        stopText: "x",
      }),
      sendContinue: async () => {
        calls += 1;
      },
    });
    expect(calls).toBe(0);
  });
});

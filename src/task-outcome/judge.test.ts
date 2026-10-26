import { describe, expect, it } from "vitest";
import { deriveLifecycle, projectTaskJudgement } from "./judge.js";

describe("TaskOutcome unique judgement (frozen)", () => {
  it("A: acceptance pending + delivery blocked => awaiting_acceptance / incomplete", () => {
    const lifecycle = deriveLifecycle({
      acceptance: { status: "pending" },
      delivery: { status: "blocked" },
      hasDecisiveRun: true,
    });
    expect(lifecycle).toBe("awaiting_acceptance");
    expect(
      projectTaskJudgement({
        lifecycle,
        acceptance: { status: "pending" },
        delivery: { status: "blocked" },
      }),
    ).toBe("incomplete");
  });

  it("B: acceptance failed + stop recovery => closed / failure", () => {
    const lifecycle = deriveLifecycle({
      acceptance: { status: "failed" },
      delivery: { status: "pending" },
      stopRecovery: true,
      hasDecisiveRun: true,
    });
    expect(lifecycle).toBe("closed");
    expect(
      projectTaskJudgement({
        lifecycle,
        acceptance: { status: "failed" },
        delivery: { status: "pending" },
        stopRecovery: true,
      }),
    ).toBe("failure");
  });

  it("recovering when acceptance failed but retry allowed", () => {
    expect(
      deriveLifecycle({
        acceptance: { status: "failed" },
        delivery: { status: "pending" },
        stopRecovery: false,
      }),
    ).toBe("recovering");
  });

  it("success only when acceptance ok and delivery ok", () => {
    const lifecycle = deriveLifecycle({
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
    });
    expect(lifecycle).toBe("closed");
    expect(
      projectTaskJudgement({
        lifecycle,
        acceptance: { status: "passed" },
        delivery: { status: "delivered" },
      }),
    ).toBe("success");
  });

  it("cancel is cancelled not failure", () => {
    expect(
      projectTaskJudgement({
        lifecycle: "closed",
        acceptance: { status: "pending" },
        delivery: { status: "pending" },
        cancelRequested: true,
      }),
    ).toBe("cancelled");
  });

  it("delivery_unknown never projects success", () => {
    expect(
      projectTaskJudgement({
        lifecycle: "closed",
        acceptance: { status: "passed" },
        delivery: { status: "delivery_unknown" },
      }),
    ).toBe("failure");
  });
});

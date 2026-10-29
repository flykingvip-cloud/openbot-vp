import { describe, expect, it } from "vitest";
import {
  decideWriteSideRetry,
  shouldSuppressRecoverableContinueForUnknownWrite,
  WRITE_SIDE_OUTCOME_UNKNOWN,
  WRITE_SIDE_RETRY_FORBIDDEN_REASON,
} from "./write-side-retry-gate.js";

describe("decideWriteSideRetry", () => {
  it("keeps unknown_outcome and forbids auto-retry after a write/side-effect", () => {
    const decision = decideWriteSideRetry({
      sideEffectLevel: "reversible",
      outcomeStatus: WRITE_SIDE_OUTCOME_UNKNOWN,
    });
    expect(decision.status).toBe(WRITE_SIDE_OUTCOME_UNKNOWN);
    expect(decision.allowAutomaticRetry).toBe(false);
    expect(decision.reason).toBe(WRITE_SIDE_RETRY_FORBIDDEN_REASON);
  });

  it("forbids auto-retry for irreversible_external unknown without trusted evidence", () => {
    const decision = decideWriteSideRetry({
      sideEffectLevel: "irreversible_external",
      outcomeStatus: WRITE_SIDE_OUTCOME_UNKNOWN,
      trustedResultEvidence: false,
    });
    expect(decision.allowAutomaticRetry).toBe(false);
    expect(decision.status).toBe(WRITE_SIDE_OUTCOME_UNKNOWN);
  });

  it("still forbids blind rematerialize even when trusted evidence is present", () => {
    // Trusted evidence can drive human/reconciliation paths; this gate never
    // auto-retries a write-side unknown on its own.
    const decision = decideWriteSideRetry({
      sideEffectLevel: "reversible",
      outcomeStatus: WRITE_SIDE_OUTCOME_UNKNOWN,
      trustedResultEvidence: true,
    });
    expect(decision.allowAutomaticRetry).toBe(false);
    expect(decision.status).toBe(WRITE_SIDE_OUTCOME_UNKNOWN);
  });

  it("does not invent success for read-only unknown (allows other policies to retry)", () => {
    const decision = decideWriteSideRetry({
      sideEffectLevel: "none",
      outcomeStatus: WRITE_SIDE_OUTCOME_UNKNOWN,
    });
    expect(decision.status).toBe(WRITE_SIDE_OUTCOME_UNKNOWN);
    expect(decision.allowAutomaticRetry).toBe(true);
  });

  it("forbids blind rematerialize on known failed write", () => {
    const decision = decideWriteSideRetry({
      sideEffectLevel: "irreversible_external",
      outcomeStatus: "failed",
    });
    expect(decision.allowAutomaticRetry).toBe(false);
    expect(decision.status).toBe("failed");
  });
});

describe("shouldSuppressRecoverableContinueForUnknownWrite", () => {
  it("suppresses recoverable continue when a write tool left unknown_outcome", () => {
    expect(
      shouldSuppressRecoverableContinueForUnknownWrite({
        tools: [
          {
            toolName: "message",
            success: false,
            sideEffectLevel: "irreversible_external",
            outcomeStatus: WRITE_SIDE_OUTCOME_UNKNOWN,
            meta: "timeout after write; result unknown",
          },
        ],
      }),
    ).toBe(true);
  });

  it("infers unknown from meta and suppresses", () => {
    expect(
      shouldSuppressRecoverableContinueForUnknownWrite({
        tools: [
          {
            toolName: "exec",
            success: false,
            sideEffectLevel: "irreversible_external",
            meta: "outcome unclear after side effect",
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not suppress read-only path_missing (recoverable path stays open)", () => {
    expect(
      shouldSuppressRecoverableContinueForUnknownWrite({
        tools: [
          {
            toolName: "read",
            success: false,
            sideEffectLevel: "none",
            meta: "ENOENT",
          },
        ],
      }),
    ).toBe(false);
  });
});

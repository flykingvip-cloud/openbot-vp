import { describe, expect, it } from "vitest";
import { resolveActiveRunQueueAction, shouldAttemptCollectAmendSteer } from "./queue-policy.js";

describe("resolveActiveRunQueueAction", () => {
  it("runs immediately when there is no active run", () => {
    expect(
      resolveActiveRunQueueAction({
        isActive: false,
        isHeartbeat: false,
        shouldFollowup: true,
        queueMode: "collect",
      }),
    ).toBe("run-now");
  });

  it("drops heartbeat runs while another run is active", () => {
    expect(
      resolveActiveRunQueueAction({
        isActive: true,
        isHeartbeat: true,
        shouldFollowup: true,
        queueMode: "collect",
      }),
    ).toBe("drop");
  });

  it("enqueues followups for non-heartbeat active runs", () => {
    expect(
      resolveActiveRunQueueAction({
        isActive: true,
        isHeartbeat: false,
        shouldFollowup: true,
        queueMode: "collect",
      }),
    ).toBe("enqueue-followup");
  });

  it("enqueues steer mode runs while active", () => {
    expect(
      resolveActiveRunQueueAction({
        isActive: true,
        isHeartbeat: false,
        shouldFollowup: false,
        queueMode: "steer",
      }),
    ).toBe("enqueue-followup");
  });
});

describe("shouldAttemptCollectAmendSteer", () => {
  const base = {
    isActive: true,
    isStreaming: true,
    shouldSteer: false,
    shouldFollowup: true,
    queueMode: "collect" as const,
  };

  it("allows amend under collect while streaming", () => {
    expect(shouldAttemptCollectAmendSteer({ ...base, turnRelation: "amend" })).toBe(true);
  });

  it("rejects aside and new_work (not constraint inject)", () => {
    expect(shouldAttemptCollectAmendSteer({ ...base, turnRelation: "aside" })).toBe(false);
    expect(shouldAttemptCollectAmendSteer({ ...base, turnRelation: "new_work" })).toBe(false);
  });

  it("defers to existing shouldSteer path", () => {
    expect(
      shouldAttemptCollectAmendSteer({ ...base, shouldSteer: true, turnRelation: "amend" }),
    ).toBe(false);
  });

  it("requires active streaming followup", () => {
    expect(
      shouldAttemptCollectAmendSteer({ ...base, isStreaming: false, turnRelation: "amend" }),
    ).toBe(false);
    expect(
      shouldAttemptCollectAmendSteer({ ...base, isActive: false, turnRelation: "amend" }),
    ).toBe(false);
  });

  it("refuses when persistOwnerConstraint is false (bare continue / queries)", () => {
    expect(
      shouldAttemptCollectAmendSteer({
        ...base,
        turnRelation: "amend",
        persistOwnerConstraint: false,
      }),
    ).toBe(false);
  });
});

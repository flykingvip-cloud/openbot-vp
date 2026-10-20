import { describe, expect, it } from "vitest";
import {
  deriveCandidateCapsule,
  generateCandidateCapsule,
  PATTERN_REUSE_THRESHOLD,
  shouldGenerateCapsule,
  type TaskRunLearningSignal,
} from "./learning-capsule-generation.js";
import {
  canProjectCapsuleToLearningAsset,
  evaluateCapsuleProjectionEligibility,
} from "./learning-projection.js";

function signal(overrides: Partial<TaskRunLearningSignal> = {}): TaskRunLearningSignal {
  return { groupId: "g1", taskId: "t1", outcome: "success", nowMs: 1000, ...overrides };
}

describe("shouldGenerateCapsule", () => {
  it("skips a plain success with no friction and no lesson (avoids noise)", () => {
    expect(shouldGenerateCapsule(signal())).toBe(false);
  });

  it("generates on any non-success outcome", () => {
    expect(shouldGenerateCapsule(signal({ outcome: "failure" }))).toBe(true);
    expect(shouldGenerateCapsule(signal({ outcome: "partial" }))).toBe(true);
  });

  it("generates on friction signals or an explicit lesson", () => {
    expect(shouldGenerateCapsule(signal({ reviewRejected: true }))).toBe(true);
    expect(shouldGenerateCapsule(signal({ humanTakeover: true }))).toBe(true);
    expect(shouldGenerateCapsule(signal({ humanEditCount: 1 }))).toBe(true);
    expect(shouldGenerateCapsule(signal({ lesson: "先解决问题，再解释原因" }))).toBe(true);
  });
});

describe("deriveCandidateCapsule", () => {
  it("classifies failure / rejected review as anti_pattern", () => {
    expect(deriveCandidateCapsule(signal({ outcome: "failure" })).capsuleType).toBe("anti_pattern");
    expect(deriveCandidateCapsule(signal({ reviewRejected: true })).capsuleType).toBe(
      "anti_pattern",
    );
  });

  it("classifies friction (edits/takeover/partial) as lesson", () => {
    expect(deriveCandidateCapsule(signal({ humanEditCount: 2 })).capsuleType).toBe("lesson");
    expect(deriveCandidateCapsule(signal({ humanTakeover: true })).capsuleType).toBe("lesson");
    expect(deriveCandidateCapsule(signal({ outcome: "partial" })).capsuleType).toBe("lesson");
  });

  it("classifies a clean-but-notable success as pattern", () => {
    expect(deriveCandidateCapsule(signal({ lesson: "reusable approach" })).capsuleType).toBe(
      "pattern",
    );
  });

  it("captures the customer-complaint example (modify reply twice → lesson)", () => {
    const capsule = deriveCandidateCapsule(
      signal({
        title: "客户投诉处理",
        humanEditCount: 2,
        lesson: "客户沟通原则：先解决问题，再解释原因",
      }),
    );
    expect(capsule.capsuleType).toBe("lesson");
    expect(capsule.title).toBe("[lesson] 客户投诉处理");
    expect(capsule.summary).toBe("客户沟通原则：先解决问题，再解释原因");
    expect(capsule.structuredContent).toMatchObject({ humanEditCount: 2, outcome: "success" });
    expect(capsule.metadata).toMatchObject({ generated: true, generator: "task-run-v1" });
  });

  it("uses a deterministic capsuleId and honors an explicit id", () => {
    expect(deriveCandidateCapsule(signal({ taskId: "abc" })).capsuleId).toBe("cap-g1-abc");
    expect(deriveCandidateCapsule(signal({ capsuleId: "fixed" })).capsuleId).toBe("fixed");
  });

  it("infers confidence from signal strength", () => {
    // strong signal (failure) + lesson text → high
    expect(
      deriveCandidateCapsule(signal({ outcome: "failure", lesson: "x" })).metadata?.confidence,
    ).toBe("high");
    // strong signal only → medium
    expect(deriveCandidateCapsule(signal({ outcome: "failure" })).metadata?.confidence).toBe(
      "medium",
    );
    // weak signal only → low
    expect(deriveCandidateCapsule(signal({ humanEditCount: 1 })).metadata?.confidence).toBe("low");
  });
});

describe("safety default: generated candidate is not projectable until governed", () => {
  const actor = { actorId: "reviewer-1" };

  it("is blocked as not-approved while status is candidate", () => {
    const capsule = deriveCandidateCapsule(signal({ outcome: "failure" }));
    expect(capsule.status).toBe("candidate");
    expect(capsule.reusability).toBe("group_only");
    const eligibility = evaluateCapsuleProjectionEligibility(capsule, actor);
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.reason).toBe("capsule_not_approved");
  });

  it("remains group-local even after approval (reusability must be upgraded by governance)", () => {
    const capsule = {
      ...deriveCandidateCapsule(signal({ outcome: "failure" })),
      status: "approved" as const,
    };
    expect(canProjectCapsuleToLearningAsset(capsule, actor)).toBe(false);
    expect(evaluateCapsuleProjectionEligibility(capsule, actor).reason).toBe("group_only_capsule");
  });
});

describe("generateCandidateCapsule", () => {
  it("returns null for a plain success and a capsule otherwise", () => {
    expect(generateCandidateCapsule(signal())).toBeNull();
    expect(generateCandidateCapsule(signal({ outcome: "failure" }))?.status).toBe("candidate");
  });
});

describe("reuse threshold curates approved successes into patterns", () => {
  it("skips a plain first-time success below the reuse threshold", () => {
    expect(shouldGenerateCapsule(signal({ reuseCount: PATTERN_REUSE_THRESHOLD - 1 }))).toBe(false);
    expect(
      generateCandidateCapsule(signal({ reuseCount: PATTERN_REUSE_THRESHOLD - 1 })),
    ).toBeNull();
  });

  it("curates a repeatedly-validated success into a pattern candidate", () => {
    const input = signal({ reuseCount: PATTERN_REUSE_THRESHOLD });
    expect(shouldGenerateCapsule(input)).toBe(true);
    const capsule = deriveCandidateCapsule(input);
    expect(capsule.capsuleType).toBe("pattern");
    expect(capsule.status).toBe("candidate");
    expect(capsule.structuredContent).toMatchObject({ reuseCount: PATTERN_REUSE_THRESHOLD });
    // reuse-backed patterns are at least medium confidence.
    expect(capsule.metadata?.confidence).not.toBe("low");
  });
});

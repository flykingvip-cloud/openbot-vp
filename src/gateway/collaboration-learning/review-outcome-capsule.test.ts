import {
  canProjectCapsuleToLearningAsset,
  generateCandidateCapsule,
  PATTERN_REUSE_THRESHOLD,
  type Deliverable,
  type Review,
} from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  countCrossTaskReuse,
  reviewToLearningSignal,
  stampReviewCapsuleCluster,
} from "./review-outcome-capsule.js";

function review(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    groupId: "g1",
    deliverableId: "del-1",
    taskId: "task-1",
    status: "resolved",
    verdict: "reject",
    reviewerMemberId: "user-rev",
    resolvedBy: "user-rev",
    comments: "客户沟通：先解决问题再解释原因",
    suggestions: ["附上补偿方案", "缩短首次响应时间"],
    requestedAtMs: 1,
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  };
}

describe("reviewToLearningSignal", () => {
  it("returns null unless the review is resolved with a negative verdict", () => {
    expect(reviewToLearningSignal(review({ status: "submitted" }))).toBeNull();
    expect(reviewToLearningSignal(review({ status: "resolved", verdict: "approve" }))).toBeNull();
    expect(reviewToLearningSignal(review({ status: "resolved", verdict: undefined }))).toBeNull();
  });

  it("maps reject into a failure signal (reviewRejected) with feedback as the lesson", () => {
    const signal = reviewToLearningSignal(review({ verdict: "reject" }));
    expect(signal).toMatchObject({
      groupId: "g1",
      taskId: "task-1",
      outcome: "failure",
      reviewRejected: true,
      sourceType: "review",
      createdBy: "user-rev",
      lesson: "客户沟通：先解决问题再解释原因",
      observation: "附上补偿方案; 缩短首次响应时间",
    });
    expect(signal?.sourceIds).toEqual(["rev-1", "del-1"]);
  });

  it("maps revise into a partial signal with an edit (completed-but-corrected)", () => {
    const signal = reviewToLearningSignal(review({ verdict: "revise", comments: undefined }));
    expect(signal).toMatchObject({ outcome: "partial", humanEditCount: 1, reviewRejected: false });
  });

  it("falls back to reviewer/review ids when task id and comments are absent", () => {
    const signal = reviewToLearningSignal(
      review({ verdict: "revise", taskId: undefined, comments: undefined, suggestions: [] }),
    );
    expect(signal?.taskId).toBe("rev-1");
    expect(signal?.lesson).toBeUndefined();
    expect(signal?.observation).toBeUndefined();
  });
});

describe("wire: resolved review -> candidate capsule (governance-gated)", () => {
  it("reject -> anti_pattern candidate, not projectable until governed", () => {
    const signal = reviewToLearningSignal(review({ verdict: "reject" }));
    const capsule = generateCandidateCapsule(signal!);
    expect(capsule?.capsuleType).toBe("anti_pattern");
    expect(capsule?.status).toBe("candidate");
    if (!capsule) {
      throw new Error("expected candidate capsule");
    }
    expect(canProjectCapsuleToLearningAsset(capsule, { actorId: "reviewer-1" })).toBe(false);
    expect(capsule?.metadata?.failureClusterRef).toBeUndefined();
    expect(capsule?.metadata?.clusterProvenance).not.toBe("native");
  });

  it("stamps a task-bound mechanism and refuses time-free or missing task binds", () => {
    const signal = reviewToLearningSignal(review({ verdict: "reject" }));
    const capsule = generateCandidateCapsule(signal!);
    stampReviewCapsuleCluster(capsule!, review({ taskId: "task-1" }), () => ({
      cause: "permission",
    }));
    expect(capsule?.metadata).toMatchObject({
      failureClusterRef: "failure:skill-invocation:permission:v1",
      clusterProvenance: "native",
    });
    const unbound = generateCandidateCapsule(signal!);
    stampReviewCapsuleCluster(unbound!, review({ taskId: undefined }), () => ({
      cause: "permission",
    }));
    expect(unbound?.metadata?.failureClusterRef).toBeUndefined();
  });

  it("revise -> lesson candidate", () => {
    const signal = reviewToLearningSignal(review({ verdict: "revise" }));
    const capsule = generateCandidateCapsule(signal!);
    expect(capsule?.capsuleType).toBe("lesson");
    expect(capsule?.status).toBe("candidate");
  });
});

describe("rich signals: deliverable revisions + approve reuse threshold", () => {
  it("uses deliverable revision count as humanEditCount for reject/revise", () => {
    expect(
      reviewToLearningSignal(review({ verdict: "reject" }), { deliverableRevisions: 3 })
        ?.humanEditCount,
    ).toBe(3);
    // revise floors at 1 even if revisions is 0.
    expect(
      reviewToLearningSignal(review({ verdict: "revise" }), { deliverableRevisions: 0 })
        ?.humanEditCount,
    ).toBe(1);
  });

  it("skips approve below the reuse threshold", () => {
    expect(
      reviewToLearningSignal(review({ verdict: "approve" }), {
        reuseCount: PATTERN_REUSE_THRESHOLD - 1,
      }),
    ).toBeNull();
  });

  it("curates approve at/above the reuse threshold into a pattern candidate", () => {
    const signal = reviewToLearningSignal(review({ verdict: "approve" }), {
      reuseCount: PATTERN_REUSE_THRESHOLD,
    });
    expect(signal).toMatchObject({ outcome: "success", reuseCount: PATTERN_REUSE_THRESHOLD });
    const capsule = generateCandidateCapsule(signal!);
    expect(capsule?.capsuleType).toBe("pattern");
    expect(capsule?.status).toBe("candidate");
    if (!capsule) {
      throw new Error("expected candidate capsule");
    }
    // pattern candidate is still governance-gated (not projectable until approved + upgraded).
    expect(canProjectCapsuleToLearningAsset(capsule, { actorId: "reviewer-1" })).toBe(false);
  });
});

describe("countCrossTaskReuse (real cross-task reuse, not deliverable count)", () => {
  function deliverable(overrides: Partial<Deliverable> = {}): Deliverable {
    return {
      deliverableId: "d1",
      groupId: "g1",
      title: "d",
      status: "approved",
      version: 1,
      sourceLineageId: "lin-1",
      createdAtMs: 1,
      updatedAtMs: 1,
      ...overrides,
    };
  }

  it("counts distinct taskIds, not versions of the same task", () => {
    const deliverables = [
      deliverable({ deliverableId: "d1", taskId: "t1", version: 1 }),
      deliverable({ deliverableId: "d2", taskId: "t1", version: 2 }), // same task, another version
      deliverable({ deliverableId: "d3", taskId: "t2", status: "published" }),
    ];
    // two distinct tasks (t1, t2) despite three approved deliverables.
    expect(countCrossTaskReuse(deliverables, "lin-1")).toBe(2);
  });

  it("ignores other lineages and non-approved deliverables", () => {
    const deliverables = [
      deliverable({ taskId: "t1" }),
      deliverable({ deliverableId: "d2", taskId: "t2", sourceLineageId: "lin-2" }),
      deliverable({ deliverableId: "d3", taskId: "t3", status: "draft" }),
    ];
    expect(countCrossTaskReuse(deliverables, "lin-1")).toBe(1);
  });

  it("falls back to deliverableId when taskId is absent (still no version inflation across tasks)", () => {
    const deliverables = [
      deliverable({ deliverableId: "d1", taskId: undefined }),
      deliverable({ deliverableId: "d2", taskId: undefined }),
    ];
    expect(countCrossTaskReuse(deliverables, "lin-1")).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  canBindCapsuleToBot,
  canProjectCapsuleToLearningAsset,
  canPromoteProjectionToAsset,
  evaluateCapsuleProjectionEligibility,
  getProjectionPromotionFailureReason,
} from "./policies/learning-projection.js";
import type { GroupMemoryCapsule, LearningProjection } from "./types/learning.js";

function createCapsule(overrides: Partial<GroupMemoryCapsule> = {}): GroupMemoryCapsule {
  return {
    capsuleId: "capsule-1",
    groupId: "group-1",
    status: "approved",
    capsuleType: "lesson",
    sensitivity: "internal",
    reusability: "promotable",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createProjection(overrides: Partial<LearningProjection> = {}): LearningProjection {
  return {
    projectionId: "projection-1",
    sourceGroupId: "group-1",
    sourceCapsuleId: "capsule-1",
    targetBotId: "bot-1",
    projectionType: "personal_abstracted",
    transformationRule: "summary",
    approvalStatus: "approved",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("learning projection policy", () => {
  it("blocks secret capsules from projection and binding", () => {
    const capsule = createCapsule({
      sensitivity: "secret",
      reusability: "exportable",
    });

    expect(
      evaluateCapsuleProjectionEligibility(capsule, { actorId: "owner-1", actorKind: "human" }),
    ).toEqual({
      allowed: false,
      reason: "secret_capsule",
      projectionType: "group_only",
      requiresApproval: false,
    });
    expect(canProjectCapsuleToLearningAsset(capsule, { actorId: "owner-1" })).toBe(false);
    expect(canBindCapsuleToBot("bot-1", capsule)).toBe(false);
  });

  it("requires approval and anonymization for restricted capsules", () => {
    const capsule = createCapsule({
      sensitivity: "restricted",
      reusability: "reusable",
    });

    expect(
      evaluateCapsuleProjectionEligibility(capsule, { actorId: "owner-1", actorKind: "human" }),
    ).toEqual({
      allowed: true,
      reason: "restricted_capsule_requires_approval",
      projectionType: "personal_abstracted",
      transformationRule: "anonymized",
      requiresApproval: true,
    });

    const pendingProjection = createProjection({
      projectionType: "personal_abstracted",
      transformationRule: "anonymized",
      requiresApproval: true,
      approvalStatus: "pending",
    });

    expect(canPromoteProjectionToAsset(pendingProjection, capsule, { actorId: "owner-1" })).toBe(
      false,
    );
    expect(
      getProjectionPromotionFailureReason(pendingProjection, capsule, { actorId: "owner-1" }),
    ).toBe("projection_not_approved");
  });

  it("allows exportable internal capsules to promote when approved", () => {
    const capsule = createCapsule({
      sensitivity: "internal",
      reusability: "exportable",
      capsuleType: "pattern",
    });

    expect(
      evaluateCapsuleProjectionEligibility(capsule, { actorId: "owner-1", actorKind: "human" }),
    ).toEqual({
      allowed: true,
      reason: "ok",
      projectionType: "personal_transferable",
      transformationRule: "pattern_only",
      requiresApproval: false,
    });

    const projection = createProjection({
      projectionType: "personal_transferable",
      transformationRule: "pattern_only",
      approvalStatus: "auto_approved",
    });

    expect(canProjectCapsuleToLearningAsset(capsule, { actorId: "owner-1" })).toBe(true);
    expect(canBindCapsuleToBot("bot-1", capsule)).toBe(true);
    expect(canPromoteProjectionToAsset(projection, capsule, { actorId: "owner-1" })).toBe(true);
  });

  it("blocks promotion for rejected or expired projections", () => {
    const capsule = createCapsule();
    const rejected = createProjection({ approvalStatus: "rejected" });
    const expired = createProjection({ expiresAt: Date.now() - 1000 });

    expect(canPromoteProjectionToAsset(rejected, capsule, { actorId: "owner-1" })).toBe(false);
    expect(getProjectionPromotionFailureReason(rejected, capsule, { actorId: "owner-1" })).toBe(
      "projection_rejected",
    );
    expect(canPromoteProjectionToAsset(expired, capsule, { actorId: "owner-1" })).toBe(false);
    expect(getProjectionPromotionFailureReason(expired, capsule, { actorId: "owner-1" })).toBe(
      "projection_expired",
    );
  });
});

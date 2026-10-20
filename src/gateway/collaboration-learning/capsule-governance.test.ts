import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import { applyCapsuleGovernanceTransition, CapsuleGovernanceError } from "./capsule-governance.js";

function capsule(overrides: Partial<GroupMemoryCapsule> = {}): GroupMemoryCapsule {
  return {
    capsuleId: "cap-1",
    groupId: "g1",
    capsuleType: "anti_pattern",
    status: "candidate",
    reusability: "group_only",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("applyCapsuleGovernanceTransition", () => {
  it("approves a candidate: sets status/approvedAt/approvedBy/updatedAt", () => {
    const next = applyCapsuleGovernanceTransition(capsule(), "approved", {
      actor: "reviewer-1",
      nowMs: 5000,
    });
    expect(next.status).toBe("approved");
    expect(next.approvedBy).toBe("reviewer-1");
    expect(next.approvedAt).toBe(5000);
    expect(next.updatedAt).toBe(5000);
    // Default approve upgrades group_only → promotable so projection can proceed.
    expect(next.reusability).toBe("promotable");
  });

  it("optionally upgrades reusability on approval", () => {
    const next = applyCapsuleGovernanceTransition(capsule(), "approved", {
      reusability: "promotable",
      nowMs: 5000,
    });
    expect(next.status).toBe("approved");
    expect(next.reusability).toBe("promotable");
  });

  it("treats undefined status as candidate (legacy capsules approvable)", () => {
    const next = applyCapsuleGovernanceTransition(capsule({ status: undefined }), "approved", {
      nowMs: 5000,
    });
    expect(next.status).toBe("approved");
  });

  it("revokes a candidate or an approved capsule", () => {
    expect(applyCapsuleGovernanceTransition(capsule(), "revoked", { nowMs: 9 }).status).toBe(
      "revoked",
    );
    expect(
      applyCapsuleGovernanceTransition(capsule({ status: "approved" }), "revoked", { nowMs: 9 })
        .status,
    ).toBe("revoked");
  });

  it("rejects illegal transitions", () => {
    expect(() =>
      applyCapsuleGovernanceTransition(capsule({ status: "approved" }), "approved"),
    ).toThrow(CapsuleGovernanceError);
    expect(() =>
      applyCapsuleGovernanceTransition(capsule({ status: "revoked" }), "approved"),
    ).toThrow(CapsuleGovernanceError);
    expect(() =>
      applyCapsuleGovernanceTransition(capsule({ status: "revoked" }), "revoked"),
    ).toThrow(CapsuleGovernanceError);
  });

  it("does not mutate the input capsule (pure)", () => {
    const input = capsule();
    applyCapsuleGovernanceTransition(input, "approved", { actor: "r", nowMs: 5000 });
    expect(input.status).toBe("candidate");
    expect(input.approvedAt).toBeUndefined();
  });
});

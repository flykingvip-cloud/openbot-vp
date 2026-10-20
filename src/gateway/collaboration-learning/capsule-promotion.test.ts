import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import { resolveReusabilityOnApprove, resolveTargetBotIdForCapsule } from "./capsule-promotion.js";

function capsule(overrides: Partial<GroupMemoryCapsule> = {}): GroupMemoryCapsule {
  return {
    capsuleId: "cap-1",
    groupId: "g1",
    capsuleType: "lesson",
    status: "candidate",
    reusability: "group_only",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("resolveReusabilityOnApprove", () => {
  it("upgrades group_only to promotable by default", () => {
    expect(resolveReusabilityOnApprove(capsule())).toBe("promotable");
  });

  it("keeps secret capsules group_only", () => {
    expect(resolveReusabilityOnApprove(capsule({ sensitivity: "secret" }))).toBe("group_only");
  });

  it("respects explicit override", () => {
    expect(resolveReusabilityOnApprove(capsule(), "exportable")).toBe("exportable");
  });
});

describe("resolveTargetBotIdForCapsule", () => {
  it("uses createdBy when it is a known agent id", () => {
    expect(resolveTargetBotIdForCapsule(capsule({ createdBy: "main" }), ["main", "ops"])).toBe(
      "main",
    );
  });

  it("uses participation metadata bot segment", () => {
    expect(
      resolveTargetBotIdForCapsule(
        capsule({
          metadata: { sourceParticipationId: "g1::ops" },
        }),
        ["main", "ops"],
      ),
    ).toBe("ops");
  });

  it("returns null when no resolvable bot", () => {
    expect(resolveTargetBotIdForCapsule(capsule({ createdBy: "human-reviewer" }), ["main"])).toBe(
      null,
    );
  });
});

import { describe, expect, it } from "vitest";

describe("@openbot/collaboration-core package", () => {
  it("resolves through the package name", async () => {
    const mod = await import("./index.js");
    expect(mod.COLLABORATION_CORE_VERSION).toBe("0.1.0");
  });

  it("blocks promotion for secret and group-only capsules", async () => {
    const mod = await import("./index.js");

    expect(
      mod.canProjectCapsuleToLearningAsset(
        {
          capsuleId: "capsule-1",
          groupId: "group-1",
          status: "approved",
          sensitivity: "secret",
        },
        { actorId: "human-1" },
      ),
    ).toBe(false);

    expect(
      mod.canPromoteProjectionToAsset(
        {
          projectionId: "projection-1",
          sourceGroupId: "group-1",
          sourceCapsuleId: "capsule-2",
          targetBotId: "bot-1",
          approvalStatus: "approved",
          projectionType: "personal_abstracted",
        },
        {
          capsuleId: "capsule-2",
          groupId: "group-1",
          status: "approved",
          reusability: "group_only",
        },
        { actorId: "human-1" },
      ),
    ).toBe(false);
  });

  it("allows approved promotable projections and revokes only active assets", async () => {
    const mod = await import("./index.js");

    expect(
      mod.canPromoteProjectionToAsset(
        {
          projectionId: "projection-1",
          sourceGroupId: "group-1",
          sourceCapsuleId: "capsule-1",
          targetBotId: "bot-1",
          approvalStatus: "auto_approved",
          projectionType: "personal_transferable",
        },
        {
          capsuleId: "capsule-1",
          groupId: "group-1",
          status: "approved",
          sensitivity: "internal",
          reusability: "reusable",
        },
        { actorId: "human-1" },
      ),
    ).toBe(true);

    expect(
      mod.canRevokeLearningAsset({
        assetId: "asset-1",
        botId: "bot-1",
        sourceGroupId: "group-1",
        sourceCapsuleId: "capsule-1",
        status: "active",
      }),
    ).toBe(true);

    expect(
      mod.canRevokeLearningAsset({
        assetId: "asset-2",
        botId: "bot-1",
        sourceGroupId: "group-1",
        sourceCapsuleId: "capsule-1",
        status: "revoked",
      }),
    ).toBe(false);
  });
});

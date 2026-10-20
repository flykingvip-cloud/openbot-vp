import { describe, expect, it } from "vitest";
import {
  buildParticipationId,
  createBotParticipationProfile,
  isParticipationActive,
} from "./types/participation.js";

describe("participation behavior", () => {
  it("builds stable participation ids from group and bot identity", () => {
    expect(buildParticipationId("group-1", "bot-1")).toBe("group-1::bot-1");
  });

  it("creates participation profiles with governance defaults", () => {
    const profile = createBotParticipationProfile({
      groupId: "group-1",
      botId: "bot-1",
      collaborationRole: "reviewer",
      updatedAtMs: 100,
    });

    expect(profile).toEqual({
      participationId: "group-1::bot-1",
      groupId: "group-1",
      botId: "bot-1",
      governanceRole: "member",
      collaborationRole: "reviewer",
      status: "active",
      visibility: "visible",
      trustLevel: "baseline",
      confidentialityTier: "internal",
      joinedAtMs: 100,
      updatedAtMs: 100,
    });
    expect(isParticipationActive(profile)).toBe(true);
  });

  it("keeps participation state independent across groups for the same bot", () => {
    const groupOne = createBotParticipationProfile({
      groupId: "group-1",
      botId: "bot-1",
      updatedAtMs: 10,
    });
    const groupTwo = createBotParticipationProfile({
      groupId: "group-2",
      botId: "bot-1",
      governanceRole: "admin",
      status: "paused",
      updatedAtMs: 20,
    });

    expect(groupOne.participationId).not.toBe(groupTwo.participationId);
    expect(groupTwo.governanceRole).toBe("admin");
    expect(isParticipationActive(groupTwo)).toBe(false);
  });
});

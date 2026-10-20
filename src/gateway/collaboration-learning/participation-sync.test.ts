import type { BotParticipationProfile, CollaborationMember } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  buildSessionParticipationOverlay,
  mapMemberToParticipationProfile,
  mergeParticipationsFromMembers,
} from "./participation-sync.js";

const groupId = "grp_test";

function botMember(
  agentId: string,
  status: CollaborationMember["status"] = "active",
): CollaborationMember {
  return {
    memberId: agentId,
    memberKind: "bot",
    agentId,
    governanceRole: "member",
    collaborationRole: "contributor",
    status,
    visibility: "visible",
    joinedAtMs: 1_000,
    updatedAtMs: 2_000,
  };
}

describe("participation-sync", () => {
  it("maps bot members to BotParticipationProfile with stable participationId", () => {
    const profile = mapMemberToParticipationProfile(botMember("aegis"), groupId);
    expect(profile).toMatchObject({
      participationId: `${groupId}::aegis`,
      groupId,
      botId: "aegis",
      status: "active",
      joinedAtMs: 1_000,
      updatedAtMs: 2_000,
    });
  });

  it("preserves joinedAtMs when syncing an existing participation", () => {
    const existing: BotParticipationProfile = {
      participationId: `${groupId}::aegis`,
      groupId,
      botId: "aegis",
      governanceRole: "member",
      status: "active",
      trustLevel: "baseline",
      confidentialityTier: "internal",
      joinedAtMs: 42,
      updatedAtMs: 100,
    };
    const profile = mapMemberToParticipationProfile(botMember("aegis"), groupId, existing);
    expect(profile?.joinedAtMs).toBe(42);
  });

  it("merges members and marks missing bots as removed", () => {
    const existing: BotParticipationProfile[] = [
      {
        participationId: `${groupId}::legacy`,
        groupId,
        botId: "legacy",
        governanceRole: "member",
        status: "active",
        trustLevel: "baseline",
        confidentialityTier: "internal",
        joinedAtMs: 1,
        updatedAtMs: 1,
      },
    ];
    const merged = mergeParticipationsFromMembers({
      groupId,
      members: [botMember("aegis")],
      existing,
    });
    expect(merged.find((entry) => entry.botId === "aegis")?.status).toBe("active");
    expect(merged.find((entry) => entry.botId === "legacy")?.status).toBe("removed");
  });

  it("builds session overlay from profile and capability overlay", () => {
    const profile = mapMemberToParticipationProfile(botMember("aegis"), groupId);
    expect(profile).not.toBeNull();
    const overlay = buildSessionParticipationOverlay({
      profile: profile!,
      capabilityOverlay: {
        participationId: profile!.participationId,
        botId: "aegis",
        groupId,
        enabledSkills: ["summarize"],
        blockedSkills: ["danger"],
        systemInstructions: ["Stay concise"],
        updatedAtMs: 3_000,
      },
    });
    expect(overlay).toMatchObject({
      participationId: `${groupId}::aegis`,
      botId: "aegis",
      groupId,
      overlayCapabilities: ["summarize"],
      policyFilters: ["!danger"],
      systemInstructions: ["Stay concise"],
    });
  });
});

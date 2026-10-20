import type { ParticipationOverlay } from "@openbot/collaboration-runtime";
import { describe, expect, it } from "vitest";
import {
  isCollaborationParticipationOverlayBag,
  normalizeParticipationOverlaysByBotId,
  resolveSessionParticipationGroupId,
  resolveSessionParticipationOverlay,
  upsertSessionParticipationOverlay,
} from "./session-participation-overlay.js";

function overlay(botId: string, skill: string): ParticipationOverlay {
  return {
    botId,
    groupId: "grp_demo",
    participationId: `grp_demo::${botId}`,
    overlayCapabilities: [skill],
    updatedAt: 1,
  };
}

describe("session-participation-overlay", () => {
  it("resolves per-bot overlay from v1 bag without cross-bot leak", () => {
    const bag = upsertSessionParticipationOverlay({
      existing: null,
      overlay: overlay("bot-a", "skill-a"),
    });
    const withB = upsertSessionParticipationOverlay({
      existing: bag,
      overlay: overlay("bot-b", "skill-b"),
    });

    expect(isCollaborationParticipationOverlayBag(withB)).toBe(true);
    expect(resolveSessionParticipationOverlay({ field: withB, botId: "bot-a" })).toMatchObject({
      botId: "bot-a",
      overlayCapabilities: ["skill-a"],
    });
    expect(resolveSessionParticipationOverlay({ field: withB, botId: "bot-b" })).toMatchObject({
      botId: "bot-b",
      overlayCapabilities: ["skill-b"],
    });
    // Asking for bot-a must never return bot-b's capabilities.
    expect(
      resolveSessionParticipationOverlay({ field: withB, botId: "bot-a" })?.overlayCapabilities,
    ).not.toContain("skill-b");
    expect(
      resolveSessionParticipationOverlay({ field: withB, botId: "bot-missing" }),
    ).toBeUndefined();
  });

  it("migrates legacy single overlay into bag on upsert and preserves peer", () => {
    const legacy = overlay("bot-a", "legacy-skill");
    const next = upsertSessionParticipationOverlay({
      existing: legacy,
      overlay: overlay("bot-b", "new-skill"),
    });
    expect(normalizeParticipationOverlaysByBotId(next)).toEqual({
      "bot-a": expect.objectContaining({ overlayCapabilities: ["legacy-skill"] }),
      "bot-b": expect.objectContaining({ overlayCapabilities: ["new-skill"] }),
    });
  });

  it("legacy single overlay only resolves for matching botId", () => {
    const legacy = overlay("bot-a", "only-a");
    expect(resolveSessionParticipationOverlay({ field: legacy, botId: "bot-a" })?.botId).toBe(
      "bot-a",
    );
    expect(resolveSessionParticipationOverlay({ field: legacy, botId: "bot-b" })).toBeUndefined();
    expect(resolveSessionParticipationOverlay({ field: legacy })?.botId).toBe("bot-a");
  });

  it("resolves groupId from bag or legacy", () => {
    expect(resolveSessionParticipationGroupId(overlay("bot-a", "x"))).toBe("grp_demo");
    const bag = upsertSessionParticipationOverlay({
      existing: null,
      overlay: overlay("bot-a", "x"),
    });
    expect(resolveSessionParticipationGroupId(bag)).toBe("grp_demo");
  });
});

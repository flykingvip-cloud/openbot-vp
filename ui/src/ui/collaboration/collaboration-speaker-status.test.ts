import { describe, expect, it } from "vitest";
import type { CollaborationRoundPlanPayload } from "../../../../src/gateway/collaboration-dispatch/types.js";
import {
  formatCollaborationSpeakerStatus,
  resolveCollaborationSpeakerStatus,
  shouldShowCollaborationMentionHint,
} from "./collaboration-speaker-status.ts";

function plan(
  overrides: Partial<CollaborationRoundPlanPayload> = {},
): CollaborationRoundPlanPayload {
  return {
    roundId: "round-1",
    sessionKey: "space:alpha",
    responseMode: "lead_plus_supplement",
    summaryText: "本轮参与 1 人",
    participants: [
      {
        agentId: "bot-market",
        displayName: "市场助手",
        tier: "duty",
        contributionRole: "lead",
        reasonText: "职责",
      },
    ],
    mentionMode: "none",
    ...overrides,
  };
}

function translate(key: string, vars?: Record<string, string>) {
  if (key.endsWith("speakerPrimary")) {
    return `本轮主讲：${vars?.name}（按职责匹配）`;
  }
  if (key.endsWith("speakerNamed")) {
    return `本轮点名：${vars?.names}`;
  }
  if (key.endsWith("speakerAll")) {
    return "本轮可多人回应";
  }
  if (key.endsWith("speakerSpeaking")) {
    return `正在回复：${vars?.name}`;
  }
  return key;
}

describe("resolveCollaborationSpeakerStatus", () => {
  it("surfaces duty-matched primary when nobody was @ mentioned", () => {
    const status = resolveCollaborationSpeakerStatus({
      sessionKey: "space:alpha",
      roundPlan: plan(),
    });
    expect(status).toEqual({ kind: "primary", name: "市场助手" });
    expect(formatCollaborationSpeakerStatus(status, translate)).toBe(
      "本轮主讲：市场助手（按职责匹配）",
    );
    expect(shouldShowCollaborationMentionHint(status)).toBe(true);
  });

  it("shows named mentions without inventing a second speaker policy", () => {
    const status = resolveCollaborationSpeakerStatus({
      sessionKey: "space:alpha",
      roundPlan: plan({
        mentionMode: "single_primary",
        participants: [
          {
            agentId: "bot-skill",
            displayName: "Skill孵化",
            tier: "mention",
            contributionRole: "lead",
            reasonText: "已点名",
          },
        ],
      }),
    });
    expect(status).toEqual({ kind: "named", names: ["Skill孵化"] });
    expect(formatCollaborationSpeakerStatus(status, translate)).toBe("本轮点名：Skill孵化");
  });

  it("shows the all-may-speak state for @everyone", () => {
    const status = resolveCollaborationSpeakerStatus({
      sessionKey: "space:alpha",
      roundPlan: plan({ mentionAll: true, mentionMode: "none", participants: [] }),
    });
    expect(status).toEqual({ kind: "all" });
    expect(formatCollaborationSpeakerStatus(status, translate)).toBe("本轮可多人回应");
  });

  it("prefers the selected lead over the broadcast flag", () => {
    const status = resolveCollaborationSpeakerStatus({
      sessionKey: "space:alpha",
      roundPlan: plan({
        mentionAll: true,
        mentionMode: "none",
        participants: [
          {
            agentId: "bot-c",
            displayName: "Bot C",
            tier: "duty",
            contributionRole: "lead",
            reasonText: "未点名主答",
          },
        ],
      }),
    });
    expect(status).toEqual({ kind: "primary", name: "Bot C" });
  });

  it("prefers the in-progress responder", () => {
    const status = resolveCollaborationSpeakerStatus({
      sessionKey: "space:alpha",
      speakingAgentId: "bot-market",
      members: [{ id: "bot-market", label: "市场助手" }],
      roundPlan: plan({ mentionAll: true }),
    });
    expect(status).toEqual({ kind: "speaking", name: "市场助手" });
    expect(formatCollaborationSpeakerStatus(status, translate)).toBe("正在回复：市场助手");
    expect(shouldShowCollaborationMentionHint(status)).toBe(false);
  });
});

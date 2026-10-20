import type { GroupCapabilityProfile, GroupProfile } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  appendCharterParticipationInstructions,
  composeCollaborationGroupProfileFromDisk,
  mergeCollaborationGroupProfiles,
} from "./group-runtime-profile.js";

const groupId = "grp-digital-human";

function profile(overrides?: Partial<GroupProfile>): GroupProfile {
  return {
    groupId,
    groupCode: groupId,
    displayName: "数字人测试",
    purpose: "协作演练",
    currentMission: "完成成员介绍并建立协作上下文",
    collaborationMode: "discussion_driven",
    createdAtMs: 1,
    updatedAtMs: 2,
    ...overrides,
  };
}

function capabilities(overrides?: Partial<GroupCapabilityProfile>): GroupCapabilityProfile {
  return {
    groupId,
    systemInstructions: ["被 @ 时必须回应", "禁止空寒暄"],
    updatedAtMs: 3,
    ...overrides,
  };
}

describe("group runtime profile", () => {
  it("composes identity from profile.json and instructions from capabilities.json", () => {
    const composed = composeCollaborationGroupProfileFromDisk({
      groupId,
      profile: profile(),
      capabilities: capabilities(),
    });
    expect(composed).toMatchObject({
      groupId,
      displayName: "数字人测试",
      purpose: "协作演练",
      currentMission: "完成成员介绍并建立协作上下文",
      systemInstructions: ["被 @ 时必须回应", "禁止空寒暄"],
    });
  });

  it("prefers disk systemInstructions over a stale session profile", () => {
    const merged = mergeCollaborationGroupProfiles(
      {
        groupId,
        systemInstructions: ["过期规则"],
        updatedAtMs: 1,
      },
      capabilities(),
    );
    expect(merged?.systemInstructions).toEqual(["被 @ 时必须回应", "禁止空寒暄"]);
  });

  it("appends charter participation into injectable instructions without dropping disk lines", () => {
    const enriched = appendCharterParticipationInstructions(
      ["协作小组名称：数字人测试", "被 @ 时必须回应，且应紧扣议题。"],
      {
        groupId,
        lifecycleStatus: "ACTIVE",
        displayName: "数字人测试",
        operatingPhases: ["explore", "debate", "decide", "deliver", "review"],
        participationPolicy: {
          whyHere: "推进共享使命",
          whenToSpeak: ["被 @ 时必须回应，且应紧扣议题。", "仅在能提供新信息时可发言。"],
          lowQualityBehaviors: ["社交寒暄替代实质贡献"],
        },
        coordinatorPolicy: { responsibilities: [], mustNotMonopolizeSpeech: true },
        promotionPolicy: {
          allowAutoPromote: true,
          requireLifecycleActive: true,
          blockSecretAutoPromote: true,
          dissentEncouraged: true,
        },
        collaborationPolicySnapshot: {
          humanStartsNewRound: true,
          mentionBotMustRespond: true,
          mentionHumanNotifiesOnly: true,
          openDiscussionWithoutMention: true,
          maxVisibleBotRepliesPerRound: 5,
          botMaySelfAdvanceWithoutHuman: false,
          entersWaitingForHumanAfterVisibleTurnsExhausted: true,
        },
        updatedAtMs: 1,
      },
    );
    expect(enriched).toEqual([
      "协作小组名称：数字人测试",
      "被 @ 时必须回应，且应紧扣议题。",
      "仅在能提供新信息时可发言。",
      "避免：社交寒暄替代实质贡献",
    ]);
  });

  it("keeps session instructions when disk capabilities have none", () => {
    const merged = mergeCollaborationGroupProfiles(
      {
        groupId,
        displayName: "会话名",
        systemInstructions: ["会话里的规则"],
        updatedAtMs: 1,
      },
      {
        groupId,
        displayName: "磁盘名",
        updatedAtMs: 4,
      },
    );
    expect(merged).toMatchObject({
      displayName: "磁盘名",
      systemInstructions: ["会话里的规则"],
    });
  });
});

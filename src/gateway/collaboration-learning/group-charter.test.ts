import type { Deliverable, Review } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  buildGroupCharterDocument,
  buildGroupCharterSystemPrompt,
  normalizeGroupLifecycleStatus,
} from "./group-charter.js";
import type { GatewayCollaborationGroupOperatingState } from "./operating-state-types.js";
import { deriveOperatingPhase } from "./shared.js";

const groupId = "grp_governance";

function baseOperatingState(
  overrides?: Partial<GatewayCollaborationGroupOperatingState>,
): GatewayCollaborationGroupOperatingState {
  return {
    groupId,
    groupProfile: {
      displayName: "Governance Test",
      expectedOutputs: [],
      successCriteria: [],
    },
    governance: {
      adminUserIds: [],
      coordinatorBotId: "coordinator",
    },
    collaborationPolicy: {
      humanStartsNewRound: true,
      mentionBotMustRespond: true,
      mentionHumanNotifiesOnly: true,
      openDiscussionWithoutMention: true,
      maxVisibleBotRepliesPerRound: 5,
      botMaySelfAdvanceWithoutHuman: false,
      entersWaitingForHumanAfterVisibleTurnsExhausted: true,
    },
    memberRoleMap: [],
    activeContext: {
      currentOperatingPhase: "explore",
      waitingForHuman: false,
      summary: "阶段：explore",
      updatedAtMs: 1,
    },
    onboardingStatus: { initialized: true },
    groupMemoryRefs: { latestCapsuleIds: [] },
    updatedAtMs: 1,
    ...overrides,
  };
}

describe("group charter", () => {
  it("normalizes lifecycle status", () => {
    expect(normalizeGroupLifecycleStatus("frozen")).toBe("FROZEN");
    expect(normalizeGroupLifecycleStatus("archived")).toBe("ARCHIVED");
    expect(normalizeGroupLifecycleStatus(undefined)).toBe("ACTIVE");
  });

  it("builds charter with participation and coordinator policies", () => {
    const charter = buildGroupCharterDocument({
      groupId,
      profile: {
        groupId,
        groupCode: groupId,
        displayName: "Governance Test",
        purpose: "测试治理",
        currentMission: "验证 charter",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      members: [],
      operatingState: baseOperatingState(),
      existing: null,
    });
    expect(charter.operatingPhases).toEqual(["explore", "debate", "decide", "deliver", "review"]);
    expect(charter.participationPolicy.whyHere).toContain("测试治理");
    expect(charter.coordinatorPolicy.mustNotMonopolizeSpeech).toBe(true);
    expect(charter.promotionPolicy.blockSecretAutoPromote).toBe(true);
    expect(buildGroupCharterSystemPrompt(charter)).toContain("Collaboration group charter");
  });

  it("derives review phase for in_review deliverables", () => {
    const deliverable = {
      deliverableId: "d1",
      status: "in_review",
      updatedAtMs: 1,
    } as Deliverable;
    expect(deriveOperatingPhase({ deliverable })).toBe("review");
  });

  it("derives debate phase for active reviews", () => {
    const review = {
      reviewId: "r1",
      status: "requested",
      updatedAtMs: 1,
    } as Review;
    expect(deriveOperatingPhase({ review })).toBe("debate");
  });
});

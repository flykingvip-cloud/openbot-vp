import { describe, expect, it } from "vitest";
import {
  handleCollaborationRoundPlanEvent,
  resolveActiveCollaborationRoundPlan,
} from "./collaboration-round-plan.ts";

describe("collaboration round plan controller", () => {
  it("stores round plan for matching session key", () => {
    const state = {
      sessionKey: "space:alpha",
      collaborationRoundPlan: null,
      collaborationRoundPlanSessionKey: null,
      collaborationRoundSummaries: {},
    };
    handleCollaborationRoundPlanEvent(state, {
      roundId: "round-1",
      sessionKey: "space:alpha",
      responseMode: "single_owner",
      summaryText: "本轮参与 2 人",
      participants: [],
    });
    expect(resolveActiveCollaborationRoundPlan(state)?.summaryText).toBe("本轮参与 2 人");
  });

  it("ignores round plan for a different session", () => {
    const state = {
      sessionKey: "space:beta",
      collaborationRoundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "single_owner" as const,
        summaryText: "本轮参与 2 人",
        participants: [],
      },
      collaborationRoundPlanSessionKey: "space:alpha",
      collaborationRoundSummaries: {},
    };
    expect(resolveActiveCollaborationRoundPlan(state)).toBeNull();
  });
});

import { describe, expect, test, vi } from "vitest";
import { buildCollaborationRoundStages, sleepMs } from "./round-orchestrator.js";
import type { ParticipationDecision } from "./types.js";

function createDecision(overrides: Partial<ParticipationDecision> = {}): ParticipationDecision {
  return {
    roundId: "round-1",
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [
      {
        agentId: "bot-a",
        name: "Bot A",
        sessionKey: "agent:bot-a:main:space:alpha",
        updatedAt: 1,
      },
      {
        agentId: "bot-b",
        name: "Bot B",
        sessionKey: "agent:bot-b:main:space:alpha",
        updatedAt: 2,
      },
    ],
    tier2: [
      {
        agentId: "bot-c",
        name: "Bot C",
        sessionKey: "agent:bot-c:main:space:alpha",
        updatedAt: 3,
      },
    ],
    executionBots: [],
    roundPlan: {
      roundId: "round-1",
      sessionKey: "space:alpha",
      responseMode: "lead_plus_supplement",
      summaryText: "test",
      participants: [
        {
          agentId: "bot-a",
          displayName: "Bot A",
          tier: "duty",
          contributionRole: "lead",
          reasonText: "lead",
        },
        {
          agentId: "bot-b",
          displayName: "Bot B",
          tier: "relevance",
          contributionRole: "supplement",
          reasonText: "supplement",
        },
        {
          agentId: "bot-c",
          displayName: "Bot C",
          tier: "wrap",
          contributionRole: "wrap",
          reasonText: "wrap",
        },
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
    ...overrides,
  };
}

describe("collaboration round orchestrator", () => {
  test("splits explicit_multi mentions into a lead queue with no supplements", () => {
    const decision = createDecision({
      primaryMode: "explicit_multi",
      mentionMode: "explicit_multi",
      primaryQueue: ["bot-a", "bot-b"],
      executionBots: createDecision().tier1,
    });
    const stages = buildCollaborationRoundStages(decision);
    expect(stages.lead.bots.map((bot) => bot.agentId)).toEqual(["bot-a", "bot-b"]);
    expect(stages.supplement.bots).toEqual([]);
  });

  test("splits lead, supplement, and wrap stages", () => {
    const decision = createDecision({
      executionBots: createDecision().tier1,
    });
    const stages = buildCollaborationRoundStages(decision);
    expect(stages.lead.bots.map((bot) => bot.agentId)).toEqual(["bot-a"]);
    expect(stages.supplement.bots.map((bot) => bot.agentId)).toEqual(["bot-b"]);
    expect(stages.wrap.bots.map((bot) => bot.agentId)).toEqual(["bot-c"]);
  });

  test("stages decision_to_executor as confirm then executor", () => {
    const decision = createDecision({
      responseMode: "decision_to_executor",
      tier0: [
        {
          agentId: "bot-c",
          name: "Coordinator",
          sessionKey: "agent:bot-c:main:space:alpha",
          updatedAt: 1,
        },
      ],
      tier1: [
        {
          agentId: "bot-skill",
          name: "Executor",
          sessionKey: "agent:bot-skill:main:space:alpha",
          updatedAt: 2,
        },
      ],
      tier2: [],
      executionBots: [
        {
          agentId: "bot-c",
          name: "Coordinator",
          sessionKey: "agent:bot-c:main:space:alpha",
          updatedAt: 1,
        },
        {
          agentId: "bot-skill",
          name: "Executor",
          sessionKey: "agent:bot-skill:main:space:alpha",
          updatedAt: 2,
        },
      ],
      roundPlan: {
        roundId: "round-1",
        sessionKey: "space:alpha",
        responseMode: "decision_to_executor",
        summaryText: "test",
        participants: [
          {
            agentId: "bot-c",
            displayName: "Coordinator",
            tier: "mention",
            contributionRole: "confirm",
            reasonText: "confirm",
          },
          {
            agentId: "bot-skill",
            displayName: "Executor",
            tier: "duty",
            contributionRole: "executor",
            reasonText: "executor",
          },
        ],
      },
    });
    const stages = buildCollaborationRoundStages(decision);
    expect(stages.lead.bots.map((bot) => bot.agentId)).toEqual(["bot-c"]);
    expect(stages.supplement.bots.map((bot) => bot.agentId)).toEqual(["bot-skill"]);
    expect(stages.wrap.bots).toEqual([]);
    expect(stages.coordinationDelayMs).toBe(500);
  });
});

test("coordination wait cancels promptly and removes its timer", async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    const wait = sleepMs(2500, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await wait;
    expect(vi.getTimerCount()).toBe(0);
    await sleepMs(2500, controller.signal);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

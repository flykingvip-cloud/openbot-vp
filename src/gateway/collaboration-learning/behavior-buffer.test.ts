import { describe, expect, it } from "vitest";
import type { CollaborationLedgerRecord } from "../collaboration-ledger/types.js";
import {
  aggregateBehaviorBufferFromLedgerRecords,
  deriveBehaviorGrowthHints,
} from "./behavior-buffer.js";
import { resolvePromotionPolicyFromCharter } from "./promotion-audit.js";
import { DEFAULT_GROUP_PROMOTION_POLICY } from "./promotion-policy.js";

describe("behavior buffer", () => {
  it("aggregates dispatch and execution records per agent", () => {
    const records: CollaborationLedgerRecord[] = [
      {
        kind: "dispatch",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        messagePreview: "hello",
        summaryText: "round",
        participantAgentIds: ["bot-a", "bot-b"],
        recordedAtMs: 1000,
      },
      {
        kind: "execution",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-a",
        agentName: "A",
        tier: "duty",
        status: "completed",
        recordedAtMs: 1100,
      },
      {
        kind: "execution",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-b",
        agentName: "B",
        tier: "duty",
        status: "skipped",
        recordedAtMs: 1200,
      },
    ];
    const snapshot = aggregateBehaviorBufferFromLedgerRecords({
      groupId: "grp_a",
      records,
      windowFromMs: 0,
      nowMs: 2000,
    });
    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.agents.find((entry) => entry.agentId === "bot-a")?.executionsCompleted).toBe(1);
    expect(snapshot.agents.find((entry) => entry.agentId === "bot-b")?.executionsSkipped).toBe(1);
    const hints = deriveBehaviorGrowthHints(snapshot);
    expect(hints.summary).toContain("participation rate");
    expect(snapshot.aggregateQualityScore).toBeGreaterThan(0);
  });

  it("folds ledger quality into growth hints", () => {
    const snapshot = aggregateBehaviorBufferFromLedgerRecords({
      groupId: "grp_a",
      windowFromMs: 0,
      nowMs: 2000,
      records: [
        {
          kind: "dispatch",
          roundId: "r1",
          groupId: "grp_a",
          sessionKey: "space:grp_a",
          messagePreview: "hello",
          summaryText: "round",
          participantAgentIds: ["bot-a"],
          recordedAtMs: 1000,
        },
        {
          kind: "execution",
          roundId: "r1",
          groupId: "grp_a",
          sessionKey: "space:grp_a",
          agentId: "bot-a",
          agentName: "A",
          tier: "duty",
          status: "completed",
          latencyMs: 400,
          recordedAtMs: 1100,
        },
        {
          kind: "quality",
          groupId: "grp_a",
          event: "review",
          outcome: "accepted",
          agentId: "bot-a",
          reviewVerdict: "approve",
          recordedAtMs: 1200,
        },
      ],
    });
    expect(snapshot.agents[0]?.qualityScore).toBeGreaterThan(0);
    expect(snapshot.agents[0]?.reviewsAccepted).toBe(1);
    const hints = deriveBehaviorGrowthHints(snapshot);
    expect(hints.summary).toContain("quality");
  });
});

describe("promotion policy", () => {
  it("merges charter promotion policy with defaults", () => {
    const policy = resolvePromotionPolicyFromCharter({
      lifecycleStatus: "ACTIVE",
      promotionPolicy: { allowAutoPromote: false },
    });
    expect(policy.allowAutoPromote).toBe(false);
    expect(policy.blockSecretAutoPromote).toBe(
      DEFAULT_GROUP_PROMOTION_POLICY.blockSecretAutoPromote,
    );
  });
});

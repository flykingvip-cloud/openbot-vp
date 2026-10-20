import { describe, expect, it } from "vitest";
import {
  aggregateContributionQuality,
  averageContributionQualityScore,
} from "./contribution-quality.js";
import type { CollaborationLedgerRecord } from "./types.js";

describe("aggregateContributionQuality", () => {
  it("scores completion, review, handoff, and latency from ledger facts", () => {
    const records: CollaborationLedgerRecord[] = [
      {
        kind: "execution",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-a",
        agentName: "A",
        tier: "duty",
        status: "completed",
        latencyMs: 800,
        recordedAtMs: 1100,
      },
      {
        kind: "execution",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-a",
        agentName: "A",
        tier: "duty",
        status: "failed",
        latencyMs: 1200,
        recordedAtMs: 1200,
      },
      {
        kind: "quality",
        groupId: "grp_a",
        event: "handoff",
        outcome: "completed",
        agentId: "bot-a",
        handoff: { from: "bot-a", to: "bot-b", reason: "need_specialist" },
        recordedAtMs: 1300,
      },
      {
        kind: "quality",
        groupId: "grp_a",
        event: "review",
        outcome: "accepted",
        agentId: "bot-a",
        reviewVerdict: "approve",
        recordedAtMs: 1400,
      },
    ];
    const [botA, botB] = aggregateContributionQuality(records);
    expect(botA?.agentId).toBe("bot-a");
    expect(botA?.turnsCompleted).toBe(1);
    expect(botA?.turnsFailed).toBe(1);
    expect(botA?.handoffsGiven).toBe(1);
    expect(botA?.reviewsAccepted).toBe(1);
    expect(botA?.latencyP50Ms).toBe(1000);
    expect(botA?.qualityScore).toBeGreaterThan(0);
    expect(botB?.agentId).toBe("bot-b");
    expect(botB?.handoffsReceived).toBe(1);
    expect(botB?.qualityScore).toBeGreaterThan(0);
    expect(averageContributionQualityScore([botA, botB])).toBe(0.635);
  });

  it("returns null quality when only skipped turns exist", () => {
    const [entry] = aggregateContributionQuality([
      {
        kind: "execution",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-a",
        agentName: "A",
        tier: "duty",
        status: "skipped",
        recordedAtMs: 1100,
      },
    ]);
    expect(entry?.qualityScore).toBeNull();
  });
});

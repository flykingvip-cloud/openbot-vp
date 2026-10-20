import { describe, expect, it } from "vitest";
import type { CollaborationLedgerRecord } from "../collaboration-ledger/types.js";
import {
  aggregateRcisFromLedgerRecords,
  isCollabLearningRcisAggregateEnabled,
  rcisScoresMustNotDriveAdmission,
  rcisScoresMustNotDriveGrowthDimensionSelection,
} from "./rcis-aggregate.js";

function dispatch(
  roundId: string,
  participantAgentIds: string[],
  recordedAtMs: number,
): CollaborationLedgerRecord {
  return {
    kind: "dispatch",
    roundId,
    groupId: "grp_a",
    sessionKey: "space:grp_a",
    messagePreview: "task",
    summaryText: "round",
    participantAgentIds,
    recordedAtMs,
  };
}

describe("rcis aggregate (P4c)", () => {
  it("flag defaults OFF", () => {
    expect(isCollabLearningRcisAggregateEnabled({} as never)).toBe(false);
    expect(
      isCollabLearningRcisAggregateEnabled({
        collaboration: { learning: { rcisAggregate: true } },
      } as never),
    ).toBe(true);
  });

  it("C7/R5 invariants: RCIS must not drive admission or GrowthDimension selection", () => {
    expect(rcisScoresMustNotDriveAdmission()).toBe(true);
    expect(rcisScoresMustNotDriveGrowthDimensionSelection()).toBe(true);
    const snapshot = aggregateRcisFromLedgerRecords({ groupId: "grp_a", records: [] });
    expect(snapshot.drivesAdmission).toBe(false);
    expect(snapshot.drivesGrowthDimensionSelection).toBe(false);
  });

  it("maps claim/handoff/deliverable/challenge/idle ledger facts to RCIS dimensions", () => {
    const records: CollaborationLedgerRecord[] = [
      dispatch("r1", ["bot-owner", "bot-idle", "bot-challenger"], 1000),
      {
        kind: "execution",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-owner",
        agentName: "Owner",
        tier: "duty",
        status: "completed",
        incrementalContribution: true,
        recordedAtMs: 1100,
      },
      {
        kind: "execution",
        roundId: "r1",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-challenger",
        agentName: "Challenger",
        tier: "relevance",
        status: "completed",
        contributionRole: "challenge",
        recordedAtMs: 1150,
      },
      // bot-idle invited but no execution → idleWhenInvited
      {
        kind: "quality",
        groupId: "grp_a",
        event: "handoff",
        outcome: "completed",
        handoff: { from: "bot-owner", to: "bot-challenger", reason: "need_review" },
        recordedAtMs: 1200,
      },
      {
        kind: "quality",
        groupId: "grp_a",
        event: "deliverable",
        outcome: "accepted",
        agentId: "bot-owner",
        artifacts: ["report.pdf"],
        recordedAtMs: 1300,
      },
      {
        kind: "quality",
        groupId: "grp_a",
        event: "review",
        outcome: "accepted",
        agentId: "bot-challenger",
        recordedAtMs: 1400,
      },
      {
        kind: "fact",
        type: "TaskResponsibilityChanged",
        factId: "f1",
        groupId: "grp_a",
        taskId: "t1",
        handoffId: "h1",
        key: {
          tenantId: null,
          groupId: "grp_a",
          episodeId: "ep_e1",
          beatId: "b1",
          policySnapshotId: "ps1",
          policyHash: "ph1",
          compilerRevision: "cr1",
        },
        at: 1500,
        recordedAtMs: 1500,
        fromAgentId: "human",
        toAgentId: "bot-owner",
        responsibilityRole: "owner",
        ownerBefore: "human",
        ownerAfter: "bot-owner",
      },
    ];

    const snapshot = aggregateRcisFromLedgerRecords({
      groupId: "grp_a",
      records,
      windowFromMs: 0,
      nowMs: 2000,
    });
    expect(snapshot.agents.map((a) => a.agentId)).toEqual([
      "bot-challenger",
      "bot-idle",
      "bot-owner",
    ]);

    const owner = snapshot.agents.find((a) => a.agentId === "bot-owner");
    const idle = snapshot.agents.find((a) => a.agentId === "bot-idle");
    const challenger = snapshot.agents.find((a) => a.agentId === "bot-challenger");

    expect(owner?.signals.claimsOrOwnershipTakes).toBe(1);
    expect(owner?.signals.turnsCompleted).toBe(1);
    expect(owner?.signals.deliverablesAccepted).toBe(1);
    expect(owner?.signals.handoffsGiven).toBe(1);
    expect(owner?.signals.incrementalTurns).toBe(1);
    expect(owner?.signals.artifactsShared).toBe(1);
    expect(owner?.dimensions.responsibility).toBeGreaterThan(0.5);
    expect(owner?.dimensions.contribution).toBeGreaterThan(0.5);
    expect(owner?.dimensions.innovation).toBeGreaterThan(0.5);
    expect(owner?.dimensions.sharing).toBeGreaterThan(0);
    expect(owner?.composite).toBeGreaterThan(0.5);

    expect(idle?.signals.idleWhenInvited).toBe(1);
    expect(idle?.dimensions.responsibility).toBe(0);
    expect(idle?.composite).toBe(0);

    expect(challenger?.signals.challengeTurns).toBe(1);
    expect(challenger?.signals.handoffsReceived).toBe(1);
    expect(challenger?.signals.reviewsAccepted).toBe(1);
    expect(challenger?.dimensions.innovation).toBeGreaterThan(0.5);
    expect(challenger?.dimensions.sharing).toBeGreaterThan(0);
  });

  it("penalizes pure_ack / duplicate as low innovation", () => {
    const records: CollaborationLedgerRecord[] = [
      {
        kind: "execution",
        roundId: "r2",
        groupId: "grp_a",
        sessionKey: "space:grp_a",
        agentId: "bot-echo",
        agentName: "Echo",
        tier: "relevance",
        status: "skipped",
        skipReason: "pure_ack",
        suppressedAsDuplicate: true,
        recordedAtMs: 2000,
      },
    ];
    const [echo] = aggregateRcisFromLedgerRecords({
      groupId: "grp_a",
      records,
      windowFromMs: 0,
      nowMs: 3000,
    }).agents;
    expect(echo?.signals.pureAckOrNoIncrementSkips).toBe(1);
    expect(echo?.signals.duplicateSuppressions).toBe(1);
    expect(echo?.dimensions.innovation).toBe(0);
  });

  it("returns empty agents when ledger has no in-window samples", () => {
    const snapshot = aggregateRcisFromLedgerRecords({
      groupId: "grp_a",
      records: [
        {
          kind: "execution",
          roundId: "r0",
          groupId: "grp_a",
          sessionKey: "space:grp_a",
          agentId: "bot-a",
          agentName: "A",
          tier: "duty",
          status: "completed",
          recordedAtMs: 1,
        },
      ],
      windowFromMs: 1000,
      nowMs: 2000,
    });
    expect(snapshot.agents).toEqual([]);
  });
});

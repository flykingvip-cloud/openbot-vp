import { describe, expect, it } from "vitest";
import { createInitialGrowthStatus } from "./factory.js";
import {
  buildMeshGrowthAggregateFromStatuses,
  buildMeshGrowthWorkingStyleStats,
  computeGrowthVelocity,
} from "./mesh-growth-aggregate.js";
import type { GrowthStatus } from "./types.js";
import type { WorkingStyleChangeRecord } from "./working-style-store.js";

function status(overrides: Partial<GrowthStatus>): GrowthStatus {
  return {
    ...createInitialGrowthStatus({ kind: "robot", atMs: Date.now() - 10 * 86_400_000 }),
    ...overrides,
  };
}

describe("mesh growth aggregate", () => {
  it("computes growth velocity from combined scores over days since creation", () => {
    const created = Date.now() - 5 * 86_400_000;
    const velocity = computeGrowthVelocity(
      status({
        birthAtMs: created,
        milestones: { createdAtMs: created },
        activationScore: 50,
        operationalScore: 30,
      }),
    );
    expect(velocity).toBe(16);
  });

  it("aggregates lifecycle distribution and ranking by growth velocity", () => {
    const now = Date.UTC(2026, 7, 4);
    const created = now - 10 * 86_400_000;
    const statuses = new Map<string, GrowthStatus | null>([
      [
        "fast-bot",
        status({
          birthAtMs: created,
          milestones: { createdAtMs: created },
          lifecycleState: "mission_ready",
          activationScore: 90,
          operationalScore: 80,
        }),
      ],
      [
        "slow-bot",
        status({
          birthAtMs: created,
          milestones: { createdAtMs: created },
          lifecycleState: "growing",
          activationScore: 20,
          operationalScore: null,
        }),
      ],
      ["missing-bot", null],
    ]);

    const result = buildMeshGrowthAggregateFromStatuses(
      [
        { agentId: "fast-bot", name: "Fast Bot" },
        { agentId: "slow-bot", name: "Slow Bot" },
        { agentId: "missing-bot", name: "Missing Bot" },
      ],
      statuses,
      now,
    );

    expect(result.summary.botCount).toBe(3);
    expect(result.summary.trackedCount).toBe(2);
    expect(result.summary.missionReadyCount).toBe(1);
    expect(result.summary.withOperationalScore).toBe(1);
    expect(result.summary.avgActivationScore).toBe(55);
    expect(result.lifecycleDistribution.growing).toBe(1);
    expect(result.lifecycleDistribution.mission_ready).toBe(1);
    expect(result.ranking[0]?.agentId).toBe("fast-bot");
    expect(result.ranking[0]?.rank).toBe(1);
    expect(result.ranking[1]?.agentId).toBe("slow-bot");
  });

  it("counts false-ready bots in enterprise summary", () => {
    const created = Date.now() - 3 * 86_400_000;
    const statuses = new Map<string, GrowthStatus | null>([
      [
        "false-ready",
        status({
          birthAtMs: created,
          milestones: { createdAtMs: created },
          lifecycleState: "mission_ready",
          activationScore: 95,
          operationalScore: 10,
        }),
      ],
    ]);
    const result = buildMeshGrowthAggregateFromStatuses(
      [{ agentId: "false-ready", name: "False Ready" }],
      statuses,
    );
    expect(result.summary.falseReadyCount).toBe(1);
    expect(result.ranking[0]?.falseReady).toBe(true);
  });

  it("aggregates Working DNA enterprise stats from change records", () => {
    const profiles = new Map<string, boolean>([
      ["a", true],
      ["b", false],
    ]);
    const changes = new Map<string, WorkingStyleChangeRecord | null>([
      [
        "a",
        {
          changedAtMs: 1,
          baselineOperationalScore: 50,
          appliedDelta: { decisionPreference: "autonomous" },
          assessedAtMs: 2,
          effectStatus: "improved",
          deltaScore: 5,
        },
      ],
      ["b", null],
    ]);
    const stats = buildMeshGrowthWorkingStyleStats(changes, profiles);
    expect(stats.botsWithProfile).toBe(1);
    expect(stats.botsWithRecentChange).toBe(1);
    expect(stats.effectiveness.overall.improved).toBe(1);
    expect(stats.effectiveness.overall.improvedRate).toBe(1);
  });
});

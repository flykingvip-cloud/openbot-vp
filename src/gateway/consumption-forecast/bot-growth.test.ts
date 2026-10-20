// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { BotResource } from "../billing/types.js";
import {
  assessBotQuotaRisk,
  buildDailyBotCreationSeries,
  computeBotGrowthMetrics,
  countBotsCreatedInCycle,
} from "./bot-growth.js";

function bot(createdAt: string, deleted = false): BotResource {
  return {
    id: "bot-1",
    enterpriseId: "ent-1",
    ownerUserId: "u1",
    createdAt,
    deletedAt: deleted ? "2026-06-05T00:00:00.000Z" : null,
  };
}

describe("consumption-forecast bot-growth", () => {
  it("counts bots created in cycle including deleted", () => {
    const bots = [bot("2026-06-02T10:00:00.000Z"), bot("2026-06-03T10:00:00.000Z", true)];
    expect(
      countBotsCreatedInCycle(bots, "2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
    ).toBe(2);
  });

  it("builds daily bot creation series", () => {
    const bots = [bot("2026-06-02T10:00:00.000Z"), bot("2026-06-02T12:00:00.000Z")];
    const series = buildDailyBotCreationSeries({
      bots,
      cycleStart: "2026-06-01T00:00:00.000Z",
      cycleEnd: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-06-04T00:00:00.000Z"),
    });
    expect(series).toEqual([0, 2, 0, 0]);
  });

  it("projects bot growth and assesses quota risk", () => {
    const metrics = computeBotGrowthMetrics({
      activeBots: 8,
      botsCreatedInCycle: 4,
      dailyCreationSeries: [0, 1, 1, 2],
      cycleStart: "2026-06-01T00:00:00.000Z",
      cycleEnd: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-06-05T00:00:00.000Z"),
    });
    expect(metrics.botGrowthRatePerDay).toBeGreaterThan(0);
    expect(metrics.projectedBotsAtCycleEnd).toBeGreaterThan(8);
    const risk = assessBotQuotaRisk({
      activeBots: 8,
      maxBots: 10,
      projectedBotsAtCycleEnd: metrics.projectedBotsAtCycleEnd,
    });
    expect(["low", "medium", "high"]).toContain(risk.level);
  });
});

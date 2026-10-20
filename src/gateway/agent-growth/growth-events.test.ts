import { describe, expect, it } from "vitest";
import { createInitialGrowthStatus } from "./factory.js";
import { emitGrowthEvents } from "./growth-events.js";
import type { GrowthStatus } from "./types.js";

describe("emitGrowthEvents", () => {
  it("broadcasts false_ready_detected on first crossing", () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const prev = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    prev.activationScore = 95;
    prev.operationalScore = 80;
    const next: GrowthStatus = {
      ...prev,
      operationalScore: 20,
    };
    emitGrowthEvents(
      (event, payload) => events.push({ event, payload }),
      { idKey: "agentId", id: "main" },
      prev,
      next,
    );
    expect(events.some((entry) => entry.event === "agent_growth.false_ready_detected")).toBe(true);
  });

  it("does not repeat false_ready when already false-ready", () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const prev = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    prev.activationScore = 95;
    prev.operationalScore = 15;
    const next: GrowthStatus = { ...prev, operationalScore: 10 };
    emitGrowthEvents(
      (event, payload) => events.push({ event, payload }),
      { idKey: "agentId", id: "main" },
      prev,
      next,
    );
    expect(
      events.filter((entry) => entry.event === "agent_growth.false_ready_detected"),
    ).toHaveLength(0);
  });
});

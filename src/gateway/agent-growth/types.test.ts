import { describe, expect, it } from "vitest";
import { createInitialGrowthStatus } from "./factory.js";
import type { GrowthStatus } from "./types.js";

describe("agent-growth types / factory", () => {
  it("creates a birth-state robot growth status with reserved fields", () => {
    const g = createInitialGrowthStatus({ kind: "robot", atMs: 1000 });
    expect(g.lifecycleState).toBe("birth");
    expect(g.isActivated).toBe(false);
    expect(g.activationScore).toBe(0);
    // operationalScore 序列化契约：number | null，P0A 恒 null（非 undefined）。
    expect(g.operationalScore).toBeNull();
    expect(g.templateId).toBe("generic_worker");
    expect(g.dimensions).toEqual({ identity: 0, capability: 0, knowledge: 0, habits: 0 });
    expect(g.milestones.createdAtMs).toBe(1000);
    expect("alignmentComplete" in g).toBe(false);
  });

  it("creates a group growth status with alignment fields", () => {
    const g = createInitialGrowthStatus({ kind: "group", atMs: 2000 });
    expect(g.dimensions.alignment).toBe(0);
    expect(g.alignmentComplete).toBe(false);
  });

  it("survives JSON round-trip (serialization stability)", () => {
    const g = createInitialGrowthStatus({ kind: "robot", atMs: 1000 });
    const round = JSON.parse(JSON.stringify(g)) as GrowthStatus;
    expect(round).toEqual(g);
    // null 字段必须保留（不可丢成 undefined）。
    expect(round.operationalScore).toBeNull();
  });
});

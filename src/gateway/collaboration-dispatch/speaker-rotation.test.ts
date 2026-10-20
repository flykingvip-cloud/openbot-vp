import { describe, expect, test } from "vitest";
import { pickRotatedIndex, stableRotationIndex } from "./speaker-rotation.js";

describe("speaker rotation", () => {
  test("same seed is stable", () => {
    expect(stableRotationIndex("alpha|round-1", 4)).toBe(stableRotationIndex("alpha|round-1", 4));
  });

  test("roundId rotates across bots instead of always index 0", () => {
    const indices = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      indices.add(
        pickRotatedIndex({
          groupId: "alpha",
          roundId: `round-${i}`,
          count: 3,
        }),
      );
    }
    expect(indices.size).toBeGreaterThan(1);
    expect([...indices].every((index) => index >= 0 && index < 3)).toBe(true);
  });

  test("day key seed is deterministic for a fixed clock", () => {
    const a = pickRotatedIndex({
      groupId: "alpha",
      count: 5,
      nowMs: Date.parse("2026-09-26T00:00:00Z"),
    });
    const b = pickRotatedIndex({
      groupId: "alpha",
      count: 5,
      nowMs: Date.parse("2026-09-26T23:00:00Z"),
    });
    expect(a).toBe(b);
  });
});

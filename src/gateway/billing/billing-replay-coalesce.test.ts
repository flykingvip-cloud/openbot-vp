import { describe, expect, it } from "vitest";
import {
  enterBillingReplay,
  leaveBillingReplay,
  replaySnapshot,
} from "./billing-replay-coalesce.ts";

describe("billing replay snapshot coalesce", () => {
  it("runs once per enterprise while a replay is active", async () => {
    enterBillingReplay();
    try {
      let runs = 0;
      const first = replaySnapshot("ent-1", async () => {
        runs += 1;
        return "snapshot";
      });
      const second = replaySnapshot("ent-1", async () => {
        runs += 1;
        return "other";
      });
      await expect(first).resolves.toBe("snapshot");
      await expect(second).resolves.toBe("snapshot");
      expect(runs).toBe(1);
    } finally {
      leaveBillingReplay();
    }
  });

  it("does not reuse a replay snapshot after the replay ends", async () => {
    enterBillingReplay();
    let runs = 0;
    await replaySnapshot("ent-1", async () => {
      runs += 1;
    });
    leaveBillingReplay();
    await replaySnapshot("ent-1", async () => {
      runs += 1;
    });
    expect(runs).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { resolveBlockedAgentIdsForCurrentTask } from "./state-machine.js";

describe("resolveBlockedAgentIdsForCurrentTask", () => {
  it("returns empty when no current task is bound", async () => {
    await expect(
      resolveBlockedAgentIdsForCurrentTask({ groupId: "alpha", currentTaskId: null }),
    ).resolves.toEqual([]);
    await expect(
      resolveBlockedAgentIdsForCurrentTask({ groupId: "alpha", currentTaskId: "   " }),
    ).resolves.toEqual([]);
  });
});

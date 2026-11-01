import { describe, expect, it } from "vitest";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import {
  POST_PUBLISH_CLAIM_ENTRY,
  tryClaimAfterBoardPublish,
} from "./try-claim-after-board-publish.js";

function item(patch: Partial<GroupBoardClaimItem>): GroupBoardClaimItem {
  return {
    itemId: "item-1",
    groupId: "g1",
    taskId: "t1",
    status: "published",
    remainingWork: "work",
    acceptanceCriteria: ["a"],
    intendedClaimantIds: ["bot-a"],
    publishedBy: "human:owner",
    revision: 1,
    ...patch,
  } as GroupBoardClaimItem;
}

describe("tryClaimAfterBoardPublish", () => {
  it("blocks when present actor is not an intended claimant (no auto-mint)", async () => {
    const result = await tryClaimAfterBoardPublish({
      groupId: "g1",
      taskId: "t1",
      item: item({}),
      actorId: "human:owner",
    });
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.reason).toContain("awaiting_intended_claimant");
      expect(result.nextEntryPoint).toBe(POST_PUBLISH_CLAIM_ENTRY);
      expect(result.claimantId).toBeNull();
    }
  });

  it("blocks when no actor is present", async () => {
    const result = await tryClaimAfterBoardPublish({
      groupId: "g1",
      taskId: "t1",
      item: item({ intendedClaimantIds: [] }),
      actorId: null,
    });
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.reason).toBe("claimant_actor_required");
    }
  });

  it("leaves already-claimed items unchanged without calling invent paths", async () => {
    const result = await tryClaimAfterBoardPublish({
      groupId: "g1",
      taskId: "t1",
      item: item({ status: "claimed", claimantId: "bot-a" }),
      actorId: "bot-a",
    });
    expect(result.outcome).toBe("unchanged");
    if (result.outcome === "unchanged") {
      expect(result.reason).toBe("already_claimed");
      expect(result.claimantId).toBe("bot-a");
    }
  });
});

import { describe, expect, it } from "vitest";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import {
  POST_PUBLISH_CLAIM_ENTRY,
  resolvePostPublishClaimTarget,
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

describe("resolvePostPublishClaimTarget", () => {
  it("blocks empty intended (publish ≠ publisher claim)", () => {
    const resolved = resolvePostPublishClaimTarget(item({ intendedClaimantIds: [] }));
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toBe("no_single_legal_claimant");
    }
  });

  it("blocks multiple intended without picking first", () => {
    const resolved = resolvePostPublishClaimTarget(
      item({ intendedClaimantIds: ["bot-a", "bot-b"] }),
    );
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain("ambiguous_intended_claimants");
      expect(resolved.reason).toContain("bot-a");
      expect(resolved.reason).toContain("bot-b");
    }
  });

  it("accepts a single intended claimant", () => {
    const resolved = resolvePostPublishClaimTarget(item({ intendedClaimantIds: ["bot-exec"] }));
    expect(resolved).toEqual({ ok: true, claimantId: "bot-exec" });
  });
});

describe("tryClaimAfterBoardPublish", () => {
  it("does not claim as publisher when intended is empty", async () => {
    const result = await tryClaimAfterBoardPublish({
      groupId: "g1",
      taskId: "t1",
      item: item({ intendedClaimantIds: [] }),
      actorId: "human:owner",
    });
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.reason).toBe("no_single_legal_claimant");
      expect(result.claimantId).toBeNull();
      expect(result.nextEntryPoint).toBe(POST_PUBLISH_CLAIM_ENTRY);
    }
  });

  it("blocks multiple intended without auto-picking first", async () => {
    const result = await tryClaimAfterBoardPublish({
      groupId: "g1",
      taskId: "t1",
      item: item({ intendedClaimantIds: ["bot-a", "bot-b"] }),
      actorId: "human:owner",
    });
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.reason).toContain("ambiguous_intended_claimants");
      expect(result.claimantId).toBeNull();
    }
  });

  it("blocks when intended ≠ publisher and wake authority is missing", async () => {
    const result = await tryClaimAfterBoardPublish({
      groupId: "g1",
      taskId: "t1",
      item: item({}),
      actorId: "human:owner",
    });
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.reason).toContain("awaiting_intended_claimant");
      expect(result.reason).toContain("wake_authority_required");
      expect(result.nextEntryPoint).toBe(POST_PUBLISH_CLAIM_ENTRY);
      expect(result.claimantId).toBeNull();
    }
  });

  it("leaves already-claimed items unchanged without inventing paths", async () => {
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

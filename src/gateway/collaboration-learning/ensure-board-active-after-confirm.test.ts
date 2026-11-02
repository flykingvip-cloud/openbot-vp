/**
 * Confirm → board active + claimant so post-plan advance does not early-exit.
 * Confirm stays committed when activation / advance fails.
 * Claimant must bind confirmed plan owner (not intendedClaimantIds[0]).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";

const claimMock = vi.hoisted(() => vi.fn());
const applyMock = vi.hoisted(() => vi.fn());

vi.mock("./claim-contract-entry.js", async () => {
  const actual = await vi.importActual<typeof import("./claim-contract-entry.js")>(
    "./claim-contract-entry.js",
  );
  return {
    ...actual,
    claimCollaborationBoardItem: claimMock,
    applyCollaborationBoardClaim: applyMock,
  };
});

import {
  ensureBoardActiveAfterConfirm,
  resolveExecutorClaimantId,
} from "./ensure-board-active-after-confirm.js";

function publishedItem(over?: Partial<GroupBoardClaimItem>): GroupBoardClaimItem {
  return {
    itemId: "board-1",
    groupId: "grp-1",
    taskId: "task-1",
    title: "t",
    remainingWork: "do",
    acceptanceCriteria: ["a"],
    goal: "g",
    intendedClaimantIds: ["bot"],
    publishedBy: "bot",
    publishedAt: 1,
    status: "published",
    revision: 1,
    ...over,
  } as GroupBoardClaimItem;
}

describe("resolveExecutorClaimantId", () => {
  it("binds plan owner bot:bot to intended form bot (not first arbitrary)", () => {
    const resolved = resolveExecutorClaimantId({
      item: publishedItem({ intendedClaimantIds: ["other", "bot"] }),
      planOwnerMemberId: "bot:bot",
    });
    expect(resolved).toEqual({ ok: true, claimantId: "bot" });
  });

  it("refuses when plan owner ≠ any intended (incl. first)", () => {
    const resolved = resolveExecutorClaimantId({
      item: publishedItem({ intendedClaimantIds: ["bot-a", "bot-b"] }),
      planOwnerMemberId: "bot-c",
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toMatch(/plan_owner_not_in_intended/);
    }
  });

  it("refuses without plan owner (no blind intended[0])", () => {
    const resolved = resolveExecutorClaimantId({
      item: publishedItem(),
      planOwnerMemberId: "",
    });
    expect(resolved).toEqual({ ok: false, reason: "plan_owner_required" });
  });

  it("refuses when existing claimant ≠ plan owner", () => {
    const resolved = resolveExecutorClaimantId({
      item: publishedItem({ claimantId: "bot-other", status: "claimed" }),
      planOwnerMemberId: "bot",
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toMatch(/claimant_plan_owner_mismatch/);
    }
  });
});

describe("ensureBoardActiveAfterConfirm", () => {
  beforeEach(() => {
    claimMock.mockReset();
    applyMock.mockReset();
  });

  it("published + authorizer≠plan owner → refuse proxy-claim (awaiting_executor_self_claim)", async () => {
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item: publishedItem(),
      planOwnerMemberId: "bot:bot",
      authorizingActorId: "human:owner",
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(result.activated).toBe(false);
    expect(result.item.status).toBe("published");
    expect(result.item.claimantId).toBeUndefined();
    expect(result.reason).toMatch(/awaiting_executor_self_claim/);
    expect(result.executorId).toBe("bot");
    expect(result.authorizingActorId).toBe("human:owner");
  });

  it("published + missing authorizingActorId → authorizing_actor_required (no claimant backfill)", async () => {
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item: publishedItem(),
      planOwnerMemberId: "bot:bot",
      // intentionally omit authorizingActorId
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(result.activated).toBe(false);
    expect(result.reason).toBe("authorizing_actor_required");
    expect(result.item.status).toBe("published");
    expect(result.item.claimantId).toBeUndefined();
    expect(result.executorId).toBe("bot");
  });

  it("published + authorizer IS plan owner → self-claim then apply (distinct audit fields)", async () => {
    claimMock.mockResolvedValueOnce({
      ...publishedItem(),
      status: "claimed",
      claimantId: "bot",
      claimedAt: 2,
      revision: 2,
    });
    applyMock.mockResolvedValueOnce({
      task: { taskId: "task-1" },
      item: {
        ...publishedItem(),
        status: "applied",
        claimantId: "bot",
        claimedAt: 2,
        appliedAt: 3,
        revision: 3,
      },
    });
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item: publishedItem(),
      planOwnerMemberId: "bot:bot",
      authorizingActorId: "bot:bot",
    });
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(claimMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        claimantId: "bot",
        actor: "bot:bot", // trusted authorizingActorId — never claimantId backfill
      }),
    );
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        actor: "bot:bot",
      }),
    );
    expect(result.activated).toBe(true);
    expect(result.item.status).toBe("applied");
    expect(result.item.claimantId).toBe("bot");
    expect(result.reason).toBe("claimed_and_applied");
    expect(result.executorId).toBe("bot");
    expect(result.authorizingActorId).toBe("bot:bot");
  });

  it("multi intended + owner≠first + authorizer≠owner → refuse proxy, no intended[0]", async () => {
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item: publishedItem({ intendedClaimantIds: ["bot-a", "bot-exec"] }),
      planOwnerMemberId: "bot-exec",
      authorizingActorId: "human:owner",
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(result.activated).toBe(false);
    expect(result.reason).toMatch(/awaiting_executor_self_claim/);
    expect(result.executorId).toBe("bot-exec");
  });

  it("multi intended + owner not in list → refuse, no claim (board unchanged)", async () => {
    const item = publishedItem({ intendedClaimantIds: ["bot-a", "bot-b"] });
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item,
      planOwnerMemberId: "bot-c",
      authorizingActorId: "human:owner",
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(result.activated).toBe(false);
    expect(result.item.status).toBe("published");
    expect(result.reason).toMatch(/plan_owner_not_in_intended/);
  });

  it("already applied + claimant → no-op", async () => {
    const item = publishedItem({
      status: "applied",
      claimantId: "bot",
      appliedAt: 3,
    });
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item,
      planOwnerMemberId: "bot:bot",
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(result.activated).toBe(false);
    expect(result.reason).toBe("already_active");
  });

  it("concurrent claim failure does not throw (confirm must stay committed; board unchanged)", async () => {
    claimMock.mockRejectedValueOnce(new Error("claim_denied"));
    const item = publishedItem();
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item,
      planOwnerMemberId: "bot",
      authorizingActorId: "bot",
    });
    expect(result.activated).toBe(false);
    expect(result.item.status).toBe("published");
    expect(result.item.claimantId).toBeUndefined();
    expect(result.reason).toMatch(/activate_failed:claim_denied/);
  });

  it("missing planOwner → refuse without claim", async () => {
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item: publishedItem(),
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(result.activated).toBe(false);
    expect(result.reason).toBe("plan_owner_required");
  });
});

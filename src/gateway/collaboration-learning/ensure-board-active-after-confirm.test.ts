/**
 * Confirm → board active + claimant so post-plan advance does not early-exit.
 * Confirm stays committed when activation / advance fails.
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

import { ensureBoardActiveAfterConfirm } from "./ensure-board-active-after-confirm.js";

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

describe("ensureBoardActiveAfterConfirm", () => {
  beforeEach(() => {
    claimMock.mockReset();
    applyMock.mockReset();
  });

  it("published + intended → claim then apply (active + claimantId)", async () => {
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
    });
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(result.activated).toBe(true);
    expect(result.item.status).toBe("applied");
    expect(result.item.claimantId).toBe("bot");
    expect(result.reason).toBe("claimed_and_applied");
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
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(result.activated).toBe(false);
    expect(result.reason).toBe("already_active");
  });

  it("claim/apply failure does not throw (confirm must stay committed)", async () => {
    claimMock.mockRejectedValueOnce(new Error("claim_denied"));
    const item = publishedItem();
    const result = await ensureBoardActiveAfterConfirm({
      groupId: "grp-1",
      taskId: "task-1",
      item,
    });
    expect(result.activated).toBe(false);
    expect(result.item.status).toBe("published");
    expect(result.reason).toMatch(/activate_failed:claim_denied/);
  });
});

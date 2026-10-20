import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupBoardClaimItem } from "./claim-contract.js";
import {
  isContinueAfterRoundCompleteEnabled,
  planContinueAfterRound,
  resolveContinueAfterRoundGroupAllowlist,
} from "./continue-after-round.js";

function item(
  partial: Partial<GroupBoardClaimItem> & Pick<GroupBoardClaimItem, "itemId" | "status">,
): GroupBoardClaimItem {
  return {
    groupId: "grp_any",
    taskId: "task_1",
    title: "t",
    remainingWork: "rw",
    acceptanceCriteria: ["a"],
    intendedClaimantIds: [],
    publishedBy: "pub",
    publishedAt: 1,
    ...partial,
  };
}

describe("continue-after-round platform", () => {
  it("defaults disabled without allowlist or enabled", () => {
    const cfg = { collaboration: { task: {} } } as OpenBotConfig;
    expect(isContinueAfterRoundCompleteEnabled(cfg, "grp_a", "001")).toBe(false);
    expect(resolveContinueAfterRoundGroupAllowlist(cfg)).toEqual([]);
  });

  it("enables via scoped allowlist only (group-agnostic)", () => {
    const cfg = {
      collaboration: {
        task: {
          continueAfterRoundComplete: {
            groupAllowlist: ["001/grp_alpha", "002/grp_beta"],
          },
        },
      },
    } as OpenBotConfig;
    expect(isContinueAfterRoundCompleteEnabled(cfg, "grp_alpha", "001")).toBe(true);
    expect(isContinueAfterRoundCompleteEnabled(cfg, "grp_alpha", "002")).toBe(false);
    expect(isContinueAfterRoundCompleteEnabled(cfg, "grp_beta", "002")).toBe(true);
    expect(isContinueAfterRoundCompleteEnabled(cfg, "grp_other", "001")).toBe(false);
  });

  it("bare allowlist never authorizes tenant-scoped caller", () => {
    const cfg = {
      collaboration: {
        task: {
          continueAfterRoundComplete: { groupAllowlist: ["grp_bare"] },
        },
      },
    } as OpenBotConfig;
    expect(isContinueAfterRoundCompleteEnabled(cfg, "grp_bare", "001")).toBe(false);
    expect(isContinueAfterRoundCompleteEnabled(cfg, "grp_bare", null)).toBe(true);
  });

  it("plans inventory-first: empty board → no_active_board_inventory", () => {
    const plan = planContinueAfterRound({
      enabled: true,
      boardItems: [item({ itemId: "x", status: "accepted" })],
    });
    expect(plan.reason).toBe("no_active_board_inventory");
    expect(plan.activeItems).toHaveLength(0);
  });

  it("plans inventory-first: prefers in_progress over older applied", () => {
    const plan = planContinueAfterRound({
      enabled: true,
      boardItems: [
        item({
          itemId: "old_smoke",
          status: "applied",
          appliedAt: 100,
          claimantId: "bot:smoke",
        }),
        item({
          itemId: "real_work",
          status: "in_progress",
          inProgressAt: 50,
          claimantId: "bot:real",
        }),
      ],
    });
    expect(plan.reason).toBe("active_board_inventory");
    expect(plan.primary?.itemId).toBe("real_work");
    expect(plan.leadAgentId).toBe("bot:real");
  });

  it("disabled plan short-circuits", () => {
    const plan = planContinueAfterRound({
      enabled: false,
      boardItems: [item({ itemId: "a", status: "applied", claimantId: "b" })],
    });
    expect(plan.reason).toBe("continue_after_round_disabled");
  });
  it("plans inventory-first: published counts as active (unclaimed lead work)", () => {
    const plan = planContinueAfterRound({
      enabled: true,
      boardItems: [
        item({
          itemId: "fresh_pub",
          status: "published",
          publishedAt: 200,
          intendedClaimantIds: ["bot:exec"],
        }),
        item({ itemId: "done", status: "accepted", publishedAt: 999 }),
      ],
    });
    expect(plan.reason).toBe("active_board_inventory");
    expect(plan.primary?.itemId).toBe("fresh_pub");
    expect(plan.leadAgentId).toBe("bot:exec");
    expect(plan.activeItems).toHaveLength(1);
  });

  it("plans inventory-first: terminal accepted|cancelled|blocked excluded", () => {
    const plan = planContinueAfterRound({
      enabled: true,
      boardItems: [
        item({ itemId: "a", status: "accepted" }),
        item({ itemId: "c", status: "cancelled" }),
        item({ itemId: "b", status: "blocked" }),
        item({ itemId: "s", status: "submitted_for_review", claimantId: "x" }),
      ],
    });
    expect(plan.reason).toBe("no_active_board_inventory");
    expect(plan.activeItems).toHaveLength(0);
  });

  it("plans inventory-first: prefers in_progress over published", () => {
    const plan = planContinueAfterRound({
      enabled: true,
      boardItems: [
        item({
          itemId: "pub",
          status: "published",
          publishedAt: 500,
          intendedClaimantIds: ["bot:new"],
        }),
        item({
          itemId: "prog",
          status: "in_progress",
          inProgressAt: 10,
          claimantId: "bot:prog",
        }),
      ],
    });
    expect(plan.primary?.itemId).toBe("prog");
    expect(plan.leadAgentId).toBe("bot:prog");
  });
});

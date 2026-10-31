import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  resumeIncompleteBoardsAfterGatewayRestart,
  scheduleResumeIncompleteBoardsAfterGatewayRestart,
} from "./resume-incomplete-board-after-restart.js";

function item(
  partial: Partial<GroupBoardClaimItem> & Pick<GroupBoardClaimItem, "itemId" | "status">,
): GroupBoardClaimItem {
  return {
    groupId: "grp-night",
    taskId: "task-m2",
    title: "milestone",
    remainingWork: "write chapter",
    acceptanceCriteria: ["pdf"],
    intendedClaimantIds: ["bot--lead"],
    publishedBy: "cli",
    publishedAt: 1,
    ...partial,
  };
}

function fakeAuthority(groupId: string, tenantId: string | null = null): RuntimeAuthority {
  return {
    groupId,
    tenantId,
    tenantTrust: tenantId ? "actor_fallback" : "none",
    episodeId: `ep:${groupId}`,
    namespace: { root: `/tmp/ns/${groupId}` },
  } as unknown as RuntimeAuthority;
}

describe("resumeIncompleteBoardsAfterGatewayRestart", () => {
  it("force-schedules next incomplete board milestone (binding-fail style idle)", async () => {
    const continueRound = vi.fn(async () => ({
      skipped: false,
      decision: {
        at: 1,
        groupId: "grp-night",
        tenantId: null,
        roundId: "restart-resume:grp-night:1",
        enabled: true,
        reason: "active_board_inventory",
        activeBoardCount: 1,
        primaryBoardItemId: "item-m2",
        leadAgentId: "bot--lead",
        wakeRecorded: true,
        selfAdvanceTriggered: false,
      },
    }));

    const result = await resumeIncompleteBoardsAfterGatewayRestart({
      cfg: { collaboration: { task: {} } } as OpenBotConfig,
      deps: {
        listGroupIds: async () => ["grp-night", "grp-idle"],
        buildAuthority: async ({ groupId }) => ({ authority: fakeAuthority(groupId) }),
        loadBoardItems: async (authority) => {
          if (authority.groupId === "grp-night") {
            return [
              item({
                itemId: "item-m2",
                status: "published",
                groupId: "grp-night",
                intendedClaimantIds: ["bot--lead"],
              }),
            ];
          }
          return [item({ itemId: "done", status: "accepted", groupId: "grp-idle" })];
        },
        continueRound,
        nowMs: () => 1_700_000_000_000,
      },
    });

    expect(result.scanned).toBe(2);
    expect(result.resumed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(continueRound).toHaveBeenCalledTimes(1);
    expect(continueRound).toHaveBeenCalledWith(
      expect.objectContaining({
        roundId: "restart-resume:grp-night:1700000000000",
      }),
    );
    const night = result.groups.find((g) => g.groupId === "grp-night");
    expect(night?.wakeRecorded).toBe(true);
    expect(night?.primaryBoardItemId).toBe("item-m2");
    const idle = result.groups.find((g) => g.groupId === "grp-idle");
    expect(idle?.skipped).toBe(true);
    expect(idle?.reason).toBe("no_active_board_inventory");
  });

  it("does not call continue when board inventory is empty (no blind mid-LLM redo)", async () => {
    const continueRound = vi.fn();
    const result = await resumeIncompleteBoardsAfterGatewayRestart({
      cfg: {} as OpenBotConfig,
      deps: {
        listGroupIds: async () => ["grp-empty"],
        buildAuthority: async ({ groupId }) => ({ authority: fakeAuthority(groupId) }),
        loadBoardItems: async () => [],
        continueRound,
      },
    });
    expect(result.resumed).toBe(0);
    expect(continueRound).not.toHaveBeenCalled();
  });

  it("caps groups scanned and swallows per-group errors", async () => {
    const result = await resumeIncompleteBoardsAfterGatewayRestart({
      cfg: {} as OpenBotConfig,
      deps: {
        maxGroups: 2,
        listGroupIds: async () => ["a", "b", "c"],
        buildAuthority: async ({ groupId }) => {
          if (groupId === "b") {
            throw new Error("boom");
          }
          return { authority: fakeAuthority(groupId) };
        },
        loadBoardItems: async () => [],
        continueRound: async () => {
          throw new Error("should not run");
        },
      },
    });
    expect(result.scanned).toBe(2);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.find((g) => g.groupId === "b")?.reason).toMatch(/^group_error:/);
  });

  it("scheduleResumeIncompleteBoardsAfterGatewayRestart never throws", () => {
    expect(() =>
      scheduleResumeIncompleteBoardsAfterGatewayRestart({
        cfg: {} as OpenBotConfig,
        deps: {
          listGroupIds: async () => {
            throw new Error("list fail");
          },
        },
      }),
    ).not.toThrow();
  });
});

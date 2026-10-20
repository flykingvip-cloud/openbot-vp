// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GatewayCollaborationOperatingPhase } from "../collaboration-learning/operating-state-types.js";
import type {
  GatewayCollaborationSpaceSnapshot,
  GatewayCollaborationSpacesListResult,
} from "../collaboration-learning/snapshot-types.js";
import { buildWorkbenchUpcomingCollaboration } from "./upcoming-collaboration-read-model.js";

function space(opts: {
  groupId: string;
  title?: string;
  phase?: GatewayCollaborationOperatingPhase;
  waitingForHuman?: boolean;
  lifecycleStatus?: string;
  humans?: Array<{ userId: string; status?: string }>;
  summary?: string;
  updatedAtMs?: number;
  noOperatingState?: boolean;
}): GatewayCollaborationSpaceSnapshot {
  const operatingState = opts.noOperatingState
    ? null
    : {
        groupId: opts.groupId,
        groupProfile: { lifecycleStatus: opts.lifecycleStatus ?? "active" },
        activeContext: {
          currentOperatingPhase: opts.phase ?? "explore",
          waitingForHuman: opts.waitingForHuman ?? false,
          summary: opts.summary ?? "",
          updatedAtMs: opts.updatedAtMs ?? 0,
        },
      };
  return {
    id: `space:${opts.groupId}`,
    groupId: opts.groupId,
    title: opts.title ?? opts.groupId,
    members: {
      humans: (opts.humans ?? []).map((human) => ({
        userId: human.userId,
        status: human.status ?? "active",
      })),
      bots: [],
    },
    invites: { humans: [], bots: [] },
    operatingState: operatingState as GatewayCollaborationSpaceSnapshot["operatingState"],
  } as GatewayCollaborationSpaceSnapshot;
}

function listDeps(spaces: GatewayCollaborationSpaceSnapshot[]) {
  return {
    listSpaces: async (): Promise<GatewayCollaborationSpacesListResult> => ({ spaces }),
  };
}

describe("workbench upcoming-collaboration read model", () => {
  it("returns zero for an actor with no spaces", async () => {
    const result = await buildWorkbenchUpcomingCollaboration({
      userId: "user-1",
      seatSpaceIds: [],
      deps: listDeps([space({ groupId: "space-x", waitingForHuman: true, humans: [] })]),
    });
    expect(result).toEqual({
      needsResponseCount: 0,
      decisionCount: 0,
      reviewCount: 0,
      activeCount: 0,
      items: [],
    });
  });

  it("counts waiting spaces in the actor's seat scope and categorizes by phase", async () => {
    const result = await buildWorkbenchUpcomingCollaboration({
      userId: "user-1",
      seatSpaceIds: ["space-a", "space-b", "space-c"],
      deps: listDeps([
        space({ groupId: "space-a", phase: "decide", waitingForHuman: true, updatedAtMs: 100 }),
        space({ groupId: "space-b", phase: "review", waitingForHuman: true, updatedAtMs: 200 }),
        space({ groupId: "space-c", phase: "deliver", waitingForHuman: true, updatedAtMs: 300 }),
      ]),
    });
    expect(result.needsResponseCount).toBe(3);
    expect(result.decisionCount).toBe(1);
    expect(result.reviewCount).toBe(1);
    expect(result.activeCount).toBe(0);
    // Ordered decision > review > response.
    expect(result.items.map((item) => item.id)).toEqual(["space-a", "space-b", "space-c"]);
    expect(result.items.map((item) => item.kind)).toEqual(["decision", "review", "response"]);
  });

  it("includes spaces where the actor is an active human member (not just seat-granted)", async () => {
    const result = await buildWorkbenchUpcomingCollaboration({
      userId: "user-1",
      userEmail: "u1@example.com",
      seatSpaceIds: [],
      deps: listDeps([
        space({
          groupId: "space-member",
          phase: "decide",
          waitingForHuman: true,
          humans: [{ userId: "u1@example.com" }],
        }),
      ]),
    });
    expect(result.needsResponseCount).toBe(1);
    expect(result.items[0]?.id).toBe("space-member");
  });

  it("counts active (not-waiting) spaces separately and excludes them from items", async () => {
    const result = await buildWorkbenchUpcomingCollaboration({
      userId: "user-1",
      seatSpaceIds: ["space-a", "space-b"],
      deps: listDeps([
        space({ groupId: "space-a", phase: "explore", waitingForHuman: false }),
        space({ groupId: "space-b", phase: "decide", waitingForHuman: true }),
      ]),
    });
    expect(result.needsResponseCount).toBe(1);
    expect(result.activeCount).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["space-b"]);
  });

  it("skips archived spaces and spaces without operating state", async () => {
    const result = await buildWorkbenchUpcomingCollaboration({
      userId: "user-1",
      seatSpaceIds: ["space-archived", "space-no-state"],
      deps: listDeps([
        space({
          groupId: "space-archived",
          phase: "decide",
          waitingForHuman: true,
          lifecycleStatus: "archived",
        }),
        space({ groupId: "space-no-state", noOperatingState: true }),
      ]),
    });
    expect(result.needsResponseCount).toBe(0);
    expect(result.activeCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("does not surface spaces the actor is not in (no cross-space leak)", async () => {
    const result = await buildWorkbenchUpcomingCollaboration({
      userId: "user-1",
      userEmail: "u1@example.com",
      seatSpaceIds: ["space-mine"],
      deps: listDeps([
        space({ groupId: "space-mine", phase: "review", waitingForHuman: true }),
        // actor is neither seat-granted nor a member here:
        space({
          groupId: "space-others",
          phase: "decide",
          waitingForHuman: true,
          humans: [{ userId: "someone-else@example.com" }],
        }),
      ]),
    });
    expect(result.needsResponseCount).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["space-mine"]);
  });
});

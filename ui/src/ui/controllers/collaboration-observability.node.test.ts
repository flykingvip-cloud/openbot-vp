import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  type CollaborationObservabilityState,
  loadCollaborationObservabilitySnapshot,
  resetCollaborationObservabilitySnapshot,
} from "./collaboration-observability.ts";

function createState() {
  const request = vi.fn().mockImplementation(async (method: string) => {
    if (method === "collaboration.task.whoWokeWhom") {
      return {
        events: [
          {
            wakeId: "wake_1",
            groupId: "grp_product",
            fromAgentId: "bot-a",
            toAgentIds: ["bot-b"],
            source: "assistant_inline_at",
            outcome: "dispatched",
            at: 100,
          },
        ],
        timeline: [
          {
            from: "bot-a",
            to: "bot-b",
            source: "assistant_inline_at",
            outcome: "dispatched",
            at: 100,
            wakeId: "wake_1",
          },
        ],
      };
    }
    if (method === "collaboration.task.listBoardItems") {
      return {
        items: [
          {
            itemId: "item-1",
            groupId: "grp_product",
            taskId: "task-1",
            title: "Board item",
            status: "claimed",
            claimantId: "bot-b",
          },
        ],
      };
    }
    if (method === "collaboration.task.listPeerReviews") {
      return {
        reviews: [
          {
            reviewId: "pr-1",
            groupId: "grp_product",
            taskId: "task-1",
            itemId: "item-1",
            submissionId: "sub-1",
            reviewerId: "bot-c",
            authorId: "bot-b",
            verdict: "approve",
            at: 200,
          },
        ],
      };
    }
    if (method === "collaboration.task.getMemberProgress") {
      return {
        progress: {
          itemCount: 1,
          memberCount: 1,
          members: [
            {
              memberId: "bot-b",
              itemId: "item-1",
              taskId: "task-1",
              title: "Board item",
              status: "claimed",
              isSubmitted: false,
              isActiveWork: true,
            },
          ],
          unclaimed: [],
          gaps: [],
        },
      };
    }
    throw new Error(`unexpected method ${method}`);
  });
  const state: CollaborationObservabilityState = {
    client: { request } as unknown as GatewayBrowserClient,
    connected: true,
    sessionKey: "space:product",
    workbenchTeamSelectedKey: "space:product",
    workbenchTaskDetailId: "task-1",
    sessionsResult: {
      ts: 1,
      path: "/tmp/sessions.json",
      count: 1,
      defaults: { model: null, contextTokens: null },
      sessions: [
        {
          key: "space:product",
          kind: "group",
          updatedAt: 1,
          groupId: "grp_product",
          collaborationParticipationOverlay: {
            participationId: "grp_product::bot-main",
            botId: "bot-main",
            groupId: "grp_product",
            overlayCapabilities: [],
          },
        },
      ],
    },
    collaborationObservabilityLoading: false,
    collaborationObservabilityError: null,
    collaborationObservabilitySnapshot: null,
    collaborationObservabilityRequestKey: null,
  };
  return { state, request };
}

describe("collaboration observability controller", () => {
  it("loads whoWokeWhom plus claim/peer when taskId is in scope", async () => {
    const { state, request } = createState();
    await loadCollaborationObservabilitySnapshot(state);

    expect(request).toHaveBeenCalledWith("collaboration.task.whoWokeWhom", {
      groupId: "grp_product",
      taskId: "task-1",
    });
    expect(request).toHaveBeenCalledWith("collaboration.task.listBoardItems", {
      groupId: "grp_product",
      taskId: "task-1",
    });
    expect(request).toHaveBeenCalledWith("collaboration.task.listPeerReviews", {
      groupId: "grp_product",
      taskId: "task-1",
    });
    expect(state.collaborationObservabilitySnapshot?.timeline[0]).toMatchObject({
      from: "bot-a",
      to: "bot-b",
      outcome: "dispatched",
    });
    expect(state.collaborationObservabilitySnapshot?.boardItems).toHaveLength(1);
    expect(state.collaborationObservabilitySnapshot?.peerReviews[0]?.verdict).toBe("approve");
  });

  it("loads wake-only when no taskId is available", async () => {
    const { state, request } = createState();
    state.workbenchTaskDetailId = null;
    await loadCollaborationObservabilitySnapshot(state, { force: true, taskId: null });

    expect(request).toHaveBeenCalledWith("collaboration.task.whoWokeWhom", {
      groupId: "grp_product",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(state.collaborationObservabilitySnapshot?.taskId).toBeNull();
    expect(state.collaborationObservabilitySnapshot?.boardItems).toEqual([]);
  });

  it("resets observability state", () => {
    const { state } = createState();
    state.collaborationObservabilityLoading = true;
    state.collaborationObservabilitySnapshot = {
      groupId: "grp_product",
      taskId: null,
      events: [],
      timeline: [],
      boardItems: [],
      peerReviews: [],
      memberProgress: null,
    };
    resetCollaborationObservabilitySnapshot(state);
    expect(state.collaborationObservabilityLoading).toBe(false);
    expect(state.collaborationObservabilitySnapshot).toBeNull();
  });
});

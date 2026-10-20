import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  type CollaborationLearningState,
  loadCollaborationLearningSnapshot,
  resetCollaborationLearningSnapshot,
} from "./collaboration-learning.ts";

function createState() {
  const request = vi.fn().mockResolvedValue({
    groupId: "grp_product",
    botId: "bot-main",
    groupCapabilities: null,
    participations: [],
    participationOverlays: [],
    capsules: [],
    projections: [],
    assets: [],
    tasks: [],
    deliverables: [],
    reviews: [],
    decisions: [],
  });
  const state: CollaborationLearningState = {
    client: {
      request,
    } as unknown as GatewayBrowserClient,
    connected: true,
    sessionKey: "space:product",
    workbenchTeamSelectedKey: "space:product",
    sessionsResult: {
      ts: 1,
      path: "/tmp/sessions.json",
      count: 1,
      defaults: {
        model: null,
        contextTokens: null,
      },
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
    collaborationLearningLoading: false,
    collaborationLearningError: null,
    collaborationLearningSnapshot: null,
    collaborationLearningRequestKey: null,
  };
  return { state, request };
}

describe("collaboration learning controller", () => {
  it("loads persisted collaboration learning objects for the active session scope", async () => {
    const { state, request } = createState();

    await loadCollaborationLearningSnapshot(state);

    expect(request).toHaveBeenCalledWith("collaboration.learning.snapshot", {
      groupId: "grp_product",
      botId: "bot-main",
    });
    expect(state.collaborationLearningSnapshot).toMatchObject({
      groupId: "grp_product",
      botId: "bot-main",
    });
  });

  it("resets persisted collaboration learning state", () => {
    const { state } = createState();
    state.collaborationLearningLoading = true;
    state.collaborationLearningError = "boom";
    state.collaborationLearningSnapshot = {
      groupId: "grp_product",
      groupCapabilities: null,
      participations: [],
      participationOverlays: [],
      capsules: [],
      projections: [],
      assets: [],
      tasks: [],
      deliverables: [],
      reviews: [],
      decisions: [],
    };
    state.collaborationLearningRequestKey = "grp_product::bot-main";

    resetCollaborationLearningSnapshot(state);

    expect(state.collaborationLearningLoading).toBe(false);
    expect(state.collaborationLearningError).toBeNull();
    expect(state.collaborationLearningSnapshot).toBeNull();
    expect(state.collaborationLearningRequestKey).toBeNull();
  });

  it("falls back to matching scoped collaboration sessions when the active key is a space alias", async () => {
    const { state, request } = createState();
    state.sessionKey = "space:space-product";
    state.workbenchTeamSelectedKey = "space:space-product";
    state.sessionsResult = {
      ts: 1,
      path: "/tmp/sessions.json",
      count: 2,
      defaults: {
        model: null,
        contextTokens: null,
      },
      sessions: [
        {
          key: "space:space-product",
          kind: "group",
          updatedAt: 1,
        },
        {
          key: "agent:bot-main:main:space:space-product",
          kind: "group",
          updatedAt: 2,
          groupId: "space-product",
          collaborationParticipationOverlay: {
            participationId: "space-product::bot-main",
            botId: "bot-main",
            groupId: "space-product",
            overlayCapabilities: [],
          },
        },
      ],
    };
    await loadCollaborationLearningSnapshot(state);

    expect(request).toHaveBeenCalledWith("collaboration.learning.snapshot", {
      groupId: "space-product",
      botId: "bot-main",
    });
  });
});

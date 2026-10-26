import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  type CollaborationGovernanceActionState,
  resetCollaborationGovernanceActionState,
  saveCollaborationDecisionDraft,
  transitionCollaborationGovernanceObject,
} from "./collaboration-governance-actions.ts";

function createState() {
  const request = vi.fn().mockResolvedValue({ ok: true });
  const state: CollaborationGovernanceActionState = {
    client: {
      request,
    } as unknown as GatewayBrowserClient,
    connected: true,
    sessionKey: "space:product",
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
    collaborationGovernanceActionBusyKey: null,
    collaborationGovernanceActionError: null,
    workbenchDecisionSelectedOptionDraft: null,
    workbenchDecisionRationaleDraft: null,
    workbenchDecisionOptionsDraft: null,
  };
  return { state, request };
}

describe("collaboration governance actions controller", () => {
  it("dispatches task transitions and reloads collaboration learning snapshot", async () => {
    const { state, request } = createState();

    await transitionCollaborationGovernanceObject(state, {
      kind: "task",
      id: "task-1",
      toStatus: "review",
    });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.task.transition", {
      groupId: "grp_product",
      taskId: "task-1",
      toStatus: "review",
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.learning.snapshot", {
      groupId: "grp_product",
      botId: "bot-main",
    });
  });

  it("dispatches proposeHandoff for an explicit task handoff (T09-B1)", async () => {
    const { state, request } = createState();

    await transitionCollaborationGovernanceObject(state, {
      kind: "task",
      id: "task-1",
      toStatus: "ready",
      handoff: {
        from: "bot-main",
        to: "bot-reviewer",
        reason: "need_specialist",
        remainingWork: "Finish the rollout checklist",
        acceptanceCriteria: ["checklist reviewed"],
        completedArtifacts: ["notes.md"],
      },
    });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.task.proposeHandoff", {
      groupId: "grp_product",
      taskId: "task-1",
      from: "bot-main",
      to: "bot-reviewer",
      remainingWork: "Finish the rollout checklist",
      acceptanceCriteria: ["checklist reviewed"],
      kind: "continue",
      completedArtifacts: ["notes.md"],
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.learning.snapshot", {
      groupId: "grp_product",
      botId: "bot-main",
    });
  });

  it("captures gateway errors while clearing the busy key", async () => {
    const { state } = createState();
    state.client = {
      request: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as GatewayBrowserClient;

    await transitionCollaborationGovernanceObject(state, {
      kind: "decision",
      id: "decision-1",
      toStatus: "finalized",
      selectedOption: "adopt",
    });

    expect(state.collaborationGovernanceActionBusyKey).toBeNull();
    expect(state.collaborationGovernanceActionError).toContain("boom");
  });

  it("resets action state", () => {
    const { state } = createState();
    state.collaborationGovernanceActionBusyKey = "task:task-1:review";
    state.collaborationGovernanceActionError = "boom";

    resetCollaborationGovernanceActionState(state);

    expect(state.collaborationGovernanceActionBusyKey).toBeNull();
    expect(state.collaborationGovernanceActionError).toBeNull();
  });

  it("saves draft decisions and clears local draft state after reload", async () => {
    const { state, request } = createState();
    state.workbenchDecisionSelectedOptionDraft = "gradual";
    state.workbenchDecisionRationaleDraft = "Ship gradually first";
    state.workbenchDecisionOptionsDraft = [
      { optionId: "gradual", title: "Gradual rollout" },
      { optionId: "fast-track", title: "Fast track" },
    ];

    await saveCollaborationDecisionDraft(state, {
      id: "decision-2",
      rationale: "Ship gradually first",
      selectedOption: "gradual",
      options: [
        { optionId: "gradual", title: "Gradual rollout" },
        { optionId: "fast-track", title: "Fast track" },
      ],
    });

    expect(request).toHaveBeenNthCalledWith(1, "collaboration.decision.updateDraft", {
      groupId: "grp_product",
      decisionId: "decision-2",
      rationale: "Ship gradually first",
      selectedOption: "gradual",
      options: [
        { optionId: "gradual", title: "Gradual rollout" },
        { optionId: "fast-track", title: "Fast track" },
      ],
    });
    expect(request).toHaveBeenNthCalledWith(2, "collaboration.learning.snapshot", {
      groupId: "grp_product",
      botId: "bot-main",
    });
    expect(state.workbenchDecisionSelectedOptionDraft).toBeNull();
    expect(state.workbenchDecisionRationaleDraft).toBeNull();
    expect(state.workbenchDecisionOptionsDraft).toBeNull();
  });
});

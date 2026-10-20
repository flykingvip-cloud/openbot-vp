import { describe, expect, it, vi } from "vitest";
import { isSideEffectingDeliveryTool } from "../../gateway/collaboration-dispatch/delivery-tool-side-effect.js";
import { ClaimContractEntryError } from "../../gateway/collaboration-learning/claim-contract-entry.js";
import { resolveCoreToolCapability } from "../tool-catalog.js";
import {
  COLLABORATION_BOARD_TOOL,
  createCollaborationBoardTool,
  shouldExposeCollaborationBoardTool,
} from "./collaboration-board-tool.js";

const GROUP = "grp-daniel-hhd-gmail-com-upbeyond";
const TASK = "task-probe-1";
const ITEM = "item-probe-1";
const SESSION = `agent:bot-2:main:space:${GROUP}`;

function detailsOf(result: { details?: unknown }) {
  return result.details as Record<string, unknown>;
}

describe("shouldExposeCollaborationBoardTool", () => {
  it("hides the tool when claim contract / allowlist miss", () => {
    expect(
      shouldExposeCollaborationBoardTool({
        agentSessionKey: SESSION,
        agentGroupId: GROUP,
        isEnabled: () => false,
      }),
    ).toBe(false);
  });

  it("exposes the tool when allowlist (or global flag) hits", () => {
    expect(
      shouldExposeCollaborationBoardTool({
        agentSessionKey: SESSION,
        agentGroupId: GROUP,
        isEnabled: () => true,
      }),
    ).toBe(true);
  });

  it("hides the tool outside a collaboration space session", () => {
    expect(
      shouldExposeCollaborationBoardTool({
        agentSessionKey: "agent:bot-2:main",
        isEnabled: () => true,
      }),
    ).toBe(false);
  });

  it("exposes when sessionEnterpriseId is a UUID (maps to null → personal_local allowlist)", () => {
    expect(
      shouldExposeCollaborationBoardTool({
        agentSessionKey: SESSION,
        agentGroupId: GROUP,
        tenantId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        isEnabled: (_cfg, groupId, tenantId) =>
          groupId === GROUP &&
          (tenantId === null || tenantId === undefined || tenantId === "personal_local"),
      }),
    ).toBe(true);
  });

  it("exposes from org: session key when agentGroupId is absent", () => {
    expect(
      shouldExposeCollaborationBoardTool({
        agentSessionKey: `agent:bot-2:org:${GROUP}`,
        isEnabled: (_cfg, groupId) => groupId === GROUP,
      }),
    ).toBe(true);
  });
});

describe("collaboration_board tool", () => {
  it("registers under the collaboration_board name", () => {
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      deps: { isEnabled: () => true },
    });
    expect(tool.name).toBe(COLLABORATION_BOARD_TOOL);
  });

  it("refuses writes when flag/allowlist is off (defense in depth)", async () => {
    const markInProgress = vi.fn();
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => false,
        markInProgress,
        resolveActor: async () => "bot-2",
      },
    });
    const result = detailsOf(
      await tool.execute("t1", {
        action: "mark_in_progress",
        taskId: TASK,
        itemId: ITEM,
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "flag_off", groupId: GROUP });
    expect(markInProgress).not.toHaveBeenCalled();
  });

  it("refuses non-claimant mark_in_progress", async () => {
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-2",
        markInProgress: async () => {
          throw new ClaimContractEntryError(
            "not_claimant",
            "markBoardItemInProgress: actor is not the current claimant",
          );
        },
      },
    });
    const result = detailsOf(
      await tool.execute("t2", {
        action: "mark_in_progress",
        taskId: TASK,
        itemId: ITEM,
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "not_claimant" });
  });

  it("refuses empty submissionSummary before calling submit", async () => {
    const submitForReview = vi.fn();
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-2",
        submitForReview,
      },
    });
    const result = detailsOf(
      await tool.execute("t3", {
        action: "submit_for_review",
        taskId: TASK,
        itemId: ITEM,
        submissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        artifactVersion: "v1",
        submissionSummary: "   ",
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "empty_submission" });
    expect(submitForReview).not.toHaveBeenCalled();
  });

  it("mark_in_progress success path calls entry with resolved actor", async () => {
    const item = {
      itemId: ITEM,
      taskId: TASK,
      groupId: GROUP,
      status: "in_progress",
      claimantId: "bot-2",
    };
    const markInProgress = vi.fn(async () => item);
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-2",
        markInProgress,
      },
    });
    const result = detailsOf(
      await tool.execute("t4", {
        action: "mark_in_progress",
        taskId: TASK,
        itemId: ITEM,
      }),
    );
    expect(result).toMatchObject({ ok: true, action: "mark_in_progress", item });
    expect(markInProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: GROUP,
        taskId: TASK,
        itemId: ITEM,
        actor: "bot:bot-2",
      }),
    );
  });

  it("submit_for_review success path forwards S3 fields", async () => {
    const item = {
      itemId: ITEM,
      taskId: TASK,
      groupId: GROUP,
      status: "submitted_for_review",
      claimantId: "bot-2",
      submissionId: "942755ff-d18e-40aa-8252-8c399069d675",
      artifactVersion: "v20261019",
    };
    const submitForReview = vi.fn(async () => item);
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-2",
        submitForReview,
      },
    });
    const result = detailsOf(
      await tool.execute("t5", {
        action: "submit_for_review",
        taskId: TASK,
        itemId: ITEM,
        submissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        artifactVersion: "v20261019",
        submissionSummary: "材料包已合成，请主答验收",
      }),
    );
    expect(result).toMatchObject({ ok: true, action: "submit_for_review", item });
    expect(submitForReview).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        artifactVersion: "v20261019",
        submissionSummary: "材料包已合成，请主答验收",
        actor: "bot:bot-2",
      }),
    );
  });

  it("propose_todolist success path", async () => {
    const todolist = {
      todolistId: "tl-1",
      boardItemId: ITEM,
      taskId: TASK,
      ownerMemberId: "bot:bot-2",
      status: "proposed",
      steps: [{ stepId: "s1", title: "赛道摸底" }],
    };
    const proposeTodolist = vi.fn(async () => todolist);
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-2",
        proposeTodolist,
      },
    });
    const result = detailsOf(
      await tool.execute("t6", {
        action: "propose_todolist",
        taskId: TASK,
        boardItemId: ITEM,
        steps: [{ title: "赛道摸底", detail: "带来源" }],
      }),
    );
    expect(result).toMatchObject({ ok: true, action: "propose_todolist", todolist });
    expect(proposeTodolist).toHaveBeenCalledWith(
      expect.objectContaining({
        boardItemId: ITEM,
        ownerMemberId: "bot:bot-2",
        actor: "bot:bot-2",
        steps: [{ title: "赛道摸底", detail: "带来源", stepId: undefined }],
      }),
    );
  });

  it("list_items read path works when enabled", async () => {
    const listItems = vi.fn(async () => [{ itemId: ITEM, status: "applied" }]);
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-2",
        listItems,
      },
    });
    const result = detailsOf(
      await tool.execute("t7", {
        action: "list_items",
        taskId: TASK,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      action: "list_items",
      items: [{ itemId: ITEM, status: "applied" }],
    });
  });

  it("accept_submission success path forwards S3 acceptance fields", async () => {
    const item = {
      itemId: ITEM,
      taskId: TASK,
      groupId: GROUP,
      status: "accepted",
      claimantId: "bot-2",
      acceptedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
      acceptedArtifactVersion: "v20261019",
    };
    const acceptSubmission = vi.fn(async () => item);
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-secretary",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-secretary",
        acceptSubmission,
      },
    });
    const result = detailsOf(
      await tool.execute("t9", {
        action: "accept_submission",
        taskId: TASK,
        itemId: ITEM,
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        reason: "meets acceptance",
        checkedAcceptanceCriteria: ["sources", "shared"],
        proxyForActorId: "human-ceo",
        proxyBasis: "群主代理",
      }),
    );
    expect(result).toMatchObject({ ok: true, action: "accept_submission", item });
    expect(acceptSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        reason: "meets acceptance",
        checkedAcceptanceCriteria: ["sources", "shared"],
        proxyForActorId: "human-ceo",
        proxyBasis: "群主代理",
        actor: "bot:bot-secretary",
      }),
    );
  });

  it("accept_submission refuses missing reason before calling entry", async () => {
    const acceptSubmission = vi.fn();
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-secretary",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-secretary",
        acceptSubmission,
      },
    });
    const result = detailsOf(
      await tool.execute("t10", {
        action: "accept_submission",
        taskId: TASK,
        itemId: ITEM,
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        reason: "   ",
        checkedAcceptanceCriteria: ["sources"],
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(acceptSubmission).not.toHaveBeenCalled();
  });

  it("accept_submission refuses missing expectedSubmissionId", async () => {
    const acceptSubmission = vi.fn();
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-secretary",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-secretary",
        acceptSubmission,
      },
    });
    const result = detailsOf(
      await tool.execute("t11", {
        action: "accept_submission",
        taskId: TASK,
        itemId: ITEM,
        reason: "ok",
        checkedAcceptanceCriteria: ["sources"],
      }),
    );
    expect(result.ok).toBe(false);
    expect(acceptSubmission).not.toHaveBeenCalled();
  });

  it("return_submission success path forwards reason + expectedSubmissionId", async () => {
    const item = {
      itemId: ITEM,
      taskId: TASK,
      groupId: GROUP,
      status: "returned",
      claimantId: "bot-2",
      returnReason: "need more sources",
    };
    const returnSubmission = vi.fn(async () => item);
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-secretary",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-secretary",
        returnSubmission,
      },
    });
    const result = detailsOf(
      await tool.execute("t12", {
        action: "return_submission",
        taskId: TASK,
        itemId: ITEM,
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        reason: "need more sources",
      }),
    );
    expect(result).toMatchObject({ ok: true, action: "return_submission", item });
    expect(returnSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        reason: "need more sources",
        actor: "bot:bot-secretary",
      }),
    );
  });

  it("return_submission refuses missing reason before calling entry", async () => {
    const returnSubmission = vi.fn();
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-secretary",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-secretary",
        returnSubmission,
      },
    });
    const result = detailsOf(
      await tool.execute("t13", {
        action: "return_submission",
        taskId: TASK,
        itemId: ITEM,
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(returnSubmission).not.toHaveBeenCalled();
  });

  it("return_submission refuses missing expectedSubmissionId", async () => {
    const returnSubmission = vi.fn();
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-secretary",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-secretary",
        returnSubmission,
      },
    });
    const result = detailsOf(
      await tool.execute("t14", {
        action: "return_submission",
        taskId: TASK,
        itemId: ITEM,
        reason: "revise",
      }),
    );
    expect(result.ok).toBe(false);
    expect(returnSubmission).not.toHaveBeenCalled();
  });

  it("rejects groupId that does not match the session space", async () => {
    const tool = createCollaborationBoardTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: SESSION,
      agentGroupId: GROUP,
      deps: {
        isEnabled: () => true,
        resolveActor: async () => "bot-2",
        markInProgress: vi.fn(),
      },
    });
    const result = detailsOf(
      await tool.execute("t8", {
        action: "mark_in_progress",
        groupId: "grp-other",
        taskId: TASK,
        itemId: ITEM,
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "group_mismatch" });
  });
});

describe("collaboration_board catalog side-effect", () => {
  it("is catalogued as a reversible write so delivery fingerprints apply", () => {
    expect(resolveCoreToolCapability(COLLABORATION_BOARD_TOOL)).toEqual({
      toolMode: "write",
      sideEffectLevel: "reversible",
    });
    expect(isSideEffectingDeliveryTool(COLLABORATION_BOARD_TOOL)).toBe(true);
  });
});

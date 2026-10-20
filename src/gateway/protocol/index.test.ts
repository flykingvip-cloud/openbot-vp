import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
import {
  validateCollaborationSpaceMembersUpdateParams,
  validateCollaborationSpaceResetParams,
  validateCollaborationSpacesListParams,
  validateCollaborationDecisionDraftUpdateParams,
  validateCollaborationDecisionTransitionParams,
  validateCollaborationDeliverableTransitionParams,
  validateDaibaiAskResult,
  formatValidationErrors,
  validateCollaborationLearningSnapshotParams,
  validateCollaborationReviewTransitionParams,
  validateCollaborationTaskHandoffParams,
  validateCollaborationTaskTransitionParams,
  validateSpacesListParams,
  validateSpacesMembersUpdateParams,
  validateSpacesResetParams,
  validateTalkConfigResult,
} from "./index.js";

const makeError = (overrides: Partial<ErrorObject>): ErrorObject => ({
  keyword: "type",
  instancePath: "",
  schemaPath: "#/",
  params: {},
  message: "validation error",
  ...overrides,
});

describe("formatValidationErrors", () => {
  it("returns unknown validation error when missing errors", () => {
    expect(formatValidationErrors(undefined)).toBe("unknown validation error");
    expect(formatValidationErrors(null)).toBe("unknown validation error");
  });

  it("returns unknown validation error when errors list is empty", () => {
    expect(formatValidationErrors([])).toBe("unknown validation error");
  });

  it("formats additionalProperties at root", () => {
    const err = makeError({
      keyword: "additionalProperties",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at root: unexpected property 'token'");
  });

  it("formats additionalProperties with instancePath", () => {
    const err = makeError({
      keyword: "additionalProperties",
      instancePath: "/auth",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at /auth: unexpected property 'token'");
  });

  it("formats message with path for other errors", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err])).toBe("at /auth: must have required property 'token'");
  });

  it("de-dupes repeated entries", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err, err])).toBe(
      "at /auth: must have required property 'token'",
    );
  });
});

describe("validateTalkConfigResult", () => {
  it("accepts Talk SecretRef payloads", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            resolved: {
              provider: "elevenlabs",
              config: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            apiKey: {
              source: "env",
              provider: "default",
              id: "ELEVENLABS_API_KEY",
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects normalized talk payloads without talk.resolved", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                voiceId: "voice-normalized",
              },
            },
          },
        },
      }),
    ).toBe(false);
  });
});

describe("validateCollaborationLearningSnapshotParams", () => {
  it("accepts group-scoped collaboration learning snapshot params", () => {
    expect(
      validateCollaborationLearningSnapshotParams({
        groupId: "grp_product",
        botId: "bot-main",
      }),
    ).toBe(true);
  });

  it("rejects unexpected properties on collaboration learning snapshot params", () => {
    expect(
      validateCollaborationLearningSnapshotParams({
        groupId: "grp_product",
        extra: true,
      }),
    ).toBe(false);
  });
});

describe("spaces validators", () => {
  it("accepts empty collaboration.spaces.list params", () => {
    expect(validateCollaborationSpacesListParams({})).toBe(true);
    expect(validateSpacesListParams({})).toBe(true);
  });

  it("accepts collaboration.spaces.list scope self or tenant", () => {
    expect(validateCollaborationSpacesListParams({ scope: "self" })).toBe(true);
    expect(validateCollaborationSpacesListParams({ scope: "tenant" })).toBe(true);
    expect(validateCollaborationSpacesListParams({ scope: "other" })).toBe(false);
  });

  it("accepts members update payloads", () => {
    expect(
      validateCollaborationSpaceMembersUpdateParams({
        groupId: "grp_product",
        title: "Aegis",
        avatar: "🛰️",
        visibilityScope: "tenant",
        purpose: "战略研究与咨询",
        currentMission: "建立群定位与初始化机制",
        coordinatorBotId: "bot-aegis",
        collaborationMode: "discussion_driven",
        successCriteria: ["成员清楚群定位", "后来者可恢复上下文"],
        systemInstructions: ["新成员先自我介绍", "关键信息必须沉淀为群记忆"],
        confidentialityTier: "internal",
        finalDecisionPolicy: {
          mode: "human_required",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
        members: {
          humans: [{ userId: "user-1", name: "UPBEYOND" }],
          bots: [{ agentId: "bot-aegis", name: "大白管家" }],
        },
        invites: {
          humans: [{ userId: "user-2", name: "Alice", handle: "@alice" }],
        },
      }),
    ).toBe(true);
    expect(
      validateSpacesMembersUpdateParams({
        groupId: "grp_product",
        title: "Aegis",
        avatar: "🛰️",
        visibilityScope: "tenant",
        purpose: "战略研究与咨询",
        currentMission: "建立群定位与初始化机制",
        coordinatorBotId: "bot-aegis",
        collaborationMode: "discussion_driven",
        successCriteria: ["成员清楚群定位", "后来者可恢复上下文"],
        systemInstructions: ["新成员先自我介绍", "关键信息必须沉淀为群记忆"],
        confidentialityTier: "internal",
        finalDecisionPolicy: {
          mode: "human_required",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
        members: {
          humans: [{ userId: "user-1", name: "UPBEYOND" }],
          bots: [{ agentId: "bot-aegis", name: "大白管家" }],
        },
        invites: {
          humans: [{ userId: "user-2", name: "Alice", handle: "@alice" }],
        },
      }),
    ).toBe(true);
  });

  it("rejects malformed members update payloads", () => {
    expect(
      validateCollaborationSpaceMembersUpdateParams({
        groupId: "grp_product",
        members: {
          humans: [{ name: "missing-id" }],
        },
      }),
    ).toBe(false);
    expect(
      validateSpacesMembersUpdateParams({
        groupId: "grp_product",
        members: {
          humans: [{ name: "missing-id" }],
        },
      }),
    ).toBe(false);
  });

  it("accepts collaboration space reset payloads", () => {
    expect(
      validateCollaborationSpaceResetParams({
        groupId: "grp_product",
      }),
    ).toBe(true);
    expect(
      validateSpacesResetParams({
        groupId: "grp_product",
      }),
    ).toBe(true);
  });

  it("rejects malformed collaboration space reset payloads", () => {
    expect(
      validateCollaborationSpaceResetParams({
        groupId: "",
      }),
    ).toBe(false);
    expect(
      validateSpacesResetParams({
        extra: true,
      }),
    ).toBe(false);
  });
});

describe("validateDaibaiAskResult", () => {
  it("accepts ask results with latestProposal", () => {
    expect(
      validateDaibaiAskResult({
        summary: "我已找到 1 条与你相关的支持单。",
        rationale: "当前建议基于你的问题内容和现有支持单状态生成。",
        supportContext: {
          openCaseCount: 1,
          waitingOnUserCount: 1,
          latestCase: {
            caseId: "sc_1",
            category: "unknown",
            status: "waiting_user",
            userProblem: "创建 skill 时 schema 不清楚",
            userId: "user-1",
            updatedAtMs: 1,
            currentProposalVersion: 2,
            proposalSeenByUserVersion: 2,
          },
          cases: [
            {
              caseId: "sc_1",
              category: "unknown",
              status: "waiting_user",
              userProblem: "创建 skill 时 schema 不清楚",
              userId: "user-1",
              updatedAtMs: 1,
              currentProposalVersion: 2,
              proposalSeenByUserVersion: 2,
            },
          ],
        },
        latestProposal: {
          caseId: "sc_1",
          proposalVersion: 2,
          userFacingReply: "请先补充触发词和 schema 示例。",
          recommendedActionId: "support.case.apply_resolution",
          requiresUserConfirmation: true,
          seenByUser: true,
        },
        suggestedActions: [
          {
            actionId: "support.case.apply_resolution",
            label: "执行解决方案",
            description: "按平台专家给出的当前方案继续处理并完成收口。",
            payload: { caseId: "sc_1" },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects malformed latestProposal payloads", () => {
    expect(
      validateDaibaiAskResult({
        summary: "我已找到 1 条与你相关的支持单。",
        latestProposal: {
          caseId: "sc_1",
          proposalVersion: 0,
          userFacingReply: "",
          requiresUserConfirmation: true,
          seenByUser: false,
        },
        suggestedActions: [],
      }),
    ).toBe(false);
  });
});

describe("collaboration transition param validators", () => {
  it("accepts task transition params", () => {
    expect(
      validateCollaborationTaskTransitionParams({
        groupId: "grp_product",
        taskId: "task-1",
        toStatus: "review",
      }),
    ).toBe(true);
  });

  it("accepts task handoff params and rejects empty acceptance criteria", () => {
    expect(
      validateCollaborationTaskHandoffParams({
        groupId: "grp_product",
        taskId: "task-2",
        from: "bot-a",
        to: "bot-b",
        reason: "need_specialist",
        remainingWork: "Finish the checklist",
        acceptanceCriteria: ["checklist reviewed"],
      }),
    ).toBe(true);
    expect(
      validateCollaborationTaskHandoffParams({
        groupId: "grp_product",
        taskId: "task-2",
        from: "bot-a",
        to: "bot-b",
        reason: "need_specialist",
        remainingWork: "Finish the checklist",
        acceptanceCriteria: [],
      }),
    ).toBe(false);
  });

  it("rejects unexpected fields on deliverable transition params", () => {
    expect(
      validateCollaborationDeliverableTransitionParams({
        groupId: "grp_product",
        deliverableId: "deliverable-1",
        toStatus: "approved",
        extra: true,
      }),
    ).toBe(false);
  });

  it("accepts review transition params", () => {
    expect(
      validateCollaborationReviewTransitionParams({
        groupId: "grp_product",
        reviewId: "review-1",
        toStatus: "resolved",
      }),
    ).toBe(true);
  });

  it("accepts decision transition params with selectedOption", () => {
    expect(
      validateCollaborationDecisionTransitionParams({
        groupId: "grp_product",
        decisionId: "decision-1",
        toStatus: "finalized",
        selectedOption: "adopt",
      }),
    ).toBe(true);
  });

  it("accepts decision draft update params", () => {
    expect(
      validateCollaborationDecisionDraftUpdateParams({
        groupId: "grp_product",
        decisionId: "decision-2",
        rationale: "Ship gradually first",
        selectedOption: "gradual",
        options: [
          { optionId: "gradual", title: "Gradual rollout" },
          { optionId: "fast-track", title: "Fast track" },
        ],
      }),
    ).toBe(true);
  });

  it("rejects unexpected fields on decision draft update params", () => {
    expect(
      validateCollaborationDecisionDraftUpdateParams({
        groupId: "grp_product",
        decisionId: "decision-2",
        rationale: "Ship gradually first",
        extra: true,
      }),
    ).toBe(false);
  });
});

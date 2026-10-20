import { Type } from "@sinclair/typebox";
import {
  SUPPORT_CASE_CATEGORY_VALUES,
  SUPPORT_CASE_STATUS_VALUES,
} from "../../../shared/daibai-types.js";
import { NonEmptyString } from "./primitives.js";

const SupportCaseCategorySchema = Type.String({ enum: [...SUPPORT_CASE_CATEGORY_VALUES] });
const SupportCaseStatusSchema = Type.String({ enum: [...SUPPORT_CASE_STATUS_VALUES] });

export const SupportCaseRelatedEntitiesSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    blueprintId: Type.Optional(Type.String()),
    spaceId: Type.Optional(Type.String()),
    onboardingStep: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SupportCaseContextBundleSchema = Type.Object(
  {
    userMessage: NonEmptyString,
    sourceSessionKey: Type.Optional(Type.String()),
    onboardingSummary: Type.Optional(
      Type.Object(
        {
          currentStep: Type.Optional(Type.String()),
          nextStep: Type.Optional(Type.String()),
          hasExperiencedValue: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    recentPlanSummary: Type.Optional(Type.String()),
    recentExecutionSummary: Type.Optional(Type.String()),
    blueprintSummary: Type.Optional(
      Type.Object(
        {
          blueprintId: Type.Optional(Type.String()),
          version: Type.Optional(Type.String()),
          status: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    errorEvidence: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const SupportCaseResolutionProposalSchema = Type.Object(
  {
    proposalVersion: Type.Integer({ minimum: 1 }),
    userFacingReply: NonEmptyString,
    recommendedActionId: Type.Optional(Type.String()),
    executePayload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    requiresUserConfirmation: Type.Boolean(),
    updatedAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SupportCaseSchema = Type.Object(
  {
    caseId: NonEmptyString,
    userId: NonEmptyString,
    tenantId: Type.Optional(Type.String()),
    sourceSessionKey: Type.Optional(Type.String()),
    category: SupportCaseCategorySchema,
    status: SupportCaseStatusSchema,
    userProblem: NonEmptyString,
    daibaiSummary: NonEmptyString,
    contextBundle: SupportCaseContextBundleSchema,
    relatedEntities: Type.Optional(SupportCaseRelatedEntitiesSchema),
    platformAssignee: Type.Optional(Type.String()),
    platformNotes: Type.Optional(Type.String()),
    resolutionProposal: Type.Optional(SupportCaseResolutionProposalSchema),
    currentProposalVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    proposalSeenByUserVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    createdAtMs: Type.Integer({ minimum: 0 }),
    updatedAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SupportCaseSummarySchema = Type.Object(
  {
    caseId: NonEmptyString,
    category: SupportCaseCategorySchema,
    status: SupportCaseStatusSchema,
    userProblem: NonEmptyString,
    userId: NonEmptyString,
    tenantId: Type.Optional(Type.String()),
    updatedAtMs: Type.Integer({ minimum: 0 }),
    currentProposalVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    proposalSeenByUserVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const SupportCasesCreateParamsSchema = Type.Object(
  {
    userId: NonEmptyString,
    tenantId: Type.Optional(Type.String()),
    sourceSessionKey: Type.Optional(Type.String()),
    category: Type.Optional(SupportCaseCategorySchema),
    userProblem: NonEmptyString,
    daibaiSummary: Type.Optional(Type.String()),
    relatedEntities: Type.Optional(SupportCaseRelatedEntitiesSchema),
    contextBundle: SupportCaseContextBundleSchema,
  },
  { additionalProperties: false },
);

export const SupportCasesListParamsSchema = Type.Object(
  {
    userId: Type.Optional(Type.String()),
    tenantId: Type.Optional(Type.String()),
    status: Type.Optional(SupportCaseStatusSchema),
  },
  { additionalProperties: false },
);

export const SupportCasesGetParamsSchema = Type.Object(
  {
    caseId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SupportCasesResolveParamsSchema = Type.Object(
  {
    caseId: NonEmptyString,
    platformAssignee: Type.Optional(Type.String()),
    platformNotes: Type.Optional(Type.String()),
    proposal: SupportCaseResolutionProposalSchema,
  },
  { additionalProperties: false },
);

export const SupportCasesCloseParamsSchema = Type.Object(
  {
    caseId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DaibaiSuggestedActionSchema = Type.Object(
  {
    actionId: NonEmptyString,
    label: NonEmptyString,
    description: NonEmptyString,
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

export const DaibaiEscalationDraftSchema = Type.Object(
  {
    category: Type.Optional(SupportCaseCategorySchema),
    contextBundle: SupportCaseContextBundleSchema,
  },
  { additionalProperties: false },
);

export const DaibaiRouteResultSchema = Type.Object(
  {
    tier: Type.String({ enum: ["self_serve", "assisted_action", "escalate"] }),
    domain: Type.Optional(Type.String()),
    readPayload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    suggestedActions: Type.Array(DaibaiSuggestedActionSchema),
    escalationDraft: Type.Optional(DaibaiEscalationDraftSchema),
  },
  { additionalProperties: false },
);

export const DaibaiSupportContextSchema = Type.Object(
  {
    openCaseCount: Type.Integer({ minimum: 0 }),
    waitingOnUserCount: Type.Integer({ minimum: 0 }),
    latestCase: Type.Optional(Type.Union([SupportCaseSummarySchema, Type.Null()])),
    cases: Type.Array(SupportCaseSummarySchema),
  },
  { additionalProperties: false },
);

export const DaibaiLatestProposalSchema = Type.Object(
  {
    caseId: NonEmptyString,
    proposalVersion: Type.Integer({ minimum: 1 }),
    userFacingReply: NonEmptyString,
    recommendedActionId: Type.Optional(Type.String()),
    requiresUserConfirmation: Type.Boolean(),
    seenByUser: Type.Boolean(),
  },
  { additionalProperties: false },
);

const DaibaiWorkspaceCurrentSpaceSummarySchema = Type.Object(
  {
    groupId: NonEmptyString,
    title: NonEmptyString,
    memberCount: Type.Integer({ minimum: 0 }),
    humanCount: Type.Integer({ minimum: 0 }),
    botCount: Type.Integer({ minimum: 0 }),
    humans: Type.Array(Type.String()),
    bots: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

const DaibaiWorkspaceOverviewSchema = Type.Object(
  {
    visibleRobotCount: Type.Integer({ minimum: 0 }),
    visibleSpaceCount: Type.Integer({ minimum: 0 }),
    currentSpace: Type.Optional(DaibaiWorkspaceCurrentSpaceSummarySchema),
  },
  { additionalProperties: false },
);

const DaibaiGuideCapabilityItemSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    summary: NonEmptyString,
  },
  { additionalProperties: false },
);

const DaibaiGuideRecommendationSchema = Type.Object(
  {
    capabilityId: NonEmptyString,
    name: NonEmptyString,
    reason: NonEmptyString,
  },
  { additionalProperties: false },
);

const DaibaiGuideSnapshotSchema = Type.Object(
  {
    headline: NonEmptyString,
    availableNow: Type.Array(DaibaiGuideCapabilityItemSchema),
    recommendations: Type.Array(DaibaiGuideRecommendationSchema),
    nextSteps: Type.Array(Type.String()),
    stewardActions: Type.Array(
      Type.Object(
        {
          actionId: NonEmptyString,
          title: NonEmptyString,
          kind: Type.String({ enum: ["read", "write"] }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const DaibaiAskResultSchema = Type.Object(
  {
    summary: NonEmptyString,
    rationale: Type.Optional(Type.String()),
    supportContext: Type.Optional(DaibaiSupportContextSchema),
    latestProposal: Type.Optional(DaibaiLatestProposalSchema),
    workspaceOverview: Type.Optional(DaibaiWorkspaceOverviewSchema),
    suggestedActions: Type.Array(DaibaiSuggestedActionSchema),
    route: Type.Optional(DaibaiRouteResultSchema),
    guide: Type.Optional(DaibaiGuideSnapshotSchema),
    presentation: Type.Optional(Type.String({ enum: ["onboarding", "default"] })),
  },
  { additionalProperties: false },
);

export const DaibaiAskParamsSchema = Type.Object(
  {
    userId: NonEmptyString,
    tenantId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    sourceSessionKey: Type.Optional(Type.String()),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DaibaiExecuteParamsSchema = Type.Object(
  {
    userId: NonEmptyString,
    tenantId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    actionId: NonEmptyString,
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    // 决策 G：二次确认执行时回带的票据字段。
    proposalId: Type.Optional(Type.String()),
    confirmationToken: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const DaibaiConfirmationEnvelopeSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    confirmationToken: NonEmptyString,
    payloadHash: NonEmptyString,
    expiresAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const DaibaiConfirmationDetailSchema = Type.Object(
  {
    title: NonEmptyString,
    impact: Type.Optional(Type.String()),
    secondaryPermission: Type.Optional(Type.String()),
    irreversible: Type.Boolean(),
    expiresAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const DaibaiExecuteResultSchema = Type.Object(
  {
    actionId: NonEmptyString,
    status: Type.String({ enum: ["executed", "blocked", "pending_confirmation"] }),
    message: NonEmptyString,
    caseId: Type.Optional(Type.String()),
    supportCase: Type.Optional(SupportCaseSchema),
    confirmation: Type.Optional(DaibaiConfirmationEnvelopeSchema),
    confirmationDetail: Type.Optional(DaibaiConfirmationDetailSchema),
    escalationDraft: Type.Optional(DaibaiEscalationDraftSchema),
  },
  { additionalProperties: false },
);

import type {
  DecisionStatus,
  DeliverableStatus,
  ReviewStatus,
  TaskStatus,
} from "@openbot/collaboration-core";
import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const TaskStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("ready"),
  Type.Literal("in_progress"),
  Type.Literal("blocked"),
  Type.Literal("review"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
]);

const DeliverableStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("submitted"),
  Type.Literal("in_review"),
  Type.Literal("approved"),
  Type.Literal("published"),
  Type.Literal("superseded"),
  Type.Literal("archived"),
]);

const ReviewStatusSchema = Type.Union([
  Type.Literal("requested"),
  Type.Literal("submitted"),
  Type.Literal("acknowledged"),
  Type.Literal("resolved"),
]);

const DecisionStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("finalized"),
  Type.Literal("superseded"),
]);

export const CollaborationLearningSnapshotParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    botId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationSpacesListParams = {
  /** Personal workbench default. `"tenant"` is enterprise mesh / 机巢 only. */
  scope?: "self" | "tenant";
};

export const CollaborationSpacesListParamsSchema = Type.Object(
  {
    scope: Type.Optional(Type.Union([Type.Literal("self"), Type.Literal("tenant")])),
  },
  { additionalProperties: false },
);

export type CollaborationOrgBotDirectoryListParams = Record<string, never>;

export const CollaborationOrgBotDirectoryListParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export type CollaborationSpaceMembersUpdateParams = {
  groupId: string;
  title?: string;
  avatar?: string;
  visibilityScope?: string;
  tenantId?: string;
  ownerPositionId?: string;
  ownerPositionLabel?: string;
  ownerUserLabel?: string;
  purpose?: string;
  currentMission?: string;
  coordinatorBotId?: string;
  collaborationMode?: string;
  workspacePath?: string;
  successCriteria?: string[];
  systemInstructions?: string[];
  confidentialityTier?: string;
  finalDecisionPolicy?: {
    mode?: string;
    defaultFinalDeciderRole?: string;
    allowAgentPublishProposal?: boolean;
  };
  members: {
    humans?: Array<{
      userId: string;
      name?: string;
      handle?: string;
    }>;
    bots?: Array<{
      agentId: string;
      name?: string;
    }>;
  };
  invites?: {
    humans?: Array<{
      userId: string;
      name?: string;
      handle?: string;
    }>;
    bots?: Array<{
      agentId: string;
      name?: string;
    }>;
  };
};

export type SpacesListParams = CollaborationSpacesListParams;
export type SpacesMembersUpdateParams = CollaborationSpaceMembersUpdateParams;
export type CollaborationSpaceResetParams = {
  groupId: string;
};
export type CollaborationSpaceDissolveParams = {
  groupId: string;
};
export type SpacesResetParams = CollaborationSpaceResetParams;

const SpaceHumanMemberInputSchema = Type.Object(
  {
    userId: NonEmptyString,
    name: Type.Optional(Type.String()),
    handle: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const SpaceBotMemberInputSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const SpaceMemberRosterInputSchema = Type.Object(
  {
    humans: Type.Optional(Type.Array(SpaceHumanMemberInputSchema)),
    bots: Type.Optional(Type.Array(SpaceBotMemberInputSchema)),
  },
  { additionalProperties: false },
);

const SpaceFinalDecisionPolicyInputSchema = Type.Object(
  {
    mode: Type.Optional(Type.String()),
    defaultFinalDeciderRole: Type.Optional(Type.String()),
    allowAgentPublishProposal: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const CollaborationSpaceMembersUpdateParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    title: Type.Optional(Type.String()),
    avatar: Type.Optional(Type.String()),
    visibilityScope: Type.Optional(Type.String()),
    tenantId: Type.Optional(Type.String()),
    ownerPositionId: Type.Optional(Type.String()),
    ownerPositionLabel: Type.Optional(Type.String()),
    ownerUserLabel: Type.Optional(Type.String()),
    actorEmployeeUserId: Type.Optional(Type.String()),
    purpose: Type.Optional(Type.String()),
    currentMission: Type.Optional(Type.String()),
    coordinatorBotId: Type.Optional(Type.String()),
    collaborationMode: Type.Optional(Type.String()),
    workspacePath: Type.Optional(Type.String()),
    successCriteria: Type.Optional(Type.Array(NonEmptyString)),
    systemInstructions: Type.Optional(Type.Array(NonEmptyString)),
    confidentialityTier: Type.Optional(Type.String()),
    finalDecisionPolicy: Type.Optional(SpaceFinalDecisionPolicyInputSchema),
    members: SpaceMemberRosterInputSchema,
    invites: Type.Optional(SpaceMemberRosterInputSchema),
  },
  { additionalProperties: false },
);

export const CollaborationSpaceResetParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CollaborationSpaceDissolveParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CollaborationSpaceLeaveParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CollaborationSpaceMissionAdvanceParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationSpaceMissionAdvanceParams = {
  groupId: string;
};

export type CollaborationSpaceLeaveParams = {
  groupId: string;
};

export const CollaborationSpaceOwnershipTransferParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    newOwnerUserId: NonEmptyString,
    newOwnerLabel: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type CollaborationSpaceOwnershipTransferParams = {
  groupId: string;
  newOwnerUserId: string;
  newOwnerLabel?: string;
};

export const SpacesListParamsSchema = CollaborationSpacesListParamsSchema;
export const SpacesMembersUpdateParamsSchema = CollaborationSpaceMembersUpdateParamsSchema;
export const SpacesResetParamsSchema = CollaborationSpaceResetParamsSchema;

export type CollaborationTaskTransitionParams = {
  groupId: string;
  taskId: string;
  toStatus: TaskStatus;
};

export const CollaborationTaskTransitionParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    toStatus: TaskStatusSchema,
  },
  { additionalProperties: false },
);

export type CollaborationTaskHandoffParams = {
  groupId: string;
  taskId: string;
  from: string;
  to: string;
  reason: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  completedArtifacts?: string[];
  assumptions?: string[];
  blockers?: string[];
};

export const CollaborationTaskHandoffParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    from: NonEmptyString,
    to: NonEmptyString,
    reason: NonEmptyString,
    remainingWork: NonEmptyString,
    acceptanceCriteria: Type.Array(NonEmptyString, { minItems: 1 }),
    completedArtifacts: Type.Optional(Type.Array(NonEmptyString)),
    assumptions: Type.Optional(Type.Array(NonEmptyString)),
    blockers: Type.Optional(Type.Array(NonEmptyString)),
  },
  { additionalProperties: false },
);

const HandoffKindSchema = Type.Union([
  Type.Literal("continue"),
  Type.Literal("review"),
  Type.Literal("owner_transfer"),
  Type.Literal("evidence"),
]);

const ResponsibilityRoleSchema = Type.Union([
  Type.Literal("owner"),
  Type.Literal("executor"),
  Type.Literal("reviewer"),
  Type.Literal("approver"),
  Type.Literal("contributor"),
]);

const HandoffApprovalSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("human"),
  Type.Literal("governance"),
]);

const ActorTypeSchema = Type.Union([Type.Literal("human"), Type.Literal("bot")]);

export type CollaborationTaskProposeHandoffParams = {
  groupId: string;
  taskId: string;
  from: string;
  to: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  kind?: "continue" | "review" | "owner_transfer" | "evidence";
  fromRole?: "owner" | "executor" | "reviewer" | "approver" | "contributor";
  toRole?: "owner" | "executor" | "reviewer" | "approver" | "contributor";
  completedArtifacts?: string[];
  assumptions?: string[];
  blockers?: string[];
  requiresApproval?: "none" | "human" | "governance";
  proposedBy?: string;
};

export const CollaborationTaskProposeHandoffParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    from: NonEmptyString,
    to: NonEmptyString,
    remainingWork: NonEmptyString,
    acceptanceCriteria: Type.Array(NonEmptyString, { minItems: 1 }),
    kind: Type.Optional(HandoffKindSchema),
    fromRole: Type.Optional(ResponsibilityRoleSchema),
    toRole: Type.Optional(ResponsibilityRoleSchema),
    completedArtifacts: Type.Optional(Type.Array(NonEmptyString)),
    assumptions: Type.Optional(Type.Array(NonEmptyString)),
    blockers: Type.Optional(Type.Array(NonEmptyString)),
    requiresApproval: Type.Optional(HandoffApprovalSchema),
    proposedBy: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskHandoffContractStepParams = {
  groupId: string;
  taskId: string;
  handoffId: string;
  actorType?: "human" | "bot";
};

export const CollaborationTaskHandoffContractStepParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    handoffId: NonEmptyString,
    actorType: Type.Optional(ActorTypeSchema),
  },
  { additionalProperties: false },
);

export type CollaborationTaskPublishBoardItemParams = {
  groupId: string;
  taskId: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  title?: string;
  goal?: string;
  constraints?: string[];
  dueAtMs?: number;
  suggestedRole?: string;
  intendedClaimantIds?: string[];
  publishedBy?: string;
  challengeWindowId?: string;
  skipChallengeWindow?: boolean;
};

export const CollaborationTaskPublishBoardItemParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    remainingWork: NonEmptyString,
    acceptanceCriteria: Type.Array(NonEmptyString, { minItems: 1 }),
    title: Type.Optional(NonEmptyString),
    goal: Type.Optional(NonEmptyString),
    constraints: Type.Optional(Type.Array(NonEmptyString)),
    dueAtMs: Type.Optional(Type.Integer()),
    suggestedRole: Type.Optional(NonEmptyString),
    intendedClaimantIds: Type.Optional(Type.Array(NonEmptyString)),
    publishedBy: Type.Optional(NonEmptyString),
    challengeWindowId: Type.Optional(NonEmptyString),
    skipChallengeWindow: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type CollaborationTaskClaimBoardItemParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  claimantId?: string;
};

export const CollaborationTaskClaimBoardItemParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    claimantId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskApplyClaimParams = {
  groupId: string;
  taskId: string;
  itemId: string;
};

export const CollaborationTaskApplyClaimParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskListBoardItemsParams = {
  groupId: string;
  taskId: string;
};

export const CollaborationTaskListBoardItemsParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskGetMemberProgressParams = {
  groupId: string;
  taskId: string;
};

export const CollaborationTaskGetMemberProgressParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskMarkInProgressParams = {
  groupId: string;
  taskId: string;
  itemId: string;
};

export const CollaborationTaskMarkInProgressParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskSubmitForReviewParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  submissionId: string;
  /** FINAL v3 S3: product/artifact version bound to this submission. */
  artifactVersion: string;
  submissionSummary?: string;
};

export const CollaborationTaskSubmitForReviewParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    submissionId: NonEmptyString,
    artifactVersion: NonEmptyString,
    submissionSummary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type CollaborationTaskAcceptSubmissionParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  /** S3: must equal the current pending submissionId. */
  expectedSubmissionId: string;
  /** S3: acceptance rationale — 主答权威 still leaves an audit trail. */
  reason: string;
  /** S3: objective Acceptance clauses checked (must cover board criteria). */
  checkedAcceptanceCriteria: string[];
  /** S3: when accepting as proxy for another role. */
  proxyForActorId?: string;
  /** S3: proxy basis / 身份依据 (required by entry when proxyForActorId set). */
  proxyBasis?: string;
};

export const CollaborationTaskAcceptSubmissionParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    expectedSubmissionId: NonEmptyString,
    reason: NonEmptyString,
    checkedAcceptanceCriteria: Type.Array(NonEmptyString),
    proxyForActorId: Type.Optional(NonEmptyString),
    proxyBasis: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskReturnSubmissionParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  reason: string;
  /** S3: must equal the current pending submissionId. */
  expectedSubmissionId: string;
};

export const CollaborationTaskReturnSubmissionParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    reason: NonEmptyString,
    expectedSubmissionId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskBlockBoardItemParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  reason?: string;
};

export const CollaborationTaskBlockBoardItemParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    reason: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskUnblockBoardItemParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  reason: string;
};

export const CollaborationTaskUnblockBoardItemParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    reason: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskCancelBoardItemParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  reason?: string;
};

export const CollaborationTaskCancelBoardItemParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    reason: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskRecordPeerReviewParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  verdict: "approve" | "revise";
  comment?: string;
};

export const CollaborationTaskRecordPeerReviewParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: NonEmptyString,
    verdict: Type.Union([Type.Literal("approve"), Type.Literal("revise")]),
    comment: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type CollaborationTaskListPeerReviewsParams = {
  groupId: string;
  taskId: string;
  itemId?: string;
  submissionId?: string;
};

export const CollaborationTaskListPeerReviewsParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    itemId: Type.Optional(NonEmptyString),
    submissionId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskOpenChallengeWindowParams = {
  groupId: string;
  taskId: string;
  challengerId: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  goal?: string;
  constraints?: string[];
  suggestedRole?: string;
  title?: string;
  windowId?: string;
};

export const CollaborationTaskOpenChallengeWindowParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    challengerId: NonEmptyString,
    remainingWork: NonEmptyString,
    acceptanceCriteria: Type.Array(NonEmptyString, { minItems: 1 }),
    goal: Type.Optional(NonEmptyString),
    constraints: Type.Optional(Type.Array(NonEmptyString)),
    suggestedRole: Type.Optional(NonEmptyString),
    title: Type.Optional(NonEmptyString),
    windowId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskRecordChallengeCritiqueParams = {
  groupId: string;
  taskId: string;
  windowId: string;
  issues: Array<"acceptance_gap" | "scope_drift" | "role_mismatch">;
  comment: string;
};

export const CollaborationTaskRecordChallengeCritiqueParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    windowId: NonEmptyString,
    issues: Type.Array(
      Type.Union([
        Type.Literal("acceptance_gap"),
        Type.Literal("scope_drift"),
        Type.Literal("role_mismatch"),
      ]),
      { minItems: 1 },
    ),
    comment: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskResolveChallengeWindowParams = {
  groupId: string;
  taskId: string;
  windowId: string;
  decision: "absorb" | "reject";
  reason: string;
  revisedGoal?: string;
  revisedRemainingWork?: string;
  revisedAcceptanceCriteria?: string[];
  revisedConstraints?: string[];
  revisedSuggestedRole?: string;
  revisedTitle?: string;
};

export const CollaborationTaskResolveChallengeWindowParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    windowId: NonEmptyString,
    decision: Type.Union([Type.Literal("absorb"), Type.Literal("reject")]),
    reason: NonEmptyString,
    revisedGoal: Type.Optional(NonEmptyString),
    revisedRemainingWork: Type.Optional(NonEmptyString),
    revisedAcceptanceCriteria: Type.Optional(Type.Array(NonEmptyString, { minItems: 1 })),
    revisedConstraints: Type.Optional(Type.Array(NonEmptyString)),
    revisedSuggestedRole: Type.Optional(NonEmptyString),
    revisedTitle: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskSkipChallengeWindowParams = {
  groupId: string;
  taskId: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  skipReason: string;
  goal?: string;
  constraints?: string[];
  suggestedRole?: string;
  title?: string;
  windowId?: string;
};

export const CollaborationTaskSkipChallengeWindowParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    remainingWork: NonEmptyString,
    acceptanceCriteria: Type.Array(NonEmptyString, { minItems: 1 }),
    skipReason: NonEmptyString,
    goal: Type.Optional(NonEmptyString),
    constraints: Type.Optional(Type.Array(NonEmptyString)),
    suggestedRole: Type.Optional(NonEmptyString),
    title: Type.Optional(NonEmptyString),
    windowId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskListChallengeWindowsParams = {
  groupId: string;
  taskId: string;
  windowId?: string;
};

export const CollaborationTaskListChallengeWindowsParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    windowId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskListWakeEventsParams = {
  groupId: string;
  taskId?: string;
};

export const CollaborationTaskListWakeEventsParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskWhoWokeWhomParams = {
  groupId: string;
  taskId?: string;
};

export const CollaborationTaskWhoWokeWhomParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskRunGroupTaskHeartbeatParams = {
  groupId: string;
  force?: boolean;
  coordinatorBotId?: string;
  groupOwnerId?: string;
};

export const CollaborationTaskRunGroupTaskHeartbeatParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    force: Type.Optional(Type.Boolean()),
    coordinatorBotId: Type.Optional(NonEmptyString),
    groupOwnerId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskAdminDailySummaryParams = {
  groupId: string;
};

export const CollaborationTaskAdminDailySummaryParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskTrySelfAdvanceParams = {
  groupId: string;
  actorId: string;
  dryRun?: boolean;
};

export const CollaborationTaskTrySelfAdvanceParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    actorId: NonEmptyString,
    dryRun: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type CollaborationTaskProposeTodolistParams = {
  groupId: string;
  taskId: string;
  boardItemId: string;
  steps: Array<{ title: string; detail?: string; stepId?: string }>;
  ownerMemberId?: string;
};

const CollaborationTodolistStepSchema = Type.Object(
  {
    title: NonEmptyString,
    detail: Type.Optional(Type.String()),
    stepId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const CollaborationTaskProposeTodolistParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    boardItemId: NonEmptyString,
    steps: Type.Array(CollaborationTodolistStepSchema, { minItems: 1 }),
    ownerMemberId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskRetryOwnerDecisionDeliveryParams = {
  groupId: string;
  taskId: string;
  todolistId: string;
  expectedVersion?: number;
};

export const CollaborationTaskRetryOwnerDecisionDeliveryParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    todolistId: NonEmptyString,
    expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export type CollaborationTaskListOwnerDecisionDeliveriesParams = {
  groupId: string;
  taskId?: string;
};

export const CollaborationTaskListOwnerDecisionDeliveriesParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskConfirmTodolistParams = {
  groupId: string;
  taskId: string;
  todolistId: string;
};

export const CollaborationTaskConfirmTodolistParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    todolistId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskReviseTodolistParams = {
  groupId: string;
  taskId: string;
  todolistId: string;
  reason: string;
  steps?: Array<{ title: string; detail?: string; stepId?: string }>;
};

export const CollaborationTaskReviseTodolistParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    todolistId: NonEmptyString,
    reason: NonEmptyString,
    steps: Type.Optional(Type.Array(CollaborationTodolistStepSchema, { minItems: 1 })),
  },
  { additionalProperties: false },
);

export type CollaborationTaskGetTodolistParams = {
  groupId: string;
  taskId: string;
  todolistId: string;
};

export const CollaborationTaskGetTodolistParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    todolistId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskListTodolistsParams = {
  groupId: string;
  taskId: string;
  boardItemId?: string;
  ownerMemberId?: string;
};

export const CollaborationTaskListTodolistsParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    boardItemId: Type.Optional(NonEmptyString),
    ownerMemberId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationTaskBuildExecutionTaskBagParams = {
  groupId: string;
  taskId: string;
  boardItemId: string;
  ownerMemberId: string;
};

export const CollaborationTaskBuildExecutionTaskBagParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    boardItemId: NonEmptyString,
    ownerMemberId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type CollaborationTaskSignalInsightParams = {
  groupId: string;
  taskId: string;
  boardItemId: string;
  insightSummary: string;
  toLeadIds: string[];
};

export const CollaborationTaskSignalInsightParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    taskId: NonEmptyString,
    boardItemId: NonEmptyString,
    insightSummary: NonEmptyString,
    toLeadIds: Type.Array(NonEmptyString, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type CollaborationDeliverableTransitionParams = {
  groupId: string;
  deliverableId: string;
  toStatus: DeliverableStatus;
};

export const CollaborationDeliverableTransitionParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    deliverableId: NonEmptyString,
    toStatus: DeliverableStatusSchema,
  },
  { additionalProperties: false },
);

export type CollaborationReviewTransitionParams = {
  groupId: string;
  reviewId: string;
  toStatus: ReviewStatus;
};

export const CollaborationReviewTransitionParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    reviewId: NonEmptyString,
    toStatus: ReviewStatusSchema,
  },
  { additionalProperties: false },
);

export type CollaborationDecisionTransitionParams = {
  groupId: string;
  decisionId: string;
  toStatus: DecisionStatus;
  selectedOption?: string;
};

export const CollaborationDecisionTransitionParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    decisionId: NonEmptyString,
    toStatus: DecisionStatusSchema,
    selectedOption: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export type CollaborationDecisionDraftUpdateParams = {
  groupId: string;
  decisionId: string;
  rationale?: string;
  selectedOption?: string;
  options?: Array<{
    optionId: string;
    title: string;
  }>;
};

const CollaborationDecisionDraftOptionSchema = Type.Object(
  {
    optionId: NonEmptyString,
    title: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CollaborationDecisionDraftUpdateParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    decisionId: NonEmptyString,
    rationale: Type.Optional(Type.String()),
    selectedOption: Type.Optional(NonEmptyString),
    options: Type.Optional(Type.Array(CollaborationDecisionDraftOptionSchema)),
  },
  { additionalProperties: false },
);

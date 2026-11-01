import AjvPkg, { type ErrorObject } from "ajv";
import type { SessionsPatchResult } from "../session-utils.types.js";
import {
  type AgentEvent,
  AgentEventSchema,
  type AgentIdentityParams,
  AgentIdentityParamsSchema,
  type AgentIdentityResult,
  AgentIdentityResultSchema,
  AgentParamsSchema,
  type AgentSummary,
  AgentSummarySchema,
  type AgentsFileEntry,
  AgentsFileEntrySchema,
  type AgentsCreateParams,
  AgentsCreateParamsSchema,
  type AgentsCreateResult,
  AgentsCreateResultSchema,
  type AgentsUpdateParams,
  AgentsUpdateParamsSchema,
  type AgentsUpdateResult,
  AgentsUpdateResultSchema,
  type AgentsDeleteParams,
  AgentsDeleteParamsSchema,
  type AgentsDeleteResult,
  AgentsDeleteResultSchema,
  type AgentsFilesGetParams,
  AgentsFilesGetParamsSchema,
  type AgentsFilesGetResult,
  AgentsFilesGetResultSchema,
  type AgentsFilesListParams,
  AgentsFilesListParamsSchema,
  type AgentsFilesListResult,
  AgentsFilesListResultSchema,
  type AgentsFilesSetParams,
  AgentsFilesSetParamsSchema,
  type AgentsFilesSetResult,
  AgentsFilesSetResultSchema,
  type AgentsWorkspaceBrowseEntry,
  AgentsWorkspaceBrowseEntrySchema,
  type AgentsWorkspaceBrowseParams,
  AgentsWorkspaceBrowseParamsSchema,
  type AgentsWorkspaceBrowseResult,
  AgentsWorkspaceBrowseResultSchema,
  type AgentsListParams,
  AgentsListParamsSchema,
  type AgentsListResult,
  AgentsListResultSchema,
  type AgentWaitParams,
  AgentWaitParamsSchema,
  type ChannelsLogoutParams,
  ChannelsLogoutParamsSchema,
  type TalkConfigParams,
  TalkConfigParamsSchema,
  type TalkConfigResult,
  TalkConfigResultSchema,
  type ChannelsStatusParams,
  ChannelsStatusParamsSchema,
  type ChannelsStatusResult,
  ChannelsStatusResultSchema,
  type ChatAbortParams,
  ChatAbortParamsSchema,
  type ChatRestoreParams,
  type ChatCheckpointsListParams,
  type CollaborationLearningSnapshotParams,
  CollaborationLearningSnapshotParamsSchema,
  type CollaborationSpacesListParams,
  CollaborationSpacesListParamsSchema,
  type CollaborationOrgBotDirectoryListParams,
  CollaborationOrgBotDirectoryListParamsSchema,
  type CollaborationSpaceMembersUpdateParams,
  CollaborationSpaceMembersUpdateParamsSchema,
  type CollaborationSpaceResetParams,
  CollaborationSpaceResetParamsSchema,
  type CollaborationSpaceDissolveParams,
  CollaborationSpaceDissolveParamsSchema,
  type CollaborationSpaceLeaveParams,
  CollaborationSpaceLeaveParamsSchema,
  type CollaborationSpaceOwnershipTransferParams,
  CollaborationSpaceOwnershipTransferParamsSchema,
  type CollaborationSpaceMissionAdvanceParams,
  CollaborationSpaceMissionAdvanceParamsSchema,
  type SpacesListParams,
  SpacesListParamsSchema,
  type SpacesMembersUpdateParams,
  SpacesMembersUpdateParamsSchema,
  type SpacesResetParams,
  SpacesResetParamsSchema,
  type CollaborationTaskTransitionParams,
  CollaborationTaskTransitionParamsSchema,
  type CollaborationTaskHandoffParams,
  CollaborationTaskHandoffParamsSchema,
  type CollaborationTaskProposeHandoffParams,
  type CollaborationTaskPublishBoardItemParams,
  type CollaborationTaskClaimBoardItemParams,
  type CollaborationTaskApplyClaimParams,
  type CollaborationTaskListBoardItemsParams,
  type CollaborationTaskGetMemberProgressParams,
  type CollaborationTaskMarkInProgressParams,
  type CollaborationTaskSubmitForReviewParams,
  type CollaborationTaskAcceptSubmissionParams,
  type CollaborationTaskReturnSubmissionParams,
  type CollaborationTaskBlockBoardItemParams,
  type CollaborationTaskUnblockBoardItemParams,
  type CollaborationTaskCancelBoardItemParams,
  type CollaborationTaskStopParams,
  type CollaborationTaskWakeOpReleaseForRetryParams,
  type CollaborationTaskWakeOpConfirmCompletedParams,
  type CollaborationTaskRecordPeerReviewParams,
  type CollaborationTaskListPeerReviewsParams,
  type CollaborationTaskOpenChallengeWindowParams,
  type CollaborationTaskRecordChallengeCritiqueParams,
  type CollaborationTaskResolveChallengeWindowParams,
  type CollaborationTaskSkipChallengeWindowParams,
  type CollaborationTaskListChallengeWindowsParams,
  type CollaborationTaskListWakeEventsParams,
  type CollaborationTaskWhoWokeWhomParams,
  type CollaborationTaskRunGroupTaskHeartbeatParams,
  type CollaborationTaskAdminDailySummaryParams,
  type CollaborationTaskTrySelfAdvanceParams,
  type CollaborationTaskProposeTodolistParams,
  type CollaborationTaskRetryOwnerDecisionDeliveryParams,
  type CollaborationTaskListOwnerDecisionDeliveriesParams,
  type CollaborationTaskConfirmTodolistParams,
  type CollaborationTaskListHumanAttentionParams,
  type CollaborationTaskActHumanAttentionParams,
  type CollaborationTaskReviseTodolistParams,
  type CollaborationTaskGetTodolistParams,
  type CollaborationTaskListTodolistsParams,
  type CollaborationTaskBuildExecutionTaskBagParams,
  type CollaborationTaskSignalInsightParams,
  CollaborationTaskProposeHandoffParamsSchema,
  CollaborationTaskPublishBoardItemParamsSchema,
  CollaborationTaskClaimBoardItemParamsSchema,
  CollaborationTaskApplyClaimParamsSchema,
  CollaborationTaskListBoardItemsParamsSchema,
  CollaborationTaskGetMemberProgressParamsSchema,
  CollaborationTaskMarkInProgressParamsSchema,
  CollaborationTaskSubmitForReviewParamsSchema,
  CollaborationTaskAcceptSubmissionParamsSchema,
  CollaborationTaskReturnSubmissionParamsSchema,
  CollaborationTaskBlockBoardItemParamsSchema,
  CollaborationTaskUnblockBoardItemParamsSchema,
  CollaborationTaskCancelBoardItemParamsSchema,
  CollaborationTaskStopParamsSchema,
  CollaborationTaskWakeOpReleaseForRetryParamsSchema,
  CollaborationTaskWakeOpConfirmCompletedParamsSchema,
  CollaborationTaskRecordPeerReviewParamsSchema,
  CollaborationTaskListPeerReviewsParamsSchema,
  CollaborationTaskOpenChallengeWindowParamsSchema,
  CollaborationTaskRecordChallengeCritiqueParamsSchema,
  CollaborationTaskResolveChallengeWindowParamsSchema,
  CollaborationTaskSkipChallengeWindowParamsSchema,
  CollaborationTaskListChallengeWindowsParamsSchema,
  CollaborationTaskListWakeEventsParamsSchema,
  CollaborationTaskWhoWokeWhomParamsSchema,
  CollaborationTaskRunGroupTaskHeartbeatParamsSchema,
  CollaborationTaskAdminDailySummaryParamsSchema,
  CollaborationTaskTrySelfAdvanceParamsSchema,
  CollaborationTaskProposeTodolistParamsSchema,
  CollaborationTaskRetryOwnerDecisionDeliveryParamsSchema,
  CollaborationTaskListOwnerDecisionDeliveriesParamsSchema,
  CollaborationTaskConfirmTodolistParamsSchema,
  CollaborationTaskListHumanAttentionParamsSchema,
  CollaborationTaskActHumanAttentionParamsSchema,
  CollaborationTaskReviseTodolistParamsSchema,
  CollaborationTaskGetTodolistParamsSchema,
  CollaborationTaskListTodolistsParamsSchema,
  CollaborationTaskBuildExecutionTaskBagParamsSchema,
  CollaborationTaskSignalInsightParamsSchema,
  type CollaborationTaskHandoffContractStepParams,
  CollaborationTaskHandoffContractStepParamsSchema,
  type CollaborationDeliverableTransitionParams,
  CollaborationDeliverableTransitionParamsSchema,
  type CollaborationReviewTransitionParams,
  CollaborationReviewTransitionParamsSchema,
  type CollaborationDecisionTransitionParams,
  CollaborationDecisionTransitionParamsSchema,
  type CollaborationDecisionDraftUpdateParams,
  CollaborationDecisionDraftUpdateParamsSchema,
  type ChatEvent,
  ChatEventSchema,
  ChatHistoryParamsSchema,
  type ChatGuideAppendParams,
  ChatGuideAppendParamsSchema,
  type ChatInjectParams,
  ChatInjectParamsSchema,
  ChatRestoreParamsSchema,
  ChatCheckpointsListParamsSchema,
  ChatSendParamsSchema,
  type ConfigApplyParams,
  ConfigApplyParamsSchema,
  type ConfigGetParams,
  ConfigGetParamsSchema,
  type ConfigPatchParams,
  ConfigPatchParamsSchema,
  type ConfigSchemaLookupParams,
  ConfigSchemaLookupParamsSchema,
  type ConfigSchemaLookupResult,
  ConfigSchemaLookupResultSchema,
  type ConfigSchemaParams,
  ConfigSchemaParamsSchema,
  type ConfigSchemaResponse,
  ConfigSchemaResponseSchema,
  type ConfigSetParams,
  ConfigSetParamsSchema,
  type ConnectParams,
  ConnectParamsSchema,
  type CronAddParams,
  CronAddParamsSchema,
  type CronJob,
  CronJobSchema,
  type CronListParams,
  CronListParamsSchema,
  type CronRemoveParams,
  CronRemoveParamsSchema,
  type CronRunLogEntry,
  type CronRunParams,
  CronRunParamsSchema,
  type CronRunsParams,
  CronRunsParamsSchema,
  type CronStatusParams,
  CronStatusParamsSchema,
  type CronTaskTemplatesDeleteParams,
  CronTaskTemplatesDeleteParamsSchema,
  type CronTaskTemplatesListParams,
  CronTaskTemplatesListParamsSchema,
  type CronTaskTemplatesSaveParams,
  CronTaskTemplatesSaveParamsSchema,
  type CronUpdateParams,
  CronUpdateParamsSchema,
  type DevicePairApproveParams,
  DevicePairApproveParamsSchema,
  type DevicePairListParams,
  DevicePairListParamsSchema,
  type DevicePairRemoveParams,
  DevicePairRemoveParamsSchema,
  type DevicePairRejectParams,
  DevicePairRejectParamsSchema,
  type DeviceTokenRevokeParams,
  DeviceTokenRevokeParamsSchema,
  type DeviceTokenRotateParams,
  DeviceTokenRotateParamsSchema,
  type DaibaiAskParams,
  DaibaiAskParamsSchema,
  type DaibaiAskResult,
  DaibaiAskResultSchema,
  type DaibaiExecuteParams,
  DaibaiExecuteParamsSchema,
  type DaibaiExecuteResult,
  DaibaiExecuteResultSchema,
  type ExecApprovalsGetParams,
  ExecApprovalsGetParamsSchema,
  type ExecApprovalsNodeGetParams,
  ExecApprovalsNodeGetParamsSchema,
  type ExecApprovalsNodeSetParams,
  ExecApprovalsNodeSetParamsSchema,
  type ExecApprovalsSetParams,
  ExecApprovalsSetParamsSchema,
  type ExecApprovalsSnapshot,
  type ExecApprovalRequestParams,
  ExecApprovalRequestParamsSchema,
  type ExecApprovalResolveParams,
  ExecApprovalResolveParamsSchema,
  ErrorCodes,
  type ErrorShape,
  ErrorShapeSchema,
  type EventFrame,
  EventFrameSchema,
  errorShape,
  type GatewayFrame,
  GatewayFrameSchema,
  type HelloOk,
  HelloOkSchema,
  type LogsTailParams,
  LogsTailParamsSchema,
  type LogsTailResult,
  LogsTailResultSchema,
  type ModelsListParams,
  ModelsListParamsSchema,
  type ModelsManagementAorStatusParams,
  ModelsManagementAorStatusParamsSchema,
  type ModelsManagementRoutingExplanationsParams,
  ModelsManagementRoutingExplanationsParamsSchema,
  type ModelsManagementSnapshotParams,
  ModelsManagementSnapshotParamsSchema,
  type ModelsAdmissionDiscoverParams,
  ModelsAdmissionDiscoverParamsSchema,
  type ModelsAdmissionCreateVerificationParams,
  ModelsAdmissionCreateVerificationParamsSchema,
  type ModelsAdmissionGetVerificationParams,
  ModelsAdmissionGetVerificationParamsSchema,
  type ModelsAdmissionListVerificationParams,
  ModelsAdmissionListVerificationParamsSchema,
  type ModelsAdmissionCancelVerificationParams,
  ModelsAdmissionCancelVerificationParamsSchema,
  type ModelsAdmissionBatchVerificationParams,
  ModelsAdmissionBatchVerificationParamsSchema,
  type ModelsAdmissionSetRoutingEligibilityParams,
  ModelsAdmissionSetRoutingEligibilityParamsSchema,
  type ModelsAdmissionGetModelParams,
  ModelsAdmissionGetModelParamsSchema,
  type ModelsAdmissionListModelsParams,
  ModelsAdmissionListModelsParamsSchema,
  type ModelsAdmissionPreviewRoutingParams,
  ModelsAdmissionPreviewRoutingParamsSchema,
  type ModelsProbeParams,
  ModelsProbeParamsSchema,
  type NodeDescribeParams,
  NodeDescribeParamsSchema,
  type NodeEventParams,
  NodeEventParamsSchema,
  type NodePendingDrainParams,
  NodePendingDrainParamsSchema,
  type NodePendingDrainResult,
  NodePendingDrainResultSchema,
  type NodePendingEnqueueParams,
  NodePendingEnqueueParamsSchema,
  type NodePendingEnqueueResult,
  NodePendingEnqueueResultSchema,
  type NodeInvokeParams,
  NodeInvokeParamsSchema,
  type NodeInvokeResultParams,
  NodeInvokeResultParamsSchema,
  type LocalFilesRedeemParams,
  LocalFilesRedeemParamsSchema,
  type LocalFilesKeysetEvent,
  type NodeListParams,
  NodeListParamsSchema,
  type NodePendingAckParams,
  NodePendingAckParamsSchema,
  type NodePairApproveParams,
  NodePairApproveParamsSchema,
  type NodePairListParams,
  NodePairListParamsSchema,
  type NodePairRejectParams,
  NodePairRejectParamsSchema,
  type NodePairRequestParams,
  NodePairRequestParamsSchema,
  type NodePairVerifyParams,
  NodePairVerifyParamsSchema,
  type NodeRenameParams,
  NodeRenameParamsSchema,
  type MeshOwnershipListParams,
  type MeshOwnershipListResult,
  MeshOwnershipListParamsSchema,
  type PollParams,
  PollParamsSchema,
  PROTOCOL_VERSION,
  type PushTestParams,
  PushTestParamsSchema,
  PushTestResultSchema,
  type PresenceEntry,
  PresenceEntrySchema,
  ProtocolSchemas,
  type RequestFrame,
  RequestFrameSchema,
  type ResponseFrame,
  ResponseFrameSchema,
  SendParamsSchema,
  type SecretsResolveParams,
  type SecretsResolveResult,
  SecretsResolveParamsSchema,
  SecretsResolveResultSchema,
  type SessionsCompactParams,
  SessionsCompactParamsSchema,
  type SessionsDeleteParams,
  SessionsDeleteParamsSchema,
  type SessionsListParams,
  SessionsListParamsSchema,
  type SessionsPatchParams,
  SessionsPatchParamsSchema,
  type SessionsPreviewParams,
  SessionsPreviewParamsSchema,
  type SessionsResetParams,
  SessionsResetParamsSchema,
  type SessionsResolveParams,
  SessionsResolveParamsSchema,
  type SessionsUsageParams,
  SessionsUsageParamsSchema,
  type ShutdownEvent,
  ShutdownEventSchema,
  type SkillsBinsParams,
  SkillsBinsParamsSchema,
  type SkillsBinsResult,
  type SkillsInstallParams,
  SkillsInstallParamsSchema,
  type SkillsStatusParams,
  SkillsStatusParamsSchema,
  type WorkspaceCloudBrowseParams,
  WorkspaceCloudBrowseParamsSchema,
  type WorkspaceCloudGenerateConfigParams,
  WorkspaceCloudGenerateConfigParamsSchema,
  type WorkspaceCloudTestConnectionParams,
  WorkspaceCloudTestConnectionParamsSchema,
  type WorkspaceLocalBrowseParams,
  WorkspaceLocalBrowseParamsSchema,
  type WorkspaceLocalChooseParams,
  WorkspaceLocalChooseParamsSchema,
  type WorkspaceLocalValidateParams,
  WorkspaceLocalValidateParamsSchema,
  type WorkspacesCreateParams,
  WorkspacesCreateParamsSchema,
  type RobotsBindWorkspaceParams,
  RobotsBindWorkspaceParamsSchema,
  type SupportCase,
  SupportCaseSchema,
  type SupportCaseResolutionProposal,
  SupportCaseResolutionProposalSchema,
  type SupportCasesCloseParams,
  SupportCasesCloseParamsSchema,
  type SupportCasesCreateParams,
  SupportCasesCreateParamsSchema,
  type SupportCasesGetParams,
  SupportCasesGetParamsSchema,
  type SupportCasesListParams,
  SupportCasesListParamsSchema,
  type SupportCasesResolveParams,
  SupportCasesResolveParamsSchema,
  type SupportCaseSummary,
  SupportCaseSummarySchema,
  type SkillsUpdateParams,
  SkillsUpdateParamsSchema,
  type ToolsCatalogParams,
  ToolsCatalogParamsSchema,
  type ToolsCatalogResult,
  type Snapshot,
  SnapshotSchema,
  type StateVersion,
  StateVersionSchema,
  type TalkModeParams,
  TalkModeParamsSchema,
  type TickEvent,
  TickEventSchema,
  type UpdateRunParams,
  UpdateRunParamsSchema,
  type WakeParams,
  WakeParamsSchema,
  type WebLoginStartParams,
  WebLoginStartParamsSchema,
  type WebLoginWaitParams,
  WebLoginWaitParamsSchema,
  type WizardCancelParams,
  WizardCancelParamsSchema,
  type WizardNextParams,
  WizardNextParamsSchema,
  type WizardNextResult,
  WizardNextResultSchema,
  type WizardStartParams,
  WizardStartParamsSchema,
  type WizardStartResult,
  WizardStartResultSchema,
  type WizardStatusParams,
  WizardStatusParamsSchema,
  type WizardStatusResult,
  WizardStatusResultSchema,
  type WizardStep,
  WizardStepSchema,
  type OguiForm,
  OguiFormSchema,
  type OguiChoice,
  OguiChoiceSchema,
  type OguiAnswer,
  OguiAnswerSchema,
} from "./schema.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
  removeAdditional: false,
});

export const validateConnectParams = ajv.compile<ConnectParams>(ConnectParamsSchema);
export const validateRequestFrame = ajv.compile<RequestFrame>(RequestFrameSchema);
export const validateResponseFrame = ajv.compile<ResponseFrame>(ResponseFrameSchema);
export const validateEventFrame = ajv.compile<EventFrame>(EventFrameSchema);
export const validateSendParams = ajv.compile(SendParamsSchema);
export const validatePollParams = ajv.compile<PollParams>(PollParamsSchema);
export const validateAgentParams = ajv.compile(AgentParamsSchema);
export const validateAgentIdentityParams =
  ajv.compile<AgentIdentityParams>(AgentIdentityParamsSchema);
export const validateAgentWaitParams = ajv.compile<AgentWaitParams>(AgentWaitParamsSchema);
export const validateWakeParams = ajv.compile<WakeParams>(WakeParamsSchema);
export const validateAgentsListParams = ajv.compile<AgentsListParams>(AgentsListParamsSchema);
export const validateAgentsCreateParams = ajv.compile<AgentsCreateParams>(AgentsCreateParamsSchema);
export const validateAgentsUpdateParams = ajv.compile<AgentsUpdateParams>(AgentsUpdateParamsSchema);
export const validateAgentsDeleteParams = ajv.compile<AgentsDeleteParams>(AgentsDeleteParamsSchema);
export const validateAgentsFilesListParams = ajv.compile<AgentsFilesListParams>(
  AgentsFilesListParamsSchema,
);
export const validateAgentsFilesGetParams = ajv.compile<AgentsFilesGetParams>(
  AgentsFilesGetParamsSchema,
);
export const validateAgentsFilesSetParams = ajv.compile<AgentsFilesSetParams>(
  AgentsFilesSetParamsSchema,
);
export const validateAgentsWorkspaceBrowseParams = ajv.compile<AgentsWorkspaceBrowseParams>(
  AgentsWorkspaceBrowseParamsSchema,
);
export const validateWorkspaceLocalValidateParams = ajv.compile<WorkspaceLocalValidateParams>(
  WorkspaceLocalValidateParamsSchema,
);
export const validateWorkspaceLocalBrowseParams = ajv.compile<WorkspaceLocalBrowseParams>(
  WorkspaceLocalBrowseParamsSchema,
);
export const validateWorkspaceLocalChooseParams = ajv.compile<WorkspaceLocalChooseParams>(
  WorkspaceLocalChooseParamsSchema,
);
export const validateWorkspaceCloudGenerateConfigParams =
  ajv.compile<WorkspaceCloudGenerateConfigParams>(WorkspaceCloudGenerateConfigParamsSchema);
export const validateWorkspaceCloudTestConnectionParams =
  ajv.compile<WorkspaceCloudTestConnectionParams>(WorkspaceCloudTestConnectionParamsSchema);
export const validateWorkspaceCloudBrowseParams = ajv.compile<WorkspaceCloudBrowseParams>(
  WorkspaceCloudBrowseParamsSchema,
);
export const validateWorkspacesCreateParams = ajv.compile<WorkspacesCreateParams>(
  WorkspacesCreateParamsSchema,
);
export const validateRobotsBindWorkspaceParams = ajv.compile<RobotsBindWorkspaceParams>(
  RobotsBindWorkspaceParamsSchema,
);
export const validateNodePairRequestParams = ajv.compile<NodePairRequestParams>(
  NodePairRequestParamsSchema,
);
export const validateNodePairListParams = ajv.compile<NodePairListParams>(NodePairListParamsSchema);
export const validateNodePairApproveParams = ajv.compile<NodePairApproveParams>(
  NodePairApproveParamsSchema,
);
export const validateNodePairRejectParams = ajv.compile<NodePairRejectParams>(
  NodePairRejectParamsSchema,
);
export const validateNodePairVerifyParams = ajv.compile<NodePairVerifyParams>(
  NodePairVerifyParamsSchema,
);
export const validateNodeRenameParams = ajv.compile<NodeRenameParams>(NodeRenameParamsSchema);
export const validateNodeListParams = ajv.compile<NodeListParams>(NodeListParamsSchema);
export const validateMeshOwnershipListParams = ajv.compile<MeshOwnershipListParams>(
  MeshOwnershipListParamsSchema,
);
export const validateNodePendingAckParams = ajv.compile<NodePendingAckParams>(
  NodePendingAckParamsSchema,
);
export const validateNodeDescribeParams = ajv.compile<NodeDescribeParams>(NodeDescribeParamsSchema);
export const validateNodeInvokeParams = ajv.compile<NodeInvokeParams>(NodeInvokeParamsSchema);
export const validateNodeInvokeResultParams = ajv.compile<NodeInvokeResultParams>(
  NodeInvokeResultParamsSchema,
);
export const validateLocalFilesRedeemParams = ajv.compile<LocalFilesRedeemParams>(
  LocalFilesRedeemParamsSchema,
);
export const validateNodeEventParams = ajv.compile<NodeEventParams>(NodeEventParamsSchema);
export const validateNodePendingDrainParams = ajv.compile<NodePendingDrainParams>(
  NodePendingDrainParamsSchema,
);
export const validateNodePendingEnqueueParams = ajv.compile<NodePendingEnqueueParams>(
  NodePendingEnqueueParamsSchema,
);
export const validatePushTestParams = ajv.compile<PushTestParams>(PushTestParamsSchema);
export const validateSecretsResolveParams = ajv.compile<SecretsResolveParams>(
  SecretsResolveParamsSchema,
);
export const validateSecretsResolveResult = ajv.compile<SecretsResolveResult>(
  SecretsResolveResultSchema,
);
export const validateSessionsListParams = ajv.compile<SessionsListParams>(SessionsListParamsSchema);
export const validateSessionsPreviewParams = ajv.compile<SessionsPreviewParams>(
  SessionsPreviewParamsSchema,
);
export const validateSessionsResolveParams = ajv.compile<SessionsResolveParams>(
  SessionsResolveParamsSchema,
);
export const validateSessionsPatchParams =
  ajv.compile<SessionsPatchParams>(SessionsPatchParamsSchema);
export const validateSessionsResetParams =
  ajv.compile<SessionsResetParams>(SessionsResetParamsSchema);
export const validateSessionsDeleteParams = ajv.compile<SessionsDeleteParams>(
  SessionsDeleteParamsSchema,
);
export const validateSessionsCompactParams = ajv.compile<SessionsCompactParams>(
  SessionsCompactParamsSchema,
);
export const validateSessionsUsageParams =
  ajv.compile<SessionsUsageParams>(SessionsUsageParamsSchema);
export const validateConfigGetParams = ajv.compile<ConfigGetParams>(ConfigGetParamsSchema);
export const validateConfigSetParams = ajv.compile<ConfigSetParams>(ConfigSetParamsSchema);
export const validateConfigApplyParams = ajv.compile<ConfigApplyParams>(ConfigApplyParamsSchema);
export const validateConfigPatchParams = ajv.compile<ConfigPatchParams>(ConfigPatchParamsSchema);
export const validateConfigSchemaParams = ajv.compile<ConfigSchemaParams>(ConfigSchemaParamsSchema);
export const validateConfigSchemaLookupParams = ajv.compile<ConfigSchemaLookupParams>(
  ConfigSchemaLookupParamsSchema,
);
export const validateConfigSchemaLookupResult = ajv.compile<ConfigSchemaLookupResult>(
  ConfigSchemaLookupResultSchema,
);
export const validateWizardStartParams = ajv.compile<WizardStartParams>(WizardStartParamsSchema);
export const validateWizardNextParams = ajv.compile<WizardNextParams>(WizardNextParamsSchema);
export const validateWizardCancelParams = ajv.compile<WizardCancelParams>(WizardCancelParamsSchema);
export const validateWizardStatusParams = ajv.compile<WizardStatusParams>(WizardStatusParamsSchema);
export const validateOguiForm = ajv.compile<OguiForm>(OguiFormSchema);
export const validateOguiChoice = ajv.compile<OguiChoice>(OguiChoiceSchema);
export const validateOguiAnswer = ajv.compile<OguiAnswer>(OguiAnswerSchema);
export const validateTalkModeParams = ajv.compile<TalkModeParams>(TalkModeParamsSchema);
export const validateTalkConfigParams = ajv.compile<TalkConfigParams>(TalkConfigParamsSchema);
export const validateTalkConfigResult = ajv.compile<TalkConfigResult>(TalkConfigResultSchema);
export const validateChannelsStatusParams = ajv.compile<ChannelsStatusParams>(
  ChannelsStatusParamsSchema,
);
export const validateChannelsLogoutParams = ajv.compile<ChannelsLogoutParams>(
  ChannelsLogoutParamsSchema,
);
export const validateCollaborationLearningSnapshotParams =
  ajv.compile<CollaborationLearningSnapshotParams>(CollaborationLearningSnapshotParamsSchema);
export const validateCollaborationSpacesListParams = ajv.compile<CollaborationSpacesListParams>(
  CollaborationSpacesListParamsSchema,
);
export const validateCollaborationOrgBotDirectoryListParams =
  ajv.compile<CollaborationOrgBotDirectoryListParams>(CollaborationOrgBotDirectoryListParamsSchema);
export const validateCollaborationSpaceMembersUpdateParams =
  ajv.compile<CollaborationSpaceMembersUpdateParams>(CollaborationSpaceMembersUpdateParamsSchema);
export const validateCollaborationSpaceResetParams = ajv.compile<CollaborationSpaceResetParams>(
  CollaborationSpaceResetParamsSchema,
);
export const validateCollaborationSpaceDissolveParams =
  ajv.compile<CollaborationSpaceDissolveParams>(CollaborationSpaceDissolveParamsSchema);
export const validateCollaborationSpaceLeaveParams = ajv.compile<CollaborationSpaceLeaveParams>(
  CollaborationSpaceLeaveParamsSchema,
);
export const validateCollaborationSpaceOwnershipTransferParams =
  ajv.compile<CollaborationSpaceOwnershipTransferParams>(
    CollaborationSpaceOwnershipTransferParamsSchema,
  );
export const validateCollaborationSpaceMissionAdvanceParams =
  ajv.compile<CollaborationSpaceMissionAdvanceParams>(CollaborationSpaceMissionAdvanceParamsSchema);
export const validateSpacesListParams = ajv.compile<SpacesListParams>(SpacesListParamsSchema);
export const validateSpacesMembersUpdateParams = ajv.compile<SpacesMembersUpdateParams>(
  SpacesMembersUpdateParamsSchema,
);
export const validateSpacesResetParams = ajv.compile<SpacesResetParams>(SpacesResetParamsSchema);
export const validateCollaborationTaskTransitionParams =
  ajv.compile<CollaborationTaskTransitionParams>(CollaborationTaskTransitionParamsSchema);
export const validateCollaborationTaskHandoffParams = ajv.compile<CollaborationTaskHandoffParams>(
  CollaborationTaskHandoffParamsSchema,
);
export const validateCollaborationTaskProposeHandoffParams =
  ajv.compile<CollaborationTaskProposeHandoffParams>(CollaborationTaskProposeHandoffParamsSchema);
export const validateCollaborationTaskPublishBoardItemParams =
  ajv.compile<CollaborationTaskPublishBoardItemParams>(
    CollaborationTaskPublishBoardItemParamsSchema,
  );
export const validateCollaborationTaskClaimBoardItemParams =
  ajv.compile<CollaborationTaskClaimBoardItemParams>(CollaborationTaskClaimBoardItemParamsSchema);
export const validateCollaborationTaskApplyClaimParams =
  ajv.compile<CollaborationTaskApplyClaimParams>(CollaborationTaskApplyClaimParamsSchema);
export const validateCollaborationTaskListBoardItemsParams =
  ajv.compile<CollaborationTaskListBoardItemsParams>(CollaborationTaskListBoardItemsParamsSchema);
export const validateCollaborationTaskGetMemberProgressParams =
  ajv.compile<CollaborationTaskGetMemberProgressParams>(
    CollaborationTaskGetMemberProgressParamsSchema,
  );
export const validateCollaborationTaskMarkInProgressParams =
  ajv.compile<CollaborationTaskMarkInProgressParams>(CollaborationTaskMarkInProgressParamsSchema);
export const validateCollaborationTaskSubmitForReviewParams =
  ajv.compile<CollaborationTaskSubmitForReviewParams>(CollaborationTaskSubmitForReviewParamsSchema);
export const validateCollaborationTaskAcceptSubmissionParams =
  ajv.compile<CollaborationTaskAcceptSubmissionParams>(
    CollaborationTaskAcceptSubmissionParamsSchema,
  );
export const validateCollaborationTaskReturnSubmissionParams =
  ajv.compile<CollaborationTaskReturnSubmissionParams>(
    CollaborationTaskReturnSubmissionParamsSchema,
  );
export const validateCollaborationTaskBlockBoardItemParams =
  ajv.compile<CollaborationTaskBlockBoardItemParams>(CollaborationTaskBlockBoardItemParamsSchema);
export const validateCollaborationTaskUnblockBoardItemParams =
  ajv.compile<CollaborationTaskUnblockBoardItemParams>(
    CollaborationTaskUnblockBoardItemParamsSchema,
  );
export const validateCollaborationTaskCancelBoardItemParams =
  ajv.compile<CollaborationTaskCancelBoardItemParams>(CollaborationTaskCancelBoardItemParamsSchema);
export const validateCollaborationTaskStopParams = ajv.compile<CollaborationTaskStopParams>(
  CollaborationTaskStopParamsSchema,
);
export const validateCollaborationTaskWakeOpReleaseForRetryParams =
  ajv.compile<CollaborationTaskWakeOpReleaseForRetryParams>(
    CollaborationTaskWakeOpReleaseForRetryParamsSchema,
  );
export const validateCollaborationTaskWakeOpConfirmCompletedParams =
  ajv.compile<CollaborationTaskWakeOpConfirmCompletedParams>(
    CollaborationTaskWakeOpConfirmCompletedParamsSchema,
  );
export const validateCollaborationTaskRecordPeerReviewParams =
  ajv.compile<CollaborationTaskRecordPeerReviewParams>(
    CollaborationTaskRecordPeerReviewParamsSchema,
  );
export const validateCollaborationTaskListPeerReviewsParams =
  ajv.compile<CollaborationTaskListPeerReviewsParams>(CollaborationTaskListPeerReviewsParamsSchema);

export const validateCollaborationTaskOpenChallengeWindowParams =
  ajv.compile<CollaborationTaskOpenChallengeWindowParams>(
    CollaborationTaskOpenChallengeWindowParamsSchema,
  );
export const validateCollaborationTaskRecordChallengeCritiqueParams =
  ajv.compile<CollaborationTaskRecordChallengeCritiqueParams>(
    CollaborationTaskRecordChallengeCritiqueParamsSchema,
  );
export const validateCollaborationTaskResolveChallengeWindowParams =
  ajv.compile<CollaborationTaskResolveChallengeWindowParams>(
    CollaborationTaskResolveChallengeWindowParamsSchema,
  );
export const validateCollaborationTaskSkipChallengeWindowParams =
  ajv.compile<CollaborationTaskSkipChallengeWindowParams>(
    CollaborationTaskSkipChallengeWindowParamsSchema,
  );
export const validateCollaborationTaskListChallengeWindowsParams =
  ajv.compile<CollaborationTaskListChallengeWindowsParams>(
    CollaborationTaskListChallengeWindowsParamsSchema,
  );
export const validateCollaborationTaskListWakeEventsParams =
  ajv.compile<CollaborationTaskListWakeEventsParams>(CollaborationTaskListWakeEventsParamsSchema);
export const validateCollaborationTaskWhoWokeWhomParams =
  ajv.compile<CollaborationTaskWhoWokeWhomParams>(CollaborationTaskWhoWokeWhomParamsSchema);
export const validateCollaborationTaskRunGroupTaskHeartbeatParams =
  ajv.compile<CollaborationTaskRunGroupTaskHeartbeatParams>(
    CollaborationTaskRunGroupTaskHeartbeatParamsSchema,
  );
export const validateCollaborationTaskAdminDailySummaryParams =
  ajv.compile<CollaborationTaskAdminDailySummaryParams>(
    CollaborationTaskAdminDailySummaryParamsSchema,
  );
export const validateCollaborationTaskTrySelfAdvanceParams =
  ajv.compile<CollaborationTaskTrySelfAdvanceParams>(CollaborationTaskTrySelfAdvanceParamsSchema);
export const validateCollaborationTaskProposeTodolistParams =
  ajv.compile<CollaborationTaskProposeTodolistParams>(CollaborationTaskProposeTodolistParamsSchema);
export const validateCollaborationTaskRetryOwnerDecisionDeliveryParams =
  ajv.compile<CollaborationTaskRetryOwnerDecisionDeliveryParams>(
    CollaborationTaskRetryOwnerDecisionDeliveryParamsSchema,
  );
export const validateCollaborationTaskListOwnerDecisionDeliveriesParams =
  ajv.compile<CollaborationTaskListOwnerDecisionDeliveriesParams>(
    CollaborationTaskListOwnerDecisionDeliveriesParamsSchema,
  );
export const validateCollaborationTaskConfirmTodolistParams =
  ajv.compile<CollaborationTaskConfirmTodolistParams>(CollaborationTaskConfirmTodolistParamsSchema);
export const validateCollaborationTaskListHumanAttentionParams =
  ajv.compile<CollaborationTaskListHumanAttentionParams>(
    CollaborationTaskListHumanAttentionParamsSchema,
  );
export const validateCollaborationTaskActHumanAttentionParams =
  ajv.compile<CollaborationTaskActHumanAttentionParams>(
    CollaborationTaskActHumanAttentionParamsSchema,
  );
export const validateCollaborationTaskReviseTodolistParams =
  ajv.compile<CollaborationTaskReviseTodolistParams>(CollaborationTaskReviseTodolistParamsSchema);
export const validateCollaborationTaskGetTodolistParams =
  ajv.compile<CollaborationTaskGetTodolistParams>(CollaborationTaskGetTodolistParamsSchema);
export const validateCollaborationTaskListTodolistsParams =
  ajv.compile<CollaborationTaskListTodolistsParams>(CollaborationTaskListTodolistsParamsSchema);
export const validateCollaborationTaskBuildExecutionTaskBagParams =
  ajv.compile<CollaborationTaskBuildExecutionTaskBagParams>(
    CollaborationTaskBuildExecutionTaskBagParamsSchema,
  );
export const validateCollaborationTaskSignalInsightParams =
  ajv.compile<CollaborationTaskSignalInsightParams>(CollaborationTaskSignalInsightParamsSchema);

export const validateCollaborationTaskAcceptHandoffParams =
  ajv.compile<CollaborationTaskHandoffContractStepParams>(
    CollaborationTaskHandoffContractStepParamsSchema,
  );
export const validateCollaborationTaskApproveHandoffParams =
  ajv.compile<CollaborationTaskHandoffContractStepParams>(
    CollaborationTaskHandoffContractStepParamsSchema,
  );
export const validateCollaborationTaskApplyHandoffParams =
  ajv.compile<CollaborationTaskHandoffContractStepParams>(
    CollaborationTaskHandoffContractStepParamsSchema,
  );
export const validateCollaborationDeliverableTransitionParams =
  ajv.compile<CollaborationDeliverableTransitionParams>(
    CollaborationDeliverableTransitionParamsSchema,
  );
export const validateCollaborationReviewTransitionParams =
  ajv.compile<CollaborationReviewTransitionParams>(CollaborationReviewTransitionParamsSchema);
export const validateCollaborationDecisionTransitionParams =
  ajv.compile<CollaborationDecisionTransitionParams>(CollaborationDecisionTransitionParamsSchema);
export const validateCollaborationDecisionDraftUpdateParams =
  ajv.compile<CollaborationDecisionDraftUpdateParams>(CollaborationDecisionDraftUpdateParamsSchema);
export const validateModelsListParams = ajv.compile<ModelsListParams>(ModelsListParamsSchema);
export const validateModelsManagementSnapshotParams = ajv.compile<ModelsManagementSnapshotParams>(
  ModelsManagementSnapshotParamsSchema,
);
export const validateModelsManagementRoutingExplanationsParams =
  ajv.compile<ModelsManagementRoutingExplanationsParams>(
    ModelsManagementRoutingExplanationsParamsSchema,
  );
export const validateModelsManagementAorStatusParams = ajv.compile<ModelsManagementAorStatusParams>(
  ModelsManagementAorStatusParamsSchema,
);
export const validateModelsAdmissionDiscoverParams = ajv.compile<ModelsAdmissionDiscoverParams>(
  ModelsAdmissionDiscoverParamsSchema,
);
export const validateModelsAdmissionCreateVerificationParams =
  ajv.compile<ModelsAdmissionCreateVerificationParams>(
    ModelsAdmissionCreateVerificationParamsSchema,
  );
export const validateModelsAdmissionGetVerificationParams =
  ajv.compile<ModelsAdmissionGetVerificationParams>(ModelsAdmissionGetVerificationParamsSchema);
export const validateModelsAdmissionListVerificationParams =
  ajv.compile<ModelsAdmissionListVerificationParams>(ModelsAdmissionListVerificationParamsSchema);
export const validateModelsAdmissionCancelVerificationParams =
  ajv.compile<ModelsAdmissionCancelVerificationParams>(
    ModelsAdmissionCancelVerificationParamsSchema,
  );
export const validateModelsAdmissionBatchVerificationParams =
  ajv.compile<ModelsAdmissionBatchVerificationParams>(ModelsAdmissionBatchVerificationParamsSchema);
export const validateModelsAdmissionSetRoutingEligibilityParams =
  ajv.compile<ModelsAdmissionSetRoutingEligibilityParams>(
    ModelsAdmissionSetRoutingEligibilityParamsSchema,
  );
export const validateModelsAdmissionGetModelParams = ajv.compile<ModelsAdmissionGetModelParams>(
  ModelsAdmissionGetModelParamsSchema,
);
export const validateModelsAdmissionListModelsParams = ajv.compile<ModelsAdmissionListModelsParams>(
  ModelsAdmissionListModelsParamsSchema,
);
export const validateModelsAdmissionPreviewRoutingParams =
  ajv.compile<ModelsAdmissionPreviewRoutingParams>(ModelsAdmissionPreviewRoutingParamsSchema);
export const validateModelsProbeParams = ajv.compile<ModelsProbeParams>(ModelsProbeParamsSchema);
export const validateSkillsStatusParams = ajv.compile<SkillsStatusParams>(SkillsStatusParamsSchema);
export const validateToolsCatalogParams = ajv.compile<ToolsCatalogParams>(ToolsCatalogParamsSchema);
export const validateSkillsBinsParams = ajv.compile<SkillsBinsParams>(SkillsBinsParamsSchema);
export const validateSkillsInstallParams =
  ajv.compile<SkillsInstallParams>(SkillsInstallParamsSchema);
export const validateSkillsUpdateParams = ajv.compile<SkillsUpdateParams>(SkillsUpdateParamsSchema);
export const validateCronListParams = ajv.compile<CronListParams>(CronListParamsSchema);
export const validateCronStatusParams = ajv.compile<CronStatusParams>(CronStatusParamsSchema);
export const validateCronAddParams = ajv.compile<CronAddParams>(CronAddParamsSchema);
export const validateCronUpdateParams = ajv.compile<CronUpdateParams>(CronUpdateParamsSchema);
export const validateCronRemoveParams = ajv.compile<CronRemoveParams>(CronRemoveParamsSchema);
export const validateCronRunParams = ajv.compile<CronRunParams>(CronRunParamsSchema);
export const validateCronRunsParams = ajv.compile<CronRunsParams>(CronRunsParamsSchema);
export const validateCronTaskTemplatesListParams = ajv.compile<CronTaskTemplatesListParams>(
  CronTaskTemplatesListParamsSchema,
);
export const validateCronTaskTemplatesSaveParams = ajv.compile<CronTaskTemplatesSaveParams>(
  CronTaskTemplatesSaveParamsSchema,
);
export const validateCronTaskTemplatesDeleteParams = ajv.compile<CronTaskTemplatesDeleteParams>(
  CronTaskTemplatesDeleteParamsSchema,
);
export const validateDevicePairListParams = ajv.compile<DevicePairListParams>(
  DevicePairListParamsSchema,
);
export const validateDevicePairApproveParams = ajv.compile<DevicePairApproveParams>(
  DevicePairApproveParamsSchema,
);
export const validateDevicePairRejectParams = ajv.compile<DevicePairRejectParams>(
  DevicePairRejectParamsSchema,
);
export const validateDevicePairRemoveParams = ajv.compile<DevicePairRemoveParams>(
  DevicePairRemoveParamsSchema,
);
export const validateDeviceTokenRotateParams = ajv.compile<DeviceTokenRotateParams>(
  DeviceTokenRotateParamsSchema,
);
export const validateDeviceTokenRevokeParams = ajv.compile<DeviceTokenRevokeParams>(
  DeviceTokenRevokeParamsSchema,
);
export const validateSupportCase = ajv.compile<SupportCase>(SupportCaseSchema);
export const validateSupportCaseSummary = ajv.compile<SupportCaseSummary>(SupportCaseSummarySchema);
export const validateSupportCaseResolutionProposal = ajv.compile<SupportCaseResolutionProposal>(
  SupportCaseResolutionProposalSchema,
);
export const validateSupportCasesCreateParams = ajv.compile<SupportCasesCreateParams>(
  SupportCasesCreateParamsSchema,
);
export const validateSupportCasesListParams = ajv.compile<SupportCasesListParams>(
  SupportCasesListParamsSchema,
);
export const validateSupportCasesGetParams = ajv.compile<SupportCasesGetParams>(
  SupportCasesGetParamsSchema,
);
export const validateSupportCasesResolveParams = ajv.compile<SupportCasesResolveParams>(
  SupportCasesResolveParamsSchema,
);
export const validateSupportCasesCloseParams = ajv.compile<SupportCasesCloseParams>(
  SupportCasesCloseParamsSchema,
);
export const validateDaibaiAskParams = ajv.compile<DaibaiAskParams>(DaibaiAskParamsSchema);
export const validateDaibaiAskResult = ajv.compile<DaibaiAskResult>(DaibaiAskResultSchema);
export const validateDaibaiExecuteParams =
  ajv.compile<DaibaiExecuteParams>(DaibaiExecuteParamsSchema);
export const validateDaibaiExecuteResult =
  ajv.compile<DaibaiExecuteResult>(DaibaiExecuteResultSchema);
export const validateExecApprovalsGetParams = ajv.compile<ExecApprovalsGetParams>(
  ExecApprovalsGetParamsSchema,
);
export const validateExecApprovalsSetParams = ajv.compile<ExecApprovalsSetParams>(
  ExecApprovalsSetParamsSchema,
);
export const validateExecApprovalRequestParams = ajv.compile<ExecApprovalRequestParams>(
  ExecApprovalRequestParamsSchema,
);
export const validateExecApprovalResolveParams = ajv.compile<ExecApprovalResolveParams>(
  ExecApprovalResolveParamsSchema,
);
export const validateExecApprovalsNodeGetParams = ajv.compile<ExecApprovalsNodeGetParams>(
  ExecApprovalsNodeGetParamsSchema,
);
export const validateExecApprovalsNodeSetParams = ajv.compile<ExecApprovalsNodeSetParams>(
  ExecApprovalsNodeSetParamsSchema,
);
export const validateLogsTailParams = ajv.compile<LogsTailParams>(LogsTailParamsSchema);
export const validateChatHistoryParams = ajv.compile(ChatHistoryParamsSchema);
export const validateChatSendParams = ajv.compile(ChatSendParamsSchema);
export const validateChatAbortParams = ajv.compile<ChatAbortParams>(ChatAbortParamsSchema);
export const validateChatInjectParams = ajv.compile<ChatInjectParams>(ChatInjectParamsSchema);
export const validateChatGuideAppendParams = ajv.compile<ChatGuideAppendParams>(
  ChatGuideAppendParamsSchema,
);
export const validateChatRestoreParams = ajv.compile<ChatRestoreParams>(ChatRestoreParamsSchema);
export const validateChatCheckpointsListParams = ajv.compile<ChatCheckpointsListParams>(
  ChatCheckpointsListParamsSchema,
);
export const validateChatEvent = ajv.compile(ChatEventSchema);
export const validateUpdateRunParams = ajv.compile<UpdateRunParams>(UpdateRunParamsSchema);
export const validateWebLoginStartParams =
  ajv.compile<WebLoginStartParams>(WebLoginStartParamsSchema);
export const validateWebLoginWaitParams = ajv.compile<WebLoginWaitParams>(WebLoginWaitParamsSchema);

export function formatValidationErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors?.length) {
    return "unknown validation error";
  }

  const parts: string[] = [];

  for (const err of errors) {
    const keyword = typeof err?.keyword === "string" ? err.keyword : "";
    const instancePath = typeof err?.instancePath === "string" ? err.instancePath : "";

    if (keyword === "additionalProperties") {
      const params = err?.params as { additionalProperty?: unknown } | undefined;
      const additionalProperty = params?.additionalProperty;
      if (typeof additionalProperty === "string" && additionalProperty.trim()) {
        const where = instancePath ? `at ${instancePath}` : "at root";
        parts.push(`${where}: unexpected property '${additionalProperty}'`);
        continue;
      }
    }

    const message =
      typeof err?.message === "string" && err.message.trim() ? err.message : "validation error";
    const where = instancePath ? `at ${instancePath}: ` : "";
    parts.push(`${where}${message}`);
  }

  // De-dupe while preserving order.
  const unique = Array.from(new Set(parts.filter((part) => part.trim())));
  if (!unique.length) {
    const fallback = ajv.errorsText(errors, { separator: "; " });
    return fallback || "unknown validation error";
  }
  return unique.join("; ");
}

export {
  ConnectParamsSchema,
  HelloOkSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  GatewayFrameSchema,
  PresenceEntrySchema,
  SnapshotSchema,
  ErrorShapeSchema,
  StateVersionSchema,
  AgentEventSchema,
  ChatEventSchema,
  SendParamsSchema,
  PollParamsSchema,
  AgentParamsSchema,
  AgentIdentityParamsSchema,
  AgentIdentityResultSchema,
  WakeParamsSchema,
  PushTestParamsSchema,
  PushTestResultSchema,
  NodePairRequestParamsSchema,
  NodePairListParamsSchema,
  NodePairApproveParamsSchema,
  NodePairRejectParamsSchema,
  NodePairVerifyParamsSchema,
  NodeListParamsSchema,
  NodePendingAckParamsSchema,
  NodeInvokeParamsSchema,
  NodePendingDrainParamsSchema,
  NodePendingDrainResultSchema,
  NodePendingEnqueueParamsSchema,
  NodePendingEnqueueResultSchema,
  SessionsListParamsSchema,
  SessionsPreviewParamsSchema,
  SessionsPatchParamsSchema,
  SessionsResetParamsSchema,
  SessionsDeleteParamsSchema,
  SessionsCompactParamsSchema,
  SessionsUsageParamsSchema,
  ConfigGetParamsSchema,
  ConfigSetParamsSchema,
  ConfigApplyParamsSchema,
  ConfigPatchParamsSchema,
  ConfigSchemaParamsSchema,
  ConfigSchemaLookupParamsSchema,
  ConfigSchemaResponseSchema,
  ConfigSchemaLookupResultSchema,
  WizardStartParamsSchema,
  WizardNextParamsSchema,
  WizardCancelParamsSchema,
  WizardStatusParamsSchema,
  WizardStepSchema,
  OguiFormSchema,
  OguiChoiceSchema,
  OguiAnswerSchema,
  WizardNextResultSchema,
  WizardStartResultSchema,
  WizardStatusResultSchema,
  TalkConfigParamsSchema,
  TalkConfigResultSchema,
  ChannelsStatusParamsSchema,
  ChannelsStatusResultSchema,
  ChannelsLogoutParamsSchema,
  WebLoginStartParamsSchema,
  WebLoginWaitParamsSchema,
  AgentSummarySchema,
  AgentsFileEntrySchema,
  AgentsCreateParamsSchema,
  AgentsCreateResultSchema,
  AgentsUpdateParamsSchema,
  AgentsUpdateResultSchema,
  AgentsDeleteParamsSchema,
  AgentsDeleteResultSchema,
  AgentsFilesListParamsSchema,
  AgentsFilesListResultSchema,
  AgentsFilesGetParamsSchema,
  AgentsFilesGetResultSchema,
  AgentsFilesSetParamsSchema,
  AgentsFilesSetResultSchema,
  AgentsWorkspaceBrowseEntrySchema,
  AgentsWorkspaceBrowseParamsSchema,
  AgentsWorkspaceBrowseResultSchema,
  AgentsListParamsSchema,
  AgentsListResultSchema,
  ModelsListParamsSchema,
  ModelsManagementSnapshotParamsSchema,
  ModelsManagementRoutingExplanationsParamsSchema,
  ModelsManagementAorStatusParamsSchema,
  ModelsAdmissionDiscoverParamsSchema,
  ModelsAdmissionCreateVerificationParamsSchema,
  ModelsAdmissionGetVerificationParamsSchema,
  ModelsAdmissionListVerificationParamsSchema,
  ModelsAdmissionCancelVerificationParamsSchema,
  ModelsAdmissionBatchVerificationParamsSchema,
  ModelsAdmissionSetRoutingEligibilityParamsSchema,
  ModelsAdmissionGetModelParamsSchema,
  ModelsAdmissionListModelsParamsSchema,
  ModelsAdmissionPreviewRoutingParamsSchema,
  SkillsStatusParamsSchema,
  ToolsCatalogParamsSchema,
  SkillsInstallParamsSchema,
  SkillsUpdateParamsSchema,
  CronJobSchema,
  CronListParamsSchema,
  CronStatusParamsSchema,
  CronAddParamsSchema,
  CronUpdateParamsSchema,
  CronRemoveParamsSchema,
  CronRunParamsSchema,
  CronRunsParamsSchema,
  CronTaskTemplatesDeleteParamsSchema,
  CronTaskTemplatesListParamsSchema,
  CronTaskTemplatesSaveParamsSchema,
  LogsTailParamsSchema,
  LogsTailResultSchema,
  ChatHistoryParamsSchema,
  ChatSendParamsSchema,
  ChatGuideAppendParamsSchema,
  ChatInjectParamsSchema,
  ChatRestoreParamsSchema,
  UpdateRunParamsSchema,
  TickEventSchema,
  ShutdownEventSchema,
  ProtocolSchemas,
  PROTOCOL_VERSION,
  ErrorCodes,
  errorShape,
};

export type {
  GatewayFrame,
  ConnectParams,
  HelloOk,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  PresenceEntry,
  Snapshot,
  ErrorShape,
  StateVersion,
  AgentEvent,
  AgentIdentityParams,
  AgentIdentityResult,
  AgentWaitParams,
  ChatEvent,
  TickEvent,
  ShutdownEvent,
  WakeParams,
  NodePairRequestParams,
  NodePairListParams,
  NodePairApproveParams,
  DevicePairListParams,
  DevicePairApproveParams,
  DevicePairRejectParams,
  ConfigGetParams,
  ConfigSetParams,
  ConfigApplyParams,
  ConfigPatchParams,
  ConfigSchemaParams,
  ConfigSchemaResponse,
  WizardStartParams,
  WizardNextParams,
  WizardCancelParams,
  WizardStatusParams,
  WizardStep,
  OguiForm,
  OguiChoice,
  OguiAnswer,
  WizardNextResult,
  WizardStartResult,
  WizardStatusResult,
  TalkConfigParams,
  TalkConfigResult,
  TalkModeParams,
  ChannelsStatusParams,
  ChannelsStatusResult,
  ChannelsLogoutParams,
  WebLoginStartParams,
  WebLoginWaitParams,
  AgentSummary,
  AgentsFileEntry,
  AgentsCreateParams,
  AgentsCreateResult,
  AgentsUpdateParams,
  AgentsUpdateResult,
  AgentsDeleteParams,
  AgentsDeleteResult,
  AgentsFilesListParams,
  AgentsFilesListResult,
  AgentsFilesGetParams,
  AgentsFilesGetResult,
  AgentsFilesSetParams,
  AgentsFilesSetResult,
  AgentsWorkspaceBrowseEntry,
  AgentsWorkspaceBrowseParams,
  AgentsWorkspaceBrowseResult,
  AgentsListParams,
  AgentsListResult,
  MeshOwnershipListParams,
  MeshOwnershipListResult,
  SkillsStatusParams,
  ToolsCatalogParams,
  ToolsCatalogResult,
  SkillsBinsParams,
  SkillsBinsResult,
  SkillsInstallParams,
  SkillsUpdateParams,
  NodePairRejectParams,
  NodePairVerifyParams,
  NodeListParams,
  NodeInvokeParams,
  NodeInvokeResultParams,
  LocalFilesRedeemParams,
  LocalFilesKeysetEvent,
  NodeEventParams,
  NodePendingDrainParams,
  NodePendingDrainResult,
  NodePendingEnqueueParams,
  NodePendingEnqueueResult,
  SessionsListParams,
  SessionsPreviewParams,
  SessionsResolveParams,
  SessionsPatchParams,
  SessionsPatchResult,
  SessionsResetParams,
  SessionsDeleteParams,
  SessionsCompactParams,
  SessionsUsageParams,
  CronJob,
  CronListParams,
  CronStatusParams,
  CronAddParams,
  CronUpdateParams,
  CronRemoveParams,
  CronRunParams,
  CronRunsParams,
  CronRunLogEntry,
  CronTaskTemplatesListParams,
  CronTaskTemplatesSaveParams,
  CronTaskTemplatesDeleteParams,
  ExecApprovalsGetParams,
  ExecApprovalsSetParams,
  ExecApprovalsSnapshot,
  LogsTailParams,
  LogsTailResult,
  PollParams,
  UpdateRunParams,
  ChatInjectParams,
  ChatGuideAppendParams,
};

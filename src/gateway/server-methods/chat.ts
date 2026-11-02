import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import {
  extractEmployeeStewardUserIdFromSessionKey,
  isEmployeeBuiltinStewardSession,
  sessionKeysForChatHistoryActiveRun,
} from "../../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { resolveThinkingDefault } from "../../agents/model-selection.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { gateChatHistoryText, stripToolMessages } from "../../agents/tools/sessions-helpers.js";
import { omitImagePayloadForHistory } from "../../agents/transcript-image-omit.js";
import { settleTurnCompletion } from "../../agents/turn-completion/contract.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import { isTranscriptStartBoundary } from "../../auto-reply/reply/chat-checkpoint-boundary.js";
import { noteUnresolvedChatRunError } from "../../auto-reply/reply/chat-run-error-escalation.js";
import { isInternalContinueHistoryMessage } from "../../auto-reply/reply/internal-continue-prompt.js";
import { isMemoryFlushHistoryMessage } from "../../auto-reply/reply/memory-flush-prompt.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import {
  emptyRestoreTaskReconciliation,
  isolateLegacyRestoreTranscriptText,
  isRestoreTaskIsolationMessage,
  restoreTaskIsolationStamp,
  toRestoreTaskIsolationPayload,
  type RestoreTaskReconciliation,
} from "../../auto-reply/reply/restore-task-isolation.js";
import {
  formatSessionContinuityCheckpointRestoreText,
  commitSessionContinuityForCurrentSession,
  loadLatestSessionContinuityCheckpoint,
  loadRestoreTaskReconciliation,
  restoreWorkspaceSnapshotForCheckpoint,
  resolveSessionContinuityWorkspaceDir,
} from "../../auto-reply/reply/session-continuity.js";
import type { MsgContext } from "../../auto-reply/templating.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
import { normalizeComposerQuote } from "../../chat/composer-quote.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled, resolveDataRoot } from "../../config/data-space.js";
import { withOperatorStateScope } from "../../config/operator-state-scope.js";
import {
  loadSessionStore,
  resolveSessionFilePath,
  updateSessionStore,
} from "../../config/sessions.js";
import type { SessionEntry } from "../../config/sessions.js";
import { oguiWaitBlocksSession } from "../../config/sessions/ogui-decision-wait-registry.js";
import { projectOguiDecisionStatuses } from "../../config/sessions/ogui-decision.js";
import { resolveSessionTranscriptsDirForAgent } from "../../config/sessions/paths.js";
import {
  applyFocusSwitchGate,
  recordFocusSwitchDecision,
  transcriptEntriesForInboundTurn,
} from "../../conversation-task/focus-switch.js";
import { observeConversationTaskCancelPathConsult } from "../../conversation-task/reply-completion.js";
import { readSessionTaskBoard } from "../../conversation-task/session-task-board.js";
import { shouldTaskParkAbortInFlight } from "../../conversation-task/turn-relation.js";
import { resolveConversationFlags } from "../../conversations/flags.js";
import { pageHistoryMessages } from "../../conversations/history-cursor.js";
import {
  commitTranscriptRangeRevoked,
  resolveRecallDenyStoreDir,
} from "../../conversations/memory-recall-deny.js";
import {
  cronReplyContextToInputProvenance,
  normalizeCronReplyContext,
} from "../../cron/cron-reply-context.js";
import { dispatchDiagnoseConversationAction } from "../../diagnosis/diagnose-action-dispatch.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
} from "../../diagnosis/production-cutover.js";
import { jsonUtf8Bytes } from "../../infra/json-utf8-bytes.js";
import {
  WorkspaceRestoreBusyError,
  WorkspaceRestoreError,
} from "../../infra/workspace-snapshot/restore-transaction.js";
import { saveMediaBuffer } from "../../media/store.js";
import { drainRevokeOutbox } from "../../memory/revoke-outbox-drain.js";
import { MentionDelivery } from "../../organization/mention-delivery.js";
import { createMentionState } from "../../organization/mention-state-tracker.js";
import type { MentionMetadata } from "../../organization/mention-types.js";
import { resolveRuntimeOrganizationContext } from "../../organization/runtime.js";
import { KeyedAsyncQueue } from "../../plugin-sdk/keyed-async-queue.js";
import { normalizeInputProvenance, type InputProvenance } from "../../sessions/input-provenance.js";
import { isPeerOutboundSurfaceMessage } from "../../sessions/peer-outbound.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import {
  canonicalizeWorkbenchChatSessionKey,
  isCollaborationGroupChatSessionKey,
  isRedundantRobotAliasSessionKey,
  parseAgentSessionKey,
  toCollaborationSpaceSessionKey,
} from "../../sessions/session-key-utils.js";
import { planDaibaiGuideAppend } from "../../shared/daibai-guide-card.js";
import {
  attachDeclaredDeliverableArtifacts,
  declaredDeliverableArtifactFields,
} from "../../shared/preview-artifact/materialize-declared-artifacts.js";
import {
  isHiddenToolUseScratchpadMessage,
  type VisibleReplyLanguage,
} from "../../shared/text/assistant-scratchpad.js";
import {
  isControlChannelOnlyText,
  stripControlChannelForDisplay,
} from "../../shared/text/control-channel-visibility.js";
import {
  extractMessageVisibleText,
  readTextBlock,
} from "../../shared/text/visible-message-text.js";
import { enforceVisibleReplyLanguageFromCache } from "../../shared/text/visible-reply-language.js";
import { resolveChatFinalTaskUpdate } from "../../task-outcome/chat-task-update.js";
import {
  stripInlineDirectiveTagsForDisplay,
  stripInlineDirectiveTagsFromMessageForDisplay,
} from "../../utils/directive-tags.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isWebchatClient,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import { analyzeAndStoreGrowthTask } from "../agent-growth/analyze-growth-task.js";
import { shouldBlockGrowthTaskSend } from "../agent-growth/growth-task-gate.js";
import { clearRobotPendingTaskContext } from "../agent-growth/pending-task-context.js";
import { recordRobotGrowthMilestone } from "../agent-growth/record-robot-milestone.js";
import { readRobotGrowthStatus } from "../agent-growth/store.js";
import {
  abortChatRunById,
  abortChatRunsForSessionKey,
  findActiveDuplicateChatSend,
  markChatRunNotUndoable,
  type ChatAbortControllerEntry,
  type ChatAbortOps,
  isChatStopCommandText,
  resolveChatRunExpiresAtMs,
} from "../chat-abort.js";
import {
  listActiveSessionChatRunIds,
  resolveActiveSessionChatRun,
  type ActiveChatRunSnapshot,
} from "../chat-active-run.js";
import {
  DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES,
  DEFAULT_CHAT_IMAGE_ATTACHMENT_MAX_BYTES,
  type ChatFileContent,
  type ChatImageContent,
  parseMessageWithAttachments,
} from "../chat-attachments.js";
import { resolveClientStewardOwnerId } from "../chat-event-isolation.js";
import {
  scheduleGroupChatAclCacheRefresh,
  upsertAuthorizedGroupChatAclMember,
} from "../chat-group-acl-cache.js";
import { isChatInboundPersistEarlyEnabled } from "../chat-inbound-flags.js";
import { emitChatInboundStage } from "../chat-inbound-stage-events.js";
import { stripEnvelopeFromMessage, stripEnvelopeFromMessages } from "../chat-sanitize.js";
import {
  noteChatRunTenant,
  noteChatSessionInterest,
  resolveChatRunTenantId,
} from "../chat-session-interest.js";
import * as chatCheckpointStore from "../checkpoint-store.js";
import { resolveComposerQuoteSendLayers } from "../collaboration-dispatch/chat-send-composer-quote.js";
import {
  collabEdgeContributionRole,
  hasCollabEdgeDirective,
  stripCollabEdgeDirectives,
  type CollabEdge,
} from "../collaboration-dispatch/collab-edge.js";
import {
  beatIdForEpisode,
  eventKeyOf,
  episodeIdForClientRun,
  type CollaborationEventKey,
} from "../collaboration-dispatch/collaboration-event-key.js";
import { collaborationSocialSilenceFallback } from "../collaboration-dispatch/completion-contract.js";
import {
  decideParticipants,
  selectGroupDiscussionBotsForScope,
} from "../collaboration-dispatch/decision-engine.js";
import {
  buildCollaborationDiscussionTurnPrompt,
  buildCollaborationGroupMembersLabel,
} from "../collaboration-dispatch/discussion-turn-prompt.js";
import type { EffectiveCollaborationPolicy } from "../collaboration-dispatch/effective-policy.js";
import { runSingleBeatEpisodeAroundRound } from "../collaboration-dispatch/episode-single-beat-runtime.js";
import { resolveExplicitMentionTokens } from "../collaboration-dispatch/explicit-mention-tokens.js";
import {
  emitCollabFaultRoundDiagnostic,
  faultRoundOutcomeFromSkipReason,
  type FaultRoundVisibleOutcome,
} from "../collaboration-dispatch/fault-round-diagnostic.js";
import { isRosterAllowedGroupDiscussionBot } from "../collaboration-dispatch/group-discussion-roster.js";
import { buildCollaborationGroupInboundHistory } from "../collaboration-dispatch/group-inbound-history.js";
import {
  buildV1RollCallRosterFromExecutions,
  buildV1RollCallRosterPromptLines,
  buildV1RollCallRosterUnavailable,
  prepareV1RollCallChatHooks,
  type V1RollCallRoster,
} from "../collaboration-dispatch/hotfix-rollcall-v1.js"; // v1-only
import { resolveProductionCollaborationExecutor } from "../collaboration-dispatch/legacy-production-executor.js";
import {
  normalizeAgentIdentifier,
  normalizeMentionIdentity,
} from "../collaboration-dispatch/mention-utils.js";
import { recordChatSendOguiProjectionBestEffort } from "../collaboration-dispatch/ogui-handoff-projection-chat-hook.js";
import {
  classifyOptionalSupplementReply,
  extractOptionalSupplementTitle,
} from "../collaboration-dispatch/optional-supplement.js";
import { resolveDispatchLanePreserveConflict } from "../collaboration-dispatch/policy-lane-dispatch.js";
import { resolveGovernanceLaneCoordinatorBotId } from "../collaboration-dispatch/policy-lane-governance.js";
import { resolvePresentationLaneReplyLanguage } from "../collaboration-dispatch/policy-lane-presentation.js";
import {
  assertNoPrivateRunBagInPublicPayload,
  createCollaborationPrivateRunBag,
  isCollaborationPrivateRunBagEnabled,
} from "../collaboration-dispatch/private-run-bag.js";
import { shouldSuppressHighlyRedundantReply } from "../collaboration-dispatch/redundancy-guard.js";
import {
  resolveCollaborationReplyLanguage,
  sanitizeCollaborationVisibleReply,
} from "../collaboration-dispatch/reply-language.js";
import {
  createRoundPolicySnapshotFromScope,
  isCollabPolicySnapshotEnabled,
  persistPolicySnapshotBody,
  type RoundPolicySnapshot,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  abortPersistedRound,
  executeCollaborationRound,
} from "../collaboration-dispatch/round-runtime.js";
import { buildGroupRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  buildSameRoundContext,
  type SameRoundContext,
  type SameRoundReply,
} from "../collaboration-dispatch/same-round-context.js";
import {
  collaborationSuppressKindFromSkipReason,
  formatCollaborationSuppressAbortNotice,
  formatCollaborationSuppressNotice,
  isCollaborationSurfaceSilentSuppressReasonsEnabled,
} from "../collaboration-dispatch/suppress-reason-surface.js";
import {
  COLLABORATION_DEFAULT_MAX_VISIBLE_REPLIES,
  type CollaborationBotTarget,
  type CollaborationDispatchScope,
  type CollaborationRoundPlanPayload,
  type ContributionRole,
  type ParticipationDecision,
  type ParticipationTier,
} from "../collaboration-dispatch/types.js";
import {
  collaborationInfraFailureDetail,
  collaborationSkipReasonForMissingReply,
  formatCollaborationDispatchFailure,
  formatCollaborationRoundAbortNotice,
  normalizeVisibleCollaborationReply,
  recoverLatestVisibleAssistantText,
  type CollaborationSkipReason,
} from "../collaboration-dispatch/visible-reply.js";
import {
  observeAssistantReplyWakeBestEffort,
  recordChatSendMentionWakesBestEffort,
} from "../collaboration-dispatch/wake-contract-chat-hook.js";
import {
  ensureGatewayCollaborationGroupSessions,
  listGatewayCollaborationSpaces,
  loadGatewayCollaborationLearningSnapshot,
  resolveBlockedAgentIdsForCurrentTask,
  type GatewayCollaborationSpaceSnapshot,
} from "../collaboration-learning.js";
import { finalizeMemberRunTeamDeliverable } from "../collaboration-learning/chat-deliverable-team-submit.js";
import { maybeConfirmPlanFromChatSend } from "../collaboration-learning/chat-plan-confirm-hook.js";
import { parseChatPlanConfirmIntent } from "../collaboration-learning/chat-plan-confirm.js";
import {
  isGroupPublicTranscriptSessionFile,
  resolveGroupPublicTranscriptPath,
} from "../collaboration-learning/collaboration-paths.js";
import { resolveDeliveryAclActor } from "../collaboration-learning/delivery-actor-binding.js";
import {
  applyDiscussToTaskChatTurnToChatHandler,
  emitDiscussToTaskClientFeedback,
  runControlledDiscussToTaskChatTurn,
} from "../collaboration-learning/discuss-to-task-chat-turn.js";
import type { ExecutionDeliverableBinding } from "../collaboration-learning/execution-deliverable-binding.js";
import {
  bindGroupPublicTranscript,
  dropDivergentGroupTranscriptMirrors,
} from "../collaboration-learning/group-public-transcript.js";
import { assertNoPrivateMemoryDirtyWriteToGroupPublic } from "../collaboration-learning/private-memory-promote.js";
import { scheduleContinueAfterDeliverableSettlement } from "../collaboration-learning/schedule-continue-after-deliverable.js";
import { resolveCollaborationSpaceSessionId } from "../collaboration-learning/session-id.js";
import {
  resolveSessionParticipationGroupId,
  resolveSessionParticipationOverlay,
} from "../collaboration-learning/session-participation-overlay.js";
import { resolveCollaborationGroupOwnerEntitlementScope } from "../collaboration-learning/steward-group-policy.js";
import {
  authorizeTeamGroupResourceAccess,
  createTrustedGroupStores,
  resolveCompositionTrustedTeamContext,
} from "../collaboration-learning/team-resource-auth.js";
import {
  labelCollaborationIoTenant,
  resolveCollaborationTenantResolution,
} from "../collaboration-learning/trusted-tenant.js";
import { tryBuildChatActorExecutionDeliverableBinding } from "../collaboration-learning/try-build-chat-actor-deliverable-binding.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import type { CollaborationExecutionRecord } from "../collaboration-ledger/types.js";
import {
  appendCollaborationDispatchRecord,
  appendCollaborationExecutionRecord,
} from "../collaboration-ledger/writer.js";
import { writeGovernanceOpMarker } from "../data-governance/operation-marker.js";
import {
  abortConversationArchiveGovernanceRegistration,
  activateConversationArchiveGovernanceRegistration,
  assertConversationArchiveContentWritable,
  beginConversationArchiveGovernanceRegistration,
  getSharedDataGovernanceCatalog,
  resolveConversationArchiveResourceId,
  upsertConversationArchiveGovernanceRecord,
} from "../data-governance/runtime-catalog.js";
import {
  employeeGlobalStewardTranscriptBlocked,
  resolveEmployeeScopedChatSessionKey,
} from "../employee-steward-session.js";
import {
  buildEmployeeSessionVisibilityContext,
  COLLABORATION_SPACE_PERMISSIONS_DENIAL,
  CollaborationSpacePermissionsError,
  isSessionVisibleToEmployeeActor,
  requiresEmployeeAssetScope,
  resolveCollaborationSpaceWriteDenialForActor,
  resolveEmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { recordAgentInvocationShadow } from "../governance/agent-invocation-shadow.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import {
  deliverPreparedChatFinal,
  overlayChatDeliverablePublish,
  prepareChatDeliverablePublish,
  type PreparedChatDeliverable,
} from "../knowledge/deliverables/chat-deliverable-publish.js";
import { maybeAutoCaptureAgentDeliverable } from "../knowledge/deliverables/maybe-auto-capture-agent-deliverable.js";
import { formatClientSessionNotFoundDetail } from "../operator-shared-session-heal.js";
import {
  findUserByEmail,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "../platform-auth.js";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  hasGatewayClientCap,
} from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatAbortParams,
  validateChatGuideAppendParams,
  validateChatHistoryParams,
  validateChatInjectParams,
  validateChatRestoreParams,
  validateChatSendParams,
} from "../protocol/index.js";
import { CHAT_SEND_SESSION_KEY_MAX_LENGTH } from "../protocol/schema/primitives.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  capArrayByJsonBytes,
  loadCombinedSessionStoreForGateway,
  readSessionMessages,
  resolveExistingSessionTranscriptPath,
  resolveSessionModelRef,
  resolveSessionTranscriptCandidates,
} from "../session-utils.js";
import { retireLeftoverWorkbenchAliasesAroundStore } from "../sessions/retire-workbench-alias-sessions.js";
import {
  foreignEmployeeStewardAccessDenial,
  interceptStewardCrossCallChatSend,
  stewardCallAuthorizationHistoryEntries,
} from "../steward-call-authorization.js";
import {
  buildSessionStorePathResolver,
  gatewayClientForSessionOwner,
  loadSessionEntryForClient,
  resolveTenantContext,
  resolveTenantContextForSessionStore,
} from "../tenant-context.js";
import { truncateTranscriptToBoundary } from "../transcript-truncate.js";
import { detectReplyLanguage } from "../user-modeling/derive.js";
import * as webchatIdentity from "../webchat-client-platform-identity.js";
import { resolveWorkspaceLocator } from "../workspace-resolver/strict-locator.js";
import { resolveLiveRobotWriteRoot } from "../workspace-resolver/write-roots.js";
import { loadAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import {
  resolveAuthorizedToolCwd,
  resolveWorkspaceDirAfterAuthorization,
} from "../workspace/handler-bridge.js";
import { formatForLog } from "../ws-log.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";
import { setGatewayDedupeEntry } from "./agent-wait-dedupe.js";
import { normalizeRpcAttachmentsToChatAttachments } from "./attachment-normalize.js";
import {
  createChatRestoreDeadline,
  isChatRestoreTimeout,
  raceChatRestoreWork,
  throwIfRestoreAborted,
} from "./chat-restore-deadline.js";
import {
  applyChatFocusSwitchGateWithResumeRecheck,
  authoritativeStopIdentityFromClient,
  buildResumeTaskStopActive,
  clearAuthoritativeTaskStop,
  clientIdentityOkForResume,
  recordAuthoritativeTaskStop,
  sessionStopBarrierActive,
} from "./chat-resume-parked-recheck.js";
import {
  appendInjectedAssistantMessageToTranscript,
  appendInjectedPeerMessageToTranscript,
  appendInjectedPeerOutboundMessageToTranscript,
  appendPersistedAgentMessageToTranscript,
} from "./chat-transcript-inject.js";
import { findCollaborationSpaceStoreEntry } from "./collaboration-space-session-entry.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
  GatewayClient,
  RespondFn,
} from "./types.js";
type TranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};
type AbortOrigin = "rpc" | "stop-command";

type AbortedPartialSnapshot = {
  runId: string;
  sessionId: string;
  text: string;
  abortOrigin: AbortOrigin;
};

const CHAT_HISTORY_TEXT_MAX_CHARS = 12_000;
/** toolResult payloads often bury EXIT:/exitCode in the tail — keep a larger budget. */
const CHAT_HISTORY_TOOL_RESULT_MAX_CHARS = 40_000;
/** Preserve this many trailing chars when head-truncating toolResult text. */
const CHAT_HISTORY_TOOL_RESULT_TAIL_CHARS = 2_500;
const CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 128 * 1024;
const CHAT_HISTORY_OVERSIZED_PLACEHOLDER = "[chat.history omitted: message too large]";
let chatHistoryPlaceholderEmitCount = 0;
const GROUP_DISCUSSION_VISIBLE_TURN_LIMIT = COLLABORATION_DEFAULT_MAX_VISIBLE_REPLIES;
const CHANNEL_AGNOSTIC_SESSION_SCOPES = new Set([
  "main",
  "direct",
  "dm",
  "group",
  "channel",
  "cron",
  "run",
  "subagent",
  "acp",
  "thread",
  "topic",
]);
const CHANNEL_SCOPED_SESSION_SHAPES = new Set(["direct", "dm", "group", "channel"]);
const groupDiscussionQueue = new KeyedAsyncQueue();
const groupBotQueue = new KeyedAsyncQueue();

export type GroupDiscussionBotTarget = CollaborationBotTarget;
export type GroupDiscussionScope = CollaborationDispatchScope;

export { selectGroupDiscussionBotsForScope };

function isSpaceAliasSessionKey(value: string) {
  return canonicalizeWorkbenchChatSessionKey(value).toLowerCase().startsWith("space:");
}

function extractSpaceAliasGroupId(value: string) {
  return extractGroupIdFromChatSessionKey(value);
}

function extractGroupIdFromChatSessionKey(value: string): string | null {
  const canonical = canonicalizeWorkbenchChatSessionKey(value);
  if (canonical.toLowerCase().startsWith("space:")) {
    const groupId = canonical.slice("space:".length).trim();
    return groupId || null;
  }
  const match = value
    .trim()
    .toLowerCase()
    .match(/:space:([^:]+)/);
  return match?.[1]?.trim() || null;
}

const EMPLOYEE_GLOBAL_STEWARD_TRANSCRIPT_DENIAL =
  "global steward history is not available for this employee session";

function employeeChatTranscriptBlocked(
  client: GatewayClient | null | undefined,
  sessionKey: string,
): boolean {
  return employeeGlobalStewardTranscriptBlocked(client, sessionKey);
}

function respondEmptyIsolatedStewardHistory(params: {
  respond: RespondFn;
  rawSessionKey: string;
}): void {
  params.respond(true, {
    sessionKey: params.rawSessionKey,
    messages: [],
    activeRun: null,
  });
}

function denyEmployeeGlobalStewardTranscript(params: {
  client: GatewayClient | null | undefined;
  sessionKey: string;
  respond: RespondFn;
}): boolean {
  if (!employeeChatTranscriptBlocked(params.client, params.sessionKey)) {
    return false;
  }
  params.respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, EMPLOYEE_GLOBAL_STEWARD_TRANSCRIPT_DENIAL),
  );
  return true;
}

async function resolvePersonalWorkbenchSessionAccessDenial(params: {
  client: GatewayClient | null | undefined;
  sessionKey: string;
  logGateway?: { warn?: (message: string) => void };
}): Promise<string | null> {
  if (!requiresEmployeeAssetScope(params.client)) {
    return null;
  }
  // L1 tip-smoke: Da Bai canary live session is not a personal workbench key.
  if (DIAGNOSIS_DAIBAI_DELIVERY_ENABLED && params.sessionKey === DIAGNOSIS_P24_5_LIVE_SESSION_KEY) {
    return null;
  }
  const visibility = await buildEmployeeSessionVisibilityContext({
    client: params.client,
    logGateway: params.logGateway,
  });
  if (!visibility) {
    return "chat access requires a resolved employee actor for personal workbench sessions";
  }
  const allowed = isSessionVisibleToEmployeeActor({ key: params.sessionKey }, visibility);
  if (!allowed) {
    return "you do not have permission to access this chat session";
  }
  return null;
}

function noteAuthorizedChatSessionInterest(
  client: GatewayClient | null | undefined,
  sessionKey: string,
  runId?: string | null,
): void {
  const owner = resolveClientStewardOwnerId({
    platformUserId: client?.platformUserId,
    user: client?.user,
  });
  if (!owner) {
    return;
  }
  const tenantId = client?.sessionEnterpriseId?.trim() || null;
  noteChatSessionInterest(sessionKey, owner, tenantId);
  if (runId) {
    noteChatRunTenant(runId, tenantId);
  }
  if (extractGroupIdFromChatSessionKey(sessionKey) || isSpaceAliasSessionKey(sessionKey)) {
    scheduleGroupChatAclCacheRefresh();
  }
}

/**
 * Collaboration-group write ACL (L3 object gate). Scheme A fail-closed:
 * catalog miss → `unknown collaboration space`; catalog throw or later
 * named-group miss → `failed to resolve collaboration space permissions`.
 * Scope must not scan historical sessions after a second-list miss.
 * @see docs/design/collaboration-space-authority-convergence-2026-08-08.md
 */
export async function resolveCollaborationGroupWriteDenial(params: {
  client: GatewayClient | null | undefined;
  rawSessionKey: string;
  listCollaborationSpaces?: typeof listGatewayCollaborationSpaces;
  resolveActor?: typeof resolveEmployeeWorkbenchActor;
  logGateway?: { warn?: (message: string) => void } | null;
}): Promise<string | null> {
  const groupId = extractGroupIdFromChatSessionKey(params.rawSessionKey);
  if (!groupId) {
    return null;
  }

  const cfg = loadConfig();
  const profile = resolveSecurityProfile(cfg, process.env);
  const resolveActor = params.resolveActor ?? resolveEmployeeWorkbenchActor;
  const actor = await resolveActor(params.client);

  // C5 managed path: membership ACL is tenant-scoped members.json — not the
  // personal collaboration space catalog (which can cross or lag tenants).
  if (profile.profile === "managed_enterprise") {
    const tenantCtx = await resolveTenantContext(params.client ?? null);
    const tenantId = tenantCtx?.tenantId?.trim() || actor?.tenantId?.trim() || null;
    if (!tenantId) {
      return "trusted tenant context required";
    }
    if (!actor) {
      return "collaboration group write requires a resolved employee actor";
    }
    let members: Awaited<ReturnType<typeof loadAuthoritativeGroupMembers>>;
    try {
      members = await loadAuthoritativeGroupMembers({
        groupId,
        actor,
        listCollaborationSpaces: params.listCollaborationSpaces,
        tenantId,
        profile: "managed_enterprise",
        cfg,
      });
    } catch (err) {
      params.logGateway?.warn?.(
        `collaboration group write ACL: failed to load tenant members (groupId=${groupId}): ${String(err)}`,
      );
      return COLLABORATION_SPACE_PERMISSIONS_DENIAL;
    }
    if (members.length === 0) {
      return "unknown collaboration space";
    }
    const owner =
      members.find((member) => member.memberKind === "human" && member.governanceRole === "owner")
        ?.userId ??
      members.find((member) => member.memberKind === "human")?.userId ??
      null;
    return resolveCollaborationSpaceWriteDenialForActor(
      {
        id: `space:${groupId}`,
        groupId,
        ownerUserId: owner,
        members: {
          humans: members
            .filter((member) => member.memberKind === "human" && typeof member.userId === "string")
            .map((human) => ({
              userId: human.userId as string,
              name: human.name ?? (human.userId as string),
              status: human.status,
              governanceRole: human.governanceRole,
            })),
        },
      },
      actor,
    );
  }

  const listSpaces = params.listCollaborationSpaces ?? listGatewayCollaborationSpaces;
  let spaces: Awaited<ReturnType<typeof listGatewayCollaborationSpaces>>;
  try {
    spaces = await listSpaces();
  } catch (err) {
    // Single diagnostic log; client only receives the stable denial string.
    params.logGateway?.warn?.(
      `collaboration group write ACL: failed to list spaces (groupId=${groupId}): ${String(err)}`,
    );
    return COLLABORATION_SPACE_PERMISSIONS_DENIAL;
  }

  const normalizedGroupId = groupId.trim().toLowerCase();
  const space = spaces.spaces.find(
    (entry) =>
      entry.groupId.trim().toLowerCase() === normalizedGroupId ||
      entry.id
        .trim()
        .toLowerCase()
        .replace(/^space:/, "") === normalizedGroupId,
  );
  if (!space) {
    return "unknown collaboration space";
  }

  if (!actor) {
    // Personal-workbench must fail closed — never allow group writes without an actor.
    if (requiresEmployeeAssetScope(params.client)) {
      return "collaboration group write requires a resolved employee actor";
    }
    // Evidenced local-gateway compatibility (gateway-server-chat-b space chat):
    // catalog hit already proved the group exists; membership ACL requires an
    // actor and is skipped only for unscoped local/null clients.
    return null;
  }

  return resolveCollaborationSpaceWriteDenialForActor(
    {
      id: space.id,
      groupId: space.groupId,
      ownerUserId: space.ownerUserId,
      operatingState: space.operatingState,
      members: {
        humans: space.members.humans.map((human) => ({
          userId: human.userId,
          name: human.name,
          status: human.status,
          ...(typeof (human as { email?: string | null }).email === "string"
            ? { email: (human as { email?: string | null }).email }
            : human.userId.includes("@")
              ? { email: human.userId }
              : {}),
          ...(typeof (human as { handle?: string | null }).handle === "string"
            ? { handle: (human as { handle?: string | null }).handle }
            : {}),
          ...((human as { governanceRole?: string | null }).governanceRole
            ? { governanceRole: (human as { governanceRole?: string | null }).governanceRole }
            : {}),
        })),
      },
    },
    actor,
  );
}

function resolveRecentGroupAssistantBotIds(params: {
  bots: GroupDiscussionBotTarget[];
  messages: unknown[];
}) {
  const botIdentities = new Map<string, string>();
  for (const bot of params.bots) {
    const normalizedAgentId = normalizeAgentIdentifier(bot.agentId);
    if (!normalizedAgentId) {
      continue;
    }
    botIdentities.set(normalizedAgentId, normalizedAgentId);
    const normalizedName = normalizeMentionIdentity(bot.name);
    if (normalizedName) {
      botIdentities.set(normalizedName, normalizedAgentId);
    }
  }

  const recentBotIds: string[] = [];
  const seenBotIds = new Set<string>();
  for (const message of [...params.messages].toReversed()) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = (message as { role?: unknown }).role;
    if (role !== "assistant") {
      continue;
    }
    const normalizedSenderLabel = normalizeMentionIdentity(
      (message as { senderLabel?: unknown }).senderLabel as string | undefined,
    );
    if (!normalizedSenderLabel) {
      continue;
    }
    const matchedBotId = botIdentities.get(normalizedSenderLabel);
    if (!matchedBotId || seenBotIds.has(matchedBotId)) {
      continue;
    }
    seenBotIds.add(matchedBotId);
    recentBotIds.push(matchedBotId);
    if (recentBotIds.length >= GROUP_DISCUSSION_VISIBLE_TURN_LIMIT) {
      break;
    }
  }
  return recentBotIds;
}

function matchGroupDiscussionSession(params: {
  key: string;
  entry: SessionEntry;
  groupId: string;
}) {
  const normalizedGroupId = params.groupId.trim().toLowerCase();
  const normalizedKey = params.key.trim().toLowerCase();
  if (normalizedKey === `space:${normalizedGroupId}`) {
    return true;
  }
  if (normalizedKey.endsWith(`:space:${normalizedGroupId}`)) {
    return true;
  }
  const candidates = [
    params.entry.groupId,
    params.entry.space,
    params.entry.collaborationGroupProfile?.groupId,
    resolveSessionParticipationGroupId(params.entry.collaborationParticipationOverlay),
  ]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  return candidates.includes(normalizedGroupId);
}

function isAgentScopedGroupDiscussionSessionKey(key: string) {
  const parsed = parseAgentSessionKey(key);
  if (!parsed) {
    return false;
  }
  const rest = parsed.rest.trim().toLowerCase();
  return rest.includes(":space:") && !rest.startsWith("space:");
}

function isEligibleGroupBotSession(params: { key: string; entry: SessionEntry; groupId: string }) {
  if (!matchGroupDiscussionSession(params)) {
    return false;
  }
  if (!parseAgentSessionKey(params.key)) {
    return false;
  }
  if (params.entry.chatType === "direct") {
    return false;
  }
  return (
    isAgentScopedGroupDiscussionSessionKey(params.key) ||
    params.entry.chatType === "group" ||
    params.entry.chatType === "channel" ||
    Boolean(params.entry.collaborationParticipationOverlay)
  );
}

function resolveBotDisplayName(params: {
  target: GroupDiscussionBotTarget;
  space?: GatewayCollaborationSpaceSnapshot | null;
  entry?: SessionEntry;
}) {
  const memberName = params.space?.members.bots.find(
    (bot) => bot.agentId.trim().toLowerCase() === params.target.agentId.trim().toLowerCase(),
  )?.name;
  return (
    memberName?.trim() ||
    params.entry?.displayName?.trim() ||
    params.entry?.label?.trim() ||
    params.target.agentId
  );
}

async function resolveGroupDiscussionScope(
  rawSessionKey: string,
  client: GatewayClient | null,
  deps?: {
    listCollaborationSpaces?: typeof listGatewayCollaborationSpaces;
    logGateway?: { warn?: (message: string) => void } | null;
  },
): Promise<GroupDiscussionScope> {
  const groupId = extractSpaceAliasGroupId(rawSessionKey);
  if (!groupId) {
    throw new Error("invalid collaboration group session key");
  }
  const cfg = loadConfig();
  const profile = resolveSecurityProfile(cfg, process.env);
  const tenantCtx =
    profile.profile === "managed_enterprise" ? await resolveTenantContext(client) : null;
  const groupWorkspaceDir = resolveTrustedGroupLocator({
    groupId,
    tenantId: tenantCtx?.tenantId ?? null,
    profile: profile.profile,
    cfg,
  });
  const resolveAgentStorePath = await buildSessionStorePathResolver(client, cfg);
  const runtimeOrganizationContext = await resolveRuntimeOrganizationContext({
    cfg,
    agentId: "main",
    workspaceDir: groupWorkspaceDir,
    sessionKey: rawSessionKey,
    sessionEntry: {
      sessionId: resolveCollaborationSpaceSessionId({ groupId }),
      updatedAt: 0,
      groupId,
      space: groupId,
    },
  });
  const listSpaces = deps?.listCollaborationSpaces ?? listGatewayCollaborationSpaces;
  let spaces: Awaited<ReturnType<typeof listGatewayCollaborationSpaces>>;
  try {
    spaces = await listSpaces();
  } catch (err) {
    deps?.logGateway?.warn?.(
      `group discussion scope: failed to list collaboration spaces: ${String(err)}`,
    );
    throw new CollaborationSpacePermissionsError();
  }
  const managedSpace =
    spaces.spaces.find(
      (space) =>
        space.groupId.trim().toLowerCase() === groupId.toLowerCase() ||
        space.id.trim().toLowerCase() === groupId.toLowerCase(),
    ) ?? null;
  if (!managedSpace) {
    deps?.logGateway?.warn?.(
      `group discussion scope: catalog miss after write ACL (groupId=${groupId})`,
    );
    throw new CollaborationSpacePermissionsError();
  }
  const learningSnapshot = managedSpace
    ? await loadGatewayCollaborationLearningSnapshot({ groupId: managedSpace.groupId })
    : null;
  const activeBotIds = new Set(
    (managedSpace?.members.bots ?? [])
      .filter((bot) => bot.status === "active")
      .map((bot) => bot.agentId.trim().toLowerCase()),
  );
  if (managedSpace && activeBotIds.size > 0) {
    await ensureGatewayCollaborationGroupSessions({
      groupId,
      title: managedSpace.title?.trim() || managedSpace.groupId,
      activeBotIds: [...activeBotIds],
      resolveAgentStorePath,
    });
  }
  const refreshedStore = loadCombinedSessionStoreForGateway(cfg, { resolveAgentStorePath }).store;
  const canonicalSessionKey = toCollaborationSpaceSessionKey(groupId).toLowerCase();
  const botsByAgentId = new Map<string, GroupDiscussionBotTarget>();

  for (const bot of managedSpace?.members.bots ?? []) {
    const agentId = bot.agentId.trim().toLowerCase();
    if (!agentId || bot.status !== "active") {
      continue;
    }
    if (
      !isRosterAllowedGroupDiscussionBot({
        agentId,
        activeMemberBotIds: activeBotIds,
        hasManagedSpace: Boolean(managedSpace),
      })
    ) {
      continue;
    }
    botsByAgentId.set(agentId, {
      agentId,
      name: bot.name?.trim() || agentId,
      sessionKey: canonicalSessionKey,
      updatedAt: 0,
    });
  }

  // Leftover `agent:…:space:` rows may enrich label/recency. They are never
  // dispatch destinations — one group store is `space:<groupId>`.
  for (const [key, entry] of Object.entries(refreshedStore)) {
    if (!entry || !isEligibleGroupBotSession({ key, entry, groupId })) {
      continue;
    }
    const parsed = parseAgentSessionKey(key);
    const agentId = (
      resolveSessionParticipationOverlay({
        field: entry.collaborationParticipationOverlay,
        botId: parsed?.agentId,
      })?.botId?.trim() ||
      parsed?.agentId?.trim() ||
      ""
    ).toLowerCase();
    if (!agentId) {
      continue;
    }
    const previous = botsByAgentId.get(agentId);
    if (!previous) {
      continue;
    }
    const updatedAt = entry.updatedAt ?? 0;
    if (previous.updatedAt >= updatedAt) {
      continue;
    }
    const target: GroupDiscussionBotTarget = {
      ...previous,
      sessionKey: canonicalSessionKey,
      updatedAt,
    };
    botsByAgentId.set(agentId, {
      ...target,
      name: resolveBotDisplayName({ target, space: managedSpace, entry }),
    });
  }

  const bots = [...botsByAgentId.values()].toSorted(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const { entry: groupSessionEntry, storePath: groupSessionStorePath } =
    await loadGroupSessionEntry(rawSessionKey, client);
  const recentAssistantBotIds =
    groupSessionEntry?.sessionId && groupSessionStorePath
      ? resolveRecentGroupAssistantBotIds({
          bots,
          messages: readSessionMessages(
            groupSessionEntry.sessionId,
            groupSessionStorePath,
            groupSessionEntry.sessionFile,
          ),
        })
      : [];
  const groupProfile =
    Object.values(refreshedStore).find((entry) =>
      entry ? matchGroupDiscussionSession({ key: "", entry, groupId }) : false,
    )?.collaborationGroupProfile ?? undefined;
  const operatingState =
    learningSnapshot?.groupOperatingState ?? managedSpace?.operatingState ?? undefined;
  const blockedAgentIds = await resolveBlockedAgentIdsForCurrentTask({
    groupId,
    currentTaskId: operatingState?.activeContext.currentTaskId,
  });
  // P1-A5 ③ BP-15: 4-source coordinator via governance lane (default legacy =
  // org → managedSpace → governance → groupProfile, non-steward). Reads of
  // multi-source fields live only in the composition-root helper.
  const standingCoordinatorBotId =
    resolveGovernanceLaneCoordinatorBotId({
      runtimeOrganizationContext,
      managedSpace,
      operatingState: operatingState ?? null,
      groupProfile,
      cfg,
    }).coordinatorBotId || null;
  return {
    groupId,
    rawSessionKey,
    title: managedSpace?.title?.trim() || groupProfile?.groupId || groupId,
    coordinatorBotId: standingCoordinatorBotId,
    ...(groupProfile ? { groupProfile } : {}),
    ...(managedSpace?.members ? { members: managedSpace.members } : {}),
    ...(operatingState !== undefined ? { operatingState } : {}),
    ...(recentAssistantBotIds.length > 0 ? { recentAssistantBotIds } : {}),
    ...(blockedAgentIds.length > 0 ? { blockedAgentIds } : {}),
    bots,
    tenantId: tenantCtx?.tenantId ?? managedSpace?.tenantId ?? null,
  };
}

async function resolveGroupPublicSessionFile(params: {
  groupId: string;
  sessionId: string;
  storePath: string;
  existingSessionFile?: string;
  client: GatewayClient | null;
}): Promise<string> {
  let tenantId: string | null = null;
  try {
    const tenantCtx = await resolveTenantContextForSessionStore(params.client);
    tenantId = tenantCtx?.tenantId ?? null;
  } catch {
    tenantId = null;
  }
  try {
    return await bindGroupPublicTranscript({
      groupId: params.groupId,
      sessionId: params.sessionId,
      storePath: params.storePath,
      existingSessionFile: params.existingSessionFile,
      tenantId,
    });
  } catch {
    // Fail open to the canonical shared path so writes still land on one file.
    return resolveGroupPublicTranscriptPath(params.groupId);
  }
}

async function ensureGroupSessionEntry(params: GroupDiscussionScope, client: GatewayClient | null) {
  const { storePath } = await loadSessionEntryForClient("main", client);
  const normalizedKey = params.rawSessionKey.trim().toLowerCase();
  const entry = await updateSessionStore(
    storePath,
    (store) => {
      const existing = store[normalizedKey];
      const sessionId = resolveCollaborationSpaceSessionId({
        groupId: params.groupId,
        existingSessionId: existing?.sessionId,
      });
      const next: SessionEntry = {
        ...existing,
        sessionId,
        updatedAt: Date.now(),
        displayName: params.title,
        groupId: params.groupId,
        space: params.groupId,
        chatType: "group",
        // Placeholder — replaced with bound shared path immediately below.
        sessionFile: existing?.sessionFile,
        ...(params.groupProfile ? { collaborationGroupProfile: params.groupProfile } : {}),
      };
      store[normalizedKey] = next;
      return next;
    },
    { activeSessionKey: normalizedKey },
  );
  const sessionFile = await resolveGroupPublicSessionFile({
    groupId: params.groupId,
    sessionId: entry.sessionId,
    storePath,
    existingSessionFile: entry.sessionFile,
    client,
  });
  if (entry.sessionFile !== sessionFile) {
    const bound = await updateSessionStore(
      storePath,
      (store) => {
        const existing = store[normalizedKey] ?? entry;
        const next: SessionEntry = {
          ...existing,
          sessionId: existing.sessionId ?? entry.sessionId,
          sessionFile,
          updatedAt: Date.now(),
          groupId: params.groupId,
          space: params.groupId,
          chatType: "group",
        };
        store[normalizedKey] = next;
        return next;
      },
      { activeSessionKey: normalizedKey },
    );
    return { storePath, entry: bound };
  }
  return { storePath, entry: { ...entry, sessionFile } };
}

async function loadGroupSessionEntry(rawSessionKey: string, client: GatewayClient | null) {
  const { cfg, storePath } = await loadSessionEntryForClient("main", client);
  const store = loadSessionStore(storePath);
  const groupId = extractGroupIdFromChatSessionKey(rawSessionKey);
  if (!groupId) {
    const fallbackKey = rawSessionKey.trim().toLowerCase();
    return {
      cfg,
      storePath,
      entry: findCollaborationSpaceStoreEntry(store, fallbackKey),
      canonicalKey: fallbackKey,
    };
  }
  const canonicalKey = toCollaborationSpaceSessionKey(groupId);
  const existing = findCollaborationSpaceStoreEntry(store, canonicalKey);
  const sessionId = resolveCollaborationSpaceSessionId({
    groupId,
    existingSessionId: existing?.sessionId,
  });
  const sessionFile = await resolveGroupPublicSessionFile({
    groupId,
    sessionId,
    storePath,
    existingSessionFile: existing?.sessionFile,
    client,
  });
  const entry = {
    ...existing,
    sessionId,
    sessionFile,
    groupId,
    space: groupId,
    chatType: "group" as const,
    updatedAt: Date.now(),
  };
  await updateSessionStore(
    storePath,
    (nextStore) => {
      nextStore[canonicalKey] = entry;
    },
    { activeSessionKey: canonicalKey },
  );
  return { cfg, storePath, entry, canonicalKey };
}

const ARCHIVE_FILENAME_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl\.(reset|deleted)\.[A-Za-z0-9._:-]+$/;
const CHAT_ARCHIVES_LIST_LIMIT = 100;
const CHAT_ARCHIVES_SCAN_LIMIT = 500;

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Read the `cwd` from a transcript's first `type=session` line (bounded 64KB read). */
function readTranscriptSessionCwd(filePath: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(65536);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const chunk = buf.toString("utf8", 0, bytes);
    const nlIndex = chunk.indexOf("\n");
    const firstLine = nlIndex >= 0 ? chunk.slice(0, nlIndex) : chunk;
    const parsed = JSON.parse(firstLine) as { type?: string; cwd?: unknown };
    if (parsed?.type === "session" && typeof parsed.cwd === "string" && parsed.cwd.trim()) {
      return parsed.cwd;
    }
  } catch {
    // Not a readable session transcript → no attributable cwd.
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/** Freeze pins P5:1001 / P1:1005 / P1:1819.
 * Shorten this header when imports above grow.
 */
async function resolveCallerWorkspaceCwd(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  agentId: string;
  client: GatewayClient | null;
}): Promise<string | null> {
  const ownerId = extractEmployeeStewardUserIdFromSessionKey(params.sessionKey);
  const stewardException = Boolean(
    ownerId &&
    isEmployeeBuiltinStewardSession({ sessionKey: params.sessionKey, agentId: params.agentId }),
  );
  const profile = resolveSecurityProfile(params.cfg, process.env);
  let authorized: string | null = null;
  try {
    const context = await resolveKnowledgeSourceContext(params.client);
    if (context.userId?.trim() || params.client?.platformUserId?.trim() || ownerId) {
      authorized = await resolveAuthorizedToolCwd({
        client: params.client,
        cfg: params.cfg,
        userId: context.userId?.trim() || params.client?.platformUserId?.trim() || ownerId || "",
        agentId: params.agentId,
        purpose: "chat.transcript.cwd",
        stewardException,
      });
    }
  } catch {
    authorized = null;
  }
  return resolveWorkspaceDirAfterAuthorization({
    profile: profile.profile,
    authorizedCwd: authorized,
    personalFallback: () => {
      // Legacy locator fallback is Personal Local only (Managed has no path fallback).
      if (stewardException && ownerId) {
        return realpathOrSelf(
          resolveLiveRobotWriteRoot({
            agentId: params.agentId,
            userId: ownerId,
            sessionKey: params.sessionKey,
            configuredDefaultWorkspace: params.cfg.agents?.defaults?.workspace,
          }),
        ); // resolveEmployeeBuiltinStewardWorkspaceDir
      }
      try {
        // Intentionally sync-only personal fallback; client tenant adapter is not used here.
        return realpathOrSelf(
          resolveLiveRobotWriteRoot({
            agentId: params.agentId,
            configuredDefaultWorkspace: params.cfg.agents?.defaults?.workspace,
          }),
        ); // resolveAgentWorkspaceDir
      } catch {
        return null;
      }
    },
  });
}

type ChatArchiveEntry = {
  archiveId: string;
  reason: "reset" | "deleted";
  archivedAt: number;
  sizeBytes: number;
};

/** List archived transcripts in this agent dir that belong to the caller (cwd-gated). */
export function listOwnedSessionArchives(params: {
  transcriptsDir: string;
  callerWorkspaceCwd: string | null;
}): ChatArchiveEntry[] {
  if (!params.callerWorkspaceCwd) {
    return [];
  }
  let files: string[];
  try {
    files = fs.readdirSync(params.transcriptsDir);
  } catch {
    return [];
  }
  const out: ChatArchiveEntry[] = [];
  let scanned = 0;
  for (const name of files) {
    const match = /\.jsonl\.(reset|deleted)\./.exec(name);
    if (!match || !ARCHIVE_FILENAME_RE.test(name)) {
      continue;
    }
    if (scanned >= CHAT_ARCHIVES_SCAN_LIMIT) {
      break;
    }
    scanned += 1;
    const full = path.join(params.transcriptsDir, name);
    const archiveCwd = readTranscriptSessionCwd(full);
    if (!archiveCwd || realpathOrSelf(archiveCwd) !== params.callerWorkspaceCwd) {
      continue; // cwd security gate: not the caller's own workspace.
    }
    let sizeBytes = 0;
    let archivedAt = Date.now();
    try {
      const st = fs.statSync(full);
      sizeBytes = st.size;
      archivedAt = st.mtimeMs;
    } catch {
      // ignore stat failure
    }
    out.push({ archiveId: name, reason: match[1] as "reset" | "deleted", archivedAt, sizeBytes });
  }
  return out
    .toSorted((left, right) => right.archivedAt - left.archivedAt)
    .slice(0, CHAT_ARCHIVES_LIST_LIMIT);
}

/**
 * Shared history bounding/sanitization pipeline (live + archived transcripts).
 * When `sessionId` is set and history cursor is enabled, pages via opaque
 * `before` / `nextBefore` (CL-P1-02). Archives omit sessionId → legacy tail-slice.
 */
export function boundChatHistoryMessages(params: {
  rawMessages: unknown[];
  limit: number | undefined;
  includeTools: boolean;
  sessionId?: string;
  before?: string | null;
  historyCursorEnabled?: boolean;
}): {
  messages: unknown[];
  placeholderCount: number;
  nextBefore?: string | null;
  hasMore?: boolean;
} {
  const hardMax = 1000;
  const defaultLimit = 200;
  const requested = typeof params.limit === "number" ? params.limit : defaultLimit;
  const max = Math.min(hardMax, Math.max(1, requested));
  // Cursor indexes the client-visible list (tools stripped when requested).
  const visible = params.includeTools ? params.rawMessages : stripToolMessages(params.rawMessages);
  const useCursor =
    typeof params.sessionId === "string" &&
    params.sessionId.length > 0 &&
    params.historyCursorEnabled !== false;

  let page: unknown[];
  let nextBefore: string | null | undefined;
  let hasMore: boolean | undefined;
  if (useCursor && params.sessionId) {
    const paged = pageHistoryMessages({
      messages: visible,
      limit: max,
      sessionId: params.sessionId,
      before: params.before,
    });
    page = paged.messages;
    nextBefore = paged.nextBefore;
    hasMore = paged.hasMore;
  } else {
    page = visible.length > max ? visible.slice(-max) : visible;
  }

  const sanitized = stripEnvelopeFromMessages(page);
  const normalized = sanitizeChatHistoryMessages(sanitized);
  const maxHistoryBytes = getMaxChatHistoryMessagesBytes();
  const perMessageHardCap = Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes);
  const replaced = replaceOversizedChatHistoryMessages({
    messages: normalized,
    maxSingleMessageBytes: perMessageHardCap,
  });
  const capped = capArrayByJsonBytes(replaced.messages, maxHistoryBytes).items;
  const bounded = enforceChatHistoryFinalBudget({ messages: capped, maxBytes: maxHistoryBytes });
  return {
    messages: bounded.messages,
    placeholderCount: replaced.replacedCount + bounded.placeholderCount,
    ...(useCursor ? { nextBefore: nextBefore ?? null, hasMore: Boolean(hasMore) } : {}),
  };
}

/** Read a specific archived transcript, enforcing filename + path + cwd-ownership gates. */
export function readOwnedArchiveMessages(params: {
  transcriptsDir: string;
  callerWorkspaceCwd: string | null;
  archiveId: string;
  limit: number | undefined;
  includeTools: boolean;
}): { ok: true; messages: unknown[] } | { ok: false; error: string } {
  const id = params.archiveId;
  if (!ARCHIVE_FILENAME_RE.test(id)) {
    return { ok: false, error: "invalid archiveId" };
  }
  const archivePath = path.join(params.transcriptsDir, id);
  const realDir = realpathOrSelf(params.transcriptsDir);
  const realArchive = realpathOrSelf(archivePath);
  if (realArchive !== path.join(realDir, id) && !realArchive.startsWith(realDir + path.sep)) {
    return { ok: false, error: "archiveId resolves outside the session store" };
  }
  if (!fs.existsSync(archivePath)) {
    return { ok: false, error: "archived session not found" };
  }
  const archiveCwd = readTranscriptSessionCwd(archivePath);
  if (
    !params.callerWorkspaceCwd ||
    !archiveCwd ||
    realpathOrSelf(archiveCwd) !== params.callerWorkspaceCwd
  ) {
    return { ok: false, error: "archived session is not accessible" };
  }
  const archivedSessionId = id.split(".jsonl.")[0] ?? "";
  const rawMessages = readSessionMessages(archivedSessionId, undefined, archivePath);
  const { messages } = boundChatHistoryMessages({
    rawMessages,
    limit: params.limit,
    includeTools: params.includeTools,
  });
  return { ok: true, messages };
}

/** Minimal client shape the group-transcript label resolver reads (id + device displayName).
 *  Accepts both GatewayClientInfo and the raw connect-params client (broader `mode` union). */
type GroupTranscriptSenderClient = { id?: string | null; displayName?: string | null };

function resolveGroupTranscriptSenderLabel(clientInfo?: GroupTranscriptSenderClient | null) {
  const clientId = clientInfo?.id?.trim().toLowerCase();
  const isWebClient =
    clientId === GATEWAY_CLIENT_IDS.CONTROL_UI ||
    clientId === GATEWAY_CLIENT_IDS.WEBCHAT ||
    clientId === GATEWAY_CLIENT_IDS.WEBCHAT_UI;

  // 设备配对名（Chrome · Mac）仅用于设备列表，不能当作群聊发言人。
  if (!isWebClient) {
    const displayName = clientInfo?.displayName?.trim();
    if (displayName) {
      return displayName;
    }
  }

  if (!clientId || isWebClient) {
    return undefined;
  }
  return clientInfo?.id?.trim() || undefined;
}

/** 群聊 transcript 展示名：优先平台用户 displayName，不用浏览器设备名（Chrome · Mac）。 */
async function resolveChatTranscriptSenderLabel(
  client?: GatewayClient | null,
): Promise<string | undefined> {
  const email = client?.user?.trim().toLowerCase();
  if (email) {
    try {
      const cfg = loadConfig();
      const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
      if (authConfig?.enabled) {
        const store = await loadPlatformAuthStore(authConfig);
        const user = findUserByEmail(store, email);
        const displayName = user?.displayName?.trim();
        if (displayName) {
          return displayName;
        }
      }
    } catch {
      // fall through to email local-part
    }
    const localPart = email.split("@")[0]?.trim();
    return localPart || email;
  }
  return resolveGroupTranscriptSenderLabel(client?.connect?.client);
}

type ChatSendDeliveryEntry = {
  deliveryContext?: {
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: string | number;
  };
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
};

type ChatSendOriginatingRoute = {
  originatingChannel: string;
  originatingTo?: string;
  accountId?: string;
  messageThreadId?: string | number;
  explicitDeliverRoute: boolean;
};

function resolveChatSendOriginatingRoute(params: {
  client?: { mode?: string | null; id?: string | null } | null;
  deliver?: boolean;
  entry?: ChatSendDeliveryEntry;
  hasConnectedClient?: boolean;
  mainKey?: string;
  sessionKey: string;
}): ChatSendOriginatingRoute {
  const shouldDeliverExternally = params.deliver === true;
  if (!shouldDeliverExternally) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  const routeChannelCandidate = normalizeMessageChannel(
    params.entry?.deliveryContext?.channel ?? params.entry?.lastChannel,
  );
  const routeToCandidate = params.entry?.deliveryContext?.to ?? params.entry?.lastTo;
  const routeAccountIdCandidate =
    params.entry?.deliveryContext?.accountId ?? params.entry?.lastAccountId ?? undefined;
  const routeThreadIdCandidate =
    params.entry?.deliveryContext?.threadId ?? params.entry?.lastThreadId;
  if (params.sessionKey.length > CHAT_SEND_SESSION_KEY_MAX_LENGTH) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  const parsedSessionKey = parseAgentSessionKey(params.sessionKey);
  const sessionScopeParts = (parsedSessionKey?.rest ?? params.sessionKey)
    .split(":", 3)
    .filter(Boolean);
  const sessionScopeHead = sessionScopeParts[0];
  const sessionChannelHint = normalizeMessageChannel(sessionScopeHead);
  const normalizedSessionScopeHead = (sessionScopeHead ?? "").trim().toLowerCase();
  const sessionPeerShapeCandidates = [sessionScopeParts[1], sessionScopeParts[2]]
    .map((part) => (part ?? "").trim().toLowerCase())
    .filter(Boolean);
  const isChannelAgnosticSessionScope = CHANNEL_AGNOSTIC_SESSION_SCOPES.has(
    normalizedSessionScopeHead,
  );
  const isChannelScopedSession = sessionPeerShapeCandidates.some((part) =>
    CHANNEL_SCOPED_SESSION_SHAPES.has(part),
  );
  const hasLegacyChannelPeerShape =
    !isChannelScopedSession &&
    typeof sessionScopeParts[1] === "string" &&
    sessionChannelHint === routeChannelCandidate;
  const isFromWebchatClient = isWebchatClient(params.client);
  const configuredMainKey = (params.mainKey ?? "main").trim().toLowerCase();
  const isConfiguredMainSessionScope =
    normalizedSessionScopeHead.length > 0 && normalizedSessionScopeHead === configuredMainKey;

  // Webchat/Control UI clients never inherit external delivery routes, even when
  // accessing channel-scoped sessions. External routes are only for non-webchat
  // clients where the session key explicitly encodes an external target.
  // Preserve the old configured-main contract: any connected non-webchat client
  // may inherit the last external route even when client metadata is absent.
  const canInheritDeliverableRoute = Boolean(
    !isFromWebchatClient &&
    sessionChannelHint &&
    sessionChannelHint !== INTERNAL_MESSAGE_CHANNEL &&
    ((!isChannelAgnosticSessionScope && (isChannelScopedSession || hasLegacyChannelPeerShape)) ||
      (isConfiguredMainSessionScope && params.hasConnectedClient)),
  );
  const hasDeliverableRoute =
    canInheritDeliverableRoute &&
    routeChannelCandidate &&
    routeChannelCandidate !== INTERNAL_MESSAGE_CHANNEL &&
    typeof routeToCandidate === "string" &&
    routeToCandidate.trim().length > 0;

  if (!hasDeliverableRoute) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  return {
    originatingChannel: routeChannelCandidate,
    originatingTo: routeToCandidate,
    accountId: routeAccountIdCandidate,
    messageThreadId: routeThreadIdCandidate,
    explicitDeliverRoute: true,
  };
}

function stripDisallowedChatControlChars(message: string): string {
  let output = "";
  for (const char of message) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      output += char;
    }
  }
  return output;
}

export function sanitizeChatSendMessageInput(
  message: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const normalized = message.normalize("NFC");
  if (normalized.includes("\u0000")) {
    return { ok: false, error: "message must not contain null bytes" };
  }
  return { ok: true, message: stripDisallowedChatControlChars(normalized) };
}

function normalizeOptionalChatSystemReceipt(
  value: unknown,
): { ok: true; receipt?: string } | { ok: false; error: string } {
  if (value == null) {
    return { ok: true };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "systemProvenanceReceipt must be a string" };
  }
  const sanitized = sanitizeChatSendMessageInput(value);
  if (!sanitized.ok) {
    return sanitized;
  }
  const receipt = sanitized.message.trim();
  return { ok: true, receipt: receipt || undefined };
}

function isAcpBridgeClient(client: GatewayRequestHandlerOptions["client"]): boolean {
  const info = client?.connect?.client;
  return (
    info?.id === GATEWAY_CLIENT_NAMES.CLI &&
    info?.mode === GATEWAY_CLIENT_MODES.CLI &&
    info?.displayName === "ACP" &&
    info?.version === "acp"
  );
}

function truncateChatHistoryText(
  text: string,
  opts?: { maxChars?: number; preserveTailChars?: number },
): { text: string; truncated: boolean } {
  const maxChars = opts?.maxChars ?? CHAT_HISTORY_TEXT_MAX_CHARS;
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const preserveTail = Math.max(0, Math.min(opts?.preserveTailChars ?? 0, maxChars - 64));
  if (preserveTail > 0) {
    const headBudget = Math.max(64, maxChars - preserveTail - 20);
    return {
      text: `${text.slice(0, headBudget)}\n...(truncated)...\n${text.slice(-preserveTail)}`,
      truncated: true,
    };
  }
  return {
    text: `${text.slice(0, maxChars)}\n...(truncated)...`,
    truncated: true,
  };
}

function extractToolResultExitFooter(details: unknown): string | undefined {
  if (!details || typeof details !== "object") {
    return undefined;
  }
  const exitCode = (details as { exitCode?: unknown }).exitCode;
  if (typeof exitCode !== "number" || !Number.isFinite(exitCode)) {
    return undefined;
  }
  return `EXIT:${exitCode}`;
}

function appendToolResultExitFooter(text: string, footer: string | undefined): string {
  if (!footer) {
    return text;
  }
  if (text.includes(footer) || text.includes(`exitCode=${footer.slice("EXIT:".length)}`)) {
    return text;
  }
  // Also skip when the body already ends with a process-exit sentence.
  if (/\b(exited with code|EXIT:)\s*\d+\b/i.test(text.slice(-200))) {
    return text;
  }
  return `${text.trimEnd()}\n${footer}`;
}

function sanitizeChatHistoryContentBlock(
  block: unknown,
  expectedLanguage?: VisibleReplyLanguage | null,
  keepBody = false,
): { blocks: unknown[]; changed: boolean } {
  if (!block || typeof block !== "object") {
    return { blocks: [block], changed: false };
  }
  const entry = { ...(block as Record<string, unknown>) };
  let changed = false;
  if (typeof entry.text === "string") {
    const gated = keepBody
      ? entry.text
      : stripInlineDirectiveTagsForDisplay(
          gateChatHistoryText(entry.text, expectedLanguage),
          expectedLanguage,
        ).text;
    const visible = keepBody ? gated : stripControlChannelForDisplay(gated);
    const res = truncateChatHistoryText(visible);
    changed ||= res.truncated || res.text !== entry.text;
    entry.text = res.text;
  }
  if (typeof entry.partialJson === "string") {
    const res = truncateChatHistoryText(entry.partialJson);
    entry.partialJson = res.text;
    changed ||= res.truncated;
  }
  if (typeof entry.arguments === "string") {
    const res = truncateChatHistoryText(entry.arguments);
    entry.arguments = res.text;
    changed ||= res.truncated;
  }
  if (typeof entry.thinking === "string") {
    const res = truncateChatHistoryText(entry.thinking);
    entry.thinking = res.text;
    changed ||= res.truncated;
  }
  if ("thinkingSignature" in entry) {
    delete entry.thinkingSignature;
    changed = true;
  }
  // Top-level `data` and transcript `source.data` both count. Sibling text stays
  // on the message; this block only drops image bytes and adds the marker line.
  const image = omitImagePayloadForHistory(entry);
  if (image.changed) {
    return { blocks: image.blocks, changed: true };
  }
  return { blocks: [changed ? entry : block], changed };
}

function sanitizeChatHistoryMessage(
  message: unknown,
  expectedLanguage?: VisibleReplyLanguage | null,
): { message: unknown; changed: boolean } {
  if (!message || typeof message !== "object") {
    return { message, changed: false };
  }
  let entry = { ...(message as Record<string, unknown>) };
  let changed = false;
  const keepBody = isPeerOutboundSurfaceMessage(message);
  // Materialize 「打开成果」 artifacts from raw <<DELIVERABLE file=>> BEFORE display strip.
  if (entry.role === "assistant" && !keepBody) {
    const beforeArtifact = entry.artifact;
    const beforeArtifacts = entry.artifacts;
    entry = attachDeclaredDeliverableArtifacts(entry);
    if (entry.artifact !== beforeArtifact || entry.artifacts !== beforeArtifacts) {
      changed = true;
    }
  }
  const isToolResult = entry.role === "toolResult" || entry.role === "tool";
  const truncateOpts = isToolResult
    ? {
        maxChars: CHAT_HISTORY_TOOL_RESULT_MAX_CHARS,
        preserveTailChars: CHAT_HISTORY_TOOL_RESULT_TAIL_CHARS,
      }
    : undefined;
  const exitFooter = isToolResult ? extractToolResultExitFooter(entry.details) : undefined;

  if ("details" in entry) {
    delete entry.details;
    changed = true;
  }
  if ("usage" in entry) {
    delete entry.usage;
    changed = true;
  }
  if ("cost" in entry) {
    delete entry.cost;
    changed = true;
  }

  const truncateField = (value: string): string => {
    const gated = keepBody
      ? value
      : stripInlineDirectiveTagsForDisplay(
          gateChatHistoryText(value, expectedLanguage),
          expectedLanguage,
        ).text;
    const visible = keepBody ? gated : stripControlChannelForDisplay(gated);
    const res = truncateChatHistoryText(visible, truncateOpts);
    return appendToolResultExitFooter(res.text, exitFooter);
  };

  if (typeof entry.content === "string") {
    const next = truncateField(entry.content);
    changed ||= next !== entry.content;
    entry.content = next;
  } else if (Array.isArray(entry.content)) {
    let contentChanged = false;
    const lastTextIndex = isToolResult
      ? entry.content.reduce(
          (last: number, candidate: unknown, candidateIndex: number) =>
            candidate &&
            typeof candidate === "object" &&
            typeof (candidate as { text?: unknown }).text === "string"
              ? candidateIndex
              : last,
          -1,
        )
      : -1;
    const nextBlocks: unknown[] = [];
    entry.content.forEach((block: unknown, index: number) => {
      if (!block || typeof block !== "object") {
        nextBlocks.push(block);
        return;
      }
      if (!isToolResult) {
        const res = sanitizeChatHistoryContentBlock(block, expectedLanguage, keepBody);
        contentChanged ||= res.changed;
        nextBlocks.push(...res.blocks);
        return;
      }
      const image = omitImagePayloadForHistory(block);
      if (image.changed) {
        contentChanged = true;
        nextBlocks.push(...image.blocks);
        return;
      }
      const blockEntry = { ...(block as Record<string, unknown>) };
      if (typeof blockEntry.text === "string") {
        // Only attach the exit footer on the last text block to avoid duplicates.
        const isLastText = index === lastTextIndex;
        const visible = keepBody
          ? blockEntry.text
          : stripInlineDirectiveTagsForDisplay(
              gateChatHistoryText(blockEntry.text, expectedLanguage),
              expectedLanguage,
            ).text;
        const res = truncateChatHistoryText(visible, truncateOpts);
        const nextText = isLastText ? appendToolResultExitFooter(res.text, exitFooter) : res.text;
        if (nextText !== blockEntry.text) {
          blockEntry.text = nextText;
          contentChanged = true;
          nextBlocks.push(blockEntry);
          return;
        }
      }
      nextBlocks.push(block);
    });
    if (contentChanged) {
      entry.content = nextBlocks;
      changed = true;
    }
  }

  if (typeof entry.text === "string") {
    const next = truncateField(entry.text);
    changed ||= next !== entry.text;
    entry.text = next;
  }

  if (entry.role === "assistant" && expectedLanguage && !keepBody) {
    const applyCached = (value: string): string =>
      enforceVisibleReplyLanguageFromCache({
        text: value,
        expectedLanguage,
      });
    if (typeof entry.content === "string") {
      const next = applyCached(entry.content);
      if (next !== entry.content) {
        entry.content = next;
        changed = true;
      }
    } else if (Array.isArray(entry.content)) {
      for (const block of entry.content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const textBlock = block as { type?: unknown; text?: unknown };
        if (textBlock.type === "text" && typeof textBlock.text === "string") {
          const next = applyCached(textBlock.text);
          if (next !== textBlock.text) {
            textBlock.text = next;
            changed = true;
          }
        }
      }
    }
  }

  return { message: changed ? entry : message, changed };
}

function extractAssistantTextForSilentCheck(message: unknown): string | undefined {
  return extractMessageVisibleText(message, { role: "assistant" });
}

/** @internal exported for unit tests */
export function sanitizeChatHistoryMessagesForTest(messages: unknown[]): unknown[] {
  return sanitizeChatHistoryMessages(messages);
}

function historyMessagePlainText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const record = message as Record<string, unknown>;
  if (typeof record.content === "string") {
    return record.content;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (!Array.isArray(record.content)) {
    return "";
  }
  return record.content
    .map((block) => readTextBlock(block) ?? "")
    .filter(Boolean)
    .join("\n");
}

function sanitizeChatHistoryMessages(messages: unknown[]): unknown[] {
  if (messages.length === 0) {
    return messages;
  }
  let changed = false;
  let carriedLanguage: VisibleReplyLanguage | null = null;
  const next: unknown[] = [];
  for (const message of messages) {
    const role =
      message && typeof message === "object" ? (message as { role?: unknown }).role : undefined;
    if (role === "user") {
      const detected = detectReplyLanguage(historyMessagePlainText(message));
      if (detected === "zh" || detected === "en") {
        carriedLanguage = detected;
      }
    }
    const stamped =
      message && typeof message === "object"
        ? (message as { replyLanguage?: unknown }).replyLanguage
        : undefined;
    const expectedLanguage: VisibleReplyLanguage | null =
      stamped === "zh" || stamped === "en" ? stamped : carriedLanguage;
    if (isRestoreTaskIsolationMessage(message)) {
      changed = true;
      continue;
    }
    if (isHiddenToolUseScratchpadMessage(message, expectedLanguage)) {
      changed = true;
      continue;
    }
    // Decide control-channel / digest provenance on the ORIGINAL message before
    // display strip removes the [tool-digest] header (which would otherwise leave
    // the tool preview body looking like a normal assistant reply).
    if (role === "assistant") {
      const provenance =
        message && typeof message === "object"
          ? (message as { openbotControlChannel?: unknown }).openbotControlChannel
          : undefined;
      if (provenance === "tool-digest") {
        changed = true;
        continue;
      }
      const originalControlText = extractAssistantTextForSilentCheck(message);
      if (
        typeof originalControlText === "string" &&
        isControlChannelOnlyText(originalControlText)
      ) {
        changed = true;
        continue;
      }
    }
    const res = sanitizeChatHistoryMessage(message, expectedLanguage);
    if (
      expectedLanguage &&
      res.message &&
      typeof res.message === "object" &&
      (res.message as { role?: unknown }).role === "assistant" &&
      (res.message as { replyLanguage?: unknown }).replyLanguage !== expectedLanguage
    ) {
      const stampedMessage = res.changed
        ? (res.message as Record<string, unknown>)
        : { ...(message as Record<string, unknown>) };
      stampedMessage.replyLanguage = expectedLanguage;
      res.message = stampedMessage;
      res.changed = true;
    }
    changed ||= res.changed;
    // Drop internal pre-compaction memory-flush user prompts (not real user chat).
    if (isMemoryFlushHistoryMessage(res.message)) {
      changed = true;
      continue;
    }
    // Drop internal task-board / execution continue injectors (not real user chat).
    if (isInternalContinueHistoryMessage(res.message)) {
      changed = true;
      continue;
    }
    // Drop assistant bubbles that are only tool-digest / control markers.
    const controlText = extractAssistantTextForSilentCheck(res.message);
    if (typeof controlText === "string" && isControlChannelOnlyText(controlText)) {
      changed = true;
      continue;
    }
    // Drop assistant messages whose entire visible text is the silent reply token.
    const text = extractAssistantTextForSilentCheck(res.message);
    if (text !== undefined && isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
      changed = true;
      continue;
    }
    next.push(res.message);
  }
  return changed ? next : messages;
}

/**
 * Closing the WebSocket does not abort the run. A later `chat.history` for
 * the same session is how the new connId learns the run is still live and
 * re-subscribes to tool events.
 */
function publishActiveChatRunForHistory(params: {
  context: Pick<
    GatewayRequestContext,
    "chatAbortControllers" | "chatRunBuffers" | "registerToolEventRecipient"
  >;
  client: GatewayRequestHandlerOptions["client"];
  sessionKeys: string[];
}): ActiveChatRunSnapshot | null {
  const controllers = params.context.chatAbortControllers;
  const snapshot = resolveActiveSessionChatRun({
    sessionKeys: params.sessionKeys,
    chatAbortControllers: controllers,
    chatRunBuffers: params.context.chatRunBuffers,
  });
  const connId = typeof params.client?.connId === "string" ? params.client.connId.trim() : "";
  const wantsToolEvents = hasGatewayClientCap(
    params.client?.connect?.caps,
    GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
  );
  if (connId && wantsToolEvents) {
    for (const runId of listActiveSessionChatRunIds({
      sessionKeys: params.sessionKeys,
      chatAbortControllers: controllers,
    })) {
      params.context.registerToolEventRecipient(runId, connId);
    }
  }
  return snapshot;
}

function resolveChatHistoryIncludeTools(params: {
  includeTools: unknown;
  client: GatewayRequestHandlerOptions["client"];
}): boolean {
  if (typeof params.includeTools === "boolean") {
    return params.includeTools;
  }
  return hasGatewayClientCap(params.client?.connect?.caps, GATEWAY_CLIENT_CAPS.TOOL_EVENTS);
}

function buildOversizedHistoryPlaceholder(message?: unknown): Record<string, unknown> {
  const role =
    message &&
    typeof message === "object" &&
    typeof (message as { role?: unknown }).role === "string"
      ? (message as { role: string }).role
      : "assistant";
  const timestamp =
    message &&
    typeof message === "object" &&
    typeof (message as { timestamp?: unknown }).timestamp === "number"
      ? (message as { timestamp: number }).timestamp
      : Date.now();
  const marker = { truncated: true, reason: "oversized" };
  return {
    role,
    timestamp,
    content: [{ type: "text", text: CHAT_HISTORY_OVERSIZED_PLACEHOLDER }],
    __openbot: marker,
    __openclaw: marker,
  };
}

function replaceOversizedChatHistoryMessages(params: {
  messages: unknown[];
  maxSingleMessageBytes: number;
}): { messages: unknown[]; replacedCount: number } {
  const { messages, maxSingleMessageBytes } = params;
  if (messages.length === 0) {
    return { messages, replacedCount: 0 };
  }
  let replacedCount = 0;
  const next = messages.map((message) => {
    if (jsonUtf8Bytes(message) <= maxSingleMessageBytes) {
      return message;
    }
    replacedCount += 1;
    return buildOversizedHistoryPlaceholder(message);
  });
  return { messages: replacedCount > 0 ? next : messages, replacedCount };
}

function enforceChatHistoryFinalBudget(params: { messages: unknown[]; maxBytes: number }): {
  messages: unknown[];
  placeholderCount: number;
} {
  const { messages, maxBytes } = params;
  if (messages.length === 0) {
    return { messages, placeholderCount: 0 };
  }
  if (jsonUtf8Bytes(messages) <= maxBytes) {
    return { messages, placeholderCount: 0 };
  }
  const last = messages.at(-1);
  if (last && jsonUtf8Bytes([last]) <= maxBytes) {
    return { messages: [last], placeholderCount: 0 };
  }
  const placeholder = buildOversizedHistoryPlaceholder(last);
  if (jsonUtf8Bytes([placeholder]) <= maxBytes) {
    return { messages: [placeholder], placeholderCount: 1 };
  }
  return { messages: [], placeholderCount: 0 };
}

function sameTranscriptPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (resolvedLeft === resolvedRight) {
    return true;
  }
  try {
    return fs.realpathSync(resolvedLeft) === fs.realpathSync(resolvedRight);
  } catch {
    return false;
  }
}

function listExistingTranscriptCandidates(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
}): string[] {
  return resolveSessionTranscriptCandidates(
    params.sessionId,
    params.storePath,
    params.sessionFile,
    params.agentId,
  ).filter((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function transcriptHasMessageLines(filePath: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      if ((JSON.parse(line) as { type?: unknown }).type === "message") {
        return true;
      }
    } catch {
      // Malformed lines are not user-facing transcript rows.
    }
  }
  return false;
}

/**
 * chat.history paints resolveExistingSessionTranscriptPath (no agentId).
 * chat.restore's with-agentId candidate list can put a header stub first.
 * Prefer the file the UI paints when it holds the boundary, otherwise the
 * candidate that actually contains it, so truncation hits the visible thread.
 */
function resolveCheckpointRestoreTranscriptTarget(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  boundaryMessageId?: string | null;
}): {
  transcriptPath: string | null;
  historyPaintedPath: string | null;
  existingCandidates: string[];
} {
  const existingCandidates = listExistingTranscriptCandidates(params);
  const historyPaintedPath = params.storePath
    ? (resolveExistingSessionTranscriptPath(
        params.sessionId,
        params.storePath,
        params.sessionFile,
      ) ?? null)
    : null;
  const boundary = params.boundaryMessageId?.trim() ?? "";
  const transcriptStart = isTranscriptStartBoundary(boundary);
  let transcriptPath: string | null = null;
  if (boundary && !transcriptStart) {
    const ids = new Set([boundary]);
    if (historyPaintedPath && transcriptContainsEntryId(historyPaintedPath, ids)) {
      transcriptPath = historyPaintedPath;
    } else {
      transcriptPath =
        existingCandidates.find((candidate) => transcriptContainsEntryId(candidate, ids)) ?? null;
    }
  } else if (historyPaintedPath && transcriptHasMessageLines(historyPaintedPath)) {
    transcriptPath = historyPaintedPath;
  } else {
    transcriptPath =
      existingCandidates.find((candidate) => transcriptHasMessageLines(candidate)) ??
      historyPaintedPath ??
      existingCandidates[0] ??
      null;
  }
  if (!transcriptPath) {
    transcriptPath = historyPaintedPath ?? existingCandidates[0] ?? null;
  }
  return { transcriptPath, historyPaintedPath, existingCandidates };
}

function transcriptContainsEntryId(filePath: string, ids: ReadonlySet<string>): boolean {
  if (ids.size === 0) {
    return false;
  }
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const id = (JSON.parse(line) as { id?: unknown }).id;
      if (typeof id === "string" && ids.has(id)) {
        return true;
      }
    } catch {
      // Malformed lines cannot carry a checkpoint boundary id.
    }
  }
  return false;
}

/**
 * chat.history paints the first existing transcript candidate. The model opens
 * resolveSessionFilePath, which can be a different header-only fallback.
 * After the painted file is truncated, copy that result onto the model path
 * and drop copies that still hold removed ids so the next read cannot
 * resurrect the tail.
 */
async function materializeRewoundTranscript(params: {
  sourcePath: string;
  modelPath: string | null;
  removedMessageIds: string[];
  existingCandidates: string[];
}): Promise<string> {
  const modelPath = params.modelPath;
  const keepPath =
    modelPath && !sameTranscriptPath(modelPath, params.sourcePath) ? modelPath : params.sourcePath;
  if (modelPath && !sameTranscriptPath(modelPath, params.sourcePath)) {
    await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.promises.copyFile(params.sourcePath, modelPath);
  }
  const removed = new Set(params.removedMessageIds);
  const drop = new Set<string>();
  if (!sameTranscriptPath(params.sourcePath, keepPath)) {
    drop.add(path.resolve(params.sourcePath));
  }
  for (const candidate of params.existingCandidates) {
    if (sameTranscriptPath(candidate, keepPath)) {
      continue;
    }
    if (transcriptContainsEntryId(candidate, removed)) {
      drop.add(path.resolve(candidate));
    }
  }
  for (const filePath of drop) {
    if (sameTranscriptPath(filePath, keepPath)) {
      continue;
    }
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
  return keepPath;
}

function resolveTranscriptPath(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
}): string | null {
  const { sessionId, storePath, sessionFile, agentId } = params;
  // GROUP_PUBLIC shared transcripts live under groups/*/runtime/ — outside the
  // per-agent sessions dir, so resolveSessionFilePath would reject/fallback them.
  if (sessionFile && isGroupPublicTranscriptSessionFile(sessionFile)) {
    return path.resolve(sessionFile.trim());
  }
  if (!storePath && !sessionFile) {
    return null;
  }
  try {
    const sessionsDir = storePath ? path.dirname(storePath) : undefined;
    return resolveSessionFilePath(
      sessionId,
      sessionFile ? { sessionFile } : undefined,
      sessionsDir || agentId ? { sessionsDir, agentId } : undefined,
    );
  } catch {
    return null;
  }
}

async function resolveChatTranscriptGovernance(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  groupId?: string | null;
}): Promise<{
  tenantId: string | null;
  ownerUserId: string | null;
  groupId: string | null;
  failClosed: boolean;
}> {
  const profile = resolveSecurityProfile(params.cfg, process.env);
  const failClosed = profile.profile === "managed_enterprise";
  const tenantCtx =
    failClosed || isSharedTenantAddressingEnabled(params.cfg)
      ? await resolveTenantContext(params.client)
      : null;
  return {
    tenantId: tenantCtx?.tenantId ?? null,
    ownerUserId: tenantCtx?.userId ?? null,
    groupId: params.groupId ?? null,
    failClosed,
  };
}

async function ensureTranscriptFile(params: {
  transcriptPath: string;
  sessionId: string;
  /** Authorized workspace cwd (C17). Required for new transcripts — never process.cwd(). */
  cwd?: string | null;
  tenantId?: string | null;
  ownerUserId?: string | null;
  groupId?: string | null;
  /** When true, catalog registration failure fails the create. */
  failClosed?: boolean;
}): Promise<{
  ok: boolean;
  error?: string;
}> {
  const transcriptPath = path.resolve(params.transcriptPath);
  const created = !fs.existsSync(transcriptPath);
  const failClosed = Boolean(params.failClosed);
  const requireIdentity = failClosed;

  if (requireIdentity) {
    if (!params.tenantId) {
      return { ok: false, error: "trusted tenant context required for managed transcript" };
    }
    if (!params.ownerUserId && !params.groupId) {
      return { ok: false, error: "trusted owner context required for managed transcript" };
    }
  }

  if (!created) {
    try {
      const resourceId = resolveConversationArchiveResourceId({
        transcriptPath,
        sessionId: params.sessionId,
        tenantId: params.tenantId ?? null,
      });
      const existing = await getSharedDataGovernanceCatalog().get(resourceId);
      if (existing) {
        // Content writes require active; pending/read_only/archived/retired/purged fail closed.
        await assertConversationArchiveContentWritable({
          transcriptPath,
          sessionId: params.sessionId,
          tenantId: params.tenantId ?? null,
        });
      } else {
        await upsertConversationArchiveGovernanceRecord({
          transcriptPath,
          sessionId: params.sessionId,
          tenantId: params.tenantId ?? null,
          ownerUserId: params.ownerUserId ?? null,
          groupId: params.groupId ?? null,
          requireIdentity,
          lifecycleState: "active",
        });
      }
    } catch (err) {
      if (failClosed) {
        return {
          ok: false,
          error: `governance catalog unavailable: ${String((err as Error)?.message ?? err)}`,
        };
      }
      // Personal/local soft path: still refuse content writes against non-active envelopes.
      const message = String((err as Error)?.message ?? err);
      if (
        message.includes("governance_envelope_not_writable") ||
        message.includes("governance_catalog_missing")
      ) {
        return { ok: false, error: message };
      }
    }
    return { ok: true };
  }

  const cwd = typeof params.cwd === "string" ? params.cwd.trim() : "";
  if (!cwd) {
    return { ok: false, error: "authorized workspace cwd required to create transcript" };
  }

  let resourceId: string | null = null;
  const operationId = randomUUID();
  try {
    resourceId = await beginConversationArchiveGovernanceRegistration({
      transcriptPath,
      sessionId: params.sessionId,
      tenantId: params.tenantId ?? null,
      ownerUserId: params.ownerUserId ?? null,
      groupId: params.groupId ?? null,
      requireIdentity,
    });
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd,
    };
    fs.writeFileSync(transcriptPath, `${JSON.stringify(header)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    writeGovernanceOpMarker({
      targetPath: transcriptPath,
      operationId,
      kind: "file",
    });
    await activateConversationArchiveGovernanceRegistration({ resourceId });
    return { ok: true };
  } catch (err) {
    if (resourceId) {
      await abortConversationArchiveGovernanceRegistration({
        resourceId,
        transcriptPath,
        reason: `transcript_create_failed:${String((err as Error)?.message ?? err)}`,
        operationId,
        allowedRoots: [path.dirname(transcriptPath), transcriptPath],
      });
    }
    return {
      ok: false,
      error: `governance catalog unavailable: ${String((err as Error)?.message ?? err)}`,
    };
  }
}

function hasMentionPayload(mentions: MentionMetadata[] | undefined): mentions is MentionMetadata[] {
  return Array.isArray(mentions) && mentions.length > 0;
}

function warnMentionDeliveryIssue(params: {
  context: GatewayRequestContext;
  sessionKey: string;
  message: string;
}) {
  params.context.logGateway.warn(
    `chat.send mention delivery issue session=${params.sessionKey}: ${params.message}`,
  );
}

async function deliverChatSendMentions(params: {
  context: GatewayRequestContext;
  cfg: OpenBotConfig;
  sessionEntry?: SessionEntry;
  sessionKey: string;
  messageId: string;
  messageText: string;
  mentions?: MentionMetadata[];
  sourceAgentId: string;
  client: GatewayClient | null;
}): Promise<{ skipHostAgent: boolean }> {
  const stewardUserId = extractEmployeeStewardUserIdFromSessionKey(params.sessionKey);
  if (stewardUserId && !params.sessionKey.includes(":space:")) {
    try {
      const { routeStewardConversationMentions } =
        await import("../../conversation-task/conversation-handoff.js");
      const {
        loadPlatformAuthStoreForDiagnosis,
        resolveDiagnoseGrowthActor,
        isDiagnosisTenantAdmin,
      } = await import("../../diagnosis/diagnose-growth-locator.js");
      const actor = await resolveEmployeeWorkbenchActor(params.client).catch(() => null);
      const growth = resolveDiagnoseGrowthActor({
        tenantId:
          actor?.tenantId ??
          params.client?.sessionTenantId ??
          params.client?.sessionEnterpriseId ??
          null,
        actorUserId: actor?.userId || params.client?.platformUserId || stewardUserId,
        sessionDomain: params.client?.sessionDomain,
        sessionKind: params.client?.sessionKind,
        store: await loadPlatformAuthStoreForDiagnosis(),
      });
      const routed = await routeStewardConversationMentions({
        sessionKey: params.sessionKey,
        messageText: params.messageText,
        mentions: params.mentions,
        requesterUserId: growth?.actorUserId ?? actor?.userId ?? stewardUserId,
        tenantId:
          growth?.tenantId ??
          actor?.tenantId ??
          params.client?.sessionTenantId ??
          params.client?.sessionEnterpriseId ??
          null,
        tenantAdmin:
          growth?.tenantAdmin === true ||
          isDiagnosisTenantAdmin({
            sessionDomain: params.client?.sessionDomain,
            sessionKind: params.client?.sessionKind,
          }),
      });
      if (routed.handledRobotTask) {
        return { skipHostAgent: true };
      }
    } catch (err) {
      params.context.logGateway.warn(
        `chat.send 1:1 conversation mention routing failed session=${params.sessionKey}: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }

  if (!hasMentionPayload(params.mentions)) {
    return { skipHostAgent: false };
  }

  try {
    const workspaceDir =
      ((r) => (r.ok ? r.handle.locator : null))(resolveWorkspaceLocator({ cfg: params.cfg })) ??
      resolveLiveRobotWriteRoot({
        // resolveAgentWorkspaceDir
        agentId: params.sourceAgentId,
        configuredDefaultWorkspace: params.cfg.agents?.defaults?.workspace,
      });
    void import("../chat-w2-shadow.js").then(({ scheduleChatW2MentionShadow }) =>
      scheduleChatW2MentionShadow({
        siteId: "S16-chat-mention-workspace",
        resolvedLocator: workspaceDir,
      }),
    );
    const organizationContext = await resolveRuntimeOrganizationContext({
      cfg: params.cfg,
      agentId: params.sourceAgentId,
      workspaceDir,
      sessionEntry: params.sessionEntry,
      sessionKey: params.sessionKey,
    });
    const actor = await resolveEmployeeWorkbenchActor(params.client).catch(() => null);
    const groupId =
      extractGroupIdFromChatSessionKey(params.sessionKey) ??
      organizationContext.organization?.id ??
      undefined;
    const delivery = await MentionDelivery.deliver({
      messageId: params.messageId,
      messageText: params.messageText,
      mentions: params.mentions,
      sourceAgentId: params.sourceAgentId,
      sourceUserId: actor?.userId,
      organizationId: organizationContext.organization?.id,
      groupId,
      sessionKey: params.sessionKey,
      tenantId: actor?.tenantId,
      context: organizationContext,
      cfg: params.cfg,
      workspaceDir,
      stateTracker: {
        createMentionState(entry) {
          return createMentionState({
            cfg: params.cfg,
            workspaceDir,
            organizationId: entry.organization_id,
            mention_id: entry.mention_id,
            source_message_id: entry.source_message_id,
            source_agent_id: entry.source_agent_id,
            target_agent_id: entry.target_agent_id,
            now: entry.timestamp,
            payload: entry.payload,
          });
        },
      },
    });
    if (delivery.errors.length > 0) {
      warnMentionDeliveryIssue({
        context: params.context,
        sessionKey: params.sessionKey,
        message: delivery.errors
          .map((error) => `${error.targetKind ?? "agent"}:${error.agentId}:${error.reason}`)
          .join("; "),
      });
    }
  } catch (err) {
    warnMentionDeliveryIssue({
      context: params.context,
      sessionKey: params.sessionKey,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return { skipHostAgent: false };
}

async function resolveAndBindChatTurnTenant(
  client: GatewayClient | null | undefined,
  sessionKey?: string,
): Promise<string | null> {
  const stamped = client?.sessionEnterpriseId?.trim() || null;
  let tenantId = stamped;
  if (!tenantId) {
    try {
      // Prefer session-store inference so domain-less / dual-role platform sessions
      // with a real membership still bind a turn tenant (avoids false
      // workspace_authorization_failed on cookie-gap / header-only connects).
      const ctx = await resolveTenantContextForSessionStore(client ?? null);
      tenantId = ctx?.tenantId?.trim() || null;
      if (tenantId && client) {
        client.sessionEnterpriseId = tenantId;
        if (!client.sessionTenantId?.trim()) {
          client.sessionTenantId = tenantId;
        }
        // Fill missing domain only — never clobber an explicit platform domain.
        if (!client.sessionDomain) {
          client.sessionDomain = ctx?.domain ?? "enterprise";
        }
      }
    } catch {
      tenantId = null;
    }
  }
  const groupId = sessionKey ? extractGroupIdFromChatSessionKey(sessionKey) : null;
  const owner = resolveClientStewardOwnerId({
    platformUserId: client?.platformUserId,
    user: client?.user,
  });
  if (tenantId && groupId && owner) {
    upsertAuthorizedGroupChatAclMember({
      tenantId,
      groupId,
      memberUserId: owner,
    });
  }
  return tenantId;
}

async function loadTranscriptHistoryHelpers() {
  const [index, sessionFs] = await Promise.all([
    import("../../conversations/transcript-index.js"),
    import("../session-utils.fs.js"),
  ]);
  return {
    readPagedChatHistoryMessages: index.readPagedChatHistoryMessages,
    syncTranscriptIndex: index.syncTranscriptIndex,
    resolveExistingSessionTranscriptPath: sessionFs.resolveExistingSessionTranscriptPath,
  };
}

function transcriptHasIdempotencyKey(transcriptPath: string, idempotencyKey: string): boolean {
  try {
    const lines = fs.readFileSync(transcriptPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as { message?: { idempotencyKey?: unknown } };
      if (parsed?.message?.idempotencyKey === idempotencyKey) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function appendAssistantTranscriptMessage(params: {
  message: string;
  label?: string;
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  createIfMissing?: boolean;
  /** Authorized workspace cwd for new transcript headers (C17). */
  workspaceCwd?: string | null;
  tenantId?: string | null;
  ownerUserId?: string | null;
  groupId?: string | null;
  failClosed?: boolean;
  idempotencyKey?: string;
  abortMeta?: {
    aborted: true;
    origin: AbortOrigin;
    runId: string;
  };
  cronResult?: {
    jobId: string;
    runId?: string;
    jobName?: string;
    kind?: "result" | "parked_notice";
  };
  /** Sanitized 大白引导卡片，随 assistant 转写保留。 */
  guideCard?: Record<string, unknown>;
  /** Legacy restore receipt. Kept in the file, excluded from the task main line. */
  restoreTaskIsolation?: ReturnType<typeof restoreTaskIsolationStamp>;
  peerDelivery?: {
    senderLabel: string;
    sourceSessionKey: string;
    sourcePlatformUserId?: string;
  };
  peerOutbound?: {
    targets: Array<{ agentId?: string; label: string; sessionKey?: string }>;
  };
  /** Declared deliverable chip(s) + publish view — persist with stripped bubble text. */
  artifact?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  deliverablePublish?: Record<string, unknown>;
}): Promise<TranscriptAppendResult> {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }

  if (!fs.existsSync(transcriptPath)) {
    if (!params.createIfMissing) {
      return { ok: false, error: "transcript file not found" };
    }
    const ensured = await ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
      cwd: params.workspaceCwd,
      tenantId: params.tenantId,
      ownerUserId: params.ownerUserId,
      groupId: params.groupId,
      failClosed: params.failClosed,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "failed to create transcript file" };
    }
  } else {
    const synced = await ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
      cwd: params.workspaceCwd,
      tenantId: params.tenantId,
      ownerUserId: params.ownerUserId,
      groupId: params.groupId,
      failClosed: params.failClosed,
    });
    if (!synced.ok && params.failClosed) {
      return { ok: false, error: synced.error ?? "governance catalog unavailable" };
    }
  }

  if (params.idempotencyKey && transcriptHasIdempotencyKey(transcriptPath, params.idempotencyKey)) {
    return { ok: true };
  }

  if (params.peerDelivery) {
    return appendInjectedPeerMessageToTranscript({
      transcriptPath,
      message: params.message,
      senderLabel: params.peerDelivery.senderLabel,
      sourceSessionKey: params.peerDelivery.sourceSessionKey,
      sourcePlatformUserId: params.peerDelivery.sourcePlatformUserId,
    });
  }

  if (params.peerOutbound && params.peerOutbound.targets.length > 0) {
    return appendInjectedPeerOutboundMessageToTranscript({
      transcriptPath,
      message: params.message,
      targets: params.peerOutbound.targets,
    });
  }

  return appendInjectedAssistantMessageToTranscript({
    transcriptPath,
    message: params.message,
    label: params.label,
    idempotencyKey: params.idempotencyKey,
    abortMeta: params.abortMeta,
    cronResult: params.cronResult,
    ...(params.guideCard ? { guideCard: params.guideCard } : {}),
    ...(params.restoreTaskIsolation ? { restoreTaskIsolation: params.restoreTaskIsolation } : {}),
    ...(params.artifact ? { artifact: params.artifact } : {}),
    ...(params.artifacts ? { artifacts: params.artifacts } : {}),
    ...(params.deliverablePublish ? { deliverablePublish: params.deliverablePublish } : {}),
  });
}

function appendRawTranscriptMessage(params: {
  transcriptPath: string;
  message: Record<string, unknown>;
}): TranscriptAppendResult {
  // P0 follow-up / P1: never persist private run bag into GROUP_PUBLIC transcript.
  assertNoPrivateRunBagInPublicPayload(params.message, "GROUP_PUBLIC transcript append");
  // P3: refuse private LTM dirty writes and private-DM history mirrors.
  assertNoPrivateMemoryDirtyWriteToGroupPublic(params.message, "GROUP_PUBLIC transcript append");
  // AGENTS.md: never raw JSONL message leaves — SessionManager owns parentId.
  const appended = appendPersistedAgentMessageToTranscript({
    transcriptPath: params.transcriptPath,
    message: params.message,
  });
  if (!appended.ok) {
    return { ok: false, error: appended.error };
  }
  return { ok: true, messageId: appended.messageId, message: appended.message ?? params.message };
}

async function appendUserTranscriptMessage(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  idempotencyKey: string;
  message: Record<string, unknown>;
  /** Authorized workspace cwd for new transcript headers (C17). */
  workspaceCwd?: string | null;
  tenantId?: string | null;
  ownerUserId?: string | null;
  groupId?: string | null;
  failClosed?: boolean;
}): Promise<TranscriptAppendResult> {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }
  const ensured = await ensureTranscriptFile({
    transcriptPath,
    sessionId: params.sessionId,
    cwd: params.workspaceCwd,
    tenantId: params.tenantId,
    ownerUserId: params.ownerUserId,
    groupId: params.groupId,
    failClosed: params.failClosed,
  });
  if (!ensured.ok) {
    return { ok: false, error: ensured.error ?? "failed to create transcript file" };
  }
  if (transcriptHasIdempotencyKey(transcriptPath, params.idempotencyKey)) {
    return { ok: true, message: params.message };
  }
  return appendRawTranscriptMessage({
    transcriptPath,
    message: {
      ...params.message,
      idempotencyKey: params.idempotencyKey,
    },
  });
}

/** @internal exported so history tests can use the real transcript image shape. */
export function buildUserTranscriptContentBlocks(params: {
  message: string;
  attachments: Array<{
    type?: string;
    mimeType?: string;
    fileName?: string;
    assetId?: string;
    versionId?: string;
    contentHash?: string;
    sizeBytes?: number;
    lastModified?: number;
    content?: unknown;
  }>;
}): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  const text = params.message.trim();
  if (text) {
    content.push({ type: "text", text });
  }
  for (const attachment of params.attachments) {
    const mimeType =
      typeof attachment.mimeType === "string" && attachment.mimeType.trim()
        ? attachment.mimeType.trim()
        : "application/octet-stream";
    const fileName =
      typeof attachment.fileName === "string" && attachment.fileName.trim()
        ? attachment.fileName.trim()
        : mimeType;
    if (mimeType.startsWith("image/") && typeof attachment.content === "string") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: attachment.content,
        },
        fileName,
        mimeType,
        assetId: attachment.assetId,
        versionId: attachment.versionId,
        contentHash: attachment.contentHash,
        sizeBytes: attachment.sizeBytes,
        lastModified: attachment.lastModified,
        status: "sent",
      });
      continue;
    }
    content.push({
      type: "file",
      fileName,
      mimeType,
      assetId: attachment.assetId,
      versionId: attachment.versionId,
      contentHash: attachment.contentHash,
      sizeBytes: attachment.sizeBytes,
      lastModified: attachment.lastModified,
      status: "sent",
    });
  }
  return content;
}

type StagedChatMediaContext = {
  mediaPaths?: string[];
  mediaUrls?: string[];
  mediaTypes?: string[];
};

async function stageChatImagesForAgentMediaContext(params: {
  images: ChatImageContent[];
  files?: ChatFileContent[];
  runId: string;
  log: GatewayRequestContext["logGateway"];
}): Promise<StagedChatMediaContext> {
  const mediaPaths: string[] = [];
  const mediaTypes: string[] = [];

  for (const [index, image] of params.images.entries()) {
    try {
      const saved = await saveMediaBuffer(
        Buffer.from(image.data, "base64"),
        image.mimeType,
        "webchat-uploads",
        DEFAULT_CHAT_IMAGE_ATTACHMENT_MAX_BYTES,
        image.fileName || `chat-image-${index + 1}`,
      );
      mediaPaths.push(saved.path);
      mediaTypes.push(saved.contentType ?? image.mimeType);
    } catch (err) {
      params.log.warn(
        `chat.send image media staging failed run=${params.runId} image=${index + 1}: ${String(err)}`,
      );
    }
  }

  // Stage Office/PDF/etc binaries into media so sandbox inbound copy can preserve structure
  // (xlsx sheets, docx layout) instead of leaving agents with flattened text only.
  for (const [index, file] of (params.files ?? []).entries()) {
    try {
      const saved = await saveMediaBuffer(
        Buffer.from(file.data, "base64"),
        file.mimeType,
        "webchat-uploads",
        DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES,
        file.fileName || `chat-file-${index + 1}`,
      );
      mediaPaths.push(saved.path);
      mediaTypes.push(saved.contentType ?? file.mimeType);
    } catch (err) {
      params.log.warn(
        `chat.send file media staging failed run=${params.runId} file=${file.fileName}: ${String(err)}`,
      );
    }
  }

  if (mediaPaths.length === 0) {
    return {};
  }
  return {
    mediaPaths,
    mediaUrls: mediaPaths,
    mediaTypes,
  };
}

function applyStagedChatMediaContext(ctx: MsgContext, staged: StagedChatMediaContext): MsgContext {
  const mediaPaths = staged.mediaPaths;
  if (!mediaPaths || mediaPaths.length === 0) {
    return ctx;
  }
  return {
    ...ctx,
    MediaPath: mediaPaths[0],
    MediaUrl: staged.mediaUrls?.[0] ?? mediaPaths[0],
    MediaType: staged.mediaTypes?.[0],
    MediaPaths: mediaPaths,
    MediaUrls: staged.mediaUrls ?? mediaPaths,
    MediaTypes: staged.mediaTypes,
  };
}

function collectSessionAbortPartials(params: {
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatRunBuffers: Map<string, string>;
  sessionKey: string;
  abortOrigin: AbortOrigin;
}): AbortedPartialSnapshot[] {
  const out: AbortedPartialSnapshot[] = [];
  for (const [runId, active] of params.chatAbortControllers) {
    if (active.sessionKey !== params.sessionKey) {
      continue;
    }
    const text = params.chatRunBuffers.get(runId);
    if (!text || !text.trim()) {
      continue;
    }
    out.push({
      runId,
      sessionId: active.sessionId,
      text,
      abortOrigin: params.abortOrigin,
    });
  }
  return out;
}

async function persistAbortedPartials(params: {
  context: Pick<GatewayRequestContext, "logGateway">;
  sessionKey: string;
  snapshots: AbortedPartialSnapshot[];
  client: GatewayClient | null;
}) {
  if (params.snapshots.length === 0) {
    return;
  }
  const { cfg, storePath, entry } = await loadSessionEntryForClient(
    params.sessionKey,
    params.client,
  );
  const transcriptGovernance = await resolveChatTranscriptGovernance({
    client: params.client,
    cfg,
    groupId: extractGroupIdFromChatSessionKey(params.sessionKey),
  });
  for (const snapshot of params.snapshots) {
    const sessionId = entry?.sessionId ?? snapshot.sessionId ?? snapshot.runId;
    const appended = await appendAssistantTranscriptMessage({
      message: snapshot.text,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      createIfMissing: true,
      idempotencyKey: `${snapshot.runId}:assistant`,
      tenantId: transcriptGovernance.tenantId,
      ownerUserId: transcriptGovernance.ownerUserId,
      groupId: transcriptGovernance.groupId,
      failClosed: transcriptGovernance.failClosed,
      abortMeta: {
        aborted: true,
        origin: snapshot.abortOrigin,
        runId: snapshot.runId,
      },
    });
    if (!appended.ok) {
      params.context.logGateway.warn(
        `chat.abort transcript append failed: ${appended.error ?? "unknown error"}`,
      );
    }
  }
}

function resolveChatAbortMode(value: unknown): "stop" | "undo" {
  return value === "undo" ? "undo" : "stop";
}

function createChatAbortOps(context: GatewayRequestContext): ChatAbortOps {
  return {
    chatAbortControllers: context.chatAbortControllers,
    chatRunBuffers: context.chatRunBuffers,
    chatDeltaSentAt: context.chatDeltaSentAt,
    chatAbortedRuns: context.chatAbortedRuns,
    removeChatRun: context.removeChatRun,
    agentRunSeq: context.agentRunSeq,
    broadcastChat: context.broadcastChat,
    nodeSendToSession: context.nodeSendToSession,
  };
}

async function abortChatRunsForSessionKeyWithPartials(params: {
  context: GatewayRequestContext;
  ops: ChatAbortOps;
  sessionKey: string;
  abortOrigin: AbortOrigin;
  stopReason?: string;
  mode?: "stop" | "undo";
  client: GatewayClient | null;
  /** Session transcript path — used to bind authoritative stop to board taskId. */
  sessionFile?: string;
}) {
  const snapshots = collectSessionAbortPartials({
    chatAbortControllers: params.context.chatAbortControllers,
    chatRunBuffers: params.context.chatRunBuffers,
    sessionKey: params.sessionKey,
    abortOrigin: params.abortOrigin,
  });
  const res = abortChatRunsForSessionKey(params.ops, {
    sessionKey: params.sessionKey,
    stopReason: params.stopReason,
    mode: params.mode,
  });
  if (res.aborted && params.mode !== "undo") {
    await persistAbortedPartials({
      context: params.context,
      sessionKey: params.sessionKey,
      snapshots,
      client: params.client,
    });
  }
  // Authoritative stop by original taskId (survives AbortController delete).
  // task-park is not a user stop barrier — do not record.
  const boardTaskId = (() => {
    const file = params.sessionFile?.trim();
    if (!file) {
      return "";
    }
    try {
      return readSessionTaskBoard(file).current?.taskId?.trim() ?? "";
    } catch {
      return "";
    }
  })();
  if (boardTaskId) {
    const identity = authoritativeStopIdentityFromClient(params.client);
    if (params.mode === "undo") {
      clearAuthoritativeTaskStop({
        taskId: boardTaskId,
        sessionKey: params.sessionKey,
        scopeKind: identity.scopeKind,
        tenantId: identity.tenantId,
        userId: identity.userId,
      });
    } else if (res.aborted && params.stopReason !== "task-park") {
      recordAuthoritativeTaskStop({
        taskId: boardTaskId,
        sessionKey: params.sessionKey,
        scopeKind: identity.scopeKind,
        tenantId: identity.tenantId,
        userId: identity.userId,
        reason: params.stopReason ?? params.abortOrigin,
      });
    }
  }
  return res;
}

function nextChatSeq(context: { agentRunSeq: Map<string, number> }, runId: string) {
  const next = (context.agentRunSeq.get(runId) ?? 0) + 1;
  context.agentRunSeq.set(runId, next);
  return next;
}

function extractAssistantFinalText(message?: Record<string, unknown>): string {
  if (!message) {
    return "";
  }
  const role = typeof message.role === "string" ? message.role : "assistant";
  if (role !== "assistant") {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const part = entry as { type?: string; text?: string };
        return part.type === "text" && typeof part.text === "string" ? part.text.trim() : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return typeof message.text === "string" ? message.text.trim() : "";
}

function broadcastChatFinal(params: {
  context: Pick<GatewayRequestContext, "broadcastChat" | "nodeSendToSession" | "agentRunSeq"> & {
    logGateway?: { warn: (message: string) => void };
  };
  runId: string;
  sessionKey: string;
  message?: Record<string, unknown>;
  taskUpdate?: ReturnType<typeof resolveChatFinalTaskUpdate>;
  /** Declaring bot. Collaboration space keys must not steal this from the group session. */
  deliverableAgentId?: string | null;
  deliverableOwnerId?: string | null;
  /** Delivery preparation already ran. Broadcast must not settle or place files again. */
  prepared?: PreparedChatDeliverable | null;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const strippedEnvelopeMessage = stripEnvelopeFromMessage(params.message) as
    | Record<string, unknown>
    | undefined;
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "final" as const,
    message: stripInlineDirectiveTagsFromMessageForDisplay(strippedEnvelopeMessage),
    ...(params.taskUpdate ? { taskUpdate: params.taskUpdate } : {}),
  };
  const send = () => {
    params.context.broadcastChat(params.sessionKey, payload, {
      runId: params.runId,
      tenantId: resolveChatRunTenantId(params.runId),
    });
    params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  };
  if (params.prepared?.idempotencyKey && params.prepared.record) {
    const delivered = deliverPreparedChatFinal({ prepared: params.prepared, send });
    if (!delivered.ok) {
      params.context.logGateway?.warn?.(
        `chat deliverable broadcast failed (${params.runId}); analysis text kept, delivery left pending recovery`,
      );
    }
  } else {
    send();
  }
  params.context.agentRunSeq.delete(params.runId);
  const captureText = extractAssistantFinalText(strippedEnvelopeMessage);
  if (captureText && params.prepared?.structured !== true) {
    try {
      const messageAgentId =
        params.message && typeof params.message.agentId === "string"
          ? params.message.agentId.trim()
          : "";
      maybeAutoCaptureAgentDeliverable({
        sessionKey: params.sessionKey,
        agentId:
          params.deliverableAgentId?.trim() ||
          messageAgentId ||
          resolveSessionAgentId({ sessionKey: params.sessionKey }),
        ownerId: params.deliverableOwnerId,
        messageId: params.runId,
        content: captureText,
      });
    } catch {
      // Deliverable auto-capture must never break chat final delivery.
    }
  }
}

function broadcastCollaborationRoundPlan(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession">;
  payload: CollaborationRoundPlanPayload;
}) {
  params.context.broadcast("collaboration.round_plan", params.payload);
  params.context.nodeSendToSession(
    params.payload.sessionKey,
    "collaboration.round_plan",
    params.payload,
  );
}

export type CollaborationOptionalSuggestionPayload = {
  roundId: string;
  sessionKey: string;
  agentId: string;
  agentName: string;
  title: string;
  body: string;
  recordedAtMs: number;
};

function broadcastCollaborationOptionalSuggestion(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession">;
  payload: CollaborationOptionalSuggestionPayload;
}) {
  params.context.broadcast("collaboration.optional_suggestion", params.payload);
  params.context.nodeSendToSession(
    params.payload.sessionKey,
    "collaboration.optional_suggestion",
    params.payload,
  );
}

function resolveExplicitMentionRefs(
  mentions?: Array<{
    mention_id: string;
    agentId?: string;
    displayName: string;
    target?: { kind: string; agentId?: string; userId?: string; pluginId?: string };
    targetKind?: string;
    targetId?: string;
  }>,
) {
  return (mentions ?? []).map((entry) => ({
    mentionId: entry.mention_id,
    agentId:
      entry.target?.kind === "agent" ? (entry.target.agentId ?? entry.agentId) : entry.agentId,
    userId:
      entry.target?.kind === "human"
        ? entry.target.userId
        : entry.targetKind === "human"
          ? entry.targetId
          : undefined,
    displayName: entry.displayName,
    targetKind: entry.target?.kind ?? entry.targetKind,
    targetId:
      entry.target?.kind === "agent"
        ? entry.target.agentId
        : entry.target?.kind === "human"
          ? entry.target.userId
          : entry.target?.kind === "plugin"
            ? entry.target.pluginId
            : entry.target?.kind === "all"
              ? "__all__"
              : entry.targetId,
  }));
}

function broadcastChatUserEcho(params: {
  context: Pick<GatewayRequestContext, "broadcastChat" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  message?: Record<string, unknown>;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const strippedEnvelopeMessage = stripEnvelopeFromMessage(params.message) as
    | Record<string, unknown>
    | undefined;
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "user_echo" as const,
    message: stripInlineDirectiveTagsFromMessageForDisplay(strippedEnvelopeMessage),
  };
  params.context.broadcastChat(params.sessionKey, payload, {
    runId: params.runId,
    tenantId: resolveChatRunTenantId(params.runId),
  });
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}

function formatCollaborationRoundFailure(err: unknown): string {
  return formatCollaborationDispatchFailure(err);
}

function broadcastChatError(params: {
  context: Pick<GatewayRequestContext, "broadcastChat" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  errorMessage?: string;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "error" as const,
    errorMessage: params.errorMessage,
  };
  params.context.broadcastChat(params.sessionKey, payload, {
    runId: params.runId,
    tenantId: resolveChatRunTenantId(params.runId),
  });
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
  noteUnresolvedChatRunError({
    sessionKey: params.sessionKey,
    errorMessage: params.errorMessage,
  });
}

async function runGroupBotDiscussionTurn(params: {
  context: GatewayRequestContext;
  client: GatewayRequestHandlerOptions["client"];
  bot: GroupDiscussionBotTarget;
  scope: GroupDiscussionScope;
  decision: ParticipationDecision;
  clientRunId: string;
  collaborationRoundId: string;
  participationTier: ParticipationTier;
  contributionRole?: ContributionRole;
  isWrapTurn?: boolean;
  message: string;
  thinking?: string;
  timeoutMs?: number;
  deliver?: boolean;
  parsedImages: ChatImageContent[];
  stagedMediaContext: StagedChatMediaContext;
  systemInputProvenance?: InputProvenance;
  systemProvenanceReceipt?: string;
  groupInboundHistory?: Array<{ sender: string; body: string; timestamp: number }>;
  sameRoundContext?: SameRoundContext;
  dispatchRole?: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
  /** Same-round CollabEdge that nominated this bot (edge-target turns only). */
  collabEdge?: CollabEdge;
  contextScopeRequest?:
    | import("../context-scope/types.js").ContextScopeRequest
    | import("../context-scope/request.js").ChatContextScopePayload;
  onSkip?: (reason: CollaborationSkipReason, detail?: string) => void;
  /** P0.0b: injected EffectivePolicy (from RoundPolicySnapshot). */
  effective?: EffectiveCollaborationPolicy;
  /** P0.0b: CollaborationEventKey for ledger stamps. */
  eventKey?: CollaborationEventKey;
  /** // v1-only — P0.2 roll-call roster / brief-hint lines. */
  v1RollCallExtraLines?: string[];
  /**
   * Formal deliverable must bind this execution bag / wake run.
   * Missing → refuse formal team submit (no Map / no latest-member fallback).
   */
  executionDeliverableBinding?: ExecutionDeliverableBinding | null;
  /** Group runtime authority — used to resolve actor board binding + continue. */
  authority?: RuntimeAuthority | null;
}): Promise<SameRoundReply | null> {
  return await groupBotQueue.enqueue(params.bot.sessionKey, async () => {
    const {
      cfg,
      entry,
      storePath,
      canonicalKey: sessionKey,
    } = await loadSessionEntryForClient(params.bot.sessionKey, params.client);
    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: params.timeoutMs,
    });
    const runId = `${params.clientRunId}:${params.bot.agentId}`;
    let faultOutcome: FaultRoundVisibleOutcome = { kind: "empty", skipReason: "empty" };
    const now = Date.now();
    const abortController = new AbortController();
    params.context.chatAbortControllers.set(runId, {
      controller: abortController,
      sessionId: entry?.sessionId ?? runId,
      sessionKey: params.scope.rawSessionKey,
      startedAtMs: now,
      expiresAtMs: resolveChatRunExpiresAtMs({ now, timeoutMs }),
    });

    const trimmedMessage = params.message.trim();
    const injectThinking = Boolean(
      params.thinking && trimmedMessage && !trimmedMessage.startsWith("/"),
    );
    const commandBody = injectThinking
      ? `/think ${params.thinking} ${params.message}`
      : params.message;
    const messageForAgent = params.systemProvenanceReceipt
      ? [params.systemProvenanceReceipt, params.message].filter(Boolean).join("\n\n")
      : params.message;
    const clientInfo = params.client?.connect?.client;
    // Prefer platform display identity — never browser device names (Chrome · Mac).
    // Feeding client.displayName here made bots mix up human speakers in collaboration groups.
    const platformSenderLabel = await resolveChatTranscriptSenderLabel(params.client);
    const platformSenderId = params.client?.user?.trim() || undefined;
    const groupOwnerEntitlement = await resolveCollaborationGroupOwnerEntitlementScope(
      params.scope,
    );
    const { originatingChannel, originatingTo, accountId, messageThreadId, explicitDeliverRoute } =
      resolveChatSendOriginatingRoute({
        client: clientInfo,
        deliver: params.deliver,
        entry,
        hasConnectedClient: params.client?.connect !== undefined,
        mainKey: cfg.session?.mainKey,
        sessionKey,
      });
    const stampedMessage = injectTimestamp(messageForAgent, timestampOptsFromConfig(cfg));
    // P1-A5 ⑤ (BP-14): group replyLanguage goes through the composition-root presentation
    // lane (default legacy = raw operatingState value, unchanged). shadow records
    // policy_lane_divergence; effective serves authority.policy.effective.presentation.
    const presentationLane = resolvePresentationLaneReplyLanguage({
      effective: params.effective ?? null,
      operatingState: params.scope.operatingState ?? null,
      ...(params.eventKey ? { key: params.eventKey } : {}),
    });
    const replyLanguage = resolveCollaborationReplyLanguage({
      userMessage: params.message,
      inboundHistory: params.groupInboundHistory,
      groupLanguage: presentationLane.groupLanguage,
      humanNames: (params.scope.members?.humans ?? [])
        .map((human) => human.name?.trim() || human.userId?.trim() || "")
        .filter(Boolean),
      botNames: [
        ...(params.scope.members?.bots ?? []).map(
          (bot) => bot.name?.trim() || bot.agentId?.trim() || "",
        ),
        ...params.scope.bots.map((bot) => bot.name?.trim() || bot.agentId),
      ].filter(Boolean),
    });
    const currentBotOverlay = resolveSessionParticipationOverlay({
      field: entry?.collaborationParticipationOverlay,
      botId: params.bot.agentId,
    });
    const privateRunBagEnabled = isCollaborationPrivateRunBagEnabled(cfg);
    const privateRunBag = privateRunBagEnabled
      ? createCollaborationPrivateRunBag({
          agentId: params.bot.agentId,
          roundId: params.collaborationRoundId,
          participationOverlay: currentBotOverlay ?? null,
          capabilitySet: {
            participation: [...(currentBotOverlay?.overlayCapabilities ?? [])],
            final: [...(currentBotOverlay?.overlayCapabilities ?? [])],
          },
        })
      : undefined;
    // Private bag stays on MsgContext only — never write it into GROUP_PUBLIC.
    const collaborationTurnPrompt = buildCollaborationDiscussionTurnPrompt({
      scope: params.scope,
      bot: params.bot,
      decision: params.decision,
      participationTier: params.participationTier,
      contributionRole: params.contributionRole,
      isWrapTurn: params.isWrapTurn,
      userMessage: params.message,
      sameRoundContext: params.sameRoundContext,
      replyLanguage,
      dispatchRole: params.dispatchRole,
      ...(params.collabEdge ? { collabEdge: params.collabEdge } : {}),
      ...(params.effective ? { effective: params.effective } : {}),
      ...(params.v1RollCallExtraLines?.length
        ? { v1RollCallExtraLines: params.v1RollCallExtraLines }
        : {}),
    });
    const ctx: MsgContext = applyStagedChatMediaContext(
      {
        Body: messageForAgent,
        BodyForAgent: stampedMessage,
        BodyForCommands: commandBody,
        RawBody: params.message,
        CommandBody: commandBody,
        InputProvenance: params.systemInputProvenance,
        SessionKey: sessionKey,
        InboundHistory:
          params.groupInboundHistory && params.groupInboundHistory.length > 0
            ? params.groupInboundHistory
            : undefined,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: originatingChannel,
        OriginatingTo: originatingTo,
        ExplicitDeliverRoute: explicitDeliverRoute,
        AccountId: accountId,
        MessageThreadId: messageThreadId,
        ChatType: "group",
        CommandAuthorized: true,
        MessageSid: runId,
        SenderId: platformSenderId || clientInfo?.id,
        SenderName: platformSenderLabel,
        SenderUsername: platformSenderLabel,
        GatewayClientScopes: params.client?.connect?.scopes,
        GatewayClientUser: params.client?.user,
        GatewayClientSessionDomain: params.client?.sessionDomain,
        GatewayClientPlatformUserId: params.client?.platformUserId,
        GatewayClientSessionEnterpriseId: params.client?.sessionEnterpriseId,
        GatewayClientSessionMembershipId: params.client?.sessionMembershipId,
        CollaborationRoundInvoked: true,
        CollaborationBotAgentId: params.bot.agentId,
        ...(privateRunBag ? { CollaborationPrivateRunBag: privateRunBag } : {}),
        CollaborationGroupId: params.scope.groupId,
        CollaborationTenantId:
          params.scope.tenantId?.trim() || params.client?.sessionEnterpriseId?.trim() || undefined,
        ...(groupOwnerEntitlement
          ? { CollaborationGroupOwnerEntitlement: groupOwnerEntitlement }
          : {}),
        WasMentioned: true,
        GroupSubject: params.scope.title,
        GroupMembers: buildCollaborationGroupMembersLabel(params.scope),
        GroupSystemPrompt: collaborationTurnPrompt,
      },
      params.stagedMediaContext,
    );

    const agentId = resolveSessionAgentId({
      sessionKey,
      config: cfg,
      agentId: params.bot.agentId,
    });
    const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
      cfg,
      agentId,
      channel: INTERNAL_MESSAGE_CHANNEL,
    });
    const finalReplyParts: string[] = [];
    const dispatcher = createReplyDispatcher({
      ...prefixOptions,
      onError: (err) => {
        params.context.logGateway.warn(`group discussion dispatch failed: ${formatForLog(err)}`);
      },
      deliver: async (payload, info) => {
        if (info.kind !== "final") {
          return;
        }
        const text = payload.text?.trim() ?? "";
        if (!text) {
          return;
        }
        finalReplyParts.push(text);
      },
    });

    try {
      await dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId,
          abortSignal: abortController.signal,
          images: params.parsedImages.length > 0 ? params.parsedImages : undefined,
          onModelSelected,
          ...(params.contextScopeRequest
            ? { contextScopeRequest: params.contextScopeRequest }
            : {}),
        },
      });
      const combinedReplyRaw = finalReplyParts
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
      const sessionMessages =
        entry?.sessionId && storePath
          ? readSessionMessages(entry.sessionId, storePath, entry.sessionFile)
          : [];
      let recoveredReply =
        normalizeVisibleCollaborationReply(combinedReplyRaw) ??
        recoverLatestVisibleAssistantText({
          sinceMs: now,
          messages: sessionMessages,
        });
      // [[collab_edge:…]] directives are routing metadata for the round runtime,
      // never room text. Keep the raw reply for edge parsing; post the stripped body.
      let collabEdgeDirectiveSource: string | undefined;
      if (recoveredReply && hasCollabEdgeDirective(recoveredReply)) {
        collabEdgeDirectiveSource = recoveredReply;
        recoveredReply = normalizeVisibleCollaborationReply(
          stripCollabEdgeDirectives(recoveredReply),
        );
      }
      if (!recoveredReply) {
        const infraDetail = collaborationInfraFailureDetail({
          combinedReplyRaw,
          messages: sessionMessages,
          sinceMs: now,
        });
        const skipReason: CollaborationSkipReason = infraDetail
          ? "crash"
          : collaborationSkipReasonForMissingReply({
              combinedReplyRaw,
              messages: sessionMessages,
              sinceMs: now,
            });
        const socialFallback =
          skipReason === "silent"
            ? collaborationSocialSilenceFallback({
                message: params.message,
                contributionRole: params.contributionRole,
                dispatchRole: params.dispatchRole,
              })
            : null;
        if (socialFallback) {
          recoveredReply = socialFallback;
        } else {
          faultOutcome = faultRoundOutcomeFromSkipReason(skipReason, infraDetail ?? undefined);
          params.onSkip?.(skipReason, infraDetail ?? undefined);
          void appendCollaborationExecutionRecord({
            groupId: params.scope.groupId,
            tenantId: params.scope.tenantId,
            ...(params.eventKey ? { key: params.eventKey } : {}),
            sessionKey: params.scope.rawSessionKey,
            roundId: params.collaborationRoundId,
            agentId: params.bot.agentId,
            agentName: params.bot.name,
            tier: params.participationTier,
            status: "skipped",
            contributionRole: params.contributionRole,
            skipReason: "no_increment",
            latencyMs: Date.now() - now,
          }).catch((err) => {
            params.context.logGateway.warn(
              `collaboration execution ledger append failed: ${formatForLog(err)}`,
            );
          });
          return null;
        }
      }

      const languageGate = sanitizeCollaborationVisibleReply({
        text: recoveredReply,
        expectedLanguage: replyLanguage,
      });
      if (!languageGate.ok) {
        params.context.logGateway.warn(
          `group discussion language guard suppressed reply for ${params.bot.agentId}: ${languageGate.reason}`,
        );
        faultOutcome = faultRoundOutcomeFromSkipReason("language");
        params.onSkip?.("language");
        void appendCollaborationExecutionRecord({
          groupId: params.scope.groupId,
          tenantId: params.scope.tenantId,
          ...(params.eventKey ? { key: params.eventKey } : {}),
          sessionKey: params.scope.rawSessionKey,
          roundId: params.collaborationRoundId,
          agentId: params.bot.agentId,
          agentName: params.bot.name,
          tier: params.participationTier,
          status: "skipped",
          contributionRole: params.contributionRole,
          skipReason: "language",
          latencyMs: Date.now() - now,
        }).catch((err) => {
          params.context.logGateway.warn(
            `collaboration execution ledger append failed: ${formatForLog(err)}`,
          );
        });
        return null;
      }
      const combinedReply = languageGate.text;

      if (
        (await import("../collaboration-dispatch/completion-contract.js")).classifyPlaceholderReply(
          combinedReply,
        )
      ) {
        faultOutcome = faultRoundOutcomeFromSkipReason("pure_ack");
        params.onSkip?.("pure_ack");
        void appendCollaborationExecutionRecord({
          groupId: params.scope.groupId,
          tenantId: params.scope.tenantId,
          ...(params.eventKey ? { key: params.eventKey } : {}),
          sessionKey: params.scope.rawSessionKey,
          roundId: params.collaborationRoundId,
          agentId: params.bot.agentId,
          agentName: params.bot.name,
          tier: params.participationTier,
          status: "skipped",
          contributionRole: params.contributionRole,
          skipReason: "pure_ack",
          latencyMs: Date.now() - now,
        }).catch((err) => {
          params.context.logGateway.warn(
            `collaboration execution ledger append failed: ${formatForLog(err)}`,
          );
        });
        return null;
      }

      if (
        shouldSuppressHighlyRedundantReply({
          candidateText: combinedReply,
          contributionRole: params.contributionRole ?? "supplement",
          sameRoundContext: params.sameRoundContext,
          responseMode: params.decision.responseMode,
          // P1-A5 ② BP-13: preserveConflict via dispatch lane (default legacy = OS
          // collaborationMode === "review_driven" or challenge).
          preserveConflict: resolveDispatchLanePreserveConflict({
            effective: params.effective ?? null,
            contributionRole: params.contributionRole,
            operatingState: params.scope.operatingState ?? null,
            ...(params.eventKey ? { key: params.eventKey } : {}),
            cfg,
          }).preserveConflict,
        })
      ) {
        faultOutcome = faultRoundOutcomeFromSkipReason("duplicate");
        params.onSkip?.("duplicate");
        void appendCollaborationExecutionRecord({
          groupId: params.scope.groupId,
          tenantId: params.scope.tenantId,
          ...(params.eventKey ? { key: params.eventKey } : {}),
          sessionKey: params.scope.rawSessionKey,
          roundId: params.collaborationRoundId,
          agentId: params.bot.agentId,
          agentName: params.bot.name,
          tier: params.participationTier,
          status: "skipped",
          contributionRole: params.contributionRole,
          suppressedAsDuplicate: true,
          latencyMs: Date.now() - now,
        }).catch((err) => {
          params.context.logGateway.warn(
            `collaboration execution ledger append failed: ${formatForLog(err)}`,
          );
        });
        return null;
      }

      if (
        classifyOptionalSupplementReply(combinedReply) &&
        (params.contributionRole === "supplement" || params.contributionRole === "challenge")
      ) {
        broadcastCollaborationOptionalSuggestion({
          context: params.context,
          payload: {
            roundId: params.collaborationRoundId,
            sessionKey: params.scope.rawSessionKey,
            agentId: params.bot.agentId,
            agentName: params.bot.name,
            title: extractOptionalSupplementTitle(combinedReply, params.bot.name),
            body: combinedReply,
            recordedAtMs: Date.now(),
          },
        });
        faultOutcome = faultRoundOutcomeFromSkipReason("optional_supplement");
        void appendCollaborationExecutionRecord({
          groupId: params.scope.groupId,
          tenantId: params.scope.tenantId,
          ...(params.eventKey ? { key: params.eventKey } : {}),
          sessionKey: params.scope.rawSessionKey,
          roundId: params.collaborationRoundId,
          agentId: params.bot.agentId,
          agentName: params.bot.name,
          tier: params.participationTier,
          status: "skipped",
          contributionRole: params.contributionRole,
          latencyMs: Date.now() - now,
        }).catch((err) => {
          params.context.logGateway.warn(
            `collaboration execution ledger append failed: ${formatForLog(err)}`,
          );
        });
        return null;
      }

      let replyText = combinedReply;
      const turnSettled = settleTurnCompletion({
        userText: params.message,
        assistantText: replyText,
        nowMs: Date.now(),
        ...(oguiWaitBlocksSession(params.scope.rawSessionKey) ? { oguiWaitActive: true } : {}),
      });
      if (turnSettled.visibleText.trim()) {
        replyText = turnSettled.visibleText;
      }
      let deliverableOwnerId: string | null = null;
      let prepared: PreparedChatDeliverable | null = null;
      let deliverableArtifacts: ReturnType<typeof declaredDeliverableArtifactFields> = {};
      try {
        const tenantCtx = await resolveTenantContext(params.client);
        deliverableOwnerId = tenantCtx?.userId?.trim() || null;
      } catch (err) {
        params.context.logGateway.warn(
          `collaboration deliverable owner unresolved (${params.bot.agentId}): ${formatForLog(err)}`,
        );
      }
      try {
        // OS currentTaskId is unreliable as sole binding; keep for settle metadata only.
        const groupCurrentTaskId =
          (
            params.scope.operatingState as
              | { activeContext?: { currentTaskId?: string | null } }
              | null
              | undefined
          )?.activeContext?.currentTaskId?.trim() || null;
        prepared = prepareChatDeliverablePublish({
          text: replyText,
          publishIntent: "group-bot-final",
          sessionKey: params.scope.rawSessionKey,
          tenantId: params.scope.tenantId,
          groupId: params.scope.groupId,
          agentId: params.bot.agentId,
          userId: deliverableOwnerId,
          clientRunId: runId,
          // Chat settle/ledger only — not the team SoT task authority.
          taskId: null,
        });
        // Keep tagged prepared.text for team formal submit; strip only for the
        // user-visible reply bubble after that path returns.
        replyText = prepared.text;
        if (params.scope.groupId && prepared.structured) {
          // Unique formal team delivery via run binding only (R3 — no Map fallback).
          // Do not invent trust:membership from a bare tenantId string.
          const tenantResolution = await resolveCollaborationTenantResolution(params.client);
          const tenant =
            tenantResolution.trust === "membership"
              ? tenantResolution
              : labelCollaborationIoTenant(
                  tenantResolution.tenantId ?? params.scope.tenantId ?? null,
                );
          let deliverAuth: Awaited<ReturnType<typeof authorizeTeamGroupResourceAccess>> | null =
            null;
          let deliverStores: ReturnType<typeof createTrustedGroupStores> | null = null;
          try {
            deliverAuth = await authorizeTeamGroupResourceAccess({
              groupId: params.scope.groupId,
              actor: params.bot.agentId,
              client: params.client,
              tenant,
              action: "write",
              cfg,
            });
            if (deliverAuth.ok) {
              deliverStores = createTrustedGroupStores({
                groupsRoot: deliverAuth.groupsRoot,
                groupLocator: deliverAuth.groupLocator,
              });
            }
          } catch (authErr) {
            params.context.logGateway.warn(
              `collaboration team deliverable auth failed (${params.bot.agentId}): ${formatForLog(authErr)}`,
            );
          }
          let binding = params.executionDeliverableBinding ?? null;
          // Prefer attaching a complete binding from this actor's unique active claim
          // before formal submit (discussion turns often lack wake_dispatch binding).
          if (!binding && params.authority) {
            try {
              binding = await tryBuildChatActorExecutionDeliverableBinding({
                authority: params.authority,
                agentId: params.bot.agentId,
                runId,
                taskIdHint: groupCurrentTaskId,
                cfg,
              });
            } catch (bindErr) {
              params.context.logGateway.warn(
                `collaboration deliverable binding attach failed (${params.bot.agentId}): ${formatForLog(bindErr)}`,
              );
            }
          }
          const finalized = await finalizeMemberRunTeamDeliverable({
            text: prepared.text,
            agentId: params.bot.agentId,
            binding,
            client: params.client,
            tenant,
            auth: deliverAuth && deliverAuth.ok ? deliverAuth : null,
            trusted:
              deliverAuth && deliverAuth.ok
                ? {
                    groupsRoot: deliverAuth.groupsRoot,
                    groupLocator: deliverAuth.groupLocator,
                  }
                : null,
            stores: deliverStores,
            cfg,
            groupCurrentTaskId,
          });
          replyText = finalized.text;
          if (!finalized.outcome.ok) {
            params.context.logGateway.warn(
              `collaboration team deliverable not ok (${params.bot.agentId}): ${finalized.outcome.reason}; unused groupCurrentTaskId=${groupCurrentTaskId ?? "none"}`,
            );
          }
          // Keep multi-milestone auto-chain alive after formal settle (ok or reject).
          // task_board_continue skips group sessions; collaboration continue must run.
          if (params.authority) {
            void scheduleContinueAfterDeliverableSettlement({
              authority: params.authority,
              roundId: params.collaborationRoundId || runId,
              cfg,
              agentId: params.bot.agentId,
              deliverableOk: finalized.outcome.ok,
              reason: finalized.outcome.ok
                ? "deliverable_ok"
                : `deliverable_not_ok:${finalized.outcome.reason}`,
              taskId: binding?.taskId ?? groupCurrentTaskId,
              itemId: binding?.boardItemId,
            });
          }
        }
        deliverableArtifacts = declaredDeliverableArtifactFields(replyText, {
          timestamp: Date.now(),
        });
        replyText = stripControlChannelForDisplay(replyText);
      } catch (err) {
        params.context.logGateway.warn(
          `collaboration deliverable settle failed (${params.bot.agentId}): ${formatForLog(err)}`,
        );
      }

      const groupSession = await ensureGroupSessionEntry(params.scope, params.client);
      const transcriptPath = resolveTranscriptPath({
        sessionId: groupSession.entry.sessionId,
        storePath: groupSession.storePath,
        sessionFile: groupSession.entry.sessionFile,
      });
      const publishView = prepared?.structured ? prepared.view : undefined;
      const persistTimestamp = Date.now();
      const finalMessage: Record<string, unknown> = {
        role: "assistant",
        content: [{ type: "text", text: replyText }],
        timestamp: persistTimestamp,
        senderLabel: params.bot.name,
        agentId: params.bot.agentId,
        collaborationRoundId: params.collaborationRoundId,
        ...(params.isWrapTurn ? { collaborationWrap: true } : {}),
        ...(publishView ? { deliverablePublish: publishView } : {}),
        ...(deliverableArtifacts.artifact ? { artifact: deliverableArtifacts.artifact } : {}),
        ...(deliverableArtifacts.artifacts ? { artifacts: deliverableArtifacts.artifacts } : {}),
      };
      const appended =
        transcriptPath == null
          ? { ok: false, error: "transcript path not resolved" }
          : appendRawTranscriptMessage({
              transcriptPath,
              message: finalMessage,
            });
      const message = {
        ...(appended.ok && appended.message ? appended.message : finalMessage),
      };
      const taskUpdate =
        resolveChatFinalTaskUpdate({
          cfg,
          sessionKey,
          runId,
          agentId: params.bot.agentId,
        }) ?? undefined;
      if (taskUpdate && transcriptPath) {
        appendRawTranscriptMessage({
          transcriptPath,
          message: taskUpdate,
        });
      }
      broadcastChatFinal({
        context: params.context,
        runId,
        sessionKey: params.scope.rawSessionKey,
        message,
        deliverableAgentId: params.bot.agentId,
        deliverableOwnerId,
        prepared,
        taskUpdate,
      });
      void appendCollaborationExecutionRecord({
        groupId: params.scope.groupId,
        tenantId: params.scope.tenantId,
        ...(params.eventKey ? { key: params.eventKey } : {}),
        sessionKey: params.scope.rawSessionKey,
        roundId: params.collaborationRoundId,
        agentId: params.bot.agentId,
        agentName: params.bot.name,
        tier: params.participationTier,
        status: "completed",
        contributionRole: params.contributionRole,
        incrementalContribution: params.contributionRole !== "lead",
        latencyMs: Date.now() - now,
      }).catch((err) => {
        params.context.logGateway.warn(
          `collaboration execution ledger append failed: ${formatForLog(err)}`,
        );
      });
      faultOutcome = { kind: "visible" };
      return {
        agentId: params.bot.agentId,
        agentName: params.bot.name,
        contributionRole: params.contributionRole ?? "supplement",
        text: replyText,
        ...(collabEdgeDirectiveSource ? { rawText: collabEdgeDirectiveSource } : {}),
        ...(appended.ok && appended.messageId ? { messageId: appended.messageId } : {}),
      };
    } finally {
      emitCollabFaultRoundDiagnostic(
        {
          runId,
          sessionKey: params.scope.rawSessionKey,
          groupId: params.scope.groupId,
          agentId: params.bot.agentId,
          // Depth/scope come from get-reply-run partial when classified;
          // group turns without depth stay absent via buildDiagnostic defaults.
          outcome: faultOutcome,
        },
        cfg,
      );
      endChatRunAndMaybeFlushRestore({
        context: params.context,
        runId,
        client: params.client,
        isWebchatConnect: () => false,
      });
    }
  });
}

/**
 * Per-session restore mutex. A second chat.restore for the same session while
 * one is already running fails fast with RESTORE_IN_PROGRESS instead of
 * quietly queueing (users repeatedly clicking restore must see a busy status).
 * The workspace-level lock in the snapshot store covers shared-workspace cases.
 */
const sessionRestoreLocks = new Set<string>();

class ChatRestoreBusyError extends Error {
  readonly code = "RESTORE_IN_PROGRESS";

  constructor(sessionKey: string) {
    super(`a restore is already in progress for session ${sessionKey}`);
    this.name = "ChatRestoreBusyError";
  }
}

async function withSessionRestoreLock<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
  if (sessionRestoreLocks.has(sessionKey)) {
    throw new ChatRestoreBusyError(sessionKey);
  }
  sessionRestoreLocks.add(sessionKey);
  try {
    return await fn();
  } finally {
    sessionRestoreLocks.delete(sessionKey);
  }
}

type ChatRestoreHandlerContext = Parameters<GatewayRequestHandlers["chat.restore"]>[0];

function respondRestoreInProgress(params: {
  respond: ChatRestoreHandlerContext["respond"];
  context: ChatRestoreHandlerContext["context"];
  sessionKey: string;
  checkpointId?: string;
}): void {
  params.context.logGateway.info(
    `chat.restore busy (restore in progress) session=${params.sessionKey} checkpoint=${params.checkpointId ?? "latest"}`,
  );
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.UNAVAILABLE,
      "A restore is already in progress for this session. Wait for it to finish.",
      {
        reasonCode: "RESTORE_IN_PROGRESS",
        retryable: true,
        retryAfterMs: 2000,
        details: { reasonCode: "RESTORE_IN_PROGRESS" },
      },
    ),
  );
}

type ChatRestoreQueueModule = typeof import("../chat-restore-queue.js");
let chatRestoreQueueModulePromise: Promise<ChatRestoreQueueModule> | undefined;

async function loadChatRestoreQueueModule(): Promise<ChatRestoreQueueModule> {
  chatRestoreQueueModulePromise ??= import("../chat-restore-queue.js");
  return chatRestoreQueueModulePromise;
}

function endChatRunAndMaybeFlushRestore(params: {
  context: ChatRestoreHandlerContext["context"];
  runId: string;
  client: ChatRestoreHandlerContext["client"];
  isWebchatConnect: ChatRestoreHandlerContext["isWebchatConnect"];
}): void {
  const active = params.context.chatAbortControllers.get(params.runId);
  params.context.chatAbortControllers.delete(params.runId);
  if (!active?.sessionKey) {
    return;
  }
  void flushPendingChatRestoreForSession({
    context: params.context,
    sessionKey: active.sessionKey,
    client: params.client,
    isWebchatConnect: params.isWebchatConnect,
  }).catch((err) => {
    params.context.logGateway.warn(
      `queued chat.restore flush failed session=${active.sessionKey}: ${formatForLog(err)}`,
    );
  });
}

async function flushPendingChatRestoreForSession(params: {
  context: ChatRestoreHandlerContext["context"];
  sessionKey: string;
  client: ChatRestoreHandlerContext["client"];
  isWebchatConnect: ChatRestoreHandlerContext["isWebchatConnect"];
}): Promise<void> {
  const chatRestoreQueue = await loadChatRestoreQueueModule();
  const pending = chatRestoreQueue.takePendingChatRestore(params.sessionKey);
  if (!pending) {
    return;
  }
  if (
    chatRestoreQueue.hasActiveChatRunForSession(
      params.context.chatAbortControllers,
      params.sessionKey,
    )
  ) {
    chatRestoreQueue.enqueuePendingChatRestore(params.sessionKey, pending);
    return;
  }
  await chatHandlers["chat.restore"]({
    params: {
      sessionKey: pending.sessionKey,
      checkpointId: pending.checkpointId,
    },
    respond: (ok, payload, err) => {
      if (!ok) {
        params.context.logGateway.warn(
          `queued chat.restore failed session=${pending.sessionKey}: ${err?.message ?? "unknown"}`,
        );
        return;
      }
      params.context.logGateway.info(
        `queued chat.restore completed session=${pending.sessionKey} checkpoint=${pending.checkpointId ?? "latest"}`,
      );
    },
    context: params.context,
    client: (pending.client ?? params.client) as ChatRestoreHandlerContext["client"],
    req: {} as ChatRestoreHandlerContext["req"],
    isWebchatConnect: params.isWebchatConnect,
  });
}

export const chatHandlers: GatewayRequestHandlers = {
  "chat.history": async ({ params, respond, context, client }) => {
    if (!validateChatHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
        ),
      );
      return;
    }
    const {
      sessionKey: rawSessionKey,
      limit,
      before,
      includeTools: requestedIncludeTools,
      includeArchives,
      archiveId,
      sessionOwnerPlatformUserId,
    } = params as {
      sessionKey: string;
      limit?: number;
      before?: string;
      includeTools?: boolean;
      includeArchives?: boolean;
      archiveId?: string;
      sessionOwnerPlatformUserId?: string;
    };
    // Same cookie hydrate as chat.send. Reconnect often fires chat.history
    // immediately after hello-ok; without this, personal-workbench sessions
    // deny with "requires a resolved employee actor" and the UI stays on
    // the pre-disconnect transcript (typing / missing reply).
    await webchatIdentity.hydrateWebchatGatewayClientPlatformIdentity({ client });
    await webchatIdentity.ensureGatewayClientUserFromPlatformIdentity({ client });
    const historyClient = gatewayClientForSessionOwner(client, sessionOwnerPlatformUserId);
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, rawSessionKey);
    if (employeeChatTranscriptBlocked(client, sessionKey)) {
      respondEmptyIsolatedStewardHistory({ respond, rawSessionKey });
      return;
    }
    const foreignStewardDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (foreignStewardDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, foreignStewardDenial));
      return;
    }
    if (
      isRedundantRobotAliasSessionKey(rawSessionKey) ||
      isRedundantRobotAliasSessionKey(sessionKey)
    ) {
      const leftoverStore = await loadSessionEntryForClient("main", client);
      await retireLeftoverWorkbenchAliasesAroundStore(leftoverStore.storePath);
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "this leftover conversation path has been retired"),
      );
      return;
    }
    const historyAccessDenial = await resolvePersonalWorkbenchSessionAccessDenial({
      client,
      sessionKey,
      logGateway: context.logGateway,
    });
    if (historyAccessDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, historyAccessDenial));
      return;
    }
    await resolveAndBindChatTurnTenant(historyClient, sessionKey);
    noteAuthorizedChatSessionInterest(historyClient, sessionKey);
    const historySession = isSpaceAliasSessionKey(sessionKey)
      ? await loadGroupSessionEntry(sessionKey, historyClient)
      : await loadSessionEntryForClient(sessionKey, historyClient);
    const cfg = historySession.cfg ?? (await loadSessionEntryForClient("main", client)).cfg;
    const storePath = historySession.storePath;
    await retireLeftoverWorkbenchAliasesAroundStore(storePath);
    const entry = historySession.entry;
    const oguiDecisionStatuses = projectOguiDecisionStatuses(entry?.oguiDecisions);
    const oguiDecisionPayload = oguiDecisionStatuses ? { oguiDecisionStatuses } : {};
    const sessionId = entry?.sessionId;
    const includeTools = resolveChatHistoryIncludeTools({
      includeTools: requestedIncludeTools,
      client,
    });
    const historyCursorEnabled = resolveConversationFlags(cfg).historyCursorEnabled;
    // P3a：往期/归档会话访问的安全边界 —— 本 agent 的转写目录 + 调用者本会话工作区 cwd。
    const historyAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
    const transcriptsDir = resolveSessionTranscriptsDirForAgent(historyAgentId);
    const callerWorkspaceCwd = await resolveCallerWorkspaceCwd({
      cfg,
      sessionKey,
      agentId: historyAgentId,
      client,
    });
    // 读取指定归档转写（受文件名白名单 / realpath 路径限定 / cwd 归属三重闸门保护）。
    if (typeof archiveId === "string" && archiveId.trim()) {
      const archiveResult = readOwnedArchiveMessages({
        transcriptsDir,
        callerWorkspaceCwd,
        archiveId: archiveId.trim(),
        limit,
        includeTools,
      });
      if (!archiveResult.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, archiveResult.error));
        return;
      }
      respond(true, {
        sessionKey,
        archiveId: archiveId.trim(),
        messages: archiveResult.messages,
        ...oguiDecisionPayload,
      });
      return;
    }
    const { readPagedChatHistoryMessages, resolveExistingSessionTranscriptPath } =
      await loadTranscriptHistoryHelpers();
    const jsonlPath =
      sessionId && storePath
        ? resolveExistingSessionTranscriptPath(sessionId, storePath, entry?.sessionFile)
        : undefined;
    const defaultLimit = 200;
    const requested = typeof limit === "number" ? limit : defaultLimit;
    const pageLimit = Math.min(1000, Math.max(1, requested));
    let rawMessages: unknown[] = [];
    let indexedNextBefore: string | null | undefined;
    let indexedHasMore: boolean | undefined;
    let usedTranscriptIndex = false;
    if (jsonlPath && typeof sessionId === "string" && sessionId) {
      try {
        const paged = readPagedChatHistoryMessages({
          jsonlPath,
          sessionId,
          limit: pageLimit,
          before: typeof before === "string" ? before : null,
          includeTools: Boolean(includeTools),
        });
        rawMessages = paged.messages;
        indexedNextBefore = paged.nextBefore;
        indexedHasMore = paged.hasMore;
        usedTranscriptIndex = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/cursor/i.test(message)) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
          return;
        }
        rawMessages = readSessionMessages(sessionId, storePath, entry?.sessionFile);
      }
    } else if (sessionId && storePath) {
      rawMessages = readSessionMessages(sessionId, storePath, entry?.sessionFile);
    }
    let boundedMessages: unknown[];
    let placeholderCount: number;
    let nextBefore: string | null | undefined;
    let hasMore: boolean | undefined;
    try {
      const bounded = boundChatHistoryMessages({
        rawMessages,
        limit: usedTranscriptIndex ? pageLimit : limit,
        includeTools: usedTranscriptIndex ? true : includeTools,
        sessionId: typeof sessionId === "string" ? sessionId : undefined,
        before: usedTranscriptIndex ? undefined : before,
        historyCursorEnabled: usedTranscriptIndex ? false : historyCursorEnabled,
      });
      boundedMessages = bounded.messages;
      placeholderCount = bounded.placeholderCount;
      nextBefore =
        usedTranscriptIndex && historyCursorEnabled ? indexedNextBefore : bounded.nextBefore;
      hasMore = usedTranscriptIndex && historyCursorEnabled ? indexedHasMore : bounded.hasMore;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/cursor/i.test(message)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      throw err;
    }
    if (placeholderCount > 0) {
      chatHistoryPlaceholderEmitCount += placeholderCount;
      context.logGateway.debug(
        `chat.history omitted oversized payloads placeholders=${placeholderCount} total=${chatHistoryPlaceholderEmitCount}`,
      );
    }
    let thinkingLevel = entry?.thinkingLevel;
    if (!thinkingLevel) {
      const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
      const { provider, model } = resolveSessionModelRef(cfg, entry, sessionAgentId);
      const catalog = await context.loadGatewayModelCatalog();
      thinkingLevel = resolveThinkingDefault({
        cfg,
        provider,
        model,
        catalog,
      });
    }
    const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
    const activeRun = publishActiveChatRunForHistory({
      context,
      client,
      sessionKeys: sessionKeysForChatHistoryActiveRun({
        resolvedSessionKey: sessionKey,
        rawSessionKey,
        cfg: loadConfig(),
      }),
    });
    const stewardOwner = extractEmployeeStewardUserIdFromSessionKey(sessionKey);
    const authorizationMessages =
      stewardOwner && !(typeof before === "string" && before.trim())
        ? stewardCallAuthorizationHistoryEntries(stewardOwner)
        : [];
    const historyMessages =
      authorizationMessages.length > 0
        ? [...boundedMessages, ...authorizationMessages]
        : boundedMessages;
    respond(true, {
      sessionKey,
      sessionId,
      messages: overlayChatDeliverablePublish({
        sessionKey,
        messages: historyMessages,
      }),
      thinkingLevel,
      verboseLevel,
      activeRun,
      ...(hasMore !== undefined ? { hasMore, nextBefore: nextBefore ?? null } : {}),
      ...(includeArchives
        ? { archives: listOwnedSessionArchives({ transcriptsDir, callerWorkspaceCwd }) }
        : {}),
      ...oguiDecisionPayload,
    });
  },
  "chat.abort": async ({ params, respond, context, client }) => {
    if (!validateChatAbortParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey: rawSessionKey, runId } = params as {
      sessionKey: string;
      runId?: string;
      mode?: "stop" | "undo";
    };
    const mode = resolveChatAbortMode((params as { mode?: unknown }).mode);
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, rawSessionKey);
    if (denyEmployeeGlobalStewardTranscript({ client, sessionKey, respond })) {
      return;
    }
    const abortForeignDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (abortForeignDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, abortForeignDenial));
      return;
    }

    const ops = createChatAbortOps(context);
    let abortSessionFile: string | undefined;
    try {
      abortSessionFile = (await loadSessionEntryForClient(sessionKey, client)).entry?.sessionFile;
    } catch {
      abortSessionFile = undefined;
    }

    if (!runId) {
      const res = await abortChatRunsForSessionKeyWithPartials({
        context,
        ops,
        sessionKey,
        abortOrigin: "rpc",
        stopReason: "rpc",
        mode,
        client,
        sessionFile: abortSessionFile,
      });
      respond(true, {
        ok: true,
        aborted: res.aborted,
        ...(mode === "undo" ? { undone: res.aborted } : {}),
        runIds: res.runIds,
      });
      return;
    }

    if (isSpaceAliasSessionKey(sessionKey)) {
      const res = await abortChatRunsForSessionKeyWithPartials({
        context,
        ops,
        sessionKey,
        abortOrigin: "rpc",
        stopReason: "rpc",
        mode,
        client,
        sessionFile: abortSessionFile,
      });
      respond(true, {
        ok: true,
        aborted: res.aborted,
        ...(mode === "undo" ? { undone: res.aborted } : {}),
        runIds: res.runIds,
      });
      return;
    }

    const active = context.chatAbortControllers.get(runId);
    if (!active) {
      respond(true, { ok: true, aborted: false, runIds: [] });
      return;
    }
    const abortSessionKeys = new Set(
      sessionKeysForChatHistoryActiveRun({
        resolvedSessionKey: sessionKey,
        rawSessionKey,
        cfg: loadConfig(),
      }),
    );
    if (!abortSessionKeys.has(active.sessionKey)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId does not match sessionKey"),
      );
      return;
    }

    const partialText = context.chatRunBuffers.get(runId);
    const res = abortChatRunById(ops, {
      runId,
      sessionKey,
      stopReason: "rpc",
      mode,
    });
    if (res.aborted && partialText && partialText.trim() && !(mode === "undo" && res.undone)) {
      await persistAbortedPartials({
        context,
        sessionKey,
        snapshots: [
          {
            runId,
            sessionId: active.sessionId,
            text: partialText,
            abortOrigin: "rpc",
          },
        ],
        client,
      });
    }
    // Controller is already deleted by abortChatRunById — record durable task stop.
    if (res.aborted) {
      try {
        const boardTaskId = readSessionTaskBoard(abortSessionFile).current?.taskId?.trim() ?? "";
        if (boardTaskId) {
          const identity = authoritativeStopIdentityFromClient(client);
          if (mode === "undo") {
            clearAuthoritativeTaskStop({
              taskId: boardTaskId,
              sessionKey,
              scopeKind: identity.scopeKind,
              tenantId: identity.tenantId,
              userId: identity.userId,
            });
          } else {
            recordAuthoritativeTaskStop({
              taskId: boardTaskId,
              sessionKey,
              scopeKind: identity.scopeKind,
              tenantId: identity.tenantId,
              userId: identity.userId,
              reason: "rpc",
            });
          }
        }
      } catch {
        // Session entry unavailable — authoritative stop skipped (fail-open on record).
      }
    }
    respond(true, {
      ok: true,
      aborted: res.aborted,
      ...(mode === "undo" ? { undone: Boolean(res.undone) } : {}),
      runIds: res.aborted ? [runId] : [],
    });
  },
  "chat.send": async ({ params, respond, context, client, isWebchatConnect }) => {
    // Webchat may authenticate with a device token while the platform login cookie
    // was present on the WS upgrade. Rehydrate client.user before agent tools run
    // so personal operational identity (email / wechat OA) can resolve the owner.
    await webchatIdentity.hydrateWebchatGatewayClientPlatformIdentity({ client });
    await webchatIdentity.ensureGatewayClientUserFromPlatformIdentity({ client });
    if (!validateChatSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      thinking?: string;
      deliver?: boolean;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      mentions?: MentionMetadata[];
      timeoutMs?: number;
      systemInputProvenance?: InputProvenance;
      systemProvenanceReceipt?: string;
      growthBirthTurn?: boolean;
      growthGateProceed?: boolean;
      focusSwitchProceed?: boolean;
      focusSwitchCancel?: boolean;
      stewardCallAuthorizationId?: string;
      humanTakeoverObserved?: boolean;
      composerQuote?: {
        messageId?: string | null;
        excerpt: string;
      };
      cronReplyContext?: {
        jobId: string;
        runId?: string;
        jobName?: string;
      };
      idempotencyKey: string;
      contextScope?: {
        mode?: string;
        lifetime?: string;
        sources?: Array<{ type?: string; id?: string; parentId?: string }>;
      };
      planConfirmTaskId?: string;
      planConfirmBoardItemId?: string;
      planConfirmTodolistId?: string;
      planConfirmDecisionId?: string;
      planConfirmExpectedVersion?: number;
    };
    if ((p.systemInputProvenance || p.systemProvenanceReceipt) && !isAcpBridgeClient(client)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "system provenance fields are reserved for the ACP bridge",
        ),
      );
      return;
    }
    const sanitizedMessageResult = sanitizeChatSendMessageInput(p.message);
    if (!sanitizedMessageResult.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, sanitizedMessageResult.error),
      );
      return;
    }
    const systemReceiptResult = normalizeOptionalChatSystemReceipt(p.systemProvenanceReceipt);
    if (!systemReceiptResult.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, systemReceiptResult.error));
      return;
    }
    const inboundMessage = sanitizedMessageResult.message;
    const cronReplyContext = normalizeCronReplyContext(p.cronReplyContext);
    let systemInputProvenance = normalizeInputProvenance(p.systemInputProvenance);
    if (cronReplyContext) {
      systemInputProvenance = cronReplyContextToInputProvenance(cronReplyContext);
    }
    const systemProvenanceReceipt = systemReceiptResult.receipt;
    const stopCommand = isChatStopCommandText(inboundMessage);
    const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(p.attachments);
    const composerQuoteForSend = normalizeComposerQuote(p.composerQuote);
    const bodyTrimmed = inboundMessage.trim();
    if (!bodyTrimmed && !composerQuoteForSend && normalizedAttachments.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message or attachment required"),
      );
      return;
    }
    let parsedMessage = inboundMessage;
    let parsedImages: ChatImageContent[] = [];
    let parsedFiles: ChatFileContent[] = [];
    if (normalizedAttachments.length > 0) {
      try {
        const parsed = await parseMessageWithAttachments(inboundMessage, normalizedAttachments, {
          log: context.logGateway,
        });
        parsedMessage = parsed.message;
        parsedImages = parsed.images;
        parsedFiles = parsed.files;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }
    const composerQuoteLayers = resolveComposerQuoteSendLayers({
      bodyMessage: parsedMessage,
      composerQuote: p.composerQuote,
    });
    const mentionMessage = composerQuoteLayers.mentionMessage;
    const transcriptMessage = composerQuoteLayers.transcriptMessage;
    const rawMessage = transcriptMessage.trim();
    const rawSessionKey = p.sessionKey;
    const stewardIntercept = await interceptStewardCrossCallChatSend({
      client,
      rawSessionKey,
      message: rawMessage,
      authorizationId: p.stewardCallAuthorizationId,
      dispatchAgreed: async (pending) =>
        dispatchDiagnoseConversationAction({
          title: pending.title,
          agentPrompt: pending.message,
          targetAgentId: "main",
          targetSessionKey: pending.targetSessionKey,
          requesterUserId: pending.callerUserId,
          tenantId: pending.callerTenantId,
          tenantAdmin: false,
          requesterSessionKey: pending.requesterSessionKey,
          omitReceipt: true,
          plainConversation: true,
          sessionExists: () => true,
          stewardCaller: {
            rank: pending.callerRank,
            tenantId: pending.callerTenantId,
            targetTenantIds: pending.targetTenantIds,
          },
          stewardAuthorizationAgreed: true,
        }),
    });
    if (stewardIntercept.handled) {
      if (!stewardIntercept.ok) {
        respond(
          false,
          stewardIntercept.payload,
          errorShape(ErrorCodes.INVALID_REQUEST, stewardIntercept.error),
        );
        return;
      }
      respond(true, stewardIntercept.payload);
      return;
    }
    const resolvedSessionKey = await resolveEmployeeScopedChatSessionKey(client, rawSessionKey);
    if (denyEmployeeGlobalStewardTranscript({ client, sessionKey: resolvedSessionKey, respond })) {
      return;
    }
    const sendForeignDenial = await foreignEmployeeStewardAccessDenial(client, resolvedSessionKey);
    if (sendForeignDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, sendForeignDenial));
      return;
    }
    if (
      isRedundantRobotAliasSessionKey(rawSessionKey) ||
      isRedundantRobotAliasSessionKey(resolvedSessionKey)
    ) {
      const leftoverStore = await loadSessionEntryForClient("main", client);
      await retireLeftoverWorkbenchAliasesAroundStore(leftoverStore.storePath);
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "this leftover conversation path has been retired"),
      );
      return;
    }
    const sendAccessDenial = await resolvePersonalWorkbenchSessionAccessDenial({
      client,
      sessionKey: resolvedSessionKey,
      logGateway: context.logGateway,
    });
    if (sendAccessDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, sendAccessDenial));
      return;
    }
    {
      const leftoverStore = await loadSessionEntryForClient("main", client);
      await retireLeftoverWorkbenchAliasesAroundStore(leftoverStore.storePath);
    }
    const groupWriteDenial = await resolveCollaborationGroupWriteDenial({
      client,
      rawSessionKey,
      logGateway: context.logGateway,
    });
    if (groupWriteDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, groupWriteDenial));
      return;
    }
    await resolveAndBindChatTurnTenant(client, resolvedSessionKey);
    noteAuthorizedChatSessionInterest(client, resolvedSessionKey, p.idempotencyKey);
    if (isSpaceAliasSessionKey(resolvedSessionKey) || isSpaceAliasSessionKey(rawSessionKey)) {
      const clientRunId = p.idempotencyKey;
      const cached = context.dedupe.get(`chat:${clientRunId}`);
      if (cached) {
        respond(cached.ok, cached.payload, cached.error, {
          cached: true,
        });
        return;
      }

      const activeExisting = context.chatAbortControllers.get(clientRunId);
      if (activeExisting) {
        respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
          cached: true,
          runId: clientRunId,
        });
        return;
      }

      const duplicateSend = findActiveDuplicateChatSend(context.chatAbortControllers, {
        sessionKey: rawSessionKey,
        userMessageText: bodyTrimmed,
      });
      if (duplicateSend) {
        respond(true, { runId: duplicateSend.runId, status: "in_flight" as const }, undefined, {
          cached: true,
          runId: duplicateSend.runId,
        });
        return;
      }

      let scope: GroupDiscussionScope;
      try {
        scope = await resolveGroupDiscussionScope(rawSessionKey, client, {
          logGateway: context.logGateway,
        });
      } catch (err) {
        if (err instanceof CollaborationSpacePermissionsError) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, COLLABORATION_SPACE_PERMISSIONS_DENIAL),
          );
          return;
        }
        throw err;
      }
      const groupSession = await ensureGroupSessionEntry(scope, client);
      const recentGroupMessages =
        groupSession.entry.sessionId && groupSession.storePath
          ? readSessionMessages(
              groupSession.entry.sessionId,
              groupSession.storePath,
              groupSession.entry.sessionFile,
            )
          : [];
      // P0.1: buildGroupRuntimeAuthority is the only RuntimeAuthority constructor (§2.3 / §5.3).
      // Always creates an in-memory RoundPolicySnapshot; persist + event-key stay gated by
      // collaboration.policySnapshot (P0.0b, default OFF).
      // episodeId below is the legacy single-beat identity (ep_ + clientRunId).
      // P0 G2 persists that Episode only when collaboration.episodeStore is on
      // (default off). P0 G3 records Facilitator gate results on that same flag
      // and does not choose speakers. P0 G8 keeps speaking on executeCollaborationRound.
      const policySnapshotCfg = loadConfig();
      const policySnapshotEnabled = isCollabPolicySnapshotEnabled(policySnapshotCfg);
      const episodeId = episodeIdForClientRun(clientRunId);
      const beatId = beatIdForEpisode(episodeId, 0);
      const flagSnapshot: RoundPolicySnapshot | null = policySnapshotEnabled
        ? createRoundPolicySnapshotFromScope(scope, { cfg: policySnapshotCfg })
        : null;
      // P0 thin hardening: trust comes from resolveCollaborationTenantResolution
      // (membership → actor_fallback → none). Never invent a second Authority API;
      // tenantId still flows from scope; tenantTrust is no longer defaulted to
      // actor_fallback solely because scope.tenantId is present.
      const collabTenant = await resolveCollaborationTenantResolution(client);
      const {
        authority,
        facts,
        snapshot: policySnapshot,
      } = buildGroupRuntimeAuthority({
        scope,
        episodeId,
        cfg: policySnapshotCfg,
        tenantTrust: collabTenant.trust,
        ...(flagSnapshot ? { snapshot: flagSnapshot } : {}),
      });
      const collaborationEventKey: CollaborationEventKey | null = policySnapshotEnabled
        ? eventKeyOf(authority, beatId)
        : null;
      if (policySnapshotEnabled) {
        void persistPolicySnapshotBody({
          snapshot: policySnapshot,
          groupId: scope.groupId,
          tenantId: scope.tenantId ?? null,
          cfg: policySnapshotCfg,
        }).catch((err) => {
          context.logGateway.warn(
            `collaboration policy snapshot persist failed: ${formatForLog(err)}`,
          );
        });
      }
      // v1-only — P0.2 15:13 roll-call hotfix chat hooks (allow-list only; default off).
      const v1RollCallHooks = prepareV1RollCallChatHooks({
        tenantId: scope.tenantId,
        groupId: scope.groupId,
        message: mentionMessage,
        cfg: policySnapshotCfg,
      });
      let v1RollCallSenderLabel: string | undefined;
      if (v1RollCallHooks.preferEarlySenderLabel) {
        v1RollCallSenderLabel = (await resolveChatTranscriptSenderLabel(client)) ?? undefined;
      }
      if (v1RollCallHooks.stop) {
        // Abort any in-flight turns on this session; do not open a new round (P0-9).
        for (const [activeRunId, active] of context.chatAbortControllers) {
          if (active.sessionKey !== rawSessionKey) {
            continue;
          }
          active.controller.abort();
          context.chatAbortControllers.delete(activeRunId);
        }
        const stopAck = v1RollCallHooks.stopAck ?? "好的，本轮已停止。";
        respond(true, { runId: clientRunId, status: "stopped" as const, message: stopAck });
        return;
      }
      const decision = decideParticipants(authority, facts, {
        message: mentionMessage,
        roundId: clientRunId,
        explicitMentions: resolveExplicitMentionTokens(p.mentions),
        explicitMentionRefs: resolveExplicitMentionRefs(p.mentions),
        recentGroupMessages,
        ...(v1RollCallSenderLabel ? { senderLabel: v1RollCallSenderLabel } : {}),
        // P1-A5 ①: real OS for participation lane legacy BP-01/02 reads.
        operatingState: scope.operatingState ?? null,
      });
      // C2 follow-up: best-effort Wake Contract ledger on human @ / multi-@ nudge.
      // Flag collaboration.task.wakeContract OFF → no writes. Does not open Floor live.
      const wakeFromAgentId =
        (typeof client?.user === "string" && client.user.trim()) ||
        (typeof client?.platformUserId === "string" && client.platformUserId.trim()) ||
        v1RollCallSenderLabel ||
        "human";
      const wakeTaskId =
        (
          scope.operatingState as
            | { activeContext?: { currentTaskId?: string | null } }
            | null
            | undefined
        )?.activeContext?.currentTaskId?.trim() || undefined;
      void recordChatSendMentionWakesBestEffort({
        authority,
        cfg: policySnapshotCfg,
        groupId: scope.groupId,
        fromAgentId: wakeFromAgentId,
        message: mentionMessage,
        explicitMentions: resolveExplicitMentionTokens(p.mentions),
        explicitMentionRefs: resolveExplicitMentionRefs(p.mentions),
        bots: scope.bots,
        humans: facts.humans,
        relatedId: clientRunId,
        ...(wakeTaskId ? { taskId: wakeTaskId } : {}),
      }).catch(() => undefined);
      // C4: best-effort OGUI→handoff projection when message carries ogui-answer.
      // Flag collaboration.task.oguiHandoffProjection OFF → no writes. No Floor live / ui.*.
      void recordChatSendOguiProjectionBestEffort({
        authority,
        cfg: policySnapshotCfg,
        groupId: scope.groupId,
        message: mentionMessage,
        fromAgentId: wakeFromAgentId,
        relatedId: clientRunId,
        ...(wakeTaskId ? { taskId: wakeTaskId } : {}),
      }).catch(() => undefined);
      // TEAM-REAL R5: NL plan confirm — schema-backed binding fields, handler-resolved
      // trusted locator, await formal result, persist assistant line into transcript
      // so chat.history / UI see success or 尚未确认. Auto-advance NOT wired.
      {
        const confirmActor =
          (await resolveDeliveryAclActor(client, scope.groupId)) || wakeFromAgentId;
        const tenant = collabTenant;
        const readBound = (value: unknown): string | undefined =>
          typeof value === "string" && value.trim() ? value.trim() : undefined;
        const readBoundNum = (value: unknown): number | undefined =>
          typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
        // Schema fields on ChatSendParamsSchema (not type-assertion-only).
        const explicitTaskId = readBound(p.planConfirmTaskId);
        const explicitBoard = readBound(p.planConfirmBoardItemId);
        const explicitTodolist = readBound(p.planConfirmTodolistId);
        const explicitDecision = readBound(p.planConfirmDecisionId);
        const explicitVersion = readBoundNum(p.planConfirmExpectedVersion);
        const confirmIntent = parseChatPlanConfirmIntent(mentionMessage);
        const composed =
          confirmIntent.kind === "not_confirm"
            ? null
            : await resolveCompositionTrustedTeamContext({
                groupId: scope.groupId,
                actor: confirmActor || "",
                client,
                tenant,
                action: "write",
                cfg: policySnapshotCfg,
                stampedEnterpriseId: client?.sessionEnterpriseId,
                identityAliases: [client?.user, client?.platformUserId, client?.sessionMembershipId]
                  .map((value) => (typeof value === "string" ? value.trim() : ""))
                  .filter(Boolean),
              });
        let confirmHook: Awaited<ReturnType<typeof maybeConfirmPlanFromChatSend>>;
        try {
          if (composed && !composed.ok) {
            // Do not call list/confirm without a trusted locator. The previous
            // fallthrough masked ACL failures as trusted_group_locator_required.
            confirmHook = {
              handled: true,
              result: {
                status: "blocked",
                confirmed: false,
                reason: composed.reason,
                detail: composed.detail,
              },
              userMessage: `尚未确认：${composed.reason}${composed.detail ? `（${composed.detail}）` : ""}。`,
              blockDependentExecution: true,
              autoAdvanceWired: false,
            };
          } else {
            confirmHook = await maybeConfirmPlanFromChatSend({
              groupId: scope.groupId,
              message: mentionMessage,
              actor: confirmActor,
              // Prefer explicit card/reply binding; group currentTaskId alone is unreliable.
              taskId: explicitTaskId || wakeTaskId,
              boardItemId: explicitBoard,
              todolistId: explicitTodolist,
              decisionId: explicitDecision,
              expectedVersion: explicitVersion,
              taskIdFromGroupCurrent: !explicitTaskId && Boolean(wakeTaskId),
              tenant: composed?.ok ? composed.tenant : tenant,
              cfg: policySnapshotCfg,
              ...(composed?.ok
                ? {
                    auth: composed.auth,
                    stores: composed.stores,
                    trusted: composed.trusted,
                  }
                : {}),
            });
          }
        } catch (confirmError) {
          const errMsg = `尚未确认：确认入口异常（${
            confirmError instanceof Error ? confirmError.message : String(confirmError)
          }）。`;
          let transcriptPersist: { ok: boolean; error?: string } = {
            ok: false,
            error: "session_context_missing",
          };
          if (groupSession.entry.sessionId && groupSession.storePath) {
            try {
              transcriptPersist = await appendAssistantTranscriptMessage({
                message: errMsg,
                sessionId: groupSession.entry.sessionId,
                storePath: groupSession.storePath,
                sessionFile: groupSession.entry.sessionFile,
                createIfMissing: true,
                idempotencyKey: `${clientRunId}:plan-confirm-error`,
              });
            } catch (persistErr) {
              transcriptPersist = {
                ok: false,
                error: persistErr instanceof Error ? persistErr.message : String(persistErr),
              };
            }
          }
          respond(
            true,
            {
              runId: clientRunId,
              status: "stopped" as const,
              message: errMsg,
              transcriptPersist,
              transcriptVisible: transcriptPersist.ok,
            },
            undefined,
            { runId: clientRunId },
          );
          return;
        }
        if (confirmHook.handled) {
          let transcriptPersist: { ok: boolean; error?: string } = {
            ok: false,
            error: "session_context_missing",
          };
          if (groupSession.entry.sessionId && groupSession.storePath) {
            try {
              transcriptPersist = await appendAssistantTranscriptMessage({
                message: confirmHook.userMessage,
                sessionId: groupSession.entry.sessionId,
                storePath: groupSession.storePath,
                sessionFile: groupSession.entry.sessionFile,
                createIfMissing: true,
                idempotencyKey: `${clientRunId}:plan-confirm`,
              });
            } catch (persistErr) {
              transcriptPersist = {
                ok: false,
                error: persistErr instanceof Error ? persistErr.message : String(persistErr),
              };
            }
          }
          const visibleMessage = transcriptPersist.ok
            ? confirmHook.userMessage
            : `${confirmHook.userMessage}（展示写入失败：${transcriptPersist.error ?? "unknown"}）`;
          respond(
            true,
            {
              runId: clientRunId,
              status: "stopped" as const,
              // Transcript + response: chat.history can paint the same userMessage when persist ok.
              message: visibleMessage,
              planConfirm: confirmHook.result,
              autoAdvanceWired: confirmHook.autoAdvanceWired,
              transcriptPersist,
              transcriptVisible: transcriptPersist.ok,
              ...(composed?.ok
                ? {
                    trustedGroupLocator: composed.stores.groupLocator,
                    trustedGroupsRoot: composed.stores.groupsRoot,
                  }
                : {}),
            },
            undefined,
            { runId: clientRunId },
          );
          // Confirm turn never starts dependent execution here (auto-advance not wired).
          return;
        }
      }
      let v1RollCallExtraLines: string[] | undefined;
      if (v1RollCallHooks.active) {
        const lines: string[] = [];
        if (v1RollCallHooks.briefHint) {
          lines.push(v1RollCallHooks.briefHint);
        }
        let roster: V1RollCallRoster;
        try {
          const archive = await readCollaborationLedgerArchive({
            groupId: scope.groupId,
            tenantId: scope.tenantId,
            kinds: ["execution"],
            limit: 500,
          });
          const executions = archive.records.filter(
            (record): record is CollaborationExecutionRecord => record.kind === "execution",
          );
          roster = buildV1RollCallRosterFromExecutions({
            bots: scope.bots,
            executions,
          });
        } catch (err) {
          roster = buildV1RollCallRosterUnavailable(formatForLog(err));
        }
        lines.push(...buildV1RollCallRosterPromptLines(roster));
        v1RollCallExtraLines = lines;
      }
      const groupTranscriptPath = resolveTranscriptPath({
        sessionId: groupSession.entry.sessionId,
        storePath: groupSession.storePath,
        sessionFile: groupSession.entry.sessionFile,
      });
      if (!groupTranscriptPath) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "failed to resolve group transcript path"),
        );
        return;
      }
      const groupTranscriptCfg = loadConfig();
      const groupTranscriptProfile = resolveSecurityProfile(groupTranscriptCfg, process.env);
      const groupTenant =
        groupTranscriptProfile.profile === "managed_enterprise"
          ? await resolveTenantContext(client)
          : null;
      const ensuredGroupTranscript = await ensureTranscriptFile({
        transcriptPath: groupTranscriptPath,
        sessionId: groupSession.entry.sessionId,
        cwd: resolveTrustedGroupLocator({
          groupId: scope.groupId,
          tenantId: groupTenant?.tenantId ?? null,
          profile: groupTranscriptProfile.profile,
          cfg: groupTranscriptCfg,
        }),
        tenantId: groupTenant?.tenantId ?? null,
        ownerUserId: groupTenant?.userId ?? null,
        groupId: scope.groupId,
        failClosed: groupTranscriptProfile.profile === "managed_enterprise",
      });
      if (!ensuredGroupTranscript.ok) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `failed to create group transcript: ${ensuredGroupTranscript.error ?? "unknown error"}`,
          ),
        );
        return;
      }
      const senderLabel = v1RollCallSenderLabel ?? (await resolveChatTranscriptSenderLabel(client));
      const appendedUser = appendRawTranscriptMessage({
        transcriptPath: groupTranscriptPath,
        message: {
          id: `local-${clientRunId}`,
          role: "user",
          content: buildUserTranscriptContentBlocks({
            message: rawMessage,
            attachments: normalizedAttachments,
          }),
          timestamp: Date.now(),
          collaborationRoundId: clientRunId,
          ...(senderLabel ? { senderLabel } : {}),
        },
      });
      if (!appendedUser.ok) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `failed to write group transcript: ${appendedUser.error ?? "unknown error"}`,
          ),
        );
        return;
      }

      if (appendedUser.message) {
        broadcastChatUserEcho({
          context,
          runId: `${clientRunId}:user`,
          sessionKey: rawSessionKey,
          message: appendedUser.message,
        });
      }

      const stagedMediaContext = await stageChatImagesForAgentMediaContext({
        images: parsedImages,
        files: parsedFiles,
        runId: clientRunId,
        log: context.logGateway,
      });
      const groupMessagesAfterUserAppend =
        groupSession.entry.sessionId && groupSession.storePath
          ? readSessionMessages(
              groupSession.entry.sessionId,
              groupSession.storePath,
              groupSession.entry.sessionFile,
            )
          : [];
      const groupInboundHistory = buildCollaborationGroupInboundHistory({
        messages:
          groupMessagesAfterUserAppend.length > 0
            ? groupMessagesAfterUserAppend.slice(0, -1)
            : groupMessagesAfterUserAppend,
        limit: 24,
      });

      const groupCfg = (await loadSessionEntryForClient("main", client)).cfg;
      const groupTimeoutMs = resolveAgentTimeoutMs({
        cfg: groupCfg,
        overrideMs: p.timeoutMs,
      });
      const groupRunStartedAtMs = Date.now();
      // Parent run tracks the whole collaboration round so Cancel / maintenance
      // timeout can clear UI "处理中…" even when a child bot turn hangs after compaction.
      const parentAbortController = new AbortController();
      context.chatAbortControllers.set(clientRunId, {
        controller: parentAbortController,
        sessionId: groupSession.entry.sessionId ?? clientRunId,
        sessionKey: rawSessionKey,
        startedAtMs: groupRunStartedAtMs,
        expiresAtMs: resolveChatRunExpiresAtMs({
          now: groupRunStartedAtMs,
          timeoutMs: groupTimeoutMs,
        }),
        undoable: false,
        userMessageId: `local-${clientRunId}`,
        userMessageText: bodyTrimmed,
      });
      parentAbortController.signal.addEventListener(
        "abort",
        () => {
          for (const [activeRunId, active] of context.chatAbortControllers) {
            if (activeRunId === clientRunId) {
              continue;
            }
            if (active.sessionKey !== rawSessionKey) {
              continue;
            }
            active.controller.abort();
          }
          void abortPersistedRound({
            groupId: scope.groupId,
            roundId: clientRunId,
            tenantId: scope.tenantId,
          }).catch((err) => {
            context.logGateway.warn(
              `collaboration round abort persist failed: ${formatForLog(err)}`,
            );
          });
        },
        { once: true },
      );

      respond(true, { runId: clientRunId, status: "started" as const }, undefined, {
        runId: clientRunId,
      });

      broadcastCollaborationRoundPlan({
        context,
        payload: decision.roundPlan,
      });
      void appendCollaborationDispatchRecord({
        groupId: scope.groupId,
        tenantId: scope.tenantId,
        message: transcriptMessage,
        decision,
        ...(collaborationEventKey ? { key: collaborationEventKey } : {}),
      }).catch((err) => {
        context.logGateway.warn(`collaboration ledger append failed: ${formatForLog(err)}`);
      });

      const groupSourceAgentId = resolveSessionAgentId({
        sessionKey: rawSessionKey,
        config: groupCfg,
      });
      void deliverChatSendMentions({
        context,
        cfg: groupCfg,
        sessionEntry: groupSession.entry,
        sessionKey: rawSessionKey,
        messageId: clientRunId,
        messageText: inboundMessage,
        mentions: p.mentions,
        sourceAgentId: groupSourceAgentId,
        client,
      });

      void groupDiscussionQueue
        .enqueue(rawSessionKey, async () => {
          try {
            if (parentAbortController.signal.aborted) {
              return;
            }
            const participationTierByAgentId = new Map(
              decision.roundPlan.participants.map((participant) => [
                participant.agentId,
                participant.tier,
              ]),
            );
            const contributionRoleByAgentId = new Map(
              decision.roundPlan.participants.map((participant) => [
                participant.agentId,
                participant.contributionRole,
              ]),
            );
            const sameRoundReplies: SameRoundReply[] = [];
            let roundFailed = false;
            let roundFailureMessage = "协作回合执行失败";
            let lastSkipReason: CollaborationSkipReason | undefined;
            let lastSkipDetail: string | undefined;
            let lastSkipAgentName: string | undefined;

            const runStageBot = async (params: {
              bot: GroupDiscussionBotTarget;
              isWrapTurn: boolean;
              contributionRole?: ContributionRole;
              dispatchRole?: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
              collabEdge?: CollabEdge;
            }) => {
              if (parentAbortController.signal.aborted) {
                return;
              }
              try {
                const reply = await runGroupBotDiscussionTurn({
                  context,
                  client,
                  bot: params.bot,
                  scope,
                  decision,
                  clientRunId,
                  collaborationRoundId: clientRunId,
                  participationTier: participationTierByAgentId.get(params.bot.agentId) ?? "duty",
                  contributionRole:
                    params.contributionRole ?? contributionRoleByAgentId.get(params.bot.agentId),
                  isWrapTurn: params.isWrapTurn,
                  message: transcriptMessage,
                  thinking: p.thinking,
                  timeoutMs: p.timeoutMs,
                  deliver: p.deliver,
                  parsedImages,
                  stagedMediaContext,
                  systemInputProvenance,
                  systemProvenanceReceipt,
                  groupInboundHistory,
                  // Only prior completed replies — never in-flight future turns.
                  sameRoundContext: buildSameRoundContext(sameRoundReplies),
                  dispatchRole: params.dispatchRole,
                  ...(params.collabEdge ? { collabEdge: params.collabEdge } : {}),
                  ...(p.contextScope ? { contextScopeRequest: p.contextScope } : {}),
                  ...(policySnapshot
                    ? { effective: policySnapshot.effective as EffectiveCollaborationPolicy }
                    : {}),
                  ...(collaborationEventKey ? { eventKey: collaborationEventKey } : {}),
                  onSkip: (reason, detail) => {
                    lastSkipReason = reason;
                    lastSkipAgentName = params.bot.name;
                    const trimmed = detail?.trim();
                    if (trimmed) {
                      lastSkipDetail = trimmed;
                    }
                    // Expert #5: surface mid-round silent suppress (flag default OFF).
                    if (isCollaborationSurfaceSilentSuppressReasonsEnabled(groupCfg)) {
                      const kind = collaborationSuppressKindFromSkipReason(reason);
                      const notice = formatCollaborationSuppressNotice({
                        kind,
                        agentName: params.bot.name,
                        detail: trimmed,
                      });
                      appendRawTranscriptMessage({
                        transcriptPath: groupTranscriptPath,
                        message: {
                          role: "assistant",
                          content: [{ type: "text", text: notice }],
                          timestamp: Date.now(),
                          senderLabel: "协作调度",
                          collaborationRoundId: clientRunId,
                          collaborationMemberSkip: true,
                          collaborationSuppressKind: kind,
                        },
                      });
                    }
                  },
                  ...(v1RollCallExtraLines?.length ? { v1RollCallExtraLines } : {}),
                  authority,
                });
                if (reply) {
                  sameRoundReplies.push(reply);
                  // C2/C3: observe assistant inline @; when assistantMentionDispatch
                  // ON + bots resolve, ledger outcome=dispatched (edges attach in
                  // round-runtime peer_ask path). Not Floor live / no new round.
                  void observeAssistantReplyWakeBestEffort({
                    authority,
                    cfg: policySnapshotCfg,
                    groupId: scope.groupId,
                    fromAgentId: params.bot.agentId,
                    text: reply.text,
                    relatedId: clientRunId,
                    bots: scope.bots,
                    ...(wakeTaskId ? { taskId: wakeTaskId } : {}),
                  }).catch(() => undefined);
                }
                return reply;
              } catch (err) {
                roundFailed = true;
                lastSkipReason = "crash";
                lastSkipAgentName = params.bot.name;
                roundFailureMessage = formatCollaborationRoundFailure(err);
                context.logGateway.warn(
                  `group discussion bot failed (${params.bot.agentId}): ${formatForLog(err)}`,
                );
                void appendCollaborationExecutionRecord({
                  groupId: scope.groupId,
                  tenantId: scope.tenantId,
                  ...(collaborationEventKey ? { key: collaborationEventKey } : {}),
                  sessionKey: scope.rawSessionKey,
                  roundId: clientRunId,
                  agentId: params.bot.agentId,
                  agentName: params.bot.name,
                  tier: participationTierByAgentId.get(params.bot.agentId) ?? "duty",
                  status: "failed",
                  contributionRole:
                    params.contributionRole ?? contributionRoleByAgentId.get(params.bot.agentId),
                  latencyMs: 0,
                }).catch((ledgerErr) => {
                  context.logGateway.warn(
                    `collaboration execution ledger append failed: ${formatForLog(ledgerErr)}`,
                  );
                });
                return undefined;
              }
            };

            // Phase-1 controlled discuss→task: trusted inbound → receipt → coordinator bind.
            let formalTaskEstablish:
              | {
                  attempted: boolean;
                  status?: string;
                  taskId?: string | null;
                  reason?: string;
                  userMessage?: string;
                  stagesSummary?: string;
                }
              | undefined;
            let discussToTaskCoordinatorBinding: string | undefined;
            try {
              const d2tActor =
                (await resolveDeliveryAclActor(client, scope.groupId)) || wakeFromAgentId || "";
              const d2tTurn = await runControlledDiscussToTaskChatTurn({
                groupId: scope.groupId,
                sourceMessageId: clientRunId,
                message: transcriptMessage,
                principalActor: d2tActor,
                client,
                tenant: collabTenant,
                cfg: policySnapshotCfg,
                stampedEnterpriseId: client?.sessionEnterpriseId,
                identityAliases: [client?.user, client?.platformUserId, client?.sessionMembershipId]
                  .map((value) => (typeof value === "string" ? value.trim() : ""))
                  .filter(Boolean),
                persistReceipt: async ({ message, idempotencyKey }) => {
                  if (!groupSession.entry.sessionId || !groupSession.storePath) {
                    return { ok: false, error: "session_context_missing" };
                  }
                  try {
                    return await appendAssistantTranscriptMessage({
                      message,
                      sessionId: groupSession.entry.sessionId,
                      storePath: groupSession.storePath,
                      sessionFile: groupSession.entry.sessionFile,
                      createIfMissing: true,
                      idempotencyKey,
                    });
                  } catch (persistErr) {
                    return {
                      ok: false,
                      error: persistErr instanceof Error ? persistErr.message : String(persistErr),
                    };
                  }
                },
              });
              const d2tApplied = applyDiscussToTaskChatTurnToChatHandler(d2tTurn);
              if (d2tApplied.formalTaskEstablish) {
                formalTaskEstablish = d2tApplied.formalTaskEstablish;
              }
              if (d2tApplied.coordinatorBindingText) {
                discussToTaskCoordinatorBinding = d2tApplied.coordinatorBindingText;
              }
              // Deterministic client feedback via existing chat event egress (broadcastChat /
              // nodeSendToSession). Covers normal / conflict / exception / persist-failure
              // so the client receives content even when transcript persist fails.
              const d2tEgress = emitDiscussToTaskClientFeedback({
                applied: d2tApplied,
                sessionKey: rawSessionKey,
                runId: clientRunId,
                broadcastChat: context.broadcastChat,
                nodeSendToSession: context.nodeSendToSession,
                tenantId: collabTenant?.tenantId ?? client?.sessionEnterpriseId ?? null,
              });
              if (d2tApplied.transcriptPersist && !d2tApplied.transcriptPersist.ok) {
                context.logGateway.warn(
                  `discuss-to-task receipt transcript persist failed: ${d2tApplied.transcriptPersist.error ?? "unknown"}`,
                );
              }
              if (!d2tEgress.emitted && d2tApplied.clientFeedbackMessage) {
                context.logGateway.warn(
                  "discuss-to-task client feedback egress did not emit despite clientFeedbackMessage",
                );
              }
              if (d2tTurn.error) {
                context.logGateway.warn(
                  `controlled discuss-to-task before discussion failed: ${d2tTurn.error}`,
                );
              }
            } catch (d2tErr) {
              context.logGateway.warn(
                `controlled discuss-to-task before discussion failed: ${formatForLog(d2tErr)}`,
              );
              formalTaskEstablish = {
                attempted: true,
                status: "blocked",
                taskId: null,
                reason: "discuss_to_task_hook_failed",
                userMessage: "正式任务建立受阻，尚未建立正式任务。",
              };
              discussToTaskCoordinatorBinding =
                "[正式任务入口回执 — 必须绑定] status=blocked；禁止口头宣称已派工。";
              // Exception path: still push safe status through chat event egress.
              emitDiscussToTaskClientFeedback({
                applied: {
                  formalTaskEstablish,
                  coordinatorBindingText: discussToTaskCoordinatorBinding,
                  clientFeedbackMessage: formalTaskEstablish.userMessage,
                },
                sessionKey: rawSessionKey,
                runId: clientRunId,
                broadcastChat: context.broadcastChat,
                nodeSendToSession: context.nodeSendToSession,
                tenantId: collabTenant?.tenantId ?? client?.sessionEnterpriseId ?? null,
              });
            }

            const completedRound = await runSingleBeatEpisodeAroundRound({
              cfg: policySnapshotCfg,
              groupId: authority.groupId,
              tenantId: authority.tenantId,
              episodeId,
              roundId: clientRunId,
              policySnapshotId: policySnapshot.policySnapshotId,
              policyHash: policySnapshot.policyHash,
              provenanceHash: policySnapshot.provenanceHash,
              compilerRevision: policySnapshot.compilerRevision,
              key: collaborationEventKey,
              decision,
              message: transcriptMessage,
              effective: policySnapshot.effective as EffectiveCollaborationPolicy,
              executeRound: () =>
                executeCollaborationRound(authority, facts, {
                  decision,
                  message: discussToTaskCoordinatorBinding
                    ? `${discussToTaskCoordinatorBinding}\n\n${transcriptMessage}`
                    : transcriptMessage,
                  productionExecutor: resolveProductionCollaborationExecutor(policySnapshotCfg),
                  sessionKey: rawSessionKey,
                  skipRoundIds: [clientRunId, ...context.chatAbortControllers.keys()],
                  signal: parentAbortController.signal,
                  isAborted: () => parentAbortController.signal.aborted,
                  sourceMessageId: clientRunId,
                  ...(formalTaskEstablish ? { formalTaskEstablish } : {}),
                  ...(p.contextScope ? { contextScope: p.contextScope } : {}),
                  ...(collaborationEventKey ? { eventKey: collaborationEventKey } : {}),
                  runBot: async ({
                    bot,
                    isWrapTurn,
                    role,
                    edge,
                  }: {
                    bot: CollaborationBotTarget;
                    isWrapTurn: boolean;
                    role: "primary" | "explicit_member" | "fallback" | "supplement" | "close";
                    edge?: import("../collaboration-dispatch/collab-edge.js").CollabEdge;
                    dispatchId: string;
                  }) => {
                    const plannedRole = contributionRoleByAgentId.get(bot.agentId);
                    const edgeRole = edge ? collabEdgeContributionRole(edge.kind) : undefined;
                    const reply = await runStageBot({
                      bot,
                      isWrapTurn,
                      dispatchRole: role,
                      contributionRole: isWrapTurn
                        ? "wrap"
                        : // Edge targets outside the plan: challenge keeps conflict; peer_ask /
                          // handoff answer as a supplement (executor prompt allows NO_REPLY).
                          (plannedRole ?? (edgeRole === "challenge" ? "challenge" : undefined)),
                      ...(edge ? { collabEdge: edge } : {}),
                    });
                    return reply ?? undefined;
                  },
                }).catch((err) => {
                  roundFailed = true;
                  lastSkipReason = "crash";
                  roundFailureMessage = formatCollaborationRoundFailure(err);
                  context.logGateway.warn(
                    `collaboration round execute failed: ${formatForLog(err)}`,
                  );
                  return null;
                }),
            });

            // chat-checkpoint-rollback: write group continuity into the same
            // tenant/host group memory root list uses. Group scope ignores agent
            // cwd for memoryDir, so do not skip when resolveCallerWorkspaceCwd
            // returns null (LIVE space sessions often have no agent workspace).
            const fallbackAgentWorkspaceDir = await resolveCallerWorkspaceCwd({
              cfg: groupCfg,
              sessionKey: rawSessionKey,
              agentId: groupSourceAgentId,
              client,
            });
            const collabContinuityTenantId =
              authority.tenantId?.trim() || client?.sessionEnterpriseId?.trim() || null;
            const groupWorkspaceDir = resolveSessionContinuityWorkspaceDir({
              cfg: groupCfg,
              sessionKey: rawSessionKey,
              sessionEntry: groupSession.entry,
              agentId: groupSourceAgentId,
              agentWorkspaceDir: fallbackAgentWorkspaceDir ?? process.cwd(),
              tenantId: collabContinuityTenantId,
            });
            void commitSessionContinuityForCurrentSession({
              cfg: groupCfg,
              workspaceDir: groupWorkspaceDir,
              agentId: groupSourceAgentId,
              sessionKey: rawSessionKey,
              sessionEntry: groupSession.entry,
              reason: "turn_completed",
              tenantId: collabContinuityTenantId,
            }).catch(() => undefined);
            if (parentAbortController.signal.aborted) {
              return;
            }
            const abortedWithoutVisibleReply =
              (roundFailed || completedRound?.state === "ROUND_ABORTED") &&
              sameRoundReplies.length === 0;
            const abortSkipReason =
              lastSkipReason ??
              (completedRound?.state === "MENTION_CONFIRM"
                ? "mention_confirm"
                : completedRound?.state === "ROUND_ABORTED"
                  ? "timeout"
                  : "crash");
            const abortSuppressKind = collaborationSuppressKindFromSkipReason(
              completedRound?.state === "MENTION_CONFIRM" && !lastSkipReason
                ? "waiting_member"
                : abortSkipReason,
            );
            const abortNotice = abortedWithoutVisibleReply
              ? isCollaborationSurfaceSilentSuppressReasonsEnabled(groupCfg)
                ? formatCollaborationSuppressAbortNotice({
                    kind: abortSuppressKind,
                    agentName: lastSkipAgentName,
                    detail: roundFailed ? roundFailureMessage : lastSkipDetail,
                  })
                : formatCollaborationRoundAbortNotice({
                    agentName: lastSkipAgentName,
                    skipReason:
                      lastSkipReason ??
                      (completedRound?.state === "ROUND_ABORTED" ? "timeout" : "crash"),
                    errorMessage: roundFailed ? roundFailureMessage : lastSkipDetail,
                    userText: bodyTrimmed,
                  })
              : null;
            const abortNoticeMessage = abortNotice
              ? {
                  role: "assistant",
                  content: [{ type: "text", text: abortNotice }],
                  timestamp: Date.now(),
                  senderLabel: "协作调度",
                  collaborationRoundId: clientRunId,
                  collaborationAbort: true,
                  ...(isCollaborationSurfaceSilentSuppressReasonsEnabled(groupCfg)
                    ? { collaborationSuppressKind: abortSuppressKind }
                    : {}),
                }
              : undefined;
            if (abortNoticeMessage) {
              appendRawTranscriptMessage({
                transcriptPath: groupTranscriptPath,
                message: abortNoticeMessage,
              });
            }
            const confirmQuestion =
              completedRound?.state === "MENTION_CONFIRM"
                ? decision.mentionConfirm?.question
                : undefined;
            const confirmNoticeMessage = confirmQuestion
              ? {
                  role: "assistant",
                  content: [{ type: "text", text: confirmQuestion }],
                  timestamp: Date.now(),
                  senderLabel: "协作调度",
                  collaborationRoundId: clientRunId,
                  collaborationMentionConfirm: true,
                }
              : undefined;
            if (confirmNoticeMessage) {
              appendRawTranscriptMessage({
                transcriptPath: groupTranscriptPath,
                message: confirmNoticeMessage,
              });
            }
            // Stream close is not task completion. Failed rounds still finalize
            // the transcript so the UI does not hang, but must not record ok.
            if (roundFailed || abortedWithoutVisibleReply) {
              setGatewayDedupeEntry({
                dedupe: context.dedupe,
                key: `chat:${clientRunId}`,
                entry: {
                  ts: Date.now(),
                  ok: false,
                  payload: { runId: clientRunId, status: "error" as const },
                },
              });
              broadcastChatError({
                context,
                runId: clientRunId,
                sessionKey: rawSessionKey,
                errorMessage: abortNotice ?? roundFailureMessage,
              });
            } else {
              setGatewayDedupeEntry({
                dedupe: context.dedupe,
                key: `chat:${clientRunId}`,
                entry: {
                  ts: Date.now(),
                  ok: true,
                  payload: { runId: clientRunId, status: "ok" as const },
                },
              });
            }
            broadcastChatFinal({
              context,
              runId: clientRunId,
              sessionKey: rawSessionKey,
              message: abortNoticeMessage ?? confirmNoticeMessage,
            });
          } finally {
            endChatRunAndMaybeFlushRestore({
              context,
              runId: clientRunId,
              client,
              isWebchatConnect,
            });
          }
        })
        .catch((err) => {
          endChatRunAndMaybeFlushRestore({
            context,
            runId: clientRunId,
            client,
            isWebchatConnect,
          });
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: `chat:${clientRunId}`,
            entry: {
              ts: Date.now(),
              ok: false,
              payload: {
                runId: clientRunId,
                status: "error" as const,
                summary: String(err),
              },
              error: errorShape(ErrorCodes.UNAVAILABLE, String(err)),
            },
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey: rawSessionKey,
            errorMessage: String(err),
          });
        });
      return;
    }
    const {
      cfg,
      entry,
      storePath,
      canonicalKey: sessionKey,
    } = await loadSessionEntryForClient(resolvedSessionKey, client);
    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: p.timeoutMs,
    });
    const now = Date.now();
    const clientRunId = p.idempotencyKey;

    const sendPolicy = resolveSendPolicy({
      cfg,
      entry,
      sessionKey,
      channel: entry?.channel,
      chatType: entry?.chatType,
    });
    if (sendPolicy === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
      );
      return;
    }

    if (stopCommand) {
      const res = await abortChatRunsForSessionKeyWithPartials({
        context,
        ops: createChatAbortOps(context),
        sessionKey: resolvedSessionKey,
        abortOrigin: "stop-command",
        stopReason: "stop",
        client,
        sessionFile: entry?.sessionFile,
      });
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const cached = context.dedupe.get(`chat:${clientRunId}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }

    const activeExisting = context.chatAbortControllers.get(clientRunId);
    if (activeExisting) {
      respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
        cached: true,
        runId: clientRunId,
      });
      return;
    }

    const duplicateSend = findActiveDuplicateChatSend(context.chatAbortControllers, {
      sessionKey: resolvedSessionKey,
      userMessageText: bodyTrimmed,
    });
    if (duplicateSend) {
      respond(true, { runId: duplicateSend.runId, status: "in_flight" as const }, undefined, {
        cached: true,
        runId: duplicateSend.runId,
      });
      return;
    }

    try {
      const stagedMediaContext = await stageChatImagesForAgentMediaContext({
        images: parsedImages,
        files: parsedFiles,
        runId: clientRunId,
        log: context.logGateway,
      });
      const agentId = resolveSessionAgentId({
        sessionKey,
        config: cfg,
      });
      void recordAgentInvocationShadow({ client, agentId, cfg, runId: clientRunId });
      // P1 C+3 前置门控：首条任务先 analyze；有 unmet 技能则阻断 run，不执行。
      // 用户选择「先做再说」/增强后续发时传 growthGateProceed=true 放行。
      const parsedAgentSession = parseAgentSessionKey(sessionKey);
      const isRobotMissionSession =
        Boolean(agentId) &&
        Boolean(parsedAgentSession?.agentId) &&
        !parsedAgentSession!.rest.startsWith("space:") &&
        !p.growthBirthTurn;
      if (isRobotMissionSession && agentId) {
        const missionAgentId = agentId;
        try {
          const before = await readRobotGrowthStatus(cfg, missionAgentId);
          const hadMission =
            typeof before?.milestones.firstMissionSentAtMs === "number" &&
            before.milestones.firstMissionSentAtMs > 0;
          if (!hadMission) {
            if (!p.growthGateProceed) {
              const analyzed = await analyzeAndStoreGrowthTask({
                cfg,
                agentId: missionAgentId,
                draftText: mentionMessage.trim() || bodyTrimmed,
                source: "composer",
              });
              const pending = analyzed?.growthStatus.pendingTaskContext ?? null;
              const blocked = shouldBlockGrowthTaskSend({
                growthBirthTurn: false,
                growthGateProceed: false,
                hadFirstMissionSent: false,
                pending,
                recommendationGaps: analyzed?.recommendation.gaps,
              });
              if (blocked && analyzed) {
                respond(
                  true,
                  {
                    runId: clientRunId,
                    status: "growth_gate_blocked" as const,
                    growthGate: {
                      blocked: true as const,
                      ...analyzed,
                    },
                  },
                  undefined,
                );
                return;
              }
            }
            await recordRobotGrowthMilestone(cfg, missionAgentId, "firstMissionSentAtMs");
            await clearRobotPendingTaskContext(cfg, missionAgentId);
          } else {
            void clearRobotPendingTaskContext(cfg, missionAgentId).catch(() => {});
          }
        } catch {
          void recordRobotGrowthMilestone(cfg, missionAgentId, "firstMissionSentAtMs").catch(
            () => {},
          );
        }
      }
      const clientInfo = client?.connect?.client;
      const transcriptSenderLabel = await resolveChatTranscriptSenderLabel(client);
      const transcriptGovernance = await resolveChatTranscriptGovernance({ client, cfg });
      const callerWorkspaceCwd = await resolveCallerWorkspaceCwd({
        cfg,
        sessionKey,
        agentId,
        client,
      });
      let taskTracking: ReturnType<typeof applyFocusSwitchGate> = {
        action: "continue",
        decisionCode: "focus_clear",
        cutContext: false,
        taskId: "",
      };
      if (!p.growthBirthTurn) {
        try {
          // Always inject live ResumeParkedRecheck so resume revalidates auth + stop.
          const stopIdentity = authoritativeStopIdentityFromClient(client);
          taskTracking = applyChatFocusSwitchGateWithResumeRecheck({
            sessionFile: entry?.sessionFile,
            incomingText: mentionMessage.trim() || bodyTrimmed,
            workspacePaths: callerWorkspaceCwd ? [callerWorkspaceCwd] : [],
            proceed: p.focusSwitchProceed === true,
            recheckInputs: {
              sendPolicy,
              accessAuthorized: true,
              clientIdentityOk: clientIdentityOkForResume(client),
              // Session-wide live-controller scan is secondary only; scoped
              // authoritative stop (tenant/user/session+taskId) survives abort→delete.
              // Incomplete identity → unverifiable → fail closed (never "not stopped").
              stopActive: sessionStopBarrierActive({
                sessionKeys: [resolvedSessionKey, sessionKey],
                chatAbortControllers: context.chatAbortControllers,
                scopeKind: stopIdentity.scopeKind,
                tenantId: stopIdentity.tenantId,
                userId: stopIdentity.userId,
              }),
              isTaskStopActive: buildResumeTaskStopActive({
                sessionKeys: [resolvedSessionKey, sessionKey],
                chatAbortControllers: context.chatAbortControllers,
                scopeKind: stopIdentity.scopeKind,
                tenantId: stopIdentity.tenantId,
                userId: stopIdentity.userId,
              }),
            },
          });
        } catch {
          recordFocusSwitchDecision("focus_state_unavailable");
        }
      }
      const stewardRobotMention =
        Boolean(extractEmployeeStewardUserIdFromSessionKey(sessionKey)) &&
        !sessionKey.includes(":space:") &&
        /@[^\s@]+/.test(rawMessage);
      const taskStatusLine =
        "statusLine" in taskTracking && typeof taskTracking.statusLine === "string"
          ? taskTracking.statusLine.trim()
          : "";
      const ownerAbortInFlight =
        "abortInFlight" in taskTracking && taskTracking.abortInFlight === true;
      if (shouldTaskParkAbortInFlight(taskTracking.cutContext, ownerAbortInFlight)) {
        await abortChatRunsForSessionKeyWithPartials({
          context,
          ops: createChatAbortOps(context),
          sessionKey: resolvedSessionKey,
          abortOrigin: "rpc",
          stopReason: "task-park",
          client,
          sessionFile: entry?.sessionFile,
        });
      }
      if (taskTracking.action === "cancel_parked") {
        observeConversationTaskCancelPathConsult({
          sessionKey,
          text: rawMessage,
        });
      }
      const shouldPersistUserTranscript =
        normalizedAttachments.length > 0 ||
        (isChatInboundPersistEarlyEnabled() && Boolean(rawMessage.trim())) ||
        (Boolean(taskStatusLine) && Boolean(rawMessage.trim())) ||
        (taskTracking.cutContext && Boolean(rawMessage.trim())) ||
        (stewardRobotMention && Boolean(rawMessage.trim()));
      if (shouldPersistUserTranscript) {
        const persistStartedAtMs = Date.now();
        const userMessage = {
          id: `local-${clientRunId}`,
          role: "user",
          ...(taskTracking.cutContext ? { contextCut: true } : {}),
          content: buildUserTranscriptContentBlocks({
            message: rawMessage,
            attachments: normalizedAttachments,
          }),
          timestamp: Date.now(),
          ...(transcriptSenderLabel ? { senderLabel: transcriptSenderLabel } : {}),
        };
        const appendedUser = await appendUserTranscriptMessage({
          sessionId: entry?.sessionId ?? clientRunId,
          storePath,
          sessionFile: entry?.sessionFile,
          agentId,
          idempotencyKey: clientRunId,
          message: userMessage,
          workspaceCwd: callerWorkspaceCwd,
          tenantId: transcriptGovernance.tenantId,
          ownerUserId: transcriptGovernance.ownerUserId,
          groupId: transcriptGovernance.groupId,
          failClosed: transcriptGovernance.failClosed,
        });
        if (!appendedUser.ok) {
          emitChatInboundStage({
            runId: clientRunId,
            stage: "user_persist_error",
            sessionKey: resolvedSessionKey,
            extra: {
              persistMs: Date.now() - persistStartedAtMs,
              hadAttachments: normalizedAttachments.length > 0,
            },
          });
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              normalizedAttachments.length > 0
                ? `failed to persist uploaded attachment: ${appendedUser.error ?? "unknown error"}`
                : `failed to persist user message: ${appendedUser.error ?? "unknown error"}`,
            ),
          );
          return;
        }
        emitChatInboundStage({
          runId: clientRunId,
          stage: "user_persisted",
          sessionKey: resolvedSessionKey,
          extra: {
            persistMs: Date.now() - persistStartedAtMs,
            hadAttachments: normalizedAttachments.length > 0,
          },
        });
        try {
          const { resolveExistingSessionTranscriptPath, syncTranscriptIndex } =
            await loadTranscriptHistoryHelpers();
          const persistedPath = resolveExistingSessionTranscriptPath(
            entry?.sessionId ?? clientRunId,
            storePath,
            entry?.sessionFile,
          );
          if (persistedPath) {
            syncTranscriptIndex(persistedPath);
          }
        } catch {
          // Sidecar index is derived; persist already succeeded.
        }
        broadcastChatUserEcho({
          context,
          runId: `${clientRunId}:user`,
          sessionKey: resolvedSessionKey,
          message: appendedUser.message ?? userMessage,
        });
        const taskStatusSeparator = transcriptEntriesForInboundTurn({
          userMessage,
          taskStatusLine,
        })[1];
        if (taskStatusSeparator) {
          await appendUserTranscriptMessage({
            sessionId: entry?.sessionId ?? clientRunId,
            storePath,
            sessionFile: entry?.sessionFile,
            agentId,
            idempotencyKey: `${clientRunId}:task-status`,
            message: {
              ...taskStatusSeparator,
              id: `local-${clientRunId}:task-status`,
              timestamp: Date.now(),
            },
            workspaceCwd: callerWorkspaceCwd,
            tenantId: transcriptGovernance.tenantId,
            ownerUserId: transcriptGovernance.ownerUserId,
            groupId: transcriptGovernance.groupId,
            failClosed: transcriptGovernance.failClosed,
          });
        }
      }

      const abortController = new AbortController();
      context.chatAbortControllers.set(clientRunId, {
        controller: abortController,
        sessionId: entry?.sessionId ?? clientRunId,
        sessionKey: resolvedSessionKey,
        startedAtMs: now,
        expiresAtMs: resolveChatRunExpiresAtMs({ now, timeoutMs }),
        undoable: true,
        userMessageId: `local-${clientRunId}`,
        userMessageText: bodyTrimmed,
      });
      const ackPayload = {
        runId: clientRunId,
        status: "started" as const,
        ...(taskStatusLine ? { taskStatusLine, taskId: taskTracking.taskId } : {}),
      };
      respond(true, ackPayload, undefined, { runId: clientRunId });
      emitChatInboundStage({
        runId: clientRunId,
        stage: "dispatch_started",
        sessionKey: resolvedSessionKey,
      });

      const mentionRoute = await deliverChatSendMentions({
        context,
        cfg,
        sessionEntry: entry,
        sessionKey,
        messageId: clientRunId,
        messageText: inboundMessage,
        mentions: p.mentions,
        sourceAgentId: agentId,
        client,
      });
      markChatRunNotUndoable(context.chatAbortControllers, clientRunId);
      if (mentionRoute.skipHostAgent) {
        setGatewayDedupeEntry({
          dedupe: context.dedupe,
          key: `chat:${clientRunId}`,
          entry: {
            ts: Date.now(),
            ok: true,
            payload: { runId: clientRunId, status: "ok" as const },
          },
        });
        broadcastChatFinal({
          context,
          runId: clientRunId,
          sessionKey: resolvedSessionKey,
        });
        endChatRunAndMaybeFlushRestore({
          context,
          runId: clientRunId,
          client,
          isWebchatConnect,
        });
        return;
      }

      // Owner pause/cancel: board updated + in-flight aborted above. Do not start a
      // new business turn for the control utterance itself (status already in ack).
      if (ownerAbortInFlight) {
        setGatewayDedupeEntry({
          dedupe: context.dedupe,
          key: `chat:${clientRunId}`,
          entry: {
            ts: Date.now(),
            ok: true,
            payload: {
              runId: clientRunId,
              status: "ok" as const,
              ...(taskStatusLine ? { taskStatusLine, taskId: taskTracking.taskId } : {}),
            },
          },
        });
        broadcastChatFinal({
          context,
          runId: clientRunId,
          sessionKey: resolvedSessionKey,
          ...(taskStatusLine
            ? {
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: taskStatusLine }],
                  timestamp: Date.now(),
                },
              }
            : {}),
        });
        endChatRunAndMaybeFlushRestore({
          context,
          runId: clientRunId,
          client,
          isWebchatConnect,
        });
        return;
      }

      const trimmedMessage = transcriptMessage.trim();
      const injectThinking = Boolean(
        p.thinking && trimmedMessage && !trimmedMessage.startsWith("/"),
      );
      const commandBody = injectThinking
        ? `/think ${p.thinking} ${transcriptMessage}`
        : transcriptMessage;
      const messageForAgentBase = systemProvenanceReceipt
        ? [systemProvenanceReceipt, transcriptMessage].filter(Boolean).join("\n\n")
        : transcriptMessage;
      const messageForAgent =
        taskTracking.action === "resume" && taskTracking.restoredPrompt
          ? taskTracking.restoredPrompt
          : messageForAgentBase;
      const {
        originatingChannel,
        originatingTo,
        accountId,
        messageThreadId,
        explicitDeliverRoute,
      } = resolveChatSendOriginatingRoute({
        client: clientInfo,
        deliver: p.deliver,
        entry,
        hasConnectedClient: client?.connect !== undefined,
        mainKey: cfg.session?.mainKey,
        sessionKey,
      });
      // Inject timestamp so agents know the current date/time.
      // Only BodyForAgent gets the timestamp — Body stays raw for UI display.
      // See: https://github.com/moltbot/moltbot/issues/3658
      const stampedMessage = injectTimestamp(messageForAgent, timestampOptsFromConfig(cfg));

      const ctx: MsgContext = applyStagedChatMediaContext(
        {
          Body: messageForAgent,
          BodyForAgent: stampedMessage,
          BodyForCommands: commandBody,
          RawBody: transcriptMessage,
          CommandBody: commandBody,
          InputProvenance: systemInputProvenance,
          SessionKey: sessionKey,
          Provider: INTERNAL_MESSAGE_CHANNEL,
          Surface: INTERNAL_MESSAGE_CHANNEL,
          OriginatingChannel: originatingChannel,
          OriginatingTo: originatingTo,
          ExplicitDeliverRoute: explicitDeliverRoute,
          AccountId: accountId,
          MessageThreadId: messageThreadId,
          ChatType: "direct",
          CommandAuthorized: true,
          MessageSid: clientRunId,
          SenderId: clientInfo?.id,
          SenderName: clientInfo?.displayName,
          SenderUsername: clientInfo?.displayName,
          GatewayClientScopes: client?.connect?.scopes,
          GatewayClientUser: client?.user,
          GatewayClientSessionDomain: client?.sessionDomain,
          GatewayClientPlatformUserId: client?.platformUserId,
          GatewayClientSessionEnterpriseId: client?.sessionEnterpriseId,
          GatewayClientSessionMembershipId: client?.sessionMembershipId,
          ...(Array.isArray(p.mentions) && p.mentions.length > 0
            ? { ComposerMentions: p.mentions }
            : {}),
        },
        stagedMediaContext,
      );

      const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
        cfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });
      const finalReplyParts: string[] = [];
      const dispatcher = createReplyDispatcher({
        ...prefixOptions,
        onError: (err) => {
          context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
        },
        deliver: async (payload, info) => {
          if (info.kind !== "final") {
            return;
          }
          const text = payload.text?.trim() ?? "";
          if (!text) {
            return;
          }
          finalReplyParts.push(text);
        },
      });

      let agentRunStarted = false;
      void dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          abortSignal: abortController.signal,
          ...(p.growthBirthTurn ? { growthBirthTurn: true } : {}),
          ...(p.humanTakeoverObserved ? { humanTakeoverObserved: true } : {}),
          ...(p.contextScope ? { contextScopeRequest: p.contextScope } : {}),
          images: parsedImages.length > 0 ? parsedImages : undefined,
          onAgentRunStart: (runId) => {
            agentRunStarted = true;
            const connId = typeof client?.connId === "string" ? client.connId : undefined;
            const wantsToolEvents = hasGatewayClientCap(
              client?.connect?.caps,
              GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
            );
            if (connId && wantsToolEvents) {
              context.registerToolEventRecipient(runId, connId);
              // Register for any other active runs *in the same session* so
              // late-joining clients (e.g. page refresh mid-response) receive
              // in-progress tool events without leaking cross-session data.
              for (const [activeRunId, active] of context.chatAbortControllers) {
                if (activeRunId !== runId && active.sessionKey === p.sessionKey) {
                  context.registerToolEventRecipient(activeRunId, connId);
                }
              }
            }
          },
          onModelSelected,
        },
      })
        .then(async () => {
          if (!agentRunStarted) {
            const combinedReply = finalReplyParts
              .map((part) => part.trim())
              .filter(Boolean)
              .join("\n\n")
              .trim();
            let message: Record<string, unknown> | undefined;
            let prepared: PreparedChatDeliverable | null = null;
            if (combinedReply) {
              const { storePath: latestStorePath, entry: latestEntry } =
                await loadSessionEntryForClient(sessionKey, client);
              const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
              const replyGovernance = await resolveChatTranscriptGovernance({ client, cfg });
              const turnSettled = settleTurnCompletion({
                userText: transcriptMessage,
                assistantText: combinedReply,
                nowMs: Date.now(),
                sessionKey: resolvedSessionKey,
              });
              const settledReply = turnSettled.visibleText.trim()
                ? turnSettled.visibleText
                : combinedReply;
              prepared = prepareChatDeliverablePublish({
                text: settledReply,
                publishIntent: "direct-fallback-final",
                sessionKey: resolvedSessionKey,
                tenantId: replyGovernance.tenantId,
                groupId: null,
                agentId,
                userId: replyGovernance.ownerUserId,
                clientRunId,
                taskId: null,
              });
              const fallbackArtifacts = declaredDeliverableArtifactFields(prepared.text, {
                timestamp: Date.now(),
              });
              const replyText = stripControlChannelForDisplay(prepared.text);
              const fallbackPublish = prepared.structured ? prepared.view : undefined;
              const appended = await appendAssistantTranscriptMessage({
                message: replyText,
                sessionId,
                storePath: latestStorePath,
                sessionFile: latestEntry?.sessionFile,
                agentId,
                createIfMissing: true,
                tenantId: replyGovernance.tenantId,
                ownerUserId: replyGovernance.ownerUserId,
                groupId: replyGovernance.groupId,
                failClosed: replyGovernance.failClosed,
                ...(fallbackPublish ? { deliverablePublish: fallbackPublish } : {}),
                ...(fallbackArtifacts.artifact ? { artifact: fallbackArtifacts.artifact } : {}),
                ...(fallbackArtifacts.artifacts ? { artifacts: fallbackArtifacts.artifacts } : {}),
              });
              if (appended.ok) {
                message = appended.message
                  ? {
                      ...appended.message,
                      ...(fallbackPublish ? { deliverablePublish: fallbackPublish } : {}),
                      ...(fallbackArtifacts.artifact
                        ? { artifact: fallbackArtifacts.artifact }
                        : {}),
                      ...(fallbackArtifacts.artifacts
                        ? { artifacts: fallbackArtifacts.artifacts }
                        : {}),
                    }
                  : undefined;
                emitChatInboundStage({
                  runId: clientRunId,
                  stage: "assistant_persisted",
                  sessionKey: resolvedSessionKey,
                  extra: { source: "chat_send_fallback" },
                });
                const { resolveContinuityWorkspaceDirForTurn } =
                  await import("./chat-continuity-workspace.js");
                const turnWorkspaceDir = await resolveContinuityWorkspaceDirForTurn({
                  cfg,
                  sessionKey,
                  agentId,
                  client,
                  resolvePrimaryWorkspaceDir: resolveCallerWorkspaceCwd,
                });
                const continuityTenantId =
                  client?.sessionEnterpriseId?.trim() ||
                  chatCheckpointStore.readTrustedTenantIdFromGatewayClient(client) ||
                  null;
                const spaceGroupId = extractGroupIdFromChatSessionKey(sessionKey);
                if (turnWorkspaceDir || spaceGroupId) {
                  const continuityWorkspaceDir =
                    turnWorkspaceDir ??
                    resolveSessionContinuityWorkspaceDir({
                      cfg,
                      sessionKey,
                      sessionEntry: latestEntry,
                      agentId,
                      agentWorkspaceDir: process.cwd(),
                      tenantId: continuityTenantId,
                    });
                  void commitSessionContinuityForCurrentSession({
                    cfg,
                    workspaceDir: continuityWorkspaceDir,
                    agentId,
                    sessionKey,
                    sessionEntry: latestEntry,
                    reason: "turn_completed",
                    tenantId: continuityTenantId,
                  }).catch(() => undefined);
                }
              } else {
                context.logGateway.warn(
                  `webchat transcript append failed: ${appended.error ?? "unknown error"}`,
                );
                const now = Date.now();
                message = {
                  role: "assistant",
                  content: [{ type: "text", text: replyText }],
                  timestamp: now,
                  ...(prepared.structured ? { deliverablePublish: prepared.view } : {}),
                  ...(fallbackArtifacts.artifact ? { artifact: fallbackArtifacts.artifact } : {}),
                  ...(fallbackArtifacts.artifacts
                    ? { artifacts: fallbackArtifacts.artifacts }
                    : {}),
                  // Keep this compatible with Pi stopReason enums even though this message isn't
                  // persisted to the transcript due to the append failure.
                  stopReason: "stop",
                  usage: { input: 0, output: 0, totalTokens: 0 },
                };
              }
            }
            const taskUpdate =
              resolveChatFinalTaskUpdate({
                cfg,
                sessionKey: resolvedSessionKey,
                runId: clientRunId,
                agentId,
              }) ?? undefined;
            broadcastChatFinal({
              context,
              runId: clientRunId,
              sessionKey: resolvedSessionKey,
              message,
              prepared,
              taskUpdate,
            });
          } else {
            // Agent run completed (tools may have edited workspace files): create
            // a rollback checkpoint + workspace snapshot from the current state.
            // The reply pipeline already persisted the final message + broadcast.
            const { entry: latestEntry } = await loadSessionEntryForClient(sessionKey, client);
            const { resolveContinuityWorkspaceDirForTurn } =
              await import("./chat-continuity-workspace.js");
            const turnWorkspaceDir = await resolveContinuityWorkspaceDirForTurn({
              cfg,
              sessionKey,
              agentId,
              client,
              resolvePrimaryWorkspaceDir: resolveCallerWorkspaceCwd,
            });
            const continuityTenantId =
              client?.sessionEnterpriseId?.trim() ||
              chatCheckpointStore.readTrustedTenantIdFromGatewayClient(client) ||
              null;
            const spaceGroupId = extractGroupIdFromChatSessionKey(sessionKey);
            if (turnWorkspaceDir || spaceGroupId) {
              const continuityWorkspaceDir =
                turnWorkspaceDir ??
                resolveSessionContinuityWorkspaceDir({
                  cfg,
                  sessionKey,
                  sessionEntry: latestEntry ?? entry,
                  agentId,
                  agentWorkspaceDir: process.cwd(),
                  tenantId: continuityTenantId,
                });
              void commitSessionContinuityForCurrentSession({
                cfg,
                workspaceDir: continuityWorkspaceDir,
                agentId,
                sessionKey,
                sessionEntry: latestEntry ?? entry,
                reason: "turn_completed",
                tenantId: continuityTenantId,
              }).catch(() => undefined);
            }
          }
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: `chat:${clientRunId}`,
            entry: {
              ts: Date.now(),
              ok: true,
              payload: { runId: clientRunId, status: "ok" as const },
            },
          });
        })
        .catch((err) => {
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: `chat:${clientRunId}`,
            entry: {
              ts: Date.now(),
              ok: false,
              payload: {
                runId: clientRunId,
                status: "error" as const,
                summary: String(err),
              },
              error,
            },
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey: resolvedSessionKey,
            errorMessage: String(err),
          });
        })
        .finally(() => {
          endChatRunAndMaybeFlushRestore({
            context,
            runId: clientRunId,
            client,
            isWebchatConnect,
          });
        });
    } catch (err) {
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: clientRunId,
        status: "error" as const,
        summary: String(err),
      };
      setGatewayDedupeEntry({
        dedupe: context.dedupe,
        key: `chat:${clientRunId}`,
        entry: {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        },
      });
      respond(false, payload, error, {
        runId: clientRunId,
        error: formatForLog(err),
      });
    }
  },
  "chat.guide.append": async ({ params, respond, context, client }) => {
    if (!validateChatGuideAppendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.guide.append params: ${formatValidationErrors(validateChatGuideAppendParams.errors)}`,
        ),
      );
      return;
    }
    const request = params as {
      sessionKey: string;
      slot: "welcome" | "team";
      state?: unknown;
    };
    const plan = planDaibaiGuideAppend({
      slot: request.slot,
      state: request.state,
      now: Date.now(),
    });
    if (!plan) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid daibai guide card"),
      );
      return;
    }
    await webchatIdentity.hydrateWebchatGatewayClientPlatformIdentity({ client });
    await webchatIdentity.ensureGatewayClientUserFromPlatformIdentity({ client });
    const rawSessionKey = request.sessionKey;
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, rawSessionKey);
    if (
      isCollaborationGroupChatSessionKey(rawSessionKey) ||
      isCollaborationGroupChatSessionKey(sessionKey) ||
      isSpaceAliasSessionKey(sessionKey) ||
      extractGroupIdFromChatSessionKey(sessionKey)
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "guide cards stay on the steward chat"),
      );
      return;
    }
    const parsed = parseAgentSessionKey(sessionKey);
    if (!parsed || !isBuiltinStewardAgent(parsed.agentId)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "guide cards stay on the steward chat"),
      );
      return;
    }
    if (denyEmployeeGlobalStewardTranscript({ client, sessionKey, respond })) {
      return;
    }
    const guideForeignDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (guideForeignDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, guideForeignDenial));
      return;
    }
    const guideGroupWriteDenial = await resolveCollaborationGroupWriteDenial({
      client,
      rawSessionKey,
      logGateway: context.logGateway,
    });
    if (guideGroupWriteDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, guideGroupWriteDenial));
      return;
    }
    await resolveAndBindChatTurnTenant(client, sessionKey);
    noteAuthorizedChatSessionInterest(client, sessionKey);
    const loaded = await loadSessionEntryForClient(sessionKey, client);
    const cfg = loaded.cfg;
    const storePath = loaded.storePath;
    const entry = loaded.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      const detail = formatClientSessionNotFoundDetail({ sessionKey, storePath });
      context.logGateway.warn(`chat.guide.append ${detail}`);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, detail));
      return;
    }
    const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
    const callerWorkspaceCwd = await resolveCallerWorkspaceCwd({
      cfg,
      sessionKey,
      agentId,
      client,
    });
    const governance = await resolveChatTranscriptGovernance({
      client,
      cfg,
      groupId: null,
    });
    const guideCard: Record<string, unknown> = {
      v: plan.card.v,
      slot: plan.card.slot,
      kind: plan.card.kind,
      updatedAt: plan.card.updatedAt,
    };
    if (plan.card.state) {
      guideCard.state = plan.card.state;
    }
    const appended = await appendAssistantTranscriptMessage({
      message: plan.text,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      agentId,
      createIfMissing: true,
      workspaceCwd: callerWorkspaceCwd,
      tenantId: governance.tenantId,
      ownerUserId: governance.ownerUserId,
      groupId: null,
      failClosed: governance.failClosed,
      idempotencyKey: plan.idempotencyKey,
      guideCard,
    });
    if (!appended.ok) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to write transcript: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }
    if (appended.messageId && appended.message) {
      const injectedForDisplay = stripEnvelopeFromMessage(appended.message) as Record<
        string,
        unknown
      >;
      const chatPayload = {
        runId: `guide-${appended.messageId}`,
        sessionKey,
        seq: 0,
        state: "final" as const,
        message: injectedForDisplay,
      };
      context.broadcastChat(sessionKey, chatPayload);
      context.nodeSendToSession(sessionKey, "chat", chatPayload);
    }
    respond(true, {
      ok: true,
      deduped: !appended.messageId,
      ...(appended.messageId ? { messageId: appended.messageId } : {}),
    });
  },
  "chat.inject": async ({ params, respond, context, client }) => {
    if (!validateChatInjectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      label?: string;
      peerDelivery?: boolean;
      peerOutbound?: boolean;
      sentTo?: Array<{ label: string; agentId?: string; sessionKey?: string }>;
      senderLabel?: string;
      sourceSessionKey?: string;
      cronJobId?: string;
      cronRunId?: string;
      cronJobName?: string;
      cronResultKind?: "result" | "parked_notice";
      sessionOwnerPlatformUserId?: string;
    };

    // Load session to find transcript file.
    // Key remapping stays on the socket client. The owner hint is only for the
    // tenant store, so a robot receipt is not rewritten into the steward key.
    const rawSessionKey = p.sessionKey;
    const injectClient = gatewayClientForSessionOwner(client, p.sessionOwnerPlatformUserId);
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, rawSessionKey);
    if (denyEmployeeGlobalStewardTranscript({ client, sessionKey, respond })) {
      return;
    }
    const injectForeignDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (injectForeignDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, injectForeignDenial));
      return;
    }
    const injectGroupWriteDenial = await resolveCollaborationGroupWriteDenial({
      client,
      rawSessionKey,
      logGateway: context.logGateway,
    });
    if (injectGroupWriteDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, injectGroupWriteDenial));
      return;
    }
    // Backend/device-token callers run under the wrong operator ALS. Owner-hinted
    // peer receipts must write into the sender's operator store (steward chat).
    const ownerScopeForUnboundInject =
      !client?.user?.trim() && !client?.platformUserId?.trim()
        ? p.sessionOwnerPlatformUserId?.trim() || undefined
        : undefined;
    const finishInject = async () => {
      const { cfg, storePath, entry } = await loadSessionEntryForClient(sessionKey, injectClient);
      const sessionId = entry?.sessionId;
      if (!sessionId || !storePath) {
        const detail = formatClientSessionNotFoundDetail({ sessionKey, storePath });
        context.logGateway.warn(`chat.inject ${detail}`);
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, detail));
        return;
      }

      const { resolveChatInjectTranscriptGovernance } =
        await import("./chat-transcript-governance.js");
      const injectGovernance = await resolveChatInjectTranscriptGovernance({
        client: injectClient,
        cfg,
        groupId: extractGroupIdFromChatSessionKey(rawSessionKey),
        cronJobId: p.cronJobId,
        cronStorePath: context.cronStorePath,
      });
      if (p.peerDelivery && p.peerOutbound) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "peerDelivery and peerOutbound are mutually exclusive",
          ),
        );
        return;
      }
      if (p.peerDelivery && (!p.senderLabel?.trim() || !p.sourceSessionKey?.trim())) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "peerDelivery requires senderLabel and sourceSessionKey",
          ),
        );
        return;
      }
      const outboundTargets = (p.sentTo ?? []).flatMap((target) => {
        const label = target.label.trim();
        if (!label) {
          return [];
        }
        return [
          {
            label,
            ...(target.agentId?.trim() ? { agentId: target.agentId.trim() } : {}),
            ...(target.sessionKey?.trim() ? { sessionKey: target.sessionKey.trim() } : {}),
          },
        ];
      });
      if (p.peerOutbound && outboundTargets.length === 0) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "peerOutbound requires sentTo labels"),
        );
        return;
      }
      const appended = await appendAssistantTranscriptMessage({
        message: p.message,
        label: p.peerDelivery ? undefined : p.label,
        sessionId,
        storePath,
        sessionFile: entry?.sessionFile,
        agentId: resolveSessionAgentId({ sessionKey, config: cfg }),
        createIfMissing: false,
        tenantId: injectGovernance.tenantId,
        ownerUserId: injectGovernance.ownerUserId,
        groupId: injectGovernance.groupId,
        failClosed: injectGovernance.failClosed,
        ...(p.peerDelivery
          ? {
              peerDelivery: {
                senderLabel: p.senderLabel?.trim() ?? "",
                sourceSessionKey: p.sourceSessionKey?.trim() ?? "",
                sourcePlatformUserId: p.sessionOwnerPlatformUserId,
              },
            }
          : {}),
        ...(p.peerOutbound ? { peerOutbound: { targets: outboundTargets } } : {}),
        ...(p.cronJobId
          ? {
              cronResult: {
                jobId: p.cronJobId,
                ...(p.cronRunId ? { runId: p.cronRunId } : {}),
                ...(p.cronJobName ? { jobName: p.cronJobName } : {}),
                ...(p.cronResultKind ? { kind: p.cronResultKind } : {}),
              },
            }
          : {}),
      });
      if (!appended.ok || !appended.messageId || !appended.message) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `failed to write transcript: ${appended.error ?? "unknown error"}`,
          ),
        );
        return;
      }

      // Broadcast to webchat for immediate UI update
      const injectedForDisplay = stripEnvelopeFromMessage(appended.message) as Record<
        string,
        unknown
      >;
      const chatPayload = {
        runId: `inject-${appended.messageId}`,
        sessionKey,
        seq: 0,
        state: "final" as const,
        message: isPeerOutboundSurfaceMessage(appended.message)
          ? injectedForDisplay
          : stripInlineDirectiveTagsFromMessageForDisplay(injectedForDisplay),
      };
      context.broadcastChat(sessionKey, chatPayload);
      context.nodeSendToSession(sessionKey, "chat", chatPayload);

      respond(true, { ok: true, messageId: appended.messageId });
    };
    if (ownerScopeForUnboundInject) {
      await withOperatorStateScope(ownerScopeForUnboundInject, () => finishInject());
    } else {
      await finishInject();
    }
  },
  "chat.restore": async ({ params, respond, context, client }) => {
    if (!validateChatRestoreParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.restore params: ${formatValidationErrors(validateChatRestoreParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      checkpointId?: string;
      queueWhenActive?: boolean;
    };
    const rawSessionKey = p.sessionKey;
    await webchatIdentity.hydrateWebchatGatewayClientPlatformIdentity({ client });
    await webchatIdentity.ensureGatewayClientUserFromPlatformIdentity({ client });
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, rawSessionKey);
    // Phase A: collab/space sessions may restore transcript-only (truncate to boundary).
    // File/workspace snapshot restore stays skipped for groups until Phase B.
    const collabSpaceSession =
      isCollaborationGroupChatSessionKey(rawSessionKey) ||
      isCollaborationGroupChatSessionKey(sessionKey);
    if (denyEmployeeGlobalStewardTranscript({ client, sessionKey, respond })) {
      return;
    }
    const restoreForeignDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (restoreForeignDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, restoreForeignDenial));
      return;
    }
    context.logGateway.info(
      `chat.restore received session=${sessionKey} checkpoint=${p.checkpointId ?? "latest"}`,
    );
    const restoreGroupWriteDenial = await resolveCollaborationGroupWriteDenial({
      client,
      rawSessionKey,
      logGateway: context.logGateway,
    });
    if (restoreGroupWriteDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, restoreGroupWriteDenial));
      return;
    }
    if (p.checkpointId && sessionRestoreLocks.has(sessionKey)) {
      // Fast busy answer for repeated clicks; the lock itself is re-checked
      // atomically in withSessionRestoreLock below.
      respondRestoreInProgress({ respond, context, sessionKey, checkpointId: p.checkpointId });
      return;
    }
    const restoreSession = isSpaceAliasSessionKey(sessionKey)
      ? await loadGroupSessionEntry(sessionKey, client)
      : await loadSessionEntryForClient(sessionKey, client);
    const cfg = restoreSession.cfg ?? (await loadSessionEntryForClient("main", client)).cfg;
    const storePath = restoreSession.storePath;
    const entry = restoreSession.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      const detail = formatClientSessionNotFoundDetail({ sessionKey, storePath });
      context.logGateway.warn(`chat.restore ${detail}`);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, detail));
      return;
    }
    const chatRestoreQueue = await loadChatRestoreQueueModule();
    if (chatRestoreQueue.hasActiveChatRunForSession(context.chatAbortControllers, sessionKey)) {
      if (p.queueWhenActive) {
        chatRestoreQueue.enqueuePendingChatRestore(sessionKey, {
          sessionKey,
          checkpointId: p.checkpointId,
          client,
          enqueuedAtMs: Date.now(),
        });
        respond(true, {
          ok: true,
          queued: true,
          reasonCode: "RUN_ACTIVE",
          message:
            "A reply is still running for this session. Restore was queued and will run when the current turn finishes.",
        });
        return;
      }
      context.logGateway.warn(
        `chat.restore denied (run active) session=${sessionKey} checkpoint=${p.checkpointId ?? "latest"}`,
      );
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "Cannot restore while a reply is still running for this session. Wait for the current turn to finish, or retry with queueWhenActive=true.",
          {
            reasonCode: "RUN_ACTIVE",
            retryable: true,
            retryAfterMs: 3000,
          },
        ),
      );
      return;
    }
    const restoreAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
    let fallbackAgentWorkspaceDir = await resolveCallerWorkspaceCwd({
      cfg,
      sessionKey,
      agentId: restoreAgentId,
      client,
    });
    if (!fallbackAgentWorkspaceDir) {
      // Authorized cwd can be denied for a host skill while the checkpoint
      // still lives in a tenant / locator workspace the divider already lists.
      const restoreWorkspaceCandidates =
        await chatCheckpointStore.resolveChatCheckpointWorkspaceDirsForClient({
          cfg,
          sessionKey,
          agentId: restoreAgentId,
          client,
        });
      fallbackAgentWorkspaceDir = restoreWorkspaceCandidates[0] ?? null;
    }
    if (!fallbackAgentWorkspaceDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "authorized workspace cwd required for restore"),
      );
      return;
    }
    const restoreContinuityTenantId =
      client?.sessionEnterpriseId?.trim() ||
      chatCheckpointStore.readTrustedTenantIdFromGatewayClient(client) ||
      null;
    let restoreWorkspaceDir = resolveSessionContinuityWorkspaceDir({
      cfg,
      sessionKey,
      sessionEntry: entry,
      agentId: restoreAgentId,
      agentWorkspaceDir: fallbackAgentWorkspaceDir,
      tenantId: restoreContinuityTenantId,
    });
    let restoreSessionKey = sessionKey;
    const restoreCheckpointScope = {
      cfg,
      workspaceDir: restoreWorkspaceDir,
      agentId: restoreAgentId,
      sessionKey: restoreSessionKey,
      sessionEntry: entry,
      tenantId: restoreContinuityTenantId,
    };
    // Target a specific checkpoint when provided (chat-checkpoint-rollback);
    // otherwise fall back to the latest checkpoint (backward compatible).
    // NOTE (P2): this remains a non-destructive context re-injection. The
    // destructive file rollback + transcript truncation land in P3.
    let checkpoint = p.checkpointId
      ? null
      : await loadLatestSessionContinuityCheckpoint(restoreCheckpointScope);
    if (p.checkpointId) {
      const located = await chatCheckpointStore.loadChatCheckpointForRestore({
        cfg,
        sessionKey,
        rawSessionKey,
        agentId: restoreAgentId,
        client,
        sessionEntry: entry,
        checkpointId: p.checkpointId,
        primaryWorkspaceDir: restoreWorkspaceDir,
      });
      if (located) {
        checkpoint = located.checkpoint;
        restoreWorkspaceDir = located.workspaceDir;
        restoreSessionKey = located.sessionKey;
        restoreCheckpointScope.workspaceDir = located.workspaceDir;
        restoreCheckpointScope.sessionKey = located.sessionKey;
        restoreCheckpointScope.agentId = resolveSessionAgentId({
          sessionKey: located.sessionKey,
          config: cfg,
        });
      }
    }
    if (p.checkpointId && !checkpoint) {
      context.logGateway.warn(
        `checkpoint.restore miss session=${sessionKey} raw=${rawSessionKey} agent=${restoreAgentId} cwd=${restoreWorkspaceDir} checkpoint=${p.checkpointId}`,
      );
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "checkpoint not found for this session"),
      );
      return;
    }
    if (!checkpoint) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "no checkpoint available for restore"),
      );
      return;
    }
    // Read-only: missing relationships stay pending review. Do not close a
    // ledger row because a workspace file exists, and do not merge those rows
    // into the session's current task.
    let taskReconciliation: RestoreTaskReconciliation = emptyRestoreTaskReconciliation();
    try {
      taskReconciliation = await loadRestoreTaskReconciliation({
        cfg,
        workspaceDir: restoreWorkspaceDir,
        agentId: restoreCheckpointScope.agentId,
        sessionKey: restoreSessionKey,
        sessionEntry: entry,
        checkpointOpenTasks: checkpoint.open_tasks,
      });
    } catch (err) {
      context.logGateway.warn(
        `chat.restore task reconciliation skipped session=${sessionKey}: ${String(err)}`,
      );
    }
    const taskIsolation = toRestoreTaskIsolationPayload(taskReconciliation);
    // Destructive targeted restore (chat-checkpoint-rollback P3): only when a
    // specific checkpointId is requested. The legacy no-arg path stays a
    // non-destructive context re-injection for backward compatibility.
    let restoredFiles: number | undefined;
    let removedFiles: number | undefined;
    let unchangedFiles: number | undefined;
    let truncatedFrom: number | undefined;
    const restoreStartedAtMs = Date.now();
    if (p.checkpointId) {
      const restoreDeadline = createChatRestoreDeadline();
      const restoreWork = withSessionRestoreLock(sessionKey, async () => {
        try {
          throwIfRestoreAborted(restoreDeadline.signal);
          // 1) Roll back workspace files to the checkpoint snapshot (within root).
          // Phase A collab/space: skip file restore (no group workspace snapshots).
          const fileResult = collabSpaceSession
            ? { restoredFiles: 0, removedFiles: 0, unchangedFiles: 0 }
            : await restoreWorkspaceSnapshotForCheckpoint({
                ...restoreCheckpointScope,
                checkpoint,
                signal: restoreDeadline.signal,
              });
          throwIfRestoreAborted(restoreDeadline.signal);
          // 2) Truncate the transcript the UI paints, not only the sessions-dir
          // fallback the model path resolver returns.
          let truncated: number | undefined;
          const modelPath = resolveTranscriptPath({
            sessionId,
            storePath,
            sessionFile: entry?.sessionFile,
            agentId: restoreCheckpointScope.agentId,
          });
          const restoreTarget = resolveCheckpointRestoreTranscriptTarget({
            sessionId,
            storePath,
            sessionFile: entry?.sessionFile,
            agentId: restoreCheckpointScope.agentId,
            boundaryMessageId: checkpoint.boundary_message_id,
          });
          const existingCandidates = restoreTarget.existingCandidates;
          const historyPaintedPath = restoreTarget.historyPaintedPath;
          const transcriptPath =
            modelPath && isGroupPublicTranscriptSessionFile(modelPath)
              ? modelPath
              : (restoreTarget.transcriptPath ?? modelPath);
          const [
            { readSessionMessages: readContinuitySessionMessages },
            { resolveEffectiveRestoreBoundaryMessageId },
          ] = await Promise.all([
            import("../../auto-reply/reply/session-continuity.js"),
            import("../../auto-reply/reply/chat-checkpoint-boundary.js"),
          ]);
          throwIfRestoreAborted(restoreDeadline.signal);
          const transcriptMessages =
            transcriptPath && fs.existsSync(transcriptPath)
              ? await readContinuitySessionMessages(transcriptPath, {
                  signal: restoreDeadline.signal,
                })
              : [];
          throwIfRestoreAborted(restoreDeadline.signal);
          const restoreBoundaryId = resolveEffectiveRestoreBoundaryMessageId(
            checkpoint.boundary_message_id,
            transcriptMessages,
          );
          // A targeted restore that cannot touch a transcript which still has
          // messages used to return ok with truncatedFrom unset. The UI then
          // reloaded the same thread and looked like a silent no-op. An empty
          // transcript has nothing to roll back, so file restore can still succeed.
          if (!transcriptPath) {
            throw new Error("session transcript was not found; conversation was not rolled back");
          }
          if (!restoreBoundaryId && transcriptMessages.length > 0) {
            throw new Error(
              "checkpoint boundary could not be resolved; conversation was not rolled back",
            );
          }
          if (transcriptPath && restoreBoundaryId) {
            const archivePath = path.join(
              path.dirname(transcriptPath),
              `${path.basename(transcriptPath)}.archive`,
              `${checkpoint.id}.jsonl`,
            );
            const trunc = await truncateTranscriptToBoundary({
              transcriptPath,
              boundaryMessageId: restoreBoundaryId,
              archivePath,
              signal: restoreDeadline.signal,
            });
            if (!trunc.boundaryFound) {
              throw new Error(
                `checkpoint boundary was not found in the session transcript (${restoreBoundaryId})`,
              );
            }
            const keptPath = await materializeRewoundTranscript({
              sourcePath: transcriptPath,
              modelPath,
              removedMessageIds: trunc.removedMessageIds ?? [],
              existingCandidates,
            });
            if (
              historyPaintedPath &&
              !sameTranscriptPath(keptPath, historyPaintedPath) &&
              !(modelPath && isGroupPublicTranscriptSessionFile(modelPath))
            ) {
              await fs.promises.mkdir(path.dirname(historyPaintedPath), { recursive: true });
              await fs.promises.copyFile(keptPath, historyPaintedPath);
            }
            if (trunc.truncated) {
              truncated = trunc.removedCount;
              // B6: commit deny watermark BEFORE chat.restore returns success so
              // revoked tail cannot be recalled while forgetSource is in-flight.
              const conversationMatch = sessionKey.match(/:conversation:(conv_[a-z0-9_]+)/i);
              const denyStoreDir = resolveRecallDenyStoreDir(resolveDataRoot(cfg));
              try {
                await commitTranscriptRangeRevoked({
                  storeDir: denyStoreDir,
                  sessionFile: keptPath,
                  sessionId,
                  conversationId: conversationMatch?.[1] ?? null,
                  boundaryTurnId: restoreBoundaryId,
                  deniedMessageIds: trunc.removedMessageIds ?? [],
                  revokedTailArchivePath: trunc.archivePath,
                  kind: "TRANSCRIPT_RANGE_REVOKED",
                  reason: "CHECKPOINT_RESTORE",
                });
              } catch (denyErr) {
                throw new Error(
                  `transcript truncated but deny watermark failed: ${String(denyErr)}`,
                  { cause: denyErr },
                );
              }
              // Kick outbox drain after deny is durable. Prefer CogniWeave
              // forgetSource; empty identity lists still mark SUCCEEDED
              // (message-id deny already blocks recall).
              const forgetAgentId = restoreCheckpointScope.agentId;
              void drainRevokeOutbox({
                storeDir: denyStoreDir,
                forgetSource: async (input) => {
                  try {
                    const { getMemorySearchManager } =
                      await import("../../memory/search-manager.js");
                    const { manager } = await getMemorySearchManager({
                      cfg,
                      agentId: forgetAgentId,
                    });
                    if (!manager?.applyTranscriptSourceLifecycle) {
                      return { ok: true, skipped: true };
                    }
                    return await manager.applyTranscriptSourceLifecycle({
                      mode: "forget",
                      sourceIdentityId: input.sourceIdentityId,
                      sourceLocator: input.sourceLocator,
                      operationId: input.operationId,
                      reasonCode: input.reasonCode,
                    });
                  } catch (err) {
                    return {
                      ok: false,
                      error: err instanceof Error ? err.message : String(err),
                    };
                  }
                },
              }).catch((err) => {
                context.logGateway.warn(`revoke outbox drain after restore failed: ${String(err)}`);
              });
            }
            const sharedTranscriptPath = isGroupPublicTranscriptSessionFile(keptPath)
              ? keptPath
              : isGroupPublicTranscriptSessionFile(transcriptPath)
                ? transcriptPath
                : null;
            if (sharedTranscriptPath) {
              const groupId =
                entry?.groupId?.trim() ||
                entry?.space?.trim() ||
                extractGroupIdFromChatSessionKey(sessionKey) ||
                extractGroupIdFromChatSessionKey(rawSessionKey);
              if (groupId && storePath) {
                await dropDivergentGroupTranscriptMirrors({
                  groupId,
                  sessionId,
                  storePath,
                  sharedTranscriptPath,
                });
              }
            }
          }
          return { fileResult, truncated };
        } finally {
          restoreDeadline.clear();
        }
      });
      try {
        const outcome = await raceChatRestoreWork(restoreWork, restoreDeadline.signal);
        restoredFiles = outcome.fileResult.restoredFiles;
        removedFiles = outcome.fileResult.removedFiles;
        unchangedFiles = outcome.fileResult.unchangedFiles;
        truncatedFrom = outcome.truncated;
      } catch (err) {
        if (err instanceof ChatRestoreBusyError || err instanceof WorkspaceRestoreBusyError) {
          respondRestoreInProgress({ respond, context, sessionKey, checkpointId: checkpoint.id });
          return;
        }
        if (isChatRestoreTimeout(err, restoreDeadline.signal)) {
          context.logGateway.warn(
            `checkpoint.restore timed out session=${sessionKey} checkpoint=${checkpoint.id}`,
          );
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              "checkpoint restore timed out before the conversation was rolled back",
              {
                reasonCode: "RESTORE_TIMEOUT",
                retryable: true,
                details: { reasonCode: "RESTORE_TIMEOUT" },
              },
            ),
          );
          return;
        }
        context.logGateway.warn(
          `checkpoint.restore failed session=${sessionKey} checkpoint=${checkpoint.id}: ${String(err)}`,
        );
        const restoreError = err instanceof WorkspaceRestoreError ? err : null;
        const message = restoreError ? restoreError.message : String(err);
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, `failed to restore checkpoint: ${message}`, {
            reasonCode: "RESTORE_FAILED",
            retryable: restoreError ? restoreError.rolledBack : undefined,
            details: {
              reasonCode: "RESTORE_FAILED",
              ...(restoreError
                ? {
                    phase: restoreError.phase,
                    relativePath: restoreError.relativePath,
                    errno: restoreError.errno,
                    rolledBack: restoreError.rolledBack,
                  }
                : {}),
            },
          }),
        );
        return;
      } finally {
        restoreDeadline.clear();
      }
    }
    // Targeted restore (chat-checkpoint-rollback): the rollback itself — workspace
    // files reverted + transcript truncated to the checkpoint boundary — is the
    // user-visible confirmation. We intentionally do NOT inject a verbose
    // "Checkpoint restored" assistant message (it leaked internal artifacts, read
    // as a bot reply, and stacked on repeated restores). The client reloads the
    // truncated conversation after this returns.
    if (p.checkpointId) {
      context.logGateway.info(
        `checkpoint.restore ok session=${sessionKey} checkpoint=${checkpoint.id} files=${restoredFiles ?? 0} removed=${removedFiles ?? 0} unchanged=${unchangedFiles ?? 0} truncated=${truncatedFrom ?? 0} ms=${Date.now() - restoreStartedAtMs}`,
      );
      respond(true, {
        ok: true,
        checkpointId: checkpoint.id,
        taskIsolation,
        ...(restoredFiles !== undefined ? { restoredFiles } : {}),
        ...(removedFiles !== undefined ? { removedFiles } : {}),
        ...(unchangedFiles !== undefined ? { unchangedFiles } : {}),
        ...(truncatedFrom !== undefined ? { truncatedFrom } : {}),
      });
      return;
    }
    // Legacy no-arg restore: non-destructive context re-injection (backward
    // compatible). The transcript may still contain checkpoint open_tasks, but
    // they are fenced and stamped so they do not join the current task main line.
    const restoreMessage = isolateLegacyRestoreTranscriptText(
      formatSessionContinuityCheckpointRestoreText(checkpoint),
    );
    const restoreIsolation = restoreTaskIsolationStamp(checkpoint.open_tasks);
    const restoreGovernance = await resolveChatTranscriptGovernance({
      client,
      cfg,
      groupId: extractGroupIdFromChatSessionKey(rawSessionKey),
    });
    const appended = await appendAssistantTranscriptMessage({
      message: restoreMessage,
      label: "Checkpoint",
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      agentId: restoreCheckpointScope.agentId,
      createIfMissing: false,
      tenantId: restoreGovernance.tenantId,
      ownerUserId: restoreGovernance.ownerUserId,
      groupId: restoreGovernance.groupId,
      failClosed: restoreGovernance.failClosed,
      restoreTaskIsolation: restoreIsolation,
    });
    if (!appended.ok || !appended.messageId || !appended.message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to restore checkpoint: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }
    const chatPayload = {
      runId: `inject-${appended.messageId}`,
      sessionKey,
      seq: 0,
      state: "final" as const,
      message: stripInlineDirectiveTagsFromMessageForDisplay(
        stripEnvelopeFromMessage(appended.message) as Record<string, unknown>,
      ),
    };
    context.broadcastChat(sessionKey, chatPayload);
    context.nodeSendToSession(sessionKey, "chat", chatPayload);
    context.logGateway.info(
      `chat.restore (legacy) ok session=${sessionKey} checkpoint=${checkpoint.id}`,
    );
    respond(true, {
      ok: true,
      messageId: appended.messageId,
      checkpointId: checkpoint.id,
      summary: checkpoint.summary,
      taskIsolation,
    });
  },
};

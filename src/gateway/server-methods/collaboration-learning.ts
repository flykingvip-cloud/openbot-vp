import type { CapsuleReusability } from "@openbot/collaboration-core";
import { isCollabRuntimeNamespaceEnabled } from "../collaboration-dispatch/runtime-namespace.js";
import {
  acceptCollaborationTaskHandoffContract,
  applyCollaborationTaskHandoffContract,
  approveCollaborationTaskHandoffContract,
  handoffCollaborationTask,
  loadGatewayCollaborationLearningSnapshot,
  proposeCollaborationTaskHandoffContract,
  publishCollaborationBoardItem,
  claimCollaborationBoardItem,
  applyCollaborationBoardClaim,
  listCollaborationBoardItems,
  getCollaborationBoardMemberProgress,
  markCollaborationBoardItemInProgress,
  submitCollaborationBoardItemForReview,
  acceptCollaborationBoardItemSubmission,
  returnCollaborationBoardItemSubmission,
  recordCollaborationBoardItemPeerReview,
  listCollaborationPeerReviews,
  openCollaborationChallengeWindow,
  recordCollaborationChallengeCritique,
  resolveCollaborationChallengeWindow,
  skipCollaborationChallengeWindow,
  listCollaborationChallengeWindows,
  blockCollaborationBoardItem,
  unblockCollaborationBoardItem,
  cancelCollaborationBoardItem,
  listCollaborationWakeEvents,
  getCollaborationWhoWokeWhom,
  runCollaborationGroupTaskHeartbeat,
  runCollaborationSelfAdvance,
  getCollaborationAdminDailySummary,
  proposeCollaborationTodolist,
  retryCollaborationOwnerDecisionDelivery,
  listCollaborationOwnerDecisionDeliveries,
  ClaimContractEntryError,
  confirmCollaborationTodolist,
  reviseCollaborationTodolist,
  getCollaborationTodolist,
  listCollaborationTodolists,
  buildCollaborationExecutionTaskBag,
  signalCollaborationInsight,
  resolveCollaborationTransitionError,
  transitionCollaborationDecision,
  transitionCollaborationDeliverable,
  transitionCollaborationReview,
  transitionCollaborationTask,
  requestCollaborationTaskStop,
  releaseWakeOpForRetryViaGatewaySession,
  confirmWakeOpCompletedViaGatewaySession,
  WakeOpGatewayRecoveryEntryError,
  updateCollaborationDecisionDraft,
} from "../collaboration-learning.js";
import {
  approveCandidateCapsule,
  listCandidateCapsules,
  rejectCandidateCapsule,
  transitionGroupMemoryCapsule,
} from "../collaboration-learning/capsule-governance.js";
import { promoteApprovedCapsuleIfEligible } from "../collaboration-learning/capsule-promotion.js";
import { resolveDeliveryAclActor } from "../collaboration-learning/delivery-actor-binding.js";
import { resolveCollaborationTenantResolution } from "../collaboration-learning/trusted-tenant.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import { COLLABORATION_LEDGER_KINDS } from "../collaboration-ledger/types.js";
import {
  ErrorCodes,
  errorShape,
  validateCollaborationDecisionDraftUpdateParams,
  validateCollaborationDecisionTransitionParams,
  validateCollaborationDeliverableTransitionParams,
  validateCollaborationLearningSnapshotParams,
  validateCollaborationReviewTransitionParams,
  validateCollaborationTaskHandoffParams,
  validateCollaborationTaskProposeHandoffParams,
  validateCollaborationTaskAcceptHandoffParams,
  validateCollaborationTaskApproveHandoffParams,
  validateCollaborationTaskApplyHandoffParams,
  validateCollaborationTaskPublishBoardItemParams,
  validateCollaborationTaskClaimBoardItemParams,
  validateCollaborationTaskApplyClaimParams,
  validateCollaborationTaskListBoardItemsParams,
  validateCollaborationTaskGetMemberProgressParams,
  validateCollaborationTaskMarkInProgressParams,
  validateCollaborationTaskSubmitForReviewParams,
  validateCollaborationTaskAcceptSubmissionParams,
  validateCollaborationTaskReturnSubmissionParams,
  validateCollaborationTaskRecordPeerReviewParams,
  validateCollaborationTaskListPeerReviewsParams,
  validateCollaborationTaskOpenChallengeWindowParams,
  validateCollaborationTaskRecordChallengeCritiqueParams,
  validateCollaborationTaskResolveChallengeWindowParams,
  validateCollaborationTaskSkipChallengeWindowParams,
  validateCollaborationTaskListChallengeWindowsParams,
  validateCollaborationTaskBlockBoardItemParams,
  validateCollaborationTaskUnblockBoardItemParams,
  validateCollaborationTaskCancelBoardItemParams,
  validateCollaborationTaskStopParams,
  validateCollaborationTaskWakeOpReleaseForRetryParams,
  validateCollaborationTaskWakeOpConfirmCompletedParams,
  validateCollaborationTaskListWakeEventsParams,
  validateCollaborationTaskWhoWokeWhomParams,
  validateCollaborationTaskRunGroupTaskHeartbeatParams,
  validateCollaborationTaskAdminDailySummaryParams,
  validateCollaborationTaskTrySelfAdvanceParams,
  validateCollaborationTaskProposeTodolistParams,
  validateCollaborationTaskRetryOwnerDecisionDeliveryParams,
  validateCollaborationTaskListOwnerDecisionDeliveriesParams,
  validateCollaborationTaskConfirmTodolistParams,
  validateCollaborationTaskReviseTodolistParams,
  validateCollaborationTaskGetTodolistParams,
  validateCollaborationTaskListTodolistsParams,
  validateCollaborationTaskBuildExecutionTaskBagParams,
  validateCollaborationTaskSignalInsightParams,
  validateCollaborationTaskTransitionParams,
} from "../protocol/index.js";
import { exactMember } from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

/**
 * P0.0a: the tenant runtime namespace needs the server-resolved tenant. Only resolved
 * when `collaboration.runtimeNamespace` is on so the flag-off path stays identical.
 */
async function resolveLedgerReadTenantId(client: GatewayClient | null): Promise<string | null> {
  if (!isCollabRuntimeNamespaceEnabled()) {
    return null;
  }
  return (await resolveCollaborationTenantResolution(client)).tenantId;
}

const TODOLIST_VERSION_REASON_CODES = new Set([
  "stale_version",
  "version_mismatch",
  "card_invalid",
  "expected_version_required",
  "confirmation_consumed",
]);

/** Confirm/revise refusals carry a stable reason code. Step text is not added here. */
function collaborationEntryErrorShape(error: unknown) {
  const message = resolveCollaborationTransitionError(error) ?? String(error);
  const reasonCode = error instanceof ClaimContractEntryError ? error.code : undefined;
  if (reasonCode && TODOLIST_VERSION_REASON_CODES.has(reasonCode)) {
    return errorShape(ErrorCodes.INVALID_REQUEST, message, {
      reasonCode,
      details: { reason: reasonCode },
    });
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, message);
}

export const collaborationLearningHandlers: GatewayRequestHandlers = {
  "collaboration.learning.snapshot": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationLearningSnapshotParams,
        "collaboration.learning.snapshot",
        respond,
      )
    ) {
      return;
    }
    const payload = await loadGatewayCollaborationLearningSnapshot(params);
    respond(true, payload, undefined);
  },
  "collaboration.task.transition": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskTransitionParams,
        "collaboration.task.transition",
        respond,
      )
    ) {
      return;
    }
    try {
      const task = await transitionCollaborationTask({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
      });
      respond(true, { task }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.handoff": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskHandoffParams,
        "collaboration.task.handoff",
        respond,
      )
    ) {
      return;
    }
    try {
      const task = await handoffCollaborationTask({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
      });
      respond(true, { task }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },

  "collaboration.task.proposeHandoff": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskProposeHandoffParams,
        "collaboration.task.proposeHandoff",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const contract = await proposeCollaborationTaskHandoffContract({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { contract }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.acceptHandoff": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskAcceptHandoffParams,
        "collaboration.task.acceptHandoff",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const contract = await acceptCollaborationTaskHandoffContract({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { contract }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.approveHandoff": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskApproveHandoffParams,
        "collaboration.task.approveHandoff",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const contract = await approveCollaborationTaskHandoffContract({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        actorType: params.actorType,
        tenant,
      });
      respond(true, { contract }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.applyHandoff": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskApplyHandoffParams,
        "collaboration.task.applyHandoff",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const task = await applyCollaborationTaskHandoffContract({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { task }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.publishBoardItem": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskPublishBoardItemParams,
        "collaboration.task.publishBoardItem",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await publishCollaborationBoardItem({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.claimBoardItem": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskClaimBoardItemParams,
        "collaboration.task.claimBoardItem",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await claimCollaborationBoardItem({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.applyClaim": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskApplyClaimParams,
        "collaboration.task.applyClaim",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await applyCollaborationBoardClaim({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.listBoardItems": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskListBoardItemsParams,
        "collaboration.task.listBoardItems",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const items = await listCollaborationBoardItems({ ...params, tenant });
      respond(true, { items }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.getMemberProgress": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskGetMemberProgressParams,
        "collaboration.task.getMemberProgress",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const progress = await getCollaborationBoardMemberProgress({ ...params, tenant });
      respond(true, { progress }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.listWakeEvents": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskListWakeEventsParams,
        "collaboration.task.listWakeEvents",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const events = await listCollaborationWakeEvents({ ...params, tenant });
      respond(true, { events }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.whoWokeWhom": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskWhoWokeWhomParams,
        "collaboration.task.whoWokeWhom",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await getCollaborationWhoWokeWhom({ ...params, tenant });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },

  "collaboration.task.runGroupTaskHeartbeat": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskRunGroupTaskHeartbeatParams,
        "collaboration.task.runGroupTaskHeartbeat",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await runCollaborationGroupTaskHeartbeat({ ...params, tenant });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `${result.reason}: ${result.message}`),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.adminDailySummary": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskAdminDailySummaryParams,
        "collaboration.task.adminDailySummary",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await getCollaborationAdminDailySummary({ ...params, tenant });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },

  "collaboration.task.trySelfAdvance": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskTrySelfAdvanceParams,
        "collaboration.task.trySelfAdvance",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await runCollaborationSelfAdvance({ ...params, tenant });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `${result.reason}: ${result.message}`),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.proposeTodolist": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskProposeTodolistParams,
        "collaboration.task.proposeTodolist",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const proposed = await proposeCollaborationTodolist({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(
        true,
        { todolist: proposed.todolist, cardDelivery: proposed.cardDelivery },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.retryOwnerDecisionDelivery": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskRetryOwnerDecisionDeliveryParams,
        "collaboration.task.retryOwnerDecisionDelivery",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const retried = await retryCollaborationOwnerDecisionDelivery({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        expectedVersion: params.expectedVersion,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { todolist: retried.todolist, cardDelivery: retried.cardDelivery }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.listOwnerDecisionDeliveries": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskListOwnerDecisionDeliveriesParams,
        "collaboration.task.listOwnerDecisionDeliveries",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const deliveries = await listCollaborationOwnerDecisionDeliveries({
        groupId: params.groupId,
        taskId: params.taskId,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { deliveries }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.confirmTodolist": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskConfirmTodolistParams,
        "collaboration.task.confirmTodolist",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const todolist = await confirmCollaborationTodolist({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        expectedVersion: params.expectedVersion,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { todolist }, undefined);
    } catch (error) {
      respond(false, undefined, collaborationEntryErrorShape(error));
    }
  },
  "collaboration.task.reviseTodolist": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskReviseTodolistParams,
        "collaboration.task.reviseTodolist",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const todolist = await reviseCollaborationTodolist({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        reason: params.reason,
        steps: params.steps,
        expectedVersion: params.expectedVersion,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { todolist }, undefined);
    } catch (error) {
      respond(false, undefined, collaborationEntryErrorShape(error));
    }
  },
  "collaboration.task.getTodolist": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskGetTodolistParams,
        "collaboration.task.getTodolist",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const actor = await resolveDeliveryAclActor(client, params.groupId);
      const todolist = await getCollaborationTodolist({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        actor,
        tenant,
      });
      const deliveries = await listCollaborationOwnerDecisionDeliveries({
        groupId: params.groupId,
        taskId: params.taskId,
        actor,
        tenant,
      });
      const cardDelivery =
        deliveries.find(
          (row) => row.todolistId === todolist.todolistId && row.version === todolist.version,
        ) ??
        deliveries.find((row) => row.todolistId === todolist.todolistId) ??
        null;
      respond(true, { todolist, cardDelivery }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.listTodolists": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskListTodolistsParams,
        "collaboration.task.listTodolists",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const todolists = await listCollaborationTodolists({
        groupId: params.groupId,
        taskId: params.taskId,
        boardItemId: params.boardItemId,
        ownerMemberId: params.ownerMemberId,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { todolists }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.buildExecutionTaskBag": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskBuildExecutionTaskBagParams,
        "collaboration.task.buildExecutionTaskBag",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const taskBag = await buildCollaborationExecutionTaskBag({
        groupId: params.groupId,
        taskId: params.taskId,
        boardItemId: params.boardItemId,
        ownerMemberId: params.ownerMemberId,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { taskBag }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.signalInsight": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskSignalInsightParams,
        "collaboration.task.signalInsight",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await signalCollaborationInsight({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },

  "collaboration.task.markInProgress": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskMarkInProgressParams,
        "collaboration.task.markInProgress",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await markCollaborationBoardItemInProgress({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.submitForReview": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskSubmitForReviewParams,
        "collaboration.task.submitForReview",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await submitCollaborationBoardItemForReview({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.acceptSubmission": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskAcceptSubmissionParams,
        "collaboration.task.acceptSubmission",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await acceptCollaborationBoardItemSubmission({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.returnSubmission": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskReturnSubmissionParams,
        "collaboration.task.returnSubmission",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await returnCollaborationBoardItemSubmission({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.blockBoardItem": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskBlockBoardItemParams,
        "collaboration.task.blockBoardItem",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await blockCollaborationBoardItem({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.unblockBoardItem": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskUnblockBoardItemParams,
        "collaboration.task.unblockBoardItem",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await unblockCollaborationBoardItem({
        groupId: params.groupId,
        taskId: params.taskId,
        itemId: params.itemId,
        reason: params.reason,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },

  "collaboration.task.cancelBoardItem": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskCancelBoardItemParams,
        "collaboration.task.cancelBoardItem",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const item = await cancelCollaborationBoardItem({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { item }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.stop": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskStopParams,
        "collaboration.task.stop",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await requestCollaborationTaskStop({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(
        true,
        {
          task: result.task,
          stopControl: result.stopControl,
          alreadyStopped: result.alreadyStopped,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.wakeOp.releaseForRetry": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskWakeOpReleaseForRetryParams,
        "collaboration.task.wakeOp.releaseForRetry",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await releaseWakeOpForRetryViaGatewaySession({
        client,
        groupId: params.groupId,
        taskId: params.taskId,
        opKey: params.opKey,
        verificationId: params.verificationId,
        detail: typeof params.detail === "string" ? params.detail : undefined,
        tenant,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      const reasonCode = error instanceof WakeOpGatewayRecoveryEntryError ? error.code : undefined;
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
          reasonCode ? { reasonCode } : undefined,
        ),
      );
    }
  },
  "collaboration.task.wakeOp.confirmCompleted": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskWakeOpConfirmCompletedParams,
        "collaboration.task.wakeOp.confirmCompleted",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const result = await confirmWakeOpCompletedViaGatewaySession({
        client,
        groupId: params.groupId,
        taskId: params.taskId,
        opKey: params.opKey,
        roundId: params.roundId,
        detail: typeof params.detail === "string" ? params.detail : undefined,
        tenant,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      const reasonCode = error instanceof WakeOpGatewayRecoveryEntryError ? error.code : undefined;
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
          reasonCode ? { reasonCode } : undefined,
        ),
      );
    }
  },

  "collaboration.task.recordPeerReview": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskRecordPeerReviewParams,
        "collaboration.task.recordPeerReview",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const review = await recordCollaborationBoardItemPeerReview({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { review }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.listPeerReviews": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskListPeerReviewsParams,
        "collaboration.task.listPeerReviews",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const reviews = await listCollaborationPeerReviews({ ...params, tenant });
      respond(true, { reviews }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },

  "collaboration.task.openChallengeWindow": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskOpenChallengeWindowParams,
        "collaboration.task.openChallengeWindow",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const window = await openCollaborationChallengeWindow({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { window }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.recordChallengeCritique": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskRecordChallengeCritiqueParams,
        "collaboration.task.recordChallengeCritique",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const window = await recordCollaborationChallengeCritique({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { window }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.resolveChallengeWindow": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskResolveChallengeWindowParams,
        "collaboration.task.resolveChallengeWindow",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const revisedDraft =
        params.revisedRemainingWork || params.revisedAcceptanceCriteria || params.revisedGoal
          ? {
              goal: params.revisedGoal ?? params.revisedRemainingWork ?? "",
              remainingWork: params.revisedRemainingWork ?? params.revisedGoal ?? "",
              acceptanceCriteria: params.revisedAcceptanceCriteria ?? [],
              constraints: params.revisedConstraints,
              suggestedRole: params.revisedSuggestedRole,
              title: params.revisedTitle,
            }
          : undefined;
      const window = await resolveCollaborationChallengeWindow({
        groupId: params.groupId,
        taskId: params.taskId,
        windowId: params.windowId,
        decision: params.decision,
        reason: params.reason,
        revisedDraft:
          revisedDraft && revisedDraft.acceptanceCriteria.length > 0 ? revisedDraft : undefined,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { window }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.skipChallengeWindow": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskSkipChallengeWindowParams,
        "collaboration.task.skipChallengeWindow",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const window = await skipCollaborationChallengeWindow({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        tenant,
      });
      respond(true, { window }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.task.listChallengeWindows": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskListChallengeWindowsParams,
        "collaboration.task.listChallengeWindows",
        respond,
      )
    ) {
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const windows = await listCollaborationChallengeWindows({ ...params, tenant });
      respond(true, { windows }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.deliverable.transition": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationDeliverableTransitionParams,
        "collaboration.deliverable.transition",
        respond,
      )
    ) {
      return;
    }
    try {
      const deliverable = await transitionCollaborationDeliverable({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
      });
      respond(true, { deliverable }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.review.transition": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationReviewTransitionParams,
        "collaboration.review.transition",
        respond,
      )
    ) {
      return;
    }
    try {
      const review = await transitionCollaborationReview({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
      });
      respond(true, { review }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.decision.transition": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationDecisionTransitionParams,
        "collaboration.decision.transition",
        respond,
      )
    ) {
      return;
    }
    try {
      const decision = await transitionCollaborationDecision({
        ...params,
        actor: await resolveDeliveryAclActor(client, params.groupId),
      });
      respond(true, { decision }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.decision.updateDraft": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationDecisionDraftUpdateParams,
        "collaboration.decision.updateDraft",
        respond,
      )
    ) {
      return;
    }
    try {
      const decision = await updateCollaborationDecisionDraft(params);
      respond(true, { decision }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolveCollaborationTransitionError(error) ?? String(error),
        ),
      );
    }
  },
  "collaboration.ledger.list": async ({ params, respond, client }) => {
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId is required"));
      return;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const fromMs = typeof params.fromMs === "number" ? params.fromMs : undefined;
    const kinds = Array.isArray(params.kinds)
      ? params.kinds.flatMap((entry) => {
          const kind = exactMember(entry, COLLABORATION_LEDGER_KINDS);
          return kind ? [kind] : [];
        })
      : undefined;
    const tenantId = await resolveLedgerReadTenantId(client);
    const payload = await readCollaborationLedgerArchive({
      groupId,
      limit,
      fromMs,
      kinds,
      ...(tenantId ? { tenantId } : {}),
    });
    respond(true, payload, undefined);
  },
  "collaboration.capsule.transition": async ({ params, respond, client }) => {
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
    if (!groupId || !capsuleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId and capsuleId are required"),
      );
      return;
    }
    const toStatus = params.toStatus;
    if (toStatus !== "approved" && toStatus !== "revoked") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "toStatus must be 'approved' or 'revoked'"),
      );
      return;
    }
    const reusabilityRaw = params.reusability;
    const reusability: CapsuleReusability | undefined =
      reusabilityRaw === "group_only" ||
      reusabilityRaw === "promotable" ||
      reusabilityRaw === "reusable" ||
      reusabilityRaw === "exportable"
        ? reusabilityRaw
        : undefined;
    if (reusabilityRaw !== undefined && reusability === undefined) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid reusability"));
      return;
    }
    try {
      const capsule = await transitionGroupMemoryCapsule({
        groupId,
        capsuleId,
        toStatus,
        actor: await resolveDeliveryAclActor(client, params.groupId),
        ...(reusability ? { reusability } : {}),
      });
      const promotion =
        toStatus === "approved"
          ? await promoteApprovedCapsuleIfEligible({
              groupId,
              capsule,
              actor: await resolveDeliveryAclActor(client, params.groupId),
              approvalMode: "approved",
            })
          : undefined;
      respond(true, { capsule, promotion }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "collaboration.promotion.audit.list": async ({ params, respond, client }) => {
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId is required"));
      return;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const fromMs = typeof params.fromMs === "number" ? params.fromMs : undefined;
    const tenantId = await resolveLedgerReadTenantId(client);
    const payload = await readCollaborationLedgerArchive({
      groupId,
      limit,
      fromMs,
      kinds: ["promotion"],
      ...(tenantId ? { tenantId } : {}),
    });
    respond(true, payload, undefined);
  },

  "collaboration.learning.capsule-candidates.list": async ({ params, respond }) => {
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId is required"));
      return;
    }
    try {
      const candidates = await listCandidateCapsules({ groupId });
      respond(true, { candidates }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "collaboration.learning.capsule.approve": async ({ params, respond, client }) => {
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
    const actorId = await resolveDeliveryAclActor(client, groupId);
    if (!groupId || !capsuleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId and capsuleId are required"),
      );
      return;
    }
    if (!actorId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "identified actor is required"),
      );
      return;
    }
    const result = await approveCandidateCapsule({ groupId, capsuleId, actorId });
    if (!result.approved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    respond(true, result, undefined);
  },
  "collaboration.learning.capsule.reject": async ({ params, respond, client }) => {
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
    const actorId = await resolveDeliveryAclActor(client, groupId);
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    if (!groupId || !capsuleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId and capsuleId are required"),
      );
      return;
    }
    if (!actorId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "identified actor is required"),
      );
      return;
    }
    const result = await rejectCandidateCapsule({
      groupId,
      capsuleId,
      actorId,
      ...(reason ? { reason } : {}),
    });
    if (!result.rejected) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
      return;
    }
    respond(true, result, undefined);
  },
};

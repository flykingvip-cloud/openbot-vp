import type { CapsuleReusability } from "@openbot/collaboration-core";
import {
  acceptedArtifactDeliveryDirs,
  issuanceFactsFromBoard,
  requestAcceptedArtifactDelivery,
  revokeAcceptedArtifactDelivery,
} from "../../agent-runtime/command/accepted-artifact-delivery.js";
import { readAcceptedArtifactDelivery } from "../../agent-runtime/state/collaboration/accepted-artifact-delivery-read.js";
import { createOutboundSendDeps, type CliDeps } from "../../cli/deps.js";
import { loadConfig } from "../../config/config.js";
import type { OutboundSendDeps } from "../../infra/outbound/deliver.js";
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
import {
  authenticatedSessionSubjects,
  resolveDeliveryAclActor,
} from "../collaboration-learning/delivery-actor-binding.js";
import {
  finalizeLearningCuratedSkillDraft,
  listLearningCuratedSkillDrafts,
} from "../collaboration-learning/learning-skill-draft-entry.js";
import { triggerPostPlanConfirmAdvance } from "../collaboration-learning/post-plan-confirm-advance.js";
import { promotePrivateMemoryCapsuleAuthorized } from "../collaboration-learning/private-memory-promote-entry.js";
import { readTeamDeliverable } from "../collaboration-learning/team-deliverable-submit.js";
import { resolveHandlerTrustedTeamContext } from "../collaboration-learning/team-resource-auth.js";
import { resolveCollaborationTenantResolution } from "../collaboration-learning/trusted-tenant.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import { COLLABORATION_LEDGER_KINDS } from "../collaboration-ledger/types.js";
import { resolvePersonalAssetOwnerIdentities } from "../personal-skill-asset-scope.js";
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
  validateCollaborationTaskRequestAcceptedArtifactDeliveryParams,
  validateCollaborationTaskRevokeAcceptedArtifactDeliveryParams,
  validateCollaborationTaskReadAcceptedArtifactDeliveryParams,
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

async function resolveTrustedWriteContext(client: GatewayClient | null, groupId: string) {
  const tenant = await resolveCollaborationTenantResolution(client);
  const actor = await resolveDeliveryAclActor(client, groupId);
  if (!actor) {
    return { ok: false as const, error: "actor_not_authenticated", tenant, actor: null };
  }
  const trusted = await resolveHandlerTrustedTeamContext({
    groupId,
    actor,
    client,
    tenant,
    action: "write",
  });
  if (!trusted.ok) {
    return { ok: false as const, error: trusted.reason, detail: trusted.detail, tenant, actor };
  }
  return {
    ok: true as const,
    tenant,
    actor,
    auth: trusted.auth,
    stores: trusted.stores,
    trusted: trusted.trusted,
  };
}

/** Read path: same tenant/actor/locator checks as write, but action:"read" so observers can hydrate plans/cards. */
async function resolveTrustedReadContext(client: GatewayClient | null, groupId: string) {
  const tenant = await resolveCollaborationTenantResolution(client);
  const actor = await resolveDeliveryAclActor(client, groupId);
  if (!actor) {
    return { ok: false as const, error: "actor_not_authenticated", tenant, actor: null };
  }
  const trusted = await resolveHandlerTrustedTeamContext({
    groupId,
    actor,
    client,
    tenant,
    action: "read",
  });
  if (!trusted.ok) {
    return { ok: false as const, error: trusted.reason, detail: trusted.detail, tenant, actor };
  }
  return {
    ok: true as const,
    tenant,
    actor,
    auth: trusted.auth,
    stores: trusted.stores,
    trusted: trusted.trusted,
  };
}

function trustedDeliveryIssuerInput(
  ctx: { actor: string; tenant: { tenantId: string | null } },
  groupId: string,
) {
  return {
    source: "resolveTrustedWriteContext",
    tenantId: ctx.tenant.tenantId ?? "",
    actorId: ctx.actor,
    groupId,
    groupAction: "write",
  };
}

/** Map gateway context.deps (CliDeps) or test OutboundSendDeps stubs into send deps. */
function outboundDepsFromGatewayContext(deps: unknown): OutboundSendDeps | undefined {
  if (!deps || typeof deps !== "object") {
    return undefined;
  }
  const record = deps as Record<string, unknown>;
  if (typeof record.sendMessageTelegram === "function") {
    return createOutboundSendDeps(deps as CliDeps);
  }
  return deps as OutboundSendDeps;
}

async function loadAcceptedArtifactIssuanceFacts(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  client: GatewayClient | null;
  ctx: {
    actor: string;
    tenant: Parameters<typeof listCollaborationBoardItems>[0]["tenant"];
    auth: Parameters<typeof listCollaborationBoardItems>[0]["auth"];
    trusted: Parameters<typeof listCollaborationBoardItems>[0]["trusted"];
    stores: Parameters<typeof listCollaborationBoardItems>[0]["stores"];
  };
}) {
  const items = await listCollaborationBoardItems({
    groupId: params.groupId,
    taskId: params.taskId,
    auth: params.ctx.auth,
    trusted: params.ctx.trusted,
    stores: params.ctx.stores,
    tenant: params.ctx.tenant,
  });
  const item = items.find((entry) => entry.itemId === params.itemId) ?? null;
  const deliverableId = item?.linkedDeliverableId?.trim() ?? "";
  let deliverable: {
    deliverableId: string;
    version: number;
    contentSha256: string;
    content: string;
  } | null = null;
  if (item?.status === "accepted" && deliverableId) {
    const read = await readTeamDeliverable({
      groupId: params.groupId,
      deliverableId,
      actor: params.ctx.actor,
      tenant: params.ctx.tenant,
      client: params.client,
      trusted: params.ctx.trusted,
      enforceAcl: true,
    });
    if (read.ok) {
      deliverable = {
        deliverableId: read.deliverableId,
        version: read.version,
        contentSha256: read.contentSha256,
        content: read.content,
      };
    }
  }
  return issuanceFactsFromBoard({
    groupId: params.groupId,
    taskId: params.taskId,
    itemId: params.itemId,
    item,
    deliverable,
  });
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const item = await publishCollaborationBoardItem({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const item = await claimCollaborationBoardItem({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const result = await applyCollaborationBoardClaim({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const items = await listCollaborationBoardItems({
        ...params,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
      });
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const proposed = await proposeCollaborationTodolist({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const retried = await retryCollaborationOwnerDecisionDelivery({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        expectedVersion: params.expectedVersion,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const deliveries = await listCollaborationOwnerDecisionDeliveries({
        groupId: params.groupId,
        taskId: params.taskId,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        const base = ctx.error + (ctx.detail ? `: ${ctx.detail}` : "");
        // Confirm refusals must name 主答/lead/coordinator without leaking plan step secrets.
        const message = base.includes("主答")
          ? base
          : `${base}; confirmTodolist requires 主答/lead or coordinator`;
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      const todolist = await confirmCollaborationTodolist({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        expectedVersion: params.expectedVersion,
        actor: ctx.actor,
        sessionActorSubjects: authenticatedSessionSubjects(client),
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
      });
      // Same post-plan wake/autoAdvance path as chat-plan-confirm-hook (UI RPC was missing it).
      // Surface wakeRecorded/reason so silent early-return cannot hide (F4 R5).
      let autoAdvance: {
        autoAdvanceWired: boolean;
        wakeRecorded: boolean;
        wakeConsumed: boolean;
        dispatched: boolean;
        reason: string;
        targetAgentIds: string[];
      } = {
        autoAdvanceWired: false,
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "advance_not_attempted",
        targetAgentIds: [],
      };
      try {
        const confirmedStep =
          todolist.steps.find((s) => s.status === "active" || s.status === "pending") ??
          todolist.steps[0];
        const advance = await triggerPostPlanConfirmAdvance({
          groupId: params.groupId,
          taskId: todolist.taskId || params.taskId,
          boardItemId: todolist.boardItemId,
          todolistId: todolist.todolistId,
          confirmedVersion: todolist.version,
          stepId: confirmedStep?.stepId ?? null,
          confirmerId: ctx.actor,
          tenant: ctx.tenant,
          auth: ctx.auth,
          trusted: ctx.trusted,
          stores: ctx.stores,
        });
        autoAdvance = {
          autoAdvanceWired: advance.autoAdvanceWired,
          wakeRecorded: advance.wakeRecorded,
          wakeConsumed: advance.wakeConsumed,
          dispatched: advance.dispatched,
          reason: advance.reason,
          targetAgentIds: advance.targetAgentIds,
        };
      } catch (error) {
        // Confirm already committed; match chat hook — mark attempted, never roll back.
        const detail = error instanceof Error ? error.message : String(error);
        autoAdvance = {
          autoAdvanceWired: true,
          wakeRecorded: false,
          wakeConsumed: false,
          dispatched: false,
          reason: `advance_threw:${detail}`.slice(0, 240),
          targetAgentIds: [],
        };
      }
      respond(
        true,
        {
          todolist,
          autoAdvanceWired: autoAdvance.autoAdvanceWired,
          autoAdvance,
        },
        undefined,
      );
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const todolist = await reviseCollaborationTodolist({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        reason: params.reason,
        steps: params.steps,
        expectedVersion: params.expectedVersion,
        actor: ctx.actor,
        sessionActorSubjects: authenticatedSessionSubjects(client),
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      // Trusted locator chain with read action: observers may hydrate plans/cards;
      // writes stay on resolveTrustedWriteContext (confirm/revise/etc.).
      const ctx = await resolveTrustedReadContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const todolist = await getCollaborationTodolist({
        groupId: params.groupId,
        taskId: params.taskId,
        todolistId: params.todolistId,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
      });
      const deliveries = await listCollaborationOwnerDecisionDeliveries({
        groupId: params.groupId,
        taskId: params.taskId,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedReadContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const todolists = await listCollaborationTodolists({
        groupId: params.groupId,
        taskId: params.taskId,
        boardItemId: params.boardItemId,
        ownerMemberId: params.ownerMemberId,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const result = await submitCollaborationBoardItemForReview({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
      });
      respond(true, { item: result.item, eventRelay: result.eventRelay }, undefined);
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const result = await acceptCollaborationBoardItemSubmission({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
      });
      respond(true, { item: result.item, eventRelay: result.eventRelay }, undefined);
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
  "collaboration.task.requestAcceptedArtifactDelivery": async ({
    params,
    respond,
    client,
    context,
  }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskRequestAcceptedArtifactDeliveryParams,
        "collaboration.task.requestAcceptedArtifactDelivery",
        respond,
      )
    ) {
      return;
    }
    try {
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const facts = await loadAcceptedArtifactIssuanceFacts({
        groupId: params.groupId,
        taskId: params.taskId,
        itemId: params.itemId,
        client,
        ctx,
      });
      const cfg = loadConfig();
      const result = await requestAcceptedArtifactDelivery({
        issuerInput: trustedDeliveryIssuerInput(ctx, params.groupId),
        facts,
        target: params.target,
        dirs: acceptedArtifactDeliveryDirs(),
        cfg,
        deps: outboundDepsFromGatewayContext(context?.deps),
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result.delivery, undefined);
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
  "collaboration.task.revokeAcceptedArtifactDelivery": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskRevokeAcceptedArtifactDeliveryParams,
        "collaboration.task.revokeAcceptedArtifactDelivery",
        respond,
      )
    ) {
      return;
    }
    try {
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const result = await revokeAcceptedArtifactDelivery({
        issuerInput: trustedDeliveryIssuerInput(ctx, params.groupId),
        taskId: params.taskId,
        itemId: params.itemId,
        target: params.target,
        dirs: acceptedArtifactDeliveryDirs(),
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, { revoked: true }, undefined);
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
  "collaboration.task.readAcceptedArtifactDelivery": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskReadAcceptedArtifactDeliveryParams,
        "collaboration.task.readAcceptedArtifactDelivery",
        respond,
      )
    ) {
      return;
    }
    try {
      const ctx = await resolveTrustedReadContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const result = await readAcceptedArtifactDelivery({
        tenantId: ctx.tenant.tenantId ?? "",
        actorId: ctx.actor,
        groupId: params.groupId,
        taskId: params.taskId,
        itemId: params.itemId,
        target: params.target,
        rootDir: acceptedArtifactDeliveryDirs().rootDir,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result.delivery, undefined);
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const result = await returnCollaborationBoardItemSubmission({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
      });
      respond(true, { item: result.item, eventRelay: result.eventRelay }, undefined);
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const item = await cancelCollaborationBoardItem({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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
      const ctx = await resolveTrustedWriteContext(client, params.groupId);
      if (!ctx.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
        );
        return;
      }
      const result = await requestCollaborationTaskStop({
        ...params,
        actor: ctx.actor,
        tenant: ctx.tenant,
        auth: ctx.auth,
        stores: ctx.stores,
        trusted: ctx.trusted,
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

  "collaboration.learning.privateMemory.promote": async ({ params, respond, client }) => {
    const botId = typeof params.botId === "string" ? params.botId.trim() : "";
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : "";
    const confidentialityTier =
      typeof params.confidentialityTier === "string" && params.confidentialityTier.trim()
        ? params.confidentialityTier.trim()
        : undefined;
    if (!botId || !groupId || !capsuleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "botId, groupId, and capsuleId are required"),
      );
      return;
    }
    const actorId = await resolveDeliveryAclActor(client, groupId);
    if (!actorId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "identified actor is required"),
      );
      return;
    }
    // Target group membership / write role (same trusted write path as board mutations).
    const ctx = await resolveTrustedWriteContext(client, groupId);
    if (!ctx.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, ctx.error + (ctx.detail ? `: ${ctx.detail}` : "")),
      );
      return;
    }
    try {
      const result = await promotePrivateMemoryCapsuleAuthorized({
        botId,
        groupId,
        capsuleId,
        actorId,
        cfg: loadConfig(),
        // Thread authorized target-group tenant/stores — do not reopen defaults in entry.
        tenantId: ctx.tenant.tenantId,
        securityProfile: ctx.auth.profile,
        stores: ctx.stores,
        ...(confidentialityTier ? { confidentialityTier } : {}),
      });
      // Flag-off and policy denials are success-shaped results (promoted:false), not RPC errors.
      // Authz / missing capsule reasons that must not look like a promotion success:
      const hardReject = new Set([
        "capsule_not_found",
        "capsule_revoked",
        "capsule_not_approved",
        "ownership_context_required",
        "ownership_fields_required",
        "actor_not_owner",
        "agent_ownership_mismatch",
        "managed_tenant_required",
        "cross_tenant_ownership",
        "managed_requires_trusted_context",
        "botId_groupId_capsuleId_actorId_required",
      ]);
      if (!result.promoted && hardReject.has(result.reason)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result, undefined);
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

  "collaboration.learning.skillDraft.list": async ({ respond, client }) => {
    try {
      const ownerIds = await resolvePersonalAssetOwnerIdentities(client);
      if (ownerIds.length === 0) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "authenticated user required"),
        );
        return;
      }
      respond(true, { skills: listLearningCuratedSkillDrafts(ownerIds) }, undefined);
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

  "collaboration.learning.skillDraft.finalize": async ({ params, respond, client }) => {
    const skillId = typeof params.skillId === "string" ? params.skillId.trim() : "";
    if (!skillId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "skillId is required"));
      return;
    }
    try {
      const ownerIds = await resolvePersonalAssetOwnerIdentities(client);
      if (ownerIds.length === 0) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "authenticated user required"),
        );
        return;
      }
      const result = finalizeLearningCuratedSkillDraft({ skillId, ownerIds });
      respond(true, result, undefined);
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
};

import type { InteractionModelDecision } from "../../agent-runtime/contracts/interaction.js";
/**
 * Composition-root helper: classify + controlledDiscussToTask before primary discussion.
 * Failures are returned as structured results — never throw into the chat loop.
 * Registers authenticated inbound sourceMessageId so tool/RPC cannot borrow foreign ids.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { isCollabTaskClaimContractEnabled } from "../collaboration-dispatch/claim-contract.js";
import {
  controlledDiscussToTask,
  type ControlledDiscussToTaskResult,
} from "./controlled-discuss-to-task.js";
import { FORMAL_TASK_FLAG_OFF_USER_MESSAGE } from "./discuss-to-task-receipt.js";
import { registerDiscussToTaskSourceBinding } from "./discuss-to-task-source-binding.js";
import { stagesFromActivation } from "./discuss-to-task-stages.js";
import { resolveCompositionTrustedTeamContext } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

const emptyStages = () =>
  stagesFromActivation({
    taskEnsured: false,
    boardPublished: false,
    responsibilityAccepted: false,
    planProposed: false,
    planConfirmed: false,
  });

export async function maybeControlledDiscussToTaskBeforeDiscussion(params: {
  groupId: string;
  sourceMessageId: string;
  message: string;
  actor: string;
  client: unknown;
  tenant: CollaborationTenantResolution | null | undefined;
  cfg: OpenBotConfig;
  stampedEnterpriseId?: string | null;
  identityAliases?: string[];
  suggestedClaimantIds?: readonly string[];
  /** Trusted host result, never accepted from chat.send request fields. */
  understanding?: InteractionModelDecision;
}): Promise<ControlledDiscussToTaskResult | null> {
  const message = params.message.trim();
  const sourceMessageId = params.sourceMessageId.trim();
  const actor = params.actor.trim();
  const groupId = params.groupId.trim();
  if (!message || !sourceMessageId || !actor || !groupId) {
    return null;
  }

  const decision = params.understanding;
  // No lexical fallback: group work must use the same semantic lifecycle contract.
  if (!decision) {
    throw new Error("Group interaction understanding is required before formal task admission");
  }
  if (decision.kind !== "execution_request" || decision.request.lifecycle !== "long_task") {
    return null;
  }
  const classification = {
    kind: "explicit_delegation" as const,
    reason: "explicit_team_task" as const,
    titleHint: decision.request.goal.slice(0, 80),
    goalHint: decision.request.goal,
    acceptanceHints: decision.request.acceptance,
  };
  // Flag-off before auth/bind/activate: clearly blocked, no task/board writes.
  const earlyTenantId =
    params.tenant?.tenantId?.trim() ||
    (typeof params.stampedEnterpriseId === "string" ? params.stampedEnterpriseId.trim() : "") ||
    "_local";
  if (!isCollabTaskClaimContractEnabled(params.cfg, groupId, earlyTenantId)) {
    return {
      classification: "explicit_delegation",
      classificationReason: "explicit_team_task",
      attempted: true,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: emptyStages(),
      statusCode: "formal_task_blocked_flag_off",
      userMessage: FORMAL_TASK_FLAG_OFF_USER_MESSAGE,
      internalReason: "claim_contract_flag_off",
    };
  }

  const bound = await resolveCompositionTrustedTeamContext({
    groupId,
    actor,
    client: params.client as never,
    tenant: params.tenant ?? null,
    action: "write",
    cfg: params.cfg,
    stampedEnterpriseId: params.stampedEnterpriseId,
    identityAliases: params.identityAliases,
  });
  if (!bound.ok) {
    return {
      classification: "explicit_delegation",
      classificationReason: "explicit_team_task",
      attempted: true,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: emptyStages(),
      statusCode: "formal_task_blocked_auth",
      userMessage: "无权在该组建立正式任务。",
      internalReason: bound.reason,
    };
  }

  const tenantId =
    bound.auth.tenantId?.trim() ||
    params.tenant?.tenantId?.trim() ||
    (bound.auth.profile === "personal_local" ? "_local" : "");
  if (!tenantId) {
    return {
      classification: "explicit_delegation",
      classificationReason: "explicit_team_task",
      attempted: true,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: emptyStages(),
      statusCode: "formal_task_blocked_auth",
      userMessage: "无权在该组建立正式任务。",
      internalReason: "tenant_required",
    };
  }

  // Bind trusted inbound (first-write-wins). Different principal → conflict.
  const registered = registerDiscussToTaskSourceBinding({
    sourceMessageId,
    tenantId,
    groupId,
    principalActor: actor,
    kind: "trusted_inbound",
  });
  if (!registered.ok) {
    return {
      classification: "explicit_delegation",
      classificationReason: "explicit_team_task",
      attempted: true,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: emptyStages(),
      statusCode: "formal_task_blocked",
      userMessage: "正式任务来源归属冲突，无法借用他人消息身份建立任务。",
      internalReason: "source_owner_conflict",
    };
  }

  return controlledDiscussToTask({
    sourceMessageId,
    sourceKind: "trusted_inbound",
    groupId,
    tenantId,
    actor,
    principalActor: actor,
    message,
    title: classification.titleHint,
    goal: classification.goalHint,
    acceptanceCriteria: classification.acceptanceHints,
    suggestedClaimantIds: params.suggestedClaimantIds,
    forceExplicit: true,
    // Phase-1: chat path never pre-confirms.
    humanConfirmed: false,
    auth: bound.auth,
    trusted: bound.trusted,
    tenant: params.tenant ?? null,
    cfg: params.cfg,
  });
}

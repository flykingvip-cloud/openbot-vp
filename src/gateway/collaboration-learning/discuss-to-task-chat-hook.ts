/**
 * Composition-root helper: classify + controlledDiscussToTask before primary discussion.
 * Failures are returned as structured results — never throw into the chat loop.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  controlledDiscussToTask,
  type ControlledDiscussToTaskResult,
} from "./controlled-discuss-to-task.js";
import { classifyDiscussToTaskIntent } from "./discuss-to-task-classify.js";
import { resolveCompositionTrustedTeamContext } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

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
}): Promise<ControlledDiscussToTaskResult | null> {
  const message = params.message.trim();
  const sourceMessageId = params.sourceMessageId.trim();
  const actor = params.actor.trim();
  const groupId = params.groupId.trim();
  if (!message || !sourceMessageId || !actor || !groupId) {
    return null;
  }
  const classification = classifyDiscussToTaskIntent(message);
  if (classification.kind !== "explicit_delegation") {
    // Still return a lightweight result for diagnosis when clarification needed.
    if (classification.kind === "needs_clarification") {
      return {
        classification: classification.kind,
        classificationReason: classification.reason,
        attempted: false,
        taskId: null,
        activationKey: null,
        activation: null,
        stages: {
          taskEstablished: false,
          boardPublished: false,
          responsibilityAccepted: false,
          planProposed: false,
          planConfirmed: false,
        },
        statusCode: "needs_clarification",
        userMessage: "委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。",
        internalReason: classification.reason,
      };
    }
    return null;
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
      stages: {
        taskEstablished: false,
        boardPublished: false,
        responsibilityAccepted: false,
        planProposed: false,
        planConfirmed: false,
      },
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
      stages: {
        taskEstablished: false,
        boardPublished: false,
        responsibilityAccepted: false,
        planProposed: false,
        planConfirmed: false,
      },
      statusCode: "formal_task_blocked_auth",
      userMessage: "无权在该组建立正式任务。",
      internalReason: "tenant_required",
    };
  }

  return controlledDiscussToTask({
    sourceMessageId,
    groupId,
    tenantId,
    actor,
    message,
    title: classification.titleHint,
    goal: classification.goalHint,
    acceptanceCriteria: classification.acceptanceHints,
    suggestedClaimantIds: params.suggestedClaimantIds,
    humanConfirmed: false,
    auth: bound.auth,
    trusted: { groupsRoot: bound.groupsRoot, groupLocator: bound.groupLocator },
    tenant: params.tenant ?? null,
    cfg: params.cfg,
  });
}

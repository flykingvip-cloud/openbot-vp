/**
 * TEAM-REAL F1–F3 gateway handlers — activation, NL confirm, team deliverable, readiness.
 * Pack-owned; does not edit collaboration-learning.ts hot board/confirm surface.
 */
import { activateCollaborationTask } from "../collaboration-learning/activate-collaboration-task.js";
import { tryConfirmPlanFromChat } from "../collaboration-learning/chat-plan-confirm.js";
import { resolveDeliveryAclActor } from "../collaboration-learning/delivery-actor-binding.js";
import {
  checkMemberDispatchReadiness,
  ensureRegisteredMemberMainSession,
  type MemberDispatchCandidate,
  type MemberRegistrationStatus,
} from "../collaboration-learning/member-dispatch-readiness.js";
import {
  readTeamDeliverable,
  submitTeamDeliverable,
} from "../collaboration-learning/team-deliverable-submit.js";
import { resolveCollaborationTenantResolution } from "../collaboration-learning/trusted-tenant.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean);
  return out.length ? out : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const collaborationTaskActivationHandlers: GatewayRequestHandlers = {
  "collaboration.task.activate": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const taskId = readString(params?.taskId);
    const title = readString(params?.title);
    const message = readString(params?.message);
    if (!groupId || !taskId || !title || !message) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, taskId, title, message are required"),
      );
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const actor = await resolveDeliveryAclActor(client, groupId);
      const result = await activateCollaborationTask({
        groupId,
        taskId,
        title,
        message,
        actor,
        goal: readString(params?.goal),
        acceptanceCriteria: readStringArray(params?.acceptanceCriteria),
        constraints: readStringArray(params?.constraints),
        suggestedClaimantIds: readStringArray(params?.suggestedClaimantIds),
        suggestedRole: readString(params?.suggestedRole),
        dueAtMs: readNumber(params?.dueAtMs),
        humanConfirmed: readBoolean(params?.humanConfirmed) === true,
        requireHumanConfirm: readBoolean(params?.requireHumanConfirm),
        tenant,
      });
      if (result.status !== "activated") {
        respond(true, result, undefined);
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.task.confirmPlanFromChat": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const message = readString(params?.message);
    const taskId = readString(params?.taskId);
    if (!groupId || !message || !taskId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, taskId, message are required"),
      );
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const actor = await resolveDeliveryAclActor(client, groupId);
      const result = await tryConfirmPlanFromChat({
        groupId,
        message,
        actor,
        taskId,
        boardItemId: readString(params?.boardItemId),
        todolistId: readString(params?.todolistId),
        expectedVersion: readNumber(params?.expectedVersion),
        tenant,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.task.submitTeamDeliverable": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const taskId = readString(params?.taskId);
    const title = readString(params?.title);
    const content = typeof params?.content === "string" ? params.content : undefined;
    if (!groupId || !taskId || !title || content === undefined) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, taskId, title, content are required"),
      );
      return;
    }
    try {
      const actor = await resolveDeliveryAclActor(client, groupId);
      const result = await submitTeamDeliverable({
        groupId,
        taskId,
        actor,
        title,
        content,
        logicalId: readString(params?.logicalId),
        contentType: readString(params?.contentType),
        previousDeliverableId: readString(params?.previousDeliverableId),
        relativePath: readString(params?.relativePath),
      });
      if (!result.ok) {
        respond(true, result, undefined);
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.task.readTeamDeliverable": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const deliverableId = readString(params?.deliverableId);
    if (!groupId || !deliverableId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, deliverableId are required"),
      );
      return;
    }
    try {
      const actor = await resolveDeliveryAclActor(client, groupId);
      const result = await readTeamDeliverable({ groupId, deliverableId, actor });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.task.checkDispatchReadiness": async ({ params, respond, client }) => {
    const rawMembers = Array.isArray(params?.members) ? params.members : null;
    if (!rawMembers || rawMembers.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "members array is required"),
      );
      return;
    }
    const members: MemberDispatchCandidate[] = [];
    for (const row of rawMembers) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const memberId = readString((row as { memberId?: unknown }).memberId);
      const registrationRaw = readString((row as { registration?: unknown }).registration);
      const registration: MemberRegistrationStatus =
        registrationRaw === "registered" ? "registered" : "not_registered";
      if (!memberId) {
        continue;
      }
      members.push({
        memberId,
        agentId: readString((row as { agentId?: unknown }).agentId),
        displayName: readString((row as { displayName?: unknown }).displayName),
        registration,
        sessionKey: readString((row as { sessionKey?: unknown }).sessionKey),
      });
    }
    if (members.length === 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no valid members"));
      return;
    }
    try {
      void client;
      const autoEnsure = readBoolean(params?.autoEnsureSession) !== false;
      const result = await checkMemberDispatchReadiness({
        members,
        autoEnsureSession: autoEnsure,
        ensureSession: autoEnsure
          ? async (agentId, sessionKey) => {
              await ensureRegisteredMemberMainSession({ agentId, sessionKey });
            }
          : undefined,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },
};

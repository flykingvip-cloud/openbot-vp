import { Type } from "@sinclair/typebox";
import {
  enforceOperationalIdentityRuntimeAccess,
  executeEnterpriseOperationalIdentityRuntimeAction,
  listOperationalIdentityRuntimeAccess,
  resolveOperationalIdentityRuntimeScopeDecision,
} from "../../gateway/enterprise-operational-identity-runtime.js";
import {
  describeExecutionIdentityPresence,
  resolveExecutionIdentityFromRunFields,
  toRestrictedGatewayClient,
  type ExecutionIdentityContext,
} from "../../gateway/execution-identity-context.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";

const OperationalIdentityToolSchema = Type.Object({
  action: Type.String({
    description: "One of: list, resolve, execute.",
  }),
  identityId: Type.Optional(Type.String()),
  operationalAction: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  subject: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  videoUrl: Type.Optional(Type.String()),
  videoId: Type.Optional(Type.String()),
  tid: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.String()),
  tag: Type.Optional(Type.String()),
  coverUrl: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  bannerUrl: Type.Optional(Type.String()),
  desc: Type.Optional(Type.String()),
  picUrl: Type.Optional(Type.String()),
  picId: Type.Optional(Type.String()),
  thumbUrl: Type.Optional(Type.String()),
  thumbMediaId: Type.Optional(Type.String()),
  thumbBase64: Type.Optional(Type.String()),
  thumbFilename: Type.Optional(Type.String()),
  thumbContentType: Type.Optional(Type.String()),
  mediaId: Type.Optional(Type.String()),
  publishId: Type.Optional(Type.String()),
  imageUrl: Type.Optional(Type.String()),
  imageBase64: Type.Optional(Type.String()),
  rewriteContentImages: Type.Optional(Type.Boolean()),
  startTime: Type.Optional(Type.Number()),
  endTime: Type.Optional(Type.Number()),
  meetingId: Type.Optional(Type.String()),
  meetingCode: Type.Optional(Type.String()),
  timeZone: Type.Optional(Type.String()),
  password: Type.Optional(Type.String()),
  inviteeUserIds: Type.Optional(Type.String()),
});

function normalizeAction(raw: string): "list" | "resolve" | "execute" {
  const action = raw.trim().toLowerCase();
  if (action === "list" || action === "resolve" || action === "execute") {
    return action;
  }
  throw new ToolInputError("action must be one of: list, resolve, execute");
}

/**
 * Freeze the tool's trusted turn identity.
 *
 * Prefers the canonical context supplied by the run. The individual scalars remain accepted
 * only as a transitional adapter for callers that have not been migrated yet; they are read
 * from the trusted run options, never from tool arguments.
 */
export function resolveToolExecutionIdentity(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  executionIdentity?: ExecutionIdentityContext;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
}): ExecutionIdentityContext {
  const agentId =
    options?.requesterAgentIdOverride?.trim() ||
    options?.executionIdentity?.agentId ||
    (options?.agentSessionKey
      ? resolveSessionAgentId({ sessionKey: options.agentSessionKey })
      : undefined);
  return resolveExecutionIdentityFromRunFields({
    executionIdentity: options?.executionIdentity,
    gatewayClientUser: options?.gatewayClientUser,
    gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
    gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
    agentId,
    sessionKey: options?.agentSessionKey,
  });
}

function readExecutionPayload(params: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const keys = [
    "to",
    "subject",
    "message",
    "body",
    "title",
    "content",
    "text",
    "html",
    "videoUrl",
    "videoId",
    "tid",
    "tags",
    "tag",
    "coverUrl",
    "summary",
    "bannerUrl",
    "desc",
    "category",
    "imageUrls",
    "imageUrl",
    "imageBase64",
    "rewriteContentImages",
    "picUrl",
    "picId",
    "thumbUrl",
    "thumbMediaId",
    "thumbBase64",
    "mediaId",
    "publishId",
    "sendToAll",
    "tagId",
    "uid",
    "mailbox",
    "query",
    "limit",
    "startTime",
    "endTime",
    "meetingId",
    "meetingCode",
    "timeZone",
    "password",
    "inviteeUserIds",
  ] as const;
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      payload[key] = value.trim();
    } else if (typeof value === "number" && Number.isFinite(value)) {
      payload[key] = value;
    } else if (typeof value === "boolean") {
      payload[key] = value;
    }
  }
  if (typeof params.rewriteContentImages === "boolean") {
    payload.rewriteContentImages = params.rewriteContentImages;
  }
  return payload;
}

export function createOperationalIdentityTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  /** Canonical trusted turn identity (preferred). */
  executionIdentity?: ExecutionIdentityContext;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
}): AnyAgentTool {
  return {
    name: "operational_identity",
    label: "Operational Identity",
    description:
      "List, verify, or execute Seat-bound enterprise operational identity actions already authorized to this robot (including tencent-meeting schedule_meeting / cancel_meeting / list_meetings). Credentials stay server-side; execute returns operation output only. Prefer this over the meeting tool when booking via an enterprise Tencent Meeting identity.",
    parameters: OperationalIdentityToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      const identity = resolveToolExecutionIdentity(options);
      const agentId = identity.agentId;
      const client = toRestrictedGatewayClient(identity);
      if (!client && !agentId) {
        throw new ToolInputError(
          "Enterprise session or an enrolled agent identity is required for operational identity access.",
        );
      }
      const identityPresence = describeExecutionIdentityPresence(identity);
      const scopeParams = {
        agentId,
        ...(identity.collaborationOwnerEntitlement
          ? { collaborationOwnerEntitlement: identity.collaborationOwnerEntitlement }
          : {}),
      };
      if (action === "list") {
        const access = await listOperationalIdentityRuntimeAccess({
          client,
          agentId,
          ...(identity.collaborationOwnerEntitlement
            ? { collaborationOwnerEntitlement: identity.collaborationOwnerEntitlement }
            : {}),
        });
        if (!access) {
          const decision = await resolveOperationalIdentityRuntimeScopeDecision(
            client,
            scopeParams,
          );
          if (!decision.ok) {
            return jsonResult({
              ok: false,
              code: decision.code,
              message: decision.message,
              identityPresence,
            });
          }
          return jsonResult({
            ok: true,
            source: decision.source,
            tenantId: decision.scope.tenantId,
            seatId: decision.scope.seatId,
            agentId: decision.scope.agentId,
            employeeId: decision.scope.employeeId,
            entries: [],
          });
        }
        return jsonResult({
          ok: true,
          source: access.source,
          tenantId: access.scope.tenantId,
          seatId: access.scope.seatId,
          agentId: access.scope.agentId,
          employeeId: access.scope.employeeId,
          entries: access.entries,
        });
      }
      const identityId = readStringParam(params, "identityId", { required: true });
      const operationalAction = readStringParam(params, "operationalAction", { required: true });
      if (action === "resolve") {
        const enforcement = await enforceOperationalIdentityRuntimeAccess({
          client,
          identityId,
          action: operationalAction,
          agentId,
          ...(identity.collaborationOwnerEntitlement
            ? { collaborationOwnerEntitlement: identity.collaborationOwnerEntitlement }
            : {}),
        });
        if (!enforcement.ok) {
          return jsonResult({
            ok: false,
            allowed: false,
            code: enforcement.result?.code ?? "IDENTITY_ACTION_DENIED",
            message: enforcement.message,
            seatId: enforcement.scope?.seatId ?? null,
            agentId: enforcement.scope?.agentId ?? null,
            identityPresence,
          });
        }
        const access = await listOperationalIdentityRuntimeAccess({
          client,
          agentId,
          seatId: enforcement.scope.seatId,
          ...(identity.collaborationOwnerEntitlement
            ? { collaborationOwnerEntitlement: identity.collaborationOwnerEntitlement }
            : {}),
        });
        const effectiveEntry = access?.entries.find(
          (entry) => entry.identityId === enforcement.result.identity.identityId,
        );
        return jsonResult({
          ok: true,
          allowed: true,
          tenantId: enforcement.scope.tenantId,
          seatId: enforcement.scope.seatId,
          agentId: enforcement.scope.agentId,
          employeeId: enforcement.scope.employeeId,
          identityId: enforcement.result.identity.identityId,
          displayName: enforcement.result.identity.displayName,
          provider: enforcement.result.identity.provider,
          policyId: enforcement.result.policy.policyId,
          operationalAction,
          // P1: resolve enumerates EffectiveActions only (same PDP as list/enforce).
          allowedActions: effectiveEntry?.allowedActions ?? [operationalAction],
        });
      }

      const execution = await executeEnterpriseOperationalIdentityRuntimeAction({
        client,
        identityId,
        action: operationalAction,
        payload: readExecutionPayload(params),
        agentId,
        ...(identity.collaborationOwnerEntitlement
          ? { collaborationOwnerEntitlement: identity.collaborationOwnerEntitlement }
          : {}),
      });
      if (!execution.ok) {
        return jsonResult({
          ok: false,
          executed: false,
          code: execution.code,
          message: execution.message,
          seatId: execution.scope?.seatId ?? null,
          agentId: execution.scope?.agentId ?? null,
          ...(execution.source ? { source: execution.source } : {}),
          identityPresence,
        });
      }
      return jsonResult({
        ok: true,
        executed: true,
        source: execution.source,
        tenantId: execution.scope.tenantId,
        seatId: execution.scope.seatId,
        agentId: execution.scope.agentId,
        identityId,
        policyId: execution.policyId,
        provider: execution.execution.provider,
        operationalAction,
        executionId: execution.execution.executionId,
        output: execution.execution.output,
      });
    },
  };
}

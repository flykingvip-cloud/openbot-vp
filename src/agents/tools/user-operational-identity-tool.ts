import { Type } from "@sinclair/typebox";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import {
  buildPersonalEmailBindingResolveHints,
  formatUserOperationalIdentityDenialGuidance,
  PERSONAL_EMAIL_SESSION_GUIDANCE_ZH,
} from "../../gateway/user-operational-identity-guidance.js";
import {
  executeUserOperationalIdentityRuntimeAction,
  enforceUserOperationalIdentityRuntimeAccess,
  listUserOperationalIdentityRuntimeAccess,
} from "../../gateway/user-operational-identity-runtime.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { extractEmployeeStewardUserIdFromSessionKey } from "../builtin-steward/employee-isolation.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";

const UserOperationalIdentityToolSchema = Type.Object({
  action: Type.String({
    description: "One of: list, resolve, execute.",
  }),
  provider: Type.Optional(Type.String()),
  operationalAction: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  repo: Type.Optional(Type.String()),
  repository: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  issueNumber: Type.Optional(Type.Number()),
  head: Type.Optional(Type.String()),
  base: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  subject: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  filePath: Type.Optional(Type.String()),
  filename: Type.Optional(Type.String()),
  attachmentBase64: Type.Optional(Type.String()),
  contentType: Type.Optional(Type.String()),
  buffer: Type.Optional(Type.String()),
  attachmentsJson: Type.Optional(Type.String()),
  attachments: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  author: Type.Optional(Type.String()),
  digest: Type.Optional(Type.String()),
  thumbUrl: Type.Optional(Type.String()),
  thumbMediaId: Type.Optional(Type.String()),
  thumbBase64: Type.Optional(Type.String()),
  mediaId: Type.Optional(Type.String()),
  publishId: Type.Optional(Type.String()),
  imageUrl: Type.Optional(Type.String()),
  imageBase64: Type.Optional(Type.String()),
  rewriteContentImages: Type.Optional(Type.Boolean()),
  sendToAll: Type.Optional(Type.Boolean()),
  tagId: Type.Optional(Type.Number()),
  commentId: Type.Optional(Type.String()),
  feedId: Type.Optional(Type.String()),
  images: Type.Optional(Type.String()),
  tags: Type.Optional(Type.String()),
  location: Type.Optional(Type.String()),
  mailbox: Type.Optional(Type.String()),
  uid: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
  query: Type.Optional(Type.String()),
  unseen: Type.Optional(Type.Boolean()),
  includeBody: Type.Optional(Type.Boolean()),
  email: Type.Optional(Type.String()),
});

function normalizeAction(raw: string): "list" | "resolve" | "execute" {
  const action = raw.trim().toLowerCase();
  if (action === "list" || action === "resolve" || action === "execute") {
    return action;
  }
  throw new ToolInputError("action must be one of: list, resolve, execute");
}

export function resolveUserOperationalIdentityGatewayClient(params: {
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  agentSessionKey?: string;
}): GatewayClient | null {
  const fromEmployeeSession = extractEmployeeStewardUserIdFromSessionKey(params.agentSessionKey);
  return buildKnowledgeReplyGatewayClient({
    gatewayClientUser: params.gatewayClientUser,
    gatewayClientSessionDomain:
      params.gatewayClientSessionDomain ?? (fromEmployeeSession ? "employee" : undefined),
    gatewayClientPlatformUserId:
      params.gatewayClientPlatformUserId?.trim() || fromEmployeeSession || undefined,
  });
}

function readExecutionPayload(params: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  const stringKeys = [
    "owner",
    "repo",
    "repository",
    "title",
    "body",
    "head",
    "base",
    "to",
    "subject",
    "message",
    "content",
    "author",
    "digest",
    "thumbUrl",
    "thumbMediaId",
    "thumbBase64",
    "mediaId",
    "publishId",
    "imageUrl",
    "imageBase64",
    "commentId",
    "feedId",
    "location",
    "mailbox",
    "query",
    "filePath",
    "filename",
    "attachmentBase64",
    "contentType",
    "buffer",
    "attachmentsJson",
    "attachments",
  ] as const;
  for (const key of stringKeys) {
    const value = readStringParam(params, key);
    if (value) {
      payload[key] = value;
    }
  }
  if (typeof params.issueNumber === "number" && Number.isFinite(params.issueNumber)) {
    payload.issueNumber = params.issueNumber;
  }
  if (typeof params.tagId === "number" && Number.isFinite(params.tagId)) {
    payload.tagId = params.tagId;
  }
  if (typeof params.rewriteContentImages === "boolean") {
    payload.rewriteContentImages = params.rewriteContentImages;
  }
  if (typeof params.sendToAll === "boolean") {
    payload.sendToAll = params.sendToAll;
  }
  if (typeof params.uid === "number" && Number.isFinite(params.uid)) {
    payload.uid = params.uid;
  }
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    payload.limit = params.limit;
  }
  if (typeof params.unseen === "boolean") {
    payload.unseen = params.unseen;
  }
  if (typeof params.includeBody === "boolean") {
    payload.includeBody = params.includeBody;
  }
  if (typeof params.images === "string" && params.images.trim()) {
    payload.images = params.images
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof params.tags === "string" && params.tags.trim()) {
    payload.tags = params.tags
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return payload;
}

export function createUserOperationalIdentityTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
}): AnyAgentTool {
  return {
    name: "user_operational_identity",
    label: "User Operational Identity",
    description:
      "List, verify, or execute personal operational identities already granted to this agent (personal-email send_email with optional filePath / attachmentBase64 / filename / attachmentsJson; wechat-official publish_draft / publish_article / broadcast_article / upload_thumb / upload_content_image / get_publish_status). Works from any agent session once the owner has granted this agent. Credentials stay server-side. If needsBinding/needsGrantConfirmation, guide the user to Personal Settings → Authorization — never send mail via exec or OPENBOT_SMTP_* env vars.",
    parameters: UserOperationalIdentityToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      const agentId =
        options?.requesterAgentIdOverride?.trim() ||
        (options?.agentSessionKey
          ? resolveSessionAgentId({ sessionKey: options.agentSessionKey })
          : undefined);
      const sessionKey = options?.agentSessionKey;
      const client = resolveUserOperationalIdentityGatewayClient({
        gatewayClientUser: options?.gatewayClientUser,
        gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
        gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
        agentSessionKey: sessionKey,
      });
      const createBindingRequestOnDeny = Boolean(client);
      if (action === "list") {
        const access = await listUserOperationalIdentityRuntimeAccess({
          client,
          agentId,
          sessionKey,
        });
        if (!access) {
          return jsonResult({
            ok: true,
            entries: [],
            needsBinding: true,
            message: PERSONAL_EMAIL_SESSION_GUIDANCE_ZH,
          });
        }
        return jsonResult({
          ok: true,
          ownerId: access.scope.ownerId,
          agentId: access.scope.agentId,
          entries: access.entries,
        });
      }
      const provider = readStringParam(params, "provider", { required: true });
      const operationalAction = readStringParam(params, "operationalAction", { required: true });
      const bindEmail = readStringParam(params, "email");
      if (action === "resolve") {
        const enforcement = await enforceUserOperationalIdentityRuntimeAccess({
          client,
          provider,
          action: operationalAction,
          agentId,
          sessionKey,
          createBindingRequestOnDeny,
        });
        if (!enforcement.ok) {
          const code = enforcement.result?.code ?? "USER_IDENTITY_DENIED";
          const needsBinding = enforcement.result?.needsBinding ?? false;
          const needsGrantConfirmation = enforcement.result?.needsGrantConfirmation ?? false;
          return jsonResult({
            ok: true,
            allowed: false,
            code,
            message: formatUserOperationalIdentityDenialGuidance({
              provider,
              code,
              message: enforcement.message,
              needsBinding,
              needsGrantConfirmation,
            }),
            ownerId: enforcement.scope?.ownerId ?? null,
            agentId: enforcement.scope?.agentId ?? null,
            needsBinding,
            needsGrantConfirmation,
            bindingRequestId: enforcement.bindingRequestId ?? null,
            continuationToken: enforcement.continuationToken ?? null,
            ...buildPersonalEmailBindingResolveHints({
              needsBinding,
              needsGrantConfirmation,
              bindingRequestId: enforcement.bindingRequestId ?? null,
              continuationToken: enforcement.continuationToken ?? null,
              operationalAction,
              email: bindEmail,
              preferBrowser: provider === "personal-email" && Boolean(bindEmail),
            }),
          });
        }
        return jsonResult({
          ok: true,
          allowed: true,
          ownerId: enforcement.scope.ownerId,
          agentId: enforcement.scope.agentId,
          identityId: enforcement.result.identity.identityId,
          displayName: enforcement.result.identity.displayName,
          provider: enforcement.result.identity.provider,
          operationalAction,
        });
      }

      const execution = await executeUserOperationalIdentityRuntimeAction({
        client,
        provider,
        action: operationalAction,
        payload: readExecutionPayload(params),
        agentId,
        sessionKey,
        createBindingRequestOnDeny,
      });
      if (!execution.ok) {
        const needsBinding = execution.needsBinding ?? false;
        const needsGrantConfirmation = execution.needsGrantConfirmation ?? false;
        return jsonResult({
          ok: true,
          executed: false,
          code: execution.code,
          message: formatUserOperationalIdentityDenialGuidance({
            provider,
            code: execution.code,
            message: execution.message,
            needsBinding,
            needsGrantConfirmation,
          }),
          needsBinding,
          needsGrantConfirmation,
          bindingRequestId: execution.bindingRequestId ?? null,
          continuationToken: execution.continuationToken ?? null,
          ...buildPersonalEmailBindingResolveHints({
            needsBinding,
            needsGrantConfirmation,
            bindingRequestId: execution.bindingRequestId ?? null,
            continuationToken: execution.continuationToken ?? null,
            operationalAction,
            email: bindEmail,
            preferBrowser: provider === "personal-email" && Boolean(bindEmail),
          }),
        });
      }
      return jsonResult({
        ok: true,
        executed: true,
        ownerId: execution.scope.ownerId,
        agentId: execution.scope.agentId,
        identityId: execution.access.identity.identityId,
        provider: execution.execution.provider,
        operationalAction,
        simulated: execution.execution.simulated,
        credential: execution.execution.credential,
        output: execution.execution.output,
      });
    },
  };
}

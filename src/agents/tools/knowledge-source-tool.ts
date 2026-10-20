import { Type } from "@sinclair/typebox";
import { coerceSecretRef } from "../../config/types.secrets.js";
import { resolveKnowledgeToolGatewayClient } from "../../gateway/knowledge/agent-run-gateway-client.js";
import { resolveKnowledgeSourceContext } from "../../gateway/knowledge/context.js";
import {
  buildKnowledgeBasePermissionActor,
  canReadKnowledgeBase,
  resolveAuthorizedKnowledgeBase,
} from "../../gateway/knowledge/knowledge-base-permissions.js";
import { listKnowledgeBaseSources } from "../../gateway/knowledge/knowledge-base-sources-list.js";
import { listKnowledgeBases } from "../../gateway/knowledge/knowledge-base-store.js";
import {
  getApiSourceCatalog,
  invokeApiSource,
  syncApiSourceCatalog,
  validateApiSourceEndpoint,
} from "../../gateway/knowledge/sources/source-api-runtime.js";
import {
  bindKnowledgeSource,
  listKnowledgeSourceBindings,
} from "../../gateway/knowledge/sources/source-binding-store.js";
import type { SourceDescriptor } from "../../gateway/knowledge/sources/source-descriptor.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";

const SecretRefSchema = Type.Object({
  source: Type.Union([
    Type.Literal("env"),
    Type.Literal("file"),
    Type.Literal("exec"),
    Type.Literal("encrypted-local"),
  ]),
  provider: Type.String(),
  id: Type.String(),
});

const KnowledgeSourceToolSchema = Type.Object({
  action: Type.String({
    description: "One of: list, bind, sync_catalog, invoke, verify.",
  }),
  knowledgeBaseId: Type.Optional(Type.String()),
  sourceId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  endpoint: Type.Optional(Type.String()),
  authHeader: Type.Optional(Type.String()),
  authScheme: Type.Optional(Type.String()),
  credentialRef: Type.Optional(SecretRefSchema),
  method: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  catalogPath: Type.Optional(Type.String()),
  routingSummary: Type.Optional(Type.String()),
  routingKeywords: Type.Optional(Type.String()),
  expiresAt: Type.Optional(Type.String()),
  allowHttp: Type.Optional(Type.Boolean()),
  confirmed: Type.Optional(
    Type.Boolean({ description: "Required and true for the state-changing bind action." }),
  ),
  body: Type.Optional(Type.Object({}, { additionalProperties: true })),
  runProbe: Type.Optional(Type.Boolean()),
});

type KnowledgeSourceAction = "list" | "bind" | "sync_catalog" | "invoke" | "verify";

function normalizeAction(value: string): KnowledgeSourceAction {
  const action = value.trim().toLowerCase();
  if (
    action === "list" ||
    action === "bind" ||
    action === "sync_catalog" ||
    action === "invoke" ||
    action === "verify"
  ) {
    return action;
  }
  throw new ToolInputError("action must be one of: list, bind, sync_catalog, invoke, verify");
}

function readObject(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = params[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeSource(source: SourceDescriptor) {
  return {
    id: source.id,
    title: source.title,
    kind: source.kind,
    plane: source.plane,
    knowledgeBaseId: source.knowledgeBaseId ?? null,
    visibility: source.visibility ?? null,
    endpoint: source.endpoint ?? null,
    expiresAt: source.metadata?.expiresAt ?? null,
    credentialConfigured: Boolean(
      source.metadata?.["auth.secretRef"] || source.metadata?.["auth.apiKey"],
    ),
    credentialStorage: source.metadata?.["auth.secretRef"] ? "secret-ref" : "legacy-inline",
  };
}

function readMethod(params: Record<string, unknown>): string | undefined {
  const method = readStringParam(params, "method")?.toUpperCase();
  if (method && method !== "GET" && method !== "HEAD" && method !== "POST") {
    throw new ToolInputError("method must be GET, HEAD, or POST");
  }
  return method;
}

async function resolveAccess(options: {
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  agentId?: string;
  ownerUserId?: string;
  tenantId?: string;
}) {
  const client = await resolveKnowledgeToolGatewayClient(options);
  if (!client) {
    throw new ToolInputError("Signed-in employee session is required.");
  }
  const context = await resolveKnowledgeSourceContext(client);
  const userId = context.userId;
  if (!userId) {
    throw new ToolInputError("Resolved user context is required.");
  }
  const actor = buildKnowledgeBasePermissionActor({ context, email: client.user });
  return { client, context, actor, userId };
}

function requireSource(sourceId: string): SourceDescriptor {
  const source = listKnowledgeSourceBindings().find((item) => item.id === sourceId);
  if (!source) {
    throw new ToolInputError("Source not found or not authorized.");
  }
  return source;
}

export function createKnowledgeSourceTool(options?: {
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  agentId?: string;
  ownerUserId?: string;
  tenantId?: string;
}): AnyAgentTool {
  return {
    name: "knowledge_source",
    label: "Knowledge Source",
    description:
      "Configure and operate API-backed active knowledge sources for the signed-in employee. Use list to resolve exact knowledge-base/source ids, bind only after explicit user confirmation and with a SecretRef, sync_catalog for routing metadata, invoke for a minimal live request, and verify for persistence/aggregation/catalog/consumption acceptance. Never accepts a plaintext credential. Do not use this tool to read ingested Knowledge Universe documents — use knowledge_search / knowledge_get.",
    parameters: KnowledgeSourceToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      const { context, actor, userId } = await resolveAccess({
        gatewayClientUser: options?.gatewayClientUser,
        gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
        gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
        gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
        gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
        agentId: options?.agentId,
        ownerUserId: options?.ownerUserId,
        tenantId: options?.tenantId,
      });

      if (action === "list") {
        const knowledgeBases = listKnowledgeBases().filter((knowledgeBase) =>
          canReadKnowledgeBase({ knowledgeBase, actor }),
        );
        const readableKnowledgeBaseIds = new Set(
          knowledgeBases.map((knowledgeBase) => knowledgeBase.id),
        );
        const knowledgeBaseId = readStringParam(params, "knowledgeBaseId");
        const sources = listKnowledgeSourceBindings().filter(
          (source) =>
            source.knowledgeBaseId &&
            readableKnowledgeBaseIds.has(source.knowledgeBaseId) &&
            (!knowledgeBaseId || source.knowledgeBaseId === knowledgeBaseId),
        );
        return jsonResult({
          ok: true,
          knowledgeBases: knowledgeBases.map((knowledgeBase) => ({
            id: knowledgeBase.id,
            title: knowledgeBase.title,
            visibility: knowledgeBase.visibility,
            tenantId: knowledgeBase.tenantId,
            writable: Boolean(
              resolveAuthorizedKnowledgeBase({
                knowledgeBaseId: knowledgeBase.id,
                actor,
                permission: "write",
              }),
            ),
          })),
          sources: sources.map(safeSource),
        });
      }

      if (action === "bind") {
        if (params.confirmed !== true) {
          throw new ToolInputError("confirmed=true is required after explicit user approval.");
        }
        const knowledgeBaseId = readStringParam(params, "knowledgeBaseId", { required: true });
        const knowledgeBase = resolveAuthorizedKnowledgeBase({
          knowledgeBaseId,
          actor,
          permission: "write",
        });
        if (!knowledgeBase) {
          throw new ToolInputError("Knowledge base is not writable.");
        }
        const title = readStringParam(params, "title", { required: true });
        const endpoint = readStringParam(params, "endpoint", { required: true });
        const allowHttp = params.allowHttp === true;
        validateApiSourceEndpoint(endpoint, allowHttp);
        const credentialRef = coerceSecretRef(params.credentialRef);
        if (!credentialRef) {
          throw new ToolInputError("credentialRef is required; plaintext credentials are refused.");
        }
        const authHeader = readStringParam(params, "authHeader", { required: true });
        const method = readMethod(params) ?? "GET";
        const metadata = Object.fromEntries(
          [
            ["auth.header", authHeader],
            ["auth.scheme", readStringParam(params, "authScheme")],
            ["auth.secretRef", JSON.stringify(credentialRef)],
            ["request.method", method],
            ["request.path", readStringParam(params, "path")],
            ["request.allowHttp", allowHttp ? "true" : undefined],
            ["catalog.path", readStringParam(params, "catalogPath")],
            ["routing.summary", readStringParam(params, "routingSummary")],
            ["routing.keywords", readStringParam(params, "routingKeywords")],
            ["expiresAt", readStringParam(params, "expiresAt")],
          ].filter((entry): entry is [string, string] => Boolean(entry[1])),
        );
        const binding = bindKnowledgeSource({
          kind: "api",
          title,
          knowledgeBaseId,
          ownerId: userId,
          visibility: knowledgeBase.visibility,
          endpoint,
          metadata,
        });
        return jsonResult({ ok: true, binding: safeSource(binding), nextAction: "sync_catalog" });
      }

      const sourceId = readStringParam(params, "sourceId", { required: true });
      const source = requireSource(sourceId);
      const knowledgeBaseId = source.knowledgeBaseId;
      if (!knowledgeBaseId) {
        throw new ToolInputError("Source is not bound to a knowledge base.");
      }
      const knowledgeBase = resolveAuthorizedKnowledgeBase({
        knowledgeBaseId,
        actor,
        permission: "read",
      });
      if (!knowledgeBase) {
        throw new ToolInputError("Knowledge base is not readable.");
      }
      const authorizedKnowledgeBaseIds = new Set([knowledgeBaseId]);

      if (action === "sync_catalog") {
        const catalog = await syncApiSourceCatalog(sourceId, context, {
          path: readStringParam(params, "catalogPath"),
          authorizedKnowledgeBaseIds,
        });
        return jsonResult({ ok: true, catalog });
      }

      const method = readMethod(params);
      const requestPath =
        readStringParam(params, "path") ?? source.metadata?.["request.path"] ?? "/";
      const body = readObject(params, "body");
      if (action === "invoke") {
        const result = await invokeApiSource(sourceId, requestPath, context, {
          method,
          body,
          authorizedKnowledgeBaseIds,
        });
        return jsonResult({ ok: true, result });
      }

      const bindings = listKnowledgeSourceBindings({ knowledgeBaseId });
      const aggregated = await listKnowledgeBaseSources({ knowledgeBase, deliverables: [] });
      const catalog = getApiSourceCatalog(sourceId);
      let consumption: { ok: boolean; fetchedAtMs?: number; error?: string } = {
        ok: params.runProbe !== true,
      };
      if (params.runProbe === true) {
        try {
          const result = await invokeApiSource(sourceId, requestPath, context, {
            method,
            body,
            authorizedKnowledgeBaseIds,
          });
          consumption = { ok: true, fetchedAtMs: result.fetchedAtMs };
        } catch (error) {
          consumption = {
            ok: false,
            error: error instanceof Error ? error.message : "source invoke failed",
          };
        }
      }
      const persistencePassed = bindings.some((binding) => binding.id === sourceId);
      const aggregationPassed = aggregated.some(
        (item) => item.id === sourceId && item.plane === "active",
      );
      return jsonResult({
        ok: persistencePassed && aggregationPassed && consumption.ok,
        source: safeSource(source),
        acceptance: {
          persistence: { ok: persistencePassed },
          aggregation: { ok: aggregationPassed, plane: "active" },
          catalog: { ok: Boolean(catalog), fetchedAtMs: catalog?.fetchedAtMs ?? null },
          consumption,
          presentation: {
            serverVerified: false,
            expectedTestId: "ku-cockpit-tree-source",
            expectedTitle: source.title,
            requiresClientRefresh: true,
          },
        },
      });
    },
  };
}

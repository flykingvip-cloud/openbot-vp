import { Type } from "@sinclair/typebox";
import { listDataCapabilitiesForAgent } from "../../gateway/enterprise-data/capability-agent-invoke-runtime.js";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import {
  resolveExecutionIdentityFromRunFields,
  toTrustedGatewayClientFields,
} from "../../gateway/execution-identity-context.js";
import { resolveKnowledgeToolGatewayClient } from "../../gateway/knowledge/agent-run-gateway-client.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";

const DataCapabilityToolSchema = Type.Object({
  action: Type.String({
    description: "One of: list, invoke.",
  }),
  capabilityId: Type.Optional(
    Type.String({
      description: "Required for invoke. The data capability id, obtained from action=list.",
    }),
  ),
  knowledgeBaseId: Type.Optional(
    Type.String({
      description:
        "Optional knowledge-space id. When set, list/invoke are limited to capabilities bound to that space's external sources.",
    }),
  ),
  input: Type.Optional(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description: "Ignored. action=invoke does not forward parameters to connector actions.",
      },
    ),
  ),
});

function normalizeAction(raw: string): "list" | "invoke" {
  const action = raw.trim().toLowerCase();
  if (action === "list" || action === "invoke") {
    return action;
  }
  throw new ToolInputError("action must be one of: list, invoke");
}

/**
 * Data-capability catalog for the signed-in employee's agent.
 * `list` returns enabled capabilities and whether the seat is already authorized.
 * `invoke` is fail-closed: Agent Runtime consumes Knowledge Objects and does not
 * request ConnectorAction. Employee execution stays on `enterprise-data.invoke`.
 * Supply stays on ProjectionMaterializer.
 */
export function createDataCapabilityTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  executionIdentity?: ExecutionIdentityContext;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  ownerUserId?: string;
  tenantId?: string;
}): AnyAgentTool {
  return {
    name: "data_capability",
    label: "Data Capability",
    description:
      "List the signed-in employee's enterprise data capabilities. action=list returns capabilityId and access state. action=invoke is closed: consume Knowledge Objects instead of requesting ConnectorAction. Do not invent enterprise data.",
    parameters: DataCapabilityToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      const identity = resolveExecutionIdentityFromRunFields({
        executionIdentity: options?.executionIdentity,
        gatewayClientUser: options?.gatewayClientUser,
        gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
        gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
        gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
        gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
        agentId: options?.requesterAgentIdOverride,
        sessionKey: options?.agentSessionKey,
      });
      const identityFields = toTrustedGatewayClientFields(identity);
      const client = await resolveKnowledgeToolGatewayClient({
        ...identityFields,
        agentId: options?.requesterAgentIdOverride,
        ownerUserId: options?.ownerUserId,
        tenantId: options?.tenantId ?? identity.enterpriseId,
      });
      if (!client) {
        throw new ToolInputError(
          "Signed-in enterprise session is required for data capability access.",
        );
      }
      const knowledgeBaseId = readStringParam(params, "knowledgeBaseId") || undefined;

      if (action === "invoke") {
        const capabilityId = readStringParam(params, "capabilityId", { required: true });
        return jsonResult({
          ok: false,
          capabilityId,
          accessState: "unknown",
          reason: "knowledge-object-only",
          message:
            "Agent Runtime consumes Knowledge Objects and does not request ConnectorAction. Use knowledge search or knowledge.cognitive.bundle. Employee execution remains enterprise-data.invoke.",
        });
      }

      if (action === "list") {
        const listing = await listDataCapabilitiesForAgent({ client, knowledgeBaseId });
        return jsonResult({
          ok: listing.ok,
          ...(listing.reason ? { reason: listing.reason } : {}),
          ...(listing.tenantId ? { tenantId: listing.tenantId } : {}),
          ...(listing.seatId ? { seatId: listing.seatId } : {}),
          ...(listing.knowledgeBaseId ? { knowledgeBaseId: listing.knowledgeBaseId } : {}),
          ...(listing.boundSourceIds ? { boundSourceIds: listing.boundSourceIds } : {}),
          capabilities: listing.capabilities,
        });
      }

      throw new ToolInputError("action must be one of: list, invoke");
    },
  };
}

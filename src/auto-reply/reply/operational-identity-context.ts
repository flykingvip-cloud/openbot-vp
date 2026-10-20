import {
  formatAgentDataCapabilityRuntimePrompt,
  listDataCapabilitiesForAgent,
} from "../../gateway/enterprise-data/capability-agent-invoke-runtime.js";
import {
  formatOperationalIdentityRuntimePrompt,
  listOperationalIdentityRuntimeAccess,
} from "../../gateway/enterprise-operational-identity-runtime.js";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import {
  resolveExecutionIdentityFromRunFields,
  toRestrictedGatewayClient,
} from "../../gateway/execution-identity-context.js";
import {
  formatKnowledgePublishIntentExecutionSystemPrompt,
  parseKnowledgePublishIntentFromMessage,
} from "../../gateway/knowledge/publish-intent.js";
import { resolveDaibaiWorkspaceScopePrompt } from "../../gateway/server-methods/daibai-workspace-overview.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { formatPersonalEmailSendGuidancePrompt } from "../../gateway/user-operational-identity-guidance.js";
import {
  formatUserOperationalIdentityRuntimePrompt,
  listUserOperationalIdentityRuntimeAccess,
} from "../../gateway/user-operational-identity-runtime.js";
import { buildEmployeeStewardChatSystemPrompt } from "./steward-chat-context.js";

export async function buildOperationalIdentitySystemPrompt(params: {
  agentId?: string;
  sessionKey?: string;
  inboundMessage?: string;
  /** When set, data_capability prompt is scoped to this knowledge space's bindings. */
  knowledgeBaseId?: string | null;
  gatewayClient?: GatewayClient | null;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  executionIdentity?: ExecutionIdentityContext;
  /**
   * `lightweight` keeps steward ACL/persona only. It must not load workspace
   * scope, operational-identity listings, or data-capability catalogs.
   */
  listingMode?: "full" | "lightweight";
}): Promise<string | undefined> {
  const agentId = params.agentId?.trim();
  if (!agentId) {
    return undefined;
  }
  const sessionKey = params.sessionKey;
  const promptParts: string[] = [];
  const stewardPrompt = buildEmployeeStewardChatSystemPrompt({ agentId, sessionKey });
  const identity = resolveExecutionIdentityFromRunFields({
    executionIdentity: params.executionIdentity,
    gatewayClientUser: params.gatewayClientUser,
    gatewayClientSessionDomain: params.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
    gatewayClientSessionMembershipId: params.gatewayClientSessionMembershipId,
    agentId,
    sessionKey,
  });
  const client = params.gatewayClient ?? toRestrictedGatewayClient(identity);
  if (params.listingMode === "lightweight") {
    const lightweightParts = [stewardPrompt, formatPersonalEmailSendGuidancePrompt()].filter(
      Boolean,
    ) as string[];
    try {
      const userAccess = await listUserOperationalIdentityRuntimeAccess({
        client,
        agentId,
        sessionKey,
      });
      if (userAccess) {
        const userPrompt = formatUserOperationalIdentityRuntimePrompt(userAccess.entries);
        if (userPrompt) {
          lightweightParts.push(userPrompt);
        }
      }
    } catch {
      // Best-effort identity listing for chat-lane turns.
    }
    return lightweightParts.length > 0 ? lightweightParts.join("\n\n") : undefined;
  }
  if (stewardPrompt) {
    promptParts.push(stewardPrompt);
    if (client) {
      try {
        const stewardWorkspacePrompt = await resolveDaibaiWorkspaceScopePrompt({
          client,
          sessionKey,
        });
        if (stewardWorkspacePrompt) {
          promptParts.push(stewardWorkspacePrompt);
        }
      } catch {
        // Workspace scope prompt is additive; ignore failures.
      }
    }
  }
  try {
    const enterpriseAccess = await listOperationalIdentityRuntimeAccess({
      client,
      agentId,
      ...(identity.collaborationOwnerEntitlement
        ? { collaborationOwnerEntitlement: identity.collaborationOwnerEntitlement }
        : {}),
    });
    if (enterpriseAccess) {
      const enterprisePrompt = formatOperationalIdentityRuntimePrompt(enterpriseAccess.entries);
      if (enterprisePrompt) {
        promptParts.push(enterprisePrompt);
      }
    }
  } catch {
    // Enterprise seat context is optional for employee workbench sessions.
  }
  try {
    const userAccess = await listUserOperationalIdentityRuntimeAccess({
      client,
      agentId,
      sessionKey,
    });
    if (userAccess) {
      const userPrompt = formatUserOperationalIdentityRuntimePrompt(userAccess.entries);
      if (userPrompt) {
        promptParts.push(userPrompt);
      }
    } else {
      // Still inject email-send guidance so agents guide users to Personal Settings
      // instead of improvising SMTP via exec when the identity store is empty/unavailable.
      promptParts.push(formatPersonalEmailSendGuidancePrompt());
    }
  } catch {
    promptParts.push(formatPersonalEmailSendGuidancePrompt());
  }
  try {
    const dataCapabilityListing = await listDataCapabilitiesForAgent({
      client,
      knowledgeBaseId: params.knowledgeBaseId?.trim() || undefined,
    });
    const dataCapabilityPrompt = formatAgentDataCapabilityRuntimePrompt(dataCapabilityListing);
    if (dataCapabilityPrompt) {
      promptParts.push(dataCapabilityPrompt);
    }
  } catch {
    // Data capability prompt is best-effort; enterprise seat context is optional.
  }
  const publishIntent = params.inboundMessage
    ? parseKnowledgePublishIntentFromMessage(params.inboundMessage)
    : null;
  if (publishIntent) {
    promptParts.push(formatKnowledgePublishIntentExecutionSystemPrompt(publishIntent));
  }
  if (promptParts.length === 0) {
    return undefined;
  }
  return promptParts.join("\n\n");
}

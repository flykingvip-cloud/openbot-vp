import { isBuiltinStewardAgent } from "../agents/builtin-steward/identity.js";
import type { OpenBotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { isAgentVisibleToGovernanceScope } from "./agent-governance-scope.js";
import { resolveEmployeeWorkbenchActor } from "./employee-workbench-scope.js";
import { auditManagementDecision } from "./management-governance-audit.js";
import { listOwnershipRecords } from "./ownership-store.js";
import { resolveQueryScope } from "./scope-attribution.js";
import type { GatewayClient } from "./server-methods/types.js";
import { listAgentsForGateway } from "./session-utils.js";

export type AgentInvocationDecision =
  | { allowed: true }
  | { allowed: false; reason: "unknown-agent" | "outside-governance-scope" };

type AgentInvocationAudit = Parameters<typeof auditManagementDecision>[0];

/**
 * Pure invocation decision (plan v1.0 §4.6, PR-2a).
 * Same inputs and result as `authorizeAgentInvocation`. Does not call
 * `auditManagementDecision` and does not write JSONL.
 */
export async function evaluateAgentInvocation(params: {
  client: GatewayClient | null;
  agentId: string;
  cfg?: OpenBotConfig;
}): Promise<AgentInvocationDecision> {
  const evaluated = await evaluateAgentInvocationWithAudit(params);
  return evaluated.decision;
}

/** Authoritative execution check. Still unwired in production until enforce is approved. */
export async function authorizeAgentInvocation(params: {
  client: GatewayClient | null;
  agentId: string;
  cfg?: OpenBotConfig;
}): Promise<AgentInvocationDecision> {
  const evaluated = await evaluateAgentInvocationWithAudit(params);
  await auditManagementDecision(evaluated.audit);
  return evaluated.decision;
}

async function evaluateAgentInvocationWithAudit(params: {
  client: GatewayClient | null;
  agentId: string;
  cfg?: OpenBotConfig;
}): Promise<{ decision: AgentInvocationDecision; audit: AgentInvocationAudit }> {
  const cfg = params.cfg ?? loadConfig();
  const scope = await resolveQueryScope(params.client);
  const agent = listAgentsForGateway(cfg).agents.find((entry) => entry.id === params.agentId);
  if (!agent) {
    return {
      decision: { allowed: false, reason: "unknown-agent" },
      audit: {
        client: params.client,
        scope,
        action: "invoke",
        target: { kind: "worker-agent", resourceId: params.agentId },
        effect: "denied",
        reason: "unknown-agent",
      },
    };
  }
  const ownershipRecords = listOwnershipRecords();
  const activeOwnership = ownershipRecords.find(
    (record) =>
      record.subjectKind === "agent" &&
      record.subjectId === agent.id &&
      record.bindingStatus !== "revoked",
  );
  if (scope.kind === "platform") {
    return {
      decision: { allowed: true },
      audit: {
        client: params.client,
        scope,
        action: "invoke",
        target: {
          kind: "worker-agent",
          resourceId: params.agentId,
          ...(activeOwnership?.tenantId ? { tenantId: activeOwnership.tenantId } : {}),
          ...(agent.ownerId ? { ownerUserId: agent.ownerId } : {}),
        },
        effect: "allowed",
      },
    };
  }
  if (scope.kind === "self" && isBuiltinStewardAgent(agent.id)) {
    return {
      decision: { allowed: true },
      audit: {
        client: params.client,
        scope,
        action: "invoke",
        target: { kind: "supervisor-agent", resourceId: agent.id, ownerUserId: scope.ownerId },
        effect: "allowed",
      },
    };
  }
  const employeeActor =
    scope.kind === "self" ? await resolveEmployeeWorkbenchActor(params.client) : null;
  const allowed = isAgentVisibleToGovernanceScope({
    agent,
    scope,
    employeeActor,
    ownershipRecords,
  });
  return {
    decision: allowed ? { allowed: true } : { allowed: false, reason: "outside-governance-scope" },
    audit: {
      client: params.client,
      scope,
      action: "invoke",
      target: {
        kind: "worker-agent",
        resourceId: agent.id,
        ...(scope.kind === "tenant" ? { tenantId: scope.tenantId } : {}),
        ...(scope.kind === "self" ? { ownerUserId: scope.ownerId } : {}),
      },
      effect: allowed ? "allowed" : "denied",
      ...(!allowed ? { reason: "outside-governance-scope" as const } : {}),
    },
  };
}

/**
 * Agent-invocation shadow (plan v1.0 §4.6 / PR-2b / PR-P2-2).
 *
 * Flag `OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW` defaults off. When on, chat.send
 * and the agent RPC record the pure `evaluateAgentInvocation` decision via
 * `AgentInvocationAdapter`. This path never calls `authorizeAgentInvocation` or
 * `auditManagementDecision`. The session result stays
 * `shadow.existing.source = "session"`. Divergence follows the two effects: deny
 * against an existing allow is D1; equal effects are D0.
 */

import type { OpenBotConfig } from "../../config/config.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import { evaluateAgentInvocation } from "../agent-invocation-governance.js";
import { resolveTrustedAttribution } from "../scope-attribution.js";
import type { GatewayClient } from "../server-methods/types.js";
import { adaptAgentInvocationDecision } from "./adapters/agent-invocation-adapter.js";
import { appendGovernanceShadowDecision } from "./shadow-sink.js";
import { actorIdFromIdentity } from "./spawn-snapshot-handoff.js";

export const AGENT_INVOCATION_SHADOW_ENV = "OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW";

export function isAgentInvocationShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[AGENT_INVOCATION_SHADOW_ENV]);
}

/** Records one shadow envelope. Never throws and never changes the caller result. */
export async function recordAgentInvocationShadow(params: {
  client: GatewayClient | null;
  agentId: string;
  cfg?: OpenBotConfig;
  runId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = params.env ?? process.env;
  if (!isAgentInvocationShadowEnabled(env)) {
    return;
  }
  try {
    const decision = await evaluateAgentInvocation({
      client: params.client,
      agentId: params.agentId,
      cfg: params.cfg,
    });
    // Attribution the envelope cannot infer. The evaluator resolves a QueryScope
    // internally but discards it, and that scope is lossy anyway: the employee
    // domain yields `{ self, ownerId }` with no tenant. `resolveTrustedAttribution`
    // returns both halves, membership-derived, so it is resolved here instead.
    // This is a second identity resolve on a flag-gated, fire-and-forget path; it
    // keeps the change inside the governance module rather than reshaping a
    // signature shared with `authorizeAgentInvocation`.
    //
    // Caught separately on purpose: the decision row is the evidence, attribution
    // is an attribute of it. An unreadable platform-auth store must cost us the
    // tenant/actor fields, not the whole row.
    let tenantId: string | undefined;
    let actorId: string | undefined;
    try {
      const attribution = await resolveTrustedAttribution(params.client);
      tenantId = attribution.tenantId?.trim() || undefined;
      // Same `platform-user:<id>` shape the agent-command and E10 writers stamp.
      actorId = actorIdFromIdentity({ platformUserId: attribution.ownerId });
    } catch (error) {
      console.warn(`[governance] agent invocation attribution unresolved: ${String(error)}`);
    }
    const envelope = adaptAgentInvocationDecision({
      decision: {
        allowed: decision.allowed,
        ...(!decision.allowed ? { reason: decision.reason } : {}),
        agentId: params.agentId,
        ...(params.runId ? { runId: params.runId } : {}),
        ...(tenantId ? { tenantId } : {}),
        ...(actorId ? { actorId } : {}),
      },
      ts: new Date().toISOString(),
    });
    await appendGovernanceShadowDecision(envelope, { env });
  } catch (error) {
    console.warn(`[governance] agent invocation shadow failed: ${String(error)}`);
  }
}

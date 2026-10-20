/**
 * node.invoke scope shadow (plan v1.0 PR-3 / E9 / PR-P2-2).
 *
 * `OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW` defaults off. It does not read the
 * node.invoke preflight observe switch. The shadow calls the existing ownership
 * check with audit disabled, maps through `NodeGovernanceAdapter`, and writes
 * one envelope. It never changes the invoke result and never calls
 * `auditManagementDecision`.
 */

import { isTruthyEnvValue } from "../../infra/env.js";
import { authorizeNodeGovernance } from "../node-governance.js";
import type { GatewayClient } from "../server-methods/types.js";
import { adaptNodeGovernanceDecision } from "./adapters/node-governance-adapter.js";
import { appendGovernanceShadowDecision } from "./shadow-sink.js";

export const NODE_INVOKE_SHADOW_ENV = "OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW";

export function isNodeInvokeShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[NODE_INVOKE_SHADOW_ENV]);
}

export async function recordNodeInvokeShadow(params: {
  client: GatewayClient | null;
  nodeId: string;
  command: string;
  requestId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = params.env ?? process.env;
  if (!isNodeInvokeShadowEnabled(env)) {
    return;
  }
  try {
    const governance = await authorizeNodeGovernance({
      client: params.client,
      nodeId: params.nodeId,
      action: "invoke",
      audit: false,
    });
    const envelope = adaptNodeGovernanceDecision({
      decision: {
        entry: "E9",
        allowed: governance.allowed,
        ...(governance.reason ? { reason: governance.reason } : {}),
        nodeId: params.nodeId,
        command: params.command,
        ...(params.requestId ? { requestId: params.requestId } : {}),
        ...(governance.ownership.tenantId ? { tenantId: governance.ownership.tenantId } : {}),
        ...(governance.ownership.ownerId ? { ownerId: governance.ownership.ownerId } : {}),
      },
      ts: new Date().toISOString(),
    });
    await appendGovernanceShadowDecision(envelope, { env });
  } catch (error) {
    console.warn(`[governance] node.invoke shadow failed: ${String(error)}`);
  }
}

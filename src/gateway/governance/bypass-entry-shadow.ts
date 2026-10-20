/**
 * Shadow envelopes for capability-inventory BYPASS entries.
 *
 * Uses the existing shadow sink and the existing per-entry switches.
 * Default remains off. Nothing here hard-denies the caller.
 */
import { isTruthyEnvValue } from "../../infra/env.js";
import { CAPABILITY_INVOKE_SHADOW_ENV } from "./adapters/capability-invoke-adapter.js";
import { newGovernanceDecisionId } from "./decision-id.js";
import { createGovernanceDecision, type GovernanceDecision } from "./decision.js";
import { NODE_INVOKE_SHADOW_ENV } from "./node-invoke-shadow.js";
import { appendGovernanceShadowDecision, GOVERNANCE_SHADOW_LOG_ENV } from "./shadow-sink.js";
import {
  EXISTING_GOVERNANCE_SHADOW_SWITCHES,
  openExistingGovernanceShadowSwitches,
} from "./shadow-switch-names.js";

export { EXISTING_GOVERNANCE_SHADOW_SWITCHES, openExistingGovernanceShadowSwitches };

export const BYPASS_SHADOW_ENTRIES = [
  "MCP",
  "browser.request",
  "node.invoke",
  "inter-agent-identity",
] as const;

export type BypassShadowEntry = (typeof BYPASS_SHADOW_ENTRIES)[number];

const ENTRY_SWITCH: Record<BypassShadowEntry, string> = {
  MCP: CAPABILITY_INVOKE_SHADOW_ENV,
  "browser.request": GOVERNANCE_SHADOW_LOG_ENV,
  "node.invoke": NODE_INVOKE_SHADOW_ENV,
  "inter-agent-identity": GOVERNANCE_SHADOW_LOG_ENV,
};

export function isBypassEntryShadowEnabled(
  entry: BypassShadowEntry,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isTruthyEnvValue(env[ENTRY_SWITCH[entry]]) || isTruthyEnvValue(env[GOVERNANCE_SHADOW_LOG_ENV])
  );
}

/**
 * Record a shadow decision for a BYPASS entry. Returns undefined when the
 * existing switch is off. Never throws and never changes the caller's result.
 */
export async function recordBypassEntryShadow(params: {
  entry: BypassShadowEntry;
  reason: string;
  requestId?: string;
  runId?: string;
  tenantId?: string;
  userId?: string;
  executionId?: string;
  dataSpaceRef?: string;
  browserNamespaceRef?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<GovernanceDecision | undefined> {
  const env = params.env ?? process.env;
  if (!isBypassEntryShadowEnabled(params.entry, env)) {
    return undefined;
  }
  try {
    const decision = createGovernanceDecision({
      decisionId: newGovernanceDecisionId(),
      source: params.entry === "node.invoke" ? "node" : "capability",
      entry: params.entry,
      mode: "shadow",
      effect: "skipped",
      reason: params.reason,
      ...(params.requestId ? { requestId: params.requestId } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.executionId ? { executionId: params.executionId } : {}),
      runtimeLeaseId: "",
      ...(params.dataSpaceRef ? { dataSpaceRef: params.dataSpaceRef } : {}),
      ...(params.browserNamespaceRef ? { browserNamespaceRef: params.browserNamespaceRef } : {}),
      ts: new Date().toISOString(),
    });
    const writeEnv = isTruthyEnvValue(env[GOVERNANCE_SHADOW_LOG_ENV])
      ? env
      : { ...env, [GOVERNANCE_SHADOW_LOG_ENV]: "1" };
    await appendGovernanceShadowDecision(decision, { env: writeEnv });
    return decision;
  } catch {
    return undefined;
  }
}

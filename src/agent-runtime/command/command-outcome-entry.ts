import type { OpenBotConfig } from "../../config/config.js";
import {
  ensureCliTurnTaskOutcome,
  ensureGatewayAgentTurnTaskOutcome,
  ensureSubagentTurnTaskOutcome,
} from "../../task-outcome/entrypoint-ensure.js";
import type { Entrypoint, TrustedScope } from "../../task-outcome/types.js";
/** Command execution attribution; ordinary dialogue never invokes this transaction. */
export function openCommandOutcomeEntry(input: {
  config: OpenBotConfig;
  agentId: string;
  runId: string;
  isSubagentLane: boolean;
  governanceEntry?: string;
  platformUserId?: string | null;
  gatewayUser?: string;
  sessionTenantId?: string | null;
  executionEnterpriseId?: string;
  parentTaskId?: string;
}): { entrypoint: Entrypoint; taskId?: string; scope?: TrustedScope } {
  const entrypoint = input.isSubagentLane
    ? "subagent"
    : input.governanceEntry === "E2"
      ? "gateway_agent"
      : "cli";
  const subjectRaw = (
    input.platformUserId ??
    input.gatewayUser ??
    (entrypoint === "cli" ? "cli-operator" : "gateway-agent")
  )
    .toString()
    .trim();
  const subjectRef =
    subjectRaw.startsWith("platform-user:") || subjectRaw.includes(":")
      ? subjectRaw
      : `subject:${subjectRaw}`;
  const tenantId =
    input.sessionTenantId?.trim() || input.executionEnterpriseId?.trim() || undefined;
  const identity = {
    agentId: input.agentId,
    runId: input.runId,
    subjectRef,
    ...(tenantId ? { tenantId } : {}),
  };
  const opened =
    entrypoint === "subagent"
      ? ensureSubagentTurnTaskOutcome(input.config, {
          ...identity,
          ...(input.parentTaskId?.trim() ? { parentTaskId: input.parentTaskId.trim() } : {}),
        })
      : entrypoint === "cli"
        ? ensureCliTurnTaskOutcome(input.config, identity)
        : ensureGatewayAgentTurnTaskOutcome(input.config, identity);
  return opened.ok ? { entrypoint, taskId: opened.taskId, scope: opened.scope } : { entrypoint };
}

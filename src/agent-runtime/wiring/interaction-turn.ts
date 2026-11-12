import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { ExecutionIdentityRunFields } from "../../gateway/execution-identity-context.js";
import { runGovernedInteraction, runGovernedUnderstanding } from "../command/index.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import { sessionTaskState } from "../state/index.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
import { bindInteractionCandidate } from "./interaction-candidate.js";

/** Fixed bindings only; command owns policy sequencing. */
type GatewayInteractionParams = {
  config: OpenBotConfig;
  runId: string;
  agentId: string;
  agentDir: string;
  sessionKey?: string;
  sessionFile: string;
  requestId: string;
  input: InteractionModelInput;
  captured: { expectedFocusRevision: number; expectedWriteEpoch: number; expectedTaskId?: string };
  identity: ExecutionIdentityRunFields;
  authorized: boolean;
  provider: string;
  model: string;
  authProfileId?: string;
  timeoutMs: number;
};
function bindGatewayUnderstanding(
  params: Omit<GatewayInteractionParams, "sessionFile" | "captured" | "authorized">,
) {
  const host = bindAdmittedTurnHost();
  return {
    modelSession: host,
    model: host.model,
    resolveFallbacks: resolveRunModelFallbacksOverride,
    candidate: async (provider: string, model: string) =>
      bindInteractionCandidate({
        config: params.config,
        agentId: params.agentId,
        agentDir: params.agentDir,
        identity: params.identity,
        primaryProvider: params.provider,
        authProfileId: params.authProfileId,
        signal: params.input.abortSignal,
      })(provider, model),
  };
}

export function runGatewayInteraction(params: GatewayInteractionParams) {
  return runGovernedInteraction(params, {
    ...bindGatewayUnderstanding(params),
    commit: sessionTaskState.admitExecution,
  });
}

/** Shared governed understanding without binding a group's work to a personal task board. */
export function runGatewayUnderstanding(
  params: Omit<GatewayInteractionParams, "sessionFile" | "captured" | "authorized">,
) {
  return runGovernedUnderstanding(params, bindGatewayUnderstanding(params));
}

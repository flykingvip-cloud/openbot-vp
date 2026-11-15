import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { ExecutionIdentityRunFields } from "../../gateway/execution-identity-context.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  runGovernedInteraction,
  runGovernedUnderstanding,
  type GovernedInteractionWithShadow,
  type GovernedShadowHostInjection,
} from "../command/index.js";
import { runOfficialShadowRuleAdaptation } from "../command/rule-adaptation/index.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import { createHostShadowCompletion } from "../model/rule-adaptation/index.js";
import { listRuntimeRuleDeclarations, CONTEXT_WINDOW_HARD_MIN_TOKENS } from "../policy/index.js";
import { sessionTaskState } from "../state/index.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
import { bindInteractionCandidate } from "./interaction-candidate.js";

/** Fixed bindings only; command owns policy sequencing. */
export type GatewayInteractionParams = {
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

export function runGatewayInteraction(
  params: GatewayInteractionParams,
  shadowHost: GovernedShadowHostInjection,
): Promise<GovernedInteractionWithShadow>;
export function runGatewayInteraction(
  params: GatewayInteractionParams,
): ReturnType<typeof runGovernedInteraction>;
/** Trusted host may pass official shadow injection; omitted or trigger !== true stays default-off. */
export async function runGatewayInteraction(
  params: GatewayInteractionParams,
  shadowHost?: GovernedShadowHostInjection,
) {
  const ports = {
    ...bindGatewayUnderstanding(params),
    commit: sessionTaskState.admitExecution,
  };
  if (shadowHost?.trigger === true) {
    return runGovernedInteraction(params, ports, shadowHost);
  }
  const interaction = await runGovernedInteraction(params, ports);
  await recordNormalTaskRuleAdvice(params, interaction);
  return interaction;
}

/** Shared governed understanding without binding a group's work to a personal task board. */
export function runGatewayUnderstanding(
  params: Omit<GatewayInteractionParams, "sessionFile" | "captured" | "authorized">,
) {
  return runGovernedUnderstanding(params, bindGatewayUnderstanding(params));
}

const ruleAdviceLog = createSubsystemLogger("agent-runtime/rule-adaptation");

/** Advice on an accepted personal task only; never changes the admission or its policy. */
export async function recordNormalTaskRuleAdvice(
  params: GatewayInteractionParams,
  interaction: import("../command/index.js").GovernedInteractionResult,
  runShadow = runOfficialShadowRuleAdaptation,
) {
  if (interaction.kind !== "execution_admission" || interaction.result.kind !== "accepted") {
    return;
  }
  if (params.identity.executionIdentity?.collaborationGroupId) {
    return;
  }
  const binding = interaction.result.binding;
  const ruleRunId = `${params.runId}:rule-adaptation`;
  const correlation = {
    runId: params.runId,
    ruleRunId,
    requestId: params.requestId,
    taskId: binding.taskId,
  };
  try {
    params.input.abortSignal?.throwIfAborted();
    if (!sessionTaskState.bindingCurrent(params.sessionFile, binding)) {
      ruleAdviceLog.info(
        JSON.stringify({ ...correlation, phase: "skipped", reason: "stale_binding" }),
      );
      return;
    }
    const host = bindAdmittedTurnHost();
    const resolveCandidate = bindInteractionCandidate({
      config: params.config,
      agentId: params.agentId,
      agentDir: params.agentDir,
      identity: params.identity,
      primaryProvider: params.provider,
      authProfileId: params.authProfileId,
      signal: params.input.abortSignal,
    });
    const candidate = await resolveCandidate(params.provider, params.model);
    const modelWindow = candidate.model.contextWindow;
    const cap = params.config.agents?.defaults?.contextTokens;
    const current = typeof cap === "number" && cap > 0 ? Math.min(cap, modelWindow) : modelWindow;
    if (!Number.isFinite(current) || current <= 0) {
      throw new Error("effective_window_unavailable");
    }
    const rule = listRuntimeRuleDeclarations().find(
      (entry) => entry.id === "model.context_window.guard",
    );
    if (!rule) {
      throw new Error("rule_catalog_unavailable");
    }
    ruleAdviceLog.info(JSON.stringify({ ...correlation, phase: "started", ruleId: rule.id }));
    const result = await runShadow(
      {
        requestId: `${params.requestId}:rule-adaptation`,
        situation: {
          summary: params.input.message,
          scope: { type: "personal", id: binding.taskId },
          knownFacts: {
            taskId: binding.taskId,
            currentEffectiveValue: current,
            hardMin: CONTEXT_WINDOW_HARD_MIN_TOKENS,
          },
        },
        budget: { maxDurationMs: 5000, maxModelCalls: 3, maxRevisions: 0, maxOutputTokens: 1024 },
        signal: params.input.abortSignal,
      },
      {
        view: {
          rules: [
            {
              id: rule.id,
              category: rule.category,
              scope: "personal",
              version: rule.version,
              summary: rule.configuration,
              fieldHints: ["agents.defaults.contextTokens"],
            },
          ],
          effectivePolicy: [
            {
              field: "agents.defaults.contextTokens",
              currentEffectiveValue: current,
              source: "resolved_model_window",
            },
          ],
          hostFacts: { currentEffectiveValues: { "agents.defaults.contextTokens": current } },
          ruleViewVersion: rule.version,
        },
        model: {
          runId: ruleRunId,
          sessionPorts: host,
          config: params.config,
          provider: params.provider,
          model: params.model,
          complete: createHostShadowCompletion(resolveCandidate),
          authorizeInput: {
            agentId: params.agentId,
            modelGateInput: {
              cfg: params.config,
              agentId: params.agentId,
              gatewayClientUser: params.identity.gatewayClientUser ?? undefined,
              gatewayClientSessionDomain: params.identity.gatewayClientSessionDomain ?? undefined,
              enterpriseIdHint: params.identity.executionIdentity?.enterpriseId,
              taskText: "rule-adaptation-shadow",
            },
          },
        },
      },
    );
    ruleAdviceLog.info(
      JSON.stringify({
        ...correlation,
        phase: "returned",
        outcomeCode: result.outcomeCode,
        validationKind: result.validation?.resultKind,
        activationAllowed: result.activationAllowed,
        controlUnchanged: result.controlUnchanged,
        modelCalls: result.usage.modelCalls,
      }),
    );
  } catch {
    // No user text, credentials or proposal content in operational logs.
    ruleAdviceLog.info(
      JSON.stringify({
        ...correlation,
        phase: "unavailable",
        reason: "shadow_host_unavailable",
        activationAllowed: false,
      }),
    );
  }
}

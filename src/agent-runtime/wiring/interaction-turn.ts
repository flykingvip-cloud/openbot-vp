import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
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
import { resolveContextWindowInfo } from "../policy/index.js";
import { listRuntimeRuleDeclarations, CONTEXT_WINDOW_HARD_MIN_TOKENS } from "../policy/index.js";
import { validateExecutionRuleProposal } from "../policy/rule-adaptation/index.js";
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
  // Rule decisions belong to execution preparation; do not run a second shadow call here.
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
  if (
    interaction.kind !== "execution_admission" ||
    (interaction.result.kind !== "accepted" && interaction.result.kind !== "accepted_turn")
  ) {
    return;
  }
  if (params.identity.executionIdentity?.collaborationGroupId) {
    return;
  }
  const binding = interaction.result.kind === "accepted" ? interaction.result.binding : undefined;
  const turn =
    interaction.result.kind === "accepted_turn" ? interaction.result.admission : undefined;
  const scopeId = binding?.taskId ?? `turn:${params.requestId}`;
  const ruleRunId = `${params.runId}:rule-adaptation`;
  const correlation = {
    runId: params.runId,
    ruleRunId,
    requestId: params.requestId,
    taskId: binding?.taskId ?? null,
    turnId: turn?.requestId ?? null,
  };
  try {
    if (!params.authorized) {
      return;
    }
    params.input.abortSignal?.throwIfAborted();
    if (
      binding
        ? !sessionTaskState.bindingCurrent(params.sessionFile, binding)
        : !turn || !sessionTaskState.turnAdmissionCurrent(params.sessionFile, turn)
    ) {
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
    const current = resolveContextWindowInfo({
      cfg: params.config,
      provider: params.provider,
      modelId: params.model,
      modelContextWindow: modelWindow,
      defaultTokens: DEFAULT_CONTEXT_TOKENS,
    }).tokens;
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
          scope: { type: "personal", id: scopeId },
          knownFacts: {
            taskId: binding?.taskId ?? null,
            turnId: turn?.requestId ?? null,
            currentEffectiveValue: current,
            hardMin: CONTEXT_WINDOW_HARD_MIN_TOKENS,
          },
        },
        budget: {
          maxDurationMs: Math.min(params.timeoutMs, 45_000),
          maxModelCalls: 3,
          maxRevisions: 0,
          maxOutputTokens: 1024,
        },
        signal: params.input.abortSignal,
      },
      {
        validate: (proposal) =>
          validateExecutionRuleProposal(proposal, {
            mode: "dynamic",
            authorized: params.authorized,
            scope: { type: "personal", id: scopeId },
            proposalScope: { type: "personal", id: scopeId },
            bindingCurrent: binding
              ? sessionTaskState.bindingCurrent(params.sessionFile, binding)
              : Boolean(turn && sessionTaskState.turnAdmissionCurrent(params.sessionFile, turn)),
            cancelled: params.input.abortSignal?.aborted ?? false,
            ruleId: "model.context_window.guard",
            field: "agents.defaults.contextTokens",
            action: "tune",
            currentValue: current,
            proposedValue: current,
          }),
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
    return { result, currentTokens: current, ruleVersion: rule.version };
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

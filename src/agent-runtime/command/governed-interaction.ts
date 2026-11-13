import type { OpenBotConfig } from "../../config/config.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import {
  createAuthorizedModelSession,
  type ModelSessionPorts,
  type InteractionPreparationPorts,
} from "../model/index.js";
import { runAuthorizedInteraction, runAuthorizedUnderstanding } from "./authorized-interaction.js";
import { bindExecutionAdmissionPorts } from "./execution-admission.js";
import {
  DEFAULT_SHADOW_BUDGET_LIMITS,
  emptyControlSnapshot,
  runOfficialShadowRuleAdaptation,
  type OfficialShadowHostBinding,
  type ShadowRunRequest,
  type ShadowRunResult,
} from "./rule-adaptation/index.js";
import { buildShadowResult, reason } from "./rule-adaptation/result.js";

type ModelSession = ReturnType<typeof createAuthorizedModelSession>;
type GateInput = NonNullable<Parameters<ModelSession["authorize"]>[0]["modelGateInput"]>;
export type GovernedInteractionInput = {
  config: OpenBotConfig;
  runId: string;
  agentId: string;
  agentDir: string;
  sessionKey?: string;
  sessionFile: string;
  requestId: string;
  input: InteractionModelInput;
  captured: { expectedFocusRevision: number; expectedWriteEpoch: number; expectedTaskId?: string };
  identity: {
    gatewayClientUser?: string | null;
    gatewayClientSessionDomain?: GateInput["gatewayClientSessionDomain"] | null;
    gatewayClientPlatformUserId?: string | null;
    executionIdentity?: {
      enterpriseId?: string;
      collaborationGroupId?: string;
      collaborationOwnerEntitlement?: GateInput["collaborationGroupOwnerEntitlement"];
    } | null;
  };
  authorized: boolean;
  provider: string;
  model: string;
  timeoutMs: number;
};
export type GovernedInteractionPorts = {
  modelSession: ModelSessionPorts;
  model: InteractionPreparationPorts;
  resolveFallbacks: (input: {
    cfg: OpenBotConfig;
    agentId: string;
    sessionKey?: string;
  }) => string[] | undefined;
  candidate: Parameters<typeof runAuthorizedInteraction>[1]["candidate"];
  commit: Parameters<typeof bindExecutionAdmissionPorts>[0]["commit"];
};

export type GovernedUnderstandingInput = Omit<
  GovernedInteractionInput,
  "sessionFile" | "captured" | "authorized"
>;
export type GovernedUnderstandingPorts = Omit<GovernedInteractionPorts, "commit">;

/** Fixed preparation and governance shared by both scene adapters. */
function bindGovernedUnderstanding(
  params: GovernedUnderstandingInput,
  ports: GovernedUnderstandingPorts,
) {
  const session = createAuthorizedModelSession(`${params.runId}:interaction`, ports.modelSession);
  return {
    prepared: {
      input: params.input,
      config: params.config,
      provider: params.provider,
      model: params.model,
      agentId: params.agentId,
      agentDir: params.agentDir,
      creditUserId: params.identity.gatewayClientPlatformUserId ?? undefined,
      timeoutMs: params.timeoutMs,
      maxTokens: 2048,
      fallbacksOverride: ports.resolveFallbacks({
        cfg: params.config,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
      }),
    },
    bound: {
      session,
      authorization: {
        agentId: params.agentId,
        ...(params.identity.executionIdentity?.collaborationGroupId
          ? { groupId: params.identity.executionIdentity.collaborationGroupId }
          : {}),
        modelGateInput: {
          cfg: params.config,
          agentId: params.agentId,
          gatewayClientUser: params.identity.gatewayClientUser ?? undefined,
          gatewayClientSessionDomain: params.identity.gatewayClientSessionDomain ?? undefined,
          enterpriseIdHint: params.identity.executionIdentity?.enterpriseId,
          ...(params.identity.executionIdentity?.collaborationOwnerEntitlement
            ? {
                collaborationGroupOwnerEntitlement:
                  params.identity.executionIdentity.collaborationOwnerEntitlement,
              }
            : {}),
          taskText: params.input.message,
          contextParts: ports.model.buildRunContextEstimateParts({
            taskText: params.input.message,
            extraSystemPrompt: params.input.context.map((part) => part.content).join("\n\n"),
            toolsKnown: true,
            toolsText: "",
            attachmentsKnown: true,
            attachmentsText: params.input.images?.length
              ? "x".repeat(params.input.images.length * 8000)
              : "",
            outputReserveTokens: 2048,
          }).contextParts,
        },
      },
      prepare: (active: ModelSession) => {
        const gate = active.gate;
        const routing = ports.model.resolveExecutionRoutingFromCapabilityPlan({
          allowlist: gate?.allowlist,
          preferredModelOrder: gate?.preferredModelOrder,
          capabilityPlan: gate?.capabilityPlan,
        });
        active.prepareModelSet({
          config: params.config,
          routing,
          actorId: params.identity.gatewayClientPlatformUserId
            ? `platform-user:${params.identity.gatewayClientPlatformUserId}`
            : undefined,
        });
      },
      candidate: ports.candidate,
    },
  };
}

/** One governed interpretation, no personal board or execution side effects. */
export function runGovernedUnderstanding(
  params: GovernedUnderstandingInput,
  ports: GovernedUnderstandingPorts,
) {
  const { prepared, bound } = bindGovernedUnderstanding(params, ports);
  return runAuthorizedUnderstanding(prepared, bound);
}

/**
 * Optional, default-off host injection for the official advice-only shadow entry.
 * `trigger` must be exactly true to start an additional governed shadow call.
 * Rule view and trusted facts come from the host binding; this hook does not
 * invent a catalog, change admission, write the task board, or activate policy.
 */
export type GovernedShadowHostInjection = {
  trigger: boolean;
  request: ShadowRunRequest;
  binding: OfficialShadowHostBinding;
};

export type GovernedInteractionResult = Awaited<ReturnType<typeof runAuthorizedInteraction>>;

export type GovernedInteractionWithShadow = {
  interaction: GovernedInteractionResult;
  shadow: ShadowRunResult;
};

function isolatedHostShadowResult(
  outcomeCode: "cancelled" | "protocol_failure",
  message: string,
): ShadowRunResult {
  const control = emptyControlSnapshot();
  const cancelled = outcomeCode === "cancelled";
  return buildShadowResult({
    outcomeCode,
    reasons: [reason(outcomeCode, message, "governed-interaction.shadow")],
    usage: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      revisions: 0,
      durationMs: 0,
      cost: 0,
      cancelled,
      ...(cancelled ? { cancelReason: "signal_aborted_before_start" } : {}),
    },
    limits: { ...DEFAULT_SHADOW_BUDGET_LIMITS },
    exhausted: [],
    preEnforcedExhausted: [],
    postAccountedExhausted: [],
    deadlineCleanupFailed: false,
    sessionDisposeFailed: false,
    usageKnown: true,
    underlyingRequestStopped: true,
    usageAccountingAttempted: false,
    usageAccountingStatus: "not_attempted",
    governanceOccupancyReady: false,
    controlBefore: control,
    controlAfter: control,
    controlUnchanged: true,
    toolsInvoked: [],
    rejectedTools: [],
    businessAttempts: [],
    candidateToolInvoked: false,
    diagnosedBeforeRetrieval: false,
  });
}

async function attachOfficialShadowAdvice(
  interactionPromise: Promise<GovernedInteractionResult>,
  shadowHost: GovernedShadowHostInjection,
): Promise<GovernedInteractionWithShadow> {
  const interaction = await interactionPromise;
  // Run the original interaction first and independently. After cancel, do not
  // start a new shadow call. Shadow failures stay in the shadow result.
  if (shadowHost.request.signal?.aborted) {
    return {
      interaction,
      shadow: isolatedHostShadowResult(
        "cancelled",
        "Cancelled before the shadow host call started. No additional model call was started.",
      ),
    };
  }
  try {
    const shadow = await runOfficialShadowRuleAdaptation(shadowHost.request, shadowHost.binding);
    return { interaction, shadow };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      interaction,
      shadow: isolatedHostShadowResult(
        "protocol_failure",
        `Shadow host isolation: official shadow entry failed; original interaction is unchanged. ${detail}`,
      ),
    };
  }
}

function bindGovernedAdmission(params: GovernedInteractionInput, ports: GovernedInteractionPorts) {
  const { prepared, bound } = bindGovernedUnderstanding(params, ports);
  return runAuthorizedInteraction(prepared, {
    ...bound,
    admission: {
      captured: { requestId: params.requestId, ...params.captured },
      ports: bindExecutionAdmissionPorts({
        sessionFile: params.sessionFile,
        authorize: async () => params.authorized && !params.input.abortSignal?.aborted,
        commit: ports.commit,
      }),
    },
  });
}

/** Command owns interaction admission and model-policy sequencing. */
export function runGovernedInteraction(
  params: GovernedInteractionInput,
  ports: GovernedInteractionPorts,
): ReturnType<typeof runAuthorizedInteraction>;
export function runGovernedInteraction(
  params: GovernedInteractionInput,
  ports: GovernedInteractionPorts,
  shadowHost: GovernedShadowHostInjection,
): Promise<GovernedInteractionWithShadow>;
export function runGovernedInteraction(
  params: GovernedInteractionInput,
  ports: GovernedInteractionPorts,
  shadowHost?: GovernedShadowHostInjection,
) {
  const interaction = bindGovernedAdmission(params, ports);
  if (shadowHost?.trigger !== true) {
    return interaction;
  }
  return attachOfficialShadowAdvice(interaction, shadowHost);
}

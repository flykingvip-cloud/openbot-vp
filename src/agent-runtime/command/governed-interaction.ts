import type { OpenBotConfig } from "../../config/config.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import {
  createAuthorizedModelSession,
  type ModelSessionPorts,
  type InteractionPreparationPorts,
} from "../model/index.js";
import { runAuthorizedInteraction, runAuthorizedUnderstanding } from "./authorized-interaction.js";
import { bindExecutionAdmissionPorts } from "./execution-admission.js";

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

/** Command owns interaction admission and model-policy sequencing. */
export function runGovernedInteraction(
  params: GovernedInteractionInput,
  ports: GovernedInteractionPorts,
) {
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

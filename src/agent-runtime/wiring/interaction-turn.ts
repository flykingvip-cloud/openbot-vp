import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { ExecutionIdentityRunFields } from "../../gateway/execution-identity-context.js";
import { runAuthorizedInteraction } from "../command/index.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import { createAuthorizedModelSession } from "../model/index.js";
import { sessionTaskState } from "../state/index.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
import { bindInteractionCandidate } from "./interaction-candidate.js";

/** Bind existing model governance and the sole task repository to command admission. */
export function runGatewayInteraction(params: {
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
}) {
  const host = bindAdmittedTurnHost();
  const session = createAuthorizedModelSession(`${params.runId}:interaction`, host);
  return runAuthorizedInteraction(
    {
      input: params.input,
      config: params.config,
      provider: params.provider,
      model: params.model,
      agentId: params.agentId,
      agentDir: params.agentDir,
      creditUserId: params.identity.gatewayClientPlatformUserId ?? undefined,
      timeoutMs: params.timeoutMs,
      maxTokens: 2048,
      fallbacksOverride: resolveRunModelFallbacksOverride({
        cfg: params.config,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
      }),
    },
    {
      session,
      authorization: {
        agentId: params.agentId,
        modelGateInput: {
          cfg: params.config,
          agentId: params.agentId,
          gatewayClientUser: params.identity.gatewayClientUser ?? undefined,
          gatewayClientSessionDomain: params.identity.gatewayClientSessionDomain ?? undefined,
          enterpriseIdHint: params.identity.executionIdentity?.enterpriseId,
          taskText: params.input.message,
          contextParts: host.model.buildRunContextEstimateParts({
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
      prepare: (active) => {
        const gate = active.gate;
        const routing = host.model.resolveExecutionRoutingFromCapabilityPlan({
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
      candidate: async (provider, model) =>
        bindInteractionCandidate({
          config: params.config,
          agentId: params.agentId,
          agentDir: params.agentDir,
          identity: params.identity,
          primaryProvider: params.provider,
          authProfileId: params.authProfileId,
          signal: params.input.abortSignal,
        })(provider, model),
      admission: {
        captured: { requestId: params.requestId, ...params.captured },
        ports: {
          authorize: async () => params.authorized && !params.input.abortSignal?.aborted,
          commit: (request) => {
            const result = sessionTaskState.admitExecution({
              sessionFile: params.sessionFile,
              requestId: request.requestId,
              goal: request.proposal.goal,
              acceptance: request.proposal.acceptance,
              expectedFocusRevision: request.expectedFocusRevision,
              expectedWriteEpoch: request.expectedWriteEpoch,
              expectedTaskId: request.expectedTaskId,
            });
            return result.kind === "accepted"
              ? { ...result, acceptance: request.proposal.acceptance }
              : result;
          },
        },
      },
    },
  );
}

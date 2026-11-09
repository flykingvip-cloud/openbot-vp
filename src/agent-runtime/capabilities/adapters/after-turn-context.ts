import type { CompactEmbeddedPiSessionParams } from "../../../agents/pi-embedded-runner/compact.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";

/** Build runtime context passed into context-engine afterTurn hooks. */
export function buildAfterTurnRuntimeContext(params: {
  attempt: Pick<
    EmbeddedRunAttemptParams,
    | "sessionKey"
    | "messageChannel"
    | "messageProvider"
    | "agentAccountId"
    | "config"
    | "skillsSnapshot"
    | "senderIsOwner"
    | "provider"
    | "modelId"
    | "thinkLevel"
    | "reasoningLevel"
    | "bashElevated"
    | "extraSystemPrompt"
    | "ownerNumbers"
    | "authProfileId"
    | "inboundToolCeiling"
    | "skillPolicy"
    | "executionIdentity"
    | "gatewayClientUser"
    | "gatewayClientSessionDomain"
    | "gatewayClientPlatformUserId"
    | "gatewayClientSessionEnterpriseId"
    | "gatewayClientSessionMembershipId"
  >;
  workspaceDir: string;
  agentDir: string;
}): Partial<CompactEmbeddedPiSessionParams> {
  return {
    sessionKey: params.attempt.sessionKey,
    messageChannel: params.attempt.messageChannel,
    messageProvider: params.attempt.messageProvider,
    agentAccountId: params.attempt.agentAccountId,
    authProfileId: params.attempt.authProfileId,
    workspaceDir: params.workspaceDir,
    agentDir: params.agentDir,
    config: params.attempt.config,
    skillsSnapshot: params.attempt.skillsSnapshot,
    senderIsOwner: params.attempt.senderIsOwner,
    provider: params.attempt.provider,
    model: params.attempt.modelId,
    thinkLevel: params.attempt.thinkLevel,
    reasoningLevel: params.attempt.reasoningLevel,
    bashElevated: params.attempt.bashElevated,
    extraSystemPrompt: params.attempt.extraSystemPrompt,
    ownerNumbers: params.attempt.ownerNumbers,
    inboundToolCeiling: params.attempt.inboundToolCeiling,
    skillPolicy: params.attempt.skillPolicy,
    ...inheritExecutionIdentityRunFields(params.attempt),
  };
}

/** Legacy embedded invocation parameter projection. No admission, fallback or runner invocation.
 * Input remains the existing internal run contract during migration; not a plugin/SDK request schema.
 */
import type { FollowupRun } from "../../../auto-reply/reply/queue.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import { isReasoningTagProvider } from "../../../utils/provider-utils.js";

export const resolveEnforceFinalTag = (run: FollowupRun["run"], provider: string) =>
  Boolean(run.enforceFinalTag || isReasoningTagProvider(provider));

export function buildEmbeddedRunBaseParams(params: {
  run: FollowupRun["run"];
  provider: string;
  model: string;
  runId: string;
  authProfile: ReturnType<typeof resolveProviderScopedAuthProfile>;
  allowTransientCooldownProbe?: boolean;
}) {
  return {
    sessionFile: params.run.sessionFile,
    workspaceDir: params.run.workspaceDir,
    agentDir: params.run.agentDir,
    config: params.run.config,
    skillsSnapshot: params.run.skillsSnapshot,
    ownerNumbers: params.run.ownerNumbers,
    inputProvenance: params.run.inputProvenance,
    senderIsOwner: params.run.senderIsOwner,
    enforceFinalTag: resolveEnforceFinalTag(params.run, params.provider),
    provider: params.provider,
    model: params.model,
    ...params.authProfile,
    thinkLevel: params.run.thinkLevel,
    verboseLevel: params.run.verboseLevel,
    reasoningLevel: params.run.reasoningLevel,
    execOverrides: params.run.execOverrides,
    bashElevated: params.run.bashElevated,
    timeoutMs: params.run.timeoutMs,
    runId: params.runId,
    allowTransientCooldownProbe: params.allowTransientCooldownProbe,
    ...(params.run.disableTools ? { disableTools: true } : {}),
    ...(params.run.skillPolicy ? { skillPolicy: params.run.skillPolicy } : {}),
    ...(params.run.inboundToolCeiling ? { inboundToolCeiling: params.run.inboundToolCeiling } : {}),
    ...(params.run.contextLane ? { contextLane: params.run.contextLane } : {}),
    ...(params.run.sessionEntry ? { sessionEntry: params.run.sessionEntry } : {}),
    ...(params.run.oguiDecisionRun ? { oguiDecisionRun: params.run.oguiDecisionRun } : {}),
    ...(params.run.knowledgeConsumeRefs?.length
      ? { knowledgeConsumeRefs: params.run.knowledgeConsumeRefs }
      : {}),
    ...(params.run.mentionedPluginToolAllowlist?.length
      ? { mentionedPluginToolAllowlist: params.run.mentionedPluginToolAllowlist }
      : {}),
    // Collaboration rounds set these on followupRun.run; without forwarding them,
    // SessionManager re-persists the shared GROUP_PUBLIC user turn (live dual-write).
    ...(params.run.skipUserTranscriptPersist === true ? { skipUserTranscriptPersist: true } : {}),
    ...(params.run.collaborationRoundInvoked === true ? { collaborationRoundInvoked: true } : {}),
    ...(params.run.deliveryToolSideEffect
      ? { deliveryToolSideEffect: params.run.deliveryToolSideEffect }
      : {}),
    ...(params.run.privateRunBag ? { privateRunBag: params.run.privateRunBag } : {}),
    ...inheritExecutionIdentityRunFields(params.run),
  };
}

export function resolveProviderScopedAuthProfile(params: {
  provider: string;
  primaryProvider: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
}): { authProfileId?: string; authProfileIdSource?: "auto" | "user" } {
  const authProfileId =
    params.provider === params.primaryProvider ? params.authProfileId : undefined;
  return {
    authProfileId,
    authProfileIdSource: authProfileId ? params.authProfileIdSource : undefined,
  };
}

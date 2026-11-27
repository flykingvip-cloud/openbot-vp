import { resolveRunAuthProfile } from "../../../auto-reply/reply/agent-runner-utils.js";
import type { FollowupRun } from "../../../auto-reply/reply/queue.js";
import type { EmployeeModelGateResult } from "../../../gateway/model-entitlement/employee-model-gate.js";
import { sessionTaskState } from "../../state/index.js";
import {
  buildBootstrapWarningParams,
  createCandidateUsageCharger,
  inheritExecutionIdentityRunFields,
  resolveBootstrapWarningSignaturesSeen,
  resolveCandidateEmbeddedTransport,
} from "./candidate-core.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";
import { runEmbeddedPiAgent } from "./embedded-run.js";

/** Catalog id selected for the queue, and the transport model that actually ran. */
export type QueuedCandidateChargeIdentity = {
  usage?: unknown;
  catalogProvider: string;
  catalogModel: string;
  transportProvider: string;
  transportModel: string;
  /** Rates come from the transport model. The catalog id is not a price. */
  pricingSource: "transport";
};

/** One queued provider candidate. The shared model session owns fallback and admission. */
export async function runQueuedCandidate(
  input: {
    queued: FollowupRun;
    provider: string;
    model: string;
    runId: string;
    modelGate?: EmployeeModelGateResult;
    modelPrompt?: string;
    abortSignal?: AbortSignal;
    suppressToolErrorWarnings?: boolean;
    runOptions?: { allowTransientCooldownProbe?: boolean };
    bootstrapWarnings: string[];
  },
  host: {
    assertBudget: () => void;
    onCompaction: () => void;
    recordWarnings: (warnings: string[]) => void;
    recordUsage: (identity: QueuedCandidateChargeIdentity) => void;
  },
) {
  const { queued, provider, model, runId, modelGate, runOptions } = input;
  const authProfile = resolveRunAuthProfile(queued.run, provider);
  const { transportFields } = await resolveCandidateEmbeddedTransport({
    provider,
    model,
    tenantId: modelGate?.tenantId?.trim() || modelGate?.creditReporting?.enterpriseId?.trim() || "",
  });
  host.assertBudget();
  const charger = createCandidateUsageCharger({
    onCharge: (usage) =>
      host.recordUsage({
        usage,
        catalogProvider: provider,
        catalogModel: model,
        transportProvider: transportFields.provider,
        transportModel: transportFields.model,
        pricingSource: "transport",
      }),
  });
  if (
    queued.run.taskCompletionBinding &&
    !sessionTaskState.bindingCurrent(queued.run.sessionFile, queued.run.taskCompletionBinding)
  ) {
    throw new Error("Queued task was paused, closed or replaced before provider startup");
  }
  let result: EmbeddedPiRunResult;
  try {
    result = await runEmbeddedPiAgent({
      sessionId: queued.run.sessionId,
      abortSignal: input.abortSignal,
      taskExecutionBinding: queued.run.taskCompletionBinding,
      sessionKey: queued.run.sessionKey,
      agentId: queued.run.agentId,
      trigger: "user",
      messageChannel: queued.originatingChannel ?? undefined,
      messageProvider: queued.run.messageProvider,
      agentAccountId: queued.run.agentAccountId,
      messageTo: queued.originatingTo,
      messageThreadId: queued.originatingThreadId,
      currentChannelId: queued.originatingTo,
      currentThreadTs:
        queued.originatingThreadId != null ? String(queued.originatingThreadId) : undefined,
      groupId: queued.run.groupId,
      groupChannel: queued.run.groupChannel,
      groupSpace: queued.run.groupSpace,
      senderId: queued.run.senderId,
      senderName: queued.run.senderName,
      senderUsername: queued.run.senderUsername,
      senderE164: queued.run.senderE164,
      senderIsOwner: queued.run.senderIsOwner,
      ...inheritExecutionIdentityRunFields(queued.run),
      sessionFile: queued.run.sessionFile,
      agentDir: queued.run.agentDir,
      workspaceDir: queued.run.workspaceDir,
      config: queued.run.config,
      skillsSnapshot: queued.run.skillsSnapshot,
      prompt: input.modelPrompt ?? queued.prompt,
      extraSystemPrompt: queued.run.extraSystemPrompt,
      ...(queued.run.disableTools ? { disableTools: true } : {}),
      ...(queued.run.skillPolicy ? { skillPolicy: queued.run.skillPolicy } : {}),
      ...(queued.run.inboundToolCeiling
        ? { inboundToolCeiling: queued.run.inboundToolCeiling }
        : {}),
      ...(queued.run.contextLane ? { contextLane: queued.run.contextLane } : {}),
      ...(queued.run.sessionEntry ? { sessionEntry: queued.run.sessionEntry } : {}),
      ...(queued.run.oguiDecisionRun ? { oguiDecisionRun: queued.run.oguiDecisionRun } : {}),
      ...(queued.run.knowledgeConsumeRefs?.length
        ? { knowledgeConsumeRefs: queued.run.knowledgeConsumeRefs }
        : {}),
      ...(queued.run.skipUserTranscriptPersist === true ? { skipUserTranscriptPersist: true } : {}),
      ...(queued.run.collaborationRoundInvoked === true ? { collaborationRoundInvoked: true } : {}),
      ...(queued.run.deliveryToolSideEffect
        ? { deliveryToolSideEffect: queued.run.deliveryToolSideEffect }
        : {}),
      ...(queued.run.privateRunBag ? { privateRunBag: queued.run.privateRunBag } : {}),
      ownerNumbers: queued.run.ownerNumbers,
      enforceFinalTag: queued.run.enforceFinalTag,
      ...transportFields,
      ...authProfile,
      thinkLevel: queued.run.thinkLevel,
      verboseLevel: queued.run.verboseLevel,
      reasoningLevel: queued.run.reasoningLevel,
      suppressToolErrorWarnings: input.suppressToolErrorWarnings,
      execOverrides: queued.run.execOverrides,
      bashElevated: queued.run.bashElevated,
      timeoutMs: queued.run.timeoutMs,
      runId,
      allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
      blockReplyBreak: queued.run.blockReplyBreak,
      ...buildBootstrapWarningParams(input.bootstrapWarnings),
      onAgentEvent: (evt) => {
        if (evt.stream !== "compaction") {
          return;
        }
        const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
        if (phase === "end") {
          host.onCompaction();
        }
      },
    });
    const notedUsage = charger.noteResultUsage(result.meta?.agentMeta?.usage);
    host.recordWarnings(resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport));
    charger.chargeOnce(result.meta?.agentMeta?.usage ?? notedUsage);
    return result;
  } catch (err) {
    charger.chargeOnFailure(err);
    throw err;
  }
}

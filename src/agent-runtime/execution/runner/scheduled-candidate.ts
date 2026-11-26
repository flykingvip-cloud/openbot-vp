import { getCliSessionId } from "../../../agents/cli-session.js";
import { isCliProvider } from "../../../agents/model-selection.js";
import type { OpenBotConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import {
  createCandidateUsageCharger,
  resolveBootstrapWarningSignaturesSeen,
  resolveCandidateEmbeddedTransport,
  runCliCandidateWithCredential,
} from "./candidate-core.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";
import { runEmbeddedPiAgent } from "./embedded-run.js";

/** One scheduled candidate; admission, fallback and schedule ownership remain outside. */
export async function runScheduledCandidate(
  input: {
    run: RunEmbeddedPiAgentParams & {
      config: OpenBotConfig;
      agentId: string;
      provider: string;
      model: string;
    };
    ledgerEnabled: boolean;
    freshSession: boolean;
    sessionEntry: SessionEntry;
    tenantId: string;
  },
  host: {
    recordWarnings: (warnings: string[]) => void;
    recordUsage: (result: EmbeddedPiRunResult, provider: string, model: string) => void;
  },
) {
  const run = input.run;
  if (!input.ledgerEnabled && isCliProvider(run.provider, run.config)) {
    // Fresh isolated sessions must retain the fresh CLI watchdog profile.
    const cliSessionId = input.freshSession
      ? undefined
      : getCliSessionId(input.sessionEntry, run.provider);
    const charger = createCandidateUsageCharger({
      onCharge: (usage) =>
        host.recordUsage(
          { meta: { agentMeta: { usage } } } as EmbeddedPiRunResult,
          run.provider,
          run.model,
        ),
    });
    try {
      const { result } = await runCliCandidateWithCredential({
        credentialInput: {
          agentId: run.agentId,
          provider: run.provider,
          model: run.model,
          config: run.config,
        },
        executionId: run.runId,
        runParams: {
          taskExecutionBinding: run.taskExecutionBinding,
          sessionId: run.sessionId,
          sessionKey: run.sessionKey,
          agentId: run.agentId,
          sessionFile: run.sessionFile,
          workspaceDir: run.workspaceDir,
          config: run.config,
          prompt: run.prompt,
          provider: run.provider,
          model: run.model,
          thinkLevel: run.thinkLevel,
          timeoutMs: run.timeoutMs,
          runId: run.runId,
          abortSignal: run.abortSignal,
          cliSessionId,
          bootstrapPromptWarningSignaturesSeen: run.bootstrapPromptWarningSignaturesSeen,
          bootstrapPromptWarningSignature: run.bootstrapPromptWarningSignature,
          ...(run.extraSystemPrompt ? { extraSystemPrompt: run.extraSystemPrompt } : {}),
        },
      });
      const notedCliUsage = charger.noteResultUsage(result.meta?.agentMeta?.usage);
      host.recordWarnings(resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport));
      charger.chargeOnce(notedCliUsage);
      return result;
    } catch (err) {
      charger.chargeOnFailure(err);
      throw err;
    }
  }
  const { transportFields } = await resolveCandidateEmbeddedTransport({
    provider: run.provider,
    model: run.model,
    tenantId: input.tenantId,
  });
  const charger = createCandidateUsageCharger({
    onCharge: (usage) =>
      host.recordUsage(
        { meta: { agentMeta: { usage } } } as EmbeddedPiRunResult,
        transportFields.provider,
        transportFields.model,
      ),
  });
  try {
    const result = await runEmbeddedPiAgent({
      ...run,
      ...transportFields,
    });
    const notedEmbeddedUsage = charger.noteResultUsage(result.meta?.agentMeta?.usage);
    host.recordWarnings(resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport));
    charger.chargeOnce(result.meta?.agentMeta?.usage ?? notedEmbeddedUsage);
    return result;
  } catch (err) {
    charger.chargeOnFailure(err);
    throw err;
  }
}

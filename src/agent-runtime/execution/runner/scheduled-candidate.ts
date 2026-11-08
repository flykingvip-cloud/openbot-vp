import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import { recordCliBackendUsage } from "../../../agents/cli-backend-usage-attribution.js";
import { getCliSessionId } from "../../../agents/cli-session.js";
import { isCliProvider } from "../../../agents/model-selection.js";
import type { OpenBotConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import { resolveEnterpriseEmbeddedTransport } from "../../../gateway/enterprise-model/embedded-transport.js";
import {
  rememberModelResultUsage,
  TaskBudgetExceededError,
  usageRetainedForCandidateCharge,
} from "../../../task-outcome/runtime-from-runner.js";
import { resolveCliRunCredential } from "../../model/index.js";
import { runCliAgent } from "./cli-run.js";
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
    const { credentialEnv, usageAttr } = await resolveCliRunCredential({
      agentId: run.agentId,
      provider: run.provider,
      model: run.model,
      config: run.config,
    });
    let cliCharged = false;
    const chargeCli = (usage?: unknown) => {
      if (cliCharged) {
        return;
      }
      cliCharged = true;
      host.recordUsage(
        { meta: { agentMeta: { usage } } } as EmbeddedPiRunResult,
        run.provider,
        run.model,
      );
    };
    let notedCliUsage: unknown;
    let result: EmbeddedPiRunResult;
    try {
      result = await runCliAgent({
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
        ...(credentialEnv ? { credentialEnv } : {}),
      });
      notedCliUsage = rememberModelResultUsage(result.meta?.agentMeta?.usage);
      if (usageAttr) {
        void recordCliBackendUsage({
          ...usageAttr,
          backendId: run.provider,
          model: run.model,
          executionId: run.runId,
        });
      }
      host.recordWarnings(resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport));
      chargeCli(notedCliUsage);
      return result;
    } catch (err) {
      if (!(err instanceof TaskBudgetExceededError)) {
        try {
          chargeCli(usageRetainedForCandidateCharge(notedCliUsage, err));
        } catch (chargeErr) {
          if (chargeErr instanceof TaskBudgetExceededError) {
            throw chargeErr;
          }
        }
      }
      throw err;
    }
  }
  const transport = await resolveEnterpriseEmbeddedTransport({
    provider: run.provider,
    model: run.model,
    tenantId: input.tenantId,
  });
  let embeddedCharged = false;
  const chargeEmbedded = (usage?: unknown) => {
    if (embeddedCharged) {
      return;
    }
    embeddedCharged = true;
    host.recordUsage(
      { meta: { agentMeta: { usage } } } as EmbeddedPiRunResult,
      transport.provider,
      transport.model,
    );
  };
  let notedEmbeddedUsage: unknown;
  try {
    const result = await runEmbeddedPiAgent({
      ...run,
      provider: transport.provider,
      model: transport.model,
      ...(transport.providerAuthOverride
        ? { providerAuthOverride: transport.providerAuthOverride }
        : {}),
      ...(transport.enterpriseRuntimeModelId
        ? { enterpriseRuntimeModelId: transport.enterpriseRuntimeModelId }
        : {}),
    });
    notedEmbeddedUsage = rememberModelResultUsage(result.meta?.agentMeta?.usage);
    host.recordWarnings(resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport));
    chargeEmbedded(result.meta?.agentMeta?.usage ?? notedEmbeddedUsage);
    return result;
  } catch (err) {
    if (!(err instanceof TaskBudgetExceededError)) {
      try {
        chargeEmbedded(usageRetainedForCandidateCharge(notedEmbeddedUsage, err));
      } catch (chargeErr) {
        if (chargeErr instanceof TaskBudgetExceededError) {
          throw chargeErr;
        }
      }
    }
    throw err;
  }
}

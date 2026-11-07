import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import { recordCliBackendUsage } from "../../../agents/cli-backend-usage-attribution.js";
import { getCliSessionId } from "../../../agents/cli-session.js";
import { isCliProvider } from "../../../agents/model-selection.js";
import type { OpenBotConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import { resolveEnterpriseEmbeddedTransport } from "../../../gateway/enterprise-model/embedded-transport.js";
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
    const result = await runCliAgent({
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
    if (usageAttr) {
      void recordCliBackendUsage({
        ...usageAttr,
        backendId: run.provider,
        model: run.model,
        executionId: run.runId,
      });
    }
    host.recordWarnings(resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport));
    host.recordUsage(result, run.provider, run.model);
    return result;
  }
  const transport = await resolveEnterpriseEmbeddedTransport({
    provider: run.provider,
    model: run.model,
    tenantId: input.tenantId,
  });
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
  host.recordWarnings(resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport));
  host.recordUsage(result, transport.provider, transport.model);
  return result;
}

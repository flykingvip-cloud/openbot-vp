import { getCliSessionId } from "../../../agents/cli-session.js";
import { logVerbose } from "../../../globals.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import type { AdmittedCandidateHost } from "./admitted-candidate.js";
import {
  buildBootstrapWarningParams,
  createCandidateUsageCharger,
  resolveBootstrapWarningSignaturesSeen,
  runCliCandidateWithCredential,
} from "./candidate-core.js";
import type { AgentTurnExecutionParams } from "./turn-contract.js";

type CandidateExecutionTerminal = "completed" | "failed" | "cancelled";

export function invokeAdmittedCandidateCli(args: {
  params: AgentTurnExecutionParams;
  runId: string;
  provider: string;
  model: string;
  host: AdmittedCandidateHost;
  isAbortError: (error: unknown) => boolean;
  createCandidateTerminal: (host: AdmittedCandidateHost) => {
    finish(stage: CandidateExecutionTerminal): void;
  };
}) {
  const { params, runId, provider, model, host, isAbortError, createCandidateTerminal } = args;
  host.assertTipBudgetAllowsModelCall();
  const startedAt = Date.now();
  host.notifyAgentRunStart();
  emitAgentEvent({
    runId,
    stream: "lifecycle",
    data: {
      phase: "start",
      startedAt,
      entrypoint: "cli",
    },
  });
  const cliSessionId = getCliSessionId(params.getActiveSessionEntry(), provider);
  return (async () => {
    let lifecycleTerminalEmitted = false;
    const executionTerminal = createCandidateTerminal(host);
    const charger = createCandidateUsageCharger({
      onCharge: (usage) => host.chargeTipBudgetAfterModelCall({ provider, model, usage }),
      onNonBudgetChargeError: (chargeErr) =>
        logVerbose(
          `tip budget mid-run charge failed (cli): ${chargeErr instanceof Error ? chargeErr.message : String(chargeErr)}`,
        ),
    });
    try {
      host.assertOriginalTaskCurrent();
      host.observeExecution?.("started");
      const { result, recordAttribution } = await runCliCandidateWithCredential({
        credentialInput: {
          agentId: params.followupRun.run.agentId,
          provider,
          model,
          config: params.followupRun.run.config,
          fallbackUserId: params.sessionCtx.GatewayClientUser,
        },
        executionId: runId,
        deferAttribution: true,
        passUndefinedCredentialEnv: true,
        runParams: {
          taskExecutionBinding: params.followupRun.run.taskCompletionBinding,
          sessionId: params.followupRun.run.sessionId,
          sessionKey: params.sessionKey,
          agentId: params.followupRun.run.agentId,
          sessionFile: params.followupRun.run.sessionFile,
          workspaceDir: params.followupRun.run.workspaceDir,
          config: params.followupRun.run.config,
          prompt: params.commandBody,
          provider,
          model,
          thinkLevel: params.followupRun.run.thinkLevel,
          timeoutMs: params.followupRun.run.timeoutMs,
          runId,
          abortSignal: params.opts?.abortSignal,
          extraSystemPrompt: params.followupRun.run.extraSystemPrompt,
          ownerNumbers: params.followupRun.run.ownerNumbers,
          cliSessionId,
          ...buildBootstrapWarningParams(host.getBootstrapWarnings()),
          images: params.opts?.images,
        },
      });
      const notedCliUsage = charger.noteResultUsage(result.meta?.agentMeta?.usage);
      host.setBootstrapWarnings(
        resolveBootstrapWarningSignaturesSeen(result.meta?.systemPromptReport),
      );

      // CLI backends don't emit streaming assistant events, so we need to
      // emit one with the final text so server-chat can populate its buffer
      // and send the response to TUI/WebSocket clients.
      const cliText = result.payloads?.[0]?.text?.trim();
      if (cliText) {
        emitAgentEvent({
          runId,
          stream: "assistant",
          data: { text: cliText },
        });
      }

      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          phase: "end",
          startedAt,
          endedAt: Date.now(),
          entrypoint: "cli",
        },
      });
      lifecycleTerminalEmitted = true;

      recordAttribution();

      charger.chargeOnce(notedCliUsage);
      executionTerminal.finish(params.opts?.abortSignal?.aborted ? "cancelled" : "completed");

      return result;
    } catch (err) {
      charger.chargeOnFailure(err, { skipCharge: isAbortError(err) });
      executionTerminal.finish(params.opts?.abortSignal?.aborted ? "cancelled" : "failed");
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          error: String(err),
          entrypoint: "cli",
        },
      });
      lifecycleTerminalEmitted = true;
      throw err;
    } finally {
      // Defensive backstop: never let a CLI run complete without a terminal
      // lifecycle event, otherwise downstream consumers can hang.
      if (!lifecycleTerminalEmitted) {
        emitAgentEvent({
          runId,
          stream: "lifecycle",
          data: {
            phase: "error",
            startedAt,
            endedAt: Date.now(),
            error: "CLI run completed without lifecycle terminal event",
            entrypoint: "cli",
          },
        });
      }
    }
  })();
}

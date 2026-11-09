import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import { recordCliBackendUsage } from "../../../agents/cli-backend-usage-attribution.js";
import { getCliSessionId } from "../../../agents/cli-session.js";
import { logVerbose } from "../../../globals.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import {
  rememberModelResultUsage,
  TaskBudgetExceededError,
  usageRetainedForCandidateCharge,
} from "../../../task-outcome/runtime-from-runner.js";
import { resolveCliRunCredential } from "../../model/index.js";
import type { AdmittedCandidateHost } from "./admitted-candidate.js";
import { runCliAgent } from "./cli-run.js";
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
    // CLI 后端凭证桥（cli-backend-onboarding Task 6/9）：按 bot 归属席位解析企业作用域，
    // 选取个人/企业凭证并解析其 SecretRef，作为 per-run env 注入子进程；同时捕获
    // credentialId + tenant/user 供执行完成后写 UsageAttribution（chargeback 依据）。
    // fail-safe：任一环节失败 → undefined → 回退主机默认 env（零回归）。值绝不记日志。
    const { credentialEnv, usageAttr } = await resolveCliRunCredential({
      agentId: params.followupRun.run.agentId,
      provider,
      model,
      config: params.followupRun.run.config,
      fallbackUserId: params.sessionCtx.GatewayClientUser,
    });
    let lifecycleTerminalEmitted = false;
    let notedCliUsage: unknown;
    const executionTerminal = createCandidateTerminal(host);
    let cliCharged = false;
    const chargeCliOnce = (usage?: unknown) => {
      if (cliCharged) {
        return;
      }
      cliCharged = true;
      try {
        host.chargeTipBudgetAfterModelCall({ provider, model, usage });
      } catch (chargeErr) {
        if (chargeErr instanceof TaskBudgetExceededError) {
          throw chargeErr;
        }
        logVerbose(
          `tip budget mid-run charge failed (cli): ${chargeErr instanceof Error ? chargeErr.message : String(chargeErr)}`,
        );
      }
    };
    try {
      host.assertOriginalTaskCurrent();
      host.observeExecution?.("started");
      const result = await runCliAgent({
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
        bootstrapPromptWarningSignaturesSeen: host.getBootstrapWarnings(),
        bootstrapPromptWarningSignature:
          host.getBootstrapWarnings()[host.getBootstrapWarnings().length - 1],
        images: params.opts?.images,
        credentialEnv,
      });
      notedCliUsage = rememberModelResultUsage(result.meta?.agentMeta?.usage);
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

      // UsageAttribution（Task 9/R9.1）：执行完成后 best-effort 记录归因
      // {tenant,user,backend,credential,model,execution}，供 chargeback；
      // 仅在实际选中凭证时写，凭证以 id 记录（无明文），失败不影响回复。
      if (usageAttr) {
        void recordCliBackendUsage({
          tenantId: usageAttr.tenantId,
          userId: usageAttr.userId,
          backendId: provider,
          credentialId: usageAttr.credentialId,
          model,
          executionId: runId,
        });
      }

      chargeCliOnce(notedCliUsage);
      executionTerminal.finish(params.opts?.abortSignal?.aborted ? "cancelled" : "completed");

      return result;
    } catch (err) {
      if (!(err instanceof TaskBudgetExceededError) && !isAbortError(err)) {
        chargeCliOnce(usageRetainedForCandidateCharge(notedCliUsage, err));
      }
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

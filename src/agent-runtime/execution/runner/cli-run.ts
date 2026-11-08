import type { ImageContent } from "@earendil-works/pi-ai/compat";
import { resolveSessionAgentIds } from "../../../agents/agent-scope.js";
import {
  analyzeBootstrapBudget,
  buildBootstrapInjectionStats,
  buildBootstrapPromptWarning,
  buildBootstrapTruncationReportMeta,
} from "../../../agents/bootstrap-budget.js";
import {
  makeBootstrapWarn,
  resolveBootstrapContextForRun,
} from "../../../agents/bootstrap-files.js";
import { resolveCliBackendConfig } from "../../../agents/cli-backends.js";
import { buildSystemPrompt, normalizeCliModel } from "../../../agents/cli-runner/helpers.js";
import { resolveOpenClawDocsPath } from "../../../agents/docs-path.js";
import { FailoverError, resolveFailoverStatus } from "../../../agents/failover-error.js";
import {
  classifyFailoverReason,
  isFailoverErrorMessage,
  resolveBootstrapMaxChars,
  resolveBootstrapPromptTruncationWarningMode,
  resolveBootstrapTotalMaxChars,
} from "../../../agents/pi-embedded-helpers.js";
import { buildSystemPromptReport } from "../../../agents/system-prompt-report.js";
import { redactRunIdentifier, resolveRunWorkspaceDir } from "../../../agents/workspace-run.js";
import { resolveHeartbeatPrompt } from "../../../auto-reply/heartbeat.js";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { assertFreeChatCliRunAllowed } from "../../../gateway/supervisor/free-chat-cli-guard.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import type { TaskCompletionBinding } from "../../contracts/task-binding.js";
import { sessionTaskState } from "../../state/index.js";
import { executeCliWithSession } from "./cli-run-spawn.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";

const log = createSubsystemLogger("agent/claude-cli");

export async function runCliAgent(params: {
  taskExecutionBinding?: TaskCompletionBinding;
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: OpenBotConfig;
  prompt: string;
  provider: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
  runId: string;
  abortSignal?: AbortSignal;
  extraSystemPrompt?: string;
  streamParams?: import("../../contracts/inference.js").AgentStreamParams;
  ownerNumbers?: string[];
  cliSessionId?: string;
  bootstrapPromptWarningSignaturesSeen?: string[];
  /** Backward-compat fallback when only the previous signature is available. */
  bootstrapPromptWarningSignature?: string;
  images?: ImageContent[];
  /**
   * Resolved per-run credential env (cli-backend-onboarding Task 6). Injected
   * into the child process env AFTER `backend.clearEnv` so a governed,
   * SecretRef-resolved credential always wins over inherited/host env. The
   * caller resolves this from the credential store (personal→enterprise) + the
   * secret resolver; values are never logged.
   */
  credentialEnv?: Record<string, string>;
  /** Development Supervisor WorkerExecutor sets this to bypass free-chat CLI hard gate. */
  supervisedRun?: boolean;
}): Promise<EmbeddedPiRunResult> {
  const assertNotAborted = () => {
    if (
      params.taskExecutionBinding &&
      !sessionTaskState.bindingCurrent(params.sessionFile, params.taskExecutionBinding)
    ) {
      throw new Error("Original task was paused, closed, revised or replaced before CLI execution");
    }
    if (params.abortSignal?.aborted) {
      const error = new Error("CLI execution cancelled");
      error.name = "AbortError";
      throw error;
    }
  };
  assertNotAborted();
  const started = Date.now();
  const workspaceResolution = resolveRunWorkspaceDir({
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    config: params.config,
  });
  const resolvedWorkspace = workspaceResolution.workspaceDir;
  const redactedSessionId = redactRunIdentifier(params.sessionId);
  const redactedSessionKey = redactRunIdentifier(params.sessionKey);
  const redactedWorkspace = redactRunIdentifier(resolvedWorkspace);
  if (workspaceResolution.usedFallback) {
    log.warn(
      `[workspace-fallback] caller=runCliAgent reason=${workspaceResolution.fallbackReason} run=${params.runId} session=${redactedSessionId} sessionKey=${redactedSessionKey} agent=${workspaceResolution.agentId} workspace=${redactedWorkspace}`,
    );
  }
  const workspaceDir = resolvedWorkspace;

  const backendResolved = resolveCliBackendConfig(params.provider, params.config);
  if (!backendResolved) {
    throw new Error(`Unknown CLI backend: ${params.provider}`);
  }
  assertFreeChatCliRunAllowed({
    backendId: backendResolved.id,
    config: params.config,
    supervisedRun: params.supervisedRun,
  });
  const backend = backendResolved.config;
  const modelId = (params.model ?? "default").trim() || "default";
  const normalizedModel = normalizeCliModel(modelId, backend);
  const modelDisplay = `${params.provider}/${modelId}`;

  const extraSystemPrompt = [
    params.extraSystemPrompt?.trim(),
    "Tools are disabled in this session. Do not call tools.",
  ]
    .filter(Boolean)
    .join("\n");

  const sessionLabel = params.sessionKey ?? params.sessionId;
  const { bootstrapFiles, contextFiles } = await resolveBootstrapContextForRun({
    workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    warn: makeBootstrapWarn({ sessionLabel, warn: (message) => log.warn(message) }),
  });
  const bootstrapMaxChars = resolveBootstrapMaxChars(params.config);
  const bootstrapTotalMaxChars = resolveBootstrapTotalMaxChars(params.config);
  const bootstrapAnalysis = analyzeBootstrapBudget({
    files: buildBootstrapInjectionStats({
      bootstrapFiles,
      injectedFiles: contextFiles,
    }),
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
  });
  const bootstrapPromptWarningMode = resolveBootstrapPromptTruncationWarningMode(params.config);
  const bootstrapPromptWarning = buildBootstrapPromptWarning({
    analysis: bootstrapAnalysis,
    mode: bootstrapPromptWarningMode,
    seenSignatures: params.bootstrapPromptWarningSignaturesSeen,
    previousSignature: params.bootstrapPromptWarningSignature,
  });
  const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.config,
    agentId: params.agentId,
  });
  const heartbeatPrompt =
    sessionAgentId === defaultAgentId
      ? resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt)
      : undefined;
  const docsPath = await resolveOpenClawDocsPath({
    workspaceDir,
    argv1: process.argv[1],
    cwd: process.cwd(),
    moduleUrl: import.meta.url,
  });
  const systemPrompt = buildSystemPrompt({
    workspaceDir,
    config: params.config,
    defaultThinkLevel: params.thinkLevel,
    extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    heartbeatPrompt,
    docsPath: docsPath ?? undefined,
    tools: [],
    contextFiles,
    bootstrapTruncationWarningLines: bootstrapPromptWarning.lines,
    modelDisplay,
    agentId: sessionAgentId,
  });
  const systemPromptReport = buildSystemPromptReport({
    source: "run",
    generatedAt: Date.now(),
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: modelId,
    workspaceDir,
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
    bootstrapTruncation: buildBootstrapTruncationReportMeta({
      analysis: bootstrapAnalysis,
      warningMode: bootstrapPromptWarningMode,
      warning: bootstrapPromptWarning,
    }),
    sandbox: { mode: "off", sandboxed: false },
    systemPrompt,
    bootstrapFiles,
    injectedFiles: contextFiles,
    skillsPrompt: "",
    tools: [],
  });

  const spawnArgs = {
    backend,
    backendId: backendResolved.id,
    systemPrompt,
    prompt: params.prompt,
    images: params.images,
    normalizedModel,
    modelId,
    provider: params.provider,
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    timeoutMs: params.timeoutMs,
    workspaceDir,
    abortSignal: params.abortSignal,
    credentialEnv: params.credentialEnv,
    assertNotAborted,
    log,
  };

  // Try with the provided CLI session ID first
  try {
    const output = await executeCliWithSession({
      ...spawnArgs,
      cliSessionIdToUse: params.cliSessionId,
    });
    const text = output.text?.trim();
    const payloads = text ? [{ text }] : undefined;

    return {
      payloads,
      meta: {
        durationMs: Date.now() - started,
        systemPromptReport,
        agentMeta: {
          sessionId: output.sessionId ?? params.cliSessionId ?? params.sessionId ?? "",
          provider: params.provider,
          model: modelId,
          usage: output.usage,
        },
      },
    };
  } catch (err) {
    assertNotAborted();
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    if (err instanceof FailoverError) {
      // Check if this is a session expired error and we have a session to clear
      if (err.reason === "session_expired" && params.cliSessionId && params.sessionKey) {
        log.warn(
          `CLI session expired, clearing session ID and retrying: provider=${params.provider} session=${redactRunIdentifier(params.cliSessionId)}`,
        );

        // Clear the expired session ID from the session entry
        // This requires access to the session store, which we don't have here
        // We'll need to modify the caller to handle this case

        // For now, retry without the session ID to create a new session
        const output = await executeCliWithSession({
          ...spawnArgs,
          cliSessionIdToUse: undefined,
        });
        const text = output.text?.trim();
        const payloads = text ? [{ text }] : undefined;

        return {
          payloads,
          meta: {
            durationMs: Date.now() - started,
            systemPromptReport,
            agentMeta: {
              sessionId: output.sessionId ?? params.sessionId ?? "",
              provider: params.provider,
              model: modelId,
              usage: output.usage,
            },
          },
        };
      }
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (isFailoverErrorMessage(message)) {
      const reason = classifyFailoverReason(message) ?? "unknown";
      const status = resolveFailoverStatus(reason);
      throw new FailoverError(message, {
        reason,
        provider: params.provider,
        model: modelId,
        status,
      });
    }
    throw err;
  }
}

export async function runClaudeCliAgent(params: {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: OpenBotConfig;
  prompt: string;
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
  runId: string;
  abortSignal?: AbortSignal;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  claudeSessionId?: string;
  images?: ImageContent[];
}): Promise<EmbeddedPiRunResult> {
  return runCliAgent({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    config: params.config,
    prompt: params.prompt,
    provider: params.provider ?? "claude-cli",
    model: params.model ?? "opus",
    thinkLevel: params.thinkLevel,
    timeoutMs: params.timeoutMs,
    runId: params.runId,
    abortSignal: params.abortSignal,
    extraSystemPrompt: params.extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    cliSessionId: params.claudeSessionId,
    images: params.images,
  });
}

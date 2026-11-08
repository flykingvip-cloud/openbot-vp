import fs from "node:fs/promises";
import { resolveOpenClawAgentDir } from "../../../agents/agent-paths.js";
import { hasConfiguredModelFallbacks } from "../../../agents/agent-scope.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../../agents/defaults.js";
import { finalizeDeliveryContext } from "../../../agents/execution-preflight/completion-hold.js";
import type { ConstitutionalRuntimeShadowDeps } from "../../../agents/execution-preflight/constitutional-runtime-shadow-deps.js";
import { parseConstitutionalRuntimeShadowFlag } from "../../../agents/execution-preflight/constitutional-runtime-shadow-gate.js";
import { NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK } from "../../../agents/execution-preflight/constitutional-runtime-shadow-sink.js";
import { ensureOpenClawModelsJson } from "../../../agents/models-config.js";
import { resolveGlobalLane, resolveSessionLane } from "../../../agents/pi-embedded-runner/lanes.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { ensureRuntimePluginsLoaded } from "../../../agents/runtime-plugins.js";
import { redactRunIdentifier, resolveRunWorkspaceDir } from "../../../agents/workspace-run.js";
import {
  ensureContextEnginesInitialized,
  resolveContextEngine,
} from "../../../context-engine/index.js";
import { generateSecureToken } from "../../../infra/secure-random.js";
import { enqueueCommandInLane } from "../../../process/command-queue.js";
import { isMarkdownCapableMessageChannel } from "../../../utils/message-channel.js";
import { sessionTaskState } from "../../state/index.js";
import { buildErrorAgentMeta, createUsageAccumulator } from "../outcomes/usage-summary.js";
import { cleanupEmbeddedRun } from "./embedded-cleanup.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";
import {
  runEmbeddedRunAttemptIteration,
  type EmbeddedRunLoopState,
} from "./embedded-run-attempt.js";
import {
  prepareEmbeddedRunAuth,
  type EmbeddedRunLoopOutcome,
  type EmbeddedRunSession,
} from "./embedded-run-auth.js";
import { runEmbeddedRunFailover } from "./embedded-run-failover.js";
import { runEmbeddedRunResult } from "./embedded-run-result.js";

// Avoid Anthropic's refusal test token poisoning session transcripts.
const ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL = "ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL";
const ANTHROPIC_MAGIC_STRING_REPLACEMENT = "ANTHROPIC MAGIC STRING TRIGGER REFUSAL (redacted)";

function scrubAnthropicRefusalMagic(prompt: string): string {
  if (!prompt.includes(ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL)) {
    return prompt;
  }
  return prompt.replaceAll(
    ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL,
    ANTHROPIC_MAGIC_STRING_REPLACEMENT,
  );
}

function createCompactionDiagId(): string {
  return `ovf-${Date.now().toString(36)}-${generateSecureToken(4)}`;
}

function resolveActiveErrorContext(params: {
  lastAssistant: { provider?: string; model?: string } | undefined;
  provider: string;
  model: string;
}): { provider: string; model: string } {
  return {
    provider: params.lastAssistant?.provider ?? params.provider,
    model: params.lastAssistant?.model ?? params.model,
  };
}

function buildEmbeddedRunRetryLimitResult(args: {
  session: EmbeddedRunSession;
  loop: EmbeddedRunLoopState;
  params: RunEmbeddedPiAgentParams;
  started: number;
  releaseRunTask: (outcome: "failed" | "cancelled") => void;
}): EmbeddedRunLoopOutcome {
  const { session, loop, params, started, releaseRunTask } = args;
  const message =
    `Exceeded retry limit after ${loop.runLoopIterations} attempts ` +
    `(max=${session.MAX_RUN_LOOP_ITERATIONS}).`;
  log.error(
    `[run-retry-limit] sessionKey=${params.sessionKey ?? params.sessionId} ` +
      `provider=${session.provider}/${session.modelId} attempts=${loop.runLoopIterations} ` +
      `maxAttempts=${session.MAX_RUN_LOOP_ITERATIONS}`,
  );
  releaseRunTask("failed");
  return {
    action: "return",
    result: {
      payloads: [
        {
          text:
            "Request failed after repeated internal retries. " +
            "Please try again, or use /new to start a fresh session.",
          isError: true,
        },
      ],
      meta: {
        durationMs: Date.now() - started,
        agentMeta: buildErrorAgentMeta({
          sessionId: params.sessionId,
          provider: session.provider,
          model: session.effectiveModel.id,
          usageAccumulator: loop.usageAccumulator,
          lastRunPromptUsage: loop.lastRunPromptUsage,
          lastTurnTotal: loop.lastTurnTotal,
        }),
        error: { kind: "retry_limit", message },
      },
    },
  };
}

export async function runEmbeddedPiAgent(
  params: RunEmbeddedPiAgentParams,
): Promise<EmbeddedPiRunResult> {
  const constitutionalRuntimeShadowDeps = Object.freeze<ConstitutionalRuntimeShadowDeps>({
    runtimeShadowEnabled: parseConstitutionalRuntimeShadowFlag(
      process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW,
    ),
    sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
    now: performance.now.bind(performance),
  });
  const assertExecutionCurrent = () => {
    if (
      params.taskExecutionBinding &&
      !sessionTaskState.bindingCurrent(params.sessionFile, params.taskExecutionBinding)
    ) {
      throw new Error(
        "Original task was paused, closed, revised or replaced before execution startup",
      );
    }
  };
  assertExecutionCurrent();
  const sessionLane = resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);
  const enqueueGlobal =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(globalLane, task, opts));
  const enqueueSession =
    params.enqueue ?? ((task, opts) => enqueueCommandInLane(sessionLane, task, opts));
  const channelHint = params.messageChannel ?? params.messageProvider;
  const resolvedToolResultFormat =
    params.toolResultFormat ??
    (channelHint
      ? isMarkdownCapableMessageChannel(channelHint)
        ? "markdown"
        : "plain"
      : "markdown");
  const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;

  return enqueueSession(() =>
    enqueueGlobal(async () => {
      assertExecutionCurrent();
      const started = Date.now();
      const workspaceResolution = resolveRunWorkspaceDir({
        workspaceDir: params.workspaceDir,
        sessionKey: params.sessionKey,
        agentId: params.agentId,
        config: params.config,
        userId:
          params.gatewayClientPlatformUserId?.trim() ||
          params.executionIdentity?.platformUserId?.trim() ||
          undefined,
        tenantId:
          params.gatewayClientSessionEnterpriseId?.trim() ||
          params.executionIdentity?.enterpriseId?.trim() ||
          undefined,
      });
      const resolvedWorkspace = workspaceResolution.workspaceDir;
      const redactedSessionId = redactRunIdentifier(params.sessionId);
      const redactedSessionKey = redactRunIdentifier(params.sessionKey);
      const redactedWorkspace = redactRunIdentifier(resolvedWorkspace);
      if (workspaceResolution.usedFallback) {
        log.warn(
          `[workspace-fallback] caller=runEmbeddedPiAgent reason=${workspaceResolution.fallbackReason} run=${params.runId} session=${redactedSessionId} sessionKey=${redactedSessionKey} agent=${workspaceResolution.agentId} workspace=${redactedWorkspace}`,
        );
      }
      ensureRuntimePluginsLoaded({
        config: params.config,
        workspaceDir: resolvedWorkspace,
      });
      const prevCwd = process.cwd();

      let provider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
      let modelId = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      const agentDir = params.agentDir ?? resolveOpenClawAgentDir();
      const fallbackConfigured = hasConfiguredModelFallbacks({
        cfg: params.config,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
      });
      await ensureOpenClawModelsJson(params.config, agentDir);

      const session = await prepareEmbeddedRunAuth({
        params,
        provider,
        modelId,
        agentDir,
        fallbackConfigured,
        resolvedWorkspace,
        workspaceAgentId: workspaceResolution.agentId,
      });
      provider = session.provider;
      modelId = session.modelId;

      ensureContextEnginesInitialized();
      const contextEngine = await resolveContextEngine(params.config);
      try {
        const loop: EmbeddedRunLoopState = {
          overflowCompactionAttempts: 0,
          toolResultTruncationAttempted: false,
          bootstrapPromptWarningSignaturesSeen:
            params.bootstrapPromptWarningSignaturesSeen ??
            (params.bootstrapPromptWarningSignature
              ? [params.bootstrapPromptWarningSignature]
              : []),
          usageAccumulator: createUsageAccumulator(),
          lastRunPromptUsage: undefined,
          autoCompactionCount: 0,
          runLoopIterations: 0,
          authRetryPending: false,
          lastTurnTotal: undefined,
          lastAttemptTaskId: "",
          lastHookDelivery: undefined,
        };
        const releaseRunTask = (outcome: "failed" | "cancelled") => {
          const taskId = loop.lastAttemptTaskId.trim() || params.runId?.trim() || "";
          if (!taskId) {
            return;
          }
          finalizeDeliveryContext({ taskId, outcome });
        };

        while (true) {
          assertExecutionCurrent();
          if (loop.runLoopIterations >= session.MAX_RUN_LOOP_ITERATIONS) {
            const limited = buildEmbeddedRunRetryLimitResult({
              session,
              loop,
              params,
              started,
              releaseRunTask,
            });
            if (limited.action === "return") {
              return limited.result;
            }
          }
          loop.runLoopIterations += 1;
          const copilotAuthRetry = loop.authRetryPending;
          loop.authRetryPending = false;
          session.attemptedThinking.add(session.thinkLevel);
          await fs.mkdir(resolvedWorkspace, { recursive: true });

          const prompt =
            session.provider === "anthropic"
              ? scrubAnthropicRefusalMagic(params.prompt)
              : params.prompt;

          const attemptOutcome = await runEmbeddedRunAttemptIteration({
            session,
            loop,
            params,
            prompt,
            resolvedWorkspace,
            workspaceAgentId: workspaceResolution.agentId,
            resolvedToolResultFormat,
            constitutionalRuntimeShadowDeps,
            contextEngine,
            started,
            releaseRunTask,
            createCompactionDiagId,
            resolveActiveErrorContext,
          });
          if (attemptOutcome.action === "continue") {
            continue;
          }
          if (attemptOutcome.action === "return") {
            return attemptOutcome.result;
          }

          const failoverOutcome = await runEmbeddedRunFailover({
            session,
            loop,
            params,
            carry: attemptOutcome,
            started,
            copilotAuthRetry,
            releaseRunTask,
          });
          if (failoverOutcome.action === "continue") {
            continue;
          }
          if (failoverOutcome.action === "return") {
            return failoverOutcome.result;
          }

          const resultOutcome = await runEmbeddedRunResult({
            session,
            loop,
            params,
            carry: attemptOutcome,
            started,
            copilotAuthRetry,
            isProbeSession,
            resolvedToolResultFormat,
            releaseRunTask,
          });
          if (resultOutcome.action === "continue") {
            continue;
          }
          return resultOutcome.result;
        }
      } finally {
        await cleanupEmbeddedRun({
          disposeContext: () => contextEngine.dispose?.(),
          stopCredentialRefresh: () => session.copilotRefresh.stop(),
          restoreWorkingDirectory: () => process.chdir(prevCwd),
        });
      }
    }),
  );
}

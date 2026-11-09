import os from "node:os";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { buildBootstrapTruncationReportMeta } from "../../../agents/bootstrap-budget.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolHints,
} from "../../../agents/channel-tools.js";
import { resolveOpenClawDocsPath } from "../../../agents/docs-path.js";
import { resolveDefaultModelForAgent } from "../../../agents/model-selection.js";
import { resolveOwnerDisplaySetting } from "../../../agents/owner-display.js";
import { buildEmbeddedExtensionFactories } from "../../../agents/pi-embedded-runner/extensions.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { buildModelAliasLines } from "../../../agents/pi-embedded-runner/model.js";
import { buildExecutionPreferenceHint } from "../../../agents/pi-embedded-runner/run/execution-preference-hint.js";
import { observeAttemptToolPreparation } from "../../../agents/pi-embedded-runner/run/execution-router-baselines.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import { buildEmbeddedSandboxInfo } from "../../../agents/pi-embedded-runner/sandbox-info.js";
import {
  buildEmbeddedSystemPrompt,
  createSystemPromptOverride,
} from "../../../agents/pi-embedded-runner/system-prompt.js";
import {
  applyEmbeddedCustomToolPolicy,
  splitSdkTools,
} from "../../../agents/pi-embedded-runner/tool-split.js";
import { createPreparedEmbeddedPiSettingsManager } from "../../../agents/pi-project-settings.js";
import { applyPiAutoCompactionGuard } from "../../../agents/pi-settings.js";
import { toClientToolDefinitions } from "../../../agents/pi-tool-definition-adapter.js";
import { resolveToolLoopDetectionConfig } from "../../../agents/pi-tools.js";
import { createProtocolBoundaryState } from "../../../agents/protocol-violation.js";
import { resolveSandboxRuntimeStatus } from "../../../agents/sandbox/runtime-status.js";
import {
  acquireSessionWriteLock,
  resolveSessionLockMaxHoldFromTimeout,
} from "../../../agents/session-write-lock.js";
import { detectRuntimeShell } from "../../../agents/shell-utils.js";
import { buildSystemPromptParams } from "../../../agents/system-prompt-params.js";
import { buildSystemPromptReport } from "../../../agents/system-prompt-report.js";
import { resolveHeartbeatPrompt } from "../../../auto-reply/heartbeat.js";
import { resolveChannelCapabilities } from "../../../config/channel-capabilities.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { getMachineDisplayName } from "../../../infra/machine-name.js";
import { formatOperatorComputerTurnPrompt } from "../../../infra/operator-local-computer.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { resolveSignalReactionLevel } from "../../../signal/reaction-level.js";
import { resolveTelegramInlineButtonsScope } from "../../../telegram/inline-buttons.js";
import { resolveTelegramReactionLevel } from "../../../telegram/reaction-level.js";
import { buildTtsSystemPromptHint } from "../../../tts/tts.js";
import { normalizeMessageChannel } from "../../../utils/message-channel.js";
import { isReasoningTagProvider } from "../../../utils/provider-utils.js";
import { resolvePromptModeForSession } from "../../policy/index.js";
import { openAttemptSession, prepareAttemptSessionTranscript } from "../../state/index.js";
import { captureTaskActionBoundary } from "../../state/task-action.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-preflight.js";

/** Channel actions, system-prompt tools, compaction extension, client tools, through tool baseline. */
export async function runEmbeddedAttemptTools(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  s.machineName = await getMachineDisplayName();
  s.runtimeChannel = normalizeMessageChannel(params.messageChannel ?? params.messageProvider);
  s.runtimeCapabilities = s.runtimeChannel
    ? (resolveChannelCapabilities({
        cfg: params.config,
        channel: s.runtimeChannel,
        accountId: params.agentAccountId,
      }) ?? [])
    : undefined;
  if (s.runtimeChannel === "telegram" && params.config) {
    const inlineButtonsScope = resolveTelegramInlineButtonsScope({
      cfg: params.config,
      accountId: params.agentAccountId ?? undefined,
    });
    if (inlineButtonsScope !== "off") {
      if (!s.runtimeCapabilities) {
        s.runtimeCapabilities = [];
      }
      if (
        !s.runtimeCapabilities.some((cap) => String(cap).trim().toLowerCase() === "inlinebuttons")
      ) {
        s.runtimeCapabilities.push("inlineButtons");
      }
    }
  }
  s.reactionGuidance =
    s.runtimeChannel && params.config
      ? (() => {
          if (s.runtimeChannel === "telegram") {
            const resolved = resolveTelegramReactionLevel({
              cfg: params.config,
              accountId: params.agentAccountId ?? undefined,
            });
            const level = resolved.agentReactionGuidance;
            return level ? { level, channel: "Telegram" } : undefined;
          }
          if (s.runtimeChannel === "signal") {
            const resolved = resolveSignalReactionLevel({
              cfg: params.config,
              accountId: params.agentAccountId ?? undefined,
            });
            const level = resolved.agentReactionGuidance;
            return level ? { level, channel: "Signal" } : undefined;
          }
          return undefined;
        })()
      : undefined;
  s.sandboxInfo = buildEmbeddedSandboxInfo(s.sandbox, params.bashElevated);
  s.reasoningTagHint = isReasoningTagProvider(params.provider); // Resolve channel-specific message actions for system prompt
  s.channelActions = s.runtimeChannel
    ? listChannelSupportedActions({
        cfg: params.config,
        channel: s.runtimeChannel,
      })
    : undefined;
  s.messageToolHints = s.runtimeChannel
    ? resolveChannelMessageToolHints({
        cfg: params.config,
        channel: s.runtimeChannel,
        accountId: params.agentAccountId,
      })
    : undefined;
  s.defaultModelRef = resolveDefaultModelForAgent({
    cfg: params.config ?? {},
    agentId: s.sessionAgentId,
  });
  s.defaultModelLabel = `${s.defaultModelRef.provider}/${s.defaultModelRef.model}`;
  const phaseValue1 = buildSystemPromptParams({
    config: params.config,
    agentId: s.sessionAgentId,
    workspaceDir: s.effectiveWorkspace,
    cwd: process.cwd(),
    runtime: {
      host: s.machineName,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version,
      model: `${params.provider}/${params.modelId}`,
      defaultModel: s.defaultModelLabel,
      shell: detectRuntimeShell(),
      channel: s.runtimeChannel,
      capabilities: s.runtimeCapabilities,
      channelActions: s.channelActions,
    },
  });
  s.runtimeInfo = phaseValue1.runtimeInfo;
  s.userTimezone = phaseValue1.userTimezone;
  s.userTime = phaseValue1.userTime;
  s.userTimeFormat = phaseValue1.userTimeFormat;
  s.isDefaultAgent = s.sessionAgentId === s.defaultAgentId;
  s.promptMode = resolvePromptModeForSession(params.sessionKey);
  s.docsPath = await resolveOpenClawDocsPath({
    workspaceDir: s.effectiveWorkspace,
    argv1: process.argv[1],
    cwd: process.cwd(),
    moduleUrl: import.meta.url,
  });
  s.ttsHint = params.config ? buildTtsSystemPromptHint(params.config) : undefined;
  s.ownerDisplay = resolveOwnerDisplaySetting(params.config);
  s.executionPreferenceHint = undefined;
  try {
    s.executionPreferenceHint = buildExecutionPreferenceHint({
      agentId: s.sessionAgentId,
    });
  } catch {
    s.executionPreferenceHint = undefined;
  }
  s.appendPrompt = buildEmbeddedSystemPrompt({
    workspaceDir: s.effectiveWorkspace,
    defaultThinkLevel: params.thinkLevel,
    reasoningLevel: params.reasoningLevel ?? "off",
    extraSystemPrompt:
      [
        params.extraSystemPrompt,
        s.accountComputerTurnPromptText,
        s.executionPreflight.bindingPrompt,
        s.seatTurnForExec?.bound
          ? formatOperatorComputerTurnPrompt(s.seatTurnForExec.operatorComputerNodeId, {
              alwaysAllowDesktop: s.seatTurnForExec.operatorComputerAlwaysAllowDesktop,
            })
          : undefined,
      ]
        .filter((part) => part?.trim())
        .join("\n\n") || undefined,
    executionPreferenceHint: s.executionPreferenceHint,
    organizationContext: params.organizationContext,
    ownerNumbers: params.ownerNumbers,
    ownerDisplay: s.ownerDisplay.ownerDisplay,
    ownerDisplaySecret: s.ownerDisplay.ownerDisplaySecret,
    reasoningTagHint: s.reasoningTagHint,
    heartbeatPrompt:
      params.omitHeartbeatPrompt || !s.isDefaultAgent
        ? undefined
        : resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt),
    skillsPrompt: s.skillsPrompt,
    docsPath: s.docsPath ?? undefined,
    ttsHint: s.ttsHint,
    workspaceNotes: s.workspaceNotes,
    reactionGuidance: s.reactionGuidance,
    promptMode: s.promptMode,
    acpEnabled: params.config?.acp?.enabled !== false,
    runtimeInfo: s.runtimeInfo,
    messageToolHints: s.messageToolHints,
    sandboxInfo: s.sandboxInfo,
    tools: s.tools,
    modelAliasLines: buildModelAliasLines(params.config),
    userTimezone: s.userTimezone,
    userTime: s.userTime,
    userTimeFormat: s.userTimeFormat,
    contextFiles: s.contextFiles,
    bootstrapTruncationWarningLines: s.bootstrapPromptWarning.lines,
    memoryCitationsMode: params.config?.memory?.citations,
  });
  s.systemPromptReport = buildSystemPromptReport({
    source: "run",
    generatedAt: Date.now(),
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.modelId,
    workspaceDir: s.effectiveWorkspace,
    bootstrapMaxChars: s.bootstrapMaxChars,
    bootstrapTotalMaxChars: s.bootstrapTotalMaxChars,
    bootstrapTruncation: buildBootstrapTruncationReportMeta({
      analysis: s.bootstrapAnalysis,
      warningMode: s.bootstrapPromptWarningMode,
      warning: s.bootstrapPromptWarning,
    }),
    sandbox: (() => {
      const runtime = resolveSandboxRuntimeStatus({
        cfg: params.config,
        sessionKey: s.sandboxSessionKey,
      });
      return { mode: runtime.mode, sandboxed: runtime.sandboxed };
    })(),
    systemPrompt: s.appendPrompt,
    bootstrapFiles: s.hookAdjustedBootstrapFiles,
    injectedFiles: s.contextFiles,
    skillsPrompt: s.skillsPrompt,
    tools: s.tools,
  });
  s.systemPromptOverride = createSystemPromptOverride(s.appendPrompt);
  s.systemPromptText = s.systemPromptOverride();
  s.sessionLock = await acquireSessionWriteLock({
    sessionFile: params.sessionFile,
    maxHoldMs: resolveSessionLockMaxHoldFromTimeout({
      timeoutMs: params.timeoutMs,
    }),
  });

  s.session = undefined;
  s.removeToolResultContextGuard = undefined;
  s.removeContextCompiler = undefined;
  s.removeReplyLanguageReminder = undefined;
  s.removeVisibleReplyRewriter = undefined;
  s.protocolBoundaryState = createProtocolBoundaryState(`${params.runId}:attempt`);
  s.preparedSession = await openAttemptSession({
    sessionFile: params.sessionFile,
    model: { modelApi: params.model?.api, provider: params.provider, modelId: params.modelId },
    guard: {
      agentId: s.sessionAgentId,
      sessionKey: params.sessionKey,
      inputProvenance: params.inputProvenance,
      allowedToolNames: s.allowedToolNames,
      skipUserTranscriptPersist: params.skipUserTranscriptPersist === true,
      refreshBeforeAppend:
        params.skipUserTranscriptPersist === true && Boolean(params.taskExecutionBinding),
    },
    warn: (message) => log.warn(message),
  });
  s.sessionManager = s.preparedSession.manager;
  const phaseValue2 = s.preparedSession;
  s.transcriptPolicy = phaseValue2.transcriptPolicy;
  s.hadSessionFile = phaseValue2.hadSessionFile;
  if (s.hadSessionFile && params.contextEngine?.bootstrap) {
    try {
      await params.contextEngine.bootstrap({
        sessionId: params.sessionId,
        sessionFile: params.sessionFile,
      });
    } catch (bootstrapErr) {
      log.warn(`context engine bootstrap failed: ${String(bootstrapErr)}`);
    }
  }
  await prepareAttemptSessionTranscript({
    preserveUserTranscript: params.skipUserTranscriptPersist === true,
    sessionManager: s.sessionManager,
    sessionFile: params.sessionFile,
    hadSessionFile: s.hadSessionFile,
    sessionId: params.sessionId,
    cwd: s.effectiveWorkspace,
  });
  s.settingsManager = createPreparedEmbeddedPiSettingsManager({
    cwd: s.effectiveWorkspace,
    agentDir: s.agentDir,
    cfg: params.config,
  });
  applyPiAutoCompactionGuard({
    settingsManager: s.settingsManager,
    contextEngineInfo: params.contextEngine?.info,
  });
  // Sets compaction/pruning runtime state and returns extension factories
  // that must be passed to the resource loader for the safeguard to be active.
  s.extensionFactories = buildEmbeddedExtensionFactories({
    cfg: params.config,
    sessionManager: s.sessionManager,
    provider: params.provider,
    modelId: params.modelId,
    model: params.model,
  });
  // Only create an explicit resource loader when there are extension factories
  // to register; otherwise let createAgentSession use its built-in default.
  s.resourceLoader = undefined;
  if (s.extensionFactories.length > 0) {
    s.resourceLoader = new DefaultResourceLoader({
      cwd: s.resolvedWorkspace,
      agentDir: s.agentDir,
      settingsManager: s.settingsManager,
      extensionFactories: s.extensionFactories,
    });
    await s.resourceLoader.reload();
  }
  // Get hook runner early so it's available when creating tools
  s.hookRunner = getGlobalHookRunner();
  const phaseValue3 = splitSdkTools({
    tools: s.tools,
    sandboxEnabled: !!s.sandbox?.enabled,
    deliveryToolSideEffect: params.deliveryToolSideEffect,
    cfg: params.config,
    privateRunBag: params.privateRunBag,
  });
  s.customTools = phaseValue3.customTools;
  // Add client tools (OpenResponses hosted tools) to customTools
  s.clientToolCallDetected = null;
  s.clientToolLoopDetection = resolveToolLoopDetectionConfig({
    cfg: params.config,
    agentId: s.sessionAgentId,
  });
  s.clientToolDefs = s.clientTools
    ? toClientToolDefinitions(
        s.clientTools,
        (toolName, toolParams) => {
          s.clientToolCallDetected = { name: toolName, params: toolParams };
        },
        {
          agentId: s.sessionAgentId,
          sessionKey: s.sandboxSessionKey,
          sessionId: params.sessionId,
          runId: params.runId,
          loopDetection: s.clientToolLoopDetection,
          taskBoundary: params.taskExecutionBinding
            ? captureTaskActionBoundary(params.sessionFile, params.taskExecutionBinding)
            : undefined,
        },
      )
    : [];
  s.allCustomTools = [...s.customTools, ...s.clientToolDefs];
  const phaseValue4 = applyEmbeddedCustomToolPolicy(s.allCustomTools, params.skillPolicy);
  s.filteredCustomTools = phaseValue4.tools;
  s.customToolAllowlist = phaseValue4.allowlist;
  // Tool baseline after the final custom-tool allowlist, before createAgentSession.
  // afterPolicyCount stays toolsRaw.length: server tools after inbound/skill
  // policy, around provider sanitize, before client tools join this allowlist.
  observeAttemptToolPreparation({
    runId: params.runId,
    sessionKey: params.sessionKey,
    constructedCount: s.toolConstruction.readConstructedCount(),
    afterPolicyCount: s.toolsRaw.length,
    exposedAllowlist: s.customToolAllowlist,
    filteredCustomTools: s.filteredCustomTools,
  });
  if (params.runId) {
    emitAgentEvent({
      runId: params.runId,
      stream: "lifecycle",
      data: {
        event: "tools_filtered",
        taskId: s.executionPreflight.taskId,
        sessionId: s.executionPreflight.sessionId,
        attemptNumber: s.executionPreflight.attemptNumber,
        constructedTools: s.attemptToolLanes.constructed,
        afterPolicyTools: s.attemptToolLanes.afterPolicy,
        afterPreflightTools: s.attemptToolLanes.afterPreflight,
        clientTools: s.attemptToolLanes.client,
        passedToSession: s.customToolAllowlist,
      },
    });
  }
}

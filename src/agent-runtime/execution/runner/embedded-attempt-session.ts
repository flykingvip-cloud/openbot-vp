import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { buildEmbeddedExtensionFactories } from "../../../agents/pi-embedded-runner/extensions.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { observeAttemptToolPreparation } from "../../../agents/pi-embedded-runner/run/execution-router-baselines.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import {
  applyEmbeddedCustomToolPolicy,
  splitSdkTools,
} from "../../../agents/pi-embedded-runner/tool-split.js";
import { createPreparedEmbeddedPiSettingsManager } from "../../../agents/pi-project-settings.js";
import { applyPiAutoCompactionGuard } from "../../../agents/pi-settings.js";
import { toClientToolDefinitions } from "../../../agents/pi-tool-definition-adapter.js";
import { resolveToolLoopDetectionConfig } from "../../../agents/pi-tools.js";
import { createProtocolBoundaryState } from "../../../agents/protocol-violation.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import { openAttemptSession, prepareAttemptSessionTranscript } from "../../state/index.js";
import { captureTaskActionBoundary } from "../../state/task-action.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-preflight.js";

/** Open the attempt session after the write lock is held. */
export async function runEmbeddedAttemptSession(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  s.sessionManager = undefined;
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
  const phaseValue1 = s.preparedSession;
  s.transcriptPolicy = phaseValue1.transcriptPolicy;
  s.hadSessionFile = phaseValue1.hadSessionFile;
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
  const phaseValue2 = splitSdkTools({
    tools: s.tools,
    sandboxEnabled: !!s.sandbox?.enabled,
    deliveryToolSideEffect: params.deliveryToolSideEffect,
    cfg: params.config,
    privateRunBag: params.privateRunBag,
  });
  s.customTools = phaseValue2.customTools;
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
  const phaseValue3 = applyEmbeddedCustomToolPolicy(s.allCustomTools, params.skillPolicy);
  s.filteredCustomTools = phaseValue3.tools;
  s.customToolAllowlist = phaseValue3.allowlist;
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

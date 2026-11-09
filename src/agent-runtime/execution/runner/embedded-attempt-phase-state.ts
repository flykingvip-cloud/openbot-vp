/** Mutable phase handoff. Each declared field is initialized by its owning sequential phase. */
export class EmbeddedAttemptPhaseState {
  aborted = false;
  timedOut = false;
  timedOutDuringCompaction = false;
  promptError: unknown = null;
  promptErrorSource: "prompt" | "compaction" | null = null;
  declare restoreSkillEnv:
    | ReturnType<typeof import("../../../agents/skills.js").applySkillEnvOverridesFromSnapshot>
    | undefined;
  declare skillsPrompt: ReturnType<typeof import("../../context/index.js").renderRunSkillContext>;
  declare bootstrapMaxChars: ReturnType<
    typeof import("../../../agents/pi-embedded-helpers.js").resolveBootstrapMaxChars
  >;
  declare bootstrapTotalMaxChars: ReturnType<
    typeof import("../../../agents/pi-embedded-helpers.js").resolveBootstrapTotalMaxChars
  >;
  declare bootstrapAnalysis: ReturnType<
    typeof import("../../../agents/bootstrap-budget.js").analyzeBootstrapBudget
  >;
  declare bootstrapPromptWarningMode: ReturnType<
    typeof import("../../../agents/pi-embedded-helpers.js").resolveBootstrapPromptTruncationWarningMode
  >;
  declare bootstrapPromptWarning: ReturnType<
    typeof import("../../../agents/bootstrap-budget.js").buildBootstrapPromptWarning
  >;
  declare effectiveFsWorkspaceOnly: ReturnType<
    typeof import("../../capabilities/index.js").resolveAttemptFsWorkspaceOnly
  >;
  declare preferredNodeIds: ReturnType<
    typeof import("../../../infra/operator-local-computer.js").collectConnectedPreferredNodeIds
  >;
  declare seatTurnForExec: Awaited<
    ReturnType<typeof import("../../../gateway/seat-rules/turn-context.js").resolveSeatTurnContext>
  >;
  declare toolConstruction: {
    createTools: () => ReturnType<
      typeof import("../../../agents/pi-tools.js").createOpenClawCodingTools
    >;
    readConstructedCount: () => number;
  };
  declare toolsRaw: ReturnType<
    typeof import("../../../agents/pi-tools.js").createOpenClawCodingTools
  >;
  declare toolsEnabled: ReturnType<
    typeof import("../../../agents/model-tool-support.js").supportsModelTools
  >;
  declare policyTools: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/google.js").sanitizeToolsForGoogle
  >;
  declare executionTaskId: ReturnType<
    typeof import("../../../agents/execution-preflight/index.js").resolveExecutionTaskId
  >;
  declare executionPreflight: ReturnType<
    typeof import("../../../agents/execution-preflight/index.js").buildExecutionPreflight
  >;
  declare tools: ReturnType<
    typeof import("../../../agents/execution-preflight/index.js").applyPreflightToTools
  >;
  declare ceilingClientTools: import("../../../agents/pi-embedded-runner/run/types.js").EmbeddedRunAttemptParams["clientTools"];
  declare providerSafeClientTools: import("../../../agents/pi-embedded-runner/run/types.js").EmbeddedRunAttemptParams["clientTools"];
  declare clientTools: import("../../../agents/pi-embedded-runner/run/types.js").EmbeddedRunAttemptParams["clientTools"];
  declare allowedToolNames: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/tool-name-allowlist.js").collectAllowedToolNames
  >;
  declare lifecycleSkillNamesLoaded: ReturnType<
    typeof import("../../../gateway/skill-invocation/lifecycle-tool-attribution.js").resolveLifecycleSkillNamesLoaded
  >;
  declare subscription: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >;
  declare systemPromptText: ReturnType<
    typeof import("../../context/index.js").prependSystemPromptAddition
  >;
  declare contextCompileState: ReturnType<
    typeof import("../../capabilities/index.js").createContextCompileState
  >;
  declare removeContextCompiler:
    | ReturnType<typeof import("../../capabilities/index.js").installContextCompilerTransform>
    | undefined;
  declare removeToolResultContextGuard:
    | ReturnType<
        typeof import("../../../agents/pi-embedded-runner/tool-result-context-guard.js").installToolResultContextGuard
      >
    | undefined;
  declare removeReplyLanguageReminder:
    | ReturnType<
        typeof import("../../../agents/pi-embedded-runner/reply-language-reminder.js").installReplyLanguageReminder
      >
    | undefined;
  declare cacheTrace: ReturnType<typeof import("../../../agents/cache-trace.js").createCacheTrace>;
  declare anthropicPayloadLogger: ReturnType<
    typeof import("../../../agents/anthropic-payload-log.js").createAnthropicPayloadLogger
  >;
  declare resolvedStreamApiKey: Awaited<
    ReturnType<
      typeof import("../../../agents/pi-embedded-runner/stream-api-key.js").resolveStreamApiKey
    >
  >;
  declare removeVisibleReplyRewriter:
    | ReturnType<
        typeof import("../../../shared/text/visible-reply-language.js").registerVisibleReplyRewriter
      >
    | undefined;
  declare machineName: Awaited<
    ReturnType<typeof import("../../../infra/machine-name.js").getMachineDisplayName>
  >;
  declare runtimeChannel: ReturnType<
    typeof import("../../../utils/message-channel.js").normalizeMessageChannel
  >;
  declare sandboxInfo: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/sandbox-info.js").buildEmbeddedSandboxInfo
  >;
  declare reasoningTagHint: ReturnType<
    typeof import("../../../utils/provider-utils.js").isReasoningTagProvider
  >;
  declare channelActions:
    | ReturnType<typeof import("../../../agents/channel-tools.js").listChannelSupportedActions>
    | undefined;
  declare messageToolHints:
    | ReturnType<typeof import("../../../agents/channel-tools.js").resolveChannelMessageToolHints>
    | undefined;
  declare defaultModelRef: ReturnType<
    typeof import("../../../agents/model-selection.js").resolveDefaultModelForAgent
  >;
  declare defaultModelLabel: string;
  declare promptMode: ReturnType<
    typeof import("../../policy/index.js").resolvePromptModeForSession
  >;
  declare docsPath: Awaited<
    ReturnType<typeof import("../../../agents/docs-path.js").resolveOpenClawDocsPath>
  >;
  declare ttsHint:
    | ReturnType<typeof import("../../../tts/tts.js").buildTtsSystemPromptHint>
    | undefined;
  declare ownerDisplay: ReturnType<
    typeof import("../../../agents/owner-display.js").resolveOwnerDisplaySetting
  >;
  declare executionPreferenceHint:
    | ReturnType<
        typeof import("../../../agents/pi-embedded-runner/run/execution-preference-hint.js").buildExecutionPreferenceHint
      >
    | undefined;
  declare appendPrompt: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/system-prompt.js").buildEmbeddedSystemPrompt
  >;
  declare systemPromptReport: ReturnType<
    typeof import("../../../agents/system-prompt-report.js").buildSystemPromptReport
  >;
  declare systemPromptOverride: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/system-prompt.js").createSystemPromptOverride
  >;
  declare sessionLock: Awaited<
    ReturnType<typeof import("../../../agents/session-write-lock.js").acquireSessionWriteLock>
  >;
  declare protocolBoundaryState: ReturnType<
    typeof import("../../../agents/protocol-violation.js").createProtocolBoundaryState
  >;
  declare preparedSession: Awaited<
    ReturnType<typeof import("../../state/index.js").openAttemptSession>
  >;
  declare settingsManager: ReturnType<
    typeof import("../../../agents/pi-project-settings.js").createPreparedEmbeddedPiSettingsManager
  >;
  declare extensionFactories: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/extensions.js").buildEmbeddedExtensionFactories
  >;
  declare resourceLoader:
    | InstanceType<typeof import("@earendil-works/pi-coding-agent").DefaultResourceLoader>
    | undefined;
  declare hookRunner: ReturnType<
    typeof import("../../../plugins/hook-runner-global.js").getGlobalHookRunner
  >;
  declare clientToolLoopDetection: ReturnType<
    typeof import("../../../agents/pi-tools.js").resolveToolLoopDetectionConfig
  >;
  declare clientToolDefs: ReturnType<
    typeof import("../../../agents/pi-tool-definition-adapter.js").toClientToolDefinitions
  >;
  declare resolvedWorkspace: ReturnType<typeof import("../../../utils.js").resolveUserPath>;
  declare runAbortController: AbortController;
  declare sandbox: Awaited<
    ReturnType<typeof import("../../capabilities/index.js").resolveAttemptSandbox>
  >;
  declare accountComputerRoute:
    | ReturnType<
        typeof import("../../../agents/sandbox/account-computer-browser-routing.js").resolveAccountComputerWebRoute
      >
    | undefined;
  declare accountComputerTurnPromptText:
    | ReturnType<
        typeof import("../../../agents/sandbox/account-computer-browser-routing.js").accountComputerTurnPrompt
      >
    | undefined;
  declare effectiveWorkspace: ReturnType<
    typeof import("../../../agents/sandbox/effective-workspace.js").resolveEffectiveSandboxWorkspaceDir
  >;
  declare prevCwd: string;
  declare sandboxSessionKey: string;
  declare accountSandboxLocations: boolean;
  declare skillContextInput: Parameters<
    typeof import("../../../agents/pi-embedded-runner/skills-runtime.js").resolveEmbeddedRunSkillEntries
  >[0];
  declare preparedSkillContext: {
    input: EmbeddedAttemptPhaseState["skillContextInput"];
    selection: ReturnType<
      typeof import("../../../agents/pi-embedded-runner/skills-runtime.js").resolveEmbeddedRunSkillEntries
    >;
  };
  declare skillEntries: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/skills-runtime.js").resolveEmbeddedRunSkillEntries
  >["skillEntries"];
  declare preferLiveEntries: boolean;
  declare hookAdjustedBootstrapFiles: Awaited<
    ReturnType<typeof import("../../../agents/bootstrap-files.js").resolveBootstrapContextForRun>
  >["bootstrapFiles"];
  declare contextFiles: Awaited<
    ReturnType<typeof import("../../../agents/bootstrap-files.js").resolveBootstrapContextForRun>
  >["contextFiles"];
  declare sessionLabel: string;
  declare workspaceNotes: string[] | undefined;
  declare agentDir: string;
  declare defaultAgentId: string;
  declare sessionAgentId: string;
  declare modelHasVision: boolean;
  declare operatorEmail: string | undefined;
  declare seatExecPreference:
    | NonNullable<EmbeddedAttemptPhaseState["seatTurnForExec"]>["execPreference"]
    | undefined;
  declare operatorComputerBindingTarget:
    | { tenantId: string; seatId: string; operatorUserId: string }
    | undefined;
  declare attemptToolLanes: {
    constructed: string[];
    afterPolicy: string[];
    afterPreflight: string[];
    client: string[];
  };
  declare queueHandle: Parameters<typeof import("./run-registry.js").setActiveEmbeddedRun>[1];
  declare abortTimer: ReturnType<typeof setTimeout> | undefined;
  declare abortWarnTimer: ReturnType<typeof setTimeout> | undefined;
  declare messagesSnapshot: import("@earendil-works/pi-agent-core").AgentMessage[];
  declare sessionIdUsed: string;
  declare onAbort: () => void;
  declare hookAgentId: string;
  declare prePromptMessageCount: number;
  declare promptStartedAt: number;
  declare makeAbortError: (signal: AbortSignal) => Error;
  declare abortRun: (isTimeout?: boolean, reason?: unknown) => void;
  declare abortable: <T>(promise: Promise<T>) => Promise<T>;
  declare session:
    | Awaited<
        ReturnType<typeof import("@earendil-works/pi-coding-agent").createAgentSession>
      >["session"]
    | undefined;
  declare activeSession: Awaited<
    ReturnType<typeof import("@earendil-works/pi-coding-agent").createAgentSession>
  >["session"];
  declare runtimeCapabilities: string[] | undefined;
  declare reactionGuidance: { level: "minimal" | "extensive"; channel: string } | undefined;
  declare runtimeInfo: ReturnType<
    typeof import("../../../agents/system-prompt-params.js").buildSystemPromptParams
  >["runtimeInfo"];
  declare userTimezone: ReturnType<
    typeof import("../../../agents/system-prompt-params.js").buildSystemPromptParams
  >["userTimezone"];
  declare userTime: ReturnType<
    typeof import("../../../agents/system-prompt-params.js").buildSystemPromptParams
  >["userTime"];
  declare userTimeFormat: ReturnType<
    typeof import("../../../agents/system-prompt-params.js").buildSystemPromptParams
  >["userTimeFormat"];
  declare isDefaultAgent: boolean;
  declare isProbeSession: boolean;
  declare sessionManager: Awaited<
    ReturnType<typeof import("../../state/index.js").openAttemptSession>
  >["manager"];
  declare transcriptPolicy: Awaited<
    ReturnType<typeof import("../../state/index.js").openAttemptSession>
  >["transcriptPolicy"];
  declare hadSessionFile: boolean;
  declare customTools: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/tool-split.js").splitSdkTools
  >["customTools"];
  declare clientToolCallDetected: { name: string; params: Record<string, unknown> } | null;
  declare allCustomTools: NonNullable<EmbeddedAttemptPhaseState["clientToolDefs"]>;
  declare filteredCustomTools: ReturnType<
    typeof import("../../../agents/pi-tool-definition-adapter.js").toToolDefinitions
  >;
  declare customToolAllowlist: ReturnType<
    typeof import("../../../agents/pi-embedded-runner/tool-split.js").applyEmbeddedCustomToolPolicy
  >["allowlist"];
  declare preCompactionSnapshot: import("@earendil-works/pi-agent-core").AgentMessage[] | null;
  declare preCompactionSessionId: string | undefined;
  declare compactionOccurredThisAttempt: boolean;
  declare assistantTexts: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["assistantTexts"];
  declare toolMetas: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["toolMetas"];
  declare unsubscribe: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["unsubscribe"];
  declare waitForCompactionRetry: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["waitForCompactionRetry"];
  declare isCompactionInFlight: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["isCompactionInFlight"];
  declare flushPendingCompactionEnd: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["flushPendingCompactionEnd"];
  declare getMessagingToolSentTexts: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["getMessagingToolSentTexts"];
  declare getMessagingToolSentMediaUrls: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["getMessagingToolSentMediaUrls"];
  declare getMessagingToolSentTargets: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["getMessagingToolSentTargets"];
  declare getSuccessfulCronAdds: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["getSuccessfulCronAdds"];
  declare didSendViaMessagingTool: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["didSendViaMessagingTool"];
  declare getLastToolError: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["getLastToolError"];
  declare getUsageTotals: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["getUsageTotals"];
  declare getCompactionCount: ReturnType<
    typeof import("../../../agents/pi-embedded-subscribe.js").subscribeEmbeddedPiSession
  >["getCompactionCount"];
}

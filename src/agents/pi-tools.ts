import { createReadTool } from "@earendil-works/pi-coding-agent";
import type { TaskCompletionBinding } from "../agent-runtime/contracts/task.js";
import { captureTaskActionBoundary } from "../agent-runtime/state/task-action.js";
import type { OpenBotConfig } from "../config/config.js";
import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import {
  applyLaneModeToolPolicy,
  isDeliveryLaneEnabled,
  laneModeDenyToolPolicy,
  resolveActiveDeliveryLaneMode,
  type LaneMode,
} from "../gateway/delivery-lane/index.js";
import {
  inheritExecutionIdentityRunFields,
  type ExecutionIdentityContext,
} from "../gateway/execution-identity-context.js";
import {
  createLifecycleSkillIdentityTools,
  wrapToolsWithUniqueOwnerSkillInjection,
} from "../gateway/skill-execution-binding/skill-tool-wrappers.js";
import { resolveMergedSafeBinProfileFixtures } from "../infra/exec-safe-bin-runtime-policy.js";
import { logWarn } from "../logger.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveGatewayMessageChannel } from "../utils/message-channel.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { createApplyPatchTool } from "./apply-patch.js";
import {
  createExecTool,
  createProcessTool,
  type ExecToolDefaults,
  type ProcessToolDefaults,
} from "./bash-tools.js";
import { listChannelAgentTools } from "./channel-tools.js";
import { resolveImageSanitizationLimits } from "./image-sanitization.js";
import { applyInboundToolCeiling, type InboundToolCeiling } from "./inbound-tool-policy.js";
import type { ModelAuthMode } from "./model-auth.js";
import { createOpenClawTools } from "./openclaw-tools.js";
import { createWorkspaceCodingTools } from "./pi-sdk/coding-tools.js";
import { wrapToolWithAbortSignal } from "./pi-tools.abort.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import {
  isToolAllowedByPolicies,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicyForSession,
} from "./pi-tools.policy.js";
import {
  assertRequiredParams,
  createHostWorkspaceEditTool,
  createHostWorkspaceWriteTool,
  createOpenClawReadTool,
  createSandboxedEditTool,
  createSandboxedReadTool,
  createSandboxedWriteTool,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolMemoryFlushAppendOnlyWrite,
  wrapToolWorkspaceRootGuard,
  wrapToolWorkspaceRootGuardWithOptions,
  wrapToolParamNormalization,
} from "./pi-tools.read.js";
import {
  cleanToolSchemaForGemini,
  normalizeToolNamesForProvider,
  normalizeToolParameters,
} from "./pi-tools.schema.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import type { SandboxContext } from "./sandbox.js";
import {
  ensureAccountComputerControlTools,
  policyExplicitlyDeniesTool,
} from "./sandbox/account-computer-browser-routing.js";
import { isAccountExecWorkspaceMount } from "./sandbox/effective-workspace.js";
import { isXaiProvider } from "./schema/clean-for-xai.js";
import {
  createToolFsPolicy,
  resolveEffectiveToolFsWorkspaceOnly,
  resolveEffectiveToolWriteChannels,
  resolveToolFsConfig,
} from "./tool-fs-policy.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
} from "./tool-policy-pipeline.js";
import {
  applyOwnerOnlyToolPolicy,
  collectExplicitAllowlist,
  mergeAlsoAllowPolicy,
  mergeMentionedPluginToolAllowlist,
  resolveToolProfilePolicy,
} from "./tool-policy.js";
import { createLocalFileToolsIfAvailable } from "./tools/local-file-tool-registration.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

function isOpenAIProvider(provider?: string) {
  const normalized = provider?.trim().toLowerCase();
  return normalized === "openai" || normalized === "openai-codex";
}

const TOOL_DENY_BY_MESSAGE_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  voice: ["tts"],
};
const TOOL_DENY_FOR_XAI_PROVIDERS = new Set(["web_search"]);
const MEMORY_FLUSH_ALLOWED_TOOL_NAMES = new Set(["read", "write"]);

function normalizeMessageProvider(messageProvider?: string): string | undefined {
  const normalized = messageProvider?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function applyMessageProviderToolPolicy(
  tools: AnyAgentTool[],
  messageProvider?: string,
): AnyAgentTool[] {
  const normalizedProvider = normalizeMessageProvider(messageProvider);
  if (!normalizedProvider) {
    return tools;
  }
  const deniedTools = TOOL_DENY_BY_MESSAGE_PROVIDER[normalizedProvider];
  if (!deniedTools || deniedTools.length === 0) {
    return tools;
  }
  const deniedSet = new Set(deniedTools);
  return tools.filter((tool) => !deniedSet.has(tool.name));
}

function applyModelProviderToolPolicy(
  tools: AnyAgentTool[],
  params?: { modelProvider?: string; modelId?: string },
): AnyAgentTool[] {
  if (!isXaiProvider(params?.modelProvider, params?.modelId)) {
    return tools;
  }
  // xAI/Grok providers expose a native web_search tool; sending OpenBot's
  // web_search alongside it causes duplicate-name request failures.
  return tools.filter((tool) => !TOOL_DENY_FOR_XAI_PROVIDERS.has(tool.name));
}

function isApplyPatchAllowedForModel(params: {
  modelProvider?: string;
  modelId?: string;
  allowModels?: string[];
}) {
  const allowModels = Array.isArray(params.allowModels) ? params.allowModels : [];
  if (allowModels.length === 0) {
    return true;
  }
  const modelId = params.modelId?.trim();
  if (!modelId) {
    return false;
  }
  const normalizedModelId = modelId.toLowerCase();
  const provider = params.modelProvider?.trim().toLowerCase();
  const normalizedFull =
    provider && !normalizedModelId.includes("/")
      ? `${provider}/${normalizedModelId}`
      : normalizedModelId;
  return allowModels.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return normalized === normalizedModelId || normalized === normalizedFull;
  });
}

function resolveExecConfig(params: { cfg?: OpenBotConfig; agentId?: string }) {
  const cfg = params.cfg;
  const globalExec = cfg?.tools?.exec;
  const agentExec =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.exec : undefined;
  return {
    host: agentExec?.host ?? globalExec?.host,
    security: agentExec?.security ?? globalExec?.security,
    ask: agentExec?.ask ?? globalExec?.ask,
    node: agentExec?.node ?? globalExec?.node,
    pathPrepend: agentExec?.pathPrepend ?? globalExec?.pathPrepend,
    safeBins: agentExec?.safeBins ?? globalExec?.safeBins,
    safeBinTrustedDirs: agentExec?.safeBinTrustedDirs ?? globalExec?.safeBinTrustedDirs,
    safeBinProfiles: resolveMergedSafeBinProfileFixtures({
      global: globalExec,
      local: agentExec,
    }),
    backgroundMs: agentExec?.backgroundMs ?? globalExec?.backgroundMs,
    timeoutSec: agentExec?.timeoutSec ?? globalExec?.timeoutSec,
    approvalRunningNoticeMs:
      agentExec?.approvalRunningNoticeMs ?? globalExec?.approvalRunningNoticeMs,
    cleanupMs: agentExec?.cleanupMs ?? globalExec?.cleanupMs,
    notifyOnExit: agentExec?.notifyOnExit ?? globalExec?.notifyOnExit,
    notifyOnExitEmptySuccess:
      agentExec?.notifyOnExitEmptySuccess ?? globalExec?.notifyOnExitEmptySuccess,
    applyPatch: agentExec?.applyPatch ?? globalExec?.applyPatch,
  };
}

export function resolveToolLoopDetectionConfig(params: {
  cfg?: OpenBotConfig;
  agentId?: string;
}): ToolLoopDetectionConfig | undefined {
  const global = params.cfg?.tools?.loopDetection;
  const agent =
    params.agentId && params.cfg
      ? resolveAgentConfig(params.cfg, params.agentId)?.tools?.loopDetection
      : undefined;

  if (!agent) {
    return global;
  }
  if (!global) {
    return agent;
  }

  return {
    ...global,
    ...agent,
    detectors: {
      ...global.detectors,
      ...agent.detectors,
    },
  };
}

export const __testing = {
  cleanToolSchemaForGemini,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
  assertRequiredParams,
  applyModelProviderToolPolicy,
} as const;

export function createOpenClawCodingTools(options?: {
  sessionFile?: string;
  taskExecutionBinding?: TaskCompletionBinding;
  agentId?: string;
  exec?: ExecToolDefaults & ProcessToolDefaults;
  messageProvider?: string;
  agentAccountId?: string;
  messageTo?: string;
  messageThreadId?: string | number;
  sandbox?: SandboxContext | null;
  sessionKey?: string;
  /** Ephemeral session UUID — regenerated on /new and /reset. */
  sessionId?: string;
  /** Stable run identifier for this agent invocation. */
  runId?: string;
  /** What initiated this run (for trigger-specific tool restrictions). */
  trigger?: string;
  /** Relative workspace path that memory-triggered writes may append to. */
  memoryFlushWritePath?: string;
  agentDir?: string;
  workspaceDir?: string;
  /**
   * Workspace directory that spawned subagents should inherit.
   * When sandboxing uses a copied workspace (`ro` or `none`), workspaceDir is the
   * sandbox copy but subagents should inherit the real agent workspace instead.
   * Defaults to workspaceDir when not set.
   */
  spawnWorkspaceDir?: string;
  config?: OpenBotConfig;
  abortSignal?: AbortSignal;
  /**
   * Provider of the currently selected model (used for provider-specific tool quirks).
   * Example: "anthropic", "openai", "google", "openai-codex".
   */
  modelProvider?: string;
  /** Model id for the current provider (used for model-specific tool gating). */
  modelId?: string;
  /** Model context window in tokens (used to scale read-tool output budget). */
  modelContextWindowTokens?: number;
  /**
   * Auth mode for the current provider. We only need this for Anthropic OAuth
   * tool-name blocking quirks.
   */
  modelAuthMode?: ModelAuthMode;
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Current inbound message id for action fallbacks (e.g. Telegram react). */
  currentMessageId?: string | number;
  /** Group id for channel-level tool policy resolution. */
  groupId?: string | null;
  /** Group channel label (e.g. #general) for channel-level tool policy resolution. */
  groupChannel?: string | null;
  /** Group space label (e.g. guild/team id) for channel-level tool policy resolution. */
  groupSpace?: string | null;
  /** Parent session key for subagent group policy inheritance. */
  spawnedBy?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
  /** If true, the model has native vision capability */
  modelHasVision?: boolean;
  /** Require explicit message targets (no implicit last-route sends). */
  requireExplicitMessageTarget?: boolean;
  /** If true, omit the message tool from the tool list. */
  disableMessageTool?: boolean;
  /** Whether the sender is an owner (required for owner-only tools). */
  senderIsOwner?: boolean;
  /** When true, FS tools (read/write/edit/apply_patch) stay inside workspaceDir. */
  forceWorkspaceOnly?: boolean;
  /** Canonical trusted turn identity for Seat-bound tools. */
  executionIdentity?: ExecutionIdentityContext;
  /** Enterprise gateway session user for Seat-bound tools (schedule, meeting, …). */
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: import("../gateway/server-methods/types.js").GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
  /** PR E retrieve read-only ceiling; applied after the normal policy pipeline. */
  inboundToolCeiling?: InboundToolCeiling;
  /** Tip B — explicit DeliveryLane mode for capability mutex. */
  laneMode?: LaneMode | null;
  /** Tip B — lane id for active-mode registry lookup. */
  laneId?: string | null;
  /** Tip B — override delivery-lane feature flag (tests). */
  deliveryLaneEnabled?: boolean;
  /** Focused Knowledge Universe consume refs for knowledge_search / knowledge_get. */
  knowledgeConsumeRefs?: import("../gateway/knowledge/consume-ref.js").KnowledgeConsumeRef[];
  /** Composer @plugin mention OpenBot plugin ids for this turn's optional tools. */
  mentionedPluginToolAllowlist?: string[];
  /**
   * Drop these tools before the model-visible list and the provenance
   * policy_filtered_capabilities snapshot are recorded.
   */
  omitToolNames?: string[];
}): AnyAgentTool[] {
  const execToolName = "exec";
  const sandbox = options?.sandbox?.enabled ? options.sandbox : undefined;
  const isMemoryFlushRun = options?.trigger === "memory";
  if (isMemoryFlushRun && !options?.memoryFlushWritePath) {
    throw new Error("memoryFlushWritePath required for memory-triggered tool runs");
  }
  const memoryFlushWritePath = isMemoryFlushRun ? options.memoryFlushWritePath : undefined;
  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    agentId: options?.agentId,
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  });
  const groupPolicy = resolveGroupToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    spawnedBy: options?.spawnedBy,
    messageProvider: options?.messageProvider,
    groupId: options?.groupId,
    groupChannel: options?.groupChannel,
    groupSpace: options?.groupSpace,
    accountId: options?.agentAccountId,
    senderId: options?.senderId,
    senderName: options?.senderName,
    senderUsername: options?.senderUsername,
    senderE164: options?.senderE164,
  });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  // Prefer sessionKey for process isolation scope to prevent cross-session process visibility/killing.
  // Fallback to agentId if no sessionKey is available (e.g. legacy or global contexts).
  const scopeKey =
    options?.exec?.scopeKey ?? options?.sessionKey ?? (agentId ? `agent:${agentId}` : undefined);
  const subagentPolicy =
    isSubagentSessionKey(options?.sessionKey) && options?.sessionKey
      ? resolveSubagentToolPolicyForSession(options.config, options.sessionKey)
      : undefined;
  const inboundAclPolicies = [
    profilePolicyWithAlsoAllow,
    providerProfilePolicyWithAlsoAllow,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    groupPolicy,
    sandbox?.tools,
    subagentPolicy,
  ];
  const allowBackground = isToolAllowedByPolicies("process", inboundAclPolicies);
  const execConfig = resolveExecConfig({ cfg: options?.config, agentId });
  const fsConfig = resolveToolFsConfig({ cfg: options?.config, agentId });
  const fsPolicy = createToolFsPolicy({
    workspaceOnly:
      options?.forceWorkspaceOnly === true ||
      isMemoryFlushRun ||
      resolveEffectiveToolFsWorkspaceOnly({ cfg: options?.config, agentId }) ||
      fsConfig.workspaceOnly === true,
    writeChannels: resolveEffectiveToolWriteChannels({ cfg: options?.config, agentId }),
  });
  const sandboxRoot = sandbox?.workspaceDir;
  const sandboxFsBridge = sandbox?.fsBridge;
  const allowWorkspaceWrites = sandbox?.workspaceAccess !== "ro";
  // Account Computer mounts operators SoT at /account/workspace. Prefer that host
  // root for coding-tool cwd / workspaceOnly so it cannot stay on a tenants path.
  const workspaceRoot = resolveWorkspaceRoot(
    sandboxRoot && isAccountExecWorkspaceMount(sandbox?.containerWorkdir)
      ? sandboxRoot
      : options?.workspaceDir,
  );
  const workspaceOnly = fsPolicy.workspaceOnly;
  const workspaceGuardIdentity = {
    sessionId: options?.sessionId,
    sessionKey: options?.sessionKey,
    runId: options?.runId,
  };
  const applyPatchConfig = execConfig.applyPatch;
  // Secure by default: apply_patch is workspace-contained unless explicitly disabled.
  // (tools.fs.workspaceOnly is a separate umbrella flag for read/write/edit/apply_patch.)
  const applyPatchWorkspaceOnly = workspaceOnly || applyPatchConfig?.workspaceOnly !== false;
  const applyPatchEnabled =
    !!applyPatchConfig?.enabled &&
    isOpenAIProvider(options?.modelProvider) &&
    isApplyPatchAllowedForModel({
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      allowModels: applyPatchConfig?.allowModels,
    });

  if (sandboxRoot && !sandboxFsBridge) {
    throw new Error("Sandbox filesystem bridge is unavailable.");
  }
  const codingTools = createWorkspaceCodingTools(workspaceRoot);
  const imageSanitization = resolveImageSanitizationLimits(options?.config);

  const base = (codingTools as unknown as AnyAgentTool[]).flatMap((tool) => {
    if (tool.name === "read") {
      if (sandboxRoot) {
        const sandboxed = createSandboxedReadTool({
          root: sandboxRoot,
          bridge: sandboxFsBridge!,
          modelContextWindowTokens: options?.modelContextWindowTokens,
          imageSanitization,
          modelHasVision: options?.modelHasVision,
        });
        return [
          workspaceOnly
            ? wrapToolWorkspaceRootGuardWithOptions(sandboxed, sandboxRoot, {
                containerWorkdir: sandbox.containerWorkdir,
                ...workspaceGuardIdentity,
              })
            : sandboxed,
        ];
      }
      const freshReadTool = createReadTool(workspaceRoot);
      const wrapped = createOpenClawReadTool(freshReadTool, {
        modelContextWindowTokens: options?.modelContextWindowTokens,
        imageSanitization,
        modelHasVision: options?.modelHasVision,
      });
      return [
        workspaceOnly
          ? wrapToolWorkspaceRootGuard(wrapped, workspaceRoot, workspaceGuardIdentity)
          : wrapped,
      ];
    }
    if (tool.name === "bash" || tool.name === execToolName) {
      return [];
    }
    if (tool.name === "write") {
      if (sandboxRoot) {
        return [];
      }
      const wrapped = createHostWorkspaceWriteTool(workspaceRoot, { workspaceOnly });
      return [
        workspaceOnly
          ? wrapToolWorkspaceRootGuard(wrapped, workspaceRoot, workspaceGuardIdentity)
          : wrapped,
      ];
    }
    if (tool.name === "edit") {
      if (sandboxRoot) {
        return [];
      }
      const wrapped = createHostWorkspaceEditTool(workspaceRoot, { workspaceOnly });
      return [
        workspaceOnly
          ? wrapToolWorkspaceRootGuard(wrapped, workspaceRoot, workspaceGuardIdentity)
          : wrapped,
      ];
    }
    return [tool];
  });
  const { cleanupMs: cleanupMsOverride, ...execDefaults } = options?.exec ?? {};
  const execTool = createExecTool({
    ...execDefaults,
    host: options?.exec?.host ?? execConfig.host,
    security: options?.exec?.security ?? execConfig.security,
    ask: options?.exec?.ask ?? execConfig.ask,
    node: options?.exec?.node ?? execConfig.node,
    pathPrepend: options?.exec?.pathPrepend ?? execConfig.pathPrepend,
    safeBins: options?.exec?.safeBins ?? execConfig.safeBins,
    safeBinTrustedDirs: options?.exec?.safeBinTrustedDirs ?? execConfig.safeBinTrustedDirs,
    safeBinProfiles: options?.exec?.safeBinProfiles ?? execConfig.safeBinProfiles,
    agentId,
    cwd: workspaceRoot,
    workspaceOnly,
    workspaceRoot,
    allowBackground,
    scopeKey,
    sessionKey: options?.sessionKey,
    sessionId: options?.sessionId,
    runId: options?.runId,
    messageProvider: options?.messageProvider,
    currentChannelId: options?.currentChannelId,
    currentThreadTs: options?.currentThreadTs,
    accountId: options?.agentAccountId,
    backgroundMs: options?.exec?.backgroundMs ?? execConfig.backgroundMs,
    timeoutSec: options?.exec?.timeoutSec ?? execConfig.timeoutSec,
    approvalRunningNoticeMs:
      options?.exec?.approvalRunningNoticeMs ?? execConfig.approvalRunningNoticeMs,
    notifyOnExit: options?.exec?.notifyOnExit ?? execConfig.notifyOnExit,
    notifyOnExitEmptySuccess:
      options?.exec?.notifyOnExitEmptySuccess ?? execConfig.notifyOnExitEmptySuccess,
    sandbox: sandbox
      ? {
          containerName: sandbox.containerName,
          workspaceDir: sandbox.workspaceDir,
          containerWorkdir: sandbox.containerWorkdir,
          env: sandbox.docker.env,
        }
      : undefined,
  });
  const processTool = createProcessTool({
    cleanupMs: cleanupMsOverride ?? execConfig.cleanupMs,
    scopeKey,
  });
  const applyPatchTool =
    !applyPatchEnabled || (sandboxRoot && !allowWorkspaceWrites)
      ? null
      : createApplyPatchTool({
          cwd: sandboxRoot ?? workspaceRoot,
          sandbox:
            sandboxRoot && allowWorkspaceWrites
              ? { root: sandboxRoot, bridge: sandboxFsBridge! }
              : undefined,
          workspaceOnly: applyPatchWorkspaceOnly,
        });
  const tools: AnyAgentTool[] = [
    ...base,
    ...(sandboxRoot
      ? allowWorkspaceWrites
        ? [
            workspaceOnly
              ? wrapToolWorkspaceRootGuardWithOptions(
                  createSandboxedEditTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
                  sandboxRoot,
                  {
                    containerWorkdir: sandbox.containerWorkdir,
                    ...workspaceGuardIdentity,
                  },
                )
              : createSandboxedEditTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
            workspaceOnly
              ? wrapToolWorkspaceRootGuardWithOptions(
                  createSandboxedWriteTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
                  sandboxRoot,
                  {
                    containerWorkdir: sandbox.containerWorkdir,
                    ...workspaceGuardIdentity,
                  },
                )
              : createSandboxedWriteTool({ root: sandboxRoot, bridge: sandboxFsBridge! }),
          ]
        : []
      : []),
    ...(applyPatchTool ? [applyPatchTool as unknown as AnyAgentTool] : []),
    // Exec is intentionally not wrapped by workspace-root-guard (keeps capability
    // provenance separate). When tools.fs.workspaceOnly is on, createExecTool also
    // consults shared-fs-resource INTERSECT so outside-workspace mutations are
    // denied (write-deny ⇒ exec-deny for that path class). See docs/tools/exec.md.
    execTool as unknown as AnyAgentTool,
    processTool as unknown as AnyAgentTool,
    // Channel docking: include channel-defined agent tools (login, etc.).
    ...listChannelAgentTools({ cfg: options?.config }),
    ...createOpenClawTools({
      sandboxBrowserBridgeUrl:
        sandbox?.browser?.bridgeUrl ??
        (options?.sandbox?.accountComputerBrowser === true
          ? options.sandbox.browser?.bridgeUrl
          : undefined),
      allowHostBrowserControl:
        options?.sandbox?.accountComputerBrowser === true
          ? false
          : sandbox
            ? sandbox.browserAllowHostControl
            : true,
      accountComputerBrowser: options?.sandbox?.accountComputerBrowser === true,
      agentSessionKey: options?.sessionKey,
      agentRunId: options?.runId,
      agentChannel: resolveGatewayMessageChannel(options?.messageProvider),
      agentAccountId: options?.agentAccountId,
      agentTo: options?.messageTo,
      agentThreadId: options?.messageThreadId,
      agentGroupId: options?.groupId ?? null,
      agentGroupChannel: options?.groupChannel ?? null,
      agentGroupSpace: options?.groupSpace ?? null,
      agentDir: options?.agentDir,
      sandboxRoot,
      sandboxFsBridge,
      fsPolicy,
      workspaceDir: workspaceRoot,
      spawnWorkspaceDir: options?.spawnWorkspaceDir
        ? resolveWorkspaceRoot(options.spawnWorkspaceDir)
        : undefined,
      sandboxed: !!sandbox,
      config: options?.config,
      pluginToolAllowlist: mergeMentionedPluginToolAllowlist(
        collectExplicitAllowlist([
          profilePolicy,
          providerProfilePolicy,
          globalPolicy,
          globalProviderPolicy,
          agentPolicy,
          agentProviderPolicy,
          groupPolicy,
          sandbox?.tools,
          subagentPolicy,
        ]),
        options?.mentionedPluginToolAllowlist,
      ),
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      currentMessageId: options?.currentMessageId,
      replyToMode: options?.replyToMode,
      hasRepliedRef: options?.hasRepliedRef,
      modelHasVision: options?.modelHasVision,
      requireExplicitMessageTarget: options?.requireExplicitMessageTarget,
      disableMessageTool: options?.disableMessageTool,
      requesterAgentIdOverride: agentId,
      requesterSenderId: options?.senderId,
      senderIsOwner: options?.senderIsOwner,
      sessionId: options?.sessionId,
      ...inheritExecutionIdentityRunFields(options),
      knowledgeConsumeRefs: options?.knowledgeConsumeRefs,
    }),
  ];
  const toolsForMemoryFlush =
    isMemoryFlushRun && memoryFlushWritePath
      ? tools.flatMap((tool) => {
          if (!MEMORY_FLUSH_ALLOWED_TOOL_NAMES.has(tool.name)) {
            return [];
          }
          if (tool.name === "write") {
            return [
              wrapToolMemoryFlushAppendOnlyWrite(tool, {
                root: sandboxRoot ?? workspaceRoot,
                relativePath: memoryFlushWritePath,
                containerWorkdir: sandbox?.containerWorkdir,
                sandbox:
                  sandboxRoot && sandboxFsBridge
                    ? { root: sandboxRoot, bridge: sandboxFsBridge }
                    : undefined,
              }),
            ];
          }
          return [tool];
        })
      : tools;
  // Local disk read grant: offered only when the gateway runtime is in this process
  // and a trusted turn identity is available, otherwise omitted entirely. Advertising
  // a capability that can never succeed just teaches the model to retry it.
  // Design: docs/design/openbot-local-disk-read-grant-2026-09-29.md sections 4.3, 4.6.
  const withLocalFileTools = [
    ...toolsForMemoryFlush,
    ...createLocalFileToolsIfAvailable({
      executionIdentity: options?.executionIdentity,
      agentId,
      sessionKey: options?.sessionKey,
      runId: options?.runId,
      currentMessageId: options?.currentMessageId,
    }),
  ];
  const toolsForMessageProvider = applyMessageProviderToolPolicy(
    withLocalFileTools,
    options?.messageProvider,
  );
  const toolsForModelProvider = applyModelProviderToolPolicy(toolsForMessageProvider, {
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  });
  // Security: treat unknown/undefined as unauthorized (opt-in, not opt-out)
  const senderIsOwner = options?.senderIsOwner === true;
  const toolsByAuthorization = applyOwnerOnlyToolPolicy(toolsForModelProvider, senderIsOwner);
  const subagentFiltered = applyToolPolicyPipeline({
    tools: toolsByAuthorization,
    toolMeta: (tool) => getPluginToolMeta(tool),
    warn: logWarn,
    steps: [
      ...buildDefaultToolPolicyPipelineSteps({
        profilePolicy: profilePolicyWithAlsoAllow,
        profile,
        providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
        providerProfile,
        globalPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        groupPolicy,
        agentId,
      }),
      { policy: sandbox?.tools, label: "sandbox tools.allow" },
      { policy: subagentPolicy, label: "subagent tools.allow" },
      {
        policy: (() => {
          const laneEnabled =
            typeof options?.deliveryLaneEnabled === "boolean"
              ? options.deliveryLaneEnabled
              : isDeliveryLaneEnabled();
          if (!laneEnabled) {
            return undefined;
          }
          const mode =
            options?.laneMode ??
            resolveActiveDeliveryLaneMode({
              agentId,
              laneId: options?.laneId,
              env: { OPENBOT_DELIVERY_LANE_ENABLED: "1" },
              readConfig: () => false,
            }).mode;
          const deny = laneModeDenyToolPolicy(mode).deny;
          return deny.length > 0 ? { deny } : undefined;
        })(),
        label: "delivery-lane LaneMode mutex",
      },
    ],
  });
  const accountComputerExplicitDeny = (toolName: string) =>
    [
      globalPolicy,
      globalProviderPolicy,
      agentPolicy,
      agentProviderPolicy,
      groupPolicy,
      subagentPolicy,
    ].some((policy) => policyExplicitlyDeniesTool(policy, toolName));
  const withAccountComputer =
    options?.sandbox?.accountComputerBrowser === true
      ? ensureAccountComputerControlTools({
          tools: subagentFiltered,
          browserTool: toolsByAuthorization.find((tool) => tool.name === "browser"),
          secureFormTool: toolsByAuthorization.find((tool) => tool.name === "secure_form"),
          loginTool: toolsByAuthorization.find((tool) => tool.name === "account_computer_login"),
          webFetchTool: toolsByAuthorization.find((tool) => tool.name === "web_fetch"),
          webSearchTool: toolsByAuthorization.find((tool) => tool.name === "web_search"),
          explicitDeny: {
            browser: accountComputerExplicitDeny("browser"),
            secureForm: accountComputerExplicitDeny("secure_form"),
            login: accountComputerExplicitDeny("account_computer_login"),
            webFetch: accountComputerExplicitDeny("web_fetch"),
            webSearch: accountComputerExplicitDeny("web_search"),
          },
        })
      : subagentFiltered;
  const omittedToolNames = new Set(
    (options?.omitToolNames ?? []).map((name) => name.trim()).filter((name) => name.length > 0),
  );
  const modelVisible =
    omittedToolNames.size > 0
      ? withAccountComputer.filter((tool) => !omittedToolNames.has(tool.name))
      : withAccountComputer;
  // Always normalize tool JSON Schemas before handing them to pi-agent/pi-ai.
  // Without this, some providers (notably OpenAI) will reject root-level union schemas.
  // Provider-specific cleaning: Gemini needs constraint keywords stripped, but Anthropic expects them.
  const normalized = modelVisible.map((tool) =>
    normalizeToolParameters(tool, {
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
    }),
  );
  // Lifecycle skill attribution: inject openbotSkillId on unique-owner tools,
  // and expose identity-wrapped tools (ob_sk_<skillId>__<tool>) for shared tools.
  const withSkillAttribution = attachLifecycleSkillToolAttribution(normalized, agentId);
  // OpenAI/DeepSeek reject illegal function.name characters; sanitize before hooks/dispatch.
  const withProviderSafeNames = normalizeToolNamesForProvider(withSkillAttribution);

  const candidateCapabilities = toolsByAuthorization.map((tool) => tool.name);
  // Record the list the model actually receives, after per-turn strips such as
  // hiding browser on a public-fetch turn.
  const policyFilteredCapabilities = withProviderSafeNames.map((tool) => tool.name);
  const withHooks = withProviderSafeNames.map((tool) =>
    wrapToolWithBeforeToolCallHook(tool, {
      agentId,
      sessionKey: options?.sessionKey,
      sessionId: options?.sessionId,
      runId: options?.runId,
      taskBoundary:
        options?.sessionFile && options.taskExecutionBinding
          ? captureTaskActionBoundary(options.sessionFile, options.taskExecutionBinding)
          : undefined,
      loopDetection: resolveToolLoopDetectionConfig({ cfg: options?.config, agentId }),
      candidateCapabilities,
      policyFilteredCapabilities,
    }),
  );
  const withAbort = options?.abortSignal
    ? withHooks.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
    : withHooks;

  // NOTE: Keep canonical (lowercase) tool names here.
  // pi-ai's Anthropic OAuth transport remaps tool names to Claude Code-style names
  // on the wire and maps them back for tool dispatch.
  const afterInbound = !options?.inboundToolCeiling
    ? withAbort
    : applyInboundToolCeiling({
        tools: withAbort,
        ceiling: options.inboundToolCeiling,
        isStillAllowed: (toolName) => isToolAllowedByPolicies(toolName, inboundAclPolicies),
      });

  // Tip B live hook: accept|review → deny write/edit/apply_patch (+ exec merge argv at execute).
  const laneEnabled =
    typeof options?.deliveryLaneEnabled === "boolean"
      ? options.deliveryLaneEnabled
      : isDeliveryLaneEnabled();
  const laneMode =
    options?.laneMode ??
    (laneEnabled
      ? resolveActiveDeliveryLaneMode({
          agentId,
          laneId: options?.laneId,
          env: { OPENBOT_DELIVERY_LANE_ENABLED: "1" },
          readConfig: () => false,
        }).mode
      : undefined);
  return applyLaneModeToolPolicy({
    tools: afterInbound,
    mode: laneMode,
    deliveryLaneEnabled: laneEnabled,
    channel: "agent-tool",
  });
}

function attachLifecycleSkillToolAttribution(
  tools: AnyAgentTool[],
  agentId: string | undefined,
): AnyAgentTool[] {
  if (!agentId?.trim()) {
    return tools;
  }
  try {
    const withInject = wrapToolsWithUniqueOwnerSkillInjection({ tools, agentId });
    const identity = createLifecycleSkillIdentityTools({ baseTools: tools, agentId });
    // Cap identity tools to avoid flooding the model catalog.
    return [...withInject, ...identity.slice(0, 48)];
  } catch {
    return tools;
  }
}

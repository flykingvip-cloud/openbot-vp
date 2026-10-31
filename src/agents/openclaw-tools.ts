import type { OpenBotConfig } from "../config/config.js";
import {
  resolveExecutionIdentityFromRunFields,
  toTrustedGatewayClientFields,
  type ExecutionIdentityContext,
} from "../gateway/execution-identity-context.js";
import { actorIdFromIdentity } from "../gateway/governance/spawn-snapshot-handoff.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { getActiveRuntimeWebToolsMetadata } from "../secrets/runtime.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import { resolveSessionAgentId } from "./agent-scope.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import type { SpawnedToolContext } from "./spawned-context.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import { createAccountComputerLoginTool } from "./tools/account-computer-login-tool.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createBrowserTool } from "./tools/browser-tool.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import {
  createCollaborationBoardTool,
  shouldExposeCollaborationBoardTool,
} from "./tools/collaboration-board-tool.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createConfirmDiagnosePrescriptionTool } from "./tools/confirm-diagnose-evolution-tool.js";
import { createConversationSendTool } from "./tools/conversation-send-tool.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createDataCapabilityTool } from "./tools/data-capability-tool.js";
import { createDiagnoseTool } from "./tools/diagnose-tool.js";
import { createEvolutionPerceptionTool } from "./tools/evolution-perception-tool.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createGuidanceEventTool } from "./tools/guidance-event-tool.js";
import { createImageTool } from "./tools/image-tool.js";
import {
  createKnowledgeGetTool,
  createKnowledgeSearchTool,
} from "./tools/knowledge-consume-tool.js";
import { createKnowledgeSourceTool } from "./tools/knowledge-source-tool.js";
import { createMeetingTool } from "./tools/meeting-tool.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createOperationalIdentityTool } from "./tools/operational-identity-tool.js";
import { createOrganizationMemoryTool } from "./tools/organization-memory-tool.js";
import { createOrganizationTasksTool } from "./tools/organization-tasks-tool.js";
import { createPdfTool } from "./tools/pdf-tool.js";
import { createScheduleTool } from "./tools/schedule-tool.js";
import { createScheduledTaskTool } from "./tools/scheduled-task-tool.js";
import { createSecureFormTool } from "./tools/secure-form-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSiteCapabilityTools } from "./tools/site-capability-tools.js";
import { createSkillAssetSaveTool } from "./tools/skill-asset-save-tool.js";
import { createStepfunImageTool } from "./tools/stepfun-image-tool.js";
import { createSubagentsTool } from "./tools/subagents-tool.js";
import { createSunoMusicTool } from "./tools/suno-music-tool.js";
import { createTenantUserNotifyTool } from "./tools/tenant-user-notify-tool.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createUserOperationalIdentityTool } from "./tools/user-operational-identity-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

/** Map composition-root turn options → discuss_to_task inbound columns (never model-filled). */
export function resolveDiscussToTaskInboundInjection(options?: {
  currentMessageId?: string | number;
  agentRunId?: string;
  requesterSenderId?: string | null;
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
}): {
  inboundSourceMessageId: string | null;
  inboundPrincipalActor: string | null;
  executionRunId: string | null;
} {
  return {
    // Trusted inbound message id — never agentRunId (execution run ≠ message).
    inboundSourceMessageId:
      options?.currentMessageId != null ? String(options.currentMessageId) : null,
    inboundPrincipalActor:
      options?.requesterSenderId ??
      options?.gatewayClientUser ??
      options?.gatewayClientPlatformUserId ??
      null,
    executionRunId: options?.agentRunId ?? null,
  };
}

export function createOpenClawTools(
  options?: {
    sandboxBrowserBridgeUrl?: string;
    allowHostBrowserControl?: boolean;
    /** Drive the user's Account Computer. Host browser control stays blocked. */
    accountComputerBrowser?: boolean;
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    /** Delivery target (e.g. telegram:group:123:topic:456) for topic/thread routing. */
    agentTo?: string;
    /** Thread/topic identifier for routing replies to the originating thread. */
    agentThreadId?: string | number;
    agentDir?: string;
    sandboxRoot?: string;
    sandboxFsBridge?: SandboxFsBridge;
    fsPolicy?: ToolFsPolicy;
    sandboxed?: boolean;
    config?: OpenBotConfig;
    pluginToolAllowlist?: string[];
    /** Current channel ID for auto-threading (Slack). */
    currentChannelId?: string;
    /** Current thread timestamp for auto-threading (Slack). */
    currentThreadTs?: string;
    /** Current inbound message id for action fallbacks (e.g. Telegram react). */
    currentMessageId?: string | number;
    /** Reply-to mode for Slack auto-threading. */
    replyToMode?: "off" | "first" | "all";
    /** Mutable ref to track if a reply was sent (for "first" mode). */
    hasRepliedRef?: { value: boolean };
    /** If true, the model has native vision capability */
    modelHasVision?: boolean;
    /** If true, nodes action="invoke" can call media-returning commands directly. */
    allowMediaInvokeCommands?: boolean;
    /** Explicit agent ID override for cron/hook sessions. */
    requesterAgentIdOverride?: string;
    /** Require explicit message targets (no implicit last-route sends). */
    requireExplicitMessageTarget?: boolean;
    /** If true, omit the message tool from the tool list. */
    disableMessageTool?: boolean;
    /** Trusted sender id from inbound context (not tool args). */
    requesterSenderId?: string | null;
    /** Canonical trusted turn identity (preferred over the scalar gateway fields). */
    executionIdentity?: ExecutionIdentityContext;
    /** Enterprise gateway session user (email) for Seat-bound runtime tools. */
    gatewayClientUser?: string;
    gatewayClientSessionDomain?: import("../gateway/server-methods/types.js").GatewayClient["sessionDomain"];
    gatewayClientPlatformUserId?: string;
    gatewayClientSessionKind?: import("../gateway/server-methods/types.js").GatewayClient["sessionKind"];
    gatewayClientSessionEnterpriseId?: string;
    gatewayClientSessionMembershipId?: string;
    /** Whether the requesting sender is an owner. */
    senderIsOwner?: boolean;
    /** Ephemeral session UUID — regenerated on /new and /reset. */
    sessionId?: string;
    /** Current agent run identity for subagent inherit-only Objective observation. */
    agentRunId?: string;
    tenantId?: string;
    /**
     * Workspace directory to pass to spawned subagents for inheritance.
     * Defaults to workspaceDir. Use this to pass the actual agent workspace when the
     * session itself is running in a copied-workspace sandbox (`ro` or `none`) so
     * subagents inherit the real workspace path instead of the sandbox copy.
     */
    spawnWorkspaceDir?: string;
    /** Focused Knowledge Universe consume refs for knowledge_search / knowledge_get. */
    knowledgeConsumeRefs?: import("../gateway/knowledge/consume-ref.js").KnowledgeConsumeRef[];
  } & SpawnedToolContext,
): AnyAgentTool[] {
  const executionIdentity = resolveExecutionIdentityFromRunFields({
    executionIdentity: options?.executionIdentity,
    gatewayClientUser: options?.gatewayClientUser,
    gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
    gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
    agentId: options?.requesterAgentIdOverride,
    sessionKey: options?.agentSessionKey,
  });
  const identityFields = toTrustedGatewayClientFields(executionIdentity);
  // Attribution for the E10 (image / pdf model fallback) governance envelope.
  // Resolved from the frozen turn identity, never from tool arguments.
  const governanceTenantId =
    options?.tenantId?.trim() ||
    options?.gatewayClientSessionEnterpriseId?.trim() ||
    executionIdentity.enterpriseId?.trim() ||
    undefined;
  const governanceActorId = actorIdFromIdentity(executionIdentity);
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir);
  const spawnWorkspaceDir = resolveWorkspaceRoot(
    options?.spawnWorkspaceDir ?? options?.workspaceDir,
  );
  const runtimeWebTools = getActiveRuntimeWebToolsMetadata();
  const imageTool = options?.agentDir?.trim()
    ? createImageTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox:
          options?.sandboxRoot && options?.sandboxFsBridge
            ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
            : undefined,
        fsPolicy: options?.fsPolicy,
        modelHasVision: options?.modelHasVision,
        agentRunId: options?.agentRunId,
        ...(governanceTenantId ? { tenantId: governanceTenantId } : {}),
        ...(governanceActorId ? { governanceActorId } : {}),
      })
    : null;
  const stepfunImageTool = options?.agentDir?.trim()
    ? createStepfunImageTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox:
          options?.sandboxRoot && options?.sandboxFsBridge
            ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
            : undefined,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const sunoMusicTool = options?.agentDir?.trim()
    ? createSunoMusicTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
      })
    : null;
  const pdfTool = options?.agentDir?.trim()
    ? createPdfTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox:
          options?.sandboxRoot && options?.sandboxFsBridge
            ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
            : undefined,
        fsPolicy: options?.fsPolicy,
        agentRunId: options?.agentRunId,
        ...(governanceTenantId ? { tenantId: governanceTenantId } : {}),
        ...(governanceActorId ? { governanceActorId } : {}),
      })
    : null;
  const webSearchTool = createWebSearchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeWebSearch: runtimeWebTools?.search,
  });
  const webFetchTool = createWebFetchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeFirecrawl: runtimeWebTools?.fetch.firecrawl,
  });
  const messageTool = options?.disableMessageTool
    ? null
    : createMessageTool({
        agentAccountId: options?.agentAccountId,
        agentSessionKey: options?.agentSessionKey,
        config: options?.config,
        currentChannelId: options?.currentChannelId,
        currentChannelProvider: options?.agentChannel,
        currentThreadTs: options?.currentThreadTs,
        currentMessageId: options?.currentMessageId,
        replyToMode: options?.replyToMode,
        hasRepliedRef: options?.hasRepliedRef,
        sandboxRoot: options?.sandboxRoot,
        requireExplicitTarget: options?.requireExplicitMessageTarget,
        requesterSenderId: options?.requesterSenderId ?? undefined,
      });
  const tools: AnyAgentTool[] = [
    createBrowserTool({
      sandboxBridgeUrl: options?.sandboxBrowserBridgeUrl,
      allowHostControl: options?.allowHostBrowserControl,
      accountComputer: options?.accountComputerBrowser,
      agentSessionKey: options?.agentSessionKey,
      serverAccount: {
        tenantId: governanceTenantId,
        userId: identityFields.gatewayClientPlatformUserId,
      },
    }),
    createSecureFormTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createAccountComputerLoginTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createCanvasTool({ config: options?.config }),
    createNodesTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      config: options?.config,
      modelHasVision: options?.modelHasVision,
      allowMediaInvokeCommands: options?.allowMediaInvokeCommands,
    }),
    createCronTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    ...(messageTool ? [messageTool] : []),
    createTtsTool({
      agentChannel: options?.agentChannel,
      config: options?.config,
    }),
    createGatewayTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createGuidanceEventTool({
      agentSessionKey: options?.agentSessionKey,
      gatewayClientUser: options?.gatewayClientUser,
    }),
    createSkillAssetSaveTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      gatewayClientUser: options?.gatewayClientUser,
      gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
      workspaceDir,
    }),
    createAgentsListTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      tenantId: options?.tenantId,
      gatewayClientUser: options?.gatewayClientUser,
      gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
      gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
      gatewayClientSessionKind: options?.gatewayClientSessionKind,
    } as Parameters<typeof createAgentsListTool>[0]),
    createOrganizationTasksTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      workspaceDir,
      config: options?.config,
    }),
    createOrganizationMemoryTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      workspaceDir,
      config: options?.config,
    }),
    createOperationalIdentityTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      executionIdentity,
      ...identityFields,
    }),
    createUserOperationalIdentityTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      gatewayClientUser: identityFields.gatewayClientUser,
      gatewayClientSessionDomain: identityFields.gatewayClientSessionDomain,
      gatewayClientPlatformUserId: identityFields.gatewayClientPlatformUserId,
    }),
    createDataCapabilityTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      executionIdentity,
      ...identityFields,
    }),
    createKnowledgeSearchTool({
      ...identityFields,
      agentId: options?.requesterAgentIdOverride,
      consumeRefs: options?.knowledgeConsumeRefs,
    }),
    createKnowledgeGetTool({
      ...identityFields,
      agentId: options?.requesterAgentIdOverride,
      consumeRefs: options?.knowledgeConsumeRefs,
    }),
    createKnowledgeSourceTool({
      ...identityFields,
      agentId: options?.requesterAgentIdOverride,
    }),
    createScheduleTool({
      gatewayClientUser: identityFields.gatewayClientUser,
      gatewayClientSessionDomain: identityFields.gatewayClientSessionDomain,
      gatewayClientPlatformUserId: identityFields.gatewayClientPlatformUserId,
      gatewayClientSessionEnterpriseId: identityFields.gatewayClientSessionEnterpriseId,
      gatewayClientSessionMembershipId: identityFields.gatewayClientSessionMembershipId,
    }),
    createScheduledTaskTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      gatewayClientUser: identityFields.gatewayClientUser,
      gatewayClientSessionDomain: identityFields.gatewayClientSessionDomain,
      gatewayClientPlatformUserId: identityFields.gatewayClientPlatformUserId,
      gatewayClientSessionEnterpriseId: identityFields.gatewayClientSessionEnterpriseId,
      gatewayClientSessionMembershipId: identityFields.gatewayClientSessionMembershipId,
    }),
    createMeetingTool({
      executionIdentity,
      ...identityFields,
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    createSessionsListTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsHistoryTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      sandboxed: options?.sandboxed,
    }),
    createSessionsSpawnTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      agentTo: options?.agentTo,
      agentThreadId: options?.agentThreadId,
      agentGroupId: options?.agentGroupId,
      agentGroupChannel: options?.agentGroupChannel,
      agentGroupSpace: options?.agentGroupSpace,
      sandboxed: options?.sandboxed,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      workspaceDir: spawnWorkspaceDir,
      parentRunId: options?.agentRunId,
      tenantId: options?.tenantId,
      executionIdentity,
    }),
    createSubagentsTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createSessionStatusTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createDiagnoseTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      senderIsOwner: options?.senderIsOwner,
      tenantId: options?.tenantId,
      gatewayClientUser: options?.gatewayClientUser,
      gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
      gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
    }),
    createEvolutionPerceptionTool({
      tenantId: options?.tenantId,
      gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
    }),
    createConversationSendTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      tenantId: options?.tenantId,
      gatewayClientUser: options?.gatewayClientUser,
      gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
      gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
      gatewayClientSessionKind: options?.gatewayClientSessionKind,
    }),
    ...(shouldExposeCollaborationBoardTool({
      config: options?.config,
      agentSessionKey: options?.agentSessionKey,
      agentGroupId: options?.agentGroupId,
      tenantId: options?.tenantId ?? options?.gatewayClientSessionEnterpriseId,
    })
      ? [
          createCollaborationBoardTool({
            agentSessionKey: options?.agentSessionKey,
            requesterAgentIdOverride: options?.requesterAgentIdOverride,
            agentGroupId: options?.agentGroupId,
            tenantId: options?.tenantId ?? options?.gatewayClientSessionEnterpriseId,
            stampedEnterpriseId:
              executionIdentity.enterpriseId ??
              options?.gatewayClientSessionEnterpriseId ??
              options?.tenantId ??
              null,
            ...resolveDiscussToTaskInboundInjection(options),
            gatewayClientUser: identityFields.gatewayClientUser,
            gatewayClientPlatformUserId: identityFields.gatewayClientPlatformUserId,
            gatewayClientSessionDomain: identityFields.gatewayClientSessionDomain,
            gatewayClientSessionEnterpriseId: identityFields.gatewayClientSessionEnterpriseId,
            gatewayClientSessionMembershipId: identityFields.gatewayClientSessionMembershipId,
            config: options?.config,
          }),
        ]
      : []),
    createTenantUserNotifyTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
      tenantId: options?.tenantId,
      gatewayClientUser: options?.gatewayClientUser,
      gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
      gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
      gatewayClientSessionKind: options?.gatewayClientSessionKind,
    }),
    createConfirmDiagnosePrescriptionTool({
      tenantId: options?.tenantId,
      callerUserId: options?.gatewayClientUser ?? options?.requesterSenderId ?? undefined,
    }),
    ...createSiteCapabilityTools({
      executionIdentity,
      tenantId: options?.tenantId,
      ...identityFields,
    }),
    ...(webSearchTool ? [webSearchTool] : []),
    ...(webFetchTool ? [webFetchTool] : []),
    ...(stepfunImageTool ? [stepfunImageTool] : imageTool ? [imageTool] : []),
    ...(sunoMusicTool ? [sunoMusicTool] : []),
    ...(pdfTool ? [pdfTool] : []),
  ];

  const pluginTools = resolvePluginTools({
    context: {
      config: options?.config,
      workspaceDir,
      agentDir: options?.agentDir,
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
      sessionKey: options?.agentSessionKey,
      sessionId: options?.sessionId,
      messageChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      requesterSenderId: options?.requesterSenderId ?? undefined,
      senderIsOwner: options?.senderIsOwner ?? undefined,
      sandboxed: options?.sandboxed,
      gatewayClientUser: options?.gatewayClientUser,
      gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
    },
    existingToolNames: new Set(tools.map((tool) => tool.name)),
    toolAllowlist: options?.pluginToolAllowlist,
  });

  return [...tools, ...pluginTools];
}

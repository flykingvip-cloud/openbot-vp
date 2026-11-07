import crypto from "node:crypto";
import fs from "node:fs";
import { formatTaskProposalReply } from "../../agent-runtime/command/index.js";
import {
  appendSystemContextPart,
  finalizeSystemContext,
  selectSystemContextParts,
} from "../../agent-runtime/context/assembly.js";
import { resolveContextLane } from "../../agent-runtime/context/index.js";
import { buildResumePrompt, buildTaskBoardContext } from "../../agent-runtime/context/index.js";
import { projectInteractionHistory } from "../../agent-runtime/context/interaction-history.js";
import { appendUntrustedContext } from "../../agent-runtime/context/untrusted.js";
import {
  abortEmbeddedPiRun,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
} from "../../agent-runtime/execution/index.js";
import { replyTurnRuntime } from "../../agent-runtime/wiring/reply-turn.js";
import { resolveSessionAuthProfileOverride } from "../../agents/auth-profiles/session-override.js";
import type { ExecToolDefaults } from "../../agents/bash-tools.js";
import { resolveBootstrapContextForRun } from "../../agents/bootstrap-files.js";
import { extractEmployeeStewardUserIdFromSessionKey } from "../../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import {
  ensureStewardRequiredSkills,
  shouldForceStewardRequiredSkills,
} from "../../agents/builtin-steward/required-skills.js";
import { applyPreferenceMutation } from "../../agents/context-compiler/preference-mutation.js";
import { emitExecutionDisciplineObservation } from "../../agents/execution-preflight/observability.js";
import { rememberInboundMediaGrants } from "../../agents/inbound-media-grants.js";
import {
  INBOUND_TOOL_POLICY_VERSION,
  listRetrieveReadOnlyCoreToolIds,
} from "../../agents/inbound-tool-policy.js";
import { resolveEmbeddedSessionLane } from "../../agents/pi-embedded-runner/lanes.js";
import { openSessionManager } from "../../agents/pi-sdk/session.js";
import { applySkillPolicyToFilter } from "../../agents/skills/skill-policy.js";
import { replyForTaskSurfaceUtterance } from "../../agents/task-surface/apply.js";
import { isPrimarilyTaskSurfaceUtterance } from "../../agents/task-surface/surface.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  resolveGroupSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import {
  admitOguiDecisionTurn,
  releaseOguiDecisionResume,
  resolveOguiDecisionRunBinding,
  runWithOguiDecisionResume,
} from "../../config/sessions/ogui-decision-engine.js";
import { buildActiveConversationTaskFocusPrompt } from "../../conversation-task/focus-prompt.js";
import { buildCronReplySystemPrompt } from "../../cron/cron-reply-context.js";
import { buildGrowthBirthSystemPrompt } from "../../gateway/agent-growth/birth-context.js";
import {
  isChatInboundDepthRouterEnabled,
  isChatInboundDepthShadowEnabled,
  isChatInboundKnowledgePolicyEnabled,
  isChatInboundToolPolicyEnabled,
} from "../../gateway/chat-inbound-flags.js";
import { emitChatInboundStage } from "../../gateway/chat-inbound-stage-events.js";
import { recordCollabFaultRoundPartial } from "../../gateway/collaboration-dispatch/fault-round-diagnostic.js";
import {
  readSessionConfidentialityTier,
  resolveContextLaneForReplyRun,
} from "../../gateway/collaboration-dispatch/policy-lane-context.js";
import { loadContextScopeCatalog } from "../../gateway/context-scope/catalog.js";
import {
  allowedSourcesForAudit,
  appendContextScopeAuditRecord,
  authorizeContextScopePlan,
  degradeContextScopePlanToMandatory,
  knowledgeConsumeRefsFromScopePlan,
  mayRetrieveOptionalKnowledge,
  parseChatContextScopeRequest,
  resolveContextScopePlan,
  type ContextScopePlan,
} from "../../gateway/context-scope/index.js";
import { recordContextScopeOnCollaborationRuntime } from "../../gateway/context-scope/runtime-join.js";
import {
  createExecutionIdentityContext,
  refineExecutionIdentityContext,
} from "../../gateway/execution-identity-context.js";
import { resolveKnowledgeGatewayClientForAgentRun } from "../../gateway/knowledge/agent-run-gateway-client.js";
import {
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "../../gateway/knowledge/kb-index.js";
import { listKnowledgeBases } from "../../gateway/knowledge/knowledge-base-store.js";
import { upsertKnowledgeLineage } from "../../gateway/knowledge/knowledge-lineage-store.js";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import { resolveSeatTurnContext } from "../../gateway/seat-rules/turn-context.js";
import {
  formatTurnPreferSkillHint,
  resolveTurnPreferSkillNames,
} from "../../gateway/skill-wechat-official-account-routing.js";
import { userModelingEnabled } from "../../gateway/user-modeling/config.js";
import { recordUserInteractionSignalSafely } from "../../gateway/user-modeling/record-signal.js";
import { resolveUserModelingTenantId } from "../../gateway/user-modeling/tenant-membership.js";
import { resolveUserModelingKeyForReply } from "../../gateway/user-modeling/user-key.js";
import {
  readUserProfileOrDefault,
  resolveUserProfileInstructions,
} from "../../gateway/user-modeling/user-profile-store.js";
import { logVerbose } from "../../globals.js";
import { observeObjectiveShadowFromIngress } from "../../objective-shadow/ingress-hook.js";
import { readConversationTaskCandidates } from "../../objective-shadow/read-existing-objectives.js";
import { resolveCoordinatorAuthority } from "../../organization/coordinator-authority.js";
import { resolveRuntimeOrganizationContext } from "../../organization/runtime.js";
import { clearCommandLane, getQueueSize } from "../../process/command-queue.js";
import { normalizeMainKey } from "../../routing/session-key.js";
import { isReasoningTagProvider } from "../../utils/provider-utils.js";
import { hasControlCommand } from "../command-detection.js";
import { buildInboundMediaNote, inboundMediaNeedsImageReplyHint } from "../media-note.js";
import type { MsgContext, TemplateContext } from "../templating.js";
import {
  type ElevatedLevel,
  formatXHighModelHint,
  normalizeThinkLevel,
  type ReasoningLevel,
  supportsXHighThinking,
  type ThinkLevel,
  type VerboseLevel,
} from "../thinking.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { runReplyAgent } from "./agent-runner.js";
import { applySessionHints } from "./body.js";
import {
  detectExplicitCollabKnowledgeRecoveryIntent,
  formatCollaborationKnowledgeRecoveryHint,
  isCollaborationExplicitKnowledgeRecoveryEnabled,
} from "./collab-knowledge-recovery.js";
import { buildCollaborationCapabilitySystemPrompt } from "./collaboration-capability-context.js";
import { resolveCollaborationAwareSessionFile } from "./collaboration-session-file.js";
import type { buildCommandContext } from "./commands.js";
import { resolveComposerPluginMentionBindings } from "./composer-plugin-mention-bindings.js";
import type { InlineDirectives } from "./directive-handling.js";
import { buildActivePrimaryObjectivePrompt } from "./goal-correction-mutation.js";
import { buildGroupChatContext, buildGroupIntro } from "./groups.js";
import {
  ceilingForDepth,
  classifyInboundDepth,
  derivePreviousInboundDepthFromMessages,
  detectExplicitLiveIntent,
  detectInboundLinks,
  hasUnfinishedToolRunInMessages,
  isInboundContinuation,
  isInboundDepthEmployeeStewardSession,
  resolveInboundSessionKind,
  shouldApplyChatLaneSkip,
  shouldApplyRetrieveKnowledgePolicy,
  shouldApplyRetrieveToolPolicy,
  type InboundDepthDecision,
} from "./inbound-depth.js";
import {
  buildCurrentSpeakerUntrustedPrompt,
  buildInboundMetaSystemPrompt,
} from "./inbound-meta.js";
import { applyInboundTaskFeedback } from "./inbound-task-feedback.js";
import { buildKnowledgeUniversePromptContext } from "./knowledge-universe-context.js";
import { learningExperienceRunKey } from "./learning-experience-pending.js";
import { buildLearningRecallSystemPrompt } from "./learning-recall-context.js";
import { buildAsideDialogueContextPromptForNormalReply } from "./mid-task-aside-dialogue-history.js";
import type { createModelSelectionState } from "./model-selection.js";
import { buildOperationalIdentitySystemPrompt } from "./operational-identity-context.js";
import { resolveOriginMessageProvider } from "./origin-routing.js";
import { resolveQueueSettings } from "./queue.js";
import { buildReplyUserTimezonePrompt } from "./resolve-reply-user-timezone.js";
import { routeReply } from "./route-reply.js";
import {
  assembleCollaborationRuntimeContextParts,
  resolveCollaborationGroupIdForRun,
  resolveCollaborationRunWorkspaceDir,
  shouldUseCollaborationRuntimeAssembly,
} from "./runtime-context-assembly.js";
import { buildRemoteGatewayEnvironmentPrompt } from "./runtime-environment-hint.js";
import { resolveRuntimeSkillPolicy } from "./runtime-skill-policy.js";
import { buildSessionContinuityPrompt } from "./session-continuity.js";
import {
  buildBareSessionResetPrompt,
  resolveArchivedTranscriptPathsForPreviousSession,
} from "./session-reset-prompt.js";
import { drainFormattedSystemEvents, ensureSkillSnapshot } from "./session-updates.js";
import { buildTaskDataPreflightPrompt } from "./task-data-preflight.js";
import {
  buildTurnReplyLanguageInstruction,
  resolveTurnReplyLanguage,
} from "./turn-reply-language.js";
import { resolveTypingMode } from "./typing-mode.js";
import { resolveRunTypingPolicy } from "./typing-policy.js";
import type { TypingController } from "./typing.js";

type AgentDefaults = NonNullable<OpenBotConfig["agents"]>["defaults"];
type ExecOverrides = Pick<ExecToolDefaults, "host" | "security" | "ask" | "node">;

function resolveReplyGatewayPlatformUserId(params: {
  sessionKey?: string;
  ctxPlatformUserId?: string;
  groupOwnerEmployeeId?: string;
}): string | undefined {
  return (
    extractEmployeeStewardUserIdFromSessionKey(params.sessionKey) ??
    params.ctxPlatformUserId?.trim() ??
    params.groupOwnerEmployeeId?.trim() ??
    undefined
  );
}

function readInboundSessionMessages(sessionFile?: string): unknown[] {
  const file = sessionFile?.trim();
  if (!file) {
    return [];
  }
  try {
    if (!fs.existsSync(file)) {
      return [];
    }
    const messages: unknown[] = [];
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as { message?: unknown };
        messages.push(parsed.message ?? parsed);
      } catch {
        // Ignore malformed transcript lines.
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function buildResetSessionNoticeText(params: {
  provider: string;
  model: string;
  defaultProvider: string;
  defaultModel: string;
}): string {
  const modelLabel = `${params.provider}/${params.model}`;
  const defaultLabel = `${params.defaultProvider}/${params.defaultModel}`;
  return modelLabel === defaultLabel
    ? `✅ New session started · model: ${modelLabel}`
    : `✅ New session started · model: ${modelLabel} (default: ${defaultLabel})`;
}

function resolveResetSessionNoticeRoute(params: {
  ctx: MsgContext;
  command: ReturnType<typeof buildCommandContext>;
}): {
  channel: Parameters<typeof routeReply>[0]["channel"];
  to: string;
} | null {
  const commandChannel = params.command.channel?.trim().toLowerCase();
  const fallbackChannel =
    commandChannel && commandChannel !== "webchat"
      ? (commandChannel as Parameters<typeof routeReply>[0]["channel"])
      : undefined;
  const channel = params.ctx.OriginatingChannel ?? fallbackChannel;
  const to = params.ctx.OriginatingTo ?? params.command.from ?? params.command.to;
  if (!channel || channel === "webchat" || !to) {
    return null;
  }
  return { channel, to };
}

async function sendResetSessionNotice(params: {
  ctx: MsgContext;
  command: ReturnType<typeof buildCommandContext>;
  sessionKey: string;
  cfg: OpenBotConfig;
  accountId: string | undefined;
  threadId: string | number | undefined;
  provider: string;
  model: string;
  defaultProvider: string;
  defaultModel: string;
}): Promise<void> {
  const route = resolveResetSessionNoticeRoute({
    ctx: params.ctx,
    command: params.command,
  });
  if (!route) {
    return;
  }
  await routeReply({
    payload: {
      text: buildResetSessionNoticeText({
        provider: params.provider,
        model: params.model,
        defaultProvider: params.defaultProvider,
        defaultModel: params.defaultModel,
      }),
    },
    channel: route.channel,
    to: route.to,
    sessionKey: params.sessionKey,
    accountId: params.accountId,
    threadId: params.threadId,
    cfg: params.cfg,
  });
}

type RunPreparedReplyParams = {
  ctx: MsgContext;
  sessionCtx: TemplateContext;
  cfg: OpenBotConfig;
  agentId: string;
  agentDir: string;
  agentCfg: AgentDefaults;
  sessionCfg: OpenBotConfig["session"];
  commandAuthorized: boolean;
  command: ReturnType<typeof buildCommandContext>;
  commandSource: string;
  allowTextCommands: boolean;
  directives: InlineDirectives;
  defaultActivation: Parameters<typeof buildGroupIntro>[0]["defaultActivation"];
  resolvedThinkLevel: ThinkLevel | undefined;
  resolvedVerboseLevel: VerboseLevel | undefined;
  resolvedReasoningLevel: ReasoningLevel;
  resolvedElevatedLevel: ElevatedLevel;
  execOverrides?: ExecOverrides;
  elevatedEnabled: boolean;
  elevatedAllowed: boolean;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
    flushOnParagraph?: boolean;
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  modelState: Awaited<ReturnType<typeof createModelSelectionState>>;
  provider: string;
  model: string;
  perMessageQueueMode?: InlineDirectives["queueMode"];
  perMessageQueueOptions?: {
    debounceMs?: number;
    cap?: number;
    dropPolicy?: InlineDirectives["dropPolicy"];
  };
  typing: TypingController;
  opts?: GetReplyOptions;
  defaultProvider: string;
  defaultModel: string;
  timeoutMs: number;
  isNewSession: boolean;
  resetTriggered: boolean;
  systemSent: boolean;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey: string;
  sessionId?: string;
  storePath?: string;
  workspaceDir: string;
  abortedLastRun: boolean;
  archivedTranscriptPaths?: string[];
  previousSessionEntry?: SessionEntry;
};

function hasExplicitOptionalKnowledgeSources(plan: ContextScopePlan): boolean {
  return plan.sources.some(
    (source) => source.type === "file" || source.type === "folder" || source.type === "knowledge",
  );
}

/** Chat-lane skips optional knowledge unless UI selected focused knowledge sources. */
function chatLaneShouldSkipOptionalKnowledge(params: {
  applyChatLane: boolean;
  plan?: ContextScopePlan | null;
}): boolean {
  if (!params.applyChatLane) {
    return false;
  }
  const plan = params.plan;
  if (plan && mayRetrieveOptionalKnowledge(plan) && hasExplicitOptionalKnowledgeSources(plan)) {
    return false;
  }
  return true;
}

export async function runPreparedReply(
  params: RunPreparedReplyParams,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const {
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    agentCfg,
    sessionCfg,
    commandAuthorized,
    command,
    commandSource,
    allowTextCommands,
    directives,
    defaultActivation,
    elevatedEnabled,
    elevatedAllowed,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    modelState,
    provider,
    model,
    perMessageQueueMode,
    perMessageQueueOptions,
    typing,
    opts,
    defaultProvider,
    defaultModel,
    timeoutMs,
    isNewSession,
    resetTriggered,
    systemSent,
    sessionKey,
    sessionId,
    storePath,
    workspaceDir,
    sessionStore,
    archivedTranscriptPaths,
    previousSessionEntry,
  } = params;
  let {
    sessionEntry,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
    abortedLastRun,
  } = params;
  let currentSystemSent = systemSent;

  const isFirstTurnInSession = isNewSession || !currentSystemSent;
  const isGroupChat = sessionCtx.ChatType === "group";
  const wasMentioned = ctx.WasMentioned === true;
  const isHeartbeat = opts?.isHeartbeat === true;
  const interactionIngress =
    !isHeartbeat && !opts?.growthBirthTurn && sessionCtx.CollaborationRoundInvoked !== true
      ? (opts?.interactionIngress ??
        (ctx.InputProvenance?.kind === "external_user"
          ? {
              userMessageId:
                ctx.MessageSidFull ?? ctx.MessageSid ?? opts?.runId ?? crypto.randomUUID(),
              persistOwnTranscript: true,
            }
          : undefined))
      : undefined;
  const { typingPolicy, suppressTyping } = resolveRunTypingPolicy({
    requestedPolicy: opts?.typingPolicy,
    suppressTyping: opts?.suppressTyping === true,
    isHeartbeat,
    originatingChannel: ctx.OriginatingChannel,
  });
  const typingMode = resolveTypingMode({
    configured: sessionCfg?.typingMode ?? agentCfg?.typingMode,
    isGroupChat,
    wasMentioned,
    isHeartbeat,
    typingPolicy,
    suppressTyping,
  });
  const shouldInjectGroupIntro = Boolean(
    isGroupChat && (isFirstTurnInSession || sessionEntry?.groupActivationNeedsSystemIntro),
  );
  const organizationContext = await resolveRuntimeOrganizationContext({
    cfg,
    agentId,
    workspaceDir,
    sessionEntry,
    sessionKey,
  });
  const coordinatorAuthority = resolveCoordinatorAuthority(organizationContext);
  if (
    isGroupChat &&
    coordinatorAuthority.shouldAvoidDirectUserCoordination &&
    sessionCtx.CollaborationRoundInvoked !== true
  ) {
    logVerbose(
      `Suppressing direct group reply for non-coordinator agent ${agentId}; coordinator=${coordinatorAuthority.coordinatorAgentId}`,
    );
    typing.cleanup();
    return { text: SILENT_REPLY_TOKEN };
  }
  // Always include persistent group chat context (name, participants, reply guidance)
  const collaborationGroupId = resolveCollaborationGroupIdForRun({
    collaborationGroupId: sessionCtx.CollaborationGroupId,
    groupSessionId: resolveGroupSessionKey(sessionCtx)?.id,
    sessionEntry,
  });
  const useCollaborationAssembly = shouldUseCollaborationRuntimeAssembly({
    collaborationGroupId,
    sessionEntry,
    collaborationRoundInvoked: sessionCtx.CollaborationRoundInvoked === true,
  });
  const runWorkspaceDir = resolveCollaborationRunWorkspaceDir({
    cfg,
    agentWorkspaceDir: workspaceDir,
    groupId: collaborationGroupId,
    sessionEntry,
    tenantId:
      sessionCtx.CollaborationTenantId?.trim() ||
      sessionCtx.GatewayClientSessionEnterpriseId?.trim() ||
      undefined,
  });
  const inboundMessage = (sessionCtx.BodyStripped ?? sessionCtx.Body ?? "").trim();
  let taskSurfaceNote: string | undefined;
  if (!isHeartbeat && inboundMessage) {
    const surfaceReply = replyForTaskSurfaceUtterance({
      text: inboundMessage,
      cfg,
      workspaceDir: runWorkspaceDir,
      agentId,
      sessionKey,
      sessionEntry,
      sessionFile: sessionEntry?.sessionFile,
    });
    if (surfaceReply && isPrimarilyTaskSurfaceUtterance(inboundMessage)) {
      typing.cleanup();
      return { text: surfaceReply };
    }
    if (surfaceReply) {
      taskSurfaceNote = `${surfaceReply}\n已按展示序号执行。不要再问用户第几条指的是哪一条。`;
    }
  }
  // Grant this turn's own attachments to the media tools. Managed Enterprise forces
  // workspace-only FS, but webchat uploads land in the shared <stateDir>/media, so
  // without this the image/pdf tools refuse every attachment the user just sent
  // ("Local media path is not under an allowed directory"). Only these exact files
  // are granted — the workspace-only boundary is otherwise unchanged.
  rememberInboundMediaGrants(opts?.runId, [sessionCtx.MediaPath, ...(sessionCtx.MediaPaths ?? [])]);
  const inboundDepthShadowEnabled = isChatInboundDepthShadowEnabled();
  const inboundDepthRouterEnabled = isChatInboundDepthRouterEnabled();
  const inboundKnowledgePolicyEnabled = isChatInboundKnowledgePolicyEnabled();
  const inboundToolPolicyEnabled = isChatInboundToolPolicyEnabled();
  let inboundDepthDecision: InboundDepthDecision | undefined;
  // Classify employee-steward turns even when LIVE depth router flags are still off.
  // depth=chat then drives classify-only chat-lane cuts (identity / catalog / tools /
  // skills) via shouldApplyChatLaneSkip({ stewardClassified }) — same as ROUTER on,
  // without flipping OPENBOT_CHAT_INBOUND_DEPTH_ROUTER (defaults stay false).
  const inboundDepthFlagsEnabled =
    inboundDepthShadowEnabled ||
    inboundDepthRouterEnabled ||
    inboundKnowledgePolicyEnabled ||
    inboundToolPolicyEnabled;
  if (!isHeartbeat && isInboundDepthEmployeeStewardSession({ sessionKey, agentId })) {
    const hasAttachments = Boolean(
      sessionCtx.MediaPath ||
      (sessionCtx.MediaPaths && sessionCtx.MediaPaths.length > 0) ||
      (opts?.images && opts.images.length > 0),
    );
    const transcriptMessages = isInboundContinuation(inboundMessage)
      ? readInboundSessionMessages(sessionEntry?.sessionFile)
      : [];
    const routeStartedAtMs = Date.now();
    inboundDepthDecision = classifyInboundDepth({
      text: inboundMessage,
      hasAttachments,
      hasLinks: detectInboundLinks(inboundMessage),
      sessionKind: resolveInboundSessionKind(sessionKey),
      previousDepth: derivePreviousInboundDepthFromMessages(transcriptMessages),
      hasUnfinishedToolRun: hasUnfinishedToolRunInMessages(transcriptMessages),
      hasExplicitKnowledgeIntent: false,
      hasExplicitWriteIntent: false,
      hasExplicitPublishIntent: false,
    });
    const routeMs = Date.now() - routeStartedAtMs;
    if (opts) {
      opts.inboundDepthDecision = inboundDepthDecision;
    }
    const runId = opts?.runId?.trim();
    if (runId && inboundDepthFlagsEnabled) {
      emitChatInboundStage({
        runId,
        stage: "depth_decided",
        sessionKey,
        extra: {
          wouldDepth: inboundDepthDecision.depth,
          routeStrength: inboundDepthDecision.routeStrength,
          classifierVersion: inboundDepthDecision.classifierVersion,
          reasons: inboundDepthDecision.reasons,
          routeMs,
          mode: inboundDepthRouterEnabled
            ? "router"
            : inboundDepthShadowEnabled
              ? "shadow"
              : inboundKnowledgePolicyEnabled
                ? "knowledge_policy"
                : "tool_policy",
        },
      });
      emitExecutionDisciplineObservation({
        runId,
        sessionKey,
        metrics: {
          inboundDepth: inboundDepthDecision.depth,
          inboundDepthMode: inboundDepthRouterEnabled
            ? "router"
            : inboundDepthShadowEnabled
              ? "shadow"
              : inboundKnowledgePolicyEnabled
                ? "knowledge_policy"
                : inboundToolPolicyEnabled
                  ? "tool_policy"
                  : "classify_only",
        },
      });
    }
  }
  // Expert #4: collab group explicit knowledge recovery (flag default OFF).
  // Prefer retrieve for「按前面约定／继续上次任务」without breaking group minimal when unset.
  // Private LTM still requires promote — this only lifts Scope/Compiler depth to retrieve.
  if (
    useCollaborationAssembly &&
    collaborationGroupId &&
    isCollaborationExplicitKnowledgeRecoveryEnabled(cfg) &&
    detectExplicitCollabKnowledgeRecoveryIntent(inboundMessage)
  ) {
    const prior = inboundDepthDecision?.depth;
    if (!prior || prior === "chat") {
      inboundDepthDecision = {
        depth: "retrieve",
        reasons: ["collab_explicit_knowledge_recovery"],
        routeStrength: "strong",
        ceiling: ceilingForDepth("retrieve"),
        classifierVersion: inboundDepthDecision?.classifierVersion ?? "inbound-depth-v1",
      };
      if (opts) {
        opts.inboundDepthDecision = inboundDepthDecision;
        opts.collabKnowledgeRecoveryHint = formatCollaborationKnowledgeRecoveryHint();
      }
    }
  }
  const applyChatLane = shouldApplyChatLaneSkip({
    routerEnabled: inboundDepthRouterEnabled,
    depth: inboundDepthDecision?.depth,
    // Steward classify-only: apply chat-lane when depth=chat even if ROUTER is off.
    stewardClassified: Boolean(inboundDepthDecision),
  });
  const applyRetrievePolicy = shouldApplyRetrieveKnowledgePolicy({
    knowledgePolicyEnabled: inboundKnowledgePolicyEnabled,
    depth: inboundDepthDecision?.depth,
  });
  const applyRetrieveToolPolicy = shouldApplyRetrieveToolPolicy({
    toolPolicyEnabled: inboundToolPolicyEnabled,
    depth: inboundDepthDecision?.depth,
  });
  const contextLane = resolveContextLane({
    depth: inboundDepthDecision?.depth,
    applyChatLane,
  });
  // Employee-steward turns always classify (see above) so chat → CSC minimal
  // skips optional knowledge without waiting for LIVE router flags. Non-steward
  // sessions still leave depth unset and keep policy.defaultMode.
  const depthForScope = inboundDepthDecision?.depth;
  // P1-A5 ④: BP-12 confidentiality + contextPolicy go through the composition-root
  // context lane helper (default legacy = prior session-tier + resolveRunContextPolicy).
  // Consumer file must not read .confidentialityTier directly (allowlist cleared).
  const sessionConfidentialityTier = readSessionConfidentialityTier(sessionEntry);
  const policyContextLane = resolveContextLaneForReplyRun({
    forDirectSession: !useCollaborationAssembly,
    sessionConfidentialityTier,
  });
  let contextScopePlan =
    !isHeartbeat && inboundMessage
      ? resolveContextScopePlan({
          inboundDepth: depthForScope,
          sessionKey,
          groupId: collaborationGroupId,
          ...(policyContextLane.groupConfidentiality
            ? { groupConfidentiality: policyContextLane.groupConfidentiality }
            : {}),
          request: parseChatContextScopeRequest(
            opts?.contextScopeRequest as
              | import("../../gateway/context-scope/request.js").ChatContextScopePayload
              | undefined,
          ),
          contextPolicy: policyContextLane.planPolicy,
        })
      : undefined;
  if (opts && contextScopePlan) {
    opts.contextScopePlan = contextScopePlan;
  }
  // Chat-lane skips optional knowledge unless UI selected file/folder/knowledge sources
  // (CSC focused + mayRetrieve). depth=chat must not veto those explicit selections.
  const chatLaneSkipsOptionalKnowledge = chatLaneShouldSkipOptionalKnowledge({
    applyChatLane,
    plan: contextScopePlan,
  });
  {
    const faultRunId = opts?.runId?.trim();
    if (faultRunId) {
      recordCollabFaultRoundPartial(
        {
          runId: faultRunId,
          sessionKey,
          ...(collaborationGroupId?.trim() ? { groupId: collaborationGroupId.trim() } : {}),
          agentId,
          inboundDepth: depthForScope ?? null,
          inboundDepthAbsent: !depthForScope,
          ...(contextScopePlan?.mode ? { contextScopeMode: contextScopePlan.mode } : {}),
        },
        cfg,
      );
    }
  }
  let inboundTaskClarify: string | undefined;
  if (!isHeartbeat && inboundMessage) {
    const sourceMessageId = String(
      sessionCtx.MessageSidFull ?? sessionCtx.MessageSid ?? opts?.runId ?? "",
    ).trim();
    if (sourceMessageId) {
      try {
        await applyPreferenceMutation({
          workspaceDir: runWorkspaceDir,
          text: inboundMessage,
          sourceMessageId,
        });
        const feedback = !interactionIngress
          ? await applyInboundTaskFeedback({
              cfg,
              workspaceDir: runWorkspaceDir,
              agentId,
              sessionKey,
              sessionEntry,
              text: inboundMessage,
              sourceMessageId,
            })
          : undefined;
        if (feedback?.clarify) {
          inboundTaskClarify = feedback.clarify;
        }
      } catch {
        // Preference write must never block the chat turn.
      }
    }
  }
  // Shared workspace identity and memory remain available to interaction.
  // Source selection and token budgets do not grant action capabilities.
  if (chatLaneSkipsOptionalKnowledge) {
    const runId = opts?.runId?.trim();
    if (runId) {
      emitChatInboundStage({
        runId,
        stage: "knowledge_degraded",
        sessionKey,
        extra: {
          knowledgeSkippedReason: "depth_chat",
          identitySnapshot: "lightweight",
          identitySnapshotHit: false,
          identitySnapshotPolicy: "no_cache",
          identityResolveSkippedReason: "depth_chat",
        },
      });
      emitChatInboundStage({
        runId,
        stage: "tool_policy_applied",
        sessionKey,
        extra: {
          toolSkippedReason: "depth_chat",
          toolCount: 0,
        },
      });
    }
  }
  if (applyRetrieveToolPolicy) {
    const runId = opts?.runId?.trim();
    if (runId) {
      emitChatInboundStage({
        runId,
        stage: "tool_policy_applied",
        sessionKey,
        extra: {
          toolPolicy: "retrieve_readonly",
          policyVersion: INBOUND_TOOL_POLICY_VERSION,
          allowlistSize: listRetrieveReadOnlyCoreToolIds().length,
          maxToolMode: inboundDepthDecision?.ceiling.maxToolMode,
          maxSideEffectLevel: inboundDepthDecision?.ceiling.maxSideEffectLevel,
        },
      });
    }
  }
  const knowledgeLineageId = crypto.randomUUID();
  const groupOwner =
    sessionCtx.CollaborationGroupOwnerEntitlement ?? ctx.CollaborationGroupOwnerEntitlement;
  const executionIdentity = createExecutionIdentityContext({
    user: ctx.GatewayClientUser,
    platformUserId: ctx.GatewayClientPlatformUserId,
    sessionDomain: ctx.GatewayClientSessionDomain,
    enterpriseId: ctx.GatewayClientSessionEnterpriseId,
    membershipId: ctx.GatewayClientSessionMembershipId,
    agentId,
    sessionKey,
    collaborationGroupId,
    collaborationOwnerEntitlement: groupOwner,
  });
  const replyGatewayUser = groupOwner?.userEmail || ctx.GatewayClientUser;
  const replyGatewayPlatformUserId = resolveReplyGatewayPlatformUserId({
    sessionKey,
    ctxPlatformUserId: ctx.GatewayClientPlatformUserId,
    groupOwnerEmployeeId: groupOwner?.employeeId,
  });
  let replyGatewayTenantId =
    ctx.GatewayClientSessionEnterpriseId?.trim() || groupOwner?.tenantId?.trim() || undefined;
  if (!replyGatewayTenantId && (replyGatewayUser || replyGatewayPlatformUserId)) {
    replyGatewayTenantId =
      (await resolveUserModelingTenantId(
        buildKnowledgeReplyGatewayClient({
          gatewayClientUser: replyGatewayUser,
          gatewayClientPlatformUserId: replyGatewayPlatformUserId,
          gatewayClientSessionDomain: ctx.GatewayClientSessionDomain,
        }),
      )) ?? undefined;
  }
  const knowledgeIdentity = chatLaneSkipsOptionalKnowledge
    ? undefined
    : await resolveKnowledgeGatewayClientForAgentRun({
        gatewayClientUser: replyGatewayUser,
        gatewayClientSessionDomain: ctx.GatewayClientSessionDomain,
        gatewayClientPlatformUserId: replyGatewayPlatformUserId,
        gatewayClientSessionEnterpriseId: replyGatewayTenantId,
        gatewayClientSessionMembershipId: ctx.GatewayClientSessionMembershipId,
        agentId,
        ownerUserId: groupOwner?.employeeId,
        tenantId: groupOwner?.tenantId ?? replyGatewayTenantId,
      });
  const shadowRunId = opts?.runId?.trim() || sessionId;
  if (!useCollaborationAssembly && shadowRunId) {
    const shadowTenant = replyGatewayTenantId ?? groupOwner?.tenantId;
    const enterpriseClaimed = typeof ctx.GatewayClientSessionEnterpriseId === "string";
    observeObjectiveShadowFromIngress({
      ingress: isHeartbeat ? "heartbeat" : "chat",
      tenantId: shadowTenant,
      tenantScope: shadowTenant || enterpriseClaimed ? "identified" : "local_unscoped",
      runId: shadowRunId,
      candidates: isHeartbeat
        ? []
        : readConversationTaskCandidates({
            tenantId: shadowTenant,
            conversationId: sessionKey,
          }),
    });
  }
  const catalogClient =
    knowledgeIdentity?.client ??
    buildKnowledgeReplyGatewayClient({
      gatewayClientUser: knowledgeIdentity?.user ?? replyGatewayUser,
      gatewayClientSessionDomain:
        knowledgeIdentity?.sessionDomain ?? ctx.GatewayClientSessionDomain,
      gatewayClientPlatformUserId: knowledgeIdentity?.platformUserId ?? replyGatewayPlatformUserId,
      gatewayClientSessionEnterpriseId: replyGatewayTenantId,
      gatewayClientSessionMembershipId: ctx.GatewayClientSessionMembershipId,
    });
  // Group bots already inherit the owner knowledge identity. Keep the group
  // confidentiality ceiling only for auto / authorized-wildcard expansion so
  // every robot and collaboration turn shares the same explicit-consume path.
  const enforceScopeConfidentiality = Boolean(useCollaborationAssembly && collaborationGroupId);
  let contextScopeCatalog: Awaited<ReturnType<typeof loadContextScopeCatalog>> | undefined;
  const visibilityByKnowledgeBase = Object.fromEntries(
    listKnowledgeBases().map((base) => [base.id, base.visibility]),
  );
  if (contextScopePlan && !isHeartbeat && inboundMessage && !chatLaneSkipsOptionalKnowledge) {
    try {
      contextScopeCatalog = await loadContextScopeCatalog({ client: catalogClient });
      const authorized = authorizeContextScopePlan({
        plan: contextScopePlan,
        catalog: contextScopeCatalog,
        visibilityByKnowledgeBase,
        enforceConfidentiality: enforceScopeConfidentiality,
      });
      contextScopePlan = authorized.plan;
    } catch {
      contextScopePlan = degradeContextScopePlanToMandatory(
        contextScopePlan,
        "denied:authorize_failed",
      );
    }
    if (opts && contextScopePlan) {
      opts.contextScopePlan = contextScopePlan;
    }
  }
  if (
    contextScopePlan &&
    !isHeartbeat &&
    inboundMessage &&
    !chatLaneSkipsOptionalKnowledge &&
    collaborationGroupId &&
    useCollaborationAssembly
  ) {
    try {
      const join = await recordContextScopeOnCollaborationRuntime({
        groupId: collaborationGroupId,
        sessionKey,
        plan: contextScopePlan,
        evidenceCount: 0,
        tenantId: groupOwner?.tenantId ?? null,
        requireSnapshot: true,
      });
      if (join.degraded) {
        contextScopePlan = degradeContextScopePlanToMandatory(
          contextScopePlan,
          "scope_persistence_degraded",
        );
      }
    } catch {
      contextScopePlan = degradeContextScopePlanToMandatory(
        contextScopePlan,
        "scope_persistence_degraded",
      );
    }
    if (opts && contextScopePlan) {
      opts.contextScopePlan = contextScopePlan;
    }
  }
  const knowledgeRunId = opts?.runId?.trim();
  // Fail closed: authorization / persist failures strip optional sources. Do not
  // still hand that plan into knowledge retrieval.
  const denyOptionalKnowledge = Boolean(
    contextScopePlan?.reasons.includes("denied:authorize_failed") ||
    contextScopePlan?.reasons.includes("scope_persistence_degraded"),
  );
  // Skip optional knowledge when chat-lane applies (without UI-selected sources) OR CSC
  // says no optional retrieve (minimal / degraded). Selected focused sources survive chat-lane.
  const scopeBlocksOptionalKnowledge = Boolean(
    contextScopePlan && !mayRetrieveOptionalKnowledge(contextScopePlan),
  );
  const willBuildKnowledge = Boolean(
    !isHeartbeat &&
    inboundMessage &&
    !chatLaneSkipsOptionalKnowledge &&
    !denyOptionalKnowledge &&
    !scopeBlocksOptionalKnowledge,
  );
  const knowledgeStartedAtMs = Date.now();
  if (willBuildKnowledge && knowledgeRunId) {
    emitChatInboundStage({
      runId: knowledgeRunId,
      stage: "knowledge_started",
      sessionKey,
      extra: {
        depth: inboundDepthDecision?.depth,
        applySourcePolicy: Boolean(applyRetrievePolicy),
      },
    });
  }
  const knowledgeUniverseContext = willBuildKnowledge
    ? await buildKnowledgeUniversePromptContext({
        message: inboundMessage,
        sessionKey,
        agentId,
        gatewayClientUser: knowledgeIdentity?.user ?? ctx.GatewayClientUser,
        gatewayClientSessionDomain:
          knowledgeIdentity?.sessionDomain ?? ctx.GatewayClientSessionDomain,
        gatewayClientPlatformUserId:
          knowledgeIdentity?.platformUserId ?? ctx.GatewayClientPlatformUserId,
        ownerUserId: groupOwner?.employeeId,
        tenantId: groupOwner?.tenantId,
        scopePlan: contextScopePlan,
        ...(applyRetrievePolicy
          ? {
              applySourcePolicy: true,
              depth: inboundDepthDecision?.depth,
              capabilityCeiling: inboundDepthDecision?.ceiling,
              hasExplicitLiveIntent: detectExplicitLiveIntent(inboundMessage),
              abortSignal: opts?.abortSignal,
            }
          : {}),
      })
    : undefined;
  if (willBuildKnowledge && knowledgeRunId) {
    const diagnostics = knowledgeUniverseContext?.diagnostics;
    emitChatInboundStage({
      runId: knowledgeRunId,
      stage: diagnostics?.timeoutReason ? "knowledge_degraded" : "knowledge_finished",
      sessionKey,
      extra: {
        depth: inboundDepthDecision?.depth,
        knowledgeMs: Date.now() - knowledgeStartedAtMs,
        selectedSourceCount: diagnostics?.selectedSourceCount ?? 0,
        excludedReasons: diagnostics?.excludedReasons ?? [],
        liveSkipped: diagnostics?.liveSkipped ?? true,
        liveInvoked: diagnostics?.liveInvoked ?? false,
        consumeReceipts: knowledgeUniverseContext?.receipts ?? [],
        ...(diagnostics?.timeoutReason ? { timeoutReason: diagnostics.timeoutReason } : {}),
        degraded: Boolean(diagnostics?.timeoutReason),
      },
    });
  }
  const knowledgeUniversePrompt = knowledgeUniverseContext?.promptBlock;
  if (contextScopePlan && !isHeartbeat && inboundMessage && !chatLaneSkipsOptionalKnowledge) {
    try {
      appendContextScopeAuditRecord({
        recordedAtMs: Date.now(),
        ...(knowledgeRunId ? { runId: knowledgeRunId } : {}),
        sessionKey,
        groupId: collaborationGroupId ?? null,
        tenantId: groupOwner?.tenantId ?? null,
        actorUserId: knowledgeIdentity?.platformUserId ?? groupOwner?.employeeId ?? null,
        agentId,
        mode: contextScopePlan.mode,
        confidentialityMaxLevel: contextScopePlan.confidentiality.maxLevel,
        allowedSources: allowedSourcesForAudit(contextScopePlan.sources),
        deniedSources: contextScopePlan.deniedSources ?? [],
        consumeReceipts: knowledgeUniverseContext?.receipts ?? [],
        budgetMaxTokens: contextScopePlan.budget.maxTokens,
        budgetMaxFiles: contextScopePlan.budget.maxFiles,
        evidenceCount: knowledgeUniverseContext?.evidence.length ?? 0,
        selectedSourceCount: knowledgeUniverseContext?.diagnostics?.selectedSourceCount ?? 0,
      });
    } catch {
      // Audit must never block the chat turn.
    }
  }
  const growthBirthPrompt =
    opts?.growthBirthTurn && !isHeartbeat
      ? await buildGrowthBirthSystemPrompt({ cfg, agentId })
      : undefined;
  const cronReplyPrompt =
    !isHeartbeat && ctx.InputProvenance?.kind === "cron" && ctx.InputProvenance.cronJobId
      ? buildCronReplySystemPrompt({
          jobId: ctx.InputProvenance.cronJobId,
          runId: ctx.InputProvenance.cronRunId,
          jobName: ctx.InputProvenance.cronJobName,
        })
      : undefined;
  const groupSystemPrompt = sessionCtx.GroupSystemPrompt?.trim() ?? "";

  const userModelingCandidate = await resolveUserModelingKeyForReply({
    cfg,
    sessionKey,
    sessionCtx,
    ctx,
  });
  const userModelingKey =
    userModelingCandidate && userModelingEnabled(cfg, userModelingCandidate.tenantId)
      ? userModelingCandidate
      : null;
  const userProfile = userModelingKey ? await readUserProfileOrDefault(cfg, userModelingKey) : null;
  const userProfileInstructions = userModelingKey
    ? await resolveUserProfileInstructions(cfg, userModelingKey, {
        execAsk: cfg.tools?.exec?.ask ?? "on-miss",
      })
    : undefined;
  const seatTurnContext = await resolveSeatTurnContext({
    cfg,
    tenantId: replyGatewayTenantId,
    employeeId: ctx.GatewayClientPlatformUserId ?? replyGatewayPlatformUserId,
    agentId,
  });
  const seatRulesPrompt = seatTurnContext?.guidanceText ?? undefined;
  let turnExecutionIdentity = executionIdentity;
  if (seatTurnContext?.seatId) {
    turnExecutionIdentity = refineExecutionIdentityContext(executionIdentity, {
      seatId: seatTurnContext.seatId,
      enterpriseId: replyGatewayTenantId ?? executionIdentity.enterpriseId,
    });
  }
  const isWebchatSurface =
    (ctx.Provider ?? sessionCtx.Provider ?? "").trim().toLowerCase() === "webchat" ||
    (ctx.Surface ?? sessionCtx.Surface ?? "").trim().toLowerCase() === "webchat";
  const userTimezonePrompt =
    !isHeartbeat && inboundMessage
      ? buildReplyUserTimezonePrompt({
          cfg,
          profile: userProfile,
          isWebchat: isWebchatSurface,
        })
      : undefined;
  if (userModelingKey && !isHeartbeat && inboundMessage) {
    void recordUserInteractionSignalSafely(cfg, userModelingKey, inboundMessage).catch(() => {});
  }

  const turnSessionMessages =
    !isHeartbeat && inboundMessage ? readInboundSessionMessages(sessionEntry?.sessionFile) : [];
  const turnReplyLanguage =
    !isHeartbeat && inboundMessage
      ? resolveTurnReplyLanguage({
          userMessage: inboundMessage,
          sessionMessages: turnSessionMessages,
        })
      : null;
  const turnReplyLanguageInstruction =
    turnReplyLanguage !== null ? buildTurnReplyLanguageInstruction(turnReplyLanguage) : undefined;
  const remoteEnvironmentPrompt = buildRemoteGatewayEnvironmentPrompt(runWorkspaceDir);
  if (opts && turnReplyLanguage !== null) {
    opts.expectedReplyLanguage = turnReplyLanguage;
  }

  const sessionFocusResumePrompt =
    !isHeartbeat && inboundMessage
      ? buildTaskBoardContext(replyTurnRuntime.state.read(sessionEntry?.sessionFile))
      : undefined;
  // A ended / ordinary turns: sidecar Q&A must remain visible to the normal reply
  // path (chat.history restores bubbles; model context uses untrusted user-body
  // data — not extraSystemPrompt — via mid-task-aside-dialogue-history helpers).
  const asideDialogueUntrustedContext =
    !isHeartbeat && inboundMessage && sessionEntry?.sessionFile
      ? buildAsideDialogueContextPromptForNormalReply(sessionEntry.sessionFile)
      : undefined;
  const composerPluginMentionBindings = resolveComposerPluginMentionBindings(ctx.ComposerMentions);
  // Mentions supply capability hints only. The admitted runner selects and calls
  // tools through the common authorization, cancellation and task-action boundary.
  let extraSystemPromptParts: string[];
  if (useCollaborationAssembly) {
    extraSystemPromptParts = selectSystemContextParts([
      ...(await assembleCollaborationRuntimeContextParts({
        cfg,
        workspaceDir: runWorkspaceDir,
        agentWorkspaceDir: workspaceDir,
        agentId,
        sessionKey,
        sessionEntry,
        sessionCtx,
        isNewSession,
        shouldInjectGroupIntro,
        defaultActivation,
        silentToken: SILENT_REPLY_TOKEN,
        organizationContext,
        groupSystemPrompt,
        inboundMessage,
        isHeartbeat,
        gatewayClientUser: knowledgeIdentity?.user ?? ctx.GatewayClientUser,
        gatewayClientSessionDomain:
          knowledgeIdentity?.sessionDomain ?? ctx.GatewayClientSessionDomain,
        gatewayClientPlatformUserId:
          knowledgeIdentity?.platformUserId ?? ctx.GatewayClientPlatformUserId,
      })),
      turnReplyLanguageInstruction,
      userProfileInstructions,
      seatRulesPrompt,
      knowledgeUniversePrompt,
      sessionFocusResumePrompt,
      composerPluginMentionBindings.turnPrompt,
      growthBirthPrompt,
      cronReplyPrompt,
    ]);
  } else {
    const groupChatContext = isGroupChat
      ? buildGroupChatContext({ sessionCtx, organizationContext })
      : "";
    const groupIntro = shouldInjectGroupIntro
      ? buildGroupIntro({
          cfg,
          sessionCtx,
          sessionEntry,
          defaultActivation,
          silentToken: SILENT_REPLY_TOKEN,
        })
      : "";
    const inboundMetaPrompt = buildInboundMetaSystemPrompt(
      isNewSession ? sessionCtx : { ...sessionCtx, ThreadStarterBody: undefined },
    );
    // Non-collab 1:1 sessions and chat-lane skips must not inject capability/overlay prompts.
    const collaborationCapabilityPrompt =
      applyChatLane || !useCollaborationAssembly
        ? undefined
        : await buildCollaborationCapabilitySystemPrompt({
            sessionEntry,
            groupId: collaborationGroupId ?? undefined,
            botId: sessionCtx.CollaborationBotAgentId,
            workspaceDir,
            cfg,
          });
    const sessionContinuityPrompt = await buildSessionContinuityPrompt({
      cfg,
      workspaceDir,
      agentId,
      sessionKey,
      sessionEntry,
      isNewSession,
    });
    const conversationTaskFocusPrompt =
      !isHeartbeat && inboundMessage && sessionKey
        ? buildActiveConversationTaskFocusPrompt({
            tenantId: replyGatewayTenantId ?? null,
            requesterId: replyGatewayPlatformUserId ?? null,
            conversationId: sessionKey,
          })
        : undefined;
    const primaryObjectivePrompt =
      !isHeartbeat && inboundMessage
        ? await buildActivePrimaryObjectivePrompt({
            cfg,
            workspaceDir: runWorkspaceDir,
            agentId,
            sessionKey,
            sessionEntry,
          })
        : undefined;
    const taskDataPreflightPrompt =
      !isHeartbeat && inboundMessage ? buildTaskDataPreflightPrompt(inboundMessage) : undefined;
    const operationalIdentityPrompt =
      !isHeartbeat && inboundMessage
        ? await buildOperationalIdentitySystemPrompt({
            agentId,
            sessionKey,
            inboundMessage,
            knowledgeBaseId: knowledgeUniverseContext?.sourceKnowledgeBaseIds?.[0] ?? null,
            gatewayClientUser: knowledgeIdentity?.user ?? ctx.GatewayClientUser,
            gatewayClientSessionDomain:
              knowledgeIdentity?.sessionDomain ?? ctx.GatewayClientSessionDomain,
            gatewayClientPlatformUserId:
              knowledgeIdentity?.platformUserId ?? replyGatewayPlatformUserId,
            gatewayClientSessionEnterpriseId: turnExecutionIdentity.enterpriseId,
            gatewayClientSessionMembershipId: turnExecutionIdentity.membershipId,
            executionIdentity: turnExecutionIdentity,
            ...(applyChatLane ? { listingMode: "lightweight" as const } : {}),
          })
        : undefined;
    extraSystemPromptParts = selectSystemContextParts([
      inboundMetaPrompt,
      groupChatContext,
      groupIntro,
      groupSystemPrompt,
      turnReplyLanguageInstruction,
      userTimezonePrompt,
      remoteEnvironmentPrompt,
      collaborationCapabilityPrompt,
      userProfileInstructions,
      seatRulesPrompt,
      conversationTaskFocusPrompt,
      sessionFocusResumePrompt,
      primaryObjectivePrompt,
      taskDataPreflightPrompt,
      sessionContinuityPrompt,
      knowledgeUniversePrompt,
      operationalIdentityPrompt,
      composerPluginMentionBindings.turnPrompt,
      growthBirthPrompt,
      cronReplyPrompt,
    ]);
  }
  if (taskSurfaceNote) {
    extraSystemPromptParts = appendSystemContextPart(extraSystemPromptParts, taskSurfaceNote);
  }
  if (inboundTaskClarify) {
    extraSystemPromptParts = appendSystemContextPart(extraSystemPromptParts, inboundTaskClarify);
  }
  const currentSpeakerPrompt = buildCurrentSpeakerUntrustedPrompt(sessionCtx);
  if (currentSpeakerPrompt) {
    extraSystemPromptParts = appendSystemContextPart(extraSystemPromptParts, currentSpeakerPrompt);
  }
  if (!isHeartbeat) {
    const learningExposureKey = learningExperienceRunKey(opts?.runId);
    const learningRecallPrompt = await buildLearningRecallSystemPrompt({
      agentId,
      groupId: collaborationGroupId,
      botId:
        sessionCtx.CollaborationBotAgentId?.trim() ||
        sessionCtx.CollaborationPrivateRunBag?.agentId ||
        undefined,
      // Task-bound only; omit key (no agentId fallback) when runId missing.
      exposureKey: learningExposureKey,
    });
    if (learningRecallPrompt) {
      extraSystemPromptParts = appendSystemContextPart(
        extraSystemPromptParts,
        learningRecallPrompt,
      );
    }
  }
  const baseBody = sessionCtx.BodyStripped ?? sessionCtx.Body ?? "";
  // Use CommandBody/RawBody for bare reset detection (clean message without structural context).
  const rawBodyTrimmed = (ctx.CommandBody ?? ctx.RawBody ?? ctx.Body ?? "").trim();
  const baseBodyTrimmedRaw = baseBody.trim();
  if (
    allowTextCommands &&
    (!commandAuthorized || !command.isAuthorizedSender) &&
    !baseBodyTrimmedRaw &&
    hasControlCommand(commandSource, cfg)
  ) {
    typing.cleanup();
    return undefined;
  }
  const isBareNewOrReset = rawBodyTrimmed === "/new" || rawBodyTrimmed === "/reset";
  const isBareSessionReset =
    isNewSession &&
    ((baseBodyTrimmedRaw.length === 0 && rawBodyTrimmed.length > 0) || isBareNewOrReset);
  const baseBodyFinal = isBareSessionReset
    ? buildBareSessionResetPrompt(cfg, undefined, {
        archivedTranscriptPaths:
          archivedTranscriptPaths ??
          resolveArchivedTranscriptPathsForPreviousSession({
            previousSessionEntry,
            storePath,
            agentId,
          }),
        previousSessionId: previousSessionEntry?.sessionId,
      })
    : baseBody;
  // User-role text is the utterance only. Trusted inbound metadata already lives
  // in extraSystemPrompt via buildInboundMetaSystemPrompt. Do not persist Sender /
  // Conversation info onto the stored user message — continuity mining would
  // promote those blocks into task titles.
  const baseBodyForPrompt = baseBodyFinal;
  const baseBodyTrimmed = baseBodyForPrompt.trim();
  const hasMediaAttachment = Boolean(
    sessionCtx.MediaPath || (sessionCtx.MediaPaths && sessionCtx.MediaPaths.length > 0),
  );
  if (!baseBodyTrimmed && !hasMediaAttachment) {
    await typing.onReplyStart();
    logVerbose("Inbound body empty after normalization; skipping agent run");
    typing.cleanup();
    return {
      text: "I didn't receive any text in your message. Please resend or add a caption.",
    };
  }
  // When the user sends media without text, provide a minimal body so the agent
  // run proceeds and the image/document is injected by the embedded runner.
  const effectiveBaseBody = baseBodyTrimmed
    ? baseBodyForPrompt
    : "[User sent media without caption]";
  let prefixedBodyBase = await applySessionHints({
    baseBody: effectiveBaseBody,
    abortedLastRun,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    abortKey: command.abortKey,
  });
  const isGroupSession = sessionEntry?.chatType === "group" || sessionEntry?.chatType === "channel";
  const isMainSession = !isGroupSession && sessionKey === normalizeMainKey(sessionCfg?.mainKey);
  // Extract first-token think hint from the user body. System events stay on
  // the system-role prompt so they cannot shadow low|medium|high shorthand.
  if (!resolvedThinkLevel && prefixedBodyBase) {
    const parts = prefixedBodyBase.split(/\s+/);
    const maybeLevel = normalizeThinkLevel(parts[0]);
    if (maybeLevel && (maybeLevel !== "xhigh" || supportsXHighThinking(provider, model))) {
      resolvedThinkLevel = maybeLevel;
      prefixedBodyBase = parts.slice(1).join(" ").trim();
    }
  }
  // Drain once. Keep Exec / node notices visible to the model, but do not fuse
  // them into the next user instruction or the stored user-role jsonl line.
  const eventsBlock = await drainFormattedSystemEvents({
    cfg,
    sessionKey,
    isMainSession,
    isNewSession,
  });
  if (eventsBlock?.trim()) {
    extraSystemPromptParts = [
      ...extraSystemPromptParts,
      [
        "## Runtime system events",
        "Gateway-originated notices from the previous turn or queue. They are not a new user instruction and must not replace the current user goal.",
        eventsBlock.trim(),
      ].join("\n"),
    ];
  }
  const queueBodyBaseSource = effectiveBaseBody;
  prefixedBodyBase = appendUntrustedContext(prefixedBodyBase, [
    ...(Array.isArray(sessionCtx.UntrustedContext) ? sessionCtx.UntrustedContext : []),
    ...(asideDialogueUntrustedContext ? [asideDialogueUntrustedContext] : []),
  ]);
  const threadStarterBody = ctx.ThreadStarterBody?.trim();
  const threadHistoryBody = ctx.ThreadHistoryBody?.trim();
  const threadContextNote = threadHistoryBody
    ? `[Thread history - for context]\n${threadHistoryBody}`
    : threadStarterBody
      ? `[Thread starter - for context]\n${threadStarterBody}`
      : undefined;
  const runtimeSkillPolicy =
    applyChatLane || !useCollaborationAssembly
      ? { block: [] as string[] }
      : await resolveRuntimeSkillPolicy({
          groupId: collaborationGroupId,
          sessionEntry,
          botId: sessionCtx.CollaborationBotAgentId,
        });
  const preferSkillNames = applyChatLane ? [] : resolveTurnPreferSkillNames(inboundMessage);
  const preferSkillHint = formatTurnPreferSkillHint(preferSkillNames);
  if (preferSkillHint) {
    extraSystemPromptParts = appendSystemContextPart(extraSystemPromptParts, preferSkillHint);
  }
  // Skill guidance is shared context. A conversation may select guidance without
  // gaining executable tools; mandatory action skills remain execution-only.
  const policySkillFilter = applySkillPolicyToFilter(opts?.skillFilter, runtimeSkillPolicy);
  const skillFilter =
    !applyChatLane &&
    isBuiltinStewardAgent(agentId) &&
    shouldForceStewardRequiredSkills(inboundDepthDecision?.depth)
      ? ensureStewardRequiredSkills(policySkillFilter)
      : policySkillFilter;
  const skillResult = await ensureSkillSnapshot({
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionId,
    isFirstTurnInSession,
    workspaceDir,
    cfg,
    skillFilter,
    ...(applyChatLane || runtimeSkillPolicy.block.length === 0
      ? {}
      : { skillBlocklist: runtimeSkillPolicy.block }),
    ...(preferSkillNames.length > 0 ? { preferSkillNames } : {}),
  });
  sessionEntry = skillResult.sessionEntry ?? sessionEntry;
  currentSystemSent = skillResult.systemSent;
  const skillsSnapshot = skillResult.skillsSnapshot;
  const prefixedBody = [threadContextNote, prefixedBodyBase].filter(Boolean).join("\n\n");
  const mediaNote = buildInboundMediaNote(ctx);
  const mediaReplyHint =
    mediaNote && inboundMediaNeedsImageReplyHint(ctx)
      ? "To send an image back, prefer the message tool (media/path/filePath). If you must inline, use MEDIA:https://example.com/image.jpg (spaces ok, quote if needed) or a safe relative path like MEDIA:./image.jpg. Avoid absolute paths (MEDIA:/...) and ~ paths — they are blocked for security. Keep caption in the text body."
      : undefined;
  let prefixedCommandBody = mediaNote
    ? [mediaNote, mediaReplyHint, prefixedBody ?? ""].filter(Boolean).join("\n").trim()
    : prefixedBody;
  if (!resolvedThinkLevel) {
    resolvedThinkLevel = await modelState.resolveDefaultThinkingLevel();
  }
  if (resolvedThinkLevel === "xhigh" && !supportsXHighThinking(provider, model)) {
    const explicitThink = directives.hasThinkDirective && directives.thinkLevel !== undefined;
    if (explicitThink) {
      typing.cleanup();
      return {
        text: `Thinking level "xhigh" is only supported for ${formatXHighModelHint()}. Use /think high or switch to one of those models.`,
      };
    }
    resolvedThinkLevel = "high";
    if (sessionEntry && sessionStore && sessionKey && sessionEntry.thinkingLevel === "xhigh") {
      sessionEntry.thinkingLevel = "high";
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      if (storePath) {
        await updateSessionStore(storePath, (store) => {
          store[sessionKey] = sessionEntry;
        });
      }
    }
  }
  if (resetTriggered && command.isAuthorizedSender) {
    await sendResetSessionNotice({
      ctx,
      command,
      sessionKey,
      cfg,
      accountId: ctx.AccountId,
      threadId: ctx.MessageThreadId,
      provider,
      model,
      defaultProvider,
      defaultModel,
    });
  }
  const sessionIdFinal = sessionId ?? crypto.randomUUID();
  // Collaboration already appends the user turn to the shared GROUP_PUBLIC transcript.
  // Stay on that shared file so toolCall/toolResult persist for chat.history(includeTools)
  // and checkpoint restore rewinds the same bytes the model will read next turn.
  // skipUserTranscriptPersist avoids double user ingest; prepareSessionManagerForRun must
  // not wipe GROUP_PUBLIC paths (see session-manager-init).
  const sessionFile = resolveCollaborationAwareSessionFile({
    sessionId: sessionIdFinal,
    sessionKey,
    sessionEntry,
    agentId,
    storePath,
    cfg,
  });
  let admittedBinding = opts?.resumedTaskBinding;
  if (interactionIngress && !admittedBinding) {
    const persistOwnReply = (text: string) => {
      if (interactionIngress.persistOwnTranscript) {
        replyTurnRuntime.persistInteractionMessage({
          sessionFile,
          sessionId: sessionIdFinal,
          cwd: runWorkspaceDir,
          messageId: interactionIngress.userMessageId,
          role: "assistant",
          text,
        });
      }
      return { text };
    };
    if (interactionIngress.persistOwnTranscript) {
      replyTurnRuntime.persistInteractionMessage({
        sessionFile,
        sessionId: sessionIdFinal,
        cwd: runWorkspaceDir,
        messageId: interactionIngress.userMessageId,
        role: "user",
        text: inboundMessage,
      });
    }
    const board = replyTurnRuntime.state.read(sessionFile);
    const captured = {
      expectedFocusRevision: board.focusRevision,
      expectedWriteEpoch: board.writeEpoch ?? 0,
      expectedTaskId: board.current?.taskId,
    };
    const transcript = openSessionManager(sessionFile);
    const history = transcript.buildSessionContext().messages;
    const bootstrap = await resolveBootstrapContextForRun({
      workspaceDir: runWorkspaceDir,
      config: cfg,
      sessionKey,
      sessionId: sessionIdFinal,
      agentId,
    });
    const systemContext = [
      ...bootstrap.contextFiles.map((file) => `## ${file.path}\n${file.content}`),
      skillsSnapshot?.prompt,
      finalizeSystemContext(extraSystemPromptParts),
    ].filter((part): part is string => Boolean(part));
    const interactionAuthProfileId = await resolveSessionAuthProfileOverride({
      cfg,
      provider,
      agentDir,
      sessionEntry,
      sessionStore,
      sessionKey,
      storePath,
      isNewSession,
    });
    const routed = await replyTurnRuntime.interaction({
      config: cfg,
      runId: opts?.runId ?? crypto.randomUUID(),
      agentId,
      agentDir,
      sessionKey,
      sessionFile,
      requestId: interactionIngress.userMessageId,
      captured,
      authorized: commandAuthorized && command.isAuthorizedSender,
      identity: {
        executionIdentity: turnExecutionIdentity,
        gatewayClientUser: replyGatewayUser,
        gatewayClientPlatformUserId: replyGatewayPlatformUserId,
        gatewayClientSessionDomain: ctx.GatewayClientSessionDomain,
      },
      provider,
      model,
      authProfileId: interactionAuthProfileId,
      timeoutMs,
      input: {
        message: prefixedCommandBody,
        images: opts?.images,
        abortSignal: opts?.abortSignal,
        taskTarget: board.current
          ? { taskId: board.current.taskId, revision: String(board.writeEpoch ?? 0) }
          : undefined,
        context: [
          ...systemContext.map((content) => ({ role: "system" as const, content })),
          ...projectInteractionHistory(history, interactionIngress.userMessageId),
        ],
      },
    });
    if (routed.kind === "respond") {
      typing.cleanup();
      return persistOwnReply(routed.text);
    }
    let acceptedCriteria: readonly string[] = [];
    if (routed.kind === "task_proposal") {
      opts?.abortSignal?.throwIfAborted();
      if (routed.decision.kind === "task_control" && routed.decision.action === "resume") {
        const resumed =
          commandAuthorized && command.isAuthorizedSender && opts?.onInteractionTaskResume
            ? await opts.onInteractionTaskResume({
                sessionFile,
                taskId: routed.decision.target.taskId,
                expectedFocusRevision: captured.expectedFocusRevision,
                expectedWriteEpoch: captured.expectedWriteEpoch,
                abortSignal: opts.abortSignal,
              })
            : { kind: "rejected" as const, reason: "resume_requires_live_recheck" };
        opts?.abortSignal?.throwIfAborted();
        if (resumed.kind !== "accepted") {
          typing.cleanup();
          return persistOwnReply(formatTaskProposalReply(routed.decision, resumed));
        }
        admittedBinding = resumed.binding;
        acceptedCriteria = resumed.acceptance;
      } else {
        const applied =
          commandAuthorized && command.isAuthorizedSender
            ? replyTurnRuntime.state.applyInteractionProposal({
                sessionFile,
                ...captured,
                decision:
                  routed.decision.kind === "task_change"
                    ? { ...routed.decision, text: inboundMessage }
                    : routed.decision,
              })
            : { kind: "rejected" as const, reason: "unauthorized" };
        if (applied.kind === "applied" && applied.abort) {
          replyTurnRuntime.interrupt(sessionIdFinal, sessionKey);
          if (routed.decision.kind === "task_control" && routed.decision.action !== "resume") {
            await opts?.onInteractionTaskEffect?.({
              kind: routed.decision.action,
              taskId: routed.decision.target.taskId,
              previousRunId: board.current?.executionAttempt,
            });
          }
        }
        if (applied.kind === "applied" && routed.decision.kind === "task_change") {
          replyTurnRuntime.steer(sessionIdFinal, inboundMessage);
        }
        typing.cleanup();
        return persistOwnReply(formatTaskProposalReply(routed.decision, applied));
      }
    }
    if (routed.kind === "execution_admission") {
      if (routed.result.kind !== "accepted") {
        typing.cleanup();
        return persistOwnReply(
          routed.result.kind === "duplicate"
            ? "该执行请求已经接纳，未重复启动。"
            : "任务状态已变化或执行未获准，本次未启动；请确认当前目标后重试。",
        );
      }
      admittedBinding = routed.result.binding;
      acceptedCriteria = routed.result.acceptance;
      await opts?.onInteractionTaskEffect?.({
        kind: "replace",
        taskId: board.current?.taskId ?? "",
        previousRunId: board.current?.executionAttempt,
      });
    }
    if (!admittedBinding) {
      typing.cleanup();
      return persistOwnReply("执行请求缺少有效任务身份，本次未启动。");
    }
    const acceptedTask = replyTurnRuntime.state.read(sessionFile).current;
    if (acceptedTask?.taskId !== admittedBinding.taskId) {
      typing.cleanup();
      return persistOwnReply("任务焦点已变化，本次未启动执行。");
    }
    extraSystemPromptParts = extraSystemPromptParts.filter(
      (part) => part !== sessionFocusResumePrompt,
    );
    extraSystemPromptParts.push(
      [
        "## Admitted execution request",
        "This is the authoritative accepted goal for this execution. Earlier task references are history only.",
        buildResumePrompt(acceptedTask),
        `Goal: ${acceptedTask.goalText}`,
        "Acceptance criteria:",
        ...acceptedCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
      ].join("\n"),
    );
    // New accepted focus supersedes the old active attempt, using the existing abort path.
    abortEmbeddedPiRun(sessionIdFinal);
  }
  const collaborationRoundInvoked = sessionCtx.CollaborationRoundInvoked === true;
  // Queue body stays the user utterance (plus thread/media notes). System events
  // travel with followupRun.run.extraSystemPrompt so deferred turns still see them.
  const queueBodyBase = [threadContextNote, queueBodyBaseSource].filter(Boolean).join("\n\n");
  const queuedBody = mediaNote
    ? [mediaNote, mediaReplyHint, queueBodyBase].filter(Boolean).join("\n").trim()
    : queueBodyBase;
  const resolvedQueue = resolveQueueSettings({
    cfg,
    channel: sessionCtx.Provider,
    sessionEntry,
    inlineMode: perMessageQueueMode,
    inlineOptions: perMessageQueueOptions,
  });
  const sessionLaneKey = resolveEmbeddedSessionLane(sessionKey ?? sessionIdFinal);
  const laneSize = getQueueSize(sessionLaneKey);
  if (resolvedQueue.mode === "interrupt" && laneSize > 0) {
    const cleared = clearCommandLane(sessionLaneKey);
    const aborted = abortEmbeddedPiRun(sessionIdFinal);
    logVerbose(`Interrupting ${sessionLaneKey} (cleared ${cleared}, aborted=${aborted})`);
  }
  const queueKey = sessionKey ?? sessionIdFinal;
  const isActive = isEmbeddedPiRunActive(sessionIdFinal);
  const oguiUserId =
    turnExecutionIdentity?.platformUserId?.trim() ||
    replyGatewayPlatformUserId?.trim() ||
    undefined;
  let oguiDecisionRun = resolveOguiDecisionRunBinding({
    cfg,
    agentId,
    tenantId: replyGatewayTenantId,
    storePath,
    sessionKey,
    userId: oguiUserId,
    originRunId: opts?.runId ?? sessionIdFinal,
    taskContextId: sessionEntry?.taskContextId,
    originUserMessageRef: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,
    ingress: isHeartbeat ? "heartbeat" : "chat",
  });
  const oguiAdmission = await admitOguiDecisionTurn({
    cfg,
    agentId,
    tenantId: replyGatewayTenantId,
    storePath,
    sessionKey,
    userId: oguiUserId,
    inboundText: inboundMessage,
    ingress: isHeartbeat ? "heartbeat" : resetTriggered ? "reset" : "chat",
    resetAuthorized: resetTriggered && command.isAuthorizedSender,
    phase: isActive ? "gate" : "run",
    binding: oguiDecisionRun,
  });
  if (oguiAdmission.action === "pause" || oguiAdmission.action === "ack") {
    typing.cleanup();
    return { text: oguiAdmission.text ?? "" };
  }
  let oguiResumeExec: { decisionId: string; resumeRef: string } | undefined;
  if (
    oguiAdmission.action === "resume" &&
    oguiAdmission.decisionId &&
    oguiAdmission.resumeRef &&
    oguiDecisionRun &&
    storePath &&
    sessionKey
  ) {
    oguiDecisionRun = {
      ...oguiDecisionRun,
      decisionId: oguiAdmission.decisionId,
      resumeRef: oguiAdmission.resumeRef,
    };
    oguiResumeExec = {
      decisionId: oguiAdmission.decisionId,
      resumeRef: oguiAdmission.resumeRef,
    };
  }
  const oguiAuthorityPrompt =
    oguiResumeExec && oguiAdmission.acceptedPrompt ? oguiAdmission.acceptedPrompt : undefined;
  if (oguiAuthorityPrompt) {
    prefixedCommandBody = oguiAuthorityPrompt;
  }
  const agentSessionCtx = oguiAuthorityPrompt
    ? {
        ...sessionCtx,
        Body: oguiAuthorityPrompt,
        RawBody: oguiAuthorityPrompt,
        CommandBody: oguiAuthorityPrompt,
        BodyStripped: oguiAuthorityPrompt,
        BodyForAgent: oguiAuthorityPrompt,
        BodyForCommands: oguiAuthorityPrompt,
      }
    : sessionCtx;
  const isStreaming = isEmbeddedPiRunStreaming(sessionIdFinal);
  const shouldSteer = resolvedQueue.mode === "steer" || resolvedQueue.mode === "steer-backlog";
  const shouldFollowup =
    resolvedQueue.mode === "followup" ||
    resolvedQueue.mode === "collect" ||
    resolvedQueue.mode === "steer-backlog";
  const authProfileId = await resolveSessionAuthProfileOverride({
    cfg,
    provider,
    agentDir,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    isNewSession,
  });
  const authProfileIdSource = sessionEntry?.authProfileOverrideSource;
  const knowledgeConsumeRefs = knowledgeConsumeRefsFromScopePlan(contextScopePlan);
  const followupRun = {
    prompt: queuedBody,
    messageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid,
    summaryLine: baseBodyTrimmedRaw,
    enqueuedAt: Date.now(),
    // Originating channel for reply routing.
    originatingChannel: ctx.OriginatingChannel,
    originatingTo: ctx.OriginatingTo,
    originatingAccountId: ctx.AccountId,
    originatingThreadId: ctx.MessageThreadId,
    originatingChatType: ctx.ChatType,
    run: {
      agentId,
      agentDir,
      sessionId: sessionIdFinal,
      sessionKey,
      messageProvider: resolveOriginMessageProvider({
        originatingChannel: ctx.OriginatingChannel ?? sessionCtx.OriginatingChannel,
        // Prefer Provider over Surface for fallback channel identity.
        // Surface can carry relayed metadata (for example "webchat") while Provider
        // still reflects the active channel that should own tool routing.
        provider: ctx.Provider ?? ctx.Surface ?? sessionCtx.Provider,
      }),
      // P5（model-entitlement-chain §6.5）：透传发起会话身份，供 followup 闸口在
      // scope=all-bot-runs 下复用 employee 会话身份（否则按 bot 归属席位解析）。
      executionIdentity: turnExecutionIdentity,
      ...((knowledgeIdentity?.user ?? ctx.GatewayClientUser)
        ? { gatewayClientUser: knowledgeIdentity?.user ?? ctx.GatewayClientUser }
        : {}),
      ...((knowledgeIdentity?.sessionDomain ?? ctx.GatewayClientSessionDomain)
        ? {
            gatewayClientSessionDomain:
              knowledgeIdentity?.sessionDomain ?? ctx.GatewayClientSessionDomain,
          }
        : {}),
      ...((knowledgeIdentity?.platformUserId ?? replyGatewayPlatformUserId)
        ? {
            gatewayClientPlatformUserId:
              knowledgeIdentity?.platformUserId ?? replyGatewayPlatformUserId,
          }
        : {}),
      agentAccountId: sessionCtx.AccountId,
      groupId: collaborationGroupId ?? undefined,
      groupChannel: sessionCtx.GroupChannel?.trim() ?? sessionCtx.GroupSubject?.trim(),
      groupSpace: sessionCtx.GroupSpace?.trim() ?? undefined,
      senderId: sessionCtx.SenderId?.trim() || undefined,
      senderName: sessionCtx.SenderName?.trim() || undefined,
      senderUsername: sessionCtx.SenderUsername?.trim() || undefined,
      senderE164: sessionCtx.SenderE164?.trim() || undefined,
      senderIsOwner: command.senderIsOwner,
      sessionFile,
      taskCompletionBinding:
        admittedBinding ?? replyTurnRuntime.state.captureBinding(sessionFile, inboundMessage),
      ...(admittedBinding ? { executionAdmitted: true } : {}),
      skipUserTranscriptPersist: collaborationRoundInvoked || Boolean(interactionIngress),
      collaborationRoundInvoked,
      ...(sessionCtx.DeliveryToolSideEffect
        ? { deliveryToolSideEffect: sessionCtx.DeliveryToolSideEffect }
        : {}),
      ...(sessionCtx.CollaborationPrivateRunBag
        ? { privateRunBag: sessionCtx.CollaborationPrivateRunBag }
        : {}),
      workspaceDir: runWorkspaceDir,
      config: cfg,
      skillsSnapshot,
      provider,
      model,
      authProfileId,
      authProfileIdSource,
      thinkLevel: resolvedThinkLevel,
      verboseLevel: resolvedVerboseLevel,
      reasoningLevel: resolvedReasoningLevel,
      elevatedLevel: resolvedElevatedLevel,
      execOverrides,
      bashElevated: {
        enabled: elevatedEnabled,
        allowed: elevatedAllowed,
        defaultLevel: resolvedElevatedLevel ?? "off",
      },
      timeoutMs,
      blockReplyBreak: resolvedBlockStreamingBreak,
      ownerNumbers: command.ownerList.length > 0 ? command.ownerList : undefined,
      inputProvenance: ctx.InputProvenance ?? sessionCtx.InputProvenance,
      extraSystemPrompt: finalizeSystemContext(extraSystemPromptParts),
      organizationContext,
      ...(isReasoningTagProvider(provider) ? { enforceFinalTag: true } : {}),
      ...(applyChatLane && !admittedBinding ? { disableTools: true } : {}),
      ...(useCollaborationAssembly && !applyChatLane ? { skillPolicy: runtimeSkillPolicy } : {}),
      ...(applyRetrieveToolPolicy && inboundDepthDecision && !admittedBinding
        ? {
            inboundToolCeiling: {
              depth: inboundDepthDecision.depth,
              maxToolMode: inboundDepthDecision.ceiling.maxToolMode,
              maxSideEffectLevel: inboundDepthDecision.ceiling.maxSideEffectLevel,
            },
          }
        : {}),
      contextLane,
      ...(sessionEntry ? { sessionEntry } : {}),
      ...(oguiDecisionRun ? { oguiDecisionRun } : {}),
      ...(knowledgeConsumeRefs.length ? { knowledgeConsumeRefs } : {}),
      ...(composerPluginMentionBindings.pluginToolAllowlist.length
        ? { mentionedPluginToolAllowlist: composerPluginMentionBindings.pluginToolAllowlist }
        : {}),
    },
  };

  const runAgent = () =>
    runReplyAgent({
      commandBody: prefixedCommandBody,
      followupRun,
      queueKey,
      resolvedQueue,
      shouldSteer,
      shouldFollowup,
      isActive,
      isStreaming,
      opts,
      typing,
      sessionEntry,
      sessionStore,
      sessionKey,
      storePath,
      defaultModel,
      agentCfgContextTokens: agentCfg?.contextTokens,
      resolvedVerboseLevel: resolvedVerboseLevel ?? "off",
      isNewSession,
      blockStreamingEnabled,
      blockReplyChunking,
      resolvedBlockStreamingBreak,
      sessionCtx: agentSessionCtx,
      shouldInjectGroupIntro,
      typingMode,
    });
  let reply: Awaited<ReturnType<typeof runReplyAgent>>;
  if (oguiResumeExec && storePath && sessionKey) {
    try {
      reply = await runWithOguiDecisionResume({
        storePath,
        sessionKey,
        decisionId: oguiResumeExec.decisionId,
        resumeRef: oguiResumeExec.resumeRef,
        lifecycleEnabled: true,
        run: runAgent,
      });
    } catch (err) {
      await releaseOguiDecisionResume({
        storePath,
        sessionKey,
        decisionId: oguiResumeExec.decisionId,
        resumeRef: oguiResumeExec.resumeRef,
        lifecycleEnabled: true,
      });
      throw err;
    }
  } else {
    reply = await runAgent();
  }
  if (
    reply &&
    knowledgeUniverseContext?.sourceUserId &&
    knowledgeUniverseContext.evidence.length > 0
  ) {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: knowledgeUniverseContext.sourceUserId,
      tenantId: knowledgeUniverseContext.sourceTenantId,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      upsertKnowledgeLineage({
        db: index.db,
        lineageId: knowledgeLineageId,
        kind: "generation",
        sessionKey,
        messageId: sessionCtx.MessageSidFull ?? sessionCtx.MessageSid ?? null,
        agentId,
        groupId: collaborationGroupId ?? null,
        generationPromptHash: crypto
          .createHash("sha256")
          .update(`${knowledgeUniversePrompt}\n\n${inboundMessage}`)
          .digest("hex"),
        sourceChunkIds: knowledgeUniverseContext.sourceChunkIds,
        sourceKnowledgeBaseIds: knowledgeUniverseContext.sourceKnowledgeBaseIds,
        sourceAgentIds: [agentId],
        sourceTaskIds:
          ctx.InputProvenance?.kind === "cron" && ctx.InputProvenance.cronJobId
            ? [ctx.InputProvenance.cronJobId]
            : [],
      });
    } catch (error) {
      logVerbose(
        `Failed to write knowledge generation lineage: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      index.close();
    }
  }
  return reply;
}

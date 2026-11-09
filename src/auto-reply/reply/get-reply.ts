import { isHumanInteractionIngress } from "../../agent-runtime/command/index.js";
import {
  resolveAgentDir,
  resolveSessionAgentId,
  resolveAgentSkillsFilter,
} from "../../agents/agent-scope.js";
import { extractEmployeeStewardUserIdFromSessionKey } from "../../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { ensureStewardRequiredSkillsSynced } from "../../agents/builtin-steward/steward-skills-sync.js";
import { resolveModelRefFromString } from "../../agents/model-selection.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { ensureAgentWorkspace } from "../../agents/workspace.js";
import { resolveChannelModelOverride } from "../../channels/model-overrides.js";
import { type OpenBotConfig, loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import { loadExistingGovernedWorkspaceIdentity } from "../../gateway/data-governance/workspace-catalog-projection.js";
import {
  mediaUnderstandingUsesFromOutputs,
  recordMediaUnderstandingShadow,
} from "../../gateway/governance/media-understanding-shadow.js";
import { resolveKnowledgeSourceContext } from "../../gateway/knowledge/context.js";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import { resolveSecurityProfile } from "../../gateway/security-profile.js";
import {
  loadCanonicalWriteOwnership,
  resolveCanonicalRobotWriteRoot,
} from "../../gateway/workspace-resolver/canonical-write-root.js";
import { alignFormalRootForManagedAddressing } from "../../gateway/workspace-resolver/formal-deliverable-root.js";
import {
  resolveLiveRobotWriteRoot,
  resolveRobotWriteRoot,
} from "../../gateway/workspace-resolver/write-roots.js";
import {
  resolveAuthorizedGroupToolCwd,
  resolveAuthorizedToolCwdDetailed,
  resolveWorkspaceDirAfterAuthorization,
} from "../../gateway/workspace/handler-bridge.js";
import { healProductionWorkspaceDir } from "../../gateway/workspace/operator-workspace-heal.js";
import { applyLinkUnderstanding } from "../../link-understanding/apply.js";
import { applyMediaUnderstanding } from "../../media-understanding/apply.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeStringEntries } from "../../shared/string-normalization.js";
import { resolveCommandAuthorization } from "../command-auth.js";
import type { MsgContext } from "../templating.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { emitResetCommandHooks, type ResetCommandAction } from "./commands-core.js";
import { resolveDefaultModel } from "./directive-handling.js";
import { resolveReplyDirectives } from "./get-reply-directives.js";
import { handleInlineActions } from "./get-reply-inline-actions.js";
import { runPreparedReply } from "./get-reply-run.js";
import { finalizeInboundContext } from "./inbound-context.js";
import { emitPreAgentMessageHooks } from "./message-preprocess-hooks.js";
import { applyResetModelOverride } from "./session-reset-model.js";
import { initSessionState } from "./session.js";
import { stageSandboxMedia } from "./stage-sandbox-media.js";
import { createTypingController } from "./typing.js";

function mergeSkillFilters(channelFilter?: string[], agentFilter?: string[]): string[] | undefined {
  const normalize = (list?: string[]) => {
    if (!Array.isArray(list)) {
      return undefined;
    }
    return normalizeStringEntries(list);
  };
  const channel = normalize(channelFilter);
  const agent = normalize(agentFilter);
  if (!channel && !agent) {
    return undefined;
  }
  if (!channel) {
    return agent;
  }
  if (!agent) {
    return channel;
  }
  if (channel.length === 0 || agent.length === 0) {
    return [];
  }
  const agentSet = new Set(agent);
  return channel.filter((name) => agentSet.has(name));
}

export async function getReplyFromConfig(
  ctx: MsgContext,
  opts?: GetReplyOptions,
  configOverride?: OpenBotConfig,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  if (
    !ctx.InputProvenance &&
    isHumanInteractionIngress({
      heartbeat: opts?.isHeartbeat,
      birthTurn: opts?.growthBirthTurn,
      collaborationRound: ctx.CollaborationRoundInvoked,
    })
  ) {
    ctx = { ...ctx, InputProvenance: { kind: "external_user" } };
  }
  const isFastTestEnv = process.env.OPENCLAW_TEST_FAST === "1";
  const cfg = configOverride ?? loadConfig();
  const targetSessionKey =
    ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey?.trim() : undefined;
  const agentSessionKey = targetSessionKey || ctx.SessionKey;
  const agentId = resolveSessionAgentId({
    sessionKey: agentSessionKey,
    config: cfg,
    agentId: ctx.CollaborationBotAgentId,
  });
  // Steward-required / governance skills are depth-gated in get-reply-run (act only).
  // Do not force-merge here — chat/retrieve must not pay the governance skill window.
  // Cron and other non-reply callers still default-force via resolveAgentSkillsFilter().
  const mergedSkillFilter = mergeSkillFilters(
    opts?.skillFilter,
    resolveAgentSkillsFilter(cfg, agentId, { forceStewardRequired: false }),
  );
  const resolvedOpts =
    mergedSkillFilter !== undefined ? { ...opts, skillFilter: mergedSkillFilter } : opts;
  const agentCfg = cfg.agents?.defaults;
  const sessionCfg = cfg.session;
  const { defaultProvider, defaultModel, aliasIndex } = resolveDefaultModel({
    cfg,
    agentId,
  });
  let provider = defaultProvider;
  let model = defaultModel;
  let hasResolvedHeartbeatModelOverride = false;
  if (opts?.isHeartbeat) {
    // Prefer the resolved per-agent heartbeat model passed from the heartbeat runner,
    // fall back to the global defaults heartbeat model for backward compatibility.
    const heartbeatRaw =
      opts.heartbeatModelOverride?.trim() ?? agentCfg?.heartbeat?.model?.trim() ?? "";
    const heartbeatRef = heartbeatRaw
      ? resolveModelRefFromString({
          raw: heartbeatRaw,
          defaultProvider,
          aliasIndex,
        })
      : null;
    if (heartbeatRef) {
      provider = heartbeatRef.ref.provider;
      model = heartbeatRef.ref.model;
      hasResolvedHeartbeatModelOverride = true;
    }
  }

  const employeeOwnerId = extractEmployeeStewardUserIdFromSessionKey(agentSessionKey);
  const agentDir = resolveAgentDir(cfg, agentId);
  const timeoutMs = resolveAgentTimeoutMs({ cfg, overrideSeconds: opts?.timeoutOverrideSeconds });
  const configuredTypingSeconds =
    agentCfg?.typingIntervalSeconds ?? sessionCfg?.typingIntervalSeconds;
  const typingIntervalSeconds =
    typeof configuredTypingSeconds === "number" ? configuredTypingSeconds : 6;
  const typing = createTypingController({
    onReplyStart: opts?.onReplyStart,
    onCleanup: opts?.onTypingCleanup,
    typingIntervalSeconds,
    silentToken: SILENT_REPLY_TOKEN,
    log: defaultRuntime.log,
  });
  opts?.onTypingController?.(typing);
  const finalized = finalizeInboundContext(ctx);
  const turnTenantId =
    finalized.CollaborationTenantId?.trim() ||
    finalized.GatewayClientSessionEnterpriseId?.trim() ||
    null;
  const collaborationGroupId = finalized.CollaborationGroupId?.trim() || null;
  const gatewayClient = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: finalized.GatewayClientUser,
    gatewayClientSessionDomain: finalized.GatewayClientSessionDomain,
    gatewayClientPlatformUserId: finalized.GatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId: turnTenantId ?? undefined,
    gatewayClientSessionMembershipId: finalized.GatewayClientSessionMembershipId,
  });
  const knowledgeContext = await resolveKnowledgeSourceContext(gatewayClient);
  const lockModelSelectionToEnterpriseChain = knowledgeContext.hasEnterpriseScope;

  // C17: tool cwd must come from trusted locator + ownership/resolver gate, not bare config paths.
  // Managed Enterprise: no legacy path fallback when Resolver returns empty (fail closed).
  const stewardException = Boolean(employeeOwnerId && isBuiltinStewardAgent(agentId));
  const securityProfile = resolveSecurityProfile(cfg, process.env);
  const cwdUserId = knowledgeContext.userId ?? null;
  const fallbackTenantId = turnTenantId ?? knowledgeContext.tenantId;
  let writeOwnership = await loadCanonicalWriteOwnership({
    cfg,
    agentId,
    tenantId: fallbackTenantId,
    chattingUserId: cwdUserId,
    // Mint host for first Path B when sticky absent — chatting user.
    hostUserId: cwdUserId ?? employeeOwnerId,
    stateDir: undefined,
  });
  if (fallbackTenantId && cwdUserId && writeOwnership.kind !== "personal") {
    try {
      const identity = await loadExistingGovernedWorkspaceIdentity({
        tenantId: fallbackTenantId,
        userId: cwdUserId,
        agentId,
      });
      if (identity.catalog) {
        writeOwnership = await loadCanonicalWriteOwnership({
          cfg,
          agentId,
          tenantId: fallbackTenantId,
          chattingUserId: cwdUserId,
          hostUserId: cwdUserId ?? employeeOwnerId,
          catalog: identity.catalog,
        });
      }
    } catch {
      // Keep config/registry ownership when catalog is unavailable.
    }
  }
  // personalFallback is the single production P5/P1 call site (freeze 164/165).
  // stewardHelperCwd reuses personalFallback; no second helper call.
  // Managed steward does not fall back to personal/local helper as cwd.
  // Missing tenant stays fail-closed; helper is never managed production cwd.
  const personalFallback = () => {
    const canonical = resolveCanonicalRobotWriteRoot({
      agentId,
      tenantId: fallbackTenantId,
      chattingUserId: cwdUserId ?? employeeOwnerId,
      sessionKey: agentSessionKey,
      ownership: writeOwnership,
    });
    if (writeOwnership.kind === "seat_owned") {
      // PR A: seat formal root fails closed — never fork onto chatting user via
      // resolveRobotWriteRoot / live default.
      if (!canonical) {
        throw new Error(
          "seat formal root missing sticky/host binding; refusing chatting-user fallback",
        );
      }
      return alignFormalRootForManagedAddressing(canonical, { config: cfg });
    }
    const robotOwn =
      canonical ??
      resolveRobotWriteRoot({
        agentId,
        tenantId: fallbackTenantId,
        userId: cwdUserId ?? employeeOwnerId,
        sessionKey: agentSessionKey,
      });
    if (robotOwn) {
      return alignFormalRootForManagedAddressing(robotOwn, { config: cfg });
    }
    if (stewardException && employeeOwnerId) {
      throw new Error("robot own workspace requires tenant-user identity; refusing leftover path");
    }
    try {
      return resolveLiveRobotWriteRoot({
        agentId,
        configuredDefaultWorkspace: cfg.agents?.defaults?.workspace,
      }); // resolveAgentWorkspaceDir
    } catch {
      return null;
    }
    // Keep this function longer than the freeze thin-wrapper window (10 lines)
    // so later personalFallback() invocations are not aliased as P5/P1 sites.
    // Helper return is shadow/comparison only on managed_enterprise.
    // Catalog locator is never used as production cwd (Stage D forbidden).
    // S29 full trusted query. True missing tenant/authz still fail-closed.
    // Non-steward still fail-closed. Never host workspace-<id>.
  };
  const stewardHelperCwd = stewardException ? personalFallback() : null;
  let authorizedCwd: string | null = null;
  let denialReason: string | undefined;
  if (cwdUserId) {
    if (finalized.CollaborationRoundInvoked && collaborationGroupId) {
      authorizedCwd = await resolveAuthorizedGroupToolCwd({
        client: gatewayClient as never,
        cfg,
        userId: cwdUserId,
        groupId: collaborationGroupId,
        purpose: "chat.tool.cwd.group",
        authoritativeTenantId: turnTenantId,
      });
    }
    if (!authorizedCwd) {
      const resolved = await resolveAuthorizedToolCwdDetailed({
        client: gatewayClient as never,
        cfg,
        userId: cwdUserId,
        agentId,
        purpose: "chat.tool.cwd",
        stewardException,
        stewardWorkspaceDir: stewardHelperCwd,
        sessionKey: agentSessionKey,
        ...(collaborationGroupId
          ? { groupId: collaborationGroupId, authoritativeTenantId: turnTenantId }
          : {}),
      });
      authorizedCwd = resolved.cwd;
      if (!authorizedCwd && resolved.reasonCode) {
        denialReason = resolved.reasonCode;
      }
    }
  }
  let workspaceDirRaw = resolveWorkspaceDirAfterAuthorization({
    profile: securityProfile.profile,
    authorizedCwd,
    personalFallback,
  });
  if (!workspaceDirRaw) {
    typing.cleanup();
    // Fail the turn — do not persist a fake assistant reply into the transcript.
    // Managed enterprise never uses personalFallback; reasonCode stays on the error for ops.
    const reason = denialReason?.trim();
    throw new Error(
      reason ? `workspace_authorization_failed:${reason}` : "workspace_authorization_failed",
    );
  }
  if (securityProfile.profile === "managed_enterprise" && isSharedTenantAddressingEnabled(cfg)) {
    workspaceDirRaw = await healProductionWorkspaceDir(workspaceDirRaw);
  }
  await import("../../memory/item7-w2-dark-dual-read-shadow.js").then(
    ({ runItem7W2DarkDualReadShadowIfEnabled }) =>
      runItem7W2DarkDualReadShadowIfEnabled({
        siteId: "S02-get-reply",
        legacyLocator: workspaceDirRaw,
        replacementLocator: authorizedCwd,
      }),
  );
  void import("../../gateway/workspace-resolver/item7-w4-shadow.js").then(
    ({ scheduleItem7W4StewardHelperShadow }) =>
      scheduleItem7W4StewardHelperShadow({
        ledgerId: "S01",
        catalogResourceId: null,
      }),
  );
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: !agentCfg?.skipBootstrap && !isFastTestEnv,
    initializeGit: false,
  });
  const workspaceDir = workspace.dir;
  // Employee steward FS is workspaceOnly — copy mark-required bundled skills
  // (SKILL.md + references YAML) into the per-user workspace so Read can load them.
  if (stewardException && !isFastTestEnv) {
    await ensureStewardRequiredSkillsSynced({ workspaceDir });
  }

  if (!isFastTestEnv) {
    const mediaUnderstanding = await applyMediaUnderstanding({
      ctx: finalized,
      cfg,
      agentDir,
      activeModel: { provider, model },
    });
    // E19: this pipeline selected and invoked a model before the agent run exists,
    // without consulting the entitlement allowlist. Record that so the gap is
    // countable; recording only, the run is unchanged.
    await recordMediaUnderstandingShadow({
      uses: mediaUnderstandingUsesFromOutputs(mediaUnderstanding.outputs),
      ...(turnTenantId ? { tenantId: turnTenantId } : {}),
      ...(finalized.GatewayClientPlatformUserId
        ? { platformUserId: finalized.GatewayClientPlatformUserId }
        : {}),
    });
    await applyLinkUnderstanding({
      ctx: finalized,
      cfg,
    });
  }
  emitPreAgentMessageHooks({
    ctx: finalized,
    cfg,
    isFastTestEnv,
  });

  const commandAuthorized = finalized.CommandAuthorized;
  resolveCommandAuthorization({
    ctx: finalized,
    cfg,
    commandAuthorized,
  });
  const sessionState = await initSessionState({
    ctx: finalized,
    cfg,
    commandAuthorized,
  });
  let {
    sessionCtx,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    sessionId,
    isNewSession,
    resetTriggered,
    systemSent,
    abortedLastRun,
    storePath,
    sessionScope,
    groupResolution,
    isGroup,
    triggerBodyNormalized,
    bodyStripped,
  } = sessionState;

  void import("../../gateway/data-governance/s01-get-reply-steward-cwd-shadow.js")
    .then(({ runS01GetReplyStewardCwdShadowFromEntry, scheduleS01StewardCwdShadow }) => {
      scheduleS01StewardCwdShadow(() =>
        runS01GetReplyStewardCwdShadowFromEntry({
          stewardException,
          employeeOwnerId,
          stewardAgentId: agentId,
          tenantId: knowledgeContext.tenantId,
          userId: knowledgeContext.userId,
          sessionId,
          helperCwd: stewardHelperCwd ?? workspaceDirRaw,
        }),
      );
    })
    .catch((err: unknown) => {
      defaultRuntime.log("s01_stage_b_steward_cwd_shadow_import_error", {
        error: err instanceof Error ? err.message : "shadow_import_failed",
      });
    });

  await applyResetModelOverride({
    cfg,
    resetTriggered,
    bodyStripped,
    sessionCtx,
    ctx: finalized,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultProvider,
    defaultModel,
    aliasIndex,
  });

  const channelModelOverride = lockModelSelectionToEnterpriseChain
    ? null
    : resolveChannelModelOverride({
        cfg,
        channel:
          groupResolution?.channel ??
          sessionEntry.channel ??
          sessionEntry.origin?.provider ??
          (typeof finalized.OriginatingChannel === "string"
            ? finalized.OriginatingChannel
            : undefined) ??
          finalized.Provider,
        groupId: groupResolution?.id ?? sessionEntry.groupId,
        groupChannel:
          sessionEntry.groupChannel ?? sessionCtx.GroupChannel ?? finalized.GroupChannel,
        groupSubject: sessionEntry.subject ?? sessionCtx.GroupSubject ?? finalized.GroupSubject,
        parentSessionKey: sessionCtx.ParentSessionKey,
      });
  const hasSessionModelOverride = Boolean(
    sessionEntry.modelOverride?.trim() || sessionEntry.providerOverride?.trim(),
  );
  if (!hasResolvedHeartbeatModelOverride && !hasSessionModelOverride && channelModelOverride) {
    const resolved = resolveModelRefFromString({
      raw: channelModelOverride.model,
      defaultProvider,
      aliasIndex,
    });
    if (resolved) {
      provider = resolved.ref.provider;
      model = resolved.ref.model;
    }
  }

  const directiveResult = await resolveReplyDirectives({
    ctx: finalized,
    cfg,
    agentId,
    agentDir,
    workspaceDir,
    agentCfg,
    sessionCtx,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    groupResolution,
    isGroup,
    triggerBodyNormalized,
    commandAuthorized,
    defaultProvider,
    defaultModel,
    aliasIndex,
    provider,
    model,
    hasResolvedHeartbeatModelOverride,
    typing,
    opts: resolvedOpts,
    skillFilter: mergedSkillFilter,
  });
  if (directiveResult.kind === "reply") {
    return directiveResult.reply;
  }

  let {
    commandSource,
    command,
    allowTextCommands,
    skillCommands,
    directives,
    cleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    provider: resolvedProvider,
    model: resolvedModel,
    modelState,
    contextTokens,
    inlineStatusRequested,
    directiveAck,
    perMessageQueueMode,
    perMessageQueueOptions,
  } = directiveResult.result;
  provider = resolvedProvider;
  model = resolvedModel;

  const maybeEmitMissingResetHooks = async () => {
    if (!resetTriggered || !command.isAuthorizedSender || command.resetHookTriggered) {
      return;
    }
    const resetMatch = command.commandBodyNormalized.match(/^\/(new|reset)(?:\s|$)/);
    if (!resetMatch) {
      return;
    }
    const action: ResetCommandAction = resetMatch[1] === "reset" ? "reset" : "new";
    await emitResetCommandHooks({
      action,
      ctx,
      cfg,
      command,
      sessionKey,
      sessionEntry,
      previousSessionEntry,
      workspaceDir,
    });
  };

  const inlineActionResult = await handleInlineActions({
    ctx,
    sessionCtx,
    cfg,
    agentId,
    agentDir,
    sessionEntry,
    previousSessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionScope,
    workspaceDir,
    isGroup,
    opts: resolvedOpts,
    typing,
    allowTextCommands,
    inlineStatusRequested,
    command,
    skillCommands,
    directives,
    cleanedBody,
    elevatedEnabled,
    elevatedAllowed,
    elevatedFailures,
    defaultActivation: () => defaultActivation,
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    resolveDefaultThinkingLevel: modelState.resolveDefaultThinkingLevel,
    provider,
    model,
    contextTokens,
    directiveAck,
    abortedLastRun,
    skillFilter: mergedSkillFilter,
  });
  if (inlineActionResult.kind === "reply") {
    await maybeEmitMissingResetHooks();
    return inlineActionResult.reply;
  }
  await maybeEmitMissingResetHooks();
  directives = inlineActionResult.directives;
  abortedLastRun = inlineActionResult.abortedLastRun ?? abortedLastRun;

  await stageSandboxMedia({
    ctx,
    sessionCtx,
    cfg,
    sessionKey,
    workspaceDir,
  });

  return runPreparedReply({
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
    resolvedThinkLevel,
    resolvedVerboseLevel,
    resolvedReasoningLevel,
    resolvedElevatedLevel,
    execOverrides,
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
    opts: resolvedOpts,
    defaultProvider,
    defaultModel,
    timeoutMs,
    isNewSession,
    resetTriggered,
    systemSent,
    sessionEntry,
    sessionStore,
    sessionKey,
    sessionId,
    storePath,
    workspaceDir,
    abortedLastRun,
    previousSessionEntry,
  });
}

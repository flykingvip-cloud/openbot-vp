import type { CommandDeliveryReceipt } from "../agent-runtime/contracts/delivery.js";
import { persistAcpTurnTranscript } from "../agent-runtime/state/index.js";
import { persistCommandSessionEntry as persistSessionEntry } from "../agent-runtime/state/index.js";
import { assertControlledExecutionStages, createCommandOutcomeCloseout, createCommandBudget, runCommandCandidate, createCommandExecutionLifecycle, runCommandAcpTurn, type EmbeddedPiRunResult } from "../agent-runtime/execution/index.js";
import { getAcpSessionManager } from "../acp/control-plane/manager.js";
import { resolveAcpSessionCwd } from "../acp/runtime/session-identifiers.js";
import { LEGACY_INTERNAL_EVENT_CONTEXT_PREFIXES } from "../compat/legacy-names.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("commands/agent");
import {
  listAgentIds,
  resolveAgentDir,
  resolveEffectiveModelFallbacks,
  resolveSessionAgentId,
  resolveAgentSkillsFilter,
  resolveAgentWorkspaceDir,
} from "../agents/agent-scope.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { clearSessionAuthProfileOverride } from "../agents/auth-profiles/session-override.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { formatAgentInternalEventsForPrompt } from "../agents/internal-events.js";
import { AGENT_LANE_SUBAGENT } from "../agents/lanes.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import {
  recordSubagentModelShadow,
} from "../gateway/governance/spawn-snapshot-handoff.js";
import {
  buildAllowedModelSet,
  isCliProvider,
  modelKey,
  normalizeModelRef,
  resolveConfiguredModelRef,
  resolveDefaultModelForAgent,
  resolveThinkingDefault,
} from "../agents/model-selection.js";
import { buildWorkspaceSkillSnapshot } from "../agents/skills.js";
import { getSkillsSnapshotVersion } from "../agents/skills/refresh.js";
import { normalizeSpawnedRunMetadata } from "../agents/spawned-context.js";
import { resolveAgentTimeoutMs } from "../agents/timeout.js";
import { ensureAgentWorkspace } from "../agents/workspace.js";
import { normalizeReplyPayload } from "../auto-reply/reply/normalize-reply.js";
import {
  formatThinkingLevels,
  formatXHighModelHint,
  normalizeThinkLevel,
  normalizeVerboseLevel,
  supportsXHighThinking,
  type VerboseLevel,
} from "../auto-reply/thinking.js";

import { formatCliCommand } from "../cli/command-format.js";
import { resolveCommandSecretRefsViaGateway } from "../cli/command-secret-gateway.js";
import { getAgentRuntimeCommandSecretTargetIds } from "../cli/command-secret-targets.js";
import { type CliDeps, createDefaultDeps } from "../cli/deps.js";
import {
  loadConfig,
  readConfigFileSnapshotForWrite,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import {
  resolveAgentIdFromSessionKey,
  type SessionEntry,
} from "../config/sessions.js";
import { resolveSessionTranscriptFile } from "../config/sessions/transcript.js";
import { buildKnowledgeReplyGatewayClient } from "../gateway/knowledge/reply-gateway-client.js";
import { resolveSessionModelRef } from "../gateway/session-utils.js";
import {
  resolveAgentDirForClient,
  resolveSessionStorePathForInboundMessage,
} from "../gateway/tenant-context.js";
import { resolveWorkspaceLocator } from "../gateway/workspace-resolver/strict-locator.js";
import {
  clearAgentRunContext,
  emitAgentEvent,
  registerAgentRunContext,
} from "../infra/agent-events.js";
import { buildOutboundSessionContext } from "../infra/outbound/session-context.js";
import { getRemoteSkillEligibility } from "../infra/skills-remote.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { applyVerboseOverride } from "../sessions/level-overrides.js";
import { applyModelOverrideToSessionEntry } from "../sessions/model-overrides.js";
import { resolveSendPolicy } from "../sessions/send-policy.js";
import { resolveMessageChannel } from "../utils/message-channel.js";
import {
  type AgentCommandCommercialGateResult,
} from "../agent-runtime/model/index.js";
import { recordAgentCommandCreditUsage } from "./agent/credit-usage.js";
import { deliverAgentCommandResult } from "../agent-runtime/delivery/index.js";
import {
  estimateTipBudgetCostUsdFromUsage,
  TaskBudgetExceededError,
  type RunnerTurnFailureReason,
} from "../task-outcome/runtime-from-runner.js";
import { openCommandOutcomeEntry } from "../agent-runtime/command/index.js";
import { resolveAgentRunContext } from "./agent/run-context.js";
import { updateSessionStoreAfterAgentRun } from "./agent/session-store.js";
import { resolveSession } from "./agent/session.js";
import { recordSubagentRunUsage } from "./agent/subagent-credit-usage.js";
import type { AgentCommandIngressOpts, AgentCommandOpts } from "./agent/types.js";

function prependInternalEventContext(
  body: string,
  events: AgentCommandOpts["internalEvents"],
): string {
  if (
    body.includes("OpenBot runtime context (internal):") ||
    LEGACY_INTERNAL_EVENT_CONTEXT_PREFIXES.some((prefix) => body.includes(prefix))
  ) {
    return body;
  }
  const renderedEvents = formatAgentInternalEventsForPrompt(events);
  if (!renderedEvents) {
    return body;
  }
  return [renderedEvents, body].filter(Boolean).join("\n\n");
}

async function prepareAgentCommandExecution(
  opts: AgentCommandOpts & { senderIsOwner: boolean },
  runtime: RuntimeEnv,
) {
  const message = opts.message ?? "";
  if (!message.trim()) {
    throw new Error("Message (--message) is required");
  }
  const body = prependInternalEventContext(message, opts.internalEvents);
  if (!opts.to && !opts.sessionId && !opts.sessionKey && !opts.agentId) {
    throw new Error("Pass --to <E.164>, --session-id, or --agent to choose a session");
  }

  const loadedRaw = loadConfig();
  const sourceConfig = await (async () => {
    try {
      const { snapshot } = await readConfigFileSnapshotForWrite();
      if (snapshot.valid) {
        return snapshot.resolved;
      }
    } catch {
      // Fall back to runtime-loaded config when source snapshot is unavailable.
    }
    return loadedRaw;
  })();
  const { resolvedConfig: cfg, diagnostics } = await resolveCommandSecretRefsViaGateway({
    config: loadedRaw,
    commandName: "agent",
    targetIds: getAgentRuntimeCommandSecretTargetIds(),
  });
  setRuntimeConfigSnapshot(cfg, sourceConfig);
  const normalizedSpawned = normalizeSpawnedRunMetadata({
    spawnedBy: opts.spawnedBy,
    groupId: opts.groupId,
    groupChannel: opts.groupChannel,
    groupSpace: opts.groupSpace,
    workspaceDir: opts.workspaceDir,
  });
  for (const entry of diagnostics) {
    runtime.log(`[secrets] ${entry}`);
  }
  const agentIdOverrideRaw = opts.agentId?.trim();
  const agentIdOverride = agentIdOverrideRaw ? normalizeAgentId(agentIdOverrideRaw) : undefined;
  if (agentIdOverride) {
    const knownAgents = listAgentIds(cfg);
    if (!knownAgents.includes(agentIdOverride)) {
      throw new Error(
        `Unknown agent id "${agentIdOverrideRaw}". Use "${formatCliCommand("openbot agents list")}" to see configured agents.`,
      );
    }
  }
  if (agentIdOverride && opts.sessionKey) {
    const sessionAgentId = resolveAgentIdFromSessionKey(opts.sessionKey);
    if (sessionAgentId !== agentIdOverride) {
      throw new Error(
        `Agent id "${agentIdOverrideRaw}" does not match session key agent "${sessionAgentId}".`,
      );
    }
  }
  const agentCfg = cfg.agents?.defaults;
  const configuredModel = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const thinkingLevelsHint = formatThinkingLevels(configuredModel.provider, configuredModel.model);

  const thinkOverride = normalizeThinkLevel(opts.thinking);
  const thinkOnce = normalizeThinkLevel(opts.thinkingOnce);
  if (opts.thinking && !thinkOverride) {
    throw new Error(`Invalid thinking level. Use one of: ${thinkingLevelsHint}.`);
  }
  if (opts.thinkingOnce && !thinkOnce) {
    throw new Error(`Invalid one-shot thinking level. Use one of: ${thinkingLevelsHint}.`);
  }

  const verboseOverride = normalizeVerboseLevel(opts.verbose);
  if (opts.verbose && !verboseOverride) {
    throw new Error('Invalid verbose level. Use "on", "full", or "off".');
  }

  const laneRaw = typeof opts.lane === "string" ? opts.lane.trim() : "";
  const isSubagentLane = laneRaw === String(AGENT_LANE_SUBAGENT);
  const timeoutSecondsRaw =
    opts.timeout !== undefined
      ? Number.parseInt(String(opts.timeout), 10)
      : isSubagentLane
        ? 0
        : undefined;
  if (
    timeoutSecondsRaw !== undefined &&
    (Number.isNaN(timeoutSecondsRaw) || timeoutSecondsRaw < 0)
  ) {
    throw new Error("--timeout must be a non-negative integer (seconds; 0 means no timeout)");
  }
  const timeoutMs = resolveAgentTimeoutMs({
    cfg,
    overrideSeconds: timeoutSecondsRaw,
  });

  const storeAgentIdHint =
    agentIdOverride ??
    (opts.sessionKey?.trim() ? resolveAgentIdFromSessionKey(opts.sessionKey) : undefined) ??
    resolveSessionAgentId({ sessionKey: opts.sessionKey?.trim(), config: cfg });
  const tenantStorePath =
    opts.gatewayClientUser?.trim() || opts.gatewayClientPlatformUserId?.trim()
      ? await resolveSessionStorePathForInboundMessage({
          cfg,
          agentId: storeAgentIdHint,
          gatewayClientUser: opts.gatewayClientUser,
          gatewayClientPlatformUserId: opts.gatewayClientPlatformUserId,
          gatewayClientSessionDomain: opts.gatewayClientSessionDomain,
        })
      : undefined;
  const sessionResolution = resolveSession({
    cfg,
    to: opts.to,
    sessionId: opts.sessionId,
    sessionKey: opts.sessionKey,
    agentId: agentIdOverride,
    storePath: tenantStorePath,
  });

  const {
    sessionId,
    sessionKey,
    sessionEntry: sessionEntryRaw,
    sessionStore,
    storePath,
    isNewSession,
    persistedThinking,
    persistedVerbose,
  } = sessionResolution;
  const sessionAgentId =
    agentIdOverride ??
    resolveSessionAgentId({
      sessionKey: sessionKey ?? opts.sessionKey?.trim(),
      config: cfg,
    });
  const outboundSession = buildOutboundSessionContext({
    cfg,
    agentId: sessionAgentId,
    sessionKey,
  });
  const gatewayClient = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: opts.gatewayClientUser,
    gatewayClientSessionDomain: opts.gatewayClientSessionDomain,
  });
  // Internal callers may pin workspace inheritance. Managed BYOK prefers tenant-scoped workspace/agentDir.
  let workspaceDirRaw = normalizedSpawned.workspaceDir;
  let agentDir = resolveAgentDir(cfg, sessionAgentId);
  if (!workspaceDirRaw && gatewayClient) {
    try {
      workspaceDirRaw = ((r) => (r.ok ? r.handle.locator : ""))(resolveWorkspaceLocator({ cfg }));
      agentDir = await resolveAgentDirForClient(gatewayClient, sessionAgentId, cfg);
    } catch {
      workspaceDirRaw = resolveAgentWorkspaceDir(cfg, sessionAgentId);
      agentDir = resolveAgentDir(cfg, sessionAgentId);
    }
  }
  if (!workspaceDirRaw) {
    workspaceDirRaw = resolveAgentWorkspaceDir(cfg, sessionAgentId);
  }
  await import("../memory/item7-w2-dark-dual-read-shadow.js").then(
    ({ runItem7W2DarkDualReadShadowIfEnabled }) =>
      runItem7W2DarkDualReadShadowIfEnabled({
        siteId: "S03-agent",
        legacyLocator: workspaceDirRaw,
        replacementLocator: null,
      }),
  );
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: !agentCfg?.skipBootstrap,
  });
  const workspaceDir = workspace.dir;
  const runId = opts.runId?.trim() || sessionId;
  const acpManager = getAcpSessionManager();
  const acpResolution = sessionKey
    ? acpManager.resolveSession({
        cfg,
        sessionKey,
      })
    : null;

  return {
    body,
    cfg,
    normalizedSpawned,
    agentCfg,
    thinkOverride,
    thinkOnce,
    verboseOverride,
    timeoutMs,
    sessionId,
    sessionKey,
    sessionEntry: sessionEntryRaw,
    sessionStore,
    storePath,
    isNewSession,
    persistedThinking,
    persistedVerbose,
    sessionAgentId,
    outboundSession,
    workspaceDir,
    agentDir,
    runId,
    acpManager,
    acpResolution,
  };
}

async function agentCommandInternal(
  opts: AgentCommandOpts & { senderIsOwner: boolean },
  runtime: RuntimeEnv = defaultRuntime,
  deps: CliDeps = createDefaultDeps(),
) {
  const prepared = await prepareAgentCommandExecution(opts, runtime);
  const {
    body,
    cfg,
    normalizedSpawned,
    agentCfg,
    thinkOverride,
    thinkOnce,
    verboseOverride,
    timeoutMs,
    sessionId,
    sessionKey,
    sessionStore,
    storePath,
    isNewSession,
    persistedThinking,
    persistedVerbose,
    sessionAgentId,
    outboundSession,
    workspaceDir,
    agentDir,
    runId,
    acpManager,
    acpResolution,
  } = prepared;
  let sessionEntry = prepared.sessionEntry;
  const laneRaw = typeof opts.lane === "string" ? opts.lane.trim() : "";
  const isSubagentLane = laneRaw === String(AGENT_LANE_SUBAGENT);
  // Command scene adapter: commercial admission + E2/E3/E6 ports stay on the
  // authority adapter; stage order comes only from the controlled use-case.
  const controlledExecution = createCommandExecutionLifecycle({runId, isSubagentLane, identity: opts.executionIdentity, entry: opts.governanceEntry});
  assertControlledExecutionStages(controlledExecution, "Command host");
  // Subagent runs take their own commercial slot (quota + concurrency).
  // Model allowlists for the child still come from the parent snapshot.
  let commercialGate: AgentCommandCommercialGateResult | undefined;

  // askOutcome: CLI / gateway_agent / subagent share one tip closeout.
  // Subagent persists entrypoint "subagent" (not cli/gateway) and links parentTaskId when known.
  /** Real usage-derived USD for tip budget closeout when mid-run charge did not run. */
  let tipBudgetCostUsd: number | undefined;
  let tipBudgetChargedThisTurn = false;
  let commandDeliveryReceipt: CommandDeliveryReceipt | undefined;
  let agentOutcomeSuccess: boolean | undefined;
  let agentOutcomeFailureReason: RunnerTurnFailureReason | undefined;
  let agentOutcomeFailureDetail: string | undefined;
  const agentOutcomeStartedAt = Date.now();
  const { entrypoint: agentOutcomeEntrypoint, taskId: agentOutcomeTaskId, scope: agentOutcomeScope } = openCommandOutcomeEntry({
    config: cfg, agentId: sessionAgentId, runId, isSubagentLane, governanceEntry: opts.governanceEntry,
    platformUserId: opts.gatewayClientPlatformUserId, gatewayUser: opts.gatewayClientUser,
    sessionTenantId: opts.gatewayClientSessionTenantId, executionEnterpriseId: opts.executionIdentity?.enterpriseId, parentTaskId: opts.parentTaskId,
  });

  const commandBudget = createCommandBudget({ config: cfg, agentId: sessionAgentId, runId, startedAtMs: agentOutcomeStartedAt, taskId: agentOutcomeTaskId, scope: agentOutcomeScope, parentTaskId: opts.parentTaskId, parentAgentId: opts.parentAgentId });
  const submitAgentOutcomeCloseout = createCommandOutcomeCloseout({
    config: cfg, agentId: sessionAgentId, runId, startedAtMs: agentOutcomeStartedAt, entrypoint: agentOutcomeEntrypoint,
    readContext: () => ({taskId: agentOutcomeTaskId, scope: agentOutcomeScope, success: agentOutcomeSuccess, failureReason: agentOutcomeFailureReason, failureDetail: agentOutcomeFailureDetail, budgetCharged: tipBudgetChargedThisTurn, costUsd: tipBudgetCostUsd, deliveryReceipt: commandDeliveryReceipt}),
  });

  try {
    if (opts.deliver === true) {
      const sendPolicy = resolveSendPolicy({
        cfg,
        entry: sessionEntry,
        sessionKey,
        channel: sessionEntry?.channel,
        chatType: sessionEntry?.chatType,
      });
      if (sendPolicy === "deny") {
        agentOutcomeSuccess = false;
        agentOutcomeFailureReason = "authz_denied";
        agentOutcomeFailureDetail = "send blocked by session policy";
        throw new Error("send blocked by session policy");
      }
    }

    const executionPreparation = await controlledExecution.prepare({ signal: opts.abortSignal, authorization: {
      runId,
      sessionAgentId,
      gatewayClientUser: opts.gatewayClientUser,
      enterpriseId: opts.gatewayClientSessionTenantId,
      taskText: opts.message ?? body,
      ...(isSubagentLane ? { entry: "E6" as const } : opts.governanceEntry ? { entry: opts.governanceEntry } : {}),
    } });
    if (executionPreparation.kind === "denied") {
      commercialGate = executionPreparation.authorization;
      agentOutcomeSuccess = false;
      agentOutcomeFailureReason = "authz_denied";
      agentOutcomeFailureDetail = executionPreparation.message;
      // Denied preparation must not reach ACP/candidate backends.
      throw new Error(executionPreparation.message);
    }
    commercialGate = executionPreparation.authorization;
    if (acpResolution?.kind === "stale") {
      throw acpResolution.error;
    }

    if (acpResolution?.kind === "ready" && sessionKey) {
      const { startedAt, stopReason, finalTextRaw, finalText } = await runCommandAcpTurn({
        cfg, sessionKey, runId, body, agent: acpResolution.meta.agent,
        abortSignal: opts.abortSignal, manager: acpManager,
      });
      try {
        sessionEntry = await persistAcpTurnTranscript({
          body,
          finalText: finalTextRaw,
          sessionId,
          sessionKey,
          sessionEntry,
          sessionStore,
          storePath,
          sessionAgentId,
          threadId: opts.threadId,
          sessionCwd: resolveAcpSessionCwd(acpResolution.meta) ?? workspaceDir,
        });
      } catch (error) {
        log.warn(
          `ACP transcript persistence failed for ${sessionKey}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const normalizedFinalPayload = normalizeReplyPayload({
        text: finalText,
      });
      const payloads = normalizedFinalPayload ? [normalizedFinalPayload] : [];
      const result = {
        payloads,
        meta: {
          durationMs: Date.now() - startedAt,
          aborted: opts.abortSignal?.aborted === true,
          stopReason,
        },
      };

      agentOutcomeSuccess = true;
    return await deliverAgentCommandResult({
        receipt: { deliveryId: `delivery:${runId}:command`, record: (receipt) => { commandDeliveryReceipt = receipt; } },
        cfg,
        deps,
        runtime,
        opts,
        outboundSession,
        sessionEntry,
        result,
        payloads,
      });
    }

    let resolvedThinkLevel = thinkOnce ?? thinkOverride ?? persistedThinking;
    const resolvedVerboseLevel =
      verboseOverride ?? persistedVerbose ?? (agentCfg?.verboseDefault as VerboseLevel | undefined);

    if (sessionKey) {
      registerAgentRunContext(runId, {
        sessionKey,
        verboseLevel: resolvedVerboseLevel,
      });
    }

    const needsSkillsSnapshot = isNewSession || !sessionEntry?.skillsSnapshot;
    const skillsSnapshotVersion = getSkillsSnapshotVersion(workspaceDir);
    const skillFilter = resolveAgentSkillsFilter(cfg, sessionAgentId);
    const skillsSnapshot = needsSkillsSnapshot
      ? buildWorkspaceSkillSnapshot(workspaceDir, {
          config: cfg,
          eligibility: { remote: getRemoteSkillEligibility() },
          snapshotVersion: skillsSnapshotVersion,
          skillFilter,
        })
      : sessionEntry?.skillsSnapshot;

    if (skillsSnapshot && sessionStore && sessionKey && needsSkillsSnapshot) {
      const current = sessionEntry ?? {
        sessionId,
        updatedAt: Date.now(),
      };
      const next: SessionEntry = {
        ...current,
        sessionId,
        updatedAt: Date.now(),
        skillsSnapshot,
      };
      await persistSessionEntry({
        sessionStore,
        sessionKey,
        storePath,
        entry: next,
      });
      sessionEntry = next;
    }

    // Persist explicit /command overrides to the session store when we have a key.
    if (sessionStore && sessionKey) {
      const entry = sessionStore[sessionKey] ??
        sessionEntry ?? { sessionId, updatedAt: Date.now() };
      const next: SessionEntry = { ...entry, sessionId, updatedAt: Date.now() };
      if (thinkOverride) {
        next.thinkingLevel = thinkOverride;
      }
      applyVerboseOverride(next, verboseOverride);
      await persistSessionEntry({
        sessionStore,
        sessionKey,
        storePath,
        entry: next,
      });
      sessionEntry = next;
    }

    const configuredDefaultRef = resolveDefaultModelForAgent({
      cfg,
      agentId: sessionAgentId,
    });
    const { provider: defaultProvider, model: defaultModel } = normalizeModelRef(
      configuredDefaultRef.provider,
      configuredDefaultRef.model,
    );
    // sessions.patch writes model/modelProvider (runtime identity). Chat already
    // honors that via resolveSessionModelRef; agent RPC must too — otherwise
    // pinned ent/* BYOK sessions silently run the agent default model.
    const sessionRuntimeRef = resolveSessionModelRef(cfg, sessionEntry, sessionAgentId);
    let provider = sessionRuntimeRef.provider;
    let model = sessionRuntimeRef.model;
    const hasAllowlist = agentCfg?.models && Object.keys(agentCfg.models).length > 0;
    const hasStoredOverride = Boolean(
      sessionEntry?.modelOverride || sessionEntry?.providerOverride,
    );
    const needsModelCatalog = hasAllowlist || hasStoredOverride;
    let allowedModelKeys = new Set<string>();
    let allowedModelCatalog: Awaited<ReturnType<typeof loadModelCatalog>> = [];
    let modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>> | null = null;
    let allowAnyModel = false;

    if (needsModelCatalog) {
      modelCatalog = await loadModelCatalog({ config: cfg });
      const allowed = buildAllowedModelSet({
        cfg,
        catalog: modelCatalog,
        defaultProvider,
        defaultModel,
      });
      allowedModelKeys = allowed.allowedKeys;
      allowedModelCatalog = allowed.allowedCatalog;
      allowAnyModel = allowed.allowAny ?? false;
    }

    if (sessionEntry && sessionStore && sessionKey && hasStoredOverride) {
      const entry = sessionEntry;
      const overrideProvider = sessionEntry.providerOverride?.trim() || defaultProvider;
      const overrideModel = sessionEntry.modelOverride?.trim();
      if (overrideModel) {
        const normalizedOverride = normalizeModelRef(overrideProvider, overrideModel);
        const key = modelKey(normalizedOverride.provider, normalizedOverride.model);
        if (
          !isCliProvider(normalizedOverride.provider, cfg) &&
          !allowAnyModel &&
          !allowedModelKeys.has(key)
        ) {
          const { updated } = applyModelOverrideToSessionEntry({
            entry,
            selection: { provider: defaultProvider, model: defaultModel, isDefault: true },
          });
          if (updated) {
            await persistSessionEntry({
              sessionStore,
              sessionKey,
              storePath,
              entry,
            });
          }
        }
      }
    }

    const storedProviderOverride = sessionEntry?.providerOverride?.trim();
    const storedModelOverride = sessionEntry?.modelOverride?.trim();
    if (storedModelOverride) {
      const candidateProvider = storedProviderOverride || defaultProvider;
      const normalizedStored = normalizeModelRef(candidateProvider, storedModelOverride);
      const key = modelKey(normalizedStored.provider, normalizedStored.model);
      if (
        isCliProvider(normalizedStored.provider, cfg) ||
        allowAnyModel ||
        allowedModelKeys.has(key)
      ) {
        provider = normalizedStored.provider;
        model = normalizedStored.model;
      }
    }
    if (sessionEntry) {
      const authProfileId = sessionEntry.authProfileOverride;
      if (authProfileId) {
        const entry = sessionEntry;
        const store = ensureAuthProfileStore();
        const profile = store.profiles[authProfileId];
        if (!profile || profile.provider !== provider) {
          if (sessionStore && sessionKey) {
            await clearSessionAuthProfileOverride({
              sessionEntry: entry,
              sessionStore,
              sessionKey,
              storePath,
            });
          }
        }
      }
    }

    if (!resolvedThinkLevel) {
      let catalogForThinking = modelCatalog ?? allowedModelCatalog;
      if (!catalogForThinking || catalogForThinking.length === 0) {
        modelCatalog = await loadModelCatalog({ config: cfg });
        catalogForThinking = modelCatalog;
      }
      resolvedThinkLevel = resolveThinkingDefault({
        cfg,
        provider,
        model,
        catalog: catalogForThinking,
      });
    }
    if (resolvedThinkLevel === "xhigh" && !supportsXHighThinking(provider, model)) {
      const explicitThink = Boolean(thinkOnce || thinkOverride);
      if (explicitThink) {
        throw new Error(`Thinking level "xhigh" is only supported for ${formatXHighModelHint()}.`);
      }
      resolvedThinkLevel = "high";
      if (sessionEntry && sessionStore && sessionKey && sessionEntry.thinkingLevel === "xhigh") {
        const entry = sessionEntry;
        entry.thinkingLevel = "high";
        entry.updatedAt = Date.now();
        await persistSessionEntry({
          sessionStore,
          sessionKey,
          storePath,
          entry,
        });
      }
    }
    const transcriptSessionKey = sessionKey ?? sessionId;
    let sessionFile: string | undefined;
    if (sessionStore) {
      const resolvedSessionFile = await resolveSessionTranscriptFile({
        sessionId,
        sessionKey: transcriptSessionKey,
        sessionStore,
        storePath,
        sessionEntry,
        agentId: sessionAgentId,
        threadId: opts.threadId,
      });
      sessionFile = resolvedSessionFile.sessionFile;
      sessionEntry = resolvedSessionFile.sessionEntry;
    }
    if (!sessionFile) {
      const resolvedSessionFile = await resolveSessionTranscriptFile({
        sessionId,
        sessionKey: transcriptSessionKey,
        sessionEntry,
        sessionStore,
        storePath,
        agentId: sessionAgentId,
        threadId: opts.threadId,
      });
      sessionFile = resolvedSessionFile.sessionFile;
      sessionEntry = resolvedSessionFile.sessionEntry;
    }

    const startedAt = Date.now();
    let lifecycleEnded = false;

    let result: EmbeddedPiRunResult;
    let fallbackProvider = provider;
    let fallbackModel = model;
    try {
      const runContext = resolveAgentRunContext(opts);
      const messageChannel = resolveMessageChannel(
        runContext.messageChannel,
        opts.replyChannel ?? opts.channel,
      );
      const spawnedBy = normalizedSpawned.spawnedBy ?? sessionEntry?.spawnedBy;
      // Keep fallback candidate resolution centralized so session model overrides,
      // per-agent overrides, and default fallbacks stay consistent across callers.
      const effectiveFallbacksOverride =
        opts.modelFallbacks !== undefined
          ? opts.modelFallbacks
          : resolveEffectiveModelFallbacks({
              cfg,
              agentId: sessionAgentId,
              hasSessionModelOverride: Boolean(storedModelOverride),
            });

      // Track model fallback attempts so retries on an existing session don't
      // re-inject the original prompt as a duplicate user message.
      recordSubagentModelShadow({
        isSubagentLane,
        snapshot: opts.spawnGovernanceSnapshot,
        provider,
        model,
        runId,
      });
      const fallbackResult = await controlledExecution.infer({
        cfg,
        provider,
        model,
        agentDir,
        fallbacksOverride: effectiveFallbacksOverride,
        taskText: opts.message ?? "",
        signal: opts.abortSignal,
        run: (providerOverride, modelOverride, runOptions, isFallbackRetry) => commandBudget.runCandidate({
          provider: providerOverride,
          model: modelOverride,
          run: () => runCommandCandidate({
            providerOverride,
            modelOverride,
            cfg,
            sessionEntry,
            sessionId,
            sessionKey,
            sessionAgentId,
            sessionFile,
            workspaceDir,
            body,
            isFallbackRetry,
            resolvedThinkLevel,
            timeoutMs,
            runId,
            opts,
            runContext,
            spawnedBy,
            messageChannel,
            skillsSnapshot,
            resolvedVerboseLevel,
            agentDir,
            primaryProvider: provider,
            sessionStore,
            storePath,
            allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
            onAgentEvent: (evt) => {
              // Track lifecycle end for fallback emission below.
              if (
                evt.stream === "lifecycle" &&
                typeof evt.data?.phase === "string" &&
                (evt.data.phase === "end" || evt.data.phase === "error")
              ) {
                lifecycleEnded = true;
              }
            },
          }),
        }),
      });
      tipBudgetChargedThisTurn = commandBudget.charged;
      tipBudgetCostUsd = commandBudget.costUsd;
      result = fallbackResult.result;
      fallbackProvider = fallbackResult.provider;
      fallbackModel = fallbackResult.model;
      if (!tipBudgetChargedThisTurn) {
        tipBudgetCostUsd = estimateTipBudgetCostUsdFromUsage({
          usage: result.meta?.agentMeta?.usage,
          provider: fallbackProvider,
          model: result.meta?.agentMeta?.model ?? fallbackModel,
          config: cfg,
        });
      }
      // Enterprise credit usage. Subagent runs record against the slot they acquired.
      await recordAgentCommandCreditUsage({
        gate: commercialGate,
        cfg,
        runId,
        sessionId,
        startedAt,
        provider: fallbackProvider,
        model: fallbackModel,
        agentId: sessionAgentId,
        creditUserId: opts.gatewayClientUser,
        result,
        fallbackAttempts: fallbackResult.attempts,
        onError: (message) => console.error(`[agent] run ${runId} ${message}`),
      });
      // P4-0 / P4-1 subagent usage shadow. The child already acquired its own
      // commercial slot above. This path stays shadow unless OPENBOT_SUBAGENT_CREDIT_USAGE
      // bills the parent authorization as well.
      if (!(isSubagentLane && commercialGate?.status === "acquired")) {
        await recordSubagentRunUsage({
          isSubagentLane,
          cfg,
          runId,
          provider: fallbackProvider,
          model: fallbackModel,
          agentId: sessionAgentId,
          creditUserId: opts.gatewayClientUser,
          snapshot: opts.spawnGovernanceSnapshot,
          result,
          fallbackAttempts: fallbackResult.attempts,
          onError: (message) => console.error(`[agent] run ${runId} ${message}`),
        });
      }
      if (!lifecycleEnded) {
        const stopReason = result.meta.stopReason;
        if (stopReason && stopReason !== "end_turn") {
          console.error(`[agent] run ${runId} ended with stopReason=${stopReason}`);
        }
        emitAgentEvent({
          runId,
          stream: "lifecycle",
          data: {
            phase: "end",
            startedAt,
            endedAt: Date.now(),
            aborted: result.meta.aborted ?? false,
            stopReason,
          },
        });
      }
    } catch (err) {
      if (!lifecycleEnded) {
        emitAgentEvent({
          runId,
          stream: "lifecycle",
          data: {
            phase: "error",
            startedAt,
            endedAt: Date.now(),
            error: String(err),
          },
        });
      }
      throw err;
    }

    // Update token+model fields in the session store.
    if (sessionStore && sessionKey) {
      await updateSessionStoreAfterAgentRun({
        cfg,
        contextTokensOverride: agentCfg?.contextTokens,
        sessionId,
        sessionKey,
        storePath,
        sessionStore,
        defaultProvider: provider,
        defaultModel: model,
        fallbackProvider,
        fallbackModel,
        result,
      });
    }

    const payloads = result.payloads ?? [];
    agentOutcomeSuccess = true;
    return await deliverAgentCommandResult({
        receipt: { deliveryId: `delivery:${runId}:command`, record: (receipt) => { commandDeliveryReceipt = receipt; } },
      cfg,
      deps,
      runtime,
      opts,
      outboundSession,
      sessionEntry,
      result,
      payloads,
    });
  } catch (err) {
    tipBudgetChargedThisTurn ||= commandBudget.charged;
    tipBudgetCostUsd ??= commandBudget.costUsd;
    if (agentOutcomeSuccess === undefined) {
      agentOutcomeSuccess = false;
      const msg = String(err);
      if (err instanceof TaskBudgetExceededError) {
        agentOutcomeFailureReason = "budget_exceeded";
        tipBudgetChargedThisTurn = true;
      } else if (opts.abortSignal?.aborted) {
        agentOutcomeFailureReason = "user_cancelled";
      } else if (agentOutcomeFailureReason === undefined) {
        agentOutcomeFailureReason = /denied|blocked|authz|policy/i.test(msg)
          ? "authz_denied"
          : "run_failed";
      }
      if (!agentOutcomeFailureDetail) {
        agentOutcomeFailureDetail = msg;
      }
    }
    throw err;
  } finally {
    try {
      await controlledExecution.dispose();
    } finally {
      clearAgentRunContext(runId);
      await submitAgentOutcomeCloseout();
    }
  }
}

export async function agentCommand(
  opts: AgentCommandOpts,
  runtime: RuntimeEnv = defaultRuntime,
  deps: CliDeps = createDefaultDeps(),
) {
  return await agentCommandInternal(
    {
      ...opts,
      // agentCommand is the trusted-operator entrypoint used by CLI/local flows.
      // Ingress callers must opt into owner semantics explicitly via
      // agentCommandFromIngress so network-facing paths cannot inherit this default by accident.
      senderIsOwner: opts.senderIsOwner ?? true,
    },
    runtime,
    deps,
  );
}

export async function agentCommandFromIngress(
  opts: AgentCommandIngressOpts,
  runtime: RuntimeEnv = defaultRuntime,
  deps: CliDeps = createDefaultDeps(),
) {
  if (typeof opts.senderIsOwner !== "boolean") {
    // HTTP/WS ingress must declare the trust level explicitly at the boundary.
    // This keeps network-facing callers from silently picking up the local trusted default.
    throw new Error("senderIsOwner must be explicitly set for ingress agent runs.");
  }
  return await agentCommandInternal(
    {
      ...opts,
      senderIsOwner: opts.senderIsOwner,
      // Gateway ingress is E2: agent RPC (including the inter-agent bus NESTED lane),
      // OpenAI / OpenResponses HTTP, node events, channel voice. Never taken from the
      // caller. The subagent lane writes no E2 envelope (its row is E6).
      governanceEntry: "E2",
    },
    runtime,
    deps,
  );
}

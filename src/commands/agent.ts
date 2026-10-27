import fs from "node:fs/promises";
import { observeAcpCliSteerPreflight } from "../acp/cli-steer-preflight-observe.js";
import { getAcpSessionManager } from "../acp/control-plane/manager.js";
import { resolveAcpAgentPolicyError, resolveAcpDispatchPolicyError } from "../acp/policy.js";
import { toAcpRuntimeError } from "../acp/runtime/errors.js";
import { resolveAcpSessionCwd } from "../acp/runtime/session-identifiers.js";
import { openSessionManager } from "../agents/pi-sdk/session.js";
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
import { resolveBootstrapWarningSignaturesSeen } from "../agents/bootstrap-budget.js";
import { resolveCredentialForRun } from "../agents/cli-backend-credential-resolve.js";
import { recordCliBackendUsage } from "../agents/cli-backend-usage-attribution.js";
import { runCliAgent } from "../agents/cli-runner.js";
import { getCliSessionId, setCliSessionId } from "../agents/cli-session.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { FailoverError } from "../agents/failover-error.js";
import { formatAgentInternalEventsForPrompt } from "../agents/internal-events.js";
import { AGENT_LANE_SUBAGENT } from "../agents/lanes.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { runWithModelFallback } from "../agents/model-fallback.js";
import {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  recordSubagentModelShadow,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../gateway/governance/spawn-snapshot-handoff.js";
import {
  buildAllowedModelSet,
  isCliProvider,
  modelKey,
  normalizeModelRef,
  normalizeProviderId,
  resolveConfiguredModelRef,
  resolveDefaultModelForAgent,
  resolveThinkingDefault,
} from "../agents/model-selection.js";
import { prepareSessionManagerForRun } from "../agents/pi-embedded-runner/session-manager-init.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
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
  type ThinkLevel,
  type VerboseLevel,
} from "../auto-reply/thinking.js";
import {
  isSilentReplyPrefixText,
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
} from "../auto-reply/tokens.js";
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
  mergeSessionEntry,
  resolveAgentIdFromSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../config/sessions.js";
import { resolveSessionTranscriptFile } from "../config/sessions/transcript.js";
import { isEnterpriseRuntimeModelId } from "../gateway/enterprise-model/ids.js";
import { resolveEnterpriseRuntimeInvocation } from "../gateway/enterprise-model/runtime-invocation.js";
import { inheritExecutionIdentityRunFields } from "../gateway/execution-identity-context.js";
import { buildKnowledgeReplyGatewayClient } from "../gateway/knowledge/reply-gateway-client.js";
import { resolveAgentRunEntitlementScope } from "../gateway/model-entitlement/resolve-agent-run-scope.js";
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
import { emitSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import { resolveMessageChannel } from "../utils/message-channel.js";
import {
  acquireAgentCommandCommercialRun,
  type AgentCommandCommercialGateResult,
  releaseAgentCommandCommercialRun,
} from "./agent/commercial-run-gate.js";
import { resolveExecutionRoutingFromCapabilityPlan } from "../gateway/model-entitlement/task-capability-plan.js";
import { recordAgentCommandCreditUsage } from "./agent/credit-usage.js";
import { deliverAgentCommandResult } from "./agent/delivery.js";
import {
  ensureCliTurnTaskOutcome,
  ensureGatewayAgentTurnTaskOutcome,
} from "../task-outcome/entrypoint-ensure.js";
import {
  estimateTipBudgetCostUsdFromUsage,
  recordRunnerTurnOutcome,
  type RunnerTurnFailureReason,
} from "../task-outcome/runtime-from-runner.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { resolveAgentCommandModelGovernance } from "./agent/model-governance.js";
import { resolveAgentRunContext } from "./agent/run-context.js";
import { updateSessionStoreAfterAgentRun } from "./agent/session-store.js";
import { resolveSession } from "./agent/session.js";
import { recordSubagentRunUsage } from "./agent/subagent-credit-usage.js";
import type { AgentCommandIngressOpts, AgentCommandOpts } from "./agent/types.js";

type PersistSessionEntryParams = {
  sessionStore: Record<string, SessionEntry>;
  sessionKey: string;
  storePath: string;
  entry: SessionEntry;
};

type OverrideFieldClearedByDelete =
  | "providerOverride"
  | "modelOverride"
  | "authProfileOverride"
  | "authProfileOverrideSource"
  | "authProfileOverrideCompactionCount"
  | "fallbackNoticeSelectedModel"
  | "fallbackNoticeActiveModel"
  | "fallbackNoticeReason"
  | "claudeCliSessionId";

const OVERRIDE_FIELDS_CLEARED_BY_DELETE: OverrideFieldClearedByDelete[] = [
  "providerOverride",
  "modelOverride",
  "authProfileOverride",
  "authProfileOverrideSource",
  "authProfileOverrideCompactionCount",
  "fallbackNoticeSelectedModel",
  "fallbackNoticeActiveModel",
  "fallbackNoticeReason",
  "claudeCliSessionId",
];

async function persistSessionEntry(params: PersistSessionEntryParams): Promise<void> {
  const persisted = await updateSessionStore(params.storePath, (store) => {
    const merged = mergeSessionEntry(store[params.sessionKey], params.entry);
    // Preserve explicit `delete` clears done by session override helpers.
    for (const field of OVERRIDE_FIELDS_CLEARED_BY_DELETE) {
      if (!Object.hasOwn(params.entry, field)) {
        Reflect.deleteProperty(merged, field);
      }
    }
    store[params.sessionKey] = merged;
    return merged;
  });
  params.sessionStore[params.sessionKey] = persisted;
}

function resolveFallbackRetryPrompt(params: { body: string; isFallbackRetry: boolean }): string {
  if (!params.isFallbackRetry) {
    return params.body;
  }
  return "Continue where you left off. The previous model attempt failed or timed out.";
}

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

function createAcpVisibleTextAccumulator() {
  let pendingSilentPrefix = "";
  let visibleText = "";
  const startsWithWordChar = (chunk: string): boolean => /^[\p{L}\p{N}]/u.test(chunk);

  const resolveNextCandidate = (base: string, chunk: string): string => {
    if (!base) {
      return chunk;
    }
    if (
      isSilentReplyText(base, SILENT_REPLY_TOKEN) &&
      !chunk.startsWith(base) &&
      startsWithWordChar(chunk)
    ) {
      return chunk;
    }
    // Some ACP backends emit cumulative snapshots even on text_delta-style hooks.
    // Accept those only when they strictly extend the buffered text.
    if (chunk.startsWith(base) && chunk.length > base.length) {
      return chunk;
    }
    return `${base}${chunk}`;
  };

  const mergeVisibleChunk = (base: string, chunk: string): { text: string; delta: string } => {
    if (!base) {
      return { text: chunk, delta: chunk };
    }
    if (chunk.startsWith(base) && chunk.length > base.length) {
      const delta = chunk.slice(base.length);
      return { text: chunk, delta };
    }
    return {
      text: `${base}${chunk}`,
      delta: chunk,
    };
  };

  return {
    consume(chunk: string): { text: string; delta: string } | null {
      if (!chunk) {
        return null;
      }

      if (!visibleText) {
        const leadCandidate = resolveNextCandidate(pendingSilentPrefix, chunk);
        const trimmedLeadCandidate = leadCandidate.trim();
        if (
          isSilentReplyText(trimmedLeadCandidate, SILENT_REPLY_TOKEN) ||
          isSilentReplyPrefixText(trimmedLeadCandidate, SILENT_REPLY_TOKEN)
        ) {
          pendingSilentPrefix = leadCandidate;
          return null;
        }
        if (pendingSilentPrefix) {
          pendingSilentPrefix = "";
          visibleText = leadCandidate;
          return {
            text: visibleText,
            delta: leadCandidate,
          };
        }
      }

      const nextVisible = mergeVisibleChunk(visibleText, chunk);
      visibleText = nextVisible.text;
      return nextVisible.delta ? nextVisible : null;
    },
    finalize(): string {
      return visibleText.trim();
    },
    finalizeRaw(): string {
      return visibleText;
    },
  };
}

const ACP_TRANSCRIPT_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const;

async function persistAcpTurnTranscript(params: {
  body: string;
  finalText: string;
  sessionId: string;
  sessionKey: string;
  sessionEntry: SessionEntry | undefined;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  sessionAgentId: string;
  threadId?: string | number;
  sessionCwd: string;
}): Promise<SessionEntry | undefined> {
  const promptText = params.body;
  const replyText = params.finalText;
  if (!promptText && !replyText) {
    return params.sessionEntry;
  }

  const { sessionFile, sessionEntry } = await resolveSessionTranscriptFile({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    storePath: params.storePath,
    agentId: params.sessionAgentId,
    threadId: params.threadId,
  });
  const hadSessionFile = await fs
    .access(sessionFile)
    .then(() => true)
    .catch(() => false);
  const sessionManager = openSessionManager(sessionFile);
  await prepareSessionManagerForRun({
    sessionManager,
    sessionFile,
    hadSessionFile,
    sessionId: params.sessionId,
    cwd: params.sessionCwd,
  });

  if (promptText) {
    sessionManager.appendMessage({
      role: "user",
      content: promptText,
      timestamp: Date.now(),
    });
  }

  if (replyText) {
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: replyText }],
      api: "openai-responses",
      provider: "openclaw",
      model: "acp-runtime",
      usage: ACP_TRANSCRIPT_USAGE,
      stopReason: "stop",
      timestamp: Date.now(),
    });
  }

  emitSessionTranscriptUpdate(sessionFile);
  return sessionEntry;
}

function runAgentAttempt(params: {
  providerOverride: string;
  modelOverride: string;
  cfg: ReturnType<typeof loadConfig>;
  sessionEntry: SessionEntry | undefined;
  sessionId: string;
  sessionKey: string | undefined;
  sessionAgentId: string;
  sessionFile: string;
  workspaceDir: string;
  body: string;
  isFallbackRetry: boolean;
  resolvedThinkLevel: ThinkLevel;
  timeoutMs: number;
  runId: string;
  opts: AgentCommandOpts & { senderIsOwner: boolean };
  runContext: ReturnType<typeof resolveAgentRunContext>;
  spawnedBy: string | undefined;
  messageChannel: ReturnType<typeof resolveMessageChannel>;
  skillsSnapshot: ReturnType<typeof buildWorkspaceSkillSnapshot> | undefined;
  resolvedVerboseLevel: VerboseLevel | undefined;
  agentDir: string;
  onAgentEvent: (evt: { stream: string; data?: Record<string, unknown> }) => void;
  primaryProvider: string;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  allowTransientCooldownProbe?: boolean;
}) {
  const effectivePrompt = resolveFallbackRetryPrompt({
    body: params.body,
    isFallbackRetry: params.isFallbackRetry,
  });
  const bootstrapPromptWarningSignaturesSeen = resolveBootstrapWarningSignaturesSeen(
    params.sessionEntry?.systemPromptReport,
  );
  const bootstrapPromptWarningSignature =
    bootstrapPromptWarningSignaturesSeen[bootstrapPromptWarningSignaturesSeen.length - 1];
  if (isCliProvider(params.providerOverride, params.cfg)) {
    return (async () => {
      const cliSessionId = getCliSessionId(params.sessionEntry, params.providerOverride);
      // CLI 后端凭证桥（Task 6/9）：本地 `openclaw agent` 运行同样按 bot 归属席位解析企业
      // 作用域，注入个人/企业凭证并在完成后写 UsageAttribution。fail-safe → 回退主机默认 env。
      let credentialEnv: Record<string, string> | undefined;
      let usageAttr: { tenantId: string; userId: string; credentialId: string } | undefined;
      try {
        const credScope = await resolveAgentRunEntitlementScope({
          agentId: params.sessionAgentId,
        });
        if (credScope) {
          const resolved = await resolveCredentialForRun({
            backendId: params.providerOverride,
            model: params.modelOverride,
            scope: {
              tenantId: credScope.tenantId,
              subjectId: credScope.employeeId ?? credScope.seatId,
            },
            config: params.cfg,
          });
          if (resolved) {
            credentialEnv = resolved.env;
            usageAttr = {
              tenantId: credScope.tenantId,
              userId: credScope.employeeId ?? credScope.seatId ?? "",
              credentialId: resolved.credentialId,
            };
          }
        }
      } catch {
        credentialEnv = undefined;
        usageAttr = undefined;
      }
      const runCliWithSession = (nextCliSessionId: string | undefined) =>
        runCliAgent({
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          agentId: params.sessionAgentId,
          sessionFile: params.sessionFile,
          workspaceDir: params.workspaceDir,
          config: params.cfg,
          prompt: effectivePrompt,
          provider: params.providerOverride,
          model: params.modelOverride,
          thinkLevel: params.resolvedThinkLevel,
          timeoutMs: params.timeoutMs,
          runId: params.runId,
          extraSystemPrompt: params.opts.extraSystemPrompt,
          cliSessionId: nextCliSessionId,
          bootstrapPromptWarningSignaturesSeen,
          bootstrapPromptWarningSignature,
          images: params.isFallbackRetry ? undefined : params.opts.images,
          streamParams: params.opts.streamParams,
          ...(credentialEnv ? { credentialEnv } : {}),
        });
      return runCliWithSession(cliSessionId)
        .catch(async (err) => {
          // Handle CLI session expired error
          if (
            err instanceof FailoverError &&
            err.reason === "session_expired" &&
            cliSessionId &&
            params.sessionKey &&
            params.sessionStore &&
            params.storePath
          ) {
            log.warn(
              `CLI session expired, clearing from session store: provider=${params.providerOverride} sessionKey=${params.sessionKey}`,
            );

            // Clear the expired session ID from the session store
            const entry = params.sessionStore[params.sessionKey];
            if (entry) {
              const updatedEntry = { ...entry };
              if (params.providerOverride === "claude-cli") {
                delete updatedEntry.claudeCliSessionId;
              }
              if (updatedEntry.cliSessionIds) {
                const normalizedProvider = normalizeProviderId(params.providerOverride);
                const newCliSessionIds = { ...updatedEntry.cliSessionIds };
                delete newCliSessionIds[normalizedProvider];
                updatedEntry.cliSessionIds = newCliSessionIds;
              }
              updatedEntry.updatedAt = Date.now();

              await persistSessionEntry({
                sessionStore: params.sessionStore,
                sessionKey: params.sessionKey,
                storePath: params.storePath,
                entry: updatedEntry,
              });

              // Update the session entry reference
              params.sessionEntry = updatedEntry;
            }

            // Retry with no session ID (will create a new session)
            return runCliWithSession(undefined).then(async (result) => {
              // Update session store with new CLI session ID if available
              if (
                result.meta.agentMeta?.sessionId &&
                params.sessionKey &&
                params.sessionStore &&
                params.storePath
              ) {
                const entry = params.sessionStore[params.sessionKey];
                if (entry) {
                  const updatedEntry = { ...entry };
                  setCliSessionId(
                    updatedEntry,
                    params.providerOverride,
                    result.meta.agentMeta.sessionId,
                  );
                  updatedEntry.updatedAt = Date.now();

                  await persistSessionEntry({
                    sessionStore: params.sessionStore,
                    sessionKey: params.sessionKey,
                    storePath: params.storePath,
                    entry: updatedEntry,
                  });
                }
              }
              return result;
            });
          }
          throw err;
        })
        .then((result) => {
          // UsageAttribution（Task 9）：成功完成（首次或会话过期重试后）写一次归因。
          if (usageAttr) {
            void recordCliBackendUsage({
              tenantId: usageAttr.tenantId,
              userId: usageAttr.userId,
              backendId: params.providerOverride,
              credentialId: usageAttr.credentialId,
              model: params.modelOverride,
              executionId: params.runId,
            });
          }
          return result;
        });
    })();
  }

  const authProfileId =
    params.providerOverride === params.primaryProvider
      ? params.sessionEntry?.authProfileOverride
      : undefined;
  // Mirror chat/auto-reply: remap ent/* → upstream provider + SecretRef before
  // the embedded runner (which only understands catalog/provider models).
  return (async () => {
    let embeddedProvider = params.providerOverride;
    let embeddedModel = params.modelOverride;
    let providerAuthOverride:
      | {
          apiKey: string;
          source?: string;
          baseUrl?: string;
          protocol?: string;
        }
      | undefined;
    let enterpriseRuntimeModelId: string | undefined;
    const candidateRuntimeId = `${params.providerOverride}/${params.modelOverride}`;
    if (isEnterpriseRuntimeModelId(candidateRuntimeId)) {
      let tenantId = params.opts.gatewayClientSessionTenantId?.trim() || "";
      if (!tenantId) {
        const scope = await resolveAgentRunEntitlementScope({
          agentId: params.sessionAgentId,
        });
        tenantId = scope?.tenantId?.trim() || "";
      }
      if (!tenantId) {
        throw new Error(
          "Enterprise BYOK model selected but managed tenantId could not be resolved",
        );
      }
      const invocation = await resolveEnterpriseRuntimeInvocation({
        tenantId,
        provider: params.providerOverride,
        model: params.modelOverride,
      });
      if (!invocation) {
        throw new Error(`Enterprise BYOK runtime config missing for ${candidateRuntimeId}`);
      }
      embeddedProvider = invocation.provider;
      embeddedModel = invocation.model;
      enterpriseRuntimeModelId = invocation.runtimeModelId;
      providerAuthOverride = {
        apiKey: invocation.apiKey,
        source: "enterprise-byok",
        ...(invocation.baseUrl ? { baseUrl: invocation.baseUrl } : {}),
        protocol: invocation.protocol,
      };
    }
    return runEmbeddedPiAgent({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      agentId: params.sessionAgentId,
      trigger: "user",
      messageChannel: params.messageChannel,
      agentAccountId: params.runContext.accountId,
      messageTo: params.opts.replyTo ?? params.opts.to,
      messageThreadId: params.opts.threadId,
      groupId: params.runContext.groupId,
      groupChannel: params.runContext.groupChannel,
      groupSpace: params.runContext.groupSpace,
      spawnedBy: params.spawnedBy,
      currentChannelId: params.runContext.currentChannelId,
      currentThreadTs: params.runContext.currentThreadTs,
      replyToMode: params.runContext.replyToMode,
      hasRepliedRef: params.runContext.hasRepliedRef,
      senderIsOwner: params.opts.senderIsOwner,
      sessionFile: params.sessionFile,
      workspaceDir: params.workspaceDir,
      config: params.cfg,
      skillsSnapshot: params.skillsSnapshot,
      prompt: effectivePrompt,
      images: params.isFallbackRetry ? undefined : params.opts.images,
      clientTools: params.opts.clientTools,
      provider: embeddedProvider,
      model: embeddedModel,
      ...(providerAuthOverride ? { providerAuthOverride } : {}),
      ...(enterpriseRuntimeModelId ? { enterpriseRuntimeModelId } : {}),
      authProfileId,
      authProfileIdSource: authProfileId
        ? params.sessionEntry?.authProfileOverrideSource
        : undefined,
      thinkLevel: params.resolvedThinkLevel,
      verboseLevel: params.resolvedVerboseLevel,
      timeoutMs: params.timeoutMs,
      runId: params.runId,
      lane: params.opts.lane,
      abortSignal: params.opts.abortSignal,
      extraSystemPrompt: params.opts.extraSystemPrompt,
      inputProvenance: params.opts.inputProvenance,
      streamParams: params.opts.streamParams,
      agentDir: params.agentDir,
      allowTransientCooldownProbe: params.allowTransientCooldownProbe,
      onAgentEvent: params.onAgentEvent,
      bootstrapPromptWarningSignaturesSeen,
      bootstrapPromptWarningSignature, ...inheritExecutionIdentityRunFields(params.opts),
    });
  })();
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
  let commercialRunSlotHeld = false;
  // Subagent runs take their own commercial slot (quota + concurrency).
  // Model allowlists for the child still come from the parent snapshot.
  let commercialGate: AgentCommandCommercialGateResult | undefined;

  // askOutcome W1: CLI / gateway_agent production tip (skip nested subagent lane).
  const agentOutcomeEntrypoint =
    isSubagentLane ? undefined : opts.governanceEntry === "E2" ? "gateway_agent" : "cli";
  let agentOutcomeTaskId: string | undefined;
  let agentOutcomeScope: TrustedScope | undefined;
  let agentOutcomeCloseoutDone = false;
  /** Real usage-derived USD for tip budget closeout (cli/gateway_agent have no mid-run charge). */
  let tipBudgetCostUsd: number | undefined;
  let agentOutcomeSuccess: boolean | undefined;
  let agentOutcomeFailureReason: RunnerTurnFailureReason | undefined;
  let agentOutcomeFailureDetail: string | undefined;
  const agentOutcomeStartedAt = Date.now();
  if (agentOutcomeEntrypoint) {
    const subjectRaw = (
      opts.gatewayClientPlatformUserId ??
      opts.gatewayClientUser ??
      (agentOutcomeEntrypoint === "cli" ? "cli-operator" : "gateway-agent")
    )
      .toString()
      .trim();
    const subjectRef =
      subjectRaw.startsWith("platform-user:") || subjectRaw.includes(":")
        ? subjectRaw
        : `subject:${subjectRaw}`;
    const tenantId =
      opts.gatewayClientSessionTenantId?.trim() ||
      opts.executionIdentity?.enterpriseId?.trim() ||
      undefined;
    const opened =
      agentOutcomeEntrypoint === "cli"
        ? ensureCliTurnTaskOutcome(cfg, {
            agentId: sessionAgentId,
            runId,
            subjectRef,
            ...(tenantId ? { tenantId } : {}),
          })
        : ensureGatewayAgentTurnTaskOutcome(cfg, {
            agentId: sessionAgentId,
            runId,
            subjectRef,
            ...(tenantId ? { tenantId } : {}),
          });
    if (opened.ok) {
      agentOutcomeTaskId = opened.taskId;
      agentOutcomeScope = opened.scope;
    }
  }

  const submitAgentOutcomeCloseout = async () => {
    if (agentOutcomeCloseoutDone || !agentOutcomeEntrypoint) {
      return;
    }
    if (!agentOutcomeTaskId || !agentOutcomeScope) {
      return;
    }
    if (agentOutcomeSuccess === undefined && agentOutcomeFailureReason === undefined) {
      return;
    }
    agentOutcomeCloseoutDone = true;
    const success = agentOutcomeSuccess === true;
    try {
      await recordRunnerTurnOutcome(cfg, sessionAgentId, {
        success,
        runId,
        taskId: agentOutcomeTaskId,
        scope: agentOutcomeScope,
        entrypoint: agentOutcomeEntrypoint,
        latencyMs: Math.max(0, Date.now() - agentOutcomeStartedAt),
        ...(tipBudgetCostUsd != null ? { costUsd: tipBudgetCostUsd } : {}),
        ...(success
          ? {}
          : {
              failureReason: agentOutcomeFailureReason ?? ("run_failed" as const),
              ...(agentOutcomeFailureDetail ? { failureDetail: agentOutcomeFailureDetail } : {}),
            }),
      });
    } catch (err) {
      console.error(
        `[agent] unified recordRunnerTurnOutcome failed for ${agentOutcomeEntrypoint}: ${String(err)}`,
      );
    }
  };

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

    commercialGate = await acquireAgentCommandCommercialRun({
      runId,
      sessionAgentId,
      gatewayClientUser: opts.gatewayClientUser,
      enterpriseId: opts.gatewayClientSessionTenantId,
      taskText: opts.message ?? body,
      ...(isSubagentLane ? { entry: "E6" as const } : opts.governanceEntry ? { entry: opts.governanceEntry } : {}),
    });
    if (commercialGate.status === "denied") {
      agentOutcomeSuccess = false;
      agentOutcomeFailureReason = "authz_denied";
      agentOutcomeFailureDetail = commercialGate.message;
      throw new Error(commercialGate.message);
    }
    let commandExecutionRouting:
      | ReturnType<typeof resolveExecutionRoutingFromCapabilityPlan>
      | undefined;
    if (commercialGate.status === "acquired") {
      commercialRunSlotHeld = true;
      if (!isSubagentLane) {
        const modelGovernance = resolveAgentCommandModelGovernance(
          commercialGate,
          process.env,
          opts.executionIdentity,
        );
        commandExecutionRouting = resolveExecutionRoutingFromCapabilityPlan({
          allowlist: modelGovernance.entitlementAllowlist,
          preferredModelOrder: commercialGate.modelGate?.preferredModelOrder,
          capabilityPlan: commercialGate.modelGate?.capabilityPlan,
        });
        const parentSnapshot = buildRunModelSetSnapshot({
          runId,
          allowlist: commandExecutionRouting.allowlist,
          governanceMode: modelGovernance.governanceMode,
          commercialAuthorizationId: modelGovernance.governanceContext?.commercialAuthorizationId,
          tenantId: modelGovernance.governanceContext?.tenantId,
          actorId: modelGovernance.governanceContext?.actorId,
          preferredModelOrder: commandExecutionRouting.preferredModelOrder,
          // P4-1: parent billing context for child runs (this branch: gate acquired).
          creditReporting: snapshotCreditReportingFromGate(commercialGate),
        });
        if (parentSnapshot) {
          rememberRunModelSet(runId, parentSnapshot);
        }
      }
    }

    if (acpResolution?.kind === "stale") {
      throw acpResolution.error;
    }

    if (acpResolution?.kind === "ready" && sessionKey) {
      const startedAt = Date.now();
      registerAgentRunContext(runId, {
        sessionKey,
      });
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          phase: "start",
          startedAt,
        },
      });

      const visibleTextAccumulator = createAcpVisibleTextAccumulator();
      let stopReason: string | undefined;
      try {
        const dispatchPolicyError = resolveAcpDispatchPolicyError(cfg);
        if (dispatchPolicyError) {
          throw dispatchPolicyError;
        }
        const acpAgent = normalizeAgentId(
          acpResolution.meta.agent || resolveAgentIdFromSessionKey(sessionKey),
        );
        const agentPolicyError = resolveAcpAgentPolicyError(cfg, acpAgent);
        if (agentPolicyError) {
          throw agentPolicyError;
        }

        observeAcpCliSteerPreflight({
          kind: "cli-turn",
          cfg,
          sessionKey,
          agentId: acpAgent,
        });

        await acpManager.runTurn({
          cfg,
          sessionKey,
          text: body,
          mode: "prompt",
          requestId: runId,
          signal: opts.abortSignal,
          onEvent: (event) => {
            if (event.type === "done") {
              stopReason = event.stopReason;
              return;
            }
            if (event.type !== "text_delta") {
              return;
            }
            if (event.stream && event.stream !== "output") {
              return;
            }
            if (!event.text) {
              return;
            }
            const visibleUpdate = visibleTextAccumulator.consume(event.text);
            if (!visibleUpdate) {
              return;
            }
            emitAgentEvent({
              runId,
              stream: "assistant",
              data: {
                text: visibleUpdate.text,
                delta: visibleUpdate.delta,
              },
            });
          },
        });
      } catch (error) {
        const acpError = toAcpRuntimeError({
          error,
          fallbackCode: "ACP_TURN_FAILED",
          fallbackMessage: "ACP turn failed before completion.",
        });
        emitAgentEvent({
          runId,
          stream: "lifecycle",
          data: {
            phase: "error",
            error: acpError.message,
            endedAt: Date.now(),
          },
        });
        throw acpError;
      }

      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          phase: "end",
          endedAt: Date.now(),
        },
      });

      const finalTextRaw = visibleTextAccumulator.finalizeRaw();
      const finalText = visibleTextAccumulator.finalize();
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

    let result: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
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
      let fallbackAttemptIndex = 0;
      recordSubagentModelShadow({
        isSubagentLane,
        snapshot: opts.spawnGovernanceSnapshot,
        provider,
        model,
        runId,
      });
      const commandModelGovernance = resolveAgentCommandModelGovernance(
        isSubagentLane ? undefined : commercialGate,
        process.env,
        opts.executionIdentity,
        opts.governanceEntry,
      );
      const fallbackResult = await runWithModelFallback({
        cfg,
        provider,
        model,
        runId,
        agentDir,
        fallbacksOverride: effectiveFallbacksOverride,
        // legacy when the gate skipped (no enterprise scope); otherwise
        // OPENBOT_GOVERNANCE_AGENT_COMMAND_MODEL_MODE (default shadow: record only).
        ...commandModelGovernance,
        ...(commandExecutionRouting?.allowlist !== undefined
          ? { entitlementAllowlist: commandExecutionRouting.allowlist }
          : {}),
        ...(commandExecutionRouting?.preferredModelOrder
          ? { preferredModelOrder: commandExecutionRouting.preferredModelOrder }
          : {}),
        run: (providerOverride, modelOverride, runOptions) => {
          const isFallbackRetry = fallbackAttemptIndex > 0;
          fallbackAttemptIndex += 1;
          return runAgentAttempt({
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
          });
        },
      });
      result = fallbackResult.result;
      fallbackProvider = fallbackResult.provider;
      fallbackModel = fallbackResult.model;
      tipBudgetCostUsd = estimateTipBudgetCostUsdFromUsage({
        usage: result.meta?.agentMeta?.usage,
        provider: fallbackProvider,
        model: result.meta?.agentMeta?.model ?? fallbackModel,
        config: cfg,
      });
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
    if (agentOutcomeSuccess === undefined) {
      agentOutcomeSuccess = false;
      const msg = String(err);
      if (opts.abortSignal?.aborted) {
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
    if (commercialRunSlotHeld) {
      void releaseAgentCommandCommercialRun(runId);
      forgetRunModelSet(runId);
    }
    clearAgentRunContext(runId);
    await submitAgentOutcomeCloseout();
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

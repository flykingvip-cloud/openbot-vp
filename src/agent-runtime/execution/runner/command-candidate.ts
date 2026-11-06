/** Original command candidate adapter; no task admission or outer fallback loop. */
import { resolveBootstrapWarningSignaturesSeen } from "../../../agents/bootstrap-budget.js";
import { resolveCredentialForRun } from "../../../agents/cli-backend-credential-resolve.js";
import { recordCliBackendUsage } from "../../../agents/cli-backend-usage-attribution.js";
import { runCliAgent } from "../../../agents/cli-runner.js";
import { getCliSessionId, setCliSessionId } from "../../../agents/cli-session.js";
import { FailoverError } from "../../../agents/failover-error.js";
import { isCliProvider, normalizeProviderId } from "../../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../../agents/pi-embedded.js";
import type { buildWorkspaceSkillSnapshot } from "../../../agents/skills.js";
import type { ThinkLevel, VerboseLevel } from "../../../auto-reply/thinking.js";
import type { resolveAgentRunContext } from "../../../commands/agent/run-context.js";
import type { AgentCommandOpts } from "../../../commands/agent/types.js";
import type { loadConfig } from "../../../config/config.js";
import type { SessionEntry } from "../../../config/sessions.js";
import { resolveEnterpriseEmbeddedTransport } from "../../../gateway/enterprise-model/embedded-transport.js";
import { inheritExecutionIdentityRunFields } from "../../../gateway/execution-identity-context.js";
import { resolveAgentRunEntitlementScope } from "../../../gateway/model-entitlement/resolve-agent-run-scope.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import type { resolveMessageChannel } from "../../../utils/message-channel.js";
import { persistCommandSessionEntry } from "../../state/index.js";
const log = createSubsystemLogger("commands/agent");

function resolveFallbackRetryPrompt(params: { body: string; isFallbackRetry: boolean }): string {
  if (!params.isFallbackRetry) {
    return params.body;
  }
  return "Continue where you left off. The previous model attempt failed or timed out.";
}

export function runCommandCandidate(params: {
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
          abortSignal: params.opts.abortSignal,
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

              await persistCommandSessionEntry({
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

                  await persistCommandSessionEntry({
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
  // Remap ent/* → upstream provider + SecretRef before the embedded runner
  // (which only understands catalog/provider models).
  return (async () => {
    const transport = await resolveEnterpriseEmbeddedTransport({
      provider: params.providerOverride,
      model: params.modelOverride,
      tenantId: params.opts.gatewayClientSessionTenantId,
      resolveTenantId: async () => {
        const scope = await resolveAgentRunEntitlementScope({
          agentId: params.sessionAgentId,
        });
        return scope?.tenantId;
      },
    });
    const embeddedProvider = transport.provider;
    const embeddedModel = transport.model;
    const providerAuthOverride = transport.providerAuthOverride;
    const enterpriseRuntimeModelId = transport.enterpriseRuntimeModelId;
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
      bootstrapPromptWarningSignature,
      ...inheritExecutionIdentityRunFields(params.opts),
    });
  })();
}

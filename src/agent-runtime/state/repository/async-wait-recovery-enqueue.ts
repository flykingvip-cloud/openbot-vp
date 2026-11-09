/**
 * Production enqueue adapter: arm task-board continue onto the existing
 * followup queue with a real taskBoardContinueTicket. Does not mark delivery.
 *
 * Resolves model / workspace / auth / delivery target from trusted session +
 * config records — never openai/recovery-continue placeholders or agentDir-as-workspace.
 * Ensures the existing followup drain consumer is registered before enqueue so
 * cold-start recovery actually drains (FOLLOWUP_RUN_CALLBACKS wired at boot).
 */
import fs from "node:fs";
import { resolveAgentDir, resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import { resolveDefaultModelForAgent } from "../../../agents/model-selection.js";
import {
  enqueueFollowupRun,
  hasFollowupDrainCallback,
  kickFollowupDrainIfIdle,
} from "../../../auto-reply/reply/queue.js";
import type { FollowupRun } from "../../../auto-reply/reply/queue/types.js";
import type { OriginatingChannelType } from "../../../auto-reply/templating.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveDefaultSessionStorePath } from "../../../config/sessions/paths.js";
import { loadSessionStore } from "../../../config/sessions/store.js";
import type { SessionEntry } from "../../../config/sessions/types.js";
import { captureTaskCompletionBinding } from "../../../conversation-task/session-task-board.js";
import {
  createExecutionIdentityContext,
  hasAuthenticatedIdentity,
} from "../../../gateway/execution-identity-context.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import type { AsyncWaitRecoveryContinueEnqueue } from "./async-wait-job-recovery.js";

export type AsyncWaitRecoveryFollowupConsumerEnsure = (params: {
  cfg: OpenBotConfig;
  sessionKey: string;
}) => void;

let followupConsumerEnsurePort: AsyncWaitRecoveryFollowupConsumerEnsure | undefined;

export function setAsyncWaitRecoveryFollowupConsumerEnsure(
  port: AsyncWaitRecoveryFollowupConsumerEnsure | undefined,
): void {
  followupConsumerEnsurePort = port;
}

export function getAsyncWaitRecoveryFollowupConsumerEnsure():
  | AsyncWaitRecoveryFollowupConsumerEnsure
  | undefined {
  return followupConsumerEnsurePort;
}

type TrustedSessionFields = {
  sessionId: string;
  sessionFile?: string;
  workspaceDir?: string;
  provider?: string;
  model?: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
  entry?: SessionEntry;
};

function tryLoadTrustedSessionEntry(sessionKey: string): TrustedSessionFields | undefined {
  try {
    const agentId = resolveAgentIdFromSessionKey(sessionKey);
    const storePath = resolveDefaultSessionStorePath(agentId);
    if (!fs.existsSync(storePath)) {
      return undefined;
    }
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey] ?? store[sessionKey.toLowerCase()];
    if (!entry?.sessionId) {
      return undefined;
    }
    const provider = entry.providerOverride?.trim() || entry.modelProvider?.trim() || undefined;
    const model = entry.modelOverride?.trim() || entry.model?.trim() || undefined;
    return {
      sessionId: entry.sessionId,
      sessionFile: entry.sessionFile,
      workspaceDir: entry.systemPromptReport?.workspaceDir?.trim() || undefined,
      provider,
      model,
      authProfileId: entry.authProfileOverride?.trim() || undefined,
      authProfileIdSource: entry.authProfileOverrideSource,
      lastChannel: entry.lastChannel,
      lastTo: entry.lastTo,
      lastAccountId: entry.lastAccountId,
      lastThreadId: entry.lastThreadId,
      entry,
    };
  } catch {
    return undefined;
  }
}

/** Resolve provider/model from session overrides then agent/config defaults — never placeholders. */
export function resolveTrustedRecoveryModel(params: {
  cfg: OpenBotConfig;
  agentId: string;
  session?: TrustedSessionFields;
}): { provider: string; model: string } {
  const defaults = resolveDefaultModelForAgent({ cfg: params.cfg, agentId: params.agentId });
  const provider = params.session?.provider?.trim() || defaults.provider;
  const model = params.session?.model?.trim() || defaults.model;
  return { provider, model };
}

export function resolveTrustedRecoveryIdentity(params: {
  intentTrusted?: {
    user?: string;
    platformUserId?: string;
    sessionDomain?: "platform" | "enterprise" | "employee";
    enterpriseId?: string;
    membershipId?: string;
    seatId?: string;
  };
  agentId: string;
  sessionKey: string;
}): ReturnType<typeof createExecutionIdentityContext> | undefined {
  const snap = params.intentTrusted;
  if (!snap) {
    return undefined;
  }
  const identity = createExecutionIdentityContext({
    user: snap.user,
    platformUserId: snap.platformUserId,
    sessionDomain: snap.sessionDomain,
    enterpriseId: snap.enterpriseId,
    membershipId: snap.membershipId,
    seatId: snap.seatId,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  if (!hasAuthenticatedIdentity(identity)) {
    return undefined;
  }
  return identity;
}

export function createAsyncWaitRecoveryContinueEnqueue(
  cfg: OpenBotConfig,
): AsyncWaitRecoveryContinueEnqueue {
  return (params) => {
    const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
    const agentDir = resolveAgentDir(cfg, agentId);
    const trusted = tryLoadTrustedSessionEntry(params.sessionKey);
    const sessionId = trusted?.sessionId ?? `async-wait-recovery:${params.jobId}`;
    const { provider, model } = resolveTrustedRecoveryModel({ cfg, agentId, session: trusted });
    const executionIdentity = resolveTrustedRecoveryIdentity({
      intentTrusted: params.intent.trustedIdentity,
      agentId,
      sessionKey: params.sessionKey,
    });
    // Missing trusted host identity → explicit refuse; never unscoped exec.
    if (!executionIdentity) {
      return false;
    }
    // Task workspace from session record, else agent workspace — never agentDir.
    const workspaceDir = trusted?.workspaceDir || resolveAgentWorkspaceDir(cfg, agentId);
    let binding;
    try {
      binding = captureTaskCompletionBinding(params.sessionFile);
    } catch {
      binding = undefined;
    }

    // Cold start: establish existing followup consumer before enqueue/drain.
    if (!hasFollowupDrainCallback(params.sessionKey)) {
      followupConsumerEnsurePort?.({ cfg, sessionKey: params.sessionKey });
    }

    const originatingChannel = trusted?.lastChannel as OriginatingChannelType | undefined;
    const run: FollowupRun = {
      prompt: params.prompt,
      messageId: params.messageId,
      summaryLine: "async_wait_recovery_continue",
      enqueuedAt: Date.now(),
      taskBoardContinueTicket: {
        taskId: params.taskId,
        focusRevision: params.focusRevision,
      },
      asyncWaitRecoveryBind: {
        jobId: params.jobId,
        claimToken: params.claimToken,
        ...(params.intent.recovery?.boundRunId
          ? { boundRunId: params.intent.recovery.boundRunId }
          : {}),
        ...(params.intent.recovery?.boundDeliveryId
          ? { boundDeliveryId: params.intent.recovery.boundDeliveryId }
          : {}),
      },
      ...(params.deliveryOnly ? { asyncWaitDeliveryOnly: true } : {}),
      ...(params.deliveryOnly && params.intent.recovery?.boundPayloads?.length
        ? { asyncWaitDeliveryPayloads: params.intent.recovery.boundPayloads }
        : {}),
      ...(params.deliveryOnly &&
      (params.intent.recovery?.boundDeliverableVersion || params.intent.deliverableVersion)
        ? {
            asyncWaitDeliverableVersion:
              params.intent.recovery?.boundDeliverableVersion || params.intent.deliverableVersion,
          }
        : {}),
      ...(originatingChannel ? { originatingChannel } : {}),
      ...(trusted?.lastTo ? { originatingTo: trusted.lastTo } : {}),
      ...(trusted?.lastAccountId ? { originatingAccountId: trusted.lastAccountId } : {}),
      ...(trusted?.lastThreadId != null && trusted.lastThreadId !== ""
        ? { originatingThreadId: trusted.lastThreadId }
        : {}),
      run: {
        agentId,
        agentDir,
        sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        workspaceDir,
        config: cfg,
        provider,
        model,
        executionIdentity,
        gatewayClientUser: executionIdentity.user,
        gatewayClientPlatformUserId: executionIdentity.platformUserId,
        gatewayClientSessionDomain: executionIdentity.sessionDomain,
        ...(trusted?.authProfileId
          ? {
              authProfileId: trusted.authProfileId,
              authProfileIdSource: trusted.authProfileIdSource ?? "user",
            }
          : {}),
        ...(originatingChannel ? { messageProvider: String(originatingChannel) } : {}),
        ...(trusted?.entry ? { sessionEntry: trusted.entry } : {}),
        timeoutMs: 120_000,
        blockReplyBreak: "message_end",
        ...(binding ? { taskCompletionBinding: binding } : {}),
      },
    };
    const enqueued = enqueueFollowupRun(
      params.sessionKey,
      run,
      {
        mode: "followup",
        debounceMs: 0,
        cap: 20,
      },
      "message-id",
    );
    // Defensive: if consumer registered after enqueue raced, kick again.
    if (enqueued && hasFollowupDrainCallback(params.sessionKey)) {
      kickFollowupDrainIfIdle(params.sessionKey);
    }
    return enqueued;
  };
}

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { openSessionManager } from "../../agents/pi-sdk/session.js";
import {
  RESTORE_TASK_ISOLATION_FIELD,
  type RestoreTaskIsolationStamp,
} from "../../auto-reply/reply/restore-task-isolation.js";
import { applyInputProvenanceToUserMessage } from "../../sessions/input-provenance.js";
import { stripAssistantScratchpadFromText } from "../../shared/text/assistant-scratchpad.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";

type AppendMessageArg = Parameters<SessionManager["appendMessage"]>[0];

export type GatewayInjectedAbortMeta = {
  aborted: true;
  origin: "rpc" | "stop-command";
  runId: string;
};

export type GatewayInjectedTranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};

export type GatewayInjectedCronResultMeta = {
  jobId: string;
  runId?: string;
  jobName?: string;
  kind?: "result" | "parked_notice";
};

function buildInjectedTranscriptMessage(params: {
  role: "user" | "assistant";
  message: string;
  label?: string;
  senderLabel?: string;
  idempotencyKey?: string;
  abortMeta?: GatewayInjectedAbortMeta;
  cronResult?: GatewayInjectedCronResultMeta;
  /** Sanitized 大白引导卡片。写入转写，不另起模型回合。 */
  guideCard?: Record<string, unknown>;
  /** Legacy checkpoint restore receipt. Not part of the current task main line. */
  restoreTaskIsolation?: RestoreTaskIsolationStamp;
  /** Declared deliverable chip(s) — must survive history reload after tag strip. */
  artifact?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  deliverablePublish?: Record<string, unknown>;
  /** Keep the caller’s text. Outbound 1:1 lines are already the sent body. */
  preserveBody?: boolean;
  now: number;
}): AppendMessageArg & Record<string, unknown> {
  const labelPrefix = params.role === "assistant" && params.label ? `[${params.label}]\n\n` : "";
  const visibleBody =
    params.role === "assistant" && !params.preserveBody
      ? stripAssistantScratchpadFromText(params.message)
      : params.message;
  const baseMessage = {
    content: [{ type: "text" as const, text: `${labelPrefix}${visibleBody}` }],
    timestamp: params.now,
    ...(params.senderLabel ? { senderLabel: params.senderLabel } : {}),
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  };
  const messageBody: AppendMessageArg & Record<string, unknown> =
    params.role === "assistant"
      ? {
          role: "assistant",
          ...baseMessage,
          stopReason: "stop",
          usage: {
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
          },
          api: "openai-responses",
          provider: "openclaw",
          model: "gateway-injected",
        }
      : {
          role: "user",
          ...baseMessage,
        };

  if (params.role === "assistant") {
    if (params.abortMeta) {
      messageBody.openclawAbort = {
        aborted: true,
        origin: params.abortMeta.origin,
        runId: params.abortMeta.runId,
      };
    }
    if (params.cronResult?.jobId) {
      messageBody.openclawCronResult = {
        jobId: params.cronResult.jobId,
        ...(params.cronResult.runId ? { runId: params.cronResult.runId } : {}),
        ...(params.cronResult.jobName ? { jobName: params.cronResult.jobName } : {}),
        ...(params.cronResult.kind ? { kind: params.cronResult.kind } : {}),
      };
    }
    if (params.guideCard) {
      messageBody.openclawDaibaiGuide = params.guideCard;
    }
    if (params.restoreTaskIsolation) {
      messageBody[RESTORE_TASK_ISOLATION_FIELD] = params.restoreTaskIsolation;
    }
    if (params.artifact) {
      messageBody.artifact = params.artifact;
    }
    if (params.artifacts && params.artifacts.length > 0) {
      messageBody.artifacts = params.artifacts;
    }
    if (params.deliverablePublish) {
      messageBody.deliverablePublish = params.deliverablePublish;
    }
  }

  return messageBody;
}

export function appendInjectedMessageToTranscript(params: {
  transcriptPath: string;
  role: "user" | "assistant";
  message: string;
  label?: string;
  senderLabel?: string;
  idempotencyKey?: string;
  abortMeta?: GatewayInjectedAbortMeta;
  cronResult?: GatewayInjectedCronResultMeta;
  guideCard?: Record<string, unknown>;
  restoreTaskIsolation?: RestoreTaskIsolationStamp;
  artifact?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  deliverablePublish?: Record<string, unknown>;
  now?: number;
}): GatewayInjectedTranscriptAppendResult {
  const now = params.now ?? Date.now();
  const messageBody = buildInjectedTranscriptMessage({
    role: params.role,
    message: params.message,
    ...(params.label ? { label: params.label } : {}),
    ...(params.senderLabel ? { senderLabel: params.senderLabel } : {}),
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    ...(params.abortMeta ? { abortMeta: params.abortMeta } : {}),
    ...(params.cronResult ? { cronResult: params.cronResult } : {}),
    ...(params.guideCard ? { guideCard: params.guideCard } : {}),
    ...(params.restoreTaskIsolation ? { restoreTaskIsolation: params.restoreTaskIsolation } : {}),
    ...(params.artifact ? { artifact: params.artifact } : {}),
    ...(params.artifacts ? { artifacts: params.artifacts } : {}),
    ...(params.deliverablePublish ? { deliverablePublish: params.deliverablePublish } : {}),
    now,
  });

  try {
    const sessionManager = openSessionManager(params.transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody);
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A robot's words, written into the other robot's transcript as that speaker. */
export function buildPeerDeliveryTranscriptMessage(params: {
  message: string;
  senderLabel: string;
  sourceSessionKey: string;
  sourcePlatformUserId?: string;
  now?: number;
}): Record<string, unknown> {
  const senderLabel = params.senderLabel.trim();
  const base = buildInjectedTranscriptMessage({
    role: "user",
    message: params.message.trim(),
    senderLabel,
    now: params.now ?? Date.now(),
  });
  const platformUserId = params.sourcePlatformUserId?.trim();
  return applyInputProvenanceToUserMessage(base as AgentMessage, {
    kind: "inter_session",
    sourceSessionKey: params.sourceSessionKey.trim(),
    sourceChannel: INTERNAL_MESSAGE_CHANNEL,
    sourceTool: "conversation_send",
    sourceSenderLabel: senderLabel,
    ...(platformUserId ? { sourcePlatformUserId: platformUserId } : {}),
  }) as unknown as Record<string, unknown>;
}

export function appendInjectedPeerMessageToTranscript(params: {
  transcriptPath: string;
  message: string;
  senderLabel: string;
  sourceSessionKey: string;
  sourcePlatformUserId?: string;
  now?: number;
}): GatewayInjectedTranscriptAppendResult {
  const messageBody = buildPeerDeliveryTranscriptMessage(params);
  try {
    const sessionManager = openSessionManager(params.transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody as unknown as AppendMessageArg);
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type PeerOutboundTarget = {
  agentId?: string;
  label: string;
  sessionKey?: string;
};

/** Durable「已发消息给」envelope on the sending session. Not an owner-facing reply. */
export function buildPeerOutboundTranscriptMessage(params: {
  message: string;
  targets: PeerOutboundTarget[];
  now?: number;
}): Record<string, unknown> {
  const targets = params.targets.flatMap((target) => {
    const label = target.label.trim();
    if (!label) {
      return [];
    }
    const agentId = target.agentId?.trim();
    const sessionKey = target.sessionKey?.trim();
    return [
      {
        label,
        ...(agentId ? { agentId } : {}),
        ...(sessionKey ? { sessionKey } : {}),
      },
    ];
  });
  const base = buildInjectedTranscriptMessage({
    role: "assistant",
    message: params.message.trim(),
    preserveBody: true,
    now: params.now ?? Date.now(),
  });
  return {
    ...base,
    sentTo: targets,
    openclawPeerOutbound: true,
  };
}

export function appendInjectedPeerOutboundMessageToTranscript(params: {
  transcriptPath: string;
  message: string;
  targets: PeerOutboundTarget[];
  now?: number;
}): GatewayInjectedTranscriptAppendResult {
  const messageBody = buildPeerOutboundTranscriptMessage(params);
  try {
    const sessionManager = openSessionManager(params.transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody as unknown as AppendMessageArg);
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function appendInjectedAssistantMessageToTranscript(params: {
  transcriptPath: string;
  message: string;
  label?: string;
  senderLabel?: string;
  idempotencyKey?: string;
  abortMeta?: GatewayInjectedAbortMeta;
  cronResult?: GatewayInjectedCronResultMeta;
  /** Sanitized 大白引导卡片。只随会话转写保留，不触发模型回合。 */
  guideCard?: Record<string, unknown>;
  restoreTaskIsolation?: RestoreTaskIsolationStamp;
  /** Declared deliverable chip(s) persisted with the stripped bubble text. */
  artifact?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  deliverablePublish?: Record<string, unknown>;
  now?: number;
}): GatewayInjectedTranscriptAppendResult {
  return appendInjectedMessageToTranscript({
    transcriptPath: params.transcriptPath,
    role: "assistant",
    message: params.message,
    senderLabel: params.senderLabel,
    ...(params.label ? { label: params.label } : {}),
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    ...(params.abortMeta ? { abortMeta: params.abortMeta } : {}),
    ...(params.cronResult ? { cronResult: params.cronResult } : {}),
    ...(params.guideCard ? { guideCard: params.guideCard } : {}),
    ...(params.restoreTaskIsolation ? { restoreTaskIsolation: params.restoreTaskIsolation } : {}),
    ...(params.artifact ? { artifact: params.artifact } : {}),
    ...(params.artifacts ? { artifacts: params.artifacts } : {}),
    ...(params.deliverablePublish ? { deliverablePublish: params.deliverablePublish } : {}),
    ...(params.now ? { now: params.now } : {}),
  });
}

/**
 * Persist a chat/agent message leaf through SessionManager.appendMessage.
 * Use for gateway early-persist user leaves (and other non-injected paths) so
 * parentId chains stay owned by SessionManager — never raw JSONL append.
 */
export function appendPersistedAgentMessageToTranscript(params: {
  transcriptPath: string;
  message: AppendMessageArg | Record<string, unknown>;
}): GatewayInjectedTranscriptAppendResult {
  try {
    const sessionManager = openSessionManager(params.transcriptPath);
    const messageId = sessionManager.appendMessage(params.message as AppendMessageArg);
    return { ok: true, messageId, message: params.message as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Chat-handler discuss→task turn: bind trusted inbound → controlled entry →
 * persist user-visible receipt → coordinator binding text.
 * Extracted so integration tests can exercise the real path without full WS E2E.
 */
import type { OpenBotConfig } from "../../config/types.js";
import type { ControlledDiscussToTaskResult } from "./controlled-discuss-to-task.js";
import { maybeControlledDiscussToTaskBeforeDiscussion } from "./discuss-to-task-chat-hook.js";
import {
  buildDiscussToTaskChatReceipt,
  formatDiscussToTaskUserVisibleStatus,
} from "./discuss-to-task-chat-receipt.js";
import {
  registerDiscussToTaskSourceBinding,
  type SourceBindingRegisterResult,
} from "./discuss-to-task-source-binding.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export type DiscussToTaskChatTurnFormalEstablish = {
  attempted: boolean;
  status?: string;
  taskId?: string | null;
  reason?: string;
  userMessage?: string;
  stagesSummary?: string;
};

export type DiscussToTaskTranscriptPersist = {
  ok: boolean;
  error?: string;
  messageId?: string;
  message?: Record<string, unknown>;
};

export type DiscussToTaskChatTurnResult = {
  d2tResult: ControlledDiscussToTaskResult | null;
  formalTaskEstablish?: DiscussToTaskChatTurnFormalEstablish;
  coordinatorBindingText?: string;
  userVisibleMessage?: string;
  transcriptPersist?: DiscussToTaskTranscriptPersist;
  bindingRegister?: SourceBindingRegisterResult;
  error?: string;
};

export type DiscussToTaskClientFeedbackEgress = {
  formalTaskEstablish?: DiscussToTaskChatTurnFormalEstablish;
  coordinatorBindingText?: string;
  clientFeedbackMessage?: string;
  transcriptPersist?: DiscussToTaskTranscriptPersist;
};

export type DiscussToTaskChatEgressPayload = {
  runId: string;
  sessionKey: string;
  seq: number;
  /**
   * Non-terminal status/progress event. Must NOT be "final"/"error"/"aborted":
   * the establish-task receipt must not end the parent chat run.
   */
  state: "status";
  message: Record<string, unknown>;
};

const RECEIPT_PERSIST_FAIL_SUFFIX = "（展示写入失败，请刷新后重试。）";

type PersistReceiptFn = (args: {
  message: string;
  idempotencyKey: string;
}) => Promise<DiscussToTaskTranscriptPersist>;

/**
 * Map chat-turn result onto the chat.send handler fields the client already consumes
 * (formalTaskEstablish + coordinator binding). Always prefers deterministic
 * userVisibleMessage over model paraphrase / logs alone.
 */
export function applyDiscussToTaskChatTurnToChatHandler(
  turn: DiscussToTaskChatTurnResult,
): DiscussToTaskClientFeedbackEgress {
  const clientFeedbackMessage =
    (turn.userVisibleMessage && turn.userVisibleMessage.trim()) ||
    turn.formalTaskEstablish?.userMessage ||
    undefined;
  if (!turn.formalTaskEstablish && !clientFeedbackMessage && !turn.coordinatorBindingText) {
    return {
      transcriptPersist: turn.transcriptPersist,
    };
  }
  const formalTaskEstablish = turn.formalTaskEstablish
    ? {
        ...turn.formalTaskEstablish,
        ...(clientFeedbackMessage ? { userMessage: clientFeedbackMessage } : {}),
      }
    : clientFeedbackMessage
      ? {
          attempted: true,
          status: "blocked",
          taskId: null,
          reason: turn.error ? "discuss_to_task_hook_failed" : "discuss_to_task_feedback",
          userMessage: clientFeedbackMessage,
        }
      : undefined;
  let coordinatorBindingText = turn.coordinatorBindingText;
  if (clientFeedbackMessage) {
    if (!coordinatorBindingText) {
      coordinatorBindingText = `[正式任务入口回执 — 必须绑定] ${clientFeedbackMessage}`;
    } else if (!coordinatorBindingText.includes(clientFeedbackMessage)) {
      coordinatorBindingText = `${coordinatorBindingText}\n${clientFeedbackMessage}`;
    }
  }
  return {
    formalTaskEstablish,
    coordinatorBindingText,
    clientFeedbackMessage,
    transcriptPersist: turn.transcriptPersist,
  };
}

/**
 * Send deterministic discuss→task status through the existing chat event egress
 * (broadcastChat + nodeSendToSession) as a **non-terminal** `state:"status"` event.
 * Used by the real chat.send handler so the client receives content even when
 * transcript persist fails (no model paraphrase), without ending the parent run.
 * Never includes raw internal persist errors — only the safe clientFeedbackMessage.
 */
export function emitDiscussToTaskClientFeedback(params: {
  applied: DiscussToTaskClientFeedbackEgress;
  sessionKey: string;
  runId: string;
  broadcastChat: (
    sessionKey: string,
    payload: unknown,
    opts?: { dropIfSlow?: boolean; tenantId?: string | null; runId?: string | null },
  ) => void;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
  tenantId?: string | null;
}): { emitted: boolean; payload?: DiscussToTaskChatEgressPayload } {
  const text = params.applied.clientFeedbackMessage?.trim() ?? "";
  if (!text) {
    return { emitted: false };
  }
  const persistedMessage =
    params.applied.transcriptPersist?.ok && params.applied.transcriptPersist.message
      ? params.applied.transcriptPersist.message
      : undefined;
  const receiptRunId = `${params.runId}:discuss-to-task-receipt`;
  const receiptMessageId =
    typeof persistedMessage?.id === "string" && persistedMessage.id.trim()
      ? persistedMessage.id.trim()
      : `discuss-to-task-receipt:${params.runId}`;
  const message: Record<string, unknown> = persistedMessage
    ? {
        ...persistedMessage,
        id: receiptMessageId,
        discussToTaskReceipt: true,
        collaborationRoundId:
          typeof persistedMessage.collaborationRoundId === "string"
            ? persistedMessage.collaborationRoundId
            : params.runId,
      }
    : {
        id: receiptMessageId,
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
        senderLabel: "协作调度",
        collaborationRoundId: params.runId,
        discussToTaskReceipt: true,
        ...(params.applied.formalTaskEstablish
          ? { formalTaskEstablish: params.applied.formalTaskEstablish }
          : {}),
      };
  // Explicit non-terminal status: appendable receipt that must not clear the parent run.
  // Do not use state:"final" — frontend isSameChatTurnRunId treats the :receipt suffix as
  // the same turn and handleFinalChatEvent would clearActiveChatRunState too early.
  const payload: DiscussToTaskChatEgressPayload = {
    runId: receiptRunId,
    sessionKey: params.sessionKey,
    seq: 0,
    state: "status",
    message,
  };
  params.broadcastChat(params.sessionKey, payload, {
    runId: payload.runId,
    ...(params.tenantId != null ? { tenantId: params.tenantId } : {}),
  });
  params.nodeSendToSession(params.sessionKey, "chat", payload);
  return { emitted: true, payload };
}

async function persistUserVisibleReceipt(params: {
  message: string;
  sourceMessageId: string;
  persistReceipt?: PersistReceiptFn;
}): Promise<{
  userVisibleMessage: string;
  transcriptPersist?: DiscussToTaskTranscriptPersist;
}> {
  const safeMessage = params.message.trim();
  if (!params.persistReceipt || !safeMessage) {
    return { userVisibleMessage: safeMessage };
  }
  let transcriptPersist: DiscussToTaskTranscriptPersist;
  try {
    transcriptPersist = await params.persistReceipt({
      message: safeMessage,
      idempotencyKey: `${params.sourceMessageId}:discuss-to-task-receipt`,
    });
  } catch (persistErr) {
    transcriptPersist = {
      ok: false,
      error: persistErr instanceof Error ? persistErr.message : String(persistErr),
    };
  }
  // Never paste raw internal persist errors into the user-visible string.
  const userVisibleMessage =
    transcriptPersist && !transcriptPersist.ok
      ? `${safeMessage}${RECEIPT_PERSIST_FAIL_SUFFIX}`
      : safeMessage;
  return { userVisibleMessage, transcriptPersist };
}

export async function runControlledDiscussToTaskChatTurn(params: {
  groupId: string;
  /** Trusted inbound message id (clientRunId) — never an agent run id. */
  sourceMessageId: string;
  message: string;
  /** Original inbound principal (human). */
  principalActor: string;
  client: unknown;
  tenant: CollaborationTenantResolution | null | undefined;
  cfg: OpenBotConfig;
  stampedEnterpriseId?: string | null;
  identityAliases?: string[];
  suggestedClaimantIds?: readonly string[];
  /** Persist receipt into chat transcript; failures must surface. */
  persistReceipt?: PersistReceiptFn;
}): Promise<DiscussToTaskChatTurnResult> {
  const sourceMessageId = params.sourceMessageId.trim();
  const principalActor = params.principalActor.trim();
  const groupId = params.groupId.trim();
  const tenantId =
    params.tenant?.tenantId?.trim() || params.stampedEnterpriseId?.trim() || "_local";

  let bindingRegister: SourceBindingRegisterResult | undefined;
  if (sourceMessageId && principalActor && groupId) {
    try {
      bindingRegister = registerDiscussToTaskSourceBinding({
        sourceMessageId,
        tenantId,
        groupId,
        principalActor,
        kind: "trusted_inbound",
      });
      if (!bindingRegister.ok) {
        const userMessage = "正式任务来源归属冲突，无法借用他人消息身份建立任务。";
        const persisted = await persistUserVisibleReceipt({
          message: userMessage,
          sourceMessageId,
          persistReceipt: params.persistReceipt,
        });
        return {
          d2tResult: null,
          formalTaskEstablish: {
            attempted: true,
            status: "blocked",
            taskId: null,
            reason: "source_owner_conflict",
            userMessage: persisted.userVisibleMessage,
          },
          coordinatorBindingText:
            "[正式任务入口回执 — 必须绑定] status=source_owner_conflict；禁止口头宣称已派工。",
          userVisibleMessage: persisted.userVisibleMessage,
          transcriptPersist: persisted.transcriptPersist,
          bindingRegister,
        };
      }
    } catch (err) {
      const userMessage = "正式任务建立受阻，尚未建立正式任务。";
      const persisted = await persistUserVisibleReceipt({
        message: userMessage,
        sourceMessageId: sourceMessageId || "unknown",
        persistReceipt: params.persistReceipt,
      });
      return {
        d2tResult: null,
        formalTaskEstablish: {
          attempted: true,
          status: "blocked",
          taskId: null,
          reason: "source_binding_register_failed",
          userMessage: persisted.userVisibleMessage,
        },
        coordinatorBindingText:
          "[正式任务入口回执 — 必须绑定] status=blocked；禁止口头宣称已派工。",
        userVisibleMessage: persisted.userVisibleMessage,
        transcriptPersist: persisted.transcriptPersist,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    const d2tResult = await maybeControlledDiscussToTaskBeforeDiscussion({
      groupId,
      sourceMessageId,
      message: params.message,
      actor: principalActor,
      client: params.client,
      tenant: params.tenant,
      cfg: params.cfg,
      stampedEnterpriseId: params.stampedEnterpriseId,
      identityAliases: params.identityAliases,
      suggestedClaimantIds: params.suggestedClaimantIds,
    });
    if (!d2tResult) {
      return { d2tResult: null, bindingRegister };
    }
    const receipt = buildDiscussToTaskChatReceipt(d2tResult);
    const baseVisible = formatDiscussToTaskUserVisibleStatus(d2tResult);
    const persisted = await persistUserVisibleReceipt({
      message: baseVisible,
      sourceMessageId,
      persistReceipt: params.persistReceipt,
    });
    return {
      d2tResult,
      formalTaskEstablish: {
        attempted: d2tResult.attempted,
        status: d2tResult.statusCode,
        taskId: d2tResult.taskId,
        reason: d2tResult.internalReason,
        userMessage: persisted.userVisibleMessage || receipt.userMessage,
        stagesSummary: receipt.stagesSummary,
      },
      coordinatorBindingText: receipt.coordinatorBindingText,
      userVisibleMessage: persisted.userVisibleMessage,
      transcriptPersist: persisted.transcriptPersist,
      bindingRegister,
    };
  } catch (d2tErr) {
    const userMessage = "正式任务建立受阻，尚未建立正式任务。";
    const persisted = await persistUserVisibleReceipt({
      message: userMessage,
      sourceMessageId: sourceMessageId || "unknown",
      persistReceipt: params.persistReceipt,
    });
    return {
      d2tResult: null,
      formalTaskEstablish: {
        attempted: true,
        status: "blocked",
        taskId: null,
        reason: "discuss_to_task_hook_failed",
        userMessage: persisted.userVisibleMessage,
      },
      coordinatorBindingText: "[正式任务入口回执 — 必须绑定] status=blocked；禁止口头宣称已派工。",
      userVisibleMessage: persisted.userVisibleMessage,
      transcriptPersist: persisted.transcriptPersist,
      bindingRegister,
      error: d2tErr instanceof Error ? d2tErr.message : String(d2tErr),
    };
  }
}

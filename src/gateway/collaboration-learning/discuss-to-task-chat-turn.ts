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

export type DiscussToTaskChatTurnResult = {
  d2tResult: ControlledDiscussToTaskResult | null;
  formalTaskEstablish?: DiscussToTaskChatTurnFormalEstablish;
  coordinatorBindingText?: string;
  userVisibleMessage?: string;
  transcriptPersist?: { ok: boolean; error?: string };
  bindingRegister?: SourceBindingRegisterResult;
  error?: string;
};

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
  persistReceipt?: (args: {
    message: string;
    idempotencyKey: string;
  }) => Promise<{ ok: boolean; error?: string }>;
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
        return {
          d2tResult: null,
          formalTaskEstablish: {
            attempted: true,
            status: "blocked",
            taskId: null,
            reason: "source_owner_conflict",
            userMessage,
          },
          coordinatorBindingText:
            "[正式任务入口回执 — 必须绑定] status=source_owner_conflict；禁止口头宣称已派工。",
          userVisibleMessage: userMessage,
          bindingRegister,
        };
      }
    } catch (err) {
      return {
        d2tResult: null,
        formalTaskEstablish: {
          attempted: true,
          status: "blocked",
          taskId: null,
          reason: "source_binding_register_failed",
          userMessage: "正式任务建立受阻，尚未建立正式任务。",
        },
        coordinatorBindingText:
          "[正式任务入口回执 — 必须绑定] status=blocked；禁止口头宣称已派工。",
        userVisibleMessage: "正式任务建立受阻，尚未建立正式任务。",
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
    const userVisibleMessage = formatDiscussToTaskUserVisibleStatus(d2tResult);
    let transcriptPersist: { ok: boolean; error?: string } | undefined;
    if (params.persistReceipt) {
      try {
        transcriptPersist = await params.persistReceipt({
          message: userVisibleMessage,
          idempotencyKey: `${sourceMessageId}:discuss-to-task-receipt`,
        });
      } catch (persistErr) {
        transcriptPersist = {
          ok: false,
          error: persistErr instanceof Error ? persistErr.message : String(persistErr),
        };
      }
    }
    const visible =
      transcriptPersist && !transcriptPersist.ok
        ? `${userVisibleMessage}（展示写入失败：${transcriptPersist.error ?? "unknown"}）`
        : userVisibleMessage;
    return {
      d2tResult,
      formalTaskEstablish: {
        attempted: d2tResult.attempted,
        status: d2tResult.statusCode,
        taskId: d2tResult.taskId,
        reason: d2tResult.internalReason,
        userMessage: receipt.userMessage,
        stagesSummary: receipt.stagesSummary,
      },
      coordinatorBindingText: receipt.coordinatorBindingText,
      userVisibleMessage: visible,
      transcriptPersist,
      bindingRegister,
    };
  } catch (d2tErr) {
    const userMessage = "正式任务建立受阻，尚未建立正式任务。";
    return {
      d2tResult: null,
      formalTaskEstablish: {
        attempted: true,
        status: "blocked",
        taskId: null,
        reason: "discuss_to_task_hook_failed",
        userMessage,
      },
      coordinatorBindingText: "[正式任务入口回执 — 必须绑定] status=blocked；禁止口头宣称已派工。",
      userVisibleMessage: userMessage,
      bindingRegister,
      error: d2tErr instanceof Error ? d2tErr.message : String(d2tErr),
    };
  }
}

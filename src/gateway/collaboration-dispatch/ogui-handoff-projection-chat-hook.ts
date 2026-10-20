/**
 * C4 follow-up — best-effort OGUI→handoff projection on group chat.send.
 *
 * After Form P0 (#672), user submits emit real `ogui-answer` fences via
 * existing chat.send. This hook projects a legal fence into a stored handoff
 * brief when `collaboration.task.oguiHandoffProjection` is ON.
 *
 * Flag OFF → no writes. Illegal fence → degrade (no throw).
 * Non-goals: Floor live, ui.*, ChatSendParamsSchema expand, Admission bypass.
 */
import type { OpenBotConfig } from "../../config/types.js";
import {
  extractOguiAnswerFenceBody,
  isCollabTaskOguiHandoffProjectionEnabled,
  recordOguiAnswerProjectionBestEffort,
  type OguiProjectionRecord,
} from "./ogui-handoff-projection.js";
import type { RuntimeAuthority } from "./runtime-authority.js";

export type ChatSendOguiProjectionHookInput = {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  groupId: string;
  message: string;
  fromAgentId?: string;
  /** chat.send clientRunId / round id */
  relatedId?: string;
  taskId?: string;
};

/**
 * After human group chat.send: if message carries ```ogui-answer``` and flag
 * is ON, persist handoff brief projection. Never throws into the chat hot path.
 */
export async function recordChatSendOguiProjectionBestEffort(
  input: ChatSendOguiProjectionHookInput,
): Promise<{ recorded: boolean; record: OguiProjectionRecord | null }> {
  try {
    if (!isCollabTaskOguiHandoffProjectionEnabled(input.cfg)) {
      return { recorded: false, record: null };
    }
    const message = input.message?.trim() ?? "";
    const groupId = input.groupId?.trim() ?? "";
    if (!message || !groupId) {
      return { recorded: false, record: null };
    }
    // Cheap pre-check: avoid store path when fence clearly absent.
    if (!extractOguiAnswerFenceBody(message)) {
      return { recorded: false, record: null };
    }
    const record = await recordOguiAnswerProjectionBestEffort(
      input.authority,
      {
        groupId,
        message,
        ...(input.taskId?.trim() ? { taskId: input.taskId.trim() } : {}),
        ...(input.relatedId?.trim() ? { relatedId: input.relatedId.trim() } : {}),
        ...(input.fromAgentId?.trim() ? { fromAgentId: input.fromAgentId.trim() } : {}),
      },
      { cfg: input.cfg },
    );
    return { recorded: record !== null, record };
  } catch {
    return { recorded: false, record: null };
  }
}

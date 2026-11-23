import { createHash } from "node:crypto";
import type {
  InteractionModelDecision,
  InteractionTaskTarget,
} from "../../agent-runtime/contracts/interaction.js";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";

/** A group target is a read snapshot of the formal board, never a personal task. */
export function captureGroupInteractionTarget(
  groupId: string,
  currentTaskId: string | null | undefined,
  items: readonly GroupBoardClaimItem[],
): InteractionTaskTarget | undefined {
  if (
    !currentTaskId?.trim() ||
    items.length === 0 ||
    items.some(
      (item) =>
        item.groupId !== groupId ||
        item.taskId !== currentTaskId ||
        !Number.isInteger(item.revision),
    )
  ) {
    return undefined;
  }
  const versions = items
    .map((item) => [item.itemId, item.revision, item.status])
    .toSorted((a, b) => String(a[0]).localeCompare(String(b[0])));
  return {
    taskId: currentTaskId,
    revision: createHash("sha256")
      .update(JSON.stringify([groupId, currentTaskId, versions]))
      .digest("hex"),
  };
}
export function groupTaskControlReply(
  decision: Extract<InteractionModelDecision, { kind: "task_change" | "task_control" }>,
  captured: InteractionTaskTarget | undefined,
  fresh: InteractionTaskTarget | undefined,
  items: readonly GroupBoardClaimItem[],
): string {
  if (
    !captured ||
    !fresh ||
    decision.target.taskId !== captured.taskId ||
    decision.target.revision !== captured.revision ||
    fresh.taskId !== captured.taskId ||
    fresh.revision !== captured.revision
  ) {
    return "当前组任务或版本已变化，尚未修改任务。请在本组任务看板选中当前任务后重试。";
  }
  if (decision.kind === "task_control" && decision.action === "status") {
    return `当前正式任务有 ${items.length} 个看板事项：${items.map((item) => `${item.title}（${item.status}）`).join("；")}。这是已保存的看板状态，不代表执行仍在运行。`;
  }
  return "已找到本组当前正式任务，但聊天入口暂不直接执行该变更。尚未修改或重建任务；请在本组任务看板选中对应事项，使用已有的取消、解除阻塞或任务编辑操作。若找不到所需操作，请明确事项和变更要求。";
}
/** Deterministic fallback explanation: no model call, tools, second admission or extra budget. */
export function explainFormalTaskRejection(status: string, message?: string): string {
  const fact = message?.trim() || "正式任务尚未获准启动。";
  if (status === "formal_task_blocked_flag_off") {
    return `${fact}\n\n这是功能配置门槛，预算和成员确认不会启用它。请有配置权限的管理员为本组启用正式任务能力（全局开关或本租户/小组允许名单），再核对成员和任务写入权限；配置确认后重新提出建立任务。在此之前仍可进行普通咨询，本轮没有派发成员执行。`;
  }
  if (status.includes("auth")) {
    return `${fact}\n\n请组所有者或管理员核对当前登录身份、组成员资格和任务写入权限后重试。本轮没有绕过授权或派发成员执行；仍可咨询当前可用的操作。`;
  }
  return `${fact}\n\n请在本组任务看板核对任务草案、确认状态和所需权限，再继续对应步骤。本轮没有把草案当成已启动任务；如需说明，请指出遇到的提示。`;
}

/** Board availability is execution context, never a prerequisite for ordinary conversation. */
export async function readGroupInteractionTarget(input: {
  groupId: string;
  taskId?: string | null;
  read: (taskId: string) => Promise<GroupBoardClaimItem[]>;
  warn: (message: string) => void;
}): Promise<{ available: boolean; target?: InteractionTaskTarget; items: GroupBoardClaimItem[] }> {
  if (!input.taskId) {
    return { available: true, items: [] };
  }
  try {
    const items = await input.read(input.taskId);
    return {
      available: true,
      items,
      target: captureGroupInteractionTarget(input.groupId, input.taskId, items),
    };
  } catch {
    input.warn(
      "group interaction task target unavailable; ordinary conversation remains available",
    );
    return { available: false, items: [] };
  }
}

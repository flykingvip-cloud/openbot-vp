/**
 * Human-attention card (watchdog / heartbeat exhaustion).
 *
 * Posted into the task group conversation (```human-attention``` fence) and
 * mirrored into the unified workbench pending-tasks list. Options depend on
 * failure kind — side_effect_unknown never offers blind "retry now".
 */
import { sanitizeDispatchErrorMessage } from "./sanitize-dispatch-error.js";

export const HUMAN_ATTENTION_KIND = "human_attention" as const;
export const HUMAN_ATTENTION_FENCE = "human-attention";

export type HumanAttentionFailureKind =
  | "not_started"
  | "side_effect_unknown"
  | "retries_exhausted"
  | "awaiting_review";

export type HumanAttentionOptionId =
  | "retry_after_fix"
  | "transfer"
  | "cancel_task"
  | "view_evidence"
  | "confirm_completed"
  | "release_after_verify"
  | "view_artifact"
  | "accept_submission"
  | "return_submission"
  | "view_failure_reason"
  | "take_over";

export type HumanAttentionOption = {
  id: HumanAttentionOptionId;
  label: string;
  style: "primary" | "default" | "danger" | "ghost";
};

export type HumanAttentionCard = {
  kind: typeof HUMAN_ATTENTION_KIND;
  /** Persistent todo id (groupId|itemId|fingerprint). */
  todoId: string;
  decisionId: string;
  groupId: string;
  taskId: string;
  boardItemId: string;
  fingerprint: string;
  version: number;
  title: string;
  taskTitle: string;
  boardStatus: string;
  failureKind: HumanAttentionFailureKind;
  reason: string;
  ownerIds: string[];
  ownerLabels?: string[];
  recoveryHint: string;
  /** Whether external side effects may already have happened. */
  sideEffectMayHaveOccurred: boolean;
  summary: string[];
  options: HumanAttentionOption[];
  /**
   * Todo status. Terminal UX is driven by status (resolved|recovered), NOT by
   * mere presence of resolution/lastTransfer — open transfers stay actionable.
   */
  status?: "open" | "claimed" | "acknowledged" | "resolved" | "recovered";
  /** Set when resolved — card becomes a receipt (only when status is terminal). */
  resolution?: {
    action: HumanAttentionOptionId;
    actorId: string;
    at: number;
    result: string;
  };
};

export type HumanAttentionCardBuildInput = {
  todoId: string;
  groupId: string;
  taskId: string;
  boardItemId: string;
  fingerprint: string;
  version: number;
  failureKind: HumanAttentionFailureKind;
  reason: string;
  ownerIds: readonly string[];
  ownerLabels?: readonly string[];
  recoveryHint: string;
  taskTitle?: string;
  boardStatus?: string;
  status?: HumanAttentionCard["status"];
  resolution?: HumanAttentionCard["resolution"];
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveHumanAttentionFailureKind(params: {
  source: string;
  boardStatus?: string;
  sideEffectClass?: string | null;
}): HumanAttentionFailureKind {
  const board = compact(params.boardStatus);
  if (board === "submitted_for_review") {
    return "awaiting_review";
  }
  const side = compact(params.sideEffectClass);
  if (side === "started_or_unknown" || params.source === "side_effect_unknown") {
    return "side_effect_unknown";
  }
  if (
    params.source === "nudge_failures_exhausted" ||
    params.source === "escalate_failures_exhausted"
  ) {
    return "retries_exhausted";
  }
  if (side === "not_started") {
    return "not_started";
  }
  // Exhausted paths without unknown side effects still count as retries_exhausted.
  if (params.source.includes("failures_exhausted")) {
    return "retries_exhausted";
  }
  return "not_started";
}

export function optionsForHumanAttentionFailureKind(
  kind: HumanAttentionFailureKind,
): HumanAttentionOption[] {
  switch (kind) {
    case "not_started":
      return [
        { id: "retry_after_fix", label: "修复后重试", style: "primary" },
        { id: "transfer", label: "转交", style: "default" },
        { id: "cancel_task", label: "取消任务", style: "danger" },
      ];
    case "side_effect_unknown":
      // Forbidden: immediate blind retry. Must verify side effects first.
      return [
        { id: "view_evidence", label: "查看执行证据", style: "default" },
        { id: "confirm_completed", label: "确认结果已完成", style: "primary" },
        { id: "release_after_verify", label: "核实后允许重试", style: "default" },
      ];
    case "awaiting_review":
      return [
        { id: "view_artifact", label: "查看成果", style: "default" },
        { id: "accept_submission", label: "通过", style: "primary" },
        { id: "return_submission", label: "退回修改", style: "default" },
      ];
    case "retries_exhausted":
      return [
        { id: "view_failure_reason", label: "查看失败原因", style: "default" },
        { id: "transfer", label: "转交", style: "default" },
        { id: "take_over", label: "人工接管", style: "primary" },
      ];
  }
}

export function buildHumanAttentionCard(
  input: HumanAttentionCardBuildInput,
): HumanAttentionCard | null {
  const todoId = compact(input.todoId);
  const groupId = compact(input.groupId);
  const taskId = compact(input.taskId);
  const boardItemId = compact(input.boardItemId);
  const fingerprint = compact(input.fingerprint);
  const version =
    typeof input.version === "number" && Number.isFinite(input.version) && input.version > 0
      ? Math.floor(input.version)
      : 1;
  if (!todoId || !groupId || !taskId || !boardItemId || !fingerprint) {
    return null;
  }
  const ownerIds = [...new Set(input.ownerIds.map((id) => compact(id)).filter(Boolean))];
  if (ownerIds.length === 0) {
    return null;
  }
  const reason = sanitizeDispatchErrorMessage(input.reason || "needs_human", 320);
  const recoveryHint = sanitizeDispatchErrorMessage(
    input.recoveryHint || "Inspect board + wake-op ledger before re-dispatch.",
    400,
  );
  const taskTitle = compact(input.taskTitle) || taskId;
  const boardStatus = compact(input.boardStatus) || "unknown";
  const failureKind = input.failureKind;
  const sideEffectMayHaveOccurred = failureKind === "side_effect_unknown";
  const summary = [
    `任务：${taskTitle}`,
    `状态：${boardStatus}`,
    `原因：${reason}`,
    `责任人：${ownerIds.join("、")}`,
    sideEffectMayHaveOccurred
      ? "外部操作：可能已发生（禁止直接重试，须先核实）"
      : "外部操作：未见已开始证据（修复后可重试）",
  ];
  const status = input.status;
  const terminal = status === "resolved" || status === "recovered";
  const card: HumanAttentionCard = {
    kind: HUMAN_ATTENTION_KIND,
    todoId,
    decisionId: todoId,
    groupId,
    taskId,
    boardItemId,
    fingerprint,
    version,
    title: terminal ? "任务人工处理结果" : "任务需要你处理",
    taskTitle,
    boardStatus,
    failureKind,
    reason,
    ownerIds,
    recoveryHint,
    sideEffectMayHaveOccurred,
    summary,
    options: terminal ? [] : optionsForHumanAttentionFailureKind(failureKind),
    status,
  };
  if (input.ownerLabels && input.ownerLabels.length === ownerIds.length) {
    card.ownerLabels = input.ownerLabels.map((label) => compact(label) || "责任人");
  }
  if (terminal && input.resolution) {
    card.resolution = {
      action: input.resolution.action,
      actorId: compact(input.resolution.actorId),
      at: input.resolution.at,
      result: sanitizeDispatchErrorMessage(input.resolution.result, 240),
    };
  }
  return card;
}

export function parseHumanAttentionCard(raw: unknown): HumanAttentionCard | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.kind !== HUMAN_ATTENTION_KIND && raw.kind !== "human-attention") {
    return null;
  }
  return buildHumanAttentionCard({
    todoId:
      typeof raw.todoId === "string"
        ? raw.todoId
        : typeof raw.decisionId === "string"
          ? raw.decisionId
          : "",
    groupId: typeof raw.groupId === "string" ? raw.groupId : "",
    taskId: typeof raw.taskId === "string" ? raw.taskId : "",
    boardItemId:
      typeof raw.boardItemId === "string"
        ? raw.boardItemId
        : typeof raw.itemId === "string"
          ? raw.itemId
          : "",
    fingerprint: typeof raw.fingerprint === "string" ? raw.fingerprint : "",
    version: typeof raw.version === "number" ? raw.version : 1,
    failureKind:
      raw.failureKind === "not_started" ||
      raw.failureKind === "side_effect_unknown" ||
      raw.failureKind === "retries_exhausted" ||
      raw.failureKind === "awaiting_review"
        ? raw.failureKind
        : "retries_exhausted",
    reason: typeof raw.reason === "string" ? raw.reason : "",
    ownerIds: Array.isArray(raw.ownerIds)
      ? raw.ownerIds.filter((id): id is string => typeof id === "string")
      : [],
    ownerLabels: Array.isArray(raw.ownerLabels)
      ? raw.ownerLabels.filter((id): id is string => typeof id === "string")
      : undefined,
    recoveryHint: typeof raw.recoveryHint === "string" ? raw.recoveryHint : "",
    taskTitle: typeof raw.taskTitle === "string" ? raw.taskTitle : undefined,
    boardStatus: typeof raw.boardStatus === "string" ? raw.boardStatus : undefined,
    status:
      raw.status === "open" ||
      raw.status === "claimed" ||
      raw.status === "acknowledged" ||
      raw.status === "resolved" ||
      raw.status === "recovered"
        ? raw.status
        : undefined,
    resolution:
      raw.resolution && isPlainObject(raw.resolution)
        ? {
            action: compact(
              typeof raw.resolution.action === "string" ? raw.resolution.action : "",
            ) as HumanAttentionOptionId,
            actorId: compact(
              typeof raw.resolution.actorId === "string" ? raw.resolution.actorId : "",
            ),
            at: typeof raw.resolution.at === "number" ? raw.resolution.at : Date.now(),
            result: compact(typeof raw.resolution.result === "string" ? raw.resolution.result : ""),
          }
        : undefined,
  });
}

const HUMAN_ATTENTION_FENCE_RE = /```\s*human-attention\s*\r?\n([\s\S]*?)```/i;

export function extractHumanAttentionFenceBody(text: string): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }
  const match = HUMAN_ATTENTION_FENCE_RE.exec(text);
  if (!match) {
    return null;
  }
  const body = match[1]?.trim() ?? "";
  return body.length > 0 ? body : null;
}

export function parseHumanAttentionFence(text: string): HumanAttentionCard | null {
  const body = extractHumanAttentionFenceBody(text);
  if (!body) {
    return null;
  }
  try {
    return parseHumanAttentionCard(JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

export function formatHumanAttentionMessageText(
  card: HumanAttentionCard,
  opts?: { includeFence?: boolean },
): string {
  const mention = card.ownerIds.map((id, i) => `@${card.ownerLabels?.[i] ?? id}`).join(" ");
  const lines = [
    `${mention || "责任人"} — ${card.title}`,
    "",
    ...card.summary,
    "",
    `恢复建议：${card.recoveryHint}`,
  ];
  if ((card.status === "resolved" || card.status === "recovered") && card.resolution) {
    lines.push(
      "",
      `处理人：${card.resolution.actorId}`,
      `处理结果：${card.resolution.result}`,
      `操作：${card.resolution.action}`,
    );
  }
  if (opts?.includeFence !== false) {
    lines.push("", `\`\`\`${HUMAN_ATTENTION_FENCE}`, JSON.stringify(card, null, 2), "```");
  }
  return lines.join("\n");
}

export function humanAttentionIdempotencyKey(card: HumanAttentionCard): string {
  return `human-attention:${card.todoId}:v${card.version}`;
}

/** Guard: side_effect_unknown must never expose a blind retry option. */
export function assertsNoBlindRetryOption(card: HumanAttentionCard): boolean {
  if (card.failureKind !== "side_effect_unknown") {
    return true;
  }
  return !card.options.some(
    (opt) =>
      opt.id === "retry_after_fix" || opt.id === ("immediate_retry" as HumanAttentionOptionId),
  );
}

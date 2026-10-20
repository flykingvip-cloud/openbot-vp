/**
 * Expert recommendation #5: surface silent suppress reasons so UI does not
 * look like bots simply failed to respond.
 *
 * Categories (user-facing Chinese):
 * - 已运行，重复内容略过
 * - 等待成员／审批
 * - 未获调度
 * - 上下文不足
 *
 * Flag collaboration.surfaceSilentSuppressReasons default OFF.
 * Maps from CollaborationSkipReason / fault-round outcome kinds (#870).
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { FaultRoundVisibleOutcomeKind } from "./fault-round-diagnostic.js";

export type CollaborationSuppressKind =
  | "ran_duplicate_skipped"
  | "waiting_member_or_approval"
  | "not_dispatched"
  | "context_insufficient"
  | "infra_failure"
  | "other";

export const COLLABORATION_SUPPRESS_KIND_LABEL_ZH: Record<CollaborationSuppressKind, string> = {
  ran_duplicate_skipped: "已运行，重复内容略过",
  waiting_member_or_approval: "等待成员／审批",
  not_dispatched: "未获调度",
  context_insufficient: "上下文不足",
  infra_failure: "执行中断",
  other: "本轮未形成可见回复",
};

export function isCollaborationSurfaceSilentSuppressReasonsEnabled(
  cfg?: OpenBotConfig | null,
): boolean {
  if (cfg?.collaboration?.surfaceSilentSuppressReasons === true) {
    return true;
  }
  const raw = process.env.OPENBOT_COLLAB_SURFACE_SILENT_SUPPRESS?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  return false;
}

export function collaborationSuppressKindFromSkipReason(
  skipReason: string | undefined,
): CollaborationSuppressKind {
  const reason = String(skipReason ?? "");
  if (reason === "duplicate" || reason === "silent" || reason === "pure_ack") {
    return "ran_duplicate_skipped";
  }
  if (reason === "empty" || reason === "language") {
    return "context_insufficient";
  }
  if (reason === "crash" || reason === "timeout") {
    return "infra_failure";
  }
  if (
    reason === "waiting_member" ||
    reason === "awaiting_approval" ||
    reason === "mention_confirm"
  ) {
    return "waiting_member_or_approval";
  }
  if (reason === "not_dispatched" || reason === "no_participants") {
    return "not_dispatched";
  }
  return "other";
}

export function collaborationSuppressKindFromFaultOutcome(
  kind: FaultRoundVisibleOutcomeKind | undefined,
  skipReason?: string,
): CollaborationSuppressKind {
  if (skipReason) {
    return collaborationSuppressKindFromSkipReason(skipReason);
  }
  if (kind === "silent_suppress" || kind === "no_reply") {
    return "ran_duplicate_skipped";
  }
  if (kind === "empty") {
    return "context_insufficient";
  }
  if (kind === "skip") {
    return "other";
  }
  return "other";
}

export function formatCollaborationSuppressNotice(params: {
  kind: CollaborationSuppressKind;
  agentName?: string;
  detail?: string;
}): string {
  const label = COLLABORATION_SUPPRESS_KIND_LABEL_ZH[params.kind];
  const who = params.agentName?.trim();
  const detail = params.detail?.trim();
  if (who && detail) {
    return `${who}：${label}（${detail}）`;
  }
  if (who) {
    return `${who}：${label}`;
  }
  if (detail) {
    return `${label}：${detail}`;
  }
  return label;
}

/**
 * Flag-on user-facing abort notice using the four expert categories.
 * Flag-off callers should keep formatCollaborationRoundAbortNotice.
 */
export function formatCollaborationSuppressAbortNotice(params: {
  kind: CollaborationSuppressKind;
  agentName?: string;
  detail?: string;
}): string {
  const who = params.agentName?.trim() || "数字人";
  const label = COLLABORATION_SUPPRESS_KIND_LABEL_ZH[params.kind];
  switch (params.kind) {
    case "ran_duplicate_skipped":
      return `本轮没有形成可见回复：${who}已运行，重复内容略过。请补充新角度或证据，或 @其他成员。`;
    case "waiting_member_or_approval":
      return `本轮没有形成可见回复：等待成员／审批。请确认相关成员或审批后再继续。`;
    case "not_dispatched":
      return `本轮没有形成可见回复：未获调度。请 @具体成员点名，或检查协作模式／认领状态。`;
    case "context_insufficient":
      return `本轮没有形成可见回复：上下文不足（${who}未产出可用正文）。可说「按前面约定／继续上次任务」触发群任务与授权资料检索，或缩短问题后重发。`;
    case "infra_failure": {
      const detail = params.detail?.trim();
      return detail
        ? `本轮没有形成可见回复：${detail}。可稍后重试，或 @其他成员接手。`
        : `本轮没有形成可见回复：${who}执行中断。可稍后重试，或 @其他成员接手。`;
    }
    default:
      return `本轮没有形成可见回复：${label}。请补充约束后重发，或 @具体成员点名。`;
  }
}

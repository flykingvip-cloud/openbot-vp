/**
 * Expert #5: user-facing labels for collaboration silent suppress kinds.
 * Keep in sync with src/gateway/collaboration-dispatch/suppress-reason-surface.ts.
 */

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

const KNOWN = new Set<string>(Object.keys(COLLABORATION_SUPPRESS_KIND_LABEL_ZH));

export function readCollaborationSuppressKind(message: unknown): CollaborationSuppressKind | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const raw = (message as { collaborationSuppressKind?: unknown }).collaborationSuppressKind;
  if (typeof raw !== "string" || !KNOWN.has(raw)) {
    return null;
  }
  return raw as CollaborationSuppressKind;
}

export function collaborationSuppressKindLabelZh(
  kind: CollaborationSuppressKind | null | undefined,
): string | null {
  if (!kind) {
    return null;
  }
  return COLLABORATION_SUPPRESS_KIND_LABEL_ZH[kind] ?? null;
}

export function isCollaborationSuppressNoticeMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const rec = message as {
    collaborationAbort?: unknown;
    collaborationMemberSkip?: unknown;
    collaborationSuppressKind?: unknown;
  };
  return Boolean(
    rec.collaborationAbort === true ||
    rec.collaborationMemberSkip === true ||
    (typeof rec.collaborationSuppressKind === "string" && KNOWN.has(rec.collaborationSuppressKind)),
  );
}

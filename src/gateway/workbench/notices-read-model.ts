import type { GovernanceSummary } from "../knowledge/governance/types.js";

export type WorkbenchNoticeKind =
  | "governance-conflict"
  | "governance-attention"
  | "meeting-invite-review"
  | "meeting-minutes-confirm";

export type WorkbenchNoticeItem = {
  id: string;
  kind: WorkbenchNoticeKind;
  severity: "warning" | "info";
  count: number;
};

export type WorkbenchNoticesResult = {
  totalCount: number;
  /** Open governance conflicts (chunk + claim) in the caller's knowledge index. */
  conflictCount: number;
  /** Open attention items (duplicate / stale / orphan) worth reviewing. */
  attentionCount: number;
  /** Meeting invites awaiting the organizer's review (pending_approval) — Phase B3. */
  meetingInviteReviewCount: number;
  /** Meeting minutes awaiting confirmation — Phase C placeholder (0 until then). */
  meetingMinutesConfirmCount: number;
  /** Actionable organizer meetings (draft + pending_approval) for todos deep-links. */
  meetingTodoItems: WorkbenchMeetingTodoItem[];
  items: WorkbenchNoticeItem[];
};

/**
 * Subset of {@link GovernanceSummary} the notices projection consumes. Kept
 * structural so callers can pass the raw governance summary or a test fixture.
 */
export type WorkbenchNoticesGovernanceInput = Pick<
  GovernanceSummary,
  | "openConflictCount"
  | "openClaimConflictCount"
  | "openDuplicateCount"
  | "openStaleCount"
  | "openOrphanCount"
>;

export type WorkbenchNoticesInput = {
  /**
   * The caller's user-scoped knowledge governance summary (already resolved
   * against the actor's own knowledge index). `null`/`undefined` when no index
   * exists yet or the source was unavailable this cycle — yields an empty
   * result rather than a stale or cross-user view.
   */
  governance?: WorkbenchNoticesGovernanceInput | null;
  /**
   * Meeting-derived review items (Phase B3) merged ADDITIVELY on top of the
   * governance signal — they never alter the governance counts. Absent/null →
   * no meeting items.
   */
  meetings?: WorkbenchNoticesMeetingInput | null;
};

export type WorkbenchNoticesMeetingInput = {
  /** Organizer meetings awaiting submit (draft) or approval (pending_approval). */
  inviteReviewCount?: number;
  /** Meeting minutes awaiting confirmation (Phase C; 0 until then). */
  minutesConfirmCount?: number;
  /** Per-meeting rows for the 待办事项 card (title-level, not aggregate-only). */
  todoItems?: WorkbenchMeetingTodoItem[];
};

export type WorkbenchMeetingTodoItem = {
  id: string;
  title: string;
  status: "draft" | "pending_approval";
};

/**
 * Deterministic "system notices" projection for the employee home 重要通知 card
 * (M2, "底座 A" read-model). Sources the *employee-safe* maintenance/read-model
 * signal — the caller's user-scoped knowledge governance (open conflicts +
 * attention items), which the gateway maintenance loop keeps fresh via
 * `tickKnowledgeGovernanceJobs()`. No LLM; pure shaping over already-resolved
 * counts so it is trivially unit-testable.
 *
 * SCOPE DECISION (deliberate, documented): install-global signals (per-channel
 * connectivity, install-wide health probes) and enterprise-admin/financial
 * signals (billing / quota) are intentionally EXCLUDED from this employee-facing
 * projection. Their runtime/data is install-global or admin-scoped, so surfacing
 * them on a per-employee session would breach the tenant-isolation guarantees
 * enforced across the workbench (sessions / deliverables / spaces). Those belong
 * on the enterprise/admin surfaces, not the personal employee home. Live gateway
 * connection health is surfaced separately, client-side, from the websocket
 * (connection state, not install data) and is not part of this read-model.
 */
export function buildWorkbenchNotices(input: WorkbenchNoticesInput): WorkbenchNoticesResult {
  const governance = input.governance;
  const conflictCount = governance
    ? (governance.openConflictCount ?? 0) + (governance.openClaimConflictCount ?? 0)
    : 0;
  const attentionCount = governance
    ? (governance.openDuplicateCount ?? 0) +
      (governance.openStaleCount ?? 0) +
      (governance.openOrphanCount ?? 0)
    : 0;
  // Meeting-derived counts are merged additively and never touch governance.
  const meetingInviteReviewCount = Math.max(0, Math.trunc(input.meetings?.inviteReviewCount ?? 0));
  const meetingMinutesConfirmCount = Math.max(
    0,
    Math.trunc(input.meetings?.minutesConfirmCount ?? 0),
  );
  const meetingTodoItems = (input.meetings?.todoItems ?? []).filter(
    (item) =>
      item.id.trim() &&
      item.title.trim() &&
      (item.status === "draft" || item.status === "pending_approval"),
  );
  const items: WorkbenchNoticeItem[] = [];
  if (conflictCount > 0) {
    items.push({
      id: "governance:conflict",
      kind: "governance-conflict",
      severity: "warning",
      count: conflictCount,
    });
  }
  if (attentionCount > 0) {
    items.push({
      id: "governance:attention",
      kind: "governance-attention",
      severity: "info",
      count: attentionCount,
    });
  }
  if (meetingInviteReviewCount > 0) {
    items.push({
      id: "meeting:invite-review",
      kind: "meeting-invite-review",
      severity: "info",
      count: meetingInviteReviewCount,
    });
  }
  if (meetingMinutesConfirmCount > 0) {
    items.push({
      id: "meeting:minutes-confirm",
      kind: "meeting-minutes-confirm",
      severity: "info",
      count: meetingMinutesConfirmCount,
    });
  }
  return {
    totalCount:
      conflictCount + attentionCount + meetingInviteReviewCount + meetingMinutesConfirmCount,
    conflictCount,
    attentionCount,
    meetingInviteReviewCount,
    meetingMinutesConfirmCount,
    meetingTodoItems,
    items,
  };
}

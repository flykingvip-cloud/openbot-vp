import { i18n, t } from "../../../../i18n/index.ts";

/**
 * Employee home daily overview — two cards only:
 *   1. schedule  今日日程  — time axis (when)
 *   2. todos     待办事项  — action queue (what needs you now)
 *
 * Backend read-models stay actor-scoped; the UI merges pending + collaboration +
 * meeting-review + knowledge-conflict notices into the todos card. The steward
 * tip bar is not shown on the home strip.
 */

const MACHINE_LABEL = /^[a-z][a-z0-9._-]*\.[a-z0-9._-]+$/i;

export function sanitizeSignalLabel(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || MACHINE_LABEL.test(trimmed)) {
    return t("common.na");
  }
  return trimmed;
}

export type WorkbenchSignalActionId = "openCron" | "openTodos";

export type WorkbenchSignalCardKey = "schedule" | "todos";

/** Origin tag for deep-link routing on the merged todos card. */
export type WorkbenchSignalItemOrigin = "task" | "collaboration" | "meeting-notice" | "knowledge";

/**
 * A single clickable item surfaced inside a signal card body. Every card list is
 * AUTO-EXTRACTED from conversations with the steward / collaboration groups (or
 * added on the user's behalf by a bot) — never manually entered here — so the card
 * only DISPLAYS these refs; clicking one opens the card's detail surface.
 */
export type WorkbenchSignalItemRef = {
  id: string;
  title: string;
  /** Optional secondary line (time / summary / source). */
  meta?: string;
  /** Routing hint for the merged todos card (ignored on schedule). */
  origin?: WorkbenchSignalItemOrigin;
};

/** Deterministic "pending work" counts (M1) — one source of the todos card. */
export type WorkbenchPendingTasksSummary = {
  totalCount: number;
  taskCount: number;
  /** Subset of taskCount whose pending task still needs explicit acknowledgement. */
  ackRequiredCount: number;
  governanceCount: number;
  inviteCount: number;
  /** Top pending items (auto-extracted) shown as the clickable card list. */
  items?: WorkbenchSignalItemRef[];
};

/** Legacy alias kept for app state slices until my-tasks read-model lands. */
export type WorkbenchMyTasksSummary = {
  totalCount: number;
  cronCount?: number;
  supervisedCount?: number;
  assignedCount?: number;
  items?: WorkbenchSignalItemRef[];
};

/**
 * System-level governance / meeting-review projection (M2). Meeting-invite /
 * minutes and knowledge conflicts/attention fold into todos; the steward bar
 * is not rendered on the home strip.
 */
export type WorkbenchNoticesSummary = {
  /** Open governance conflicts (chunk + claim) in the caller's knowledge index. */
  conflictCount: number;
  /** Open attention items (duplicate / stale / orphan) worth reviewing. */
  attentionCount: number;
  /** Meeting invites awaiting the organizer's review (Phase B3, additive). */
  meetingInviteReviewCount?: number;
  /** Meeting minutes awaiting confirmation (Phase C placeholder). */
  meetingMinutesConfirmCount?: number;
  /** Typed notice items from the read-model (meeting kinds fold into todos). */
  items?: WorkbenchNoticeItemRef[];
};

/** Notice kinds the notices read-model can surface (mirrors the gateway). */
export type WorkbenchNoticeKindRef =
  | "governance-conflict"
  | "governance-attention"
  | "meeting-invite-review"
  | "meeting-minutes-confirm";

/** A single notice item (kind + count) from workbench.notices.list. */
export type WorkbenchNoticeItemRef = {
  id: string;
  kind: WorkbenchNoticeKindRef;
  count: number;
};

/** Collaboration spaces needing a human response (M3) — merged into todos. */
export type WorkbenchUpcomingCollaborationSummary = {
  /** Spaces in the actor's scope currently waiting for a human response. */
  needsResponseCount: number;
  /** Waiting spaces whose current phase is a decision. */
  decisionCount: number;
  /** Waiting spaces whose current phase is a review. */
  reviewCount: number;
  /** Spaces the actor is in that are active (in-progress) but not waiting. */
  activeCount: number;
  /** Top collaboration items (auto-extracted) shown as the clickable card list. */
  items?: WorkbenchSignalItemRef[];
};

/**
 * Actor-scoped "today schedule" projection for the 今日日程 card (Phase A0).
 * Absent/null → the card falls back to the legacy `cronLabel + sessionCount`.
 */
export type WorkbenchScheduleSummary = {
  /** Items starting within the next 24h (rolling). */
  todayCount: number;
  /** Items within the upcoming window (now .. now+window), including ongoing. */
  upcomingCount: number;
  /** Subset that are synthetic cron-derived (double-track). */
  cronDerivedCount: number;
  /** Earliest upcoming start (ms), if any. */
  nextStartAtMs?: number;
  /** Title of the earliest upcoming item, if any. */
  nextTitle?: string;
  /** Whether any REAL (stored, non-cron-derived) item is present. */
  hasRealEntries: boolean;
  /** Upcoming items (for the manage UI); cron-derived ones are read-only. */
  items?: WorkbenchScheduleItemView[];
};

/** A single upcoming schedule item for the manual manage UI (Phase A1). */
export type WorkbenchScheduleItemView = {
  id: string;
  title: string;
  startAtMs: number;
  kind: string;
  /** Synthetic cron-derived item — surfaced read-only (cannot be cancelled here). */
  cronDerived: boolean;
};

/**
 * Single steward (大白) suggestion line for the employee home (M4). The text is
 * produced server-side (deterministic template, or — M4b — a gated LLM refine),
 * so the bar renders it as-is rather than re-localizing UI-side.
 */
export type WorkbenchStewardSuggestionSummary = {
  /** Final suggestion text (server-produced). */
  text: string;
  /** Which signal drove it (reserved for future iconography). */
  kind: string;
  /** template (deterministic) vs llm (gated refine). */
  source: "template" | "llm";
};

export type WorkbenchSignalCard = {
  key: WorkbenchSignalCardKey;
  title: string;
  subtitle: string;
  items: string[];
  /**
   * Auto-extracted clickable item refs rendered as the card body list. When
   * present (non-empty) the surface shows this scrollable list instead of the
   * generic primary/secondary summary lines.
   */
  entries?: WorkbenchSignalItemRef[];
  badgeCount?: number;
  actionLabel: string;
  actionId: WorkbenchSignalActionId;
};

export type WorkbenchSignalBundle = {
  cards: WorkbenchSignalCard[];
  /**
   * Single steward suggestion line shown above the cards (M4). Null/absent →
   * the bar hides itself (nothing worth surfacing, or no actor).
   */
  stewardSuggestion?: WorkbenchStewardSuggestionSummary | null;
};

export type WorkbenchSignalBundleInput = {
  cronLabel: string;
  sessionCount: number;
  contactsCount: number;
  agentsCount: number;
  groupsCount: number;
  activeAccounts: number;
  onlineInstances: number;
  connected: boolean;
  lastError: string | null;
  /** 新用户 / 空工作台：展示入门态摘要，而非全局运营数据。 */
  freshSurface?: boolean;
  /**
   * Real pending-work counts (task-assignments + 待治理 deliverables + 待确认
   * invites). Merged into the todos card when present.
   */
  pendingTasks?: WorkbenchPendingTasksSummary | null;
  /**
   * Notices projection — only meeting-invite / minutes kinds fold into todos;
   * governance counts feed the steward suggestion path, not a home card.
   */
  notices?: WorkbenchNoticesSummary | null;
  /**
   * Collaboration operating-state projection. Merged into the todos card.
   */
  upcomingCollaboration?: WorkbenchUpcomingCollaborationSummary | null;
  /**
   * Actor-scoped schedule projection (Phase A0). When present (and it has any
   * upcoming item), the 今日日程 card surfaces the server-authoritative schedule
   * instead of the front-end `cronNext` proxy.
   */
  schedule?: WorkbenchScheduleSummary | null;
  /**
   * Pre-formatted relative label for the schedule's next item (computed UI-side
   * from `schedule.nextStartAtMs`).
   */
  scheduleNextLabel?: string | null;
  /**
   * Single steward (大白) suggestion derived from the M1/M2/M3 signals (M4).
   * When present, a suggestion bar renders above the two cards; null → hidden.
   */
  stewardSuggestion?: WorkbenchStewardSuggestionSummary | null;
};

/** Compact clock / relative-ish label for schedule rows (not full locale datetime). */
export function formatScheduleEntryMeta(startAtMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(startAtMs)) {
    return "";
  }
  try {
    const start = new Date(startAtMs);
    const time = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const nowDay = new Date(nowMs);
    const today = new Date(nowDay.getFullYear(), nowDay.getMonth(), nowDay.getDate()).getTime();
    const dayDelta = Math.round((startDay - today) / 86_400_000);
    if (dayDelta === 0) {
      return time;
    }
    if (dayDelta === 1) {
      return i18n.getLocale() === "zh-CN" ? `明天 ${time}` : `Tomorrow ${time}`;
    }
    if (dayDelta === -1) {
      return i18n.getLocale() === "zh-CN" ? `昨天 ${time}` : `Yesterday ${time}`;
    }
    const date = start.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    return `${date} ${time}`;
  } catch {
    return "";
  }
}

const MEETING_NOTICE_KINDS: ReadonlySet<WorkbenchNoticeKindRef> = new Set([
  "meeting-invite-review",
  "meeting-minutes-confirm",
]);

const KNOWLEDGE_NOTICE_KINDS: ReadonlySet<WorkbenchNoticeKindRef> = new Set([
  "governance-conflict",
  "governance-attention",
]);

const NOTICE_KIND_I18N_KEY: Record<WorkbenchNoticeKindRef, string> = {
  "governance-conflict": "frontstage.workbench.cards.noticeKind.governanceConflict",
  "governance-attention": "frontstage.workbench.cards.noticeKind.governanceAttention",
  "meeting-invite-review": "frontstage.workbench.cards.noticeKind.meetingInviteReview",
  "meeting-minutes-confirm": "frontstage.workbench.cards.noticeKind.meetingMinutesConfirm",
};

const NOTICE_KIND_FALLBACK_LABELS: Record<
  "en" | "zh-CN",
  Record<WorkbenchNoticeKindRef, string>
> = {
  en: {
    "governance-conflict": "{count} knowledge conflicts to resolve",
    "governance-attention": "{count} knowledge items to review",
    "meeting-invite-review": "Meeting invites to review",
    "meeting-minutes-confirm": "Minutes to confirm",
  },
  "zh-CN": {
    "governance-conflict": "知识库有 {count} 处冲突待解决",
    "governance-attention": "知识库有 {count} 处待关注",
    "meeting-invite-review": "会议邀请待审核",
    "meeting-minutes-confirm": "纪要待确认",
  },
};

function applyCountTemplate(template: string, count: number): string {
  return template.replaceAll("{count}", String(count));
}

function resolveNoticeEntryTitle(kind: WorkbenchNoticeKindRef, count = 1): string {
  const key = NOTICE_KIND_I18N_KEY[kind];
  const translated = t(key, { count: String(count) });
  if (translated !== key) {
    return translated;
  }
  const table =
    i18n.getLocale() === "zh-CN"
      ? NOTICE_KIND_FALLBACK_LABELS["zh-CN"]
      : NOTICE_KIND_FALLBACK_LABELS.en;
  return applyCountTemplate(table[kind], count);
}

function meetingNoticeEntries(
  notices: WorkbenchNoticesSummary | null | undefined,
): WorkbenchSignalItemRef[] {
  if (!notices?.items?.length) {
    return [];
  }
  return notices.items
    .filter((item) => MEETING_NOTICE_KINDS.has(item.kind))
    .map((item) => ({
      id: item.id,
      title: resolveNoticeEntryTitle(item.kind),
      meta: item.count > 1 ? String(item.count) : undefined,
      origin: "meeting-notice" as const,
    }));
}

function knowledgeNoticeEntries(
  notices: WorkbenchNoticesSummary | null | undefined,
): WorkbenchSignalItemRef[] {
  if (!notices?.items?.length) {
    return [];
  }
  return notices.items
    .filter((item) => KNOWLEDGE_NOTICE_KINDS.has(item.kind))
    .map((item) => ({
      id: item.id,
      title: resolveNoticeEntryTitle(item.kind, item.count),
      origin: "knowledge" as const,
    }));
}

function knowledgeNoticeCount(notices: WorkbenchNoticesSummary | null | undefined): number {
  return (notices?.conflictCount ?? 0) + (notices?.attentionCount ?? 0);
}

function buildTodosEntries(
  input: WorkbenchSignalBundleInput,
): WorkbenchSignalItemRef[] | undefined {
  const taskEntries = (input.pendingTasks?.items ?? []).map((item) => ({
    ...item,
    origin: "task" as const,
  }));
  const collabEntries = (input.upcomingCollaboration?.items ?? []).map((item) => ({
    ...item,
    origin: "collaboration" as const,
  }));
  const foldedMeetingNotices = meetingNoticeEntries(input.notices);
  const foldedKnowledgeNotices = knowledgeNoticeEntries(input.notices);
  const merged = [
    ...taskEntries,
    ...collabEntries,
    ...foldedMeetingNotices,
    ...foldedKnowledgeNotices,
  ];
  return merged.length > 0 ? merged : undefined;
}

function buildTodosBadge(input: WorkbenchSignalBundleInput): number {
  const pending = input.pendingTasks?.totalCount ?? 0;
  const collab = input.upcomingCollaboration?.needsResponseCount ?? 0;
  const meetingReview =
    (input.notices?.meetingInviteReviewCount ?? 0) +
    (input.notices?.meetingMinutesConfirmCount ?? 0);
  const knowledge = knowledgeNoticeCount(input.notices);
  if (input.pendingTasks || input.upcomingCollaboration || input.notices) {
    return pending + collab + meetingReview + knowledge;
  }
  // Proxy fallback when no real projections are loaded yet.
  return input.contactsCount + input.groupsCount;
}

function buildTodosCopy(input: WorkbenchSignalBundleInput): { primary: string; secondary: string } {
  const pending = input.pendingTasks;
  const collab = input.upcomingCollaboration;
  const meetingReview =
    (input.notices?.meetingInviteReviewCount ?? 0) +
    (input.notices?.meetingMinutesConfirmCount ?? 0);
  const knowledge = knowledgeNoticeCount(input.notices);
  const total = buildTodosBadge(input);

  if (pending || collab || meetingReview > 0 || knowledge > 0) {
    return {
      primary: t("frontstage.workbench.cards.todosPrimary", { count: String(total) }),
      secondary: t("frontstage.workbench.cards.todosSecondary", {
        task: String(pending?.taskCount ?? 0),
        collab: String(collab?.needsResponseCount ?? 0),
        meeting: String(meetingReview),
      }),
    };
  }

  return {
    primary: t("frontstage.workbench.cards.todosProxyPrimary", {
      count: String(input.contactsCount),
    }),
    secondary: t("frontstage.workbench.cards.todosProxySecondary", {
      count: String(input.groupsCount),
    }),
  };
}

function hasActionableWorkbenchSignals(input: WorkbenchSignalBundleInput): boolean {
  const pending = input.pendingTasks?.totalCount ?? 0;
  const collab = input.upcomingCollaboration?.needsResponseCount ?? 0;
  const meetingReview =
    (input.notices?.meetingInviteReviewCount ?? 0) +
    (input.notices?.meetingMinutesConfirmCount ?? 0);
  const knowledge = knowledgeNoticeCount(input.notices);
  return pending > 0 || collab > 0 || meetingReview > 0 || knowledge > 0;
}

export function buildWorkbenchSignalBundle(
  input: WorkbenchSignalBundleInput,
): WorkbenchSignalBundle {
  // Fresh-surface placeholders must not hide real invites / todos once the
  // pending-work projection has items (e.g. collaboration invites).
  if (input.freshSurface && !hasActionableWorkbenchSignals(input)) {
    return {
      cards: [
        {
          key: "schedule",
          title: t("frontstage.workbench.cards.scheduleTitle"),
          subtitle: t("frontstage.workbench.cards.scheduleSubtitle"),
          items: [
            t("frontstage.workbench.cards.freshSchedulePrimary"),
            t("frontstage.workbench.cards.freshScheduleSecondary"),
          ],
          badgeCount: 0,
          actionLabel: t("frontstage.workbench.cards.openCron"),
          actionId: "openCron",
        },
        {
          key: "todos",
          title: t("frontstage.workbench.cards.todosTitle"),
          subtitle: t("frontstage.workbench.cards.todosSubtitle"),
          items: [
            t("frontstage.workbench.cards.freshTodosPrimary"),
            t("frontstage.workbench.cards.freshTodosSecondary"),
          ],
          badgeCount: 0,
          actionLabel: t("frontstage.workbench.cards.openTodos"),
          actionId: "openTodos",
        },
      ],
      stewardSuggestion: null,
    };
  }

  const hasRealSchedule = Boolean(
    input.schedule && (input.schedule.upcomingCount > 0 || input.schedule.nextStartAtMs != null),
  );
  const rawScheduleValue =
    hasRealSchedule && input.scheduleNextLabel ? input.scheduleNextLabel : input.cronLabel;
  const scheduleValue = sanitizeSignalLabel(rawScheduleValue);
  const scheduleSecondaryCount = hasRealSchedule
    ? (input.schedule?.upcomingCount ?? 0)
    : input.sessionCount;
  const scheduleEntries =
    hasRealSchedule && input.schedule?.items?.length
      ? input.schedule.items.map((item) => {
          const meta = formatScheduleEntryMeta(item.startAtMs);
          return {
            id: item.id,
            title: item.title,
            ...(meta ? { meta } : {}),
          };
        })
      : undefined;

  const todosCopy = buildTodosCopy(input);
  const todosEntries = buildTodosEntries(input);

  return {
    cards: [
      {
        key: "schedule",
        title: t("frontstage.workbench.cards.scheduleTitle"),
        subtitle: t("frontstage.workbench.cards.scheduleSubtitle"),
        items: [
          t("frontstage.workbench.cards.schedulePrimary", { value: scheduleValue }),
          t("frontstage.workbench.cards.scheduleSecondary", {
            count: String(scheduleSecondaryCount),
          }),
        ],
        badgeCount: hasRealSchedule ? (input.schedule?.upcomingCount ?? 0) : input.sessionCount,
        ...(scheduleEntries?.length ? { entries: scheduleEntries } : {}),
        actionLabel: t("frontstage.workbench.cards.openCron"),
        actionId: "openCron",
      },
      {
        key: "todos",
        title: t("frontstage.workbench.cards.todosTitle"),
        subtitle: t("frontstage.workbench.cards.todosSubtitle"),
        items: [todosCopy.primary, todosCopy.secondary],
        badgeCount: buildTodosBadge(input),
        ...(todosEntries?.length ? { entries: todosEntries } : {}),
        actionLabel: t("frontstage.workbench.cards.openTodos"),
        actionId: "openTodos",
      },
    ],
    stewardSuggestion: input.stewardSuggestion ?? null,
  };
}

const SCHEDULE_SOON_WINDOW_MS = 60 * 60_000;
const SCHEDULE_PAST_GRACE_MS = 15 * 60_000;

export type WorkbenchSignalsNextUp =
  | {
      kind: "schedule";
      cardKey: "schedule";
      entryId: string;
      title: string;
      meta: string;
    }
  | {
      kind: "todos";
      cardKey: "todos";
      entryId: string;
      title: string;
    }
  | { kind: "idle" };

export type PartitionedScheduleItems = {
  upcoming: WorkbenchScheduleItemView[];
  past: WorkbenchScheduleItemView[];
};

/** Split schedule rows into upcoming (incl. in-progress) vs past; each bucket sorted by time. */
export function partitionAndSortScheduleItems(
  items: WorkbenchScheduleItemView[],
  nowMs: number = Date.now(),
): PartitionedScheduleItems {
  const pastCutoff = nowMs - SCHEDULE_PAST_GRACE_MS;
  const upcoming: WorkbenchScheduleItemView[] = [];
  const past: WorkbenchScheduleItemView[] = [];
  for (const item of items) {
    if (item.startAtMs < pastCutoff) {
      past.push(item);
    } else {
      upcoming.push(item);
    }
  }
  const sortUpcoming = (a: WorkbenchScheduleItemView, b: WorkbenchScheduleItemView) => {
    const aLive = a.startAtMs <= nowMs;
    const bLive = b.startAtMs <= nowMs;
    if (aLive !== bLive) {
      return aLive ? -1 : 1;
    }
    return a.startAtMs - b.startAtMs;
  };
  upcoming.sort(sortUpcoming);
  past.sort((a, b) => a.startAtMs - b.startAtMs);
  return { upcoming, past };
}

function todosUrgencyRank(entry: WorkbenchSignalItemRef): number {
  if (entry.origin === "meeting-notice") {
    return 0;
  }
  if (entry.origin === "knowledge") {
    return 1;
  }
  if (entry.origin === "task") {
    const id = entry.id.toLowerCase();
    if (id.startsWith("governance:")) {
      return 2;
    }
    if (id.startsWith("invite:") || id.includes("ack") || id.startsWith("ledger-gate:")) {
      return 3;
    }
    return 4;
  }
  if (entry.origin === "collaboration") {
    return 5;
  }
  return 6;
}

/** Urgency-ordered todos queue (meeting → governance/ack → task → collaboration). */
export function sortTodosEntriesByUrgency(
  entries: WorkbenchSignalItemRef[],
): WorkbenchSignalItemRef[] {
  return [...entries].toSorted((a, b) => {
    const rankDelta = todosUrgencyRank(a) - todosUrgencyRank(b);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    const metaA = a.meta?.trim() ? 1 : 0;
    const metaB = b.meta?.trim() ? 1 : 0;
    if (metaA !== metaB) {
      return metaB - metaA;
    }
    return 0;
  });
}

function pickSoonScheduleItem(
  items: WorkbenchScheduleItemView[],
  nowMs: number,
): WorkbenchScheduleItemView | null {
  const pastGrace = nowMs - SCHEDULE_PAST_GRACE_MS;
  const soonEnd = nowMs + SCHEDULE_SOON_WINDOW_MS;
  const eligible = items.filter(
    (item) => item.startAtMs >= pastGrace && (item.startAtMs <= nowMs || item.startAtMs <= soonEnd),
  );
  if (eligible.length === 0) {
    return null;
  }
  eligible.sort((a, b) => {
    const aLive = a.startAtMs <= nowMs;
    const bLive = b.startAtMs <= nowMs;
    if (aLive !== bLive) {
      return aLive ? -1 : 1;
    }
    return a.startAtMs - b.startAtMs;
  });
  return eligible[0] ?? null;
}

/** Pick the single home-strip "next up" row (schedule within 60m wins over todos). */
export function resolveWorkbenchSignalsNextUp(params: {
  scheduleItems: WorkbenchScheduleItemView[];
  todosEntries: WorkbenchSignalItemRef[];
  todosBadgeCount: number;
  nowMs?: number;
}): WorkbenchSignalsNextUp {
  const nowMs = params.nowMs ?? Date.now();
  const soon = pickSoonScheduleItem(params.scheduleItems, nowMs);
  if (soon) {
    return {
      kind: "schedule",
      cardKey: "schedule",
      entryId: soon.id,
      title: soon.title,
      meta: formatScheduleEntryMeta(soon.startAtMs, nowMs),
    };
  }
  const sortedTodos = sortTodosEntriesByUrgency(params.todosEntries);
  if (params.todosBadgeCount > 0 && sortedTodos[0]) {
    return {
      kind: "todos",
      cardKey: "todos",
      entryId: sortedTodos[0].id,
      title: sortedTodos[0].title,
    };
  }
  return { kind: "idle" };
}

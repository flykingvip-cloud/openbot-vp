import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import {
  acknowledgeHumanMentionNotification,
  listHumanMentionNotifications,
} from "../../organization/human-mention-notifications.js";
import { readOrganizerMeetings } from "../../organization/meeting-store.js";
import { readUserScheduleEntries } from "../../organization/schedule-store.js";
import { confirmTenantHumanNotice } from "../../organization/tenant-human-notice.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  countOrganizerMeetingTodoItems,
  listOrganizerMeetingTodoItems,
} from "../workbench/meeting-todo-projection.js";
import { buildWorkbenchMyTasks } from "../workbench/my-tasks-read-model.js";
import { buildWorkbenchNotices } from "../workbench/notices-read-model.js";
import { buildWorkbenchPendingTasks } from "../workbench/pending-tasks-read-model.js";
import { buildWorkbenchSchedule } from "../workbench/schedule-read-model.js";
import { buildWorkbenchStewardSuggestion } from "../workbench/steward-suggestion-read-model.js";
import { buildWorkbenchUpcomingCollaboration } from "../workbench/upcoming-collaboration-read-model.js";
import { getUserGovernanceSummary } from "./knowledge-governance.js";
import type { GatewayRequestHandlers } from "./types.js";

const EMPTY_PENDING_TASKS = {
  totalCount: 0,
  taskCount: 0,
  ackRequiredCount: 0,
  personalTaskCount: 0,
  spaceTaskCount: 0,
  governanceCount: 0,
  inviteCount: 0,
  mentionCount: 0,
  humanGateCount: 0,
  items: [],
};

const EMPTY_MY_TASKS = {
  totalCount: 0,
  cronCount: 0,
  supervisedCount: 0,
  assignedCount: 0,
  cronJobs: [],
  supervisedTasks: [],
  assignedTasks: [],
};

const EMPTY_NOTICES = {
  totalCount: 0,
  conflictCount: 0,
  attentionCount: 0,
  meetingInviteReviewCount: 0,
  meetingMinutesConfirmCount: 0,
  meetingTodoItems: [],
  items: [],
};

const EMPTY_UPCOMING_COLLABORATION = {
  needsResponseCount: 0,
  decisionCount: 0,
  reviewCount: 0,
  activeCount: 0,
  items: [],
};

const EMPTY_SCHEDULE = {
  todayCount: 0,
  upcomingCount: 0,
  cronDerivedCount: 0,
  hasRealEntries: false,
  items: [],
};

const EMPTY_STEWARD_SUGGESTION = {
  suggestion: null,
  signature: "",
  fromCache: false,
  llmUsed: false,
};

export const workbenchHandlers: GatewayRequestHandlers = {
  /**
   * Unified personal "我的任务" summary across cron / supervised / assigned lanes.
   * Scoped to the resolved employee actor — no actor → empty (never install-wide).
   * Per-lane mutate RPCs remain authoritative for writes; this is a thin read model.
   */
  "workbench.my-tasks.list": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, EMPTY_MY_TASKS);
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const limit = typeof record.limit === "number" ? record.limit : undefined;
    try {
      const result = await buildWorkbenchMyTasks({
        userId: actor.userId,
        userEmail: actor.userEmail,
        ...(actor.tenantId !== undefined ? { tenantId: actor.tenantId } : {}),
        seatSpaceIds: actor.seatSpaceIds,
        ...(limit !== undefined ? { limit } : {}),
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list my tasks";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * Deterministic "pending work" projection for the employee home 待处理任务 card
   * (M1). Scoped to the resolved employee actor: a session that cannot resolve an
   * actor (or a brand-new member with no spaces/assets) gets an empty result —
   * never the unscoped, install-wide view.
   */
  "workbench.pending-tasks.list": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, EMPTY_PENDING_TASKS);
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const limit = typeof record.limit === "number" ? record.limit : undefined;
    // Exclude the universal builtin steward (id collides with the legacy `main`
    // agent) so a member never sees other users' steward-attributed governance.
    const visibleAgentIds = actor.seatAgentIds.filter((id) => !isBuiltinStewardAgent(id));
    try {
      const result = await buildWorkbenchPendingTasks({
        userId: actor.userId,
        userEmail: actor.userEmail,
        tenantId: actor.tenantId,
        seatSpaceIds: actor.seatSpaceIds,
        visibleAgentIds,
        ...(limit !== undefined ? { limit } : {}),
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list pending tasks";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * Deterministic "system notices" projection for the employee home 重要通知 card
   * (M2, "底座 A" read-model). Scoped to the resolved employee actor: a session
   * that cannot resolve an actor gets an empty result — never an unscoped view.
   *
   * Sources the employee-SAFE maintenance signal only: the actor's user-scoped
   * knowledge governance summary (same per-user index path as
   * `knowledge.governance.summary`). Install-global signals (channel
   * connectivity, install-wide health probes) and enterprise-admin/financial
   * signals (billing / quota) are intentionally excluded here — see
   * `buildWorkbenchNotices` for the scope rationale. Live connection health is
   * surfaced client-side from the websocket, not this read-model.
   */
  "workbench.notices.list": async ({ respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, EMPTY_NOTICES);
      return;
    }
    try {
      let governance = null;
      try {
        // Reuse the exact user-scoped knowledge-index path so the data matches
        // `knowledge.governance.summary` byte-for-byte; a missing/not-yet-built
        // index simply yields empty notices instead of an error.
        governance = await getUserGovernanceSummary(client);
      } catch {
        governance = null;
      }
      // Meeting-derived review items (Phase B3/C2): draft + pending_approval fold
      // into 待办事项; minuted → minutes confirm. Additive — never alters governance.
      let inviteReviewCount = 0;
      let minutesConfirmCount = 0;
      let meetingTodoItems: ReturnType<typeof listOrganizerMeetingTodoItems> = [];
      try {
        const meetings = await readOrganizerMeetings(actor.userId);
        meetingTodoItems = listOrganizerMeetingTodoItems(meetings);
        inviteReviewCount = countOrganizerMeetingTodoItems(meetings);
        minutesConfirmCount = meetings.filter((meeting) => meeting.status === "minuted").length;
      } catch {
        inviteReviewCount = 0;
        minutesConfirmCount = 0;
        meetingTodoItems = [];
      }
      respond(
        true,
        buildWorkbenchNotices({
          governance,
          meetings: { inviteReviewCount, minutesConfirmCount, todoItems: meetingTodoItems },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list notices";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * Deterministic "upcoming collaboration" projection for the employee home
   * 即将协作 card (M3). Scoped to the resolved employee actor: a session that
   * cannot resolve an actor gets an empty result — never an unscoped view.
   *
   * Surfaces collaboration spaces in the actor's scope (seat-granted or active
   * human membership) whose operating-state is waiting for a human response,
   * categorized by phase (decide → decision, review → review, else → response).
   */
  "workbench.upcoming-collaboration.list": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, EMPTY_UPCOMING_COLLABORATION);
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const limit = typeof record.limit === "number" ? record.limit : undefined;
    try {
      const result = await buildWorkbenchUpcomingCollaboration({
        userId: actor.userId,
        userEmail: actor.userEmail,
        seatSpaceIds: actor.seatSpaceIds,
        ...(limit !== undefined ? { limit } : {}),
      });
      respond(true, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to list upcoming collaboration";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * Deterministic "today schedule" projection for the employee home 今日日程 card
   * (Phase A0 "正名"). Scoped to the resolved employee actor: a session that
   * cannot resolve an actor gets an empty result — never an unscoped view.
   *
   * Merges real ScheduleEntries (Phase A1 store seam, empty by default) with the
   * actor's own cron jobs projected as `cron-derived` entries — the server-side,
   * actor-scoped replacement for the global front-end `cronNext`. The builtin
   * steward is excluded from the visible-agent scope so a member never inherits
   * the universal steward's cron as their own schedule (mirrors pending-tasks).
   */
  "workbench.schedule.list": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, EMPTY_SCHEDULE);
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const limit = typeof record.limit === "number" ? record.limit : undefined;
    const visibleAgentIds = actor.seatAgentIds.filter((id) => !isBuiltinStewardAgent(id));
    try {
      const result = await buildWorkbenchSchedule({
        userId: actor.userId,
        userEmail: actor.userEmail,
        ...(actor.tenantId !== undefined ? { tenantId: actor.tenantId } : {}),
        visibleAgentIds,
        ...(limit !== undefined ? { limit } : {}),
        timeZone:
          typeof record.timeZone === "string" && record.timeZone.trim()
            ? record.timeZone.trim()
            : "UTC",
        // Phase A1: back the read model with the per-user schedule store (scoped
        // to the resolved actor); the cron-derived track stays as the default.
        deps: { listEntries: ({ userId }) => readUserScheduleEntries(userId) },
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list schedule";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * Single steward (大白) suggestion for the employee home (M4). Aggregates the
   * three deterministic signal read-models (M1 pending / M2 notices / M3 upcoming
   * collaboration) — all already actor-scoped — into one short "what to look at
   * first" line. Scoped to the resolved employee actor: no actor → empty.
   *
   * M4a wires the DETERMINISTIC path only (template + signature dedup/cache, zero
   * tokens). The gated LLM refine seam (`generateSuggestionText`) is intentionally
   * NOT passed here yet; M4b adds it (enterprise-only, throttled, gate-enforced).
   * Each source degrades independently so a single failing read-model never takes
   * down the (additive, non-critical) suggestion bar.
   */
  "workbench.steward-suggestion.get": async ({ respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, EMPTY_STEWARD_SUGGESTION);
      return;
    }
    try {
      // Mirror the pending-tasks handler: hide the universal builtin steward so a
      // member never sees other users' steward-attributed governance.
      const visibleAgentIds = actor.seatAgentIds.filter((id) => !isBuiltinStewardAgent(id));
      const pending = await buildWorkbenchPendingTasks({
        userId: actor.userId,
        userEmail: actor.userEmail,
        tenantId: actor.tenantId,
        seatSpaceIds: actor.seatSpaceIds,
        visibleAgentIds,
      }).catch(() => EMPTY_PENDING_TASKS);
      const upcoming = await buildWorkbenchUpcomingCollaboration({
        userId: actor.userId,
        userEmail: actor.userEmail,
        seatSpaceIds: actor.seatSpaceIds,
      }).catch(() => EMPTY_UPCOMING_COLLABORATION);
      let governance = null;
      try {
        governance = await getUserGovernanceSummary(client);
      } catch {
        governance = null;
      }
      const notices = buildWorkbenchNotices({ governance });

      const result = await buildWorkbenchStewardSuggestion({
        actorKey: actor.userId,
        signals: { pending, notices, upcoming },
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to build steward suggestion";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * List human @mention notifications for the current employee actor only.
   * Never returns another user's inbox entries.
   */
  "workbench.humanMentions.list": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor?.tenantId) {
      respond(true, { items: [], unreadCount: 0 });
      return;
    }
    try {
      const unreadOnly = params && typeof params === "object" && params.unreadOnly === true;
      const items = await listHumanMentionNotifications({
        tenantId: actor.tenantId,
        targetUserId: actor.userId,
        unreadOnly,
      });
      respond(true, {
        items,
        unreadCount: items.filter((item) => !item.readAt && !item.acknowledgedAt).length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list human mentions";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * Acknowledge a human @mention notification. Only the target user may ack.
   */
  "workbench.humanMentions.ack": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor?.tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
      return;
    }
    const mentionId =
      params && typeof params === "object" && typeof params.mentionId === "string"
        ? params.mentionId.trim()
        : "";
    if (!mentionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "mentionId required"));
      return;
    }
    try {
      const updated = await acknowledgeHumanMentionNotification({
        tenantId: actor.tenantId,
        targetUserId: actor.userId,
        mentionId,
      });
      if (!updated) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "mention not found"));
        return;
      }
      respond(true, { notification: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to ack human mention";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  /**
   * Recipient confirms a directed tenant notice from 待办事项.
   * Confirmation writes a receipt back into the sender's current conversation session.
   */
  "workbench.tenantNotices.ack": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor?.tenantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
      return;
    }
    const noticeId =
      params && typeof params === "object" && typeof params.noticeId === "string"
        ? params.noticeId.trim()
        : "";
    if (!noticeId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "noticeId required"));
      return;
    }
    try {
      const notice = await confirmTenantHumanNotice({
        tenantId: actor.tenantId,
        recipientUserId: actor.userId,
        noticeId,
      });
      if (!notice) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "notice not found"));
        return;
      }
      respond(true, { notice, receiptDelivered: notice.receiptDelivered === true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to confirm notice";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};

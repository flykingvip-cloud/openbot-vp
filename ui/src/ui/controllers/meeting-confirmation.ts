import type {
  Meeting,
  MeetingConfirmationDetail,
  MeetingConfirmationEnvelope,
} from "../capability/meeting-lifecycle/endpoints.ts";
import { createMeetingLifecycleGateway } from "../capability/meeting-lifecycle/gateway-client.ts";
import { GatewayRequestError, type GatewayBrowserClient } from "../gateway.ts";
import {
  formatOrganizerMeetingNotice,
  organizerMeetingLinkPending,
} from "../ports/employee/views/meeting-notice-text.ts";
import type { WorkbenchNoticesSummary } from "../ports/employee/views/workbench-signals.ts";
import type { WorkbenchSpacesLoadState } from "./spaces.ts";

export type MeetingPendingConfirmation = {
  meeting: Meeting;
  confirmation: MeetingConfirmationEnvelope;
  confirmationDetail?: MeetingConfirmationDetail;
  message: string;
};

/** In-thread epilogue while / after pause-release confirm (not a terminal task end). */
export type MeetingConfirmRelease = {
  meetingId: string;
  title: string;
  phase: "releasing" | "released" | "partial";
  progressMessage: string;
  resultMessage?: string;
  scheduleComplete?: boolean;
  deliveredCount?: number;
  failedCount?: number;
  /** Same notice the organizer confirmed, kept on the bubble after the click. */
  noticeText?: string;
};

export type MeetingConfirmResumeContinuation = {
  kind: "meeting_confirm_release";
  meetingId: string;
  title: string;
  status: "confirmed";
  scheduleComplete: boolean;
  scheduledCount: number;
  deliveredCount?: number;
  failedCount?: number;
  userMessage: string;
  epilogueProgressMessage: string;
  epilogueResultMessage: string;
};

export type MeetingConfirmationState = WorkbenchSpacesLoadState & {
  meetingPendingConfirmation?: MeetingPendingConfirmation | null;
  meetingConfirmationLoading?: boolean;
  meetingConfirmationError?: string | null;
  /** Previous ticket was expired or rejected. The card must not keep offering that authorization. */
  meetingConfirmationOldCardInvalid?: boolean;
  /**
   * Hard provision_required / no-joinUrl block fingerprint (`id:updatedAt`).
   * While this matches the current pending set, skip re-calling meeting.approve
   * on WORKBENCH_SIGNALS_REFRESH (~45s). Cleared when notices clear or meeting updates.
   */
  meetingConfirmationApproveBlockKey?: string | null;
  /** True when last confirm succeeded but fan-out was incomplete. */
  meetingScheduleReplayNeeded?: boolean;
  /** Meeting id for manual replay when fan-out was partial. */
  meetingScheduleReplayMeetingId?: string | null;
  /** Visible pause-release progress after confirm (card may leave pending). */
  meetingConfirmRelease?: MeetingConfirmRelease | null;
  /**
   * Host wake hook: after steward-ticket confirm succeeds, resume the same
   * conversation task (typically chat.send). Must not receive tokens.
   */
  resumeMeetingConfirmConversation?: (
    continuation: MeetingConfirmResumeContinuation,
  ) => void | Promise<void>;
};

function pendingReviewCount(notices: WorkbenchNoticesSummary | null | undefined): number {
  return notices?.meetingInviteReviewCount ?? 0;
}

function shouldRefreshPendingTicket(
  current: MeetingPendingConfirmation | null | undefined,
  meeting: Meeting,
): boolean {
  if (!current || current.meeting.id !== meeting.id) {
    return true;
  }
  return current.meeting.updatedAt !== meeting.updatedAt;
}

/** Default Chinese copy when online meeting cannot issue a confirm ticket. */
export const MEETING_PROVISION_REQUIRED_MESSAGE =
  "线上会议尚未开通或缺少入会链接；请先完成开通后再确认发送。";

/**
 * UI-facing error text: drop `GatewayRequestError:` (and similar) prefixes so
 * the steward card shows only the Chinese business message.
 */
export function formatMeetingConfirmationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const cleaned = raw.replace(/^GatewayRequestError:\s*/i, "").trim();
  return cleaned || MEETING_PROVISION_REQUIRED_MESSAGE;
}

function readProvisionFailureCode(err: unknown): "provision_required" | "provision_failed" | null {
  if (!(err instanceof GatewayRequestError)) {
    return null;
  }
  const details = err.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const code = (details as { code?: unknown }).code;
  if (code === "provision_required" || code === "provision_failed") {
    return code;
  }
  return null;
}

export function isHardMeetingProvisionFailure(err: unknown): boolean {
  if (readProvisionFailureCode(err)) {
    return true;
  }
  const msg = formatMeetingConfirmationError(err);
  return msg.includes("尚未开通") || msg.includes("缺少入会链接") || msg.includes("开通失败");
}

function meetingApproveBlockKey(
  meeting: Pick<Meeting, "id"> & { updatedAt?: string | number },
): string {
  return `${meeting.id}:${String(meeting.updatedAt ?? "")}`;
}

function asResumeContinuation(raw: unknown): MeetingConfirmResumeContinuation | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.kind !== "meeting_confirm_release") {
    return null;
  }
  const meetingId = typeof record.meetingId === "string" ? record.meetingId.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const userMessage = typeof record.userMessage === "string" ? record.userMessage.trim() : "";
  const epilogueProgressMessage =
    typeof record.epilogueProgressMessage === "string" ? record.epilogueProgressMessage.trim() : "";
  const epilogueResultMessage =
    typeof record.epilogueResultMessage === "string" ? record.epilogueResultMessage.trim() : "";
  if (!meetingId || !userMessage || !epilogueProgressMessage || !epilogueResultMessage) {
    return null;
  }
  return {
    kind: "meeting_confirm_release",
    meetingId,
    title: title || "会议",
    status: "confirmed",
    scheduleComplete: record.scheduleComplete === true,
    scheduledCount: typeof record.scheduledCount === "number" ? record.scheduledCount : 0,
    ...(typeof record.deliveredCount === "number" ? { deliveredCount: record.deliveredCount } : {}),
    ...(typeof record.failedCount === "number" ? { failedCount: record.failedCount } : {}),
    userMessage,
    epilogueProgressMessage,
    epilogueResultMessage,
  };
}

function fallbackResumeContinuation(params: {
  meetingId: string;
  title: string;
  scheduleComplete: boolean;
  scheduledCount: number;
  deliveredCount?: number;
  failedCount?: number;
}): MeetingConfirmResumeContinuation {
  const title = params.title.trim() || "会议";
  const deliveryBits: string[] = [];
  if (typeof params.deliveredCount === "number") {
    deliveryBits.push(`已投递 ${params.deliveredCount}`);
  }
  if (typeof params.failedCount === "number" && params.failedCount > 0) {
    deliveryBits.push(`失败 ${params.failedCount}`);
  }
  const scheduleBit = params.scheduleComplete
    ? "发起人日程已写入"
    : "发起人日程写入未完成（可重试）";
  const deliveryBit = deliveryBits.length > 0 ? `；投递：${deliveryBits.join("，")}` : "";
  return {
    kind: "meeting_confirm_release",
    meetingId: params.meetingId,
    title,
    status: "confirmed",
    scheduleComplete: params.scheduleComplete,
    scheduledCount: params.scheduledCount,
    ...(typeof params.deliveredCount === "number" ? { deliveredCount: params.deliveredCount } : {}),
    ...(typeof params.failedCount === "number" ? { failedCount: params.failedCount } : {}),
    userMessage: [
      `我已确认发送会议「${title}」。`,
      `状态=confirmed；${scheduleBit}${deliveryBit}。`,
      "请向我汇报发送与日程结果，并给出下一步建议。",
    ].join(" "),
    epilogueProgressMessage: "已确认，正在发送邀请并写入日程…",
    epilogueResultMessage: `已确认发送「${title}」。${scheduleBit}${deliveryBit}。`,
  };
}

/**
 * After signals refresh: if the organizer has a meeting awaiting approval, fetch a
 * server-issued confirmation ticket (token stays in UI state only).
 */
export async function syncMeetingPendingConfirmation(
  state: MeetingConfirmationState,
): Promise<void> {
  const client = state.client;
  if (!client || !state.connected) {
    return;
  }
  const reviewCount = pendingReviewCount(state.workbenchNotices);
  if (reviewCount <= 0) {
    state.meetingPendingConfirmation = null;
    state.meetingScheduleReplayNeeded = false;
    state.meetingScheduleReplayMeetingId = null;
    state.meetingConfirmationError = null;
    state.meetingConfirmationOldCardInvalid = false;
    state.meetingConfirmationApproveBlockKey = null;
    return;
  }
  if (state.meetingConfirmationLoading) {
    return;
  }
  const gateway = createMeetingLifecycleGateway(client);
  try {
    const { meetings } = await gateway.listMeetings();
    const pendingApprovals = meetings.filter((entry) => entry.status === "pending_approval");
    if (pendingApprovals.length === 0) {
      state.meetingPendingConfirmation = null;
      state.meetingConfirmationApproveBlockKey = null;
      return;
    }
    // Prefer meetings that can actually issue a confirm ticket (offline, or online with
    // joinUrl). Unlinkable online pending must NOT auto-issue — skip approve entirely.
    const confirmable = pendingApprovals.filter((entry) => !organizerMeetingLinkPending(entry));
    const unlinkable = pendingApprovals.filter((entry) => organizerMeetingLinkPending(entry));
    const currentId = state.meetingPendingConfirmation?.meeting.id;

    if (confirmable.length === 0) {
      // All pending are online-without-joinUrl: quieter error card, no meeting.approve spam.
      const anchor = unlinkable[0];
      const blockKey = anchor ? meetingApproveBlockKey(anchor) : "unlinkable";
      if (state.meetingConfirmationApproveBlockKey === blockKey && state.meetingConfirmationError) {
        return;
      }
      state.meetingPendingConfirmation = null;
      state.meetingConfirmationError = MEETING_PROVISION_REQUIRED_MESSAGE;
      state.meetingConfirmationApproveBlockKey = blockKey;
      return;
    }

    const preferred =
      (currentId ? confirmable.find((entry) => entry.id === currentId) : undefined) ??
      confirmable[0];
    if (!preferred) {
      state.meetingPendingConfirmation = null;
      return;
    }

    const preferredBlockKey = meetingApproveBlockKey(preferred);
    // Hard fail already shown for this meeting fingerprint — do not re-invoice approve every ~45s.
    if (
      !state.meetingPendingConfirmation &&
      state.meetingConfirmationApproveBlockKey === preferredBlockKey &&
      state.meetingConfirmationError
    ) {
      return;
    }

    if (!shouldRefreshPendingTicket(state.meetingPendingConfirmation, preferred)) {
      return;
    }
    state.meetingConfirmationLoading = true;
    state.meetingConfirmationError = null;
    let lastError: string | null = null;
    let lastWasHardProvision = false;
    let issued = false;
    for (const candidate of confirmable) {
      if (
        state.meetingPendingConfirmation?.meeting.id === candidate.id &&
        !shouldRefreshPendingTicket(state.meetingPendingConfirmation, candidate)
      ) {
        issued = true;
        break;
      }
      try {
        const result = await gateway.approveMeeting(candidate.id);
        if (result.status === "pending_confirmation") {
          state.meetingPendingConfirmation = {
            meeting: result.meeting,
            confirmation: result.confirmation,
            confirmationDetail: result.confirmationDetail,
            message: result.message,
          };
          // New pending gate replaces any prior release epilogue.
          state.meetingConfirmRelease = null;
          state.meetingConfirmationError = null;
          state.meetingConfirmationOldCardInvalid = false;
          state.meetingConfirmationApproveBlockKey = null;
          issued = true;
          break;
        }
        lastError = `unexpected approve status: ${String((result as { status?: string }).status ?? "")}`;
        lastWasHardProvision = false;
      } catch (err) {
        lastError = formatMeetingConfirmationError(err);
        lastWasHardProvision = isHardMeetingProvisionFailure(err);
        // Try the next confirmable meeting; keep the last error if none succeed.
        continue;
      }
    }
    if (!issued) {
      state.meetingPendingConfirmation = null;
      state.meetingConfirmationError = lastError ?? MEETING_PROVISION_REQUIRED_MESSAGE;
      // Suppress WORKBENCH_SIGNALS_REFRESH re-approve for hard provision / no-joinUrl failures.
      state.meetingConfirmationApproveBlockKey =
        lastWasHardProvision || !lastError ? preferredBlockKey : null;
    }
  } catch (err) {
    state.meetingConfirmationError = formatMeetingConfirmationError(err);
  } finally {
    state.meetingConfirmationLoading = false;
  }
}

async function replayScheduleIfNeeded(
  client: GatewayBrowserClient,
  meetingId: string,
): Promise<boolean> {
  const gateway = createMeetingLifecycleGateway(client);
  const replay = await gateway.replayMeetingSchedule(meetingId);
  return replay.scheduleComplete;
}

/**
 * Steward-ticket confirm = pause release. Clears pending ticket state, keeps a
 * visible release epilogue, and wakes the conversation task via resume hook.
 */
export async function confirmMeetingPendingApproval(
  state: MeetingConfirmationState,
): Promise<MeetingConfirmResumeContinuation | null> {
  const pending = state.meetingPendingConfirmation;
  const client = state.client;
  if (!pending || !client || !state.connected) {
    return null;
  }
  const releasingTitle = pending.confirmationDetail?.title ?? pending.meeting.title ?? "会议";
  const ticketStale =
    state.meetingConfirmationOldCardInvalid === true ||
    (typeof pending.confirmation.expiresAtMs === "number" &&
      pending.confirmation.expiresAtMs <= Date.now());
  if (ticketStale) {
    state.meetingConfirmationLoading = true;
    state.meetingConfirmationError = null;
    try {
      const gateway = createMeetingLifecycleGateway(client);
      const reissued = await gateway.approveMeeting(pending.meeting.id);
      if (reissued.status === "pending_confirmation") {
        state.meetingPendingConfirmation = {
          meeting: reissued.meeting,
          confirmation: reissued.confirmation,
          confirmationDetail: reissued.confirmationDetail,
          message: reissued.message,
        };
        state.meetingConfirmationOldCardInvalid = false;
        state.meetingConfirmRelease = null;
      }
      return null;
    } catch (err) {
      state.meetingConfirmationError = formatMeetingConfirmationError(err);
      state.meetingConfirmationOldCardInvalid = true;
      return null;
    } finally {
      state.meetingConfirmationLoading = false;
    }
  }
  const noticeText = formatOrganizerMeetingNotice(pending.meeting);
  state.meetingConfirmationLoading = true;
  state.meetingConfirmationError = null;
  state.meetingScheduleReplayNeeded = false;
  state.meetingConfirmRelease = {
    meetingId: pending.meeting.id,
    title: releasingTitle,
    phase: "releasing",
    progressMessage: "已确认，正在发送邀请并写入日程…",
    noticeText,
  };
  try {
    const gateway = createMeetingLifecycleGateway(client);
    const result = await gateway.approveMeeting(pending.meeting.id, {
      proposalId: pending.confirmation.proposalId,
      confirmationToken: pending.confirmation.confirmationToken,
    });
    if (result.status === "pending_confirmation") {
      state.meetingPendingConfirmation = {
        meeting: result.meeting,
        confirmation: result.confirmation,
        confirmationDetail: result.confirmationDetail,
        message: result.message,
      };
      state.meetingConfirmRelease = null;
      return null;
    }
    // Ticket consumed — leave pending so the card is not a silent void.
    state.meetingPendingConfirmation = null;
    let complete = (result as { scheduleComplete?: boolean }).scheduleComplete;
    if (!complete) {
      complete = await replayScheduleIfNeeded(client, result.meeting.id);
    }
    if (!complete) {
      state.meetingScheduleReplayNeeded = true;
      state.meetingScheduleReplayMeetingId = result.meeting.id;
    } else {
      state.meetingScheduleReplayMeetingId = null;
    }
    const confirmed = result as {
      scheduledCount?: number;
      deliveredCount?: number;
      failedCount?: number;
      deliveryProgress?: { deliveredCount?: number; failedCount?: number };
      resumeContinuation?: unknown;
      meeting: Meeting;
      scheduleComplete: boolean;
    };
    const deliveredCount =
      typeof confirmed.deliveredCount === "number"
        ? confirmed.deliveredCount
        : typeof confirmed.deliveryProgress?.deliveredCount === "number"
          ? confirmed.deliveryProgress.deliveredCount
          : undefined;
    const failedCount =
      typeof confirmed.failedCount === "number"
        ? confirmed.failedCount
        : typeof confirmed.deliveryProgress?.failedCount === "number"
          ? confirmed.deliveryProgress.failedCount
          : undefined;
    const continuation =
      asResumeContinuation(confirmed.resumeContinuation) ??
      fallbackResumeContinuation({
        meetingId: result.meeting.id,
        title: result.meeting.title ?? releasingTitle,
        scheduleComplete: complete,
        scheduledCount: typeof confirmed.scheduledCount === "number" ? confirmed.scheduledCount : 0,
        deliveredCount,
        failedCount,
      });
    state.meetingConfirmRelease = {
      meetingId: continuation.meetingId,
      title: continuation.title,
      phase: complete && !(failedCount && failedCount > 0) ? "released" : "partial",
      progressMessage: continuation.epilogueProgressMessage,
      resultMessage: continuation.epilogueResultMessage,
      scheduleComplete: complete,
      noticeText,
      ...(deliveredCount !== undefined ? { deliveredCount } : {}),
      ...(failedCount !== undefined ? { failedCount } : {}),
    };
    const { refreshWorkbenchSignals } = await import("./spaces.ts");
    await refreshWorkbenchSignals(state);
    if (state.resumeMeetingConfirmConversation) {
      await state.resumeMeetingConfirmConversation(continuation);
    }
    return continuation;
  } catch (err) {
    const message = formatMeetingConfirmationError(err);
    state.meetingConfirmationError = message;
    if (/过期|失效|已被使用|不匹配|内容已变化/.test(message)) {
      state.meetingConfirmationOldCardInvalid = true;
    }
    state.meetingConfirmRelease = null;
    return null;
  } finally {
    state.meetingConfirmationLoading = false;
  }
}

export async function replayMeetingScheduleFanOut(state: MeetingConfirmationState): Promise<void> {
  const client = state.client;
  const meetingId =
    state.meetingScheduleReplayMeetingId?.trim() ||
    state.meetingPendingConfirmation?.meeting.id?.trim() ||
    "";
  if (!meetingId || !client || !state.connected) {
    return;
  }
  state.meetingConfirmationLoading = true;
  state.meetingConfirmationError = null;
  try {
    const complete = await replayScheduleIfNeeded(client, meetingId);
    state.meetingScheduleReplayNeeded = !complete;
    if (complete) {
      state.meetingScheduleReplayMeetingId = null;
    }
    const { refreshWorkbenchSignals } = await import("./spaces.ts");
    await refreshWorkbenchSignals(state);
  } catch (err) {
    state.meetingConfirmationError = formatMeetingConfirmationError(err);
  } finally {
    state.meetingConfirmationLoading = false;
  }
}

/**
 * User dismissed the confirm card (SPEC §5.1): clear UI pending and invalidate
 * unused steward tickets. Does not cancel the meeting itself.
 */
export async function cancelMeetingPendingConfirmation(
  state: MeetingConfirmationState,
): Promise<void> {
  const pending = state.meetingPendingConfirmation;
  const meetingId = pending?.meeting.id?.trim() || "";
  const client = state.client;
  state.meetingPendingConfirmation = null;
  state.meetingConfirmationError = null;
  state.meetingConfirmationOldCardInvalid = false;
  state.meetingConfirmationApproveBlockKey = null;
  state.meetingScheduleReplayNeeded = false;
  state.meetingScheduleReplayMeetingId = null;
  state.meetingConfirmRelease = null;
  if (!meetingId || !client || !state.connected) {
    return;
  }
  try {
    const gateway = createMeetingLifecycleGateway(client);
    await gateway.approveMeeting(meetingId, { dismissConfirmation: true });
  } catch (err) {
    // Best-effort server invalidate; UI is already cleared.
    state.meetingConfirmationError = formatMeetingConfirmationError(err);
  }
}

/** Clear release epilogue once the resumed steward turn is visibly underway. */
export function clearMeetingConfirmRelease(state: MeetingConfirmationState): void {
  state.meetingConfirmRelease = null;
}

/** The result strip stays through the confirm request, then leaves after that reply lands. */
export function meetingConfirmReleaseShouldClear(
  release: { phase?: string } | null | undefined,
): boolean {
  return release?.phase === "released" || release?.phase === "partial";
}

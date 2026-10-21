/**
 * Meeting approval confirmation — server-issued one-shot tickets bound to a
 * meeting content fingerprint (title/time/roster/location/…). Reuses the steward
 * confirmation store so approve cannot succeed from a model-only boolean flag.
 *
 * Agent tools must NOT echo `confirmationToken` back into the model context;
 * the browser UI (or a later user-supplied token) is the consumer path.
 * Chat/workbench confirm cards are the primary organizer release path
 * (CollabDispatch D1 — docs/design/org-collab-dispatch-dev-2026-09-27.md).
 *
 * Registered as ConfirmActionDescriptor `meeting.approve:` (SPEC §6).
 */

import {
  consumeConfirmation,
  createConfirmation,
  invalidateConfirmationsByActionId,
  supersedeUnusedConfirmations,
  type ConsumeConfirmationResult,
} from "../gateway/server-methods/steward-confirmation-store.js";
import type { DaibaiConfirmationEnvelope } from "../shared/daibai-types.js";
import {
  registerConfirmAction,
  resolveConfirmIrreversible,
  type ConfirmActionDescriptor,
} from "./confirm-action-descriptor.js";
import { preflightOnlineMeetingJoinUrl } from "./meeting-mode.js";
import type { Meeting } from "./meeting-store.js";

export function meetingApproveActionId(meetingId: string): string {
  return `meeting.approve:${meetingId.trim()}`;
}

/** Stable fingerprint of the meeting draft the organizer is confirming. */
export function buildMeetingApprovalPayload(meeting: Meeting): Record<string, unknown> {
  return {
    meetingId: meeting.id,
    title: meeting.title,
    startAtMs: meeting.startAtMs,
    endAtMs: meeting.endAtMs ?? null,
    timezone: meeting.timezone,
    location: meeting.location ?? null,
    meetingMode: meeting.meetingMode ?? null,
    joinUrl: meeting.joinUrl ?? null,
    agenda: [...(meeting.agenda ?? [])],
    attendees: meeting.attendees.map((attendee) => attendee.userId).toSorted(),
    updatedAt: meeting.updatedAt,
  };
}

function meetingApproveConsequenceHint(meeting: Meeting): string {
  // CollabDispatch D1: release writes organizer schedule + delivers invites;
  // recipients only get ScheduleEntry after their own ack.
  const recipientCount = Math.max(0, meeting.attendees.length - 1);
  return recipientCount > 0
    ? `确认后发送给 ${recipientCount} 位参会人，并写入你的日程；对方知晓确认后才会写入其日程`
    : "确认后写入你的日程并放行会议";
}

export const MEETING_APPROVE_CONFIRM_ACTION: ConfirmActionDescriptor<Meeting> =
  registerConfirmAction({
    actionIdPattern: "meeting.approve:",
    buildActionId: meetingApproveActionId,
    buildPayload: buildMeetingApprovalPayload,
    preflight: (meeting) => {
      const gate = preflightOnlineMeetingJoinUrl(meeting);
      if (gate.ok) {
        return { ok: true };
      }
      return { ok: false, code: gate.code, message: gate.message };
    },
    consequenceHint: meetingApproveConsequenceHint,
    irreversible: false,
    onConfirm: (params) =>
      consumeConfirmation({
        proposalId: params.proposalId,
        confirmationToken: params.confirmationToken,
        actionId: meetingApproveActionId(params.entity.id),
        payload: buildMeetingApprovalPayload(params.entity),
        ...(params.now !== undefined ? { now: params.now } : {}),
      }),
    onCancel: (meetingId) => invalidateConfirmationsByActionId(meetingApproveActionId(meetingId)),
    uiChrome: "inline_card",
  });

export function issueMeetingApprovalConfirmation(meeting: Meeting): DaibaiConfirmationEnvelope {
  return createConfirmation({
    actionId: MEETING_APPROVE_CONFIRM_ACTION.buildActionId(meeting.id),
    payload: MEETING_APPROVE_CONFIRM_ACTION.buildPayload(meeting),
  });
}

/**
 * Public recovery row for a reissued meeting ticket.
 * Must not carry confirmationToken — that stays on the live envelope only.
 */
export type MeetingConfirmationRecovery = {
  kind: "meeting_confirmation_recovery";
  meetingId: string;
  proposalId: string;
  expiresAtMs: number;
  payloadHash: string;
  previousAuthorizationReused: false;
  invalidatedProposalIds: string[];
  draftRechecked: true;
  permissionRechecked: true;
  expiryRechecked: true;
  oldCardStatus: "invalidated";
};

export type MeetingReissueResult =
  | {
      ok: true;
      confirmation: DaibaiConfirmationEnvelope;
      recovery: MeetingConfirmationRecovery;
    }
  | {
      ok: false;
      code: "actor_not_organizer" | "invalid_status" | "provision_required" | "provision_failed";
      message: string;
    };

/**
 * Re-issue a meeting confirm ticket.
 * Re-checks the current draft, organizer permission, and expiry.
 * Does not extend or reuse the previous authorization. Old tickets are invalidated.
 */
export function reissueMeetingApprovalConfirmation(params: {
  meeting: Meeting;
  actorUserId: string;
  now?: number;
}): MeetingReissueResult {
  const actorUserId = params.actorUserId.trim();
  if (!actorUserId || actorUserId !== params.meeting.organizerUserId.trim()) {
    return {
      ok: false,
      code: "actor_not_organizer",
      message: "只有会议组织者可以重新签发确认。",
    };
  }
  if (params.meeting.status !== "pending_approval") {
    return {
      ok: false,
      code: "invalid_status",
      message: `会议当前状态为 ${params.meeting.status}，不能续用旧确认。`,
    };
  }
  const preflight = MEETING_APPROVE_CONFIRM_ACTION.preflight?.(params.meeting) ?? {
    ok: true as const,
  };
  if (!preflight.ok) {
    return {
      ok: false,
      code: preflight.code === "provision_failed" ? "provision_failed" : "provision_required",
      message: preflight.message,
    };
  }
  const invalidated = supersedeUnusedConfirmations(
    meetingApproveActionId(params.meeting.id),
    params.now,
  );
  const confirmation = createConfirmation({
    actionId: MEETING_APPROVE_CONFIRM_ACTION.buildActionId(params.meeting.id),
    payload: MEETING_APPROVE_CONFIRM_ACTION.buildPayload(params.meeting),
    ...(params.now !== undefined ? { now: params.now } : {}),
  });
  const recovery: MeetingConfirmationRecovery = {
    kind: "meeting_confirmation_recovery",
    meetingId: params.meeting.id,
    proposalId: confirmation.proposalId,
    expiresAtMs: confirmation.expiresAtMs,
    payloadHash: confirmation.payloadHash,
    previousAuthorizationReused: false,
    invalidatedProposalIds: invalidated.invalidatedProposalIds,
    draftRechecked: true,
    permissionRechecked: true,
    expiryRechecked: true,
    oldCardStatus: "invalidated",
  };
  if (JSON.stringify(recovery).includes(confirmation.confirmationToken)) {
    throw new Error("meeting confirmation recovery must not contain confirmationToken");
  }
  return { ok: true, confirmation, recovery };
}

export function consumeMeetingApprovalConfirmation(params: {
  meeting: Meeting;
  proposalId: string;
  confirmationToken: string;
  now?: number;
}): ConsumeConfirmationResult {
  return (
    MEETING_APPROVE_CONFIRM_ACTION.onConfirm?.({
      entity: params.meeting,
      proposalId: params.proposalId,
      confirmationToken: params.confirmationToken,
      ...(params.now !== undefined ? { now: params.now } : {}),
    }) ?? { ok: false, reason: "not_found" }
  );
}

/** Invalidate unused organizer confirm tickets for this meeting (cancel / dismiss). */
export function invalidateMeetingApprovalConfirmations(meetingId: string): number {
  return MEETING_APPROVE_CONFIRM_ACTION.onCancel?.(meetingId) ?? 0;
}

export function meetingApprovalConfirmationDetail(meeting: Meeting, expiresAtMs: number) {
  return {
    title: meeting.title,
    impact: MEETING_APPROVE_CONFIRM_ACTION.consequenceHint?.(meeting),
    irreversible: resolveConfirmIrreversible(MEETING_APPROVE_CONFIRM_ACTION, meeting),
    expiresAtMs,
  };
}

/**
 * Pause-release continuation after steward-ticket confirm.
 * Returned on `meeting.approve` success so the UI can wake the same conversation
 * task without ever exposing confirmationToken to the model.
 */
export type MeetingConfirmResumeContinuation = {
  kind: "meeting_confirm_release";
  meetingId: string;
  title: string;
  status: "confirmed";
  scheduleComplete: boolean;
  scheduledCount: number;
  deliveredCount?: number;
  failedCount?: number;
  /** User-visible / transport text that resumes the steward turn (no tokens). */
  userMessage: string;
  /** Short epilogue copy while release settles / after success. */
  epilogueProgressMessage: string;
  epilogueResultMessage: string;
};

export function buildMeetingConfirmResumeContinuation(params: {
  meetingId: string;
  title: string;
  scheduleComplete: boolean;
  scheduledCount: number;
  deliveredCount?: number;
  failedCount?: number;
}): MeetingConfirmResumeContinuation {
  const title = params.title.trim() || "会议";
  const delivered = typeof params.deliveredCount === "number" ? params.deliveredCount : undefined;
  const failed = typeof params.failedCount === "number" ? params.failedCount : undefined;
  const deliveryBits: string[] = [];
  if (delivered !== undefined) {
    deliveryBits.push(`已投递 ${delivered}`);
  }
  if (failed !== undefined && failed > 0) {
    deliveryBits.push(`失败 ${failed}`);
  }
  const scheduleBit = params.scheduleComplete
    ? "发起人日程已写入"
    : "发起人日程写入未完成（可重试）";
  const deliveryBit = deliveryBits.length > 0 ? `；投递：${deliveryBits.join("，")}` : "";
  const epilogueResultMessage = `已确认发送「${title}」。${scheduleBit}${deliveryBit}。`;
  const userMessage = [
    `我已确认发送会议「${title}」。`,
    `状态=confirmed；${scheduleBit}${deliveryBit}。`,
    "请向我汇报发送与日程结果，并给出下一步建议。",
  ].join(" ");
  return {
    kind: "meeting_confirm_release",
    meetingId: params.meetingId,
    title,
    status: "confirmed",
    scheduleComplete: params.scheduleComplete,
    scheduledCount: params.scheduledCount,
    ...(delivered !== undefined ? { deliveredCount: delivered } : {}),
    ...(failed !== undefined ? { failedCount: failed } : {}),
    userMessage,
    epilogueProgressMessage: "已确认，正在发送邀请并写入日程…",
    epilogueResultMessage,
  };
}

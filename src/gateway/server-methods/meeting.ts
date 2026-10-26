import { summarizeMeetingDeliveryProgress } from "../../organization/collab-dispatch-delivery.js";
import { validateMinutesDraft } from "../../organization/lifecycle-candidates.js";
import {
  buildMeetingConfirmResumeContinuation,
  consumeMeetingApprovalConfirmation,
  invalidateMeetingApprovalConfirmations,
  issueMeetingApprovalConfirmation,
  meetingApprovalConfirmationDetail,
  reissueMeetingApprovalConfirmation,
} from "../../organization/meeting-confirmation.js";
import {
  applyMeetingRecipientDecision,
  applyMeetingTransition,
  attachMeetingMinutes,
  replayMeetingScheduleFanOut,
  retryMeetingDelivery,
} from "../../organization/meeting-lifecycle.js";
import {
  parseMeetingMode,
  preflightOnlineMeetingJoinUrl,
} from "../../organization/meeting-mode.js";
import {
  createMeeting,
  type Meeting,
  type MeetingAttendeeRole,
  MeetingTransitionError,
  readOrganizerMeetings,
  upsertMeeting,
} from "../../organization/meeting-store.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import {
  maybeCancelTencentMeetingForMeeting,
  maybeProvisionTencentMeetingForMeeting,
  resolveMeetingTencentMeetingBridgeContext,
} from "../meeting-tencent-meeting-bridge.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { looseRecordOrEmpty as asRecord } from "../records.js";
import { invalidateOrganizerMeetingWorkbenchSignals } from "../workbench/signals-invalidate.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

/**
 * Meeting lifecycle RPCs (Phase B1) — deterministic, no LLM. Every call is scoped
 * to the resolved employee actor as the organizer; `organizerUserId` is stamped
 * server-side, and submit/approve/cancel/list only ever open the organizer's own
 * meeting store.
 *
 * Approve requires a server-issued confirmation ticket (steward confirmation store)
 * bound to the meeting content fingerprint. First call without token returns
 * `pending_confirmation`; second call with proposalId+confirmationToken confirms
 * (= CollabDispatch release): deliver invites + upsert organizer ScheduleEntry +
 * mark recipients ack-pending. Recipient ScheduleEntry is written only via
 * `meeting.ack`. Partial organizer/acked projections are compensatable via
 * `meeting.replay-schedule`. Failed CollabDispatch deliveries retry via
 * `meeting.retry-delivery` without blocking already-sent recipients.
 */

function parseAttendees(raw: unknown): Array<{ userId: string; role?: MeetingAttendeeRole }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Array<{ userId: string; role?: MeetingAttendeeRole }> = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const userId = entry.trim();
      if (userId) {
        result.push({ userId });
      }
      continue;
    }
    const record = asRecord(entry);
    const userId = typeof record.userId === "string" ? record.userId.trim() : "";
    if (!userId) {
      continue;
    }
    const role: MeetingAttendeeRole | undefined =
      record.role === "optional" ? "optional" : record.role === "required" ? "required" : undefined;
    result.push(role ? { userId, role } : { userId });
  }
  return result;
}

function readStartEnd(
  record: Record<string, unknown>,
): { ok: true; startAtMs: number; endAtMs?: number } | { ok: false; message: string } {
  const startAtMs = typeof record.startAtMs === "number" ? record.startAtMs : Number.NaN;
  if (!Number.isFinite(startAtMs) || startAtMs <= 0) {
    return { ok: false, message: "startAtMs must be a positive epoch-ms timestamp" };
  }
  if (record.endAtMs !== undefined && record.endAtMs !== null) {
    if (
      typeof record.endAtMs !== "number" ||
      !Number.isFinite(record.endAtMs) ||
      record.endAtMs < startAtMs
    ) {
      return { ok: false, message: "endAtMs must be a number >= startAtMs" };
    }
    return { ok: true, startAtMs, endAtMs: record.endAtMs };
  }
  return { ok: true, startAtMs };
}

async function loadOrganizerMeeting(
  organizerUserId: string,
  meetingId: string,
): Promise<Meeting | null> {
  const meetings = await readOrganizerMeetings(organizerUserId);
  return meetings.find((entry) => entry.id === meetingId) ?? null;
}

function respondJoinUrlPreflightFail(
  respond: GatewayRequestHandlerOptions["respond"],
  preflight: Extract<ReturnType<typeof preflightOnlineMeetingJoinUrl>, { ok: false }>,
): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, preflight.message, {
      reasonCode: preflight.code,
      details: {
        code: preflight.code,
        ...(preflight.provisionReason ? { provisionReason: preflight.provisionReason } : {}),
      },
    }),
  );
}

export const meetingHandlers: GatewayRequestHandlers = {
  "meeting.create": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title is required"));
      return;
    }
    const startEnd = readStartEnd(record);
    if (!startEnd.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, startEnd.message));
      return;
    }
    const timezone =
      typeof record.timezone === "string" ? record.timezone.trim() || undefined : undefined;
    const spaceId =
      typeof record.spaceId === "string" ? record.spaceId.trim() || undefined : undefined;
    const location =
      typeof record.location === "string" ? record.location.trim() || undefined : undefined;
    const meetingMode = parseMeetingMode(record.meetingMode);
    const joinUrl =
      typeof record.joinUrl === "string" ? record.joinUrl.trim() || undefined : undefined;
    const agenda = Array.isArray(record.agenda)
      ? record.agenda.filter((item): item is string => typeof item === "string")
      : undefined;
    try {
      const meeting = createMeeting({
        organizerUserId: actor.userId,
        ...(actor.tenantId !== undefined ? { tenantId: actor.tenantId } : {}),
        ...(spaceId ? { spaceId } : {}),
        title,
        startAtMs: startEnd.startAtMs,
        ...(startEnd.endAtMs !== undefined ? { endAtMs: startEnd.endAtMs } : {}),
        ...(timezone ? { timezone } : {}),
        ...(location ? { location } : {}),
        ...(meetingMode ? { meetingMode } : {}),
        ...(joinUrl ? { joinUrl } : {}),
        ...(agenda ? { agenda } : {}),
        attendees: parseAttendees(record.attendees),
      });
      const saved = await upsertMeeting(meeting);
      invalidateOrganizerMeetingWorkbenchSignals(actor.userId);
      respond(true, { meeting: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to create meeting";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "meeting.submit": async (ctx) => {
    await transitionHandler(ctx, "pending_approval");
  },

  "meeting.approve": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const meeting = await loadOrganizerMeeting(actor.userId, id);
    if (!meeting) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "meeting not found"));
      return;
    }
    // SPEC §5.1: dismiss confirm card — invalidate unused tickets; keep the meeting.
    // Piggybacks on meeting.approve so we do not need a new gateway method registration.
    if (record.dismissConfirmation === true) {
      const invalidatedTickets = invalidateMeetingApprovalConfirmations(id);
      respond(true, {
        status: "confirmation_cancelled",
        meetingId: id,
        meeting,
        invalidatedTickets,
      });
      return;
    }
    if (meeting.status !== "pending_approval") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `illegal meeting transition: ${meeting.status} -> confirmed`,
        ),
      );
      return;
    }
    const proposalId = typeof record.proposalId === "string" ? record.proposalId.trim() : "";
    const confirmationToken =
      typeof record.confirmationToken === "string" ? record.confirmationToken.trim() : "";
    // Preflight: online without joinUrl → structured provision_* error, no steward ticket / no card.
    const joinUrlGate = preflightOnlineMeetingJoinUrl(meeting);
    if (!joinUrlGate.ok) {
      respondJoinUrlPreflightFail(respond, joinUrlGate);
      return;
    }
    if (!proposalId || !confirmationToken) {
      const reissued = reissueMeetingApprovalConfirmation({
        meeting,
        actorUserId: actor.userId,
      });
      if (!reissued.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, reissued.message, {
            reasonCode: reissued.code,
            details: { code: reissued.code },
          }),
        );
        return;
      }
      respond(true, {
        status: "pending_confirmation",
        meeting,
        confirmation: reissued.confirmation,
        confirmationDetail: meetingApprovalConfirmationDetail(
          meeting,
          reissued.confirmation.expiresAtMs,
        ),
        recovery: reissued.recovery,
        message: "请确认会议范本；确认后将发送邀请并写入你的日程，参会人知晓后才会写入其日程。",
      });
      return;
    }
    const consume = consumeMeetingApprovalConfirmation({
      meeting,
      proposalId,
      confirmationToken,
    });
    if (!consume.ok) {
      const reasonMessage: Record<string, string> = {
        not_found: "确认已失效或已被使用，请重新发起确认。",
        expired: "确认已过期，请重新发起确认。",
        token_mismatch: "确认凭据不匹配，请重新发起确认。",
        action_mismatch: "确认凭据与会议不匹配，请重新发起确认。",
        payload_mismatch: "会议内容已变化，请重新确认后再批准。",
      };
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          reasonMessage[consume.reason] ?? "确认校验未通过，请重新发起确认。",
          {
            details: {
              oldCardStatus: "invalidated",
              reissueRequired: true,
              reason: consume.reason,
            },
          },
        ),
      );
      return;
    }
    try {
      const bridgeCtx = resolveMeetingTencentMeetingBridgeContext({ actor });
      let meetingForConfirm = meeting;
      const provision = await maybeProvisionTencentMeetingForMeeting({
        meeting,
        ctx: bridgeCtx,
      });
      if (provision.ok) {
        meetingForConfirm = await upsertMeeting(provision.meeting);
      }
      const result = await applyMeetingTransition({
        organizerUserId: actor.userId,
        meetingId: id,
        to: "confirmed",
        sessionClient: client,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "meeting not found"));
        return;
      }
      const deliveryProgress =
        result.deliveryProgress ?? summarizeMeetingDeliveryProgress(result.meeting);
      const scheduledCount = result.scheduledCount;
      const scheduleComplete = result.scheduleComplete ?? false;
      const deliveredCount = result.deliveredCount ?? deliveryProgress.deliveredCount;
      const failedCount = result.failedCount ?? deliveryProgress.failedCount;
      const resumeContinuation = buildMeetingConfirmResumeContinuation({
        meetingId: result.meeting.id,
        title: result.meeting.title,
        scheduleComplete,
        scheduledCount,
        deliveredCount,
        failedCount,
      });
      respond(true, {
        status: "confirmed",
        meeting: result.meeting,
        scheduledCount,
        scheduleComplete,
        deliveredCount,
        failedCount,
        deliveryProgress,
        resumeContinuation,
        ...(provision.ok
          ? {
              tencentMeetingProvisioned: true,
              joinUrl: meetingForConfirm.joinUrl ?? null,
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof MeetingTransitionError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      const message = error instanceof Error ? error.message : "failed to approve meeting";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "meeting.replay-schedule": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      const result = await replayMeetingScheduleFanOut({
        organizerUserId: actor.userId,
        meetingId: id,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "meeting not found"));
        return;
      }
      respond(true, {
        meeting: result.meeting,
        scheduledCount: result.scheduledCount,
        scheduleComplete: result.scheduleComplete ?? false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to replay schedule fan-out";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "meeting.retry-delivery": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const recipientIds = Array.isArray(record.recipientIds)
      ? record.recipientIds
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined;
    try {
      const result = await retryMeetingDelivery({
        organizerUserId: actor.userId,
        meetingId: id,
        sessionClient: client,
        ...(recipientIds && recipientIds.length > 0 ? { recipientIds } : {}),
      });
      if (!result.ok) {
        const reasonMessage: Record<string, string> = {
          "not-found": "meeting not found",
          "not-released": "meeting has not been released by the organizer yet",
          cancelled: "meeting is cancelled",
          "nothing-to-retry": "no failed or pending recipients to retry",
        };
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, reasonMessage[result.reason] ?? result.reason),
        );
        return;
      }
      invalidateOrganizerMeetingWorkbenchSignals(actor.userId);
      respond(true, {
        meeting: result.meeting,
        deliveredCount: result.deliveredCount,
        failedCount: result.failedCount,
        deliveryProgress: result.deliveryProgress,
        retriedCount: result.retriedCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to retry meeting delivery";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "meeting.cancel": async (ctx) => {
    await transitionHandler(ctx, "cancelled");
  },

  "meeting.start": async (ctx) => {
    await transitionHandler(ctx, "in_progress");
  },

  "meeting.minute": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const validated = validateMinutesDraft(record.minutes);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid minutes: ${validated.errors.join("; ")}`),
      );
      return;
    }
    try {
      const result = await attachMeetingMinutes({
        organizerUserId: actor.userId,
        meetingId: id,
        minutes: validated.value,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "meeting not found"));
        return;
      }
      respond(true, { meeting: result.meeting });
    } catch (error) {
      if (error instanceof MeetingTransitionError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      const message = error instanceof Error ? error.message : "failed to attach minutes";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "meeting.distribute": async (ctx) => {
    await transitionHandler(ctx, "distributed");
  },

  "meeting.ack": async ({ params, respond, client }) => {
    await recipientDecisionHandler({ params, respond, client }, "accepted");
  },

  "meeting.decline": async ({ params, respond, client }) => {
    await recipientDecisionHandler({ params, respond, client }, "declined");
  },

  "meeting.list": async ({ respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(true, { meetings: [] });
      return;
    }
    try {
      const meetings = await readOrganizerMeetings(actor.userId);
      respond(true, {
        meetings,
        // Organizer 回执进度 (CollabDispatch D2): N delivered / M failed per meeting.
        deliveryProgressByMeetingId: Object.fromEntries(
          meetings.map((meeting) => [meeting.id, summarizeMeetingDeliveryProgress(meeting)]),
        ),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list meetings";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};

type HandlerCtx = GatewayRequestHandlerOptions;

async function recipientDecisionHandler(
  ctx: Pick<HandlerCtx, "params" | "respond" | "client">,
  decision: "accepted" | "declined",
): Promise<void> {
  const { params, respond, client } = ctx;
  const actor = await resolveEmployeeWorkbenchActor(client);
  if (!actor) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
    return;
  }
  const record = asRecord(params);
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
    return;
  }
  try {
    const result = await applyMeetingRecipientDecision({
      actorUserId: actor.userId,
      meetingId: id,
      decision,
    });
    if (!result.ok) {
      const reasonMessage: Record<string, string> = {
        "not-found": "meeting not found",
        "not-attendee": "you are not an attendee of this meeting",
        "organizer-self": "organizer schedule is written on release; use approve, not ack",
        "not-released": "meeting has not been released by the organizer yet",
        cancelled: "meeting is cancelled",
        "illegal-rsvp": "illegal RSVP transition for this meeting",
      };
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, reasonMessage[result.reason] ?? result.reason),
      );
      return;
    }
    respond(true, {
      status: decision === "accepted" ? "acked" : "declined",
      meeting: result.meeting,
      scheduled: result.scheduled,
      ...(result.scheduleProjection ? { scheduleProjection: result.scheduleProjection } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `failed to ${decision} meeting invite`;
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
  }
}

async function transitionHandler(
  ctx: HandlerCtx,
  to: "pending_approval" | "cancelled" | "in_progress" | "distributed",
): Promise<void> {
  const { params, respond, client } = ctx;
  const actor = await resolveEmployeeWorkbenchActor(client);
  if (!actor) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
    return;
  }
  const record = asRecord(params);
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
    return;
  }
  try {
    if (to === "cancelled") {
      // SPEC §5.1 / migration E: align with collab — invalidate unused confirm tickets.
      invalidateMeetingApprovalConfirmations(id);
      const meetings = await readOrganizerMeetings(actor.userId);
      const existing = meetings.find((entry) => entry.id === id);
      if (existing) {
        const bridgeCtx = resolveMeetingTencentMeetingBridgeContext({ actor });
        await maybeCancelTencentMeetingForMeeting({ meeting: existing, ctx: bridgeCtx });
      }
    }
    const result = await applyMeetingTransition({
      organizerUserId: actor.userId,
      meetingId: id,
      to,
    });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "meeting not found"));
      return;
    }
    if (to === "pending_approval") {
      let meetingForSubmit = result.meeting;
      const bridgeCtx = resolveMeetingTencentMeetingBridgeContext({ actor });
      const provision = await maybeProvisionTencentMeetingForMeeting({
        meeting: result.meeting,
        ctx: bridgeCtx,
      });
      if (provision.ok) {
        meetingForSubmit = await upsertMeeting(provision.meeting);
      }
      // Fail immediately on online-without-joinUrl; do not issue steward ticket / pending_confirmation.
      const joinUrlGate = preflightOnlineMeetingJoinUrl(
        meetingForSubmit,
        provision.ok
          ? {}
          : {
              provisionReason: provision.reason,
              ...(provision.detail ? { provisionDetail: provision.detail } : {}),
            },
      );
      if (!joinUrlGate.ok) {
        invalidateOrganizerMeetingWorkbenchSignals(actor.userId);
        respondJoinUrlPreflightFail(respond, joinUrlGate);
        return;
      }
      const confirmation = issueMeetingApprovalConfirmation(meetingForSubmit);
      invalidateOrganizerMeetingWorkbenchSignals(actor.userId);
      respond(true, {
        status: "pending_confirmation",
        meeting: meetingForSubmit,
        scheduledCount: result.scheduledCount,
        confirmation,
        confirmationDetail: meetingApprovalConfirmationDetail(
          meetingForSubmit,
          confirmation.expiresAtMs,
        ),
        message: "会议已提交；请确认范本后将发送邀请并写入你的日程。",
        ...(provision.ok
          ? { tencentMeetingProvisioned: true, joinUrl: meetingForSubmit.joinUrl ?? null }
          : {}),
      });
      return;
    }
    respond(true, { meeting: result.meeting, scheduledCount: result.scheduledCount });
  } catch (error) {
    if (error instanceof MeetingTransitionError) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
      return;
    }
    const message = error instanceof Error ? error.message : "failed to update meeting";
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
  }
}

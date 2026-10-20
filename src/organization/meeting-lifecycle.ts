import {
  listConversationPeers,
  resolveConversationSessionExists,
} from "../conversation-task/conversation-handoff.js";
import type { GatewayClient } from "../gateway/server-methods/types.js";
import {
  broadcastWorkbenchSignalsInvalidate,
  invalidateOrganizerMeetingWorkbenchSignals,
} from "../gateway/workbench/signals-invalidate.js";
import {
  type CollabDispatchDeliveryAdapters,
  type CollabDispatchDeliveryProgress,
  deliverCollabDispatchRoster,
  listCollabDispatchDeliveryTargets,
  listFailedOrPendingDeliveryRecipientIds,
  summarizeMeetingDeliveryProgress,
} from "./collab-dispatch-delivery.js";
import type { MinutesDraft } from "./lifecycle-candidates.js";
import {
  type MeetingNoticePeer,
  type MeetingNoticeSend,
  buildMeetingAttendeeNotice,
  defaultMeetingNoticeSend,
  meetingRecipientSelected,
  planMeetingNoticeRoute,
} from "./meeting-notice-delivery.js";
import {
  type Meeting,
  type MeetingAttendee,
  type MeetingScheduleProjection,
  type MeetingStatus,
  findMeetingById,
  inferMeetingRecipientKind,
  markRecipientsAckPending,
  readOrganizerMeetings,
  reconcileHistoricalRecipientAcks,
  transitionMeeting,
  updateMeetingAttendeeRsvp,
  upsertMeeting,
} from "./meeting-store.js";
import {
  buildMeetingScheduleEntry,
  cancelScheduleEntry,
  meetingScheduleEntryId,
  upsertScheduleEntry,
} from "./schedule-store.js";
import {
  buildMeetingTaskAssignment,
  readManagedOrganizationTaskAssignments,
  transitionTaskAssignment,
  upsertManagedOrganizationTaskAssignment,
  writeManagedOrganizationTaskAssignments,
} from "./task-assignment.js";

/**
 * Meeting lifecycle side effects (Phase B) — shared by the `meeting.*` RPCs and
 * the steward meeting tool so both produce identical effects (no V2 copy). All
 * deterministic, no LLM.
 *
 * CollabDispatch Sprint D1 (docs/design/org-collab-dispatch-dev-2026-09-27.md):
 * `pending_approval → confirmed` means organizer **release**, NOT "all attendees
 * already have ScheduleEntry". Release side effects:
 *   1. deliver/notify recipients (digital humans → agent:<id>:main; platform
 *      user ids → workbench; unmatched display names fail; per-recipient retry)
 *   2. upsert **organizer** ScheduleEntry / todo projection
 *   3. set non-organizer recipients to ack-pending (`rsvpStatus: invited`)
 * Recipient ack → upsert THAT recipient's ScheduleEntry (idempotent).
 * Decline → no schedule write for that recipient.
 */

export type FanOutScheduleResult = {
  scheduledCount: number;
  failedCount: number;
  complete: boolean;
  projections: MeetingScheduleProjection[];
};

function buildScheduleEntryForAttendee(meeting: Meeting, attendeeUserId: string) {
  return buildMeetingScheduleEntry({
    meetingId: meeting.id,
    attendeeUserId,
    ...(meeting.tenantId !== undefined ? { tenantId: meeting.tenantId } : {}),
    title: meeting.title,
    startAtMs: meeting.startAtMs,
    ...(meeting.endAtMs !== undefined ? { endAtMs: meeting.endAtMs } : {}),
    timezone: meeting.timezone,
    ...(meeting.location ? { location: meeting.location } : {}),
    ...(meeting.joinUrl ? { joinUrl: meeting.joinUrl } : {}),
  });
}

/**
 * Writes a meeting-kind ScheduleEntry for the given attendee subset (default:
 * all attendees). D1 callers pass organizer-only on release, or a single
 * acked recipient on ack — do NOT fan out the full roster on confirm.
 */
export async function fanOutMeetingScheduleEntries(
  meeting: Meeting,
  options?: { onlyUserIds?: ReadonlySet<string> },
): Promise<FanOutScheduleResult> {
  const targets = options?.onlyUserIds
    ? meeting.attendees.filter((attendee) => options.onlyUserIds?.has(attendee.userId))
    : meeting.attendees;
  const atMs = Date.now();
  const projections: MeetingScheduleProjection[] = await Promise.all(
    targets.map(async (attendee) => {
      try {
        await upsertScheduleEntry(buildScheduleEntryForAttendee(meeting, attendee.userId));
        return { userId: attendee.userId, status: "ok" as const, atMs };
      } catch (error) {
        return {
          userId: attendee.userId,
          status: "failed" as const,
          error: error instanceof Error ? error.message : "fan-out failed",
          atMs,
        };
      }
    }),
  );
  const scheduledCount = projections.filter((row) => row.status === "ok").length;
  const failedCount = projections.length - scheduledCount;
  return {
    scheduledCount,
    failedCount,
    complete: failedCount === 0 && projections.length === meeting.attendees.length,
    projections,
  };
}

function mergeScheduleProjections(
  existing: MeetingScheduleProjection[] | undefined,
  next: MeetingScheduleProjection[],
  rosterUserIds: ReadonlySet<string>,
): MeetingScheduleProjection[] {
  const byUser = new Map<string, MeetingScheduleProjection>();
  for (const row of existing ?? []) {
    if (rosterUserIds.has(row.userId)) {
      byUser.set(row.userId, row);
    }
  }
  for (const row of next) {
    byUser.set(row.userId, row);
  }
  return [...byUser.values()];
}

function normalizeUserKey(userId: string): string {
  return userId.trim().toLowerCase();
}

/** Non-organizer attendees eligible for schedule write only after ack. */
export function listAckPendingRecipients(meeting: Meeting): MeetingAttendee[] {
  const organizerKey = normalizeUserKey(meeting.organizerUserId);
  return meeting.attendees.filter(
    (attendee) =>
      normalizeUserKey(attendee.userId) !== organizerKey && attendee.rsvpStatus === "invited",
  );
}

/** Attendees whose ScheduleEntry is allowed under CollabDispatch D1. */
export function listScheduleEligibleAttendees(meeting: Meeting): MeetingAttendee[] {
  const organizerKey = normalizeUserKey(meeting.organizerUserId);
  return meeting.attendees.filter((attendee) => {
    const key = normalizeUserKey(attendee.userId);
    if (key === organizerKey) {
      return true;
    }
    return attendee.rsvpStatus === "accepted";
  });
}

export type MeetingDeliveryResult = {
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
  results: Array<{
    userId: string;
    kind: "human" | "agent";
    status: "sent" | "failed" | "skipped";
    channel?: "workbench" | "agent-bus" | "conversation";
    error?: string;
  }>;
  progress: CollabDispatchDeliveryProgress;
};

export type DeliverMeetingReleaseOptions = {
  adapters?: CollabDispatchDeliveryAdapters;
  /** Restrict delivery attempts to these recipient ids (retry path). */
  onlyRecipientIds?: ReadonlySet<string>;
  /**
   * Owned digital humans. When omitted, loaded from the tenant registry.
   * A display-name match is delivered into that agent's main session.
   */
  peers?: readonly MeetingNoticePeer[];
  /** Override the main-session notice send (tests). */
  deliverConversation?: MeetingNoticeSend;
  /** Request client used to resolve the tenant session store. */
  sessionClient?: GatewayClient | null;
};

/**
 * Meeting release delivery.
 * Digital humans (directory match, or an agent id) get the notice in
 * agent:<id>:main. Platform user ids stay on the workbench signal.
 * A display name with no session is failed and is not counted as sent.
 * Never throws; partial failures recorded per recipient.
 */
export async function deliverMeetingReleaseNotifications(
  meeting: Meeting,
  options?: DeliverMeetingReleaseOptions,
): Promise<MeetingDeliveryResult> {
  const recipients = listCollabDispatchDeliveryTargets(meeting);
  const sessionExists = await resolveMeetingNoticeSessionExists(options?.sessionClient);
  const peers = options?.peers ?? (await loadMeetingNoticePeers(meeting, sessionExists));
  const notice = buildMeetingAttendeeNotice(meeting);
  const send = options?.deliverConversation ?? defaultMeetingNoticeSend;
  const conversation: Array<{ recipientId: string; agentId: string; sessionKey: string }> = [];
  const roster: Array<{ recipientId: string; kind: "human" | "agent" }> = [];
  const unmatched: MeetingDeliveryResult["results"] = [];

  for (const target of recipients) {
    const route = planMeetingNoticeRoute({
      recipientId: target.recipientId,
      kind: target.kind,
      peers,
    });
    if (route.route === "conversation") {
      conversation.push({
        recipientId: target.recipientId,
        agentId: route.agentId,
        sessionKey: route.sessionKey,
      });
      continue;
    }
    if (route.route === "failed") {
      unmatched.push({
        userId: target.recipientId,
        kind: target.kind,
        status: "failed",
        error: route.error,
      });
      continue;
    }
    roster.push(target);
  }

  const conversationResults: MeetingDeliveryResult["results"] = [];
  let skippedCount = 0;
  for (const row of conversation) {
    if (!meetingRecipientSelected(row.recipientId, options?.onlyRecipientIds)) {
      skippedCount += 1;
      continue;
    }
    try {
      const outcome = await send({
        meeting,
        attendeeId: row.recipientId,
        agentId: row.agentId,
        sessionKey: row.sessionKey,
        notice,
        ...(sessionExists ? { sessionExists } : {}),
      });
      conversationResults.push(
        outcome.ok
          ? {
              userId: row.recipientId,
              kind: "agent",
              status: "sent",
              channel: "conversation",
            }
          : {
              userId: row.recipientId,
              kind: "agent",
              status: "failed",
              channel: "conversation",
              error: outcome.error,
            },
      );
    } catch (error) {
      conversationResults.push({
        userId: row.recipientId,
        kind: "agent",
        status: "failed",
        channel: "conversation",
        error: error instanceof Error ? error.message : "unavailable",
      });
    }
  }

  const unmatchedSelected = unmatched.filter((row) =>
    meetingRecipientSelected(row.userId, options?.onlyRecipientIds),
  );
  skippedCount += unmatched.length - unmatchedSelected.length;

  const batch = await deliverCollabDispatchRoster({
    payload: {
      dispatchId: meeting.id,
      kind: "meeting",
      title: meeting.title,
      organizerUserId: meeting.organizerUserId,
      ...(meeting.agenda && meeting.agenda.length > 0 ? { body: meeting.agenda.join("\n") } : {}),
      ...(meeting.tenantId !== undefined ? { tenantId: meeting.tenantId } : {}),
      ...(meeting.spaceId !== undefined ? { spaceId: meeting.spaceId } : {}),
    },
    recipients: roster,
    ...(options?.onlyRecipientIds ? { onlyRecipientIds: options.onlyRecipientIds } : {}),
    ...(options?.adapters ? { adapters: options.adapters } : {}),
  });
  const results = [
    ...conversationResults,
    ...unmatchedSelected,
    ...batch.results.map((row) => ({
      userId: row.recipientId,
      kind: row.kind,
      status: row.status,
      ...(row.channel ? { channel: row.channel } : {}),
      ...(row.error ? { error: row.error } : {}),
    })),
  ];
  const deliveredCount =
    conversationResults.filter((row) => row.status === "sent").length + batch.deliveredCount;
  const failedCount =
    conversationResults.filter((row) => row.status === "failed").length +
    unmatchedSelected.length +
    batch.failedCount;
  const progress = {
    totalRecipients: recipients.length,
    deliveredCount,
    failedCount,
    pendingCount: Math.max(0, recipients.length - deliveredCount - failedCount),
  };
  return {
    deliveredCount,
    failedCount,
    skippedCount: skippedCount + batch.skippedCount,
    results,
    progress,
  };
}

async function resolveMeetingNoticeSessionExists(
  client: GatewayClient | null | undefined,
): Promise<((agentId: string, sessionKey: string) => boolean) | undefined> {
  if (!client) {
    return undefined;
  }
  try {
    return await resolveConversationSessionExists(client);
  } catch {
    return undefined;
  }
}

async function loadMeetingNoticePeers(
  meeting: Meeting,
  sessionExists: ((agentId: string, sessionKey: string) => boolean) | undefined,
): Promise<MeetingNoticePeer[]> {
  const tenantId = meeting.tenantId?.trim() ?? "";
  const requesterUserId = meeting.organizerUserId.trim();
  if (!tenantId || !requesterUserId) {
    return [];
  }
  try {
    const peers = await listConversationPeers({
      tenantId,
      requesterUserId,
      tenantAdmin: false,
      includeMissingSessions: true,
      ...(sessionExists ? { sessionExists } : {}),
    });
    return peers.map((peer) => ({
      agentId: peer.agentId,
      displayName: peer.displayName,
      sessionKey: peer.sessionKey,
    }));
  } catch {
    return [];
  }
}

async function applyDeliveryStatuses(
  meeting: Meeting,
  delivery: MeetingDeliveryResult,
): Promise<Meeting> {
  const byUser = new Map(delivery.results.map((row) => [normalizeUserKey(row.userId), row]));
  const attendees = meeting.attendees.map((attendee) => {
    const row = byUser.get(normalizeUserKey(attendee.userId));
    if (!row) {
      return attendee;
    }
    if (row.status === "skipped") {
      return attendee;
    }
    return {
      ...attendee,
      deliveryStatus: row.status === "sent" ? ("sent" as const) : ("failed" as const),
    };
  });
  return {
    ...meeting,
    attendees,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Release pipeline (CollabDispatch D1): deliver + organizer schedule + ack-pending
 * recipients. Does NOT write ScheduleEntry for non-organizer attendees.
 */
function isAgentRecipient(attendee: MeetingAttendee): boolean {
  if (attendee.kind === "agent") {
    return true;
  }
  if (attendee.kind === "human") {
    return false;
  }
  return inferMeetingRecipientKind(attendee.userId) === "agent";
}

/**
 * Product default (D1): agent recipients auto-ack on release and get ScheduleEntry.
 * Humans stay ack-pending until explicit meeting.ack.
 */
async function autoAckAgentRecipients(meeting: Meeting): Promise<Meeting> {
  const organizerKey = normalizeUserKey(meeting.organizerUserId);
  const agents = meeting.attendees.filter(
    (attendee) =>
      normalizeUserKey(attendee.userId) !== organizerKey &&
      attendee.rsvpStatus === "invited" &&
      isAgentRecipient(attendee),
  );
  if (agents.length === 0) {
    return meeting;
  }
  let next = meeting;
  for (const agent of agents) {
    next = updateMeetingAttendeeRsvp(next, agent.userId, "accepted");
  }
  next = await upsertMeeting(next);
  const only = new Set(agents.map((a) => a.userId));
  const fanOut = await fanOutMeetingScheduleEntries(next, { onlyUserIds: only });
  const roster = new Set(next.attendees.map((attendee) => attendee.userId));
  const projections = mergeScheduleProjections(
    next.scheduleProjections,
    fanOut.projections,
    roster,
  );
  return upsertMeeting({
    ...next,
    scheduleProjections: projections,
    updatedAt: new Date().toISOString(),
  });
}

export async function releaseMeetingSideEffects(
  meeting: Meeting,
  options?: DeliverMeetingReleaseOptions,
): Promise<{
  meeting: Meeting;
  scheduledCount: number;
  scheduleComplete: boolean;
  deliveredCount: number;
  failedCount: number;
  deliveryProgress: CollabDispatchDeliveryProgress;
}> {
  const withAckPending = markRecipientsAckPending(meeting);
  const delivery = await deliverMeetingReleaseNotifications(withAckPending, options);
  let next = await applyDeliveryStatuses(withAckPending, delivery);

  const organizerIds = new Set([meeting.organizerUserId]);
  const fanOut = await fanOutMeetingScheduleEntries(next, { onlyUserIds: organizerIds });
  const roster = new Set(next.attendees.map((attendee) => attendee.userId));
  const projections = mergeScheduleProjections(
    next.scheduleProjections,
    fanOut.projections,
    roster,
  );
  next = await upsertMeeting({
    ...next,
    scheduleProjections: projections,
    updatedAt: new Date().toISOString(),
  });

  // Agents auto-ack (product default); humans remain invited until meeting.ack.
  next = await autoAckAgentRecipients(next);

  // "Complete" on release means organizer projection succeeded; recipients wait on ack
  // (agents already acked above and count toward eligible projections).
  const organizerOk = (next.scheduleProjections ?? []).some(
    (row) =>
      normalizeUserKey(row.userId) === normalizeUserKey(meeting.organizerUserId) &&
      row.status === "ok",
  );
  const deliveryProgress = summarizeMeetingDeliveryProgress(next);
  return {
    meeting: next,
    scheduledCount: fanOut.scheduledCount,
    scheduleComplete: organizerOk,
    deliveredCount: deliveryProgress.deliveredCount,
    failedCount: deliveryProgress.failedCount,
    deliveryProgress,
  };
}

/**
 * Retry CollabDispatch delivery for failed/pending recipients only.
 * Already-sent recipients are left untouched (partial failure compensation).
 */
export async function retryMeetingDelivery(params: {
  organizerUserId: string;
  meetingId: string;
  adapters?: CollabDispatchDeliveryAdapters;
  /** Optional explicit recipient subset; defaults to failed+pending non-organizer. */
  recipientIds?: ReadonlyArray<string>;
  sessionClient?: GatewayClient | null;
}): Promise<
  | {
      ok: true;
      meeting: Meeting;
      deliveredCount: number;
      failedCount: number;
      deliveryProgress: CollabDispatchDeliveryProgress;
      retriedCount: number;
    }
  | { ok: false; reason: "not-found" | "not-released" | "cancelled" | "nothing-to-retry" }
> {
  const meetings = await readOrganizerMeetings(params.organizerUserId);
  const meeting = meetings.find((entry) => entry.id === params.meetingId);
  if (!meeting) {
    return { ok: false, reason: "not-found" };
  }
  if (meeting.status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }
  if (meeting.status === "draft" || meeting.status === "pending_approval") {
    return { ok: false, reason: "not-released" };
  }

  const retryIds = new Set(
    (params.recipientIds && params.recipientIds.length > 0
      ? params.recipientIds
      : listFailedOrPendingDeliveryRecipientIds(meeting)
    )
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (retryIds.size === 0) {
    return { ok: false, reason: "nothing-to-retry" };
  }

  const delivery = await deliverMeetingReleaseNotifications(meeting, {
    onlyRecipientIds: retryIds,
    ...(params.adapters ? { adapters: params.adapters } : {}),
    ...(params.sessionClient ? { sessionClient: params.sessionClient } : {}),
  });
  const next = await upsertMeeting(await applyDeliveryStatuses(meeting, delivery));
  const deliveryProgress = summarizeMeetingDeliveryProgress(next);
  broadcastWorkbenchSignalsInvalidate({
    reason: "meeting",
    userIds: next.attendees.map((attendee) => attendee.userId),
  });
  return {
    ok: true,
    meeting: next,
    deliveredCount: delivery.deliveredCount,
    failedCount: delivery.failedCount,
    deliveryProgress,
    retriedCount: delivery.results.length,
  };
}

export type MeetingRecipientAckResult =
  | {
      ok: true;
      meeting: Meeting;
      decision: "accepted" | "declined";
      scheduled: boolean;
      scheduleProjection?: MeetingScheduleProjection;
    }
  | {
      ok: false;
      reason:
        | "not-found"
        | "not-attendee"
        | "organizer-self"
        | "not-released"
        | "cancelled"
        | "illegal-rsvp";
    };

/**
 * Recipient ack/decline after organizer release. Ack upserts that recipient's
 * ScheduleEntry (idempotent). Decline writes no schedule. Organizer cannot use
 * this path to ack for others (or for self — self schedule lands on release).
 */
export async function applyMeetingRecipientDecision(params: {
  actorUserId: string;
  meetingId: string;
  decision: "accepted" | "declined";
}): Promise<MeetingRecipientAckResult> {
  const actorKey = normalizeUserKey(params.actorUserId);
  if (!actorKey) {
    return { ok: false, reason: "not-attendee" };
  }
  const loaded = await findMeetingById(params.meetingId);
  if (!loaded) {
    return { ok: false, reason: "not-found" };
  }
  const meeting = reconcileHistoricalRecipientAcks(loaded);
  if (meeting.status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }
  if (meeting.status === "draft" || meeting.status === "pending_approval") {
    return { ok: false, reason: "not-released" };
  }
  if (normalizeUserKey(meeting.organizerUserId) === actorKey) {
    return { ok: false, reason: "organizer-self" };
  }
  const attendee = meeting.attendees.find((entry) => normalizeUserKey(entry.userId) === actorKey);
  if (!attendee) {
    return { ok: false, reason: "not-attendee" };
  }

  // Idempotent paths.
  if (params.decision === "declined" && attendee.rsvpStatus === "declined") {
    return { ok: true, meeting, decision: "declined", scheduled: false };
  }
  if (params.decision === "accepted" && attendee.rsvpStatus === "accepted") {
    const fanOut = await fanOutMeetingScheduleEntries(meeting, {
      onlyUserIds: new Set([attendee.userId]),
    });
    const roster = new Set(meeting.attendees.map((entry) => entry.userId));
    const projections = mergeScheduleProjections(
      meeting.scheduleProjections,
      fanOut.projections,
      roster,
    );
    const saved = await upsertMeeting({
      ...meeting,
      scheduleProjections: projections,
      updatedAt: new Date().toISOString(),
    });
    broadcastWorkbenchSignalsInvalidate({
      reason: "meeting",
      userIds: [attendee.userId, meeting.organizerUserId],
    });
    return {
      ok: true,
      meeting: saved,
      decision: "accepted",
      scheduled: fanOut.scheduledCount > 0,
      scheduleProjection: fanOut.projections[0],
    };
  }

  // First decision (or change from invited). Do not allow flipping accepted→declined
  // after schedule write in D1 (illegal); allow declined→accepted as late ack.
  if (attendee.rsvpStatus === "accepted" && params.decision === "declined") {
    return { ok: false, reason: "illegal-rsvp" };
  }

  let next = updateMeetingAttendeeRsvp(meeting, attendee.userId, params.decision);
  next = await upsertMeeting(next);

  if (params.decision === "declined") {
    broadcastWorkbenchSignalsInvalidate({
      reason: "meeting",
      userIds: [attendee.userId, meeting.organizerUserId],
    });
    return { ok: true, meeting: next, decision: "declined", scheduled: false };
  }

  const fanOut = await fanOutMeetingScheduleEntries(next, {
    onlyUserIds: new Set([attendee.userId]),
  });
  const roster = new Set(next.attendees.map((entry) => entry.userId));
  const projections = mergeScheduleProjections(
    next.scheduleProjections,
    fanOut.projections,
    roster,
  );
  const saved = await upsertMeeting({
    ...next,
    scheduleProjections: projections,
    updatedAt: new Date().toISOString(),
  });
  broadcastWorkbenchSignalsInvalidate({
    reason: "meeting",
    userIds: [attendee.userId, meeting.organizerUserId],
  });
  return {
    ok: true,
    meeting: saved,
    decision: "accepted",
    scheduled: fanOut.scheduledCount > 0,
    scheduleProjection: fanOut.projections[0],
  };
}

/** Soft-cancels each attendee's meeting-derived ScheduleEntry; returns the success count. */
export async function recycleMeetingScheduleEntries(meeting: Meeting): Promise<number> {
  const results = await Promise.allSettled(
    meeting.attendees.map((attendee) =>
      cancelScheduleEntry({
        userId: attendee.userId,
        id: meetingScheduleEntryId(meeting.id, attendee.userId),
      }),
    ),
  );
  return results.filter((result) => result.status === "fulfilled").length;
}

/**
 * Fans out per-attendee TaskAssignments from the confirmed minutes (Phase C4).
 * Bounded and authorized by construction:
 * - only meetings with a `spaceId` (the org scope) fan out (design open-Q1 = A);
 * - only action items whose `assigneeUserId` is IN the meeting roster are written —
 *   an item naming a non-attendee is dropped, never silently escalated (the organizer
 *   may only assign to their own roster); items with no assignee are skipped (Q3);
 * - each task is keyed deterministically per (meeting, assignee, title) so a
 *   re-distribute replaces rather than duplicates. Per-item failures are isolated.
 */
export async function fanOutMeetingTasks(meeting: Meeting): Promise<number> {
  const organizationId = meeting.spaceId?.trim();
  if (!organizationId || !meeting.minutes) {
    return 0;
  }
  const rosterUserIds = new Set(meeting.attendees.map((attendee) => attendee.userId));
  const tasks = meeting.minutes.actionItems.filter(
    (item) => item.assigneeUserId && rosterUserIds.has(item.assigneeUserId),
  );
  const results = await Promise.allSettled(
    tasks.map((item) =>
      upsertManagedOrganizationTaskAssignment(
        buildMeetingTaskAssignment({
          meetingId: meeting.id,
          organizationId,
          // Guaranteed present + in-roster by the filter above.
          assigneeUserId: item.assigneeUserId ?? "",
          title: item.title,
          ...(item.dueAt ? { dueAt: item.dueAt } : {}),
          ...(meeting.tenantId ? { tenantId: meeting.tenantId } : {}),
        }),
      ),
    ),
  );
  return results.filter((result) => result.status === "fulfilled").length;
}

/**
 * On meeting cancel, soft-cancels (transitions to `rejected`) any tasks this meeting
 * fanned out (matched by `sourceRef`), mirroring ScheduleEntry recycling (design Q2).
 * Already-rejected/completed tasks are left untouched. Returns the recycled count.
 */
export async function recycleMeetingTaskAssignments(meeting: Meeting): Promise<number> {
  const organizationId = meeting.spaceId?.trim();
  if (!organizationId) {
    return 0;
  }
  const existing = await readManagedOrganizationTaskAssignments(organizationId);
  let count = 0;
  const next = existing.map((assignment) => {
    if (
      assignment.sourceRef?.kind === "meeting" &&
      assignment.sourceRef.id === meeting.id &&
      assignment.status !== "rejected" &&
      assignment.status !== "completed"
    ) {
      count += 1;
      return transitionTaskAssignment(assignment, "rejected");
    }
    return assignment;
  });
  if (count > 0) {
    await writeManagedOrganizationTaskAssignments(organizationId, next);
  }
  return count;
}

export type MeetingTransitionResult =
  | {
      ok: true;
      meeting: Meeting;
      scheduledCount: number;
      scheduleComplete?: boolean;
      taskCount?: number;
      deliveredCount?: number;
      failedCount?: number;
      deliveryProgress?: CollabDispatchDeliveryProgress;
    }
  | { ok: false; reason: "not-found" };

/**
 * Loads the organizer's meeting by id, applies the status transition, persists,
 * and runs the matching side effects (confirm → CollabDispatch release, cancel →
 * recycle). Returns `not-found` when the organizer has no such meeting; throws
 * `MeetingTransitionError` on an illegal edge (caller maps both to a response).
 *
 * Phase C2 widens the accepted targets to the back-half (`in_progress` / `minuted`
 * / `distributed`); `minuted` may carry a `minutesRef`/`minutes`. Phase C4 wires the
 * `distributed` side effect: per-attendee task fan-out (and recycle on cancel).
 * Sprint D1 revises confirm: organizer schedule only; recipients wait on ack.
 */
export async function applyMeetingTransition(params: {
  organizerUserId: string;
  meetingId: string;
  to: Extract<
    MeetingStatus,
    "pending_approval" | "confirmed" | "cancelled" | "in_progress" | "minuted" | "distributed"
  >;
  minutesRef?: string;
  minutes?: MinutesDraft;
  sessionClient?: GatewayClient | null;
}): Promise<MeetingTransitionResult> {
  const meetings = await readOrganizerMeetings(params.organizerUserId);
  const meeting = meetings.find((entry) => entry.id === params.meetingId);
  if (!meeting) {
    return { ok: false, reason: "not-found" };
  }
  const transitionOpts: { minutesRef?: string; minutes?: MinutesDraft } = {};
  if (params.minutesRef !== undefined) {
    transitionOpts.minutesRef = params.minutesRef;
  }
  if (params.minutes !== undefined) {
    transitionOpts.minutes = params.minutes;
  }
  const next = transitionMeeting(meeting, params.to, transitionOpts);
  let saved = await upsertMeeting(next);
  let scheduledCount = 0;
  let scheduleComplete: boolean | undefined;
  let taskCount = 0;
  let deliveredCount: number | undefined;
  let failedCount: number | undefined;
  let deliveryProgress: CollabDispatchDeliveryProgress | undefined;
  if (params.to === "pending_approval") {
    invalidateOrganizerMeetingWorkbenchSignals(params.organizerUserId);
  } else if (params.to === "confirmed") {
    // CollabDispatch D1+D2: release = Delivery + organizer schedule + ack-pending
    // recipients. Do NOT fan out ScheduleEntry to every attendee here.
    const released = await releaseMeetingSideEffects(
      saved,
      params.sessionClient ? { sessionClient: params.sessionClient } : undefined,
    );
    saved = released.meeting;
    scheduledCount = released.scheduledCount;
    scheduleComplete = released.scheduleComplete;
    deliveredCount = released.deliveredCount;
    failedCount = released.failedCount;
    deliveryProgress = released.deliveryProgress;
  } else if (params.to === "distributed") {
    // Phase C4: confirming distribution fans the minutes action items out as
    // per-attendee TaskAssignments (bounded to the roster).
    taskCount = await fanOutMeetingTasks(saved);
  } else if (params.to === "cancelled") {
    scheduledCount = await recycleMeetingScheduleEntries(saved);
    taskCount = await recycleMeetingTaskAssignments(saved);
  }
  if (params.to === "confirmed" || params.to === "cancelled" || params.to === "distributed") {
    broadcastWorkbenchSignalsInvalidate({
      reason: params.to === "distributed" ? "task" : "meeting",
      userIds: saved.attendees.map((attendee) => attendee.userId),
    });
  }
  return {
    ok: true,
    meeting: saved,
    scheduledCount,
    ...(scheduleComplete !== undefined ? { scheduleComplete } : {}),
    ...(taskCount > 0 ? { taskCount } : {}),
    ...(deliveredCount !== undefined ? { deliveredCount } : {}),
    ...(failedCount !== undefined ? { failedCount } : {}),
    ...(deliveryProgress !== undefined ? { deliveryProgress } : {}),
  };
}

/**
 * Compensating replay for schedule projections that are allowed under
 * CollabDispatch D1 (organizer + acked recipients only). Idempotent; does not
 * require re-entering `pending_approval → confirmed`, and never writes schedules
 * for ack-pending or declined recipients.
 */
export async function replayMeetingScheduleFanOut(params: {
  organizerUserId: string;
  meetingId: string;
}): Promise<MeetingTransitionResult> {
  const meetings = await readOrganizerMeetings(params.organizerUserId);
  const meeting = meetings.find((entry) => entry.id === params.meetingId);
  if (!meeting) {
    return { ok: false, reason: "not-found" };
  }
  if (
    meeting.status === "draft" ||
    meeting.status === "pending_approval" ||
    meeting.status === "cancelled"
  ) {
    throw new Error(`illegal schedule fan-out replay for meeting status: ${meeting.status}`);
  }
  const roster = new Set(meeting.attendees.map((attendee) => attendee.userId));
  const eligible = listScheduleEligibleAttendees(meeting);
  const eligibleIds = new Set(eligible.map((attendee) => attendee.userId));
  const okIds = new Set(
    (meeting.scheduleProjections ?? [])
      .filter((row) => row.status === "ok" && eligibleIds.has(row.userId))
      .map((row) => row.userId),
  );
  const retryIds = new Set(
    eligible.map((attendee) => attendee.userId).filter((userId) => !okIds.has(userId)),
  );
  const fanOut =
    retryIds.size === 0
      ? {
          scheduledCount: okIds.size,
          failedCount: 0,
          complete: okIds.size === eligible.length,
          projections: [] as MeetingScheduleProjection[],
        }
      : await fanOutMeetingScheduleEntries(meeting, { onlyUserIds: retryIds });
  const projections = mergeScheduleProjections(
    meeting.scheduleProjections,
    fanOut.projections,
    roster,
  );
  const scheduledCount = projections.filter(
    (row) => row.status === "ok" && eligibleIds.has(row.userId),
  ).length;
  const complete =
    scheduledCount === eligible.length &&
    eligible.every((attendee) =>
      projections.some((row) => row.userId === attendee.userId && row.status === "ok"),
    );
  const saved = await upsertMeeting({
    ...meeting,
    scheduleProjections: projections,
    updatedAt: new Date().toISOString(),
  });
  broadcastWorkbenchSignalsInvalidate({
    reason: "meeting",
    userIds: saved.attendees.map((attendee) => attendee.userId),
  });
  return {
    ok: true,
    meeting: saved,
    scheduledCount,
    scheduleComplete: complete,
  };
}

/** reminded → in_progress (the meeting starts). Deterministic; no side effects. */
export function startMeeting(params: {
  organizerUserId: string;
  meetingId: string;
}): Promise<MeetingTransitionResult> {
  return applyMeetingTransition({ ...params, to: "in_progress" });
}

/**
 * in_progress → minuted. Attaches the validated minutes content (Phase C3b) and a
 * derived `minutesRef`, flipping state so the minutes await the organizer's
 * confirmation. The content is the C0-validated MinutesDraft; how it was produced
 * (a client/steward draft now, or the gated `generateMeetingMinutes` producer once
 * the model runner is wired) is orthogonal to this deterministic transition.
 */
export function attachMeetingMinutes(params: {
  organizerUserId: string;
  meetingId: string;
  minutes: MinutesDraft;
}): Promise<MeetingTransitionResult> {
  return applyMeetingTransition({
    organizerUserId: params.organizerUserId,
    meetingId: params.meetingId,
    to: "minuted",
    minutesRef: `minutes:${params.meetingId}`,
    minutes: params.minutes,
  });
}

/**
 * minuted → distributed (the organizer confirms). Fans the confirmed minutes action
 * items out as per-attendee TaskAssignments (Phase C4, via applyMeetingTransition),
 * bounded to the meeting roster. Messaging-channel delivery of the minutes is still
 * out of scope here.
 */
export function distributeMeetingMinutes(params: {
  organizerUserId: string;
  meetingId: string;
}): Promise<MeetingTransitionResult> {
  return applyMeetingTransition({ ...params, to: "distributed" });
}

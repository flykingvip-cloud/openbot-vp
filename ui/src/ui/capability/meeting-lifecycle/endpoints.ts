/**
 * RPC endpoint contract — meeting lifecycle + human-assignee tasks.
 *
 * Owns the `meeting.*` and `task.*` namespaces. Types mirror the gateway shapes in
 * `src/organization/meeting-store.ts`, `src/organization/lifecycle-candidates.ts`,
 * and `src/organization/task-assignment.ts`. Mirrors the cost-budget-billing
 * capability pattern (endpoints map + typed Request/Response).
 */

export const MEETING_LIFECYCLE_ENDPOINTS = {
  meetingCreate: "meeting.create",
  meetingSubmit: "meeting.submit",
  meetingApprove: "meeting.approve",
  meetingReplaySchedule: "meeting.replay-schedule",
  meetingStart: "meeting.start",
  meetingMinute: "meeting.minute",
  meetingDistribute: "meeting.distribute",
  meetingGenerateMinutes: "meeting.generate-minutes",
  meetingCancel: "meeting.cancel",
  meetingList: "meeting.list",
  meetingAck: "meeting.ack",
  meetingDecline: "meeting.decline",
  taskAccept: "task.accept",
  taskComplete: "task.complete",
  taskList: "task.list",
} as const;

export type MeetingLifecycleEndpoint =
  (typeof MEETING_LIFECYCLE_ENDPOINTS)[keyof typeof MEETING_LIFECYCLE_ENDPOINTS];

// ── Mirror types (gateway-side organization domain) ────────────────────────

export type MeetingStatus =
  | "draft"
  | "pending_approval"
  | "confirmed"
  | "reminded"
  | "in_progress"
  | "minuted"
  | "distributed"
  | "cancelled";

export type MeetingAttendeeRole = "organizer" | "required" | "optional";

export type MeetingAttendee = {
  userId: string;
  role?: MeetingAttendeeRole;
  /** CollabDispatch D1: invited=ack-pending; accepted=acked; declined=no schedule. */
  rsvpStatus?: "invited" | "accepted" | "declined";
  kind?: "human" | "agent";
  deliveryStatus?: "pending" | "sent" | "failed";
};

export type MeetingScheduleProjection = {
  userId: string;
  status: "ok" | "failed";
  error?: string;
  atMs: number;
};

/** Server-issued one-shot ticket for meeting approve (mirrors daibai confirmation). */
export type MeetingConfirmationEnvelope = {
  proposalId: string;
  confirmationToken: string;
  payloadHash: string;
  expiresAtMs: number;
};

export type MeetingConfirmationDetail = {
  title: string;
  impact?: string;
  irreversible: boolean;
  expiresAtMs: number;
};

export type TaskCandidate = {
  kind: "task";
  title: string;
  assigneeUserId?: string;
  dueAt?: string;
  sourceText?: string;
};

export type MinutesDraft = {
  kind: "minutes_draft";
  summary: string;
  decisions: string[];
  actionItems: TaskCandidate[];
};

export type Meeting = {
  id: string;
  organizerUserId: string;
  tenantId?: string;
  spaceId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone: string;
  location?: string;
  meetingMode?: "online" | "offline";
  joinUrl?: string;
  externalMeetingCode?: string;
  agenda?: string[];
  status: MeetingStatus;
  attendees: MeetingAttendee[];
  scheduleProjections?: MeetingScheduleProjection[];
  reminderJobIds?: string[];
  minutesRef?: string;
  minutes?: MinutesDraft;
  createdAt: string;
  updatedAt: string;
};

export type TaskAssignmentStatus = "pending" | "accepted" | "running" | "completed" | "rejected";

export type TaskAssignment = {
  id: string;
  organizationId: string;
  title: string;
  ownerAgentId: string;
  createdByAgentId: string;
  status: TaskAssignmentStatus;
  createdAt: string;
  updatedAt: string;
  ackRequired: boolean;
  acknowledgedAt?: string;
  completedAt?: string;
  notes?: string;
  assigneeUserId?: string;
  dueAt?: string;
  sourceRef?: { kind: "meeting"; id: string };
};

// ── Request / Response ─────────────────────────────────────────────────────

export type MeetingCreateRequest = {
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone?: string;
  spaceId?: string;
  location?: string;
  meetingMode?: "online" | "offline";
  joinUrl?: string;
  attendees?: MeetingAttendee[];
};
export type MeetingResponse = { meeting: Meeting };
export type MeetingListResponse = { meetings: Meeting[] };

export type MeetingApproveRequest = {
  id: string;
  proposalId?: string;
  confirmationToken?: string;
  /** SPEC §5.1: dismiss confirm card / invalidate tickets without confirming. */
  dismissConfirmation?: boolean;
};

export type MeetingApprovePendingResponse = {
  status: "pending_confirmation";
  meeting: Meeting;
  confirmation: MeetingConfirmationEnvelope;
  confirmationDetail?: MeetingConfirmationDetail;
  message: string;
};

export type MeetingDeliveryProgress = {
  totalRecipients?: number;
  deliveredCount: number;
  failedCount: number;
  pendingCount?: number;
};

/** Token-free pause-release wake payload from meeting.approve success. */
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

export type MeetingApproveConfirmedResponse = {
  status: "confirmed";
  meeting: Meeting;
  scheduledCount: number;
  scheduleComplete: boolean;
  deliveredCount?: number;
  failedCount?: number;
  deliveryProgress?: MeetingDeliveryProgress;
  resumeContinuation?: MeetingConfirmResumeContinuation;
};

export type MeetingApproveDismissedResponse = {
  status: "confirmation_cancelled";
  meetingId: string;
  meeting: Meeting;
  invalidatedTickets: number;
};

export type MeetingApproveResponse =
  | MeetingApprovePendingResponse
  | MeetingApproveConfirmedResponse
  | MeetingApproveDismissedResponse;

export type MeetingReplayScheduleResponse = {
  meeting: Meeting;
  scheduledCount: number;
  scheduleComplete: boolean;
};

export type MeetingRecipientDecisionRequest = { id: string };
export type MeetingAckResponse = {
  status: "acked" | "declined";
  meeting: Meeting;
  scheduled: boolean;
  scheduleProjection?: MeetingScheduleProjection;
};

/** submit/start/cancel/distribute responses (scheduledCount; taskCount on distribute/cancel). */
export type MeetingTransitionResponse = {
  meeting: Meeting;
  scheduledCount: number;
  taskCount?: number;
};

export type MeetingMinuteRequest = { id: string; minutes: MinutesDraft };

export type MeetingGenerateMinutesRequest = {
  transcript: string;
  meetingId?: string;
  meetingTitle?: string;
  attendeeUserIds?: string[];
};

export type MeetingGenerateMinutesResponse =
  | { status: "produced"; draft: MinutesDraft }
  | { status: "unavailable"; reason?: string }
  | { status: "invalid"; errors?: string[] }
  | { status: "skipped" }
  | { status: "denied"; reason?: string; message?: string }
  | { status: "failed"; message?: string };

export type TaskMutateRequest = { organizationId: string; id: string };
export type TaskResponse = { task: TaskAssignment };
export type TaskListResponse = { tasks: TaskAssignment[] };

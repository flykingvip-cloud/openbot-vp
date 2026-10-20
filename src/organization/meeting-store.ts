import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { MinutesDraft } from "./lifecycle-candidates.js";
import type { MeetingMode } from "./meeting-mode.js";

export type { MeetingMode } from "./meeting-mode.js";

/**
 * Meeting domain (Phase B) — the deterministic "meeting shell". A `Meeting` is a
 * organizer-owned scheduling object with a minimal lifecycle state machine; there
 * is NO LLM here. The post-meeting half (in_progress / minuted / distributed) and
 * any task fan-out are deferred to Phase C.
 *
 * Lifecycle:
 *   draft ──submit──► pending_approval ──approve──► confirmed ──remind──► reminded
 *     │                     │                          │                    │
 *     └─────────────────────┴──────────cancel──────────┴────────────────────┘
 *
 * CollabDispatch adapter (Sprint D1 — docs/design/org-collab-dispatch-dev-2026-09-27.md):
 * `confirmed` means the organizer **released/approved** the invite, NOT that every
 * attendee already has a ScheduleEntry. Release side effects write the organizer's
 * schedule + mark recipients ack-pending; each recipient's ScheduleEntry is upserted
 * only after that recipient acks (`rsvpStatus: accepted`). Decline writes no schedule.
 *
 * Stored per organizer (keyed by `organizerUserId`), mirroring the schedule store:
 * approve/cancel/list resolve the organizer actor and open exactly that organizer's
 * file. Recipient ack/decline mutate the organizer-owned roster (rsvpStatus) and
 * then project into the recipient's own schedule store.
 *
 * `startAtMs`/`endAtMs` realize the design's `startAt`/`endAt` as ms-epoch numbers.
 */

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
/**
 * Recipient ack projection for CollabDispatch (D1).
 * - `invited`  = ack-pending (after organizer release; no ScheduleEntry yet)
 * - `accepted` = acked (ScheduleEntry may be written for this attendee)
 * - `declined` = declined (never write ScheduleEntry for this attendee)
 */
export type MeetingRsvpStatus = "invited" | "accepted" | "declined";

export type MeetingRecipientKind = "human" | "agent";

export type MeetingAttendee = {
  userId: string;
  role: MeetingAttendeeRole;
  rsvpStatus: MeetingRsvpStatus;
  /**
   * CollabDispatch recipient kind. Agents default to auto-ack on release (D1).
   * Omitted/unknown → treated as human (explicit ack required).
   */
  kind?: MeetingRecipientKind;
  /** Delivery outcome after organizer release (D1 stub / D2 full channel). */
  deliveryStatus?: "pending" | "sent" | "failed";
};

export type MeetingScheduleProjection = {
  userId: string;
  status: "ok" | "failed";
  error?: string;
  atMs: number;
};

export type Meeting = {
  id: string;
  organizerUserId: string;
  tenantId?: string;
  /** Collaboration space the meeting was convened from, when applicable. */
  spaceId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone: string;
  /** Free-text place (room / "线上" / campus). */
  location?: string;
  /**
   * Explicit online|offline. Prefer this over location regex (confirmation-card SPEC).
   * Legacy rows may omit it; resolve via `resolveMeetingMode`.
   */
  meetingMode?: MeetingMode;
  /** Join link for online meetings. */
  joinUrl?: string;
  /** External provider that created the online room (e.g. tencent-meeting). */
  externalMeetingProvider?: string;
  /** Provider-native meeting id (for cancel/sync). */
  externalMeetingId?: string;
  /** Provider meeting code (optional display / lookup). */
  externalMeetingCode?: string;
  /** Ordered agenda bullets shown in the confirmation template. */
  agenda?: string[];
  status: MeetingStatus;
  attendees: MeetingAttendee[];
  /**
   * Per-attendee schedule projection outcome (organizer on release; recipients
   * after ack). Missing/failed rows for eligible users can be compensated via
   * `replayMeetingScheduleFanOut` without re-entering the status machine.
   * Under CollabDispatch D1, `confirmed` alone does NOT imply all attendees are
   * present here — only organizer + acked recipients should be.
   */
  scheduleProjections?: MeetingScheduleProjection[];
  /** Cron job ids for the pre-meeting reminder(s); cleared on cancel (Phase B1/B2). */
  reminderJobIds?: string[];
  /** Reference to the minutes deliverable/record once minuted (Phase C2; set on `minuted`). */
  minutesRef?: string;
  /** The validated minutes content attached on `minuted` (Phase C3b; awaits confirmation). */
  minutes?: MinutesDraft;
  createdAt: string;
  updatedAt: string;
};

type StoredMeetings = {
  meetings?: Meeting[];
};

/** Allowed status transitions (state machine edges). */
export const MEETING_STATUS_TRANSITIONS: Record<MeetingStatus, readonly MeetingStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["confirmed", "cancelled"],
  confirmed: ["reminded", "cancelled"],
  reminded: ["in_progress", "cancelled"],
  in_progress: ["minuted", "cancelled"],
  minuted: ["distributed", "cancelled"],
  distributed: ["cancelled"],
  cancelled: [],
};

const ATTENDEE_ROLES = new Set<MeetingAttendeeRole>(["organizer", "required", "optional"]);
const RSVP_STATUSES = new Set<MeetingRsvpStatus>(["invited", "accepted", "declined"]);
const MEETING_STATUSES = new Set<MeetingStatus>([
  "draft",
  "pending_approval",
  "confirmed",
  "reminded",
  "in_progress",
  "minuted",
  "distributed",
  "cancelled",
]);

export class MeetingTransitionError extends Error {}

function nowIso(now?: Date | string): string {
  return typeof now === "string" ? now : (now ?? new Date()).toISOString();
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Normalizes the attendee roster: the organizer is always present as
 * `role: "organizer"` (rsvp accepted); other attendees are deduped by user id and
 * coerced to `required`/`optional` (never `organizer`), rsvp defaulting to invited.
 */
function normalizeAttendees(
  organizerUserId: string,
  raw: ReadonlyArray<{
    userId: string;
    role?: MeetingAttendeeRole;
    rsvpStatus?: MeetingRsvpStatus;
    kind?: MeetingRecipientKind;
  }>,
): MeetingAttendee[] {
  const organizerKey = normalizeIdentity(organizerUserId);
  const byUser = new Map<string, MeetingAttendee>();
  byUser.set(organizerKey, {
    userId: organizerUserId.trim(),
    role: "organizer",
    rsvpStatus: "accepted",
    kind: "human",
  });
  for (const entry of raw) {
    const userId = entry.userId?.trim();
    if (!userId) {
      continue;
    }
    const key = normalizeIdentity(userId);
    if (key === organizerKey) {
      continue;
    }
    const kind = entry.kind === "agent" ? "agent" : inferMeetingRecipientKind(userId);
    byUser.set(key, {
      userId,
      role: entry.role === "optional" ? "optional" : "required",
      rsvpStatus:
        entry.rsvpStatus && RSVP_STATUSES.has(entry.rsvpStatus) ? entry.rsvpStatus : "invited",
      kind,
    });
  }
  return [...byUser.values()];
}

/** Infer agent recipients from common id prefixes when kind is omitted. */
export function inferMeetingRecipientKind(userId: string): MeetingRecipientKind {
  const id = userId.trim();
  if (/^(agent|bot|seat)[-_:]/i.test(id)) {
    return "agent";
  }
  return "human";
}

/**
 * Historical compatibility (design §12.5): confirmed meetings that already have
 * ScheduleEntry projections for attendees are treated as already-acked.
 */
export function reconcileHistoricalRecipientAcks(meeting: Meeting): Meeting {
  if (
    meeting.status === "draft" ||
    meeting.status === "pending_approval" ||
    meeting.status === "cancelled"
  ) {
    return meeting;
  }
  const okIds = new Set(
    (meeting.scheduleProjections ?? [])
      .filter((row) => row.status === "ok")
      .map((row) => normalizeIdentity(row.userId)),
  );
  if (okIds.size === 0) {
    return meeting;
  }
  const organizerKey = normalizeIdentity(meeting.organizerUserId);
  let changed = false;
  const attendees = meeting.attendees.map((attendee) => {
    const key = normalizeIdentity(attendee.userId);
    if (key === organizerKey) {
      return attendee;
    }
    if (attendee.rsvpStatus === "invited" && okIds.has(key)) {
      changed = true;
      return { ...attendee, rsvpStatus: "accepted" as const };
    }
    return attendee;
  });
  if (!changed) {
    return meeting;
  }
  return { ...meeting, attendees, updatedAt: nowIso() };
}

function normalizeAgenda(raw: ReadonlyArray<string> | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  const agenda = raw.map((item) => item.trim()).filter(Boolean);
  return agenda.length > 0 ? agenda : undefined;
}

export function createMeeting(params: {
  organizerUserId: string;
  tenantId?: string;
  spaceId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone?: string;
  location?: string;
  meetingMode?: MeetingMode;
  joinUrl?: string;
  agenda?: ReadonlyArray<string>;
  attendees?: ReadonlyArray<{
    userId: string;
    role?: MeetingAttendeeRole;
    rsvpStatus?: MeetingRsvpStatus;
    kind?: MeetingRecipientKind;
  }>;
  id?: string;
  now?: Date | string;
}): Meeting {
  const createdAt = nowIso(params.now);
  const organizerUserId = params.organizerUserId.trim();
  const tenantId = params.tenantId?.trim();
  const spaceId = params.spaceId?.trim();
  const location = params.location?.trim();
  const meetingMode = params.meetingMode;
  const joinUrl = params.joinUrl?.trim();
  const agenda = normalizeAgenda(params.agenda);
  return {
    id: params.id?.trim() || randomUUID(),
    organizerUserId,
    ...(tenantId ? { tenantId } : {}),
    ...(spaceId ? { spaceId } : {}),
    title: params.title.trim(),
    startAtMs: params.startAtMs,
    ...(params.endAtMs !== undefined ? { endAtMs: params.endAtMs } : {}),
    timezone: params.timezone?.trim() || "UTC",
    ...(location ? { location } : {}),
    ...(meetingMode === "online" || meetingMode === "offline" ? { meetingMode } : {}),
    ...(joinUrl ? { joinUrl } : {}),
    ...(agenda ? { agenda } : {}),
    status: "draft",
    attendees: normalizeAttendees(organizerUserId, params.attendees ?? []),
    createdAt,
    updatedAt: createdAt,
  };
}

export function canTransitionMeeting(from: MeetingStatus, to: MeetingStatus): boolean {
  return MEETING_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Pure status transition. Throws `MeetingTransitionError` on an illegal edge so the
 * caller (RPC) maps it to an error response rather than silently corrupting state.
 */
export function transitionMeeting(
  meeting: Meeting,
  to: MeetingStatus,
  opts?: {
    now?: Date | string;
    reminderJobIds?: string[];
    minutesRef?: string;
    minutes?: MinutesDraft;
  },
): Meeting {
  if (!canTransitionMeeting(meeting.status, to)) {
    throw new MeetingTransitionError(`illegal meeting transition: ${meeting.status} -> ${to}`);
  }
  return {
    ...meeting,
    status: to,
    updatedAt: nowIso(opts?.now),
    ...(opts?.reminderJobIds ? { reminderJobIds: opts.reminderJobIds } : {}),
    ...(opts?.minutesRef !== undefined ? { minutesRef: opts.minutesRef } : {}),
    ...(opts?.minutes !== undefined ? { minutes: opts.minutes } : {}),
  };
}

function isMeeting(value: unknown): value is Meeting {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.organizerUserId === "string" &&
    typeof record.title === "string" &&
    typeof record.startAtMs === "number" &&
    Number.isFinite(record.startAtMs) &&
    typeof record.status === "string" &&
    MEETING_STATUSES.has(record.status as MeetingStatus) &&
    Array.isArray(record.attendees) &&
    record.attendees.every(
      (a) =>
        a &&
        typeof a === "object" &&
        typeof (a as MeetingAttendee).userId === "string" &&
        ATTENDEE_ROLES.has((a as MeetingAttendee).role) &&
        RSVP_STATUSES.has((a as MeetingAttendee).rsvpStatus),
    )
  );
}

function resolveMeetingsDir(organizerUserId: string): string {
  return path.join(resolveStateDir(), "meetings", encodePathSegment(organizerUserId.trim()));
}

function getMeetingsFile(organizerUserId: string): string {
  return path.join(resolveMeetingsDir(organizerUserId), "meetings.json");
}

/**
 * Reads a single organizer's meetings. Missing/corrupt file yields an empty list.
 * Defensively drops rows whose `organizerUserId` does not match the file's owner.
 */
export async function readOrganizerMeetings(organizerUserId: string): Promise<Meeting[]> {
  if (!organizerUserId.trim()) {
    return [];
  }
  try {
    const value = JSON.parse(await fs.readFile(getMeetingsFile(organizerUserId), "utf8")) as
      | StoredMeetings
      | unknown[];
    const meetings: unknown[] = Array.isArray(value)
      ? value
      : Array.isArray(value.meetings)
        ? (value.meetings ?? [])
        : [];
    const ownerKey = normalizeIdentity(organizerUserId);
    return meetings
      .filter(isMeeting)
      .filter((meeting) => normalizeIdentity(meeting.organizerUserId) === ownerKey);
  } catch {
    return [];
  }
}

export async function writeOrganizerMeetings(
  organizerUserId: string,
  meetings: Meeting[],
): Promise<void> {
  const dir = resolveMeetingsDir(organizerUserId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    getMeetingsFile(organizerUserId),
    `${JSON.stringify({ meetings }, null, 2)}\n`,
  );
}

export async function upsertMeeting(meeting: Meeting): Promise<Meeting> {
  const persisted: Meeting = { ...meeting, id: meeting.id.trim() || randomUUID() };
  const existing = await readOrganizerMeetings(persisted.organizerUserId);
  const byId = new Map(existing.map((item) => [item.id, item]));
  byId.set(persisted.id, persisted);
  await writeOrganizerMeetings(persisted.organizerUserId, [...byId.values()]);
  return persisted;
}

/**
 * Enumerates every organizer's meetings (across all per-organizer files). Used by
 * the maintenance reminder tick to find meetings due for a pre-meeting reminder.
 * A missing meetings root yields an empty list.
 */
/**
 * Pure roster update: set one attendee's rsvp (+ optional deliveryStatus).
 * Throws when the user is not on the roster. Organizer rsvp stays `accepted`.
 */
export function updateMeetingAttendeeRsvp(
  meeting: Meeting,
  userId: string,
  rsvpStatus: MeetingRsvpStatus,
  opts?: { deliveryStatus?: MeetingAttendee["deliveryStatus"]; now?: Date | string },
): Meeting {
  const key = normalizeIdentity(userId);
  if (!key) {
    throw new MeetingTransitionError("attendee userId is required");
  }
  const organizerKey = normalizeIdentity(meeting.organizerUserId);
  let found = false;
  const attendees = meeting.attendees.map((attendee) => {
    if (normalizeIdentity(attendee.userId) !== key) {
      return attendee;
    }
    found = true;
    if (key === organizerKey) {
      return {
        ...attendee,
        role: "organizer" as const,
        rsvpStatus: "accepted" as const,
        ...(opts?.deliveryStatus ? { deliveryStatus: opts.deliveryStatus } : {}),
      };
    }
    return {
      ...attendee,
      rsvpStatus,
      ...(opts?.deliveryStatus ? { deliveryStatus: opts.deliveryStatus } : {}),
    };
  });
  if (!found) {
    throw new MeetingTransitionError(`attendee not on meeting roster: ${userId}`);
  }
  return {
    ...meeting,
    attendees,
    updatedAt: nowIso(opts?.now),
  };
}

/**
 * Marks every non-organizer attendee as ack-pending (`invited`) and delivery
 * pending on organizer release. Organizer stays accepted. Idempotent.
 */
export function markRecipientsAckPending(meeting: Meeting, now?: Date | string): Meeting {
  const reconciled = reconcileHistoricalRecipientAcks(meeting);
  const organizerKey = normalizeIdentity(reconciled.organizerUserId);
  const attendees = reconciled.attendees.map((attendee) => {
    if (normalizeIdentity(attendee.userId) === organizerKey) {
      return {
        ...attendee,
        role: "organizer" as const,
        rsvpStatus: "accepted" as const,
      };
    }
    // Preserve an already-acked/declined status on replay; only reset delivery
    // when still invited/none.
    if (attendee.rsvpStatus === "accepted" || attendee.rsvpStatus === "declined") {
      return attendee;
    }
    return {
      ...attendee,
      rsvpStatus: "invited" as const,
      deliveryStatus: attendee.deliveryStatus ?? "pending",
    };
  });
  return {
    ...reconciled,
    attendees,
    updatedAt: nowIso(now),
  };
}

/** Locates a meeting by id across all organizer files (recipient ack path). */
export async function findMeetingById(meetingId: string): Promise<Meeting | null> {
  const id = meetingId.trim();
  if (!id) {
    return null;
  }
  const all = await listAllMeetings();
  return all.find((meeting) => meeting.id === id) ?? null;
}

export async function listAllMeetings(): Promise<Meeting[]> {
  const root = path.join(resolveStateDir(), "meetings");
  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(root);
  } catch {
    return [];
  }
  const all: Meeting[] = [];
  for (const dir of dirEntries) {
    let organizerUserId: string;
    try {
      organizerUserId = decodeURIComponent(dir);
    } catch {
      continue;
    }
    all.push(...(await readOrganizerMeetings(organizerUserId)));
  }
  return all;
}

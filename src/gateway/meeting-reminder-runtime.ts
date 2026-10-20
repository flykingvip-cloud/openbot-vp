import {
  listAllMeetings,
  type Meeting,
  transitionMeeting,
  upsertMeeting,
} from "../organization/meeting-store.js";

/**
 * Meeting pre-meeting reminder (Phase B2) — deterministic, no LLM, no per-meeting
 * daemon. A single maintenance tick scans every organizer's meetings, finds the
 * confirmed ones whose reminder window has opened, flips them to `reminded`, and
 * notifies attendees via the injected `notify` (the gateway wires this to a
 * broadcast). Cancelled meetings never qualify (only `confirmed` is selected), so
 * cancel needs no separate reminder cleanup.
 */

export const DEFAULT_REMINDER_LEAD_MS = 10 * 60 * 1000;

export type MeetingReminderTickDeps = {
  /** Source of meetings to scan. Default: every organizer's stored meetings. */
  listMeetings?: () => Promise<Meeting[]>;
  /** Persist a transitioned meeting. Default: the meeting store upsert. */
  saveMeeting?: (meeting: Meeting) => Promise<Meeting>;
  /** Side-channel to notify attendees (gateway broadcast). Optional. */
  notify?: (meeting: Meeting) => void;
  /** "now" injection for tests. Default: Date.now. */
  now?: () => number;
  /** How far before start the reminder fires. Default: 10 minutes. */
  leadMs?: number;
};

/**
 * Pure selector: confirmed meetings whose reminder window has opened
 * (`now >= startAt - lead`). Already-reminded / cancelled meetings are excluded by
 * the status check, so a meeting fires at most once.
 */
export function selectMeetingsDueForReminder(
  meetings: ReadonlyArray<Meeting>,
  nowMs: number,
  leadMs: number,
): Meeting[] {
  return meetings.filter(
    (meeting) =>
      meeting.status === "confirmed" &&
      Number.isFinite(meeting.startAtMs) &&
      nowMs >= meeting.startAtMs - leadMs,
  );
}

/**
 * Scans + reminds due meetings. Returns the count reminded. Per-meeting failures
 * are isolated (a bad transition/persist for one meeting does not block the rest).
 */
export async function runMeetingReminderTick(deps: MeetingReminderTickDeps = {}): Promise<number> {
  const listMeetings = deps.listMeetings ?? listAllMeetings;
  const saveMeeting = deps.saveMeeting ?? upsertMeeting;
  const now = deps.now ?? (() => Date.now());
  const leadMs = deps.leadMs ?? DEFAULT_REMINDER_LEAD_MS;

  let meetings: Meeting[] = [];
  try {
    meetings = await listMeetings();
  } catch {
    return 0;
  }
  const nowMs = now();
  const due = selectMeetingsDueForReminder(meetings, nowMs, leadMs);
  let reminded = 0;
  for (const meeting of due) {
    try {
      const next = transitionMeeting(meeting, "reminded", { now: new Date(nowMs).toISOString() });
      await saveMeeting(next);
      deps.notify?.(next);
      reminded += 1;
    } catch {
      // Skip individual failures; the next tick retries (status stays confirmed).
    }
  }
  return reminded;
}

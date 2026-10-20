// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMeeting, type Meeting, transitionMeeting } from "../organization/meeting-store.js";
import {
  runMeetingReminderTick,
  selectMeetingsDueForReminder,
} from "./meeting-reminder-runtime.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function confirmedMeeting(params: { id: string; startAtMs: number }): Meeting {
  const draft = createMeeting({
    organizerUserId: "user-1",
    title: "Sync",
    startAtMs: params.startAtMs,
    id: params.id,
    attendees: [{ userId: "user-2" }],
  });
  return transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed");
}

describe("selectMeetingsDueForReminder", () => {
  it("selects confirmed meetings whose reminder window opened", () => {
    const due = confirmedMeeting({ id: "due", startAtMs: NOW + 5 * MIN });
    const notYet = confirmedMeeting({ id: "later", startAtMs: NOW + 30 * MIN });
    const result = selectMeetingsDueForReminder([due, notYet], NOW, 10 * MIN);
    expect(result.map((m) => m.id)).toEqual(["due"]);
  });

  it("excludes non-confirmed meetings", () => {
    const draft = createMeeting({ organizerUserId: "u", title: "x", startAtMs: NOW, id: "d" });
    expect(selectMeetingsDueForReminder([draft], NOW, 10 * MIN)).toEqual([]);
  });

  it("excludes already-reminded and cancelled meetings", () => {
    const reminded = transitionMeeting(confirmedMeeting({ id: "r", startAtMs: NOW }), "reminded");
    const cancelled = transitionMeeting(confirmedMeeting({ id: "c", startAtMs: NOW }), "cancelled");
    expect(selectMeetingsDueForReminder([reminded, cancelled], NOW, 10 * MIN)).toEqual([]);
  });
});

describe("runMeetingReminderTick", () => {
  it("flips due meetings to reminded, persists, notifies, and returns the count", async () => {
    const due = confirmedMeeting({ id: "due", startAtMs: NOW + 5 * MIN });
    const later = confirmedMeeting({ id: "later", startAtMs: NOW + 60 * MIN });
    const saved: Meeting[] = [];
    const notified: string[] = [];
    const count = await runMeetingReminderTick({
      listMeetings: async () => [due, later],
      saveMeeting: async (m) => {
        saved.push(m);
        return m;
      },
      notify: (m) => notified.push(m.id),
      now: () => NOW,
      leadMs: 10 * MIN,
    });
    expect(count).toBe(1);
    expect(saved.map((m) => m.id)).toEqual(["due"]);
    expect(saved[0]?.status).toBe("reminded");
    expect(notified).toEqual(["due"]);
  });

  it("does not re-remind an already-reminded meeting", async () => {
    const reminded = transitionMeeting(confirmedMeeting({ id: "r", startAtMs: NOW }), "reminded");
    const count = await runMeetingReminderTick({
      listMeetings: async () => [reminded],
      saveMeeting: async (m) => m,
      now: () => NOW,
      leadMs: 10 * MIN,
    });
    expect(count).toBe(0);
  });

  it("isolates per-meeting save failures", async () => {
    const a = confirmedMeeting({ id: "a", startAtMs: NOW });
    const b = confirmedMeeting({ id: "b", startAtMs: NOW });
    let calls = 0;
    const count = await runMeetingReminderTick({
      listMeetings: async () => [a, b],
      saveMeeting: async (m) => {
        calls += 1;
        if (m.id === "a") {
          throw new Error("disk full");
        }
        return m;
      },
      now: () => NOW,
      leadMs: 10 * MIN,
    });
    expect(calls).toBe(2);
    expect(count).toBe(1);
  });

  it("returns 0 when listing meetings throws", async () => {
    const count = await runMeetingReminderTick({
      listMeetings: async () => {
        throw new Error("fs unavailable");
      },
      now: () => NOW,
    });
    expect(count).toBe(0);
  });
});

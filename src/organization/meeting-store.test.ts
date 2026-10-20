// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canTransitionMeeting,
  createMeeting,
  inferMeetingRecipientKind,
  markRecipientsAckPending,
  MeetingTransitionError,
  readOrganizerMeetings,
  reconcileHistoricalRecipientAcks,
  transitionMeeting,
  updateMeetingAttendeeRsvp,
  upsertMeeting,
  writeOrganizerMeetings,
} from "./meeting-store.js";

let stateDir: string;
let prevStateDir: string | undefined;

beforeEach(() => {
  prevStateDir = process.env.OPENBOT_STATE_DIR;
  stateDir = mkdtempSync(path.join(tmpdir(), "meeting-store-"));
  process.env.OPENBOT_STATE_DIR = stateDir;
});

afterEach(() => {
  if (prevStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = prevStateDir;
  }
  rmSync(stateDir, { recursive: true, force: true });
});

describe("createMeeting", () => {
  it("creates a draft meeting with the organizer as an organizer-role attendee", () => {
    const meeting = createMeeting({
      organizerUserId: "user-1",
      title: "  Kickoff  ",
      startAtMs: 1_700_000_000_000,
      attendees: [{ userId: "user-2" }, { userId: "user-3", role: "optional" }],
    });
    expect(meeting.status).toBe("draft");
    expect(meeting.title).toBe("Kickoff");
    expect(meeting.timezone).toBe("UTC");
    expect(meeting.id).toBeTruthy();
    const organizer = meeting.attendees.find((a) => a.userId === "user-1");
    expect(organizer).toMatchObject({ role: "organizer", rsvpStatus: "accepted" });
    expect(meeting.attendees.find((a) => a.userId === "user-2")).toMatchObject({
      role: "required",
      rsvpStatus: "invited",
    });
    expect(meeting.attendees.find((a) => a.userId === "user-3")?.role).toBe("optional");
  });

  it("dedupes the organizer if also listed as an attendee, keeping organizer role", () => {
    const meeting = createMeeting({
      organizerUserId: "user-1",
      title: "x",
      startAtMs: 1,
      attendees: [{ userId: "user-1", role: "required" }],
    });
    expect(meeting.attendees.filter((a) => a.userId === "user-1")).toHaveLength(1);
    expect(meeting.attendees[0]).toMatchObject({ userId: "user-1", role: "organizer" });
  });
});

describe("meeting state machine", () => {
  it("allows the designed forward edges", () => {
    expect(canTransitionMeeting("draft", "pending_approval")).toBe(true);
    expect(canTransitionMeeting("pending_approval", "confirmed")).toBe(true);
    expect(canTransitionMeeting("confirmed", "reminded")).toBe(true);
  });

  it("allows cancel from any non-terminal state", () => {
    expect(canTransitionMeeting("draft", "cancelled")).toBe(true);
    expect(canTransitionMeeting("pending_approval", "cancelled")).toBe(true);
    expect(canTransitionMeeting("confirmed", "cancelled")).toBe(true);
    expect(canTransitionMeeting("reminded", "cancelled")).toBe(true);
  });

  it("rejects illegal edges", () => {
    expect(canTransitionMeeting("draft", "confirmed")).toBe(false);
    expect(canTransitionMeeting("confirmed", "pending_approval")).toBe(false);
    expect(canTransitionMeeting("cancelled", "confirmed")).toBe(false);
    expect(canTransitionMeeting("reminded", "confirmed")).toBe(false);
  });

  it("transitionMeeting advances status and bumps updatedAt on a legal edge", () => {
    const meeting = createMeeting({
      organizerUserId: "user-1",
      title: "x",
      startAtMs: 1,
      now: "2026-06-30T00:00:00.000Z",
    });
    const next = transitionMeeting(meeting, "pending_approval", {
      now: "2026-06-30T01:00:00.000Z",
    });
    expect(next.status).toBe("pending_approval");
    expect(next.updatedAt).toBe("2026-06-30T01:00:00.000Z");
  });

  it("transitionMeeting throws on an illegal edge", () => {
    const meeting = createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1 });
    expect(() => transitionMeeting(meeting, "confirmed")).toThrow(MeetingTransitionError);
  });

  it("records reminderJobIds when provided on transition", () => {
    const meeting = transitionMeeting(
      transitionMeeting(
        createMeeting({ organizerUserId: "u", title: "x", startAtMs: 1 }),
        "pending_approval",
      ),
      "confirmed",
      { reminderJobIds: ["cron-1"] },
    );
    expect(meeting.reminderJobIds).toEqual(["cron-1"]);
  });

  it("allows the back-half forward edges (reminded -> in_progress -> minuted -> distributed)", () => {
    expect(canTransitionMeeting("reminded", "in_progress")).toBe(true);
    expect(canTransitionMeeting("in_progress", "minuted")).toBe(true);
    expect(canTransitionMeeting("minuted", "distributed")).toBe(true);
  });

  it("allows cancel from the back-half non-terminal states", () => {
    expect(canTransitionMeeting("in_progress", "cancelled")).toBe(true);
    expect(canTransitionMeeting("minuted", "cancelled")).toBe(true);
  });

  it("allows only cancel from distributed (no forward/back edges)", () => {
    expect(canTransitionMeeting("distributed", "cancelled")).toBe(true);
    expect(canTransitionMeeting("distributed", "minuted")).toBe(false);
    expect(canTransitionMeeting("distributed", "in_progress")).toBe(false);
  });

  it("rejects skipping or reversing back-half states", () => {
    expect(canTransitionMeeting("reminded", "minuted")).toBe(false);
    expect(canTransitionMeeting("confirmed", "in_progress")).toBe(false);
    expect(canTransitionMeeting("minuted", "reminded")).toBe(false);
    expect(canTransitionMeeting("in_progress", "distributed")).toBe(false);
  });

  it("sets minutesRef when transitioning to minuted", () => {
    const draft = createMeeting({ organizerUserId: "u", title: "x", startAtMs: 1 });
    const reminded = transitionMeeting(
      transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed"),
      "reminded",
    );
    const minuted = transitionMeeting(transitionMeeting(reminded, "in_progress"), "minuted", {
      minutesRef: "deliverable-1",
    });
    expect(minuted.status).toBe("minuted");
    expect(minuted.minutesRef).toBe("deliverable-1");
  });
});

describe("meeting store", () => {
  it("returns empty for an organizer with no file", async () => {
    expect(await readOrganizerMeetings("nobody")).toEqual([]);
  });

  it("round-trips an upserted meeting", async () => {
    const meeting = createMeeting({ organizerUserId: "user-1", title: "Sync", startAtMs: 1 });
    await upsertMeeting(meeting);
    const read = await readOrganizerMeetings("user-1");
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ id: meeting.id, title: "Sync", status: "draft" });
  });

  it("replaces an existing meeting on upsert (same id)", async () => {
    const meeting = createMeeting({
      organizerUserId: "user-1",
      title: "x",
      startAtMs: 1,
      id: "m1",
    });
    await upsertMeeting(meeting);
    await upsertMeeting(transitionMeeting(meeting, "pending_approval"));
    const read = await readOrganizerMeetings("user-1");
    expect(read).toHaveLength(1);
    expect(read[0]?.status).toBe("pending_approval");
  });

  it("isolates meetings by organizer", async () => {
    await upsertMeeting(
      createMeeting({ organizerUserId: "user-1", title: "a", startAtMs: 1, id: "a" }),
    );
    await upsertMeeting(
      createMeeting({ organizerUserId: "user-2", title: "b", startAtMs: 1, id: "b" }),
    );
    expect((await readOrganizerMeetings("user-1")).map((m) => m.id)).toEqual(["a"]);
    expect((await readOrganizerMeetings("user-2")).map((m) => m.id)).toEqual(["b"]);
  });

  it("defensively drops a row whose organizerUserId does not match the file owner", async () => {
    const mine = createMeeting({
      organizerUserId: "user-1",
      title: "mine",
      startAtMs: 1,
      id: "mine",
    });
    const foreign = createMeeting({
      organizerUserId: "user-2",
      title: "foreign",
      startAtMs: 1,
      id: "foreign",
    });
    await writeOrganizerMeetings("user-1", [mine, foreign]);
    expect((await readOrganizerMeetings("user-1")).map((m) => m.id)).toEqual(["mine"]);
  });

  it("tolerates a corrupt file (returns empty)", async () => {
    await upsertMeeting(createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1 }));
    writeFileSync(path.join(stateDir, "meetings", "user-1", "meetings.json"), "not json{");
    expect(await readOrganizerMeetings("user-1")).toEqual([]);
  });
});

describe("CollabDispatch D1 attendee helpers", () => {
  it("markRecipientsAckPending keeps organizer accepted and recipients invited", () => {
    const meeting = createMeeting({
      organizerUserId: "user-1",
      title: "x",
      startAtMs: 1,
      attendees: [{ userId: "user-2" }],
    });
    const next = markRecipientsAckPending(meeting);
    expect(next.attendees.find((a) => a.userId === "user-1")?.rsvpStatus).toBe("accepted");
    expect(next.attendees.find((a) => a.userId === "user-2")).toMatchObject({
      rsvpStatus: "invited",
      deliveryStatus: "pending",
    });
  });

  it("updateMeetingAttendeeRsvp updates one recipient", () => {
    const meeting = createMeeting({
      organizerUserId: "user-1",
      title: "x",
      startAtMs: 1,
      attendees: [{ userId: "user-2" }],
    });
    const next = updateMeetingAttendeeRsvp(meeting, "user-2", "accepted");
    expect(next.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe("accepted");
  });

  it("infers agent kind from id prefixes and preserves explicit kind", () => {
    expect(inferMeetingRecipientKind("agent-bot-1")).toBe("agent");
    expect(inferMeetingRecipientKind("user-2")).toBe("human");
    const meeting = createMeeting({
      organizerUserId: "user-1",
      title: "x",
      startAtMs: 1,
      attendees: [{ userId: "user-2" }, { userId: "custom-bot", kind: "agent" }],
    });
    expect(meeting.attendees.find((a) => a.userId === "user-2")?.kind).toBe("human");
    expect(meeting.attendees.find((a) => a.userId === "custom-bot")?.kind).toBe("agent");
  });

  it("reconcileHistoricalRecipientAcks backfills accepted from ok projections", () => {
    const meeting = transitionMeeting(
      transitionMeeting(
        createMeeting({
          organizerUserId: "user-1",
          title: "x",
          startAtMs: 1,
          id: "m-h",
          attendees: [{ userId: "user-2" }],
        }),
        "pending_approval",
      ),
      "confirmed",
    );
    const legacy = {
      ...meeting,
      scheduleProjections: [{ userId: "user-2", status: "ok" as const, atMs: 1 }],
    };
    const next = reconcileHistoricalRecipientAcks(legacy);
    expect(next.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe("accepted");
    expect(Date.parse(next.updatedAt)).not.toBeNaN();
  });
});

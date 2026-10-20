// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C2)
// 会议后半段确定性转移：reminded -> in_progress -> minuted(+minutesRef) -> distributed。
// 真实 per-organizer store 往返（临时 state dir）；非法边抛错、未找到返回 not-found。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMeetingTransition,
  attachMeetingMinutes,
  distributeMeetingMinutes,
  startMeeting,
} from "./meeting-lifecycle.js";
import {
  createMeeting,
  MeetingTransitionError,
  transitionMeeting,
  upsertMeeting,
} from "./meeting-store.js";
import { readManagedOrganizationTaskAssignments } from "./task-assignment.js";

let stateDir: string;
let prevStateDir: string | undefined;

beforeEach(() => {
  prevStateDir = process.env.OPENBOT_STATE_DIR;
  stateDir = mkdtempSync(path.join(tmpdir(), "meeting-lifecycle-"));
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

async function persistRemindedMeeting(organizerUserId: string, id: string): Promise<void> {
  const draft = createMeeting({ organizerUserId, title: "Sync", startAtMs: 1, id });
  const reminded = transitionMeeting(
    transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed"),
    "reminded",
  );
  await upsertMeeting(reminded);
}

describe("meeting back-half lifecycle (Phase C2)", () => {
  it("drives reminded -> in_progress -> minuted(+minutesRef) -> distributed", async () => {
    await persistRemindedMeeting("user-1", "m1");

    const started = await startMeeting({ organizerUserId: "user-1", meetingId: "m1" });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.meeting.status).toBe("in_progress");
    }

    const minutesDraft = {
      kind: "minutes_draft" as const,
      summary: "We shipped v1.",
      decisions: ["ship v1"],
      actionItems: [{ kind: "task" as const, title: "follow up" }],
    };
    const minuted = await attachMeetingMinutes({
      organizerUserId: "user-1",
      meetingId: "m1",
      minutes: minutesDraft,
    });
    expect(minuted.ok).toBe(true);
    if (minuted.ok) {
      expect(minuted.meeting.status).toBe("minuted");
      expect(minuted.meeting.minutesRef).toBe("minutes:m1");
      expect(minuted.meeting.minutes?.summary).toBe("We shipped v1.");
    }

    const distributed = await distributeMeetingMinutes({
      organizerUserId: "user-1",
      meetingId: "m1",
    });
    expect(distributed.ok).toBe(true);
    if (distributed.ok) {
      expect(distributed.meeting.status).toBe("distributed");
      // minutes content + ref are preserved across the distribute transition.
      expect(distributed.meeting.minutesRef).toBe("minutes:m1");
      expect(distributed.meeting.minutes?.summary).toBe("We shipped v1.");
    }
  });

  it("returns not-found for an unknown meeting", async () => {
    const res = await startMeeting({ organizerUserId: "user-1", meetingId: "missing" });
    expect(res).toEqual({ ok: false, reason: "not-found" });
  });

  it("throws on an illegal edge (start on a draft meeting)", async () => {
    await upsertMeeting(
      createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1, id: "d1" }),
    );
    await expect(startMeeting({ organizerUserId: "user-1", meetingId: "d1" })).rejects.toThrow(
      MeetingTransitionError,
    );
  });
});

describe("meeting schedule fan-out compensation", () => {
  it("replays failed organizer projection without re-approving or writing ack-pending attendees", async () => {
    const { applyMeetingTransition, replayMeetingScheduleFanOut } =
      await import("./meeting-lifecycle.js");
    const { readUserScheduleEntries } = await import("./schedule-store.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Sync",
      startAtMs: Date.now() + 60_000,
      id: "m-replay",
      attendees: [{ userId: "user-2" }],
    });
    await upsertMeeting(transitionMeeting(draft, "pending_approval"));
    const confirmed = await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-replay",
      to: "confirmed",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    // Simulate organizer projection failure; user-2 remains ack-pending (no schedule).
    const failedMeeting = {
      ...confirmed.meeting,
      scheduleProjections: [
        {
          userId: "user-1",
          status: "failed" as const,
          error: "simulated",
          atMs: Date.now(),
        },
      ],
    };
    await upsertMeeting(failedMeeting);
    const { cancelScheduleEntry, meetingScheduleEntryId } = await import("./schedule-store.js");
    await cancelScheduleEntry({
      userId: "user-1",
      id: meetingScheduleEntryId("m-replay", "user-1"),
    });

    const replayed = await replayMeetingScheduleFanOut({
      organizerUserId: "user-1",
      meetingId: "m-replay",
    });
    expect(replayed.ok).toBe(true);
    if (replayed.ok) {
      expect(replayed.scheduleComplete).toBe(true);
      // Only organizer is eligible until recipients ack.
      expect(replayed.scheduledCount).toBe(1);
    }
    const user1 = await readUserScheduleEntries("user-1");
    expect(
      user1.some((entry) => entry.sourceRef.id === "m-replay" && entry.status === "confirmed"),
    ).toBe(true);
    const user2 = await readUserScheduleEntries("user-2");
    expect(user2.some((entry) => entry.sourceRef.id === "m-replay")).toBe(false);
  });
});

describe("CollabDispatch D1 meeting release + recipient ack", () => {
  it("confirm does not fan-out all attendee schedules; organizer gets schedule; recipients stay invited", async () => {
    const { applyMeetingTransition } = await import("./meeting-lifecycle.js");
    const { readUserScheduleEntries } = await import("./schedule-store.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Kickoff",
      startAtMs: Date.now() + 120_000,
      id: "m-d1",
      attendees: [{ userId: "user-2" }, { userId: "user-3" }],
    });
    await upsertMeeting(transitionMeeting(draft, "pending_approval"));
    const confirmed = await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-d1",
      to: "confirmed",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(confirmed.scheduledCount).toBe(1);
    expect(confirmed.meeting.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe(
      "invited",
    );
    expect(confirmed.meeting.attendees.find((a) => a.userId === "user-3")?.deliveryStatus).toBe(
      "sent",
    );
    const org = await readUserScheduleEntries("user-1");
    const a2 = await readUserScheduleEntries("user-2");
    const a3 = await readUserScheduleEntries("user-3");
    expect(org.some((e) => e.sourceRef.id === "m-d1" && e.status === "confirmed")).toBe(true);
    expect(a2.some((e) => e.sourceRef.id === "m-d1")).toBe(false);
    expect(a3.some((e) => e.sourceRef.id === "m-d1")).toBe(false);
  });

  it("recipient ack writes only that attendee schedule (idempotent)", async () => {
    const { applyMeetingTransition, applyMeetingRecipientDecision } =
      await import("./meeting-lifecycle.js");
    const { readUserScheduleEntries } = await import("./schedule-store.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Kickoff",
      startAtMs: Date.now() + 120_000,
      id: "m-ack",
      attendees: [{ userId: "user-2" }, { userId: "user-3" }],
    });
    await upsertMeeting(transitionMeeting(draft, "pending_approval"));
    await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-ack",
      to: "confirmed",
    });

    const acked = await applyMeetingRecipientDecision({
      actorUserId: "user-2",
      meetingId: "m-ack",
      decision: "accepted",
    });
    expect(acked.ok).toBe(true);
    if (!acked.ok) {
      return;
    }
    expect(acked.scheduled).toBe(true);
    expect(acked.meeting.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe("accepted");

    const again = await applyMeetingRecipientDecision({
      actorUserId: "user-2",
      meetingId: "m-ack",
      decision: "accepted",
    });
    expect(again.ok).toBe(true);

    const a2 = await readUserScheduleEntries("user-2");
    const a3 = await readUserScheduleEntries("user-3");
    expect(a2.filter((e) => e.sourceRef.id === "m-ack" && e.status === "confirmed")).toHaveLength(
      1,
    );
    expect(a3.some((e) => e.sourceRef.id === "m-ack")).toBe(false);
  });

  it("recipient decline does not write schedule", async () => {
    const { applyMeetingTransition, applyMeetingRecipientDecision } =
      await import("./meeting-lifecycle.js");
    const { readUserScheduleEntries } = await import("./schedule-store.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Kickoff",
      startAtMs: Date.now() + 120_000,
      id: "m-decline",
      attendees: [{ userId: "user-2" }],
    });
    await upsertMeeting(transitionMeeting(draft, "pending_approval"));
    await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-decline",
      to: "confirmed",
    });
    const declined = await applyMeetingRecipientDecision({
      actorUserId: "user-2",
      meetingId: "m-decline",
      decision: "declined",
    });
    expect(declined.ok).toBe(true);
    if (declined.ok) {
      expect(declined.scheduled).toBe(false);
      expect(declined.meeting.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe(
        "declined",
      );
    }
    const a2 = await readUserScheduleEntries("user-2");
    expect(a2.some((e) => e.sourceRef.id === "m-decline")).toBe(false);
  });

  it("illegal recipient decisions still fail", async () => {
    const { applyMeetingTransition, applyMeetingRecipientDecision } =
      await import("./meeting-lifecycle.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Kickoff",
      startAtMs: Date.now() + 120_000,
      id: "m-illegal",
      attendees: [{ userId: "user-2" }],
    });
    await upsertMeeting(draft);
    expect(
      await applyMeetingRecipientDecision({
        actorUserId: "user-2",
        meetingId: "m-illegal",
        decision: "accepted",
      }),
    ).toEqual({ ok: false, reason: "not-released" });

    await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-illegal",
      to: "pending_approval",
    });
    await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-illegal",
      to: "confirmed",
    });
    expect(
      await applyMeetingRecipientDecision({
        actorUserId: "user-1",
        meetingId: "m-illegal",
        decision: "accepted",
      }),
    ).toEqual({ ok: false, reason: "organizer-self" });
    expect(
      await applyMeetingRecipientDecision({
        actorUserId: "user-99",
        meetingId: "m-illegal",
        decision: "accepted",
      }),
    ).toEqual({ ok: false, reason: "not-attendee" });
    expect(
      await applyMeetingRecipientDecision({
        actorUserId: "user-2",
        meetingId: "missing",
        decision: "accepted",
      }),
    ).toEqual({ ok: false, reason: "not-found" });

    await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-illegal",
      to: "cancelled",
    });
    expect(
      await applyMeetingRecipientDecision({
        actorUserId: "user-2",
        meetingId: "m-illegal",
        decision: "accepted",
      }),
    ).toEqual({ ok: false, reason: "cancelled" });
  });

  it("agent recipients auto-ack on release and get schedule; humans stay pending", async () => {
    const { applyMeetingTransition } = await import("./meeting-lifecycle.js");
    const { readUserScheduleEntries } = await import("./schedule-store.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Agent sync",
      startAtMs: Date.now() + 120_000,
      id: "m-agent",
      attendees: [
        { userId: "user-2", kind: "human" },
        { userId: "agent-bot-1", kind: "agent" },
      ],
    });
    await upsertMeeting(transitionMeeting(draft, "pending_approval"));
    const confirmed = await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-agent",
      to: "confirmed",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(confirmed.meeting.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe(
      "invited",
    );
    expect(confirmed.meeting.attendees.find((a) => a.userId === "agent-bot-1")?.rsvpStatus).toBe(
      "accepted",
    );
    const human = await readUserScheduleEntries("user-2");
    const agent = await readUserScheduleEntries("agent-bot-1");
    expect(human.some((e) => e.sourceRef.id === "m-agent")).toBe(false);
    expect(agent.some((e) => e.sourceRef.id === "m-agent" && e.status === "confirmed")).toBe(true);
  });

  it("historical confirmed projections are treated as already acked", async () => {
    const { applyMeetingRecipientDecision } = await import("./meeting-lifecycle.js");
    const { reconcileHistoricalRecipientAcks } = await import("./meeting-store.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Legacy",
      startAtMs: Date.now() + 120_000,
      id: "m-legacy",
      attendees: [{ userId: "user-2" }],
    });
    const confirmed = transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed");
    // Simulate pre-D1 fan-out: recipient still invited but already has ok projection.
    const legacy = {
      ...confirmed,
      attendees: confirmed.attendees.map((a) =>
        a.userId === "user-2" ? { ...a, rsvpStatus: "invited" as const } : a,
      ),
      scheduleProjections: [
        { userId: "user-1", status: "ok" as const, atMs: Date.now() },
        { userId: "user-2", status: "ok" as const, atMs: Date.now() },
      ],
    };
    const reconciled = reconcileHistoricalRecipientAcks(legacy);
    expect(reconciled.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe("accepted");
    await upsertMeeting(legacy);
    const again = await applyMeetingRecipientDecision({
      actorUserId: "user-2",
      meetingId: "m-legacy",
      decision: "accepted",
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.meeting.attendees.find((a) => a.userId === "user-2")?.rsvpStatus).toBe(
        "accepted",
      );
    }
  });

  it("illegal meeting status transitions still fail", async () => {
    await upsertMeeting(
      createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1, id: "d-ill" }),
    );
    await expect(
      applyMeetingTransition({
        organizerUserId: "user-1",
        meetingId: "d-ill",
        to: "confirmed",
      }),
    ).rejects.toThrow(MeetingTransitionError);
  });
});

describe("meeting task fan-out (Phase C4)", () => {
  const minutes = {
    kind: "minutes_draft" as const,
    summary: "s",
    decisions: [],
    actionItems: [
      {
        kind: "task" as const,
        title: "T1",
        assigneeUserId: "user-2",
        dueAt: "2026-07-10T00:00:00.000Z",
      },
      { kind: "task" as const, title: "T2", assigneeUserId: "user-99" }, // not in roster -> dropped
      { kind: "task" as const, title: "T3" }, // no assignee -> skipped
    ],
  };

  async function persistInProgressMeeting(params: { id: string; spaceId?: string }): Promise<void> {
    const draft = createMeeting({
      organizerUserId: "user-1",
      tenantId: "tenant-a",
      ...(params.spaceId ? { spaceId: params.spaceId } : {}),
      title: "Sync",
      startAtMs: 1,
      id: params.id,
      attendees: [{ userId: "user-2" }, { userId: "user-3" }],
    });
    const inProgress = transitionMeeting(
      transitionMeeting(
        transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed"),
        "reminded",
      ),
      "in_progress",
    );
    await upsertMeeting(inProgress);
  }

  it("fans out one task per in-roster assignee on distribute (drops non-attendees / no-assignee)", async () => {
    await persistInProgressMeeting({ id: "m1", spaceId: "space-a" });
    await attachMeetingMinutes({ organizerUserId: "user-1", meetingId: "m1", minutes });
    const result = await distributeMeetingMinutes({ organizerUserId: "user-1", meetingId: "m1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meeting.status).toBe("distributed");
      expect(result.taskCount).toBe(1); // only user-2 (in roster + has assignee)
    }
    const tasks = await readManagedOrganizationTaskAssignments("space-a");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      assigneeUserId: "user-2",
      title: "T1",
      dueAt: "2026-07-10T00:00:00.000Z",
      sourceRef: { kind: "meeting", id: "m1" },
      status: "pending",
      tenantId: "tenant-a",
    });
  });

  it("recycles (rejects) fanned-out tasks when a distributed meeting is cancelled", async () => {
    await persistInProgressMeeting({ id: "m1", spaceId: "space-a" });
    await attachMeetingMinutes({ organizerUserId: "user-1", meetingId: "m1", minutes });
    await distributeMeetingMinutes({ organizerUserId: "user-1", meetingId: "m1" });
    const cancelled = await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m1",
      to: "cancelled",
    });
    expect(cancelled.ok).toBe(true);
    const tasks = await readManagedOrganizationTaskAssignments("space-a");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("rejected");
  });

  it("does not fan out for a meeting without a spaceId", async () => {
    await persistInProgressMeeting({ id: "m2" });
    await attachMeetingMinutes({ organizerUserId: "user-1", meetingId: "m2", minutes });
    const result = await distributeMeetingMinutes({ organizerUserId: "user-1", meetingId: "m2" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.taskCount).toBeUndefined();
    }
  });
});

describe("CollabDispatch D2 delivery + retry", () => {
  it("records per-recipient deliveryStatus on release via adapters", async () => {
    const { applyMeetingTransition } = await import("./meeting-lifecycle.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "D2 release",
      startAtMs: Date.now() + 120_000,
      id: "m-d2-release",
      tenantId: "tenant-a",
      spaceId: "space-a",
      attendees: [
        { userId: "user-2", kind: "human" },
        { userId: "user-3", kind: "human" },
      ],
    });
    await upsertMeeting(transitionMeeting(draft, "pending_approval"));
    // Force confirm path through applyMeetingTransition (default adapters succeed).
    const confirmed = await applyMeetingTransition({
      organizerUserId: "user-1",
      meetingId: "m-d2-release",
      to: "confirmed",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(confirmed.deliveredCount).toBe(2);
    expect(confirmed.failedCount).toBe(0);
    expect(confirmed.deliveryProgress).toEqual({
      totalRecipients: 2,
      deliveredCount: 2,
      failedCount: 0,
      pendingCount: 0,
    });
    expect(confirmed.meeting.attendees.find((a) => a.userId === "user-2")?.deliveryStatus).toBe(
      "sent",
    );
  });

  it("retries only failed recipients and preserves prior successes", async () => {
    const { retryMeetingDelivery, releaseMeetingSideEffects } =
      await import("./meeting-lifecycle.js");
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "D2 retry",
      startAtMs: Date.now() + 120_000,
      id: "m-d2-retry",
      tenantId: "tenant-a",
      attendees: [
        { userId: "user-ok", kind: "human" },
        { userId: "user-fail", kind: "human" },
      ],
    });
    const pending = transitionMeeting(draft, "pending_approval");
    await upsertMeeting(pending);

    let failOnce = true;
    const adapters = {
      deliverHuman: async ({ recipientUserId }: { recipientUserId: string }) => {
        if (recipientUserId === "user-fail" && failOnce) {
          return { ok: false as const, error: "transient" };
        }
        return { ok: true as const };
      },
      deliverAgent: async () => ({ ok: true as const }),
    };

    const confirmed = transitionMeeting(pending, "confirmed");
    const released = await releaseMeetingSideEffects(confirmed, { adapters });
    expect(released.deliveredCount).toBe(1);
    expect(released.failedCount).toBe(1);
    expect(released.meeting.attendees.find((a) => a.userId === "user-ok")?.deliveryStatus).toBe(
      "sent",
    );
    expect(released.meeting.attendees.find((a) => a.userId === "user-fail")?.deliveryStatus).toBe(
      "failed",
    );

    failOnce = false;
    const retried = await retryMeetingDelivery({
      organizerUserId: "user-1",
      meetingId: "m-d2-retry",
      adapters,
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) {
      return;
    }
    expect(retried.retriedCount).toBe(1);
    expect(retried.deliveryProgress).toEqual({
      totalRecipients: 2,
      deliveredCount: 2,
      failedCount: 0,
      pendingCount: 0,
    });
    expect(retried.meeting.attendees.find((a) => a.userId === "user-ok")?.deliveryStatus).toBe(
      "sent",
    );
    expect(retried.meeting.attendees.find((a) => a.userId === "user-fail")?.deliveryStatus).toBe(
      "sent",
    );
  });
});

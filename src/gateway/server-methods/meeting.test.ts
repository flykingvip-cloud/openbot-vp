// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueMeetingApprovalConfirmation } from "../../organization/meeting-confirmation.js";
import type { Meeting } from "../../organization/meeting-store.js";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import type { WorkbenchScheduleEntry } from "../workbench/schedule-read-model.js";
import { __clearConfirmationsForTest } from "./steward-confirmation-store.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const actorState = vi.hoisted(() => ({ current: null as EmployeeWorkbenchActor | null }));
const meetingsState = vi.hoisted(() => ({ current: [] as Meeting[] }));
const upsertMeetingMock = vi.hoisted(() => vi.fn(async (m: Meeting) => m));
const readOrganizerMeetingsMock = vi.hoisted(() =>
  vi.fn(async (_id: string) => meetingsState.current),
);
const upsertScheduleEntryMock = vi.hoisted(() =>
  vi.fn(async (entry: WorkbenchScheduleEntry) => entry),
);
const cancelScheduleEntryMock = vi.hoisted(() =>
  vi.fn(
    async (_params: { userId: string; id: string }): Promise<WorkbenchScheduleEntry | null> => null,
  ),
);

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
}));

// Keep the pure meeting helpers (createMeeting/transitionMeeting) real; stub the
// fs-touching store functions.
vi.mock("../../organization/meeting-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/meeting-store.js")>();
  return {
    ...actual,
    readOrganizerMeetings: readOrganizerMeetingsMock,
    upsertMeeting: upsertMeetingMock,
    findMeetingById: vi.fn(
      async (id: string) => meetingsState.current.find((meeting) => meeting.id === id) ?? null,
    ),
    listAllMeetings: vi.fn(async () => meetingsState.current),
  };
});

// Keep buildMeetingScheduleEntry/meetingScheduleEntryId real; stub the writes.
vi.mock("../../organization/schedule-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/schedule-store.js")>();
  return {
    ...actual,
    upsertScheduleEntry: upsertScheduleEntryMock,
    cancelScheduleEntry: cancelScheduleEntryMock,
  };
});

const { meetingHandlers } = await import("./meeting.js");
const { createMeeting, transitionMeeting } = await import("../../organization/meeting-store.js");

const ACTOR: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "u1@example.com",
  tenantId: "tenant-a",
  seatAgentIds: [],
  seatSpaceIds: [],
};

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; reasonCode?: string; details?: unknown };
}> {
  const handler = meetingHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string; reasonCode?: string; details?: unknown };
  } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "u1@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(() => {
  actorState.current = ACTOR;
  meetingsState.current = [];
  upsertMeetingMock.mockClear();
  readOrganizerMeetingsMock.mockClear();
  upsertScheduleEntryMock.mockClear();
  cancelScheduleEntryMock.mockClear();
  upsertScheduleEntryMock.mockImplementation(async (entry) => entry);
  upsertMeetingMock.mockImplementation(async (meeting: Meeting) => {
    const next = [...meetingsState.current.filter((row) => row.id !== meeting.id), meeting];
    meetingsState.current = next;
    return meeting;
  });
  __clearConfirmationsForTest();
});

describe("meeting.create RPC", () => {
  it("rejects when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("meeting.create", { title: "x", startAtMs: 1 });
    expect(result.ok).toBe(false);
    expect(upsertMeetingMock).not.toHaveBeenCalled();
  });

  it("stamps the organizer from the actor and creates a draft with the roster", async () => {
    const result = await invoke("meeting.create", {
      // client-provided organizerUserId must be ignored.
      organizerUserId: "user-999",
      title: "  Kickoff  ",
      startAtMs: 1_700_000_000_000,
      attendees: [{ userId: "user-2" }, "user-3"],
    });
    expect(result.ok).toBe(true);
    const saved = upsertMeetingMock.mock.calls[0]?.[0];
    expect(saved.organizerUserId).toBe("user-1");
    expect(saved.tenantId).toBe("tenant-a");
    expect(saved.status).toBe("draft");
    expect(saved.title).toBe("Kickoff");
    expect(saved.attendees.map((a) => a.userId).toSorted()).toEqual(["user-1", "user-2", "user-3"]);
    expect(saved.attendees.find((a) => a.userId === "user-1")?.role).toBe("organizer");
  });

  it("rejects a missing title or bad startAtMs", async () => {
    expect((await invoke("meeting.create", { startAtMs: 1 })).ok).toBe(false);
    expect((await invoke("meeting.create", { title: "x", startAtMs: 0 })).ok).toBe(false);
    expect(upsertMeetingMock).not.toHaveBeenCalled();
  });
});

describe("meeting lifecycle transitions", () => {
  function draft(): Meeting {
    return createMeeting({
      organizerUserId: "user-1",
      tenantId: "tenant-a",
      title: "Sync",
      startAtMs: 1_700_000_000_000,
      id: "m1",
      attendees: [{ userId: "user-2" }],
    });
  }

  it("submit moves draft -> pending_approval and issues confirmation", async () => {
    meetingsState.current = [draft()];
    const result = await invoke("meeting.submit", { id: "m1" });
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe("pending_confirmation");
    expect(result.payload?.confirmation).toBeTruthy();
    const saved = upsertMeetingMock.mock.calls[0]?.[0] as Meeting | undefined;
    expect(saved?.status).toBe("pending_approval");
  });

  it("approve without token returns pending_confirmation and does not fan out", async () => {
    meetingsState.current = [transitionMeeting(draft(), "pending_approval")];
    const result = await invoke("meeting.approve", { id: "m1" });
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe("pending_confirmation");
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("approve with token releases: organizer schedule only; recipients stay ack-pending", async () => {
    const meeting = transitionMeeting(draft(), "pending_approval");
    meetingsState.current = [meeting];
    const ticket = issueMeetingApprovalConfirmation(meeting);
    const result = await invoke("meeting.approve", {
      id: "m1",
      proposalId: ticket.proposalId,
      confirmationToken: ticket.confirmationToken,
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe("confirmed");
    const savedMeeting = upsertMeetingMock.mock.calls
      .map((call) => call[0])
      .toReversed()
      .find((row) => row.status === "confirmed");
    expect(savedMeeting?.status).toBe("confirmed");
    // CollabDispatch D1: only organizer ScheduleEntry on release.
    expect(upsertScheduleEntryMock).toHaveBeenCalledTimes(1);
    expect(upsertScheduleEntryMock.mock.calls[0]?.[0].ownerUserId).toBe("user-1");
    expect(upsertScheduleEntryMock.mock.calls[0]?.[0].kind).toBe("meeting");
    expect(upsertScheduleEntryMock.mock.calls[0]?.[0].sourceRef).toEqual({
      kind: "meeting",
      id: "m1",
    });
    expect(result.payload?.scheduledCount).toBe(1);
    const resume = result.payload?.resumeContinuation as
      | { kind?: string; userMessage?: string; epilogueProgressMessage?: string }
      | undefined;
    expect(resume?.kind).toBe("meeting_confirm_release");
    expect(resume?.userMessage).toContain("Sync");
    expect(resume?.epilogueProgressMessage).toContain("已确认");
    expect(JSON.stringify(result.payload)).not.toMatch(/confirmationToken/);
    const user2 = savedMeeting?.attendees.find((a) => a.userId === "user-2");
    expect(user2?.rsvpStatus).toBe("invited");
    expect(user2?.deliveryStatus).toBe("sent");
  });

  it("refuses to confirm an online meeting that has no join link", async () => {
    const meeting = transitionMeeting(draft(), "pending_approval");
    meeting.location = "线上";
    meetingsState.current = [meeting];
    const ticket = issueMeetingApprovalConfirmation(meeting);
    const result = await invoke("meeting.approve", {
      id: "m1",
      proposalId: ticket.proposalId,
      confirmationToken: ticket.confirmationToken,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.reasonCode).toBe("provision_required");
    expect(result.error?.message).toMatch(/入会链接/);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("approve without token does not issue pending_confirmation when online lacks joinUrl", async () => {
    const meeting = transitionMeeting(draft(), "pending_approval");
    meeting.meetingMode = "online";
    meetingsState.current = [meeting];
    const result = await invoke("meeting.approve", { id: "m1" });
    expect(result.ok).toBe(false);
    expect(result.error?.reasonCode).toBe("provision_required");
    expect(result.payload?.status).not.toBe("pending_confirmation");
    expect(result.payload?.confirmation).toBeUndefined();
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("submit does not issue pending_confirmation when online lacks joinUrl after provision", async () => {
    const meeting = draft();
    meeting.meetingMode = "online";
    meetingsState.current = [meeting];
    const result = await invoke("meeting.submit", { id: "m1" });
    expect(result.ok).toBe(false);
    expect(result.error?.reasonCode).toMatch(/^provision_/);
    expect(result.payload?.status).not.toBe("pending_confirmation");
    expect(result.payload?.confirmation).toBeUndefined();
  });

  it("approve issues pending_confirmation for offline meeting without joinUrl", async () => {
    const meeting = transitionMeeting(draft(), "pending_approval");
    meeting.meetingMode = "offline";
    meeting.location = "3F-A";
    meetingsState.current = [meeting];
    const result = await invoke("meeting.approve", { id: "m1" });
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe("pending_confirmation");
    expect(result.payload?.confirmation).toBeTruthy();
  });

  it("cancel recycles each attendee's meeting ScheduleEntry", async () => {
    const confirmed = transitionMeeting(
      transitionMeeting(draft(), "pending_approval"),
      "confirmed",
    );
    meetingsState.current = [confirmed];
    const result = await invoke("meeting.cancel", { id: "m1" });
    expect(result.ok).toBe(true);
    const cancelledMeeting = upsertMeetingMock.mock.calls[0]?.[0] as Meeting | undefined;
    expect(cancelledMeeting?.status).toBe("cancelled");
    expect(cancelScheduleEntryMock).toHaveBeenCalledTimes(2);
    expect(cancelScheduleEntryMock).toHaveBeenCalledWith({
      userId: "user-1",
      id: "meeting:m1:user-1",
    });
    expect(cancelScheduleEntryMock).toHaveBeenCalledWith({
      userId: "user-2",
      id: "meeting:m1:user-2",
    });
  });

  it("cancel invalidates unused meeting.approve confirmation tickets", async () => {
    const pending = transitionMeeting(draft(), "pending_approval");
    meetingsState.current = [pending];
    const ticket = issueMeetingApprovalConfirmation(pending);
    const result = await invoke("meeting.cancel", { id: "m1" });
    expect(result.ok).toBe(true);
    const { consumeMeetingApprovalConfirmation } =
      await import("../../organization/meeting-confirmation.js");
    expect(
      consumeMeetingApprovalConfirmation({
        meeting: pending,
        proposalId: ticket.proposalId,
        confirmationToken: ticket.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("approve dismissConfirmation invalidates tickets without confirming meeting", async () => {
    const pending = transitionMeeting(draft(), "pending_approval");
    meetingsState.current = [pending];
    const ticket = issueMeetingApprovalConfirmation(pending);
    const result = await invoke("meeting.approve", { id: "m1", dismissConfirmation: true });
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe("confirmation_cancelled");
    expect(result.payload?.invalidatedTickets).toBe(1);
    expect(upsertMeetingMock).not.toHaveBeenCalled();
    const { consumeMeetingApprovalConfirmation } =
      await import("../../organization/meeting-confirmation.js");
    expect(
      consumeMeetingApprovalConfirmation({
        meeting: pending,
        proposalId: ticket.proposalId,
        confirmationToken: ticket.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(meetingsState.current[0]?.status).toBe("pending_approval");
  });

  it("rejects an illegal transition (draft -> confirmed)", async () => {
    meetingsState.current = [draft()];
    const result = await invoke("meeting.approve", { id: "m1" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/illegal meeting transition/i);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("returns an error when the meeting is not found", async () => {
    meetingsState.current = [];
    const result = await invoke("meeting.submit", { id: "missing" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/not found/i);
  });

  it("requires an id for transitions", async () => {
    const result = await invoke("meeting.approve", {});
    expect(result.ok).toBe(false);
  });
});

describe("meeting.ack / meeting.decline (CollabDispatch D1)", () => {
  function released(): Meeting {
    const base = createMeeting({
      organizerUserId: "user-1",
      tenantId: "tenant-a",
      title: "Sync",
      startAtMs: 1_700_000_000_000,
      id: "m1",
      attendees: [{ userId: "user-2" }],
    });
    return transitionMeeting(transitionMeeting(base, "pending_approval"), "confirmed");
  }

  it("ack by recipient writes that recipient schedule only", async () => {
    meetingsState.current = [released()];
    actorState.current = {
      ...ACTOR,
      userId: "user-2",
      userEmail: "u2@example.com",
    };
    const result = await invoke("meeting.ack", { id: "m1" });
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe("acked");
    expect(result.payload?.scheduled).toBe(true);
    expect(upsertScheduleEntryMock).toHaveBeenCalledTimes(1);
    expect(upsertScheduleEntryMock.mock.calls[0]?.[0].ownerUserId).toBe("user-2");
  });

  it("decline by recipient does not write schedule", async () => {
    meetingsState.current = [released()];
    actorState.current = {
      ...ACTOR,
      userId: "user-2",
      userEmail: "u2@example.com",
    };
    const result = await invoke("meeting.decline", { id: "m1" });
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe("declined");
    expect(result.payload?.scheduled).toBe(false);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("rejects organizer self-ack and unknown attendees", async () => {
    meetingsState.current = [released()];
    const self = await invoke("meeting.ack", { id: "m1" });
    expect(self.ok).toBe(false);
    expect(self.error?.message).toMatch(/organizer/i);
    actorState.current = {
      ...ACTOR,
      userId: "user-99",
      userEmail: "u99@example.com",
    };
    const stranger = await invoke("meeting.ack", { id: "m1" });
    expect(stranger.ok).toBe(false);
    expect(stranger.error?.message).toMatch(/not an attendee/i);
  });
});

describe("meeting back-half RPCs (Phase C3b)", () => {
  function reminded(): Meeting {
    const draft = createMeeting({
      organizerUserId: "user-1",
      tenantId: "tenant-a",
      title: "Sync",
      startAtMs: 1_700_000_000_000,
      id: "m1",
      attendees: [{ userId: "user-2" }],
    });
    return transitionMeeting(
      transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed"),
      "reminded",
    );
  }

  it("meeting.start moves reminded -> in_progress", async () => {
    meetingsState.current = [reminded()];
    const result = await invoke("meeting.start", { id: "m1" });
    expect(result.ok).toBe(true);
    const started = upsertMeetingMock.mock.calls[0]?.[0] as Meeting | undefined;
    expect(started?.status).toBe("in_progress");
  });

  it("meeting.minute validates the draft (C0) and attaches it -> minuted", async () => {
    meetingsState.current = [transitionMeeting(reminded(), "in_progress")];
    const result = await invoke("meeting.minute", {
      id: "m1",
      minutes: {
        summary: "We agreed to ship v1.",
        decisions: ["ship v1"],
        actionItems: [{ title: "draft spec", assigneeUserId: "user-2" }],
      },
    });
    expect(result.ok).toBe(true);
    const saved = upsertMeetingMock.mock.calls[0]?.[0];
    expect(saved.status).toBe("minuted");
    expect(saved.minutesRef).toBe("minutes:m1");
    expect(saved.minutes?.summary).toBe("We agreed to ship v1.");
    expect(saved.minutes?.actionItems).toHaveLength(1);
  });

  it("meeting.minute rejects an invalid minutes draft (no summary)", async () => {
    meetingsState.current = [transitionMeeting(reminded(), "in_progress")];
    const result = await invoke("meeting.minute", { id: "m1", minutes: { decisions: [] } });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/invalid minutes/i);
    expect(upsertMeetingMock).not.toHaveBeenCalled();
  });

  it("meeting.minute strips LLM-injected authoritative fields via the C0 boundary", async () => {
    meetingsState.current = [transitionMeeting(reminded(), "in_progress")];
    await invoke("meeting.minute", {
      id: "m1",
      minutes: {
        summary: "s",
        decisions: [],
        actionItems: [],
        // injected junk that must not survive validation / reach the store
        status: "distributed",
        organizerUserId: "victim",
      },
    });
    const saved = upsertMeetingMock.mock.calls[0]?.[0];
    expect(saved.status).toBe("minuted"); // not the injected "distributed"
    expect(saved.organizerUserId).toBe("user-1"); // server-stamped, not "victim"
    expect(saved.minutes).not.toHaveProperty("status");
    expect(saved.minutes).not.toHaveProperty("organizerUserId");
  });

  it("meeting.distribute moves minuted -> distributed", async () => {
    const minuted = transitionMeeting(transitionMeeting(reminded(), "in_progress"), "minuted", {
      minutesRef: "minutes:m1",
    });
    meetingsState.current = [minuted];
    const result = await invoke("meeting.distribute", { id: "m1" });
    expect(result.ok).toBe(true);
    const distributed = upsertMeetingMock.mock.calls[0]?.[0] as Meeting | undefined;
    expect(distributed?.status).toBe("distributed");
  });

  it("meeting.start rejects an illegal edge (draft -> in_progress)", async () => {
    meetingsState.current = [
      createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1, id: "m1" }),
    ];
    const result = await invoke("meeting.start", { id: "m1" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/illegal meeting transition/i);
  });
});

describe("meeting.list RPC", () => {
  it("returns the organizer's meetings", async () => {
    meetingsState.current = [
      createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1 }),
    ];
    const result = await invoke("meeting.list");
    expect(result.ok).toBe(true);
    const meetings = result.payload?.meetings as Meeting[] | undefined;
    expect(meetings?.length).toBe(1);
    expect(readOrganizerMeetingsMock).toHaveBeenCalledWith("user-1");
  });

  it("returns an empty list when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("meeting.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ meetings: [] });
    expect(readOrganizerMeetingsMock).not.toHaveBeenCalled();
  });
});

describe("meeting.retry-delivery (CollabDispatch D2)", () => {
  it("retries failed recipients and returns delivery progress", async () => {
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "Retry RPC",
      startAtMs: Date.now() + 60_000,
      id: "m-retry-rpc",
      tenantId: "tenant-a",
      attendees: [
        { userId: "user-2", kind: "human" },
        { userId: "user-3", kind: "human" },
      ],
    });
    const confirmed = transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed");
    meetingsState.current = [
      {
        ...confirmed,
        attendees: confirmed.attendees.map((a) =>
          a.userId === "user-3"
            ? { ...a, deliveryStatus: "failed" as const, rsvpStatus: "invited" as const }
            : a.userId === "user-2"
              ? { ...a, deliveryStatus: "sent" as const, rsvpStatus: "invited" as const }
              : a,
        ),
      },
    ];
    upsertMeetingMock.mockImplementation(async (m: Meeting) => {
      meetingsState.current = [m];
      return m;
    });

    const result = await invoke("meeting.retry-delivery", { id: "m-retry-rpc" });
    expect(result.ok).toBe(true);
    expect(result.payload?.retriedCount).toBe(1);
    const progress = result.payload?.deliveryProgress as
      | { deliveredCount: number; failedCount: number; pendingCount: number }
      | undefined;
    expect(progress?.deliveredCount).toBe(2);
    expect(progress?.failedCount).toBe(0);
    const meeting = result.payload?.meeting as Meeting;
    expect(meeting.attendees.find((a) => a.userId === "user-2")?.deliveryStatus).toBe("sent");
    expect(meeting.attendees.find((a) => a.userId === "user-3")?.deliveryStatus).toBe("sent");
  });

  it("rejects retry when nothing failed", async () => {
    const draft = createMeeting({
      organizerUserId: "user-1",
      title: "All sent",
      startAtMs: Date.now() + 60_000,
      id: "m-all-sent",
      attendees: [{ userId: "user-2", kind: "human" }],
    });
    const confirmed = transitionMeeting(transitionMeeting(draft, "pending_approval"), "confirmed");
    meetingsState.current = [
      {
        ...confirmed,
        attendees: confirmed.attendees.map((a) =>
          a.userId === "user-2"
            ? { ...a, deliveryStatus: "sent" as const, rsvpStatus: "invited" as const }
            : a,
        ),
      },
    ];
    const result = await invoke("meeting.retry-delivery", { id: "m-all-sent" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/no failed or pending/i);
  });
});

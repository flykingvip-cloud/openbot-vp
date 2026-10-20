// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeWorkbenchActor } from "../../gateway/employee-workbench-scope.js";
import { __clearConfirmationsForTest } from "../../gateway/server-methods/steward-confirmation-store.js";
import type { WorkbenchScheduleEntry } from "../../gateway/workbench/schedule-read-model.js";
import { issueMeetingApprovalConfirmation } from "../../organization/meeting-confirmation.js";
import type { Meeting } from "../../organization/meeting-store.js";

const actorState = vi.hoisted(() => ({ current: null as EmployeeWorkbenchActor | null }));
const meetingsState = vi.hoisted(() => ({ current: [] as Meeting[] }));
const upsertMeetingMock = vi.hoisted(() => vi.fn(async (m: Meeting) => m));
const upsertScheduleEntryMock = vi.hoisted(() =>
  vi.fn(async (entry: WorkbenchScheduleEntry) => entry),
);
const upsertTaskMock = vi.hoisted(() => vi.fn(async (task: unknown) => task));
const cancelScheduleEntryMock = vi.hoisted(() =>
  vi.fn(async (_p: { userId: string; id: string }): Promise<WorkbenchScheduleEntry | null> => null),
);

const identityScopeState = vi.hoisted(() => ({
  current: null as {
    tenantId: string;
    seatId: string;
    agentId: string;
    employeeId: string;
  } | null,
}));

vi.mock("../../gateway/employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
}));

vi.mock("../../gateway/enterprise-operational-identity-runtime.js", () => ({
  resolveOperationalIdentityRuntimeScope: vi.fn(async () => identityScopeState.current),
  resolveOperationalIdentityRuntimeScopeDecision: vi.fn(async () =>
    identityScopeState.current
      ? { ok: true, source: "enrollment", scope: identityScopeState.current }
      : { ok: false, code: "IDENTITY_CONTEXT_MISSING", message: "missing identity" },
  ),
}));

vi.mock("../../organization/meeting-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/meeting-store.js")>();
  return {
    ...actual,
    readOrganizerMeetings: vi.fn(async () => meetingsState.current),
    upsertMeeting: upsertMeetingMock,
  };
});

vi.mock("../../organization/task-assignment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/task-assignment.js")>();
  return {
    ...actual,
    upsertManagedOrganizationTaskAssignment: upsertTaskMock,
    readManagedOrganizationTaskAssignments: vi.fn(async () => []),
    writeManagedOrganizationTaskAssignments: vi.fn(async () => undefined),
  };
});

vi.mock("../../organization/schedule-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/schedule-store.js")>();
  return {
    ...actual,
    upsertScheduleEntry: upsertScheduleEntryMock,
    cancelScheduleEntry: cancelScheduleEntryMock,
  };
});

const { createMeetingTool } = await import("./meeting-tool.js");
const { createMeeting, transitionMeeting } = await import("../../organization/meeting-store.js");

const ACTOR: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "u1@example.com",
  tenantId: "tenant-a",
  seatAgentIds: [],
  seatSpaceIds: [],
};

async function run(
  args: Record<string, unknown>,
  opts?: { gatewayClientUser?: string },
): Promise<Record<string, unknown>> {
  const tool = createMeetingTool({
    gatewayClientUser:
      "gatewayClientUser" in (opts ?? {}) ? opts?.gatewayClientUser : "u1@example.com",
    gatewayClientSessionDomain: "employee",
  });
  if (!tool.execute) {
    throw new Error("meeting tool has no execute");
  }
  const result = await tool.execute("call-1", args);
  return (result.details ?? {}) as Record<string, unknown>;
}

function pendingMeeting(): Meeting {
  return transitionMeeting(
    createMeeting({
      organizerUserId: "user-1",
      tenantId: "tenant-a",
      title: "Sync",
      startAtMs: 1_700_000_000_000,
      id: "m1",
      attendees: [{ userId: "user-2" }],
    }),
    "pending_approval",
  );
}

beforeEach(() => {
  actorState.current = ACTOR;
  identityScopeState.current = null;
  meetingsState.current = [];
  upsertMeetingMock.mockClear();
  upsertScheduleEntryMock.mockClear();
  cancelScheduleEntryMock.mockClear();
  upsertTaskMock.mockClear();
  upsertScheduleEntryMock.mockImplementation(async (entry) => entry);
  __clearConfirmationsForTest();
});

describe("meeting tool", () => {
  it("refuses without a signed-in employee session", async () => {
    actorState.current = null;
    await expect(run({ action: "list" })).rejects.toThrow(
      /signed-in employee session or an enrolled enterprise meeting identity|此回合没有携带已认证的员工身份|missing identity/i,
    );
  });

  it("refuses when there is no gateway user context", async () => {
    await expect(run({ action: "list" }, { gatewayClientUser: undefined })).rejects.toThrow(
      /signed-in employee session or an enrolled enterprise meeting identity|此回合没有携带已认证的员工身份|missing identity/i,
    );
  });

  it("uses enrolled enterprise identity when the agent session has no employee actor", async () => {
    actorState.current = null;
    identityScopeState.current = {
      tenantId: "tenant-a",
      seatId: "seat-1",
      agentId: "bot--agent",
      employeeId: "user-1",
    };
    const out = await run(
      {
        action: "list",
      },
      { gatewayClientUser: undefined },
    );
    expect(out.ok).toBe(true);
    expect(out.action).toBe("list");
  });

  it("create drafts a meeting, stamping organizer from the actor and parsing attendees", async () => {
    const out = await run({
      action: "create",
      organizerUserId: "user-999", // must be ignored
      title: "  Kickoff  ",
      startAt: "2026-07-01T15:00:00Z",
      attendees: "user-2, user-3",
      location: "线上",
      joinUrl: "https://meet.example/kickoff",
      agenda: "目标对齐 | 排期",
    });
    expect(out.ok).toBe(true);
    const saved = upsertMeetingMock.mock.calls[0]?.[0] as Meeting | undefined;
    expect(saved?.organizerUserId).toBe("user-1");
    expect(saved?.status).toBe("draft");
    expect(saved?.title).toBe("Kickoff");
    expect(saved?.location).toBe("线上");
    expect(saved?.joinUrl).toBe("https://meet.example/kickoff");
    expect(saved?.agenda).toEqual(["目标对齐", "排期"]);
    expect(saved?.attendees.map((a) => a.userId).toSorted()).toEqual([
      "user-1",
      "user-2",
      "user-3",
    ]);
    expect(out.template).toMatchObject({
      title: "Kickoff",
      location: "线上",
      joinUrl: "https://meet.example/kickoff",
    });
  });

  it("submit advances a draft to pending_approval without leaking confirmationToken", async () => {
    meetingsState.current = [
      createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1, id: "m1" }),
    ];
    const out = await run({ action: "submit", id: "m1" });
    expect(out.ok).toBe(true);
    expect(out.status).toBe("pending_confirmation");
    expect(typeof out.proposalId).toBe("string");
    expect(out.confirmationToken).toBeUndefined();
    const saved = upsertMeetingMock.mock.calls[0]?.[0] as Meeting | undefined;
    expect(saved?.status).toBe("pending_approval");
  });

  it("approve without token stays pending and does not fan out", async () => {
    meetingsState.current = [pendingMeeting()];
    const out = await run({ action: "approve", id: "m1" });
    expect(out.status).toBe("pending_confirmation");
    expect(out.confirmationToken).toBeUndefined();
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("approve with invented token is rejected", async () => {
    meetingsState.current = [pendingMeeting()];
    await expect(
      run({
        action: "approve",
        id: "m1",
        proposalId: "dbc_fake",
        confirmationToken: "fake-token",
      }),
    ).rejects.toThrow(/Confirmation rejected|not_found/i);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("approve with a server-issued token confirms and writes organizer schedule only", async () => {
    const meeting = pendingMeeting();
    meetingsState.current = [meeting];
    const ticket = issueMeetingApprovalConfirmation(meeting);
    // After confirm, readOrganizerMeetings must still see pending until upsert flips it.
    const out = await run({
      action: "approve",
      id: "m1",
      proposalId: ticket.proposalId,
      confirmationToken: ticket.confirmationToken,
    });
    expect(out.ok).toBe(true);
    expect(out.status).toBe("confirmed");
    expect(upsertScheduleEntryMock).toHaveBeenCalledTimes(1);
    expect(upsertScheduleEntryMock.mock.calls[0]?.[0].ownerUserId).toBe("user-1");
    expect(out.scheduledCount).toBe(1);
  });

  it("draft content change invalidates an old confirmation token", async () => {
    const original = pendingMeeting();
    const ticket = issueMeetingApprovalConfirmation(original);
    const mutated = { ...original, title: "Changed title", updatedAt: "2099-01-01T00:00:00.000Z" };
    meetingsState.current = [mutated];
    await expect(
      run({
        action: "approve",
        id: "m1",
        proposalId: ticket.proposalId,
        confirmationToken: ticket.confirmationToken,
      }),
    ).rejects.toThrow(/content changed|payload_mismatch/i);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("approve fans location/joinUrl onto the organizer schedule entry", async () => {
    const draft = createMeeting({
      organizerUserId: "user-1",
      tenantId: "tenant-a",
      title: "Sync",
      startAtMs: 1_700_000_000_000,
      id: "m1",
      attendees: [{ userId: "user-2" }],
      location: "线上",
      joinUrl: "https://meet.example/sync",
    });
    const meeting = transitionMeeting(draft, "pending_approval");
    meetingsState.current = [meeting];
    const ticket = issueMeetingApprovalConfirmation(meeting);
    await run({
      action: "approve",
      id: "m1",
      proposalId: ticket.proposalId,
      confirmationToken: ticket.confirmationToken,
    });
    expect(upsertScheduleEntryMock).toHaveBeenCalledTimes(1);
    const entry = upsertScheduleEntryMock.mock.calls[0]?.[0] as WorkbenchScheduleEntry | undefined;
    expect(entry?.ownerUserId).toBe("user-1");
    expect(entry?.location).toBe("线上");
    expect(entry?.joinUrl).toBe("https://meet.example/sync");
  });

  it("cancel recycles each attendee's meeting entry", async () => {
    meetingsState.current = [transitionMeeting(pendingMeeting(), "confirmed")];
    const out = await run({ action: "cancel", id: "m1" });
    expect(out.ok).toBe(true);
    expect(cancelScheduleEntryMock).toHaveBeenCalledTimes(2);
  });

  it("cancel invalidates unused meeting.approve confirmation tickets", async () => {
    const meeting = transitionMeeting(
      createMeeting({
        organizerUserId: "user-1",
        title: "Sync",
        startAtMs: 1,
        id: "m1",
        attendees: [{ userId: "user-2" }],
      }),
      "pending_approval",
    );
    meetingsState.current = [meeting];
    const ticket = issueMeetingApprovalConfirmation(meeting);
    const out = await run({ action: "cancel", id: "m1" });
    expect(out.ok).toBe(true);
    const { consumeMeetingApprovalConfirmation } =
      await import("../../organization/meeting-confirmation.js");
    expect(
      consumeMeetingApprovalConfirmation({
        meeting,
        proposalId: ticket.proposalId,
        confirmationToken: ticket.confirmationToken,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an illegal transition (approve a draft)", async () => {
    meetingsState.current = [
      createMeeting({ organizerUserId: "user-1", title: "x", startAtMs: 1, id: "m1" }),
    ];
    await expect(run({ action: "approve", id: "m1" })).rejects.toThrow(
      /illegal meeting transition/i,
    );
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  function inProgressMeeting(): Meeting {
    let meeting = createMeeting({
      organizerUserId: "user-1",
      tenantId: "tenant-a",
      spaceId: "space-a",
      title: "Sync",
      startAtMs: 1_700_000_000_000,
      id: "m1",
      attendees: [{ userId: "user-2" }],
    });
    for (const status of ["pending_approval", "confirmed", "reminded", "in_progress"] as const) {
      meeting = transitionMeeting(meeting, status);
    }
    return meeting;
  }

  it("start moves a reminded meeting to in_progress", async () => {
    let reminded = createMeeting({
      organizerUserId: "user-1",
      title: "Sync",
      startAtMs: 1,
      id: "m1",
      attendees: [{ userId: "user-2" }],
    });
    for (const status of ["pending_approval", "confirmed", "reminded"] as const) {
      reminded = transitionMeeting(reminded, status);
    }
    meetingsState.current = [reminded];
    const out = await run({ action: "start", id: "m1" });
    expect(out.ok).toBe(true);
    expect((out.meeting as Meeting).status).toBe("in_progress");
  });

  it("minute attaches action items and flags assignees outside the roster", async () => {
    meetingsState.current = [inProgressMeeting()];
    const out = await run({
      action: "minute",
      id: "m1",
      summary: "We agreed to ship v1.",
      decisions: "ship v1",
      actionItems: "draft spec @ user-2\norphan task @ user-9",
    });
    expect(out.ok).toBe(true);
    const saved = upsertMeetingMock.mock.calls.at(-1)?.[0];
    expect(saved?.status).toBe("minuted");
    expect(saved?.minutes?.actionItems).toHaveLength(2);
    expect(out.droppedActionItems).toEqual(["orphan task"]);
  });

  it("distribute fans in-roster action items into task assignments", async () => {
    const minuted = transitionMeeting(inProgressMeeting(), "minuted", {
      minutesRef: "minutes:m1",
      minutes: {
        kind: "minutes_draft",
        summary: "ship",
        decisions: [],
        actionItems: [{ kind: "task", title: "draft spec", assigneeUserId: "user-2" }],
      },
    });
    meetingsState.current = [minuted];
    const out = await run({ action: "distribute", id: "m1" });
    expect(out.ok).toBe(true);
    expect(out.taskCount).toBe(1);
    expect(upsertTaskMock).toHaveBeenCalledTimes(1);
    expect(upsertTaskMock.mock.calls[0]?.[0]).toMatchObject({
      assigneeUserId: "user-2",
      organizationId: "space-a",
      title: "draft spec",
    });
  });

  it("generate-minutes stays unavailable when the model runner is dormant", async () => {
    meetingsState.current = [inProgressMeeting()];
    const out = await run({
      action: "generate-minutes",
      id: "m1",
      transcript: "Alice will draft the spec.",
    });
    expect(out.status).toBe("unavailable");
    expect(upsertMeetingMock).not.toHaveBeenCalled();
  });

  it("reports not found for an unknown meeting id", async () => {
    meetingsState.current = [];
    await expect(run({ action: "submit", id: "missing" })).rejects.toThrow(/not found/i);
  });
});

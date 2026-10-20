// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_STEWARD_AGENT_ID } from "../../agents/builtin-steward/identity.js";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { __resetStewardSuggestionCacheForTests } from "../workbench/steward-suggestion-read-model.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const actorState = vi.hoisted(() => ({
  current: null as EmployeeWorkbenchActor | null,
}));

const buildWorkbenchPendingTasksMock = vi.hoisted(() =>
  vi.fn(async () => ({
    totalCount: 3,
    taskCount: 1,
    ackRequiredCount: 1,
    governanceCount: 1,
    inviteCount: 1,
    items: [{ id: "task:t1", kind: "task" as const, title: "T1", updatedAtMs: 1 }],
  })),
);

const buildWorkbenchMyTasksMock = vi.hoisted(() =>
  vi.fn(async () => ({
    totalCount: 3,
    cronCount: 1,
    supervisedCount: 1,
    assignedCount: 1,
    cronJobs: [{ id: "cron:c1", kind: "cron" as const, title: "C1" }],
    supervisedTasks: [{ id: "supervised:s1", kind: "supervised" as const, title: "S1" }],
    assignedTasks: [{ id: "assigned:a1", kind: "assigned" as const, title: "A1" }],
  })),
);

const governanceState = vi.hoisted(() => ({
  current: null as Record<string, number> | null,
  shouldThrow: false,
}));

const getUserGovernanceSummaryMock = vi.hoisted(() =>
  vi.fn(async () => {
    if (governanceState.shouldThrow) {
      throw new Error("index unavailable");
    }
    return governanceState.current;
  }),
);

const buildWorkbenchUpcomingCollaborationMock = vi.hoisted(() =>
  vi.fn(async () => ({
    needsResponseCount: 2,
    decisionCount: 1,
    reviewCount: 1,
    activeCount: 3,
    items: [],
  })),
);

const buildWorkbenchScheduleMock = vi.hoisted(() =>
  vi.fn(async () => ({
    todayCount: 2,
    upcomingCount: 3,
    cronDerivedCount: 1,
    nextStartAtMs: 1_700_000_000_000,
    nextTitle: "Standup",
    hasRealEntries: true,
    items: [],
  })),
);

// Mock the actor resolver so the handler's scoping decision is the unit under
// test (no platform-auth store / config / disk reads).
vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
}));

// Mock the read model so we assert the *scoping arguments* the handler passes,
// without exercising the (disk-backed) aggregation itself.
vi.mock("../workbench/pending-tasks-read-model.js", () => ({
  buildWorkbenchPendingTasks: buildWorkbenchPendingTasksMock,
}));

vi.mock("../workbench/my-tasks-read-model.js", () => ({
  buildWorkbenchMyTasks: buildWorkbenchMyTasksMock,
}));

// Mock the collaboration read model to assert actor scoping without reading the
// real collaboration space store.
vi.mock("../workbench/upcoming-collaboration-read-model.js", () => ({
  buildWorkbenchUpcomingCollaboration: buildWorkbenchUpcomingCollaborationMock,
}));

// Mock the schedule read model to assert the handler's actor-scoping arguments
// without reading the cron store / schedule entries.
vi.mock("../workbench/schedule-read-model.js", () => ({
  buildWorkbenchSchedule: buildWorkbenchScheduleMock,
}));

// Mock the organizer meeting store so the notices handler's meeting-invite-review
// merge is deterministic (no fs), without exercising the real meeting store.
const meetingsState = vi.hoisted(() => ({
  current: [] as Array<{ id: string; title: string; status: string }>,
}));
vi.mock("../../organization/meeting-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/meeting-store.js")>();
  return {
    ...actual,
    readOrganizerMeetings: vi.fn(async () => meetingsState.current),
  };
});

// Mock the user-scoped governance source so the notices handler is tested for
// actor scoping + shaping, without opening a real per-user knowledge index.
vi.mock("./knowledge-governance.js", () => ({
  getUserGovernanceSummary: getUserGovernanceSummaryMock,
}));

const { workbenchHandlers } = await import("./workbench.js");

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
}> {
  const handler = workbenchHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
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

describe("workbench.my-tasks.list RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    buildWorkbenchMyTasksMock.mockClear();
  });

  it("returns an empty projection when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("workbench.my-tasks.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      totalCount: 0,
      cronCount: 0,
      supervisedCount: 0,
      assignedCount: 0,
      cronJobs: [],
      supervisedTasks: [],
      assignedTasks: [],
    });
    expect(buildWorkbenchMyTasksMock).not.toHaveBeenCalled();
  });

  it("scopes the unified my-tasks projection to the resolved actor", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: ["space-a"],
    };
    const result = await invoke("workbench.my-tasks.list", { limit: 10 });
    expect(result.ok).toBe(true);
    expect(buildWorkbenchMyTasksMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatSpaceIds: ["space-a"],
      limit: 10,
    });
    expect(result.payload?.totalCount).toBe(3);
  });
});

describe("workbench.pending-tasks.list RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    buildWorkbenchPendingTasksMock.mockClear();
  });

  it("returns an empty projection (never the unscoped view) when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("workbench.pending-tasks.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      totalCount: 0,
      taskCount: 0,
      ackRequiredCount: 0,
      personalTaskCount: 0,
      spaceTaskCount: 0,
      governanceCount: 0,
      inviteCount: 0,
      mentionCount: 0,
      humanGateCount: 0,
      items: [],
    });
    // Critical: a session that cannot resolve an actor must NOT fall through to
    // the install-wide read model (which would leak other tenants' pending work).
    expect(buildWorkbenchPendingTasksMock).not.toHaveBeenCalled();
  });

  it("scopes the read model to the resolved actor and excludes the builtin steward", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["bot-x", BUILTIN_STEWARD_AGENT_ID, "bot-y"],
      seatSpaceIds: ["space-a", "space-b"],
    };
    const result = await invoke("workbench.pending-tasks.list", { limit: 5 });
    expect(result.ok).toBe(true);
    expect(buildWorkbenchPendingTasksMock).toHaveBeenCalledTimes(1);
    expect(buildWorkbenchPendingTasksMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatSpaceIds: ["space-a", "space-b"],
      // builtin steward ("main") filtered out so a member never sees other
      // users' steward-attributed governance.
      visibleAgentIds: ["bot-x", "bot-y"],
      limit: 5,
    });
    expect(result.payload?.totalCount).toBe(3);
  });

  it("omits limit when params do not carry a numeric limit", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    await invoke("workbench.pending-tasks.list", { limit: "not-a-number" });
    expect(buildWorkbenchPendingTasksMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: undefined,
      seatSpaceIds: [],
      visibleAgentIds: ["bot-x"],
    });
  });

  it("responds with an error when the read model throws", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    buildWorkbenchPendingTasksMock.mockRejectedValueOnce(new Error("boom"));
    const result = await invoke("workbench.pending-tasks.list");
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("boom");
  });
});

describe("workbench.notices.list RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    governanceState.current = null;
    governanceState.shouldThrow = false;
    meetingsState.current = [];
    getUserGovernanceSummaryMock.mockClear();
  });

  it("returns empty notices (never an unscoped view) when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("workbench.notices.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      totalCount: 0,
      conflictCount: 0,
      attentionCount: 0,
      meetingInviteReviewCount: 0,
      meetingMinutesConfirmCount: 0,
      meetingTodoItems: [],
      items: [],
    });
    // Must not touch the user-scoped governance source for an unresolved actor.
    expect(getUserGovernanceSummaryMock).not.toHaveBeenCalled();
  });

  it("projects the actor's governance summary into flat conflict/attention counts", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    governanceState.current = {
      openConflictCount: 2,
      openClaimConflictCount: 1,
      openDuplicateCount: 0,
      openStaleCount: 3,
      openOrphanCount: 0,
    };
    const result = await invoke("workbench.notices.list");
    expect(result.ok).toBe(true);
    expect(getUserGovernanceSummaryMock).toHaveBeenCalledTimes(1);
    expect(result.payload).toMatchObject({
      conflictCount: 3, // 2 + 1
      attentionCount: 3, // 0 + 3 + 0
      totalCount: 6,
    });
  });

  it("falls back to empty notices when the governance index is unavailable", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    governanceState.shouldThrow = true;
    const result = await invoke("workbench.notices.list");
    // A missing/not-yet-built index is not an error — it yields empty notices.
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      totalCount: 0,
      conflictCount: 0,
      attentionCount: 0,
      meetingInviteReviewCount: 0,
      meetingMinutesConfirmCount: 0,
      meetingTodoItems: [],
      items: [],
    });
  });

  it("merges the organizer's draft and pending_approval meetings into todos", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    governanceState.current = {
      openConflictCount: 1,
      openClaimConflictCount: 0,
      openDuplicateCount: 0,
      openStaleCount: 0,
      openOrphanCount: 0,
    };
    meetingsState.current = [
      { id: "m1", title: "A", status: "pending_approval" },
      { id: "m2", title: "B", status: "pending_approval" },
      { id: "m3", title: "C", status: "confirmed" },
      { id: "m4", title: "D", status: "draft" },
    ];
    const result = await invoke("workbench.notices.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      conflictCount: 1,
      meetingInviteReviewCount: 3,
      totalCount: 4,
      meetingTodoItems: [
        { id: "m1", title: "A", status: "pending_approval" },
        { id: "m2", title: "B", status: "pending_approval" },
        { id: "m4", title: "D", status: "draft" },
      ],
    });
  });

  it("counts the organizer's minuted meetings as an additive minutes-confirm count (Phase C2)", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    governanceState.current = null;
    meetingsState.current = [
      { id: "m-min-1", title: "Minuted 1", status: "minuted" },
      { id: "m-min-2", title: "Minuted 2", status: "minuted" },
      { id: "m-pend", title: "Pending", status: "pending_approval" },
      { id: "m-dist", title: "Done", status: "distributed" },
    ];
    const result = await invoke("workbench.notices.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      meetingInviteReviewCount: 1,
      meetingMinutesConfirmCount: 2,
      totalCount: 3,
    });
  });
});

describe("workbench.upcoming-collaboration.list RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    buildWorkbenchUpcomingCollaborationMock.mockClear();
  });

  it("returns an empty projection (never the unscoped view) when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("workbench.upcoming-collaboration.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      needsResponseCount: 0,
      decisionCount: 0,
      reviewCount: 0,
      activeCount: 0,
      items: [],
    });
    // Must not touch the install-wide collaboration store for an unresolved actor.
    expect(buildWorkbenchUpcomingCollaborationMock).not.toHaveBeenCalled();
  });

  it("scopes the read model to the resolved actor's seat spaces", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: ["space-a", "space-b"],
    };
    const result = await invoke("workbench.upcoming-collaboration.list", { limit: 5 });
    expect(result.ok).toBe(true);
    expect(buildWorkbenchUpcomingCollaborationMock).toHaveBeenCalledTimes(1);
    expect(buildWorkbenchUpcomingCollaborationMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      seatSpaceIds: ["space-a", "space-b"],
      limit: 5,
    });
    expect(result.payload?.needsResponseCount).toBe(2);
  });

  it("omits limit when params do not carry a numeric limit", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: [],
      seatSpaceIds: ["space-a"],
    };
    await invoke("workbench.upcoming-collaboration.list", {});
    expect(buildWorkbenchUpcomingCollaborationMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      seatSpaceIds: ["space-a"],
    });
  });

  it("responds with an error when the read model throws", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: [],
      seatSpaceIds: ["space-a"],
    };
    buildWorkbenchUpcomingCollaborationMock.mockRejectedValueOnce(new Error("boom"));
    const result = await invoke("workbench.upcoming-collaboration.list");
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("boom");
  });
});

describe("workbench.schedule.list RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    buildWorkbenchScheduleMock.mockClear();
  });

  it("returns an empty projection (never the unscoped view) when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("workbench.schedule.list");
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      todayCount: 0,
      upcomingCount: 0,
      cronDerivedCount: 0,
      hasRealEntries: false,
      items: [],
    });
    // Must not touch the cron store / schedule entries for an unresolved actor.
    expect(buildWorkbenchScheduleMock).not.toHaveBeenCalled();
  });

  it("scopes the read model to the resolved actor and excludes the builtin steward", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["bot-x", BUILTIN_STEWARD_AGENT_ID, "bot-y"],
      seatSpaceIds: ["space-a"],
    };
    const result = await invoke("workbench.schedule.list", { limit: 5 });
    expect(result.ok).toBe(true);
    expect(buildWorkbenchScheduleMock).toHaveBeenCalledTimes(1);
    expect(buildWorkbenchScheduleMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      // builtin steward ("main") filtered out so a member never inherits the
      // universal steward's cron as their own schedule.
      visibleAgentIds: ["bot-x", "bot-y"],
      limit: 5,
      timeZone: "UTC",
      deps: { listEntries: expect.any(Function) },
    });
    expect(result.payload?.upcomingCount).toBe(3);
  });

  it("omits tenantId and limit when the actor has no tenant and params carry no numeric limit", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    await invoke("workbench.schedule.list", { limit: "not-a-number" });
    expect(buildWorkbenchScheduleMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      visibleAgentIds: ["bot-x"],
      timeZone: "UTC",
      deps: { listEntries: expect.any(Function) },
    });
  });

  it("responds with an error when the read model throws", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    buildWorkbenchScheduleMock.mockRejectedValueOnce(new Error("boom"));
    const result = await invoke("workbench.schedule.list");
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("boom");
  });
});

describe("workbench.steward-suggestion.get RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    governanceState.current = null;
    governanceState.shouldThrow = false;
    buildWorkbenchPendingTasksMock.mockClear();
    buildWorkbenchUpcomingCollaborationMock.mockClear();
    getUserGovernanceSummaryMock.mockClear();
    // The suggestion layer caches per-actor by signature; reset so each case
    // starts cold (otherwise a prior case's user-1 entry serves fromCache).
    __resetStewardSuggestionCacheForTests();
  });

  it("returns an empty suggestion (never an unscoped view) when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("workbench.steward-suggestion.get");
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      suggestion: null,
      signature: "",
      fromCache: false,
      llmUsed: false,
    });
    // None of the (actor-scoped) signal sources may be touched without an actor.
    expect(buildWorkbenchPendingTasksMock).not.toHaveBeenCalled();
    expect(buildWorkbenchUpcomingCollaborationMock).not.toHaveBeenCalled();
    expect(getUserGovernanceSummaryMock).not.toHaveBeenCalled();
  });

  it("aggregates the actor-scoped signals into a deterministic template suggestion (no LLM)", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["bot-x", BUILTIN_STEWARD_AGENT_ID, "bot-y"],
      seatSpaceIds: ["space-a"],
    };
    // Default pending mock → ackRequiredCount:1 → highest-priority "ack" template.
    const result = await invoke("workbench.steward-suggestion.get");
    expect(result.ok).toBe(true);
    // pending scope excludes the builtin steward (id "main").
    expect(buildWorkbenchPendingTasksMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      tenantId: "tenant-a",
      seatSpaceIds: ["space-a"],
      visibleAgentIds: ["bot-x", "bot-y"],
    });
    expect(buildWorkbenchUpcomingCollaborationMock).toHaveBeenCalledWith({
      userId: "user-1",
      userEmail: "u1@example.com",
      seatSpaceIds: ["space-a"],
    });
    // M4a: deterministic only, no model call.
    expect(result.payload?.llmUsed).toBe(false);
    expect(result.payload?.suggestion).toMatchObject({
      kind: "ack",
      source: "template",
      text: "有 1 项待确认任务需要你先处理",
    });
  });

  it("returns a null suggestion when every signal is zero", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: [],
    };
    buildWorkbenchPendingTasksMock.mockResolvedValueOnce({
      totalCount: 0,
      taskCount: 0,
      ackRequiredCount: 0,
      governanceCount: 0,
      inviteCount: 0,
      items: [],
    });
    buildWorkbenchUpcomingCollaborationMock.mockResolvedValueOnce({
      needsResponseCount: 0,
      decisionCount: 0,
      reviewCount: 0,
      activeCount: 0,
      items: [],
    });
    const result = await invoke("workbench.steward-suggestion.get");
    expect(result.ok).toBe(true);
    expect(result.payload?.suggestion).toBeNull();
  });

  it("degrades per-source: a failing read-model still yields a suggestion from the others", async () => {
    actorState.current = {
      userId: "user-1",
      userEmail: "u1@example.com",
      seatAgentIds: ["bot-x"],
      seatSpaceIds: ["space-a"],
    };
    // Pending throws → empty; upcoming default has decisionCount:1 → "decision".
    buildWorkbenchPendingTasksMock.mockRejectedValueOnce(new Error("pending boom"));
    const result = await invoke("workbench.steward-suggestion.get");
    expect(result.ok).toBe(true);
    expect(result.payload?.suggestion).toMatchObject({
      kind: "decision",
      source: "template",
      text: "1 个协作群在等你拍板",
    });
  });
});

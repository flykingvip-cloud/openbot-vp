// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C)
// 过闸口生产者 RPC：actor 解析、参数校验、休眠 runner -> unavailable、produced 映射。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const actorState = vi.hoisted(() => ({ current: null as EmployeeWorkbenchActor | null }));
const runnerState = vi.hoisted(() => ({ current: null as unknown }));
const generateInviteDraftMock = vi.hoisted(() => vi.fn());
const generateMeetingMinutesMock = vi.hoisted(() => vi.fn());
const extractScheduleCandidatesMock = vi.hoisted(() => vi.fn());
const readOrganizerMeetingsMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
}));
// Mock the model-runner seam + the producers so the handler test never loads the heavy
// commercial-gate chain; the producers are unit-tested separately.
vi.mock("../lifecycle/lifecycle-model-runner.js", () => ({
  getLifecycleModelRunner: vi.fn(() => runnerState.current),
}));
vi.mock("../lifecycle/invite-draft-run.js", () => ({
  generateInviteDraft: generateInviteDraftMock,
}));
vi.mock("../lifecycle/meeting-minutes-run.js", () => ({
  generateMeetingMinutes: generateMeetingMinutesMock,
}));
vi.mock("../lifecycle/schedule-extraction-run.js", () => ({
  extractScheduleCandidates: extractScheduleCandidatesMock,
}));
vi.mock("../../organization/meeting-store.js", () => ({
  readOrganizerMeetings: readOrganizerMeetingsMock,
}));

const { lifecycleProducerHandlers } = await import("./lifecycle-producer.js");

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
): Promise<{ ok: boolean; payload?: Record<string, unknown>; error?: { message?: string } }> {
  const handler = lifecycleProducerHandlers[method] as GatewayRequestHandler | undefined;
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

beforeEach(() => {
  actorState.current = ACTOR;
  runnerState.current = null;
  generateInviteDraftMock.mockReset();
  generateMeetingMinutesMock.mockReset();
  extractScheduleCandidatesMock.mockReset();
  readOrganizerMeetingsMock.mockReset();
  readOrganizerMeetingsMock.mockResolvedValue([]);
});

describe("meeting.draft-invite", () => {
  it("rejects when no actor resolves", async () => {
    actorState.current = null;
    expect((await invoke("meeting.draft-invite", { meetingTitle: "x", context: "y" })).ok).toBe(
      false,
    );
  });

  it("rejects when meetingTitle or context is missing", async () => {
    expect((await invoke("meeting.draft-invite", { meetingTitle: "x" })).ok).toBe(false);
    expect((await invoke("meeting.draft-invite", { context: "y" })).ok).toBe(false);
    expect(generateInviteDraftMock).not.toHaveBeenCalled();
  });

  it("returns unavailable when the model runner is dormant (no fake success)", async () => {
    runnerState.current = null;
    const result = await invoke("meeting.draft-invite", { meetingTitle: "Kickoff", context: "c" });
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({ status: "unavailable" });
    expect(generateInviteDraftMock).not.toHaveBeenCalled();
  });

  it("maps a produced draft and attributes to the organizer actor", async () => {
    runnerState.current = () => undefined;
    generateInviteDraftMock.mockResolvedValue({
      status: "produced",
      candidate: { kind: "invite_draft", subject: "Kickoff", body: "join", attendeeUserIds: [] },
      enterpriseId: "tenant-a",
      usageQuantity: 10,
    });
    const result = await invoke("meeting.draft-invite", {
      meetingTitle: "Kickoff",
      context: "plan",
      attendeeUserIds: ["user-2"],
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({ status: "produced" });
    expect((result.payload?.draft as { subject?: string })?.subject).toBe("Kickoff");
    expect(generateInviteDraftMock.mock.calls[0]?.[0]).toMatchObject({
      organizerUserId: "user-1",
      enterpriseId: "tenant-a",
      meetingTitle: "Kickoff",
      context: "plan",
      attendeeUserIds: ["user-2"],
    });
  });

  it("passes through a skipped outcome (non-enterprise)", async () => {
    runnerState.current = () => undefined;
    generateInviteDraftMock.mockResolvedValue({ status: "skipped" });
    const result = await invoke("meeting.draft-invite", { meetingTitle: "Kickoff", context: "c" });
    expect(result.payload).toEqual({ status: "skipped" });
  });
});

describe("meeting.generate-minutes", () => {
  it("requires a transcript", async () => {
    expect((await invoke("meeting.generate-minutes", { meetingTitle: "Sync" })).ok).toBe(false);
    expect(generateMeetingMinutesMock).not.toHaveBeenCalled();
  });

  it("returns unavailable when the model runner is dormant", async () => {
    runnerState.current = null;
    const result = await invoke("meeting.generate-minutes", {
      meetingTitle: "Sync",
      transcript: "Alice will draft the spec.",
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({ status: "unavailable" });
    expect(generateMeetingMinutesMock).not.toHaveBeenCalled();
  });

  it("uses the stored meeting title and attendees when meetingId is set", async () => {
    runnerState.current = () => undefined;
    readOrganizerMeetingsMock.mockResolvedValue([
      {
        id: "m1",
        title: "Sync",
        attendees: [{ userId: "user-1" }, { userId: "user-2" }],
      },
    ]);
    generateMeetingMinutesMock.mockResolvedValue({
      status: "produced",
      candidate: {
        kind: "minutes_draft",
        summary: "ship",
        decisions: [],
        actionItems: [{ kind: "task", title: "draft spec", assigneeUserId: "user-2" }],
      },
      enterpriseId: "tenant-a",
      usageQuantity: 4,
    });
    const result = await invoke("meeting.generate-minutes", {
      meetingId: "m1",
      meetingTitle: "ignored",
      attendeeUserIds: ["user-9"],
      transcript: "user-2 will draft the spec",
    });
    expect(result.payload).toMatchObject({ status: "produced" });
    expect(generateMeetingMinutesMock.mock.calls[0]?.[0]).toMatchObject({
      organizerUserId: "user-1",
      meetingTitle: "Sync",
      attendeeUserIds: ["user-1", "user-2"],
    });
  });
});

describe("schedule.extract", () => {
  it("requires conversationText", async () => {
    expect((await invoke("schedule.extract", {})).ok).toBe(false);
    expect(extractScheduleCandidatesMock).not.toHaveBeenCalled();
  });

  it("returns unavailable when the runner is dormant", async () => {
    runnerState.current = null;
    const result = await invoke("schedule.extract", { conversationText: "demo friday" });
    expect(result.payload).toMatchObject({ status: "unavailable" });
    expect(extractScheduleCandidatesMock).not.toHaveBeenCalled();
  });

  it("maps produced candidates", async () => {
    runnerState.current = () => undefined;
    extractScheduleCandidatesMock.mockResolvedValue({
      status: "produced",
      candidate: [{ kind: "schedule_entry", title: "Demo", startAt: "2026-07-03T15:00:00.000Z" }],
      enterpriseId: "tenant-a",
      usageQuantity: 7,
    });
    const result = await invoke("schedule.extract", {
      conversationText: "demo friday 3pm",
      sourceLabel: "Platform space",
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({ status: "produced" });
    expect((result.payload?.candidates as unknown[])?.length).toBe(1);
    expect(extractScheduleCandidatesMock.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      enterpriseId: "tenant-a",
      conversationText: "demo friday 3pm",
      sourceLabel: "Platform space",
    });
  });
});

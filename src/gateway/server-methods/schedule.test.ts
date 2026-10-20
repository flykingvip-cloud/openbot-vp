// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import type { WorkbenchScheduleEntry } from "../workbench/schedule-read-model.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const actorState = vi.hoisted(() => ({
  current: null as EmployeeWorkbenchActor | null,
}));

const upsertScheduleEntryMock = vi.hoisted(() =>
  vi.fn(async (entry: Record<string, unknown>) => ({ ...entry, id: entry.id || "generated-id" })),
);
const cancelScheduleEntryMock = vi.hoisted(() =>
  vi.fn(
    async (_params: { userId: string; id: string }): Promise<WorkbenchScheduleEntry | null> => ({
      id: "a",
      ownerUserId: "user-1",
      title: "Sync",
      startAtMs: 1_700_000_000_000,
      timezone: "UTC",
      kind: "personal",
      status: "cancelled",
      sourceRef: { kind: "manual", id: "a" },
    }),
  ),
);

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
}));

vi.mock("../../organization/schedule-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/schedule-store.js")>();
  return {
    ...actual,
    upsertScheduleEntry: upsertScheduleEntryMock,
    cancelScheduleEntry: cancelScheduleEntryMock,
  };
});

const { scheduleHandlers } = await import("./schedule.js");

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
}> {
  const handler = scheduleHandlers[method] as GatewayRequestHandler | undefined;
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

const ACTOR: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "u1@example.com",
  tenantId: "tenant-a",
  seatAgentIds: ["bot-x"],
  seatSpaceIds: ["space-a"],
};

describe("schedule.entry.upsert RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    upsertScheduleEntryMock.mockClear();
  });

  it("rejects when no actor resolves (never writes without identity)", async () => {
    actorState.current = null;
    const result = await invoke("schedule.entry.upsert", { title: "x", startAtMs: 1 });
    expect(result.ok).toBe(false);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("stamps ownerUserId/tenantId from the actor (never the client)", async () => {
    actorState.current = ACTOR;
    const result = await invoke("schedule.entry.upsert", {
      // A malicious client tries to write for another user — must be ignored.
      ownerUserId: "user-999",
      tenantId: "tenant-evil",
      title: "  Team sync  ",
      startAtMs: 1_700_000_000_000,
      endAtMs: 1_700_000_900_000,
      kind: "reminder",
      timezone: "Asia/Shanghai",
    });
    expect(result.ok).toBe(true);
    expect(upsertScheduleEntryMock).toHaveBeenCalledTimes(1);
    const arg = upsertScheduleEntryMock.mock.calls[0]?.[0];
    expect(arg.ownerUserId).toBe("user-1");
    expect(arg.tenantId).toBe("tenant-a");
    expect(arg.title).toBe("Team sync");
    expect(arg.kind).toBe("reminder");
    expect(arg.timezone).toBe("Asia/Shanghai");
    expect(arg.status).toBe("confirmed");
    expect(arg.sourceRef).toEqual({ kind: "manual", id: "manual" });
  });

  it("coerces a non-writable kind (cron-derived/meeting) to personal", async () => {
    actorState.current = ACTOR;
    await invoke("schedule.entry.upsert", {
      title: "x",
      startAtMs: 1_700_000_000_000,
      kind: "cron-derived",
    });
    const arg = upsertScheduleEntryMock.mock.calls[0]?.[0];
    expect(arg.kind).toBe("personal");
  });

  it("rejects a missing/empty title", async () => {
    actorState.current = ACTOR;
    const result = await invoke("schedule.entry.upsert", { title: "  ", startAtMs: 1 });
    expect(result.ok).toBe(false);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive or non-finite startAtMs", async () => {
    actorState.current = ACTOR;
    expect((await invoke("schedule.entry.upsert", { title: "x", startAtMs: 0 })).ok).toBe(false);
    expect((await invoke("schedule.entry.upsert", { title: "x" })).ok).toBe(false);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("rejects endAtMs earlier than startAtMs", async () => {
    actorState.current = ACTOR;
    const result = await invoke("schedule.entry.upsert", {
      title: "x",
      startAtMs: 1_000,
      endAtMs: 500,
    });
    expect(result.ok).toBe(false);
    expect(upsertScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("responds with an error when the store throws", async () => {
    actorState.current = ACTOR;
    upsertScheduleEntryMock.mockRejectedValueOnce(new Error("disk full"));
    const result = await invoke("schedule.entry.upsert", { title: "x", startAtMs: 1 });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("disk full");
  });
});

describe("schedule.entry.cancel RPC", () => {
  beforeEach(() => {
    actorState.current = null;
    cancelScheduleEntryMock.mockClear();
  });

  it("rejects when no actor resolves", async () => {
    actorState.current = null;
    const result = await invoke("schedule.entry.cancel", { id: "a" });
    expect(result.ok).toBe(false);
    expect(cancelScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("rejects a missing id", async () => {
    actorState.current = ACTOR;
    const result = await invoke("schedule.entry.cancel", {});
    expect(result.ok).toBe(false);
    expect(cancelScheduleEntryMock).not.toHaveBeenCalled();
  });

  it("cancels scoped to the actor's own user id", async () => {
    actorState.current = ACTOR;
    const result = await invoke("schedule.entry.cancel", { id: "a" });
    expect(result.ok).toBe(true);
    expect(cancelScheduleEntryMock).toHaveBeenCalledWith({ userId: "user-1", id: "a" });
    expect(result.payload).toMatchObject({ cancelled: true });
  });

  it("reports cancelled:false when the entry is not found", async () => {
    actorState.current = ACTOR;
    cancelScheduleEntryMock.mockResolvedValueOnce(null);
    const result = await invoke("schedule.entry.cancel", { id: "missing" });
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ cancelled: false, entry: null });
  });
});

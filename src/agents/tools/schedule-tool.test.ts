// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeWorkbenchActor } from "../../gateway/employee-workbench-scope.js";
import type { WorkbenchScheduleEntry } from "../../gateway/workbench/schedule-read-model.js";

const actorState = vi.hoisted(() => ({ current: null as EmployeeWorkbenchActor | null }));
const upsertMock = vi.hoisted(() =>
  vi.fn(async (entry: WorkbenchScheduleEntry) => ({ ...entry, id: entry.id || "gen-id" })),
);
const cancelMock = vi.hoisted(() =>
  vi.fn(
    async (_params: { userId: string; id: string }): Promise<WorkbenchScheduleEntry | null> => null,
  ),
);
const readMock = vi.hoisted(() =>
  vi.fn(async (_userId: string): Promise<WorkbenchScheduleEntry[]> => []),
);

vi.mock("../../gateway/employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
}));

// Keep the real buildManualScheduleEntry (so the tool's owner-stamping / kind
// coercion is exercised); only stub the fs-touching store functions.
vi.mock("../../organization/schedule-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../organization/schedule-store.js")>();
  return {
    ...actual,
    upsertScheduleEntry: upsertMock,
    cancelScheduleEntry: cancelMock,
    readUserScheduleEntries: readMock,
  };
});

const { createScheduleTool } = await import("./schedule-tool.js");

const ACTOR: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "u1@example.com",
  tenantId: "tenant-a",
  seatAgentIds: [],
  seatSpaceIds: [],
};

function makeEntry(overrides: Partial<WorkbenchScheduleEntry>): WorkbenchScheduleEntry {
  return {
    id: overrides.id ?? "a",
    ownerUserId: overrides.ownerUserId ?? "user-1",
    title: overrides.title ?? "x",
    startAtMs: overrides.startAtMs ?? 1,
    timezone: overrides.timezone ?? "UTC",
    kind: overrides.kind ?? "personal",
    status: overrides.status ?? "confirmed",
    sourceRef: overrides.sourceRef ?? { kind: "manual", id: "a" },
  };
}

async function run(
  args: Record<string, unknown>,
  opts?: { gatewayClientUser?: string },
): Promise<Record<string, unknown>> {
  const tool = createScheduleTool({
    gatewayClientUser:
      "gatewayClientUser" in (opts ?? {}) ? opts?.gatewayClientUser : "u1@example.com",
    gatewayClientSessionDomain: "employee",
  });
  if (!tool.execute) {
    throw new Error("schedule tool has no execute");
  }
  const result = await tool.execute("call-1", args);
  return (result.details ?? {}) as Record<string, unknown>;
}

describe("schedule tool", () => {
  beforeEach(() => {
    actorState.current = ACTOR;
    upsertMock.mockClear();
    cancelMock.mockClear();
    readMock.mockClear();
  });

  it("refuses when no employee actor resolves", async () => {
    actorState.current = null;
    await expect(
      run({ action: "add", title: "x", startAt: "2026-07-01T15:00:00Z" }),
    ).rejects.toThrow(/signed-in employee session/i);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("refuses when there is no gateway user context", async () => {
    await expect(run({ action: "list" }, { gatewayClientUser: undefined })).rejects.toThrow(
      /signed-in employee session/i,
    );
  });

  it("add parses ISO startAt and stamps owner/tenant from the actor", async () => {
    const startIso = "2026-07-01T15:00:00Z";
    const out = await run({
      action: "add",
      title: "  Demo  ",
      startAt: startIso,
      kind: "reminder",
      timezone: "Asia/Shanghai",
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const arg = upsertMock.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      ownerUserId: "user-1",
      tenantId: "tenant-a",
      title: "Demo",
      startAtMs: Date.parse(startIso),
      kind: "reminder",
      timezone: "Asia/Shanghai",
      status: "confirmed",
    });
    expect(out.ok).toBe(true);
  });

  it("add ignores a client-provided owner (cannot target another user)", async () => {
    await run({
      action: "add",
      title: "x",
      startAt: "2026-07-01T15:00:00Z",
      ownerUserId: "user-999",
    });
    const arg = upsertMock.mock.calls[0]?.[0] as WorkbenchScheduleEntry | undefined;
    expect(arg?.ownerUserId).toBe("user-1");
  });

  it("add coerces a non-writable kind to personal", async () => {
    await run({ action: "add", title: "x", startAt: "2026-07-01T15:00:00Z", kind: "meeting" });
    const arg = upsertMock.mock.calls[0]?.[0] as WorkbenchScheduleEntry | undefined;
    expect(arg?.kind).toBe("personal");
  });

  it("add rejects an invalid startAt", async () => {
    await expect(run({ action: "add", title: "x", startAt: "not-a-date" })).rejects.toThrow(
      /startAt/i,
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("add rejects endAt before startAt", async () => {
    await expect(
      run({
        action: "add",
        title: "x",
        startAt: "2026-07-01T15:00:00Z",
        endAt: "2026-07-01T14:00:00Z",
      }),
    ).rejects.toThrow(/endAt/i);
  });

  it("cancel calls the store scoped to the actor's user id", async () => {
    cancelMock.mockResolvedValueOnce(makeEntry({ id: "a", status: "cancelled" }));
    const out = await run({ action: "cancel", id: "a" });
    expect(cancelMock).toHaveBeenCalledWith({ userId: "user-1", id: "a" });
    expect(out).toMatchObject({ cancelled: true });
  });

  it("list returns only active (non-cancelled) entries", async () => {
    readMock.mockResolvedValueOnce([
      makeEntry({ id: "a", title: "Keep", status: "confirmed" }),
      makeEntry({ id: "b", title: "Gone", status: "cancelled" }),
    ]);
    const out = await run({ action: "list" });
    const entries = out.entries as Array<{ id: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("a");
  });
});

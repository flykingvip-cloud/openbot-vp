// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkbenchScheduleEntry } from "../gateway/workbench/schedule-read-model.js";
import {
  cancelScheduleEntry,
  readUserScheduleEntries,
  upsertScheduleEntry,
  writeUserScheduleEntries,
} from "./schedule-store.js";

let stateDir: string;
let prevStateDir: string | undefined;

function entry(overrides: Partial<WorkbenchScheduleEntry>): WorkbenchScheduleEntry {
  return {
    id: overrides.id ?? "e1",
    ownerUserId: overrides.ownerUserId ?? "user-1",
    ...(overrides.tenantId !== undefined ? { tenantId: overrides.tenantId } : {}),
    title: overrides.title ?? "Sync",
    startAtMs: overrides.startAtMs ?? 1_700_000_000_000,
    ...(overrides.endAtMs !== undefined ? { endAtMs: overrides.endAtMs } : {}),
    timezone: overrides.timezone ?? "UTC",
    kind: overrides.kind ?? "personal",
    status: overrides.status ?? "confirmed",
    sourceRef: overrides.sourceRef ?? { kind: "manual", id: "e1" },
  };
}

beforeEach(() => {
  prevStateDir = process.env.OPENBOT_STATE_DIR;
  stateDir = mkdtempSync(path.join(tmpdir(), "sched-store-"));
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

describe("schedule-store", () => {
  it("returns empty for a user with no file", async () => {
    expect(await readUserScheduleEntries("nobody")).toEqual([]);
  });

  it("round-trips an upserted entry", async () => {
    const saved = await upsertScheduleEntry(entry({ id: "a", title: "Standup" }));
    expect(saved.id).toBe("a");
    const read = await readUserScheduleEntries("user-1");
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ id: "a", title: "Standup", ownerUserId: "user-1" });
  });

  it("generates an id when none is provided", async () => {
    const saved = await upsertScheduleEntry(entry({ id: "" }));
    expect(saved.id).toBeTruthy();
    const read = await readUserScheduleEntries("user-1");
    expect(read[0]?.id).toBe(saved.id);
  });

  it("replaces an existing entry on upsert (same id)", async () => {
    await upsertScheduleEntry(entry({ id: "a", title: "First" }));
    await upsertScheduleEntry(entry({ id: "a", title: "Second" }));
    const read = await readUserScheduleEntries("user-1");
    expect(read).toHaveLength(1);
    expect(read[0]?.title).toBe("Second");
  });

  it("isolates entries by user (one user never sees another's)", async () => {
    await upsertScheduleEntry(entry({ id: "a", ownerUserId: "user-1" }));
    await upsertScheduleEntry(entry({ id: "b", ownerUserId: "user-2" }));
    expect((await readUserScheduleEntries("user-1")).map((x) => x.id)).toEqual(["a"]);
    expect((await readUserScheduleEntries("user-2")).map((x) => x.id)).toEqual(["b"]);
  });

  it("defensively drops a row whose ownerUserId does not match the file's user", async () => {
    // Write into user-1's file a row stamped for user-2 (e.g. a hand-edited or
    // migrated file). The read must never hand it to user-1.
    await writeUserScheduleEntries("user-1", [
      entry({ id: "mine", ownerUserId: "user-1" }),
      entry({ id: "foreign", ownerUserId: "user-2" }),
    ]);
    expect((await readUserScheduleEntries("user-1")).map((x) => x.id)).toEqual(["mine"]);
  });

  it("cancel flips status to cancelled and is idempotent", async () => {
    await upsertScheduleEntry(entry({ id: "a", status: "confirmed" }));
    const first = await cancelScheduleEntry({ userId: "user-1", id: "a" });
    expect(first?.status).toBe("cancelled");
    const second = await cancelScheduleEntry({ userId: "user-1", id: "a" });
    expect(second?.status).toBe("cancelled");
    expect((await readUserScheduleEntries("user-1"))[0]?.status).toBe("cancelled");
  });

  it("cancel returns null for an unknown id", async () => {
    expect(await cancelScheduleEntry({ userId: "user-1", id: "missing" })).toBeNull();
  });

  it("cannot cancel another user's entry", async () => {
    await upsertScheduleEntry(entry({ id: "a", ownerUserId: "user-1" }));
    // user-2 has no such entry in their own file → null; user-1's stays confirmed.
    expect(await cancelScheduleEntry({ userId: "user-2", id: "a" })).toBeNull();
    expect((await readUserScheduleEntries("user-1"))[0]?.status).toBe("confirmed");
  });

  it("tolerates a corrupt file (returns empty rather than throwing)", async () => {
    await upsertScheduleEntry(entry({ id: "a" }));
    writeFileSync(path.join(stateDir, "schedule", "user-1", "entries.json"), "not json{");
    expect(await readUserScheduleEntries("user-1")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  addLocalFileApproval,
  parseLocalFileApprovalRequested,
  parseLocalFileApprovalResolved,
  pruneLocalFileApprovalQueue,
  removeLocalFileApproval,
  type LocalFileApprovalRequest,
} from "./local-file-approval.ts";

const NOW = Date.now();

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "ap-1",
    canonicalPath: "/Users/demo/Desktop/pack.zip",
    targetKind: "file",
    task: "inspect-archive",
    taskDescription: "inspect this archive",
    agentId: "bot-skill",
    userId: "u1",
    tenantId: "t1",
    budget: { maxEntriesRead: 30, maxTotalExpandedBytes: 5_242_880, maxCalls: 32 },
    createdAtMs: NOW,
    expiresAtMs: NOW + 90_000,
    ...overrides,
  };
}

function entry(id: string, expiresAtMs: number): LocalFileApprovalRequest {
  const parsed = parseLocalFileApprovalRequested(payload({ id, expiresAtMs }));
  if (!parsed) {
    throw new Error("fixture failed to parse");
  }
  return parsed;
}

describe("parseLocalFileApprovalRequested", () => {
  it("parses a well-formed card", () => {
    const parsed = parseLocalFileApprovalRequested(payload());
    expect(parsed).not.toBeNull();
    expect(parsed?.request.canonicalPath).toBe("/Users/demo/Desktop/pack.zip");
    expect(parsed?.request.task).toBe("inspect-archive");
    expect(parsed?.request.budget?.maxCalls).toBe(32);
  });

  it("accepts a nested request object as well as a flat summary", () => {
    const { id, createdAtMs, expiresAtMs, ...rest } = payload();
    const nested = parseLocalFileApprovalRequested({ id, createdAtMs, expiresAtMs, request: rest });
    expect(nested?.request.canonicalPath).toBe("/Users/demo/Desktop/pack.zip");
  });

  it("returns null when a required field is missing rather than defaulting it", () => {
    for (const missing of [
      "id",
      "canonicalPath",
      "task",
      "targetKind",
      "createdAtMs",
      "expiresAtMs",
    ]) {
      expect(parseLocalFileApprovalRequested(payload({ [missing]: undefined }))).toBeNull();
    }
  });

  it("rejects an unknown task rather than showing an unlabelled card", () => {
    expect(parseLocalFileApprovalRequested(payload({ task: "delete-everything" }))).toBeNull();
  });

  it("rejects an unknown target kind", () => {
    expect(parseLocalFileApprovalRequested(payload({ targetKind: "socket" }))).toBeNull();
  });

  it("falls back to the task name when no description is supplied", () => {
    const parsed = parseLocalFileApprovalRequested(payload({ taskDescription: "  " }));
    expect(parsed?.request.taskDescription).toBe("inspect-archive");
  });

  it("drops a malformed budget instead of showing a partial one", () => {
    const parsed = parseLocalFileApprovalRequested(
      payload({ budget: { maxEntriesRead: 3, maxCalls: 4 } }),
    );
    expect(parsed?.request.budget).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      expect(parseLocalFileApprovalRequested(bad)).toBeNull();
    }
  });
});

describe("parseLocalFileApprovalResolved", () => {
  it("parses id plus optional detail", () => {
    const parsed = parseLocalFileApprovalResolved({
      id: "ap-1",
      decision: "deny",
      resolvedBy: "someone",
    });
    expect(parsed).toEqual({ id: "ap-1", decision: "deny", resolvedBy: "someone" });
  });

  it("requires an id", () => {
    expect(parseLocalFileApprovalResolved({ decision: "deny" })).toBeNull();
    expect(parseLocalFileApprovalResolved({ id: "   " })).toBeNull();
  });
});

describe("queue reducers", () => {
  it("drops expired entries on every operation", () => {
    const stale = entry("stale", NOW - 1_000);
    const fresh = entry("fresh", NOW + 60_000);
    expect(pruneLocalFileApprovalQueue([stale, fresh]).map((e) => e.id)).toEqual(["fresh"]);
    expect(addLocalFileApproval([stale], fresh).map((e) => e.id)).toEqual(["fresh"]);
    expect(removeLocalFileApproval([stale, fresh], "nope").map((e) => e.id)).toEqual(["fresh"]);
  });

  it("dedupes by id so a re-sent card does not stack", () => {
    const first = entry("ap-1", NOW + 60_000);
    const resent = entry("ap-1", NOW + 90_000);
    const queue = addLocalFileApproval([first], resent);
    expect(queue).toHaveLength(1);
    expect(queue[0].expiresAtMs).toBe(NOW + 90_000);
  });

  it("appends so the oldest card stays at the head", () => {
    const a = entry("a", NOW + 60_000);
    const b = entry("b", NOW + 60_000);
    expect(addLocalFileApproval([a], b).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("returns new arrays so lit re-renders", () => {
    const queue = [entry("a", NOW + 60_000)];
    expect(addLocalFileApproval(queue, entry("b", NOW + 60_000))).not.toBe(queue);
    expect(removeLocalFileApproval(queue, "a")).not.toBe(queue);
  });
});

import { expect, it, vi } from "vitest";
import {
  createInteractionSourceBoundary,
  formatRestrictedInteractionNotice,
  routeInteraction,
} from "./index.js";

it.each(["EACCES", "EIO", "ENOSPC", "EROFS"])(
  "local %s failure restricts this turn without a retry",
  (code) => {
    const source = vi.fn(() => {
      throw Object.assign(new Error("private path"), { code });
    });
    const boundary = createInteractionSourceBoundary();
    expect(boundary.read("transcript_unavailable", source, [])).toEqual([]);
    expect(source).toHaveBeenCalledOnce();
    expect(boundary.availability).toEqual({
      mode: "restricted",
      reasons: ["transcript_unavailable"],
    });
    expect(JSON.stringify(boundary.availability)).not.toContain("private path");
    expect(createInteractionSourceBoundary().availability).toBeUndefined();
  },
);
it.each([
  new Error("auth denied"),
  new Error("budget exceeded"),
  new DOMException("cancelled", "AbortError"),
])("never treats authorization, budget or cancellation as optional source loss", (error) => {
  const boundary = createInteractionSourceBoundary();
  expect(() =>
    boundary.read(
      "context_source_unavailable",
      () => {
        throw error;
      },
      "",
    ),
  ).toThrow(error);
  expect(boundary.availability).toBeUndefined();
});
it("preserves available context and isolates a failed asynchronous source", async () => {
  const boundary = createInteractionSourceBoundary();
  expect(boundary.read("context_source_unavailable", () => "authorized identity", "")).toBe(
    "authorized identity",
  );
  expect(
    await boundary.readAsync(
      "context_source_unavailable",
      async () => {
        throw Object.assign(new Error("private source"), { code: "EIO" });
      },
      [],
    ),
  ).toEqual([]);
  expect(boundary.availability?.reasons).toEqual(["context_source_unavailable"]);
});
it.each(["execution_request", "task_change", "task_control"] as const)(
  "restricted %s never enters admission or task mutation",
  async (kind) => {
    const target = { taskId: "a", revision: "3" };
    const decision =
      kind === "execution_request"
        ? { kind, request: { goal: "report", acceptance: ["sources"] } }
        : kind === "task_change"
          ? { kind, target, text: "change requirement" }
          : { kind, target, action: "pause" };
    const infer = vi.fn(async () => decision);
    const authorize = vi.fn();
    const commit = vi.fn();
    const result = await routeInteraction(
      {
        message: "do it",
        context: [],
        taskTarget: target,
        availability: { mode: "restricted", reasons: ["task_state_unavailable"] },
      },
      { requestId: "m", expectedFocusRevision: 1, expectedWriteEpoch: 3 },
      { inference: { infer }, admission: { authorize, commit } },
    );
    expect(result).toMatchObject({
      kind: "respond",
      text: expect.stringContaining("无法可靠确认"),
    });
    expect(infer).toHaveBeenCalledOnce();
    expect(authorize).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  },
);
it("an uncertain task write is not described as unapplied or retried", () => {
  const text = formatRestrictedInteractionNotice({
    mode: "restricted",
    reasons: ["task_mutation_unconfirmed"],
  });
  expect(text).toContain("无法确认");
  expect(text).toContain("未自动重试");
  expect(text).not.toContain("已暂停");
});

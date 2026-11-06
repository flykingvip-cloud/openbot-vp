import { expect, it } from "vitest";
import type { SessionTaskBoard, TaskCompletionBinding } from "../contracts/task.js";
import { isLiveTaskBinding } from "./task-binding.js";

function fixture() {
  const binding: TaskCompletionBinding = {
    taskId: "a",
    executionAttempt: "run",
    deliverableVersion: "v1",
    constraints: ["local only"],
  };
  const board: SessionTaskBoard = {
    parked: [],
    focusRevision: 1,
    current: {
      ...binding,
      title: "A",
      goalText: "A",
      unfinished: true,
      createdAtMs: 1,
      stop: { summary: "running", workspacePaths: [] },
    },
  };
  return { board, binding };
}
it("accepts the exact live version without changing the supplied snapshot", () => {
  const { board, binding } = fixture();
  const before = JSON.stringify(board);
  expect(isLiveTaskBinding(board, binding, ["local only"])).toBe(true);
  expect(JSON.stringify(board)).toBe(before);
  expect(isLiveTaskBinding(board, { ...binding, constraints: undefined }, ["new"])).toBe(true);
  expect(isLiveTaskBinding(board, binding, ["new"])).toBe(false);
});
it.each(["missing", "completed", "paused", "tombstoned", "replaced", "attempt", "version"])(
  "rejects %s state",
  (change) => {
    const { board, binding } = fixture();
    if (change === "missing") {
      board.current = undefined;
    } else if (change === "tombstoned") {
      board.tombstones = [{ taskId: "a", closedAtMs: 2 }];
    } else if (board.current) {
      if (change === "completed") {
        board.current.unfinished = false;
      }
      if (change === "paused") {
        board.current.wakeSuppress = true;
      }
      if (change === "replaced") {
        board.current.taskId = "b";
      }
      if (change === "attempt") {
        board.current.executionAttempt = "next";
      }
      if (change === "version") {
        board.current.deliverableVersion = "v2";
      }
    }
    expect(isLiveTaskBinding(board, binding, ["local only"])).toBe(false);
  },
);

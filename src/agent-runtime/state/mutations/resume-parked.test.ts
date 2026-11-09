import { expect, it } from "vitest";
import type { SessionTaskBoard } from "../../contracts/task.js";
import { isLiveTaskBinding } from "../../policy/index.js";
import { resumeParkedTask } from "./resume-parked.js";

it("invalidates old attempt and artifact evidence before a parked task becomes runnable again", () => {
  const board: SessionTaskBoard = {
    focusRevision: 3,
    parked: [
      {
        taskId: "a",
        title: "A",
        goalText: "report",
        unfinished: true,
        createdAtMs: 1,
        parkedAtMs: 2,
        wakeSuppress: true,
        executionAttempt: "old-attempt",
        deliverableVersion: "old-version",
        deliverableChecked: true,
        effectiveConstraints: ["preserve sources"],
        stop: { summary: "waiting", workspacePaths: [] },
      },
    ],
  };
  const result = resumeParkedTask({
    board,
    taskId: "a",
    nowMs: 4,
    recheck: { authOk: true, stopActive: false },
  });
  expect(result.action).toBe("resume");
  expect(result.board.current?.taskId).toBe("a");
  expect(result.board.current?.effectiveConstraints).toEqual(["preserve sources"]);
  expect(
    isLiveTaskBinding(
      result.board,
      { taskId: "a", executionAttempt: "old-attempt", deliverableVersion: "old-version" },
      ["preserve sources"],
    ),
  ).toBe(false);
  expect(result.board.current?.deliverableChecked).toBe(false);
  expect(result.scheduleContinue).toBe(false);
});

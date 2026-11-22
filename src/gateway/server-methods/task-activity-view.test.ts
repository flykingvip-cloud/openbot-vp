import { expect, it } from "vitest";
import type { SessionTaskBoard } from "../../agent-runtime/contracts/task.js";
import { projectTaskActivity } from "./task-activity-view.js";
function board(): SessionTaskBoard {
  return {
    focusRevision: 1,
    parked: [],
    current: {
      taskId: "task",
      title: "Deliver report",
      goalText: "Report",
      createdAtMs: 1,
      unfinished: true,
      executionAttempt: "run",
      stop: { summary: "", workspacePaths: [] },
    },
  };
}
it("requires a bound live execution rather than unfinished or a session's unrelated run", () => {
  const input = { board: board(), sessionKey: "a", nowMs: 100 };
  expect(projectTaskActivity(input).task?.health).toBe("unknown");
  expect(projectTaskActivity({ ...input, activeExecutionAttempt: "aside" }).task?.health).toBe(
    "unknown",
  );
  expect(projectTaskActivity({ ...input, activeExecutionAttempt: "run" }).task?.health).toBe(
    "running",
  );
});
it("projects durable same-task dependencies, scheduled recovery and user gates", () => {
  const input = { board: board(), sessionKey: "a", nowMs: 100 };
  expect(
    projectTaskActivity({ ...input, dependency: { taskId: "old", waitingCount: 1 } }).task?.health,
  ).toBe("unknown");
  expect(
    projectTaskActivity({ ...input, dependency: { taskId: "task", waitingCount: 1 } }).task?.health,
  ).toBe("waiting_dependency");
  expect(
    projectTaskActivity({
      ...input,
      dependency: { taskId: "task", waitingCount: 0, nextWakeAtMs: 200 },
    }).task?.health,
  ).toBe("recovering");
  expect(
    projectTaskActivity({
      ...input,
      dependency: { taskId: "task", waitingCount: 0, nextWakeAtMs: 50 },
    }).task?.health,
  ).toBe("unknown");
  expect(
    projectTaskActivity({
      ...input,
      dependency: { taskId: "task", waitingCount: 0, needsUser: true },
    }).task?.health,
  ).toBe("needs_user");
});
it("never lets late running or dependency facts revive paused/cancelled/completed tasks", () => {
  const b = board();
  const input = { board: b, sessionKey: "a", nowMs: 100, activeExecutionAttempt: "run" };
  b.current!.wakeSuppress = true;
  expect(projectTaskActivity(input).task).toMatchObject({ lifecycle: "paused", health: "unknown" });
  b.current!.unfinished = false;
  expect(projectTaskActivity(input).task).toMatchObject({
    lifecycle: "terminal",
    health: "unknown",
  });
  b.tombstones = [{ taskId: "task", closedAtMs: 100 }];
  expect(projectTaskActivity(input).task).toBeNull();
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  sessionTaskBoardPath,
  startBoundTaskExecution,
  isTaskExecutionBindingCurrent,
} from "../../../conversation-task/session-task-board.js";
import { resumePausedCurrentTask } from "./resume-current.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-current-"));
  roots.push(root);
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, "");
  mutateSessionTaskBoard(file, () => ({
    board: {
      ...emptySessionTaskBoard(),
      current: {
        taskId: "a",
        title: "A",
        goalText: "report",
        acceptanceCriteria: ["sources"],
        unfinished: true,
        wakeSuppress: true,
        executionAttempt: "old",
        deliverableVersion: "old",
        createdAtMs: 1,
        stop: { summary: "paused", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  const board = readSessionTaskBoard(file);
  return {
    file,
    request: {
      taskId: "a",
      expectedFocusRevision: board.focusRevision,
      expectedWriteEpoch: board.writeEpoch ?? 0,
    },
  };
}
it("resumes the exact paused task once and fences previous callbacks before new execution", () => {
  const { file, request } = fixture();
  const result = resumePausedCurrentTask(file, request, { authOk: true, stopActive: false });
  expect(result.kind).toBe("accepted");
  expect(
    isTaskExecutionBindingCurrent(file, {
      taskId: "a",
      executionAttempt: "old",
      deliverableVersion: "old",
    }),
  ).toBe(false);
  expect(resumePausedCurrentTask(file, request, { authOk: true, stopActive: false }).kind).toBe(
    "rejected",
  );
  if (result.kind !== "accepted") {
    throw new Error("resume rejected");
  }
  expect(result.acceptance).toEqual(["sources"]);
  expect(startBoundTaskExecution(file, result.binding, "new")?.executionAttempt).toBe("new");
});
it.each([
  { authOk: false, stopActive: false },
  { authOk: true, stopActive: true },
  { authOk: true, stopActive: false, budgetOk: false },
  { authOk: true, stopActive: false, planOk: false },
  { authOk: true, stopActive: false, workspaceOk: false },
])("preserves exact board bytes when the live host recheck refuses: %j", (recheck) => {
  const { file, request } = fixture();
  const before = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
  expect(resumePausedCurrentTask(file, request, recheck).kind).toBe("rejected");
  expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(before);
});
it("rejects a stale interpreted resume after a concurrent state change without writing", () => {
  const { file, request } = fixture();
  mutateSessionTaskBoard(file, (board) => ({
    board: { ...board, current: { ...board.current!, taskId: "b" } },
    value: undefined,
  }));
  const before = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
  expect(resumePausedCurrentTask(file, request, { authOk: true, stopActive: false }).kind).toBe(
    "rejected",
  );
  expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(before);
});

it.each(["paused", "finished", "stale", "unauthorized"] as const)(
  "does not continue a %s task or alter its board",
  (condition) => {
    const { file, request } = fixture();
    if (condition !== "paused") {
      mutateSessionTaskBoard(file, (board) => ({
        board: {
          ...board,
          current: { ...board.current!, wakeSuppress: false, unfinished: condition !== "finished" },
        },
        value: undefined,
      }));
    }
    const board = readSessionTaskBoard(file);
    const before = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
    expect(
      resumePausedCurrentTask(
        file,
        {
          ...request,
          action: "continue",
          expectedWriteEpoch:
            condition === "stale" ? request.expectedWriteEpoch : (board.writeEpoch ?? 0),
        },
        { authOk: condition !== "unauthorized", stopActive: false },
      ).kind,
    ).toBe("rejected");
    expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(before);
  },
);

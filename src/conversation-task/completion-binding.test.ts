import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  captureTaskCompletionBinding,
  mutateSessionTaskBoard,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
} from "./session-task-board.js";

it("rejects late completion for A after focus switched to B without a completion notice", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "completion-binding-"));
  try {
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(sessionFile, "");
    mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...emptySessionTaskBoard(),
        current: {
          taskId: "a",
          title: "A",
          goalText: "A",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "running", workspacePaths: [] },
          executionAttempt: "attempt-a",
        },
      },
      value: undefined,
    }));
    expect(captureTaskCompletionBinding(sessionFile, "another request")).toBeUndefined();
    const binding = captureTaskCompletionBinding(sessionFile, "A");
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: { ...board, current: { ...board.current!, taskId: "b", title: "B" } },
      value: undefined,
    }));
    expect(recordCheckedTaskCompletion({ sessionFile, closed: true, binding }).persisted).toBe(
      false,
    );
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
    expect(fs.readFileSync(sessionFile, "utf8")).toBe("");
    expect(recordCheckedTaskCompletion({ sessionFile, closed: true }).persisted).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("does not bind an old queued request to a same-goal replacement task", async () => {
  const { startBoundTaskExecution } = await import("./session-task-board.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "queued-binding-"));
  try {
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, "");
    const task = {
      taskId: "a",
      title: "same",
      goalText: "same goal",
      unfinished: true,
      createdAtMs: 1,
      stop: { summary: "", workspacePaths: [] },
    };
    mutateSessionTaskBoard(file, () => ({
      board: { ...emptySessionTaskBoard(), current: task },
      value: undefined,
    }));
    const queued = captureTaskCompletionBinding(file, "same goal");
    mutateSessionTaskBoard(file, (board) => ({
      board: { ...board, current: { ...task, taskId: "b" } },
      value: undefined,
    }));
    expect(startBoundTaskExecution(file, queued, "run-old")).toBeUndefined();
    expect(readSessionTaskBoard(file).current?.executionAttempt).toBeUndefined();
    const admitted = captureTaskCompletionBinding(file, "same goal");
    const started = startBoundTaskExecution(file, admitted, "run-new");
    expect(started?.taskId).toBe("b");
    expect(started?.executionAttempt).toBe("run-new");
    expect(startBoundTaskExecution(file, admitted, "run-stale")).toBeUndefined();
    expect(
      recordCheckedTaskCompletion({ sessionFile: file, closed: true, binding: admitted }).persisted,
    ).toBe(false);
    expect(
      recordCheckedTaskCompletion({ sessionFile: file, closed: true, binding: started }).persisted,
    ).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

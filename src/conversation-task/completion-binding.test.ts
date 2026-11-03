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

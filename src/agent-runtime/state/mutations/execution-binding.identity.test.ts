import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { seedSessionTaskBoard, readSessionTaskBoard } from "../repository/task-board-file.js";
import { captureTaskCompletionBinding, startBoundTaskExecution } from "./execution-binding.js";

it("preserves persisted logical execution across fresh recovery bindings while attempt changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "execution-identity-recovery-"));
  const file = path.join(dir, "session.jsonl");
  try {
    seedSessionTaskBoard(file, {
      parked: [],
      focusRevision: 1,
      current: {
        taskId: "task",
        title: "Task",
        goalText: "Deliver report",
        unfinished: true,
        stop: { summary: "pending", workspacePaths: [] },
        createdAtMs: 1,
      },
    });
    const first = startBoundTaskExecution(file, captureTaskCompletionBinding(file), "attempt-1");
    expect(first?.logicalExecutionId).toBeTruthy();
    const recovered = captureTaskCompletionBinding(file);
    expect(recovered?.logicalExecutionId).toBe(first?.logicalExecutionId);
    const second = startBoundTaskExecution(file, recovered, "attempt-2");
    expect(second?.executionAttempt).toBe("attempt-2");
    expect(second?.logicalExecutionId).toBe(first?.logicalExecutionId);
    expect(readSessionTaskBoard(file).current?.logicalExecutionId).toBe(first?.logicalExecutionId);
    expect(startBoundTaskExecution(file, first, "stale-retry")).toBeUndefined();
    expect(readSessionTaskBoard(file).current?.executionAttempt).toBe("attempt-2");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

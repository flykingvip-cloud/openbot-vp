import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  captureTaskCompletionBinding,
} from "../../../conversation-task/session-task-board.js";
import { runEmbeddedPiAgent } from "./embedded-run.js";
const prepare = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("model preparation reached");
  }),
);
vi.mock("../../../agents/models-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../agents/models-config.js")>()),
  ensureOpenClawModelsJson: prepare,
}));
const roots: string[] = [];
beforeEach(() => {
  prepare.mockClear();
});
afterEach(() => {
  prepare.mockClear();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it.each(["paused", "paused-in-queue"])(
  "rejects obsolete execution before model preparation: %s",
  async (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-startup-fence-"));
    roots.push(root);
    const sessionFile = path.join(root, "session.jsonl");
    mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...emptySessionTaskBoard(),
        current: {
          taskId: "a",
          title: "A",
          goalText: "A",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "", workspacePaths: [] },
          executionAttempt: "r",
          deliverableVersion: "v",
        },
      },
      value: undefined,
    }));
    const binding = captureTaskCompletionBinding(sessionFile)!;
    const pause = () =>
      mutateSessionTaskBoard(sessionFile, (board) => ({
        board: { ...board, current: { ...board.current!, wakeSuppress: true } },
        value: undefined,
      }));
    if (mode === "paused") {
      pause();
    }
    let enqueues = 0;
    await expect(
      runEmbeddedPiAgent({
        sessionId: "session",
        sessionFile,
        workspaceDir: root,
        agentDir: root,
        config: {},
        prompt: "task",
        runId: "r",
        timeoutMs: 1000,
        taskExecutionBinding: binding,
        enqueue: async (task) => {
          if (++enqueues === 2 && mode === "paused-in-queue") {
            pause();
          }
          return task();
        },
      }),
    ).rejects.toThrow(/Original task/);
    expect(prepare).not.toHaveBeenCalled();
  },
);

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  captureTaskCompletionBinding,
} from "../../conversation-task/session-task-board.js";
import { createReplyDispatcher } from "./reply-dispatcher.js";

it.each(["sendToolResult", "sendBlockReply", "sendFinalReply"] as const)(
  "rejects queued task output at actual dispatch: %s",
  async (method) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-fence-"));
    try {
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
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const deliver = vi
        .fn()
        .mockImplementationOnce(() => hold)
        .mockResolvedValue(undefined);
      const dispatcher = createReplyDispatcher({ deliver });
      dispatcher.sendFinalReply({ text: "unbound control notice" });
      dispatcher[method](
        { text: "old task result" },
        { taskBoundary: { sessionFile, binding, constraints: binding.constraints ?? [] } },
      );
      mutateSessionTaskBoard(sessionFile, (board) => ({
        board: { ...board, current: { ...board.current!, wakeSuppress: true } },
        value: undefined,
      }));
      release();
      dispatcher.markComplete();
      await dispatcher.waitForIdle();
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(deliver.mock.calls[0][0].text).toBe("unbound control notice");
      expect(dispatcher.getDeliveryOutcomes?.().at(-1)?.ok).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

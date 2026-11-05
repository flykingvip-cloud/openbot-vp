import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { handleInteraction } from "../command/index.js";
import { bindInteractionPorts } from "./command-adapters.js";
it.each([false, true])(
  "answers task queries independently of executor occupancy: %s",
  (isActive) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-"));
    try {
      const sessionFile = path.join(dir, "session.jsonl");
      fs.writeFileSync(sessionFile, "");
      mutateSessionTaskBoard(sessionFile, () => ({
        board: {
          ...emptySessionTaskBoard(),
          current: {
            taskId: "a",
            title: "Report",
            goalText: "Write report",
            unfinished: true,
            createdAtMs: 1,
            stop: { summary: "Waiting", workspacePaths: [] },
          },
        },
        value: undefined,
      }));
      for (const prompt of ["当前进度", "当前目标是什么", "有效约束有哪些"]) {
        const before = readSessionTaskBoard(sessionFile);
        const result = handleInteraction(
          {
            prompt,
            sessionFile,
            isActive,
            isHeartbeat: false,
            isStreaming: isActive,
            shouldSteer: false,
            shouldFollowup: isActive,
            queueMode: "collect",
          },
          bindInteractionPorts({ prompt, sessionId: "test-session", queueKeys: [] }),
        );
        expect(result.kind).toBe("reply");
        expect(readSessionTaskBoard(sessionFile)).toEqual(before);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

it.each([false, true])("handles owner stop independently of executor occupancy: %s", (isActive) => {
  const events: string[] = [];
  const ports = bindInteractionPorts({ prompt: "暂停", sessionId: "test-session", queueKeys: [] });
  ports.control = () => ({
    applyControl: () => {
      events.push("persist");
      return { abortInFlight: true, statusLine: "已暂停" } as ReturnType<
        ReturnType<typeof ports.control>["applyControl"]
      >;
    },
    abortMain: () => {
      events.push("main");
    },
    abortAsides: () => {
      events.push("responses");
    },
    clearPending: () => {
      events.push("queue");
    },
  });
  const result = handleInteraction(
    {
      prompt: "暂停",
      sessionFile: "test.jsonl",
      isActive,
      isHeartbeat: false,
      isStreaming: isActive,
      shouldSteer: false,
      shouldFollowup: isActive,
      queueMode: "collect",
    },
    ports,
  );
  expect(result).toEqual({ kind: "reply", text: "已暂停" });
  expect(events).toEqual(["persist", "main", "responses", "queue"]);
});

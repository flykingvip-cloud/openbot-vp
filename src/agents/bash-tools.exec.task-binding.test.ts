import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { captureTaskActionBoundary } from "../agent-runtime/state/task-action.js";
import {
  captureTaskCompletionBinding,
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  startBoundTaskExecution,
} from "../conversation-task/session-task-board.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { getFinishedSession, resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
vi.mock("../infra/system-events.js", () => ({ enqueueSystemEvent: vi.fn() }));
vi.mock("../infra/heartbeat-wake.js", () => ({ requestHeartbeatNow: vi.fn() }));
const dirs: string[] = [];
afterEach(() => {
  resetProcessRegistryForTests();
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it.each(["current", "paused", "replaced", "constraints", "cancelled"])(
  "real background child wakes only its current accepted task: %s",
  async (change) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-task-binding-"));
    dirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, "");
    mutateSessionTaskBoard(file, () => ({
      board: {
        ...emptySessionTaskBoard(),
        current: {
          taskId: "a",
          title: "A",
          goalText: "A",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "running", workspacePaths: [] },
        },
      },
      value: undefined,
    }));
    const binding = startBoundTaskExecution(file, captureTaskCompletionBinding(file), "run-a")!;
    const taskBoundary = captureTaskActionBoundary(file, binding);
    const tool = createExecTool({
      security: "full",
      ask: "off",
      allowBackground: true,
      backgroundMs: 0,
      sessionKey: "agent:test:main",
      notifyOnExit: true,
      taskBoundary,
    });
    const result = await tool.execute("child", {
      command: `node -e "setTimeout(() => console.log(123), 400)"`,
      background: true,
    });
    expect(result.details.status).toBe("running");
    if (change !== "current") {
      mutateSessionTaskBoard(file, (board) => ({
        board: {
          ...board,
          current: {
            ...board.current!,
            ...(change === "paused"
              ? { wakeSuppress: true }
              : change === "replaced"
                ? { taskId: "b" }
                : change === "cancelled"
                  ? { unfinished: false }
                  : { effectiveConstraints: ["changed"] }),
          },
        },
        value: undefined,
      }));
    }
    if (result.details.status !== "running") {
      throw new Error("Expected a real background child");
    }
    const sessionId = result.details.sessionId;
    await expect.poll(() => getFinishedSession(sessionId), { timeout: 5000 }).toBeDefined();
    expect(enqueueSystemEvent).toHaveBeenCalledTimes(change === "current" ? 1 : 0);
    expect(requestHeartbeatNow).toHaveBeenCalledTimes(change === "current" ? 1 : 0);
  },
);

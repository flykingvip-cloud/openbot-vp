import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { captureTaskActionBoundary } from "../agent-runtime/state/task-action.js";
import {
  captureTaskCompletionBinding,
  commitSameTaskConstraint,
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  startBoundTaskExecution,
} from "../conversation-task/session-task-board.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import type { AnyAgentTool } from "./tools/common.js";
vi.mock("../plugins/hook-runner-global.js");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-action-"));
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
  const execute = vi.fn(async () => ({ content: [], details: {} }));
  const tool = wrapToolWithBeforeToolCallHook(
    { name: "write", execute } as unknown as AnyAgentTool,
    { taskBoundary: captureTaskActionBoundary(file, binding) },
  );
  return { file, binding, execute, tool };
}
it.each(["constraint", "pause", "cancel", "replace"])(
  "refuses the next action after owner %s without executing it",
  async (change) => {
    vi.mocked(getGlobalHookRunner).mockReturnValue(null);
    const f = fixture();
    await f.tool.execute("first", {});
    if (change === "constraint") {
      commitSameTaskConstraint({
        sessionFile: f.file,
        expectedTaskId: "a",
        constraintText: "不要发布或发送",
      });
    } else {
      mutateSessionTaskBoard(f.file, (board) => ({
        board: {
          ...board,
          current:
            change === "cancel"
              ? undefined
              : {
                  ...board.current!,
                  ...(change === "pause" ? { wakeSuppress: true } : { taskId: "b" }),
                },
        },
        value: undefined,
      }));
    }
    await expect(f.tool.execute("second", {})).rejects.toThrow(/Task action refused/);
    expect(f.execute).toHaveBeenCalledOnce();
  },
);
it("rechecks restrictions accepted while an asynchronous plugin hook waits", async () => {
  const f = fixture();
  vi.mocked(getGlobalHookRunner).mockReturnValue({
    hasHooks: () => true,
    runBeforeToolCall: async () => {
      commitSameTaskConstraint({
        sessionFile: f.file,
        expectedTaskId: "a",
        constraintText: "禁止发布",
      });
      return {};
    },
  } as never);
  await expect(f.tool.execute("late", {})).rejects.toThrow(/constraints changed/);
  expect(f.execute).not.toHaveBeenCalled();
});

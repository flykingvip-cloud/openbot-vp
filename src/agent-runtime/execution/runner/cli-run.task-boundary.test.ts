import { beforeEach, expect, it, vi } from "vitest";
import { runCliAgent } from "./cli-run.js";
const mocks = vi.hoisted(() => ({ current: vi.fn(), spawn: vi.fn() }));
vi.mock("../../state/index.js", () => ({ sessionTaskState: { bindingCurrent: mocks.current } }));
vi.mock("../../../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => ({ spawn: mocks.spawn }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current.mockReturnValue(false);
});
it("rejects an obsolete CLI task before preparing or spawning a child", async () => {
  await expect(
    runCliAgent({
      sessionId: "s",
      sessionFile: "/tmp/cli-test.jsonl",
      workspaceDir: "/tmp",
      prompt: "task",
      provider: "codex-cli",
      timeoutMs: 1000,
      runId: "r",
      taskExecutionBinding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
    }),
  ).rejects.toThrow(/Original task/);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

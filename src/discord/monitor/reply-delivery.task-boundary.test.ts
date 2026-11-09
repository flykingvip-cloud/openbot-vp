import { beforeEach, expect, it, vi } from "vitest";
import type { TaskActionBoundary } from "../../agent-runtime/contracts/task-binding.js";
import { makeDiscordRest } from "../send.test-harness.js";
import { deliverDiscordReply } from "./reply-delivery.js";
const check = vi.hoisted(() => vi.fn());
vi.mock("../../agent-runtime/state/index.js", () => ({ checkTaskActionBoundary: check }));
const taskBoundary: TaskActionBoundary = {
  sessionFile: "/tmp/discord-monitor-test.jsonl",
  binding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
  constraints: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  check.mockReturnValue(undefined);
});
it("rejects remaining direct chunks after task invalidation", async () => {
  const { rest, postMock } = makeDiscordRest();
  postMock.mockImplementationOnce(async () => {
    check.mockReturnValue("Task action refused: paused");
    return { id: "m", channel_id: "789" };
  });
  await expect(
    deliverDiscordReply({
      cfg: { channels: { discord: { token: "test" } } },
      replies: [{ text: "first paragraph and second paragraph" }],
      target: "channel:789",
      token: "test",
      rest,
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      textLimit: 12,
      taskBoundary,
    }),
  ).rejects.toThrow("Task action refused");
  expect(postMock).toHaveBeenCalledTimes(1);
});

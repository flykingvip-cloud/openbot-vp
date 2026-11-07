import type { Bot } from "grammy";
import { beforeEach, expect, it, vi } from "vitest";
import type { TaskActionBoundary } from "../../agent-runtime/contracts/task.js";
import { deliverReplies } from "./delivery.js";
const mocks = vi.hoisted(() => ({ check: vi.fn(), media: vi.fn() }));
vi.mock("../../agent-runtime/state/index.js", () => ({ checkTaskActionBoundary: mocks.check }));
vi.mock("../../web/media.js", () => ({ loadWebMedia: mocks.media }));
const taskBoundary: TaskActionBoundary = {
  sessionFile: "/tmp/telegram-direct-test.jsonl",
  binding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
  constraints: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockReturnValue(undefined);
});
it("refuses direct media after invalidation during loading", async () => {
  mocks.media.mockImplementationOnce(async () => {
    mocks.check.mockReturnValue("Task action refused: paused");
    return { buffer: Buffer.from("img"), fileName: "image.png", contentType: "image/png" };
  });
  const sendPhoto = vi.fn();
  await expect(
    deliverReplies({
      replies: [{ text: "result", mediaUrl: "https://example.test/image.png" }],
      chatId: "123",
      token: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      bot: { api: { sendPhoto } } as unknown as Bot,
      replyToMode: "off",
      textLimit: 4000,
      taskBoundary,
    }),
  ).rejects.toThrow("Task action refused");
  expect(sendPhoto).not.toHaveBeenCalled();
});

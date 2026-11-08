import { beforeEach, expect, it, vi } from "vitest";
import type { TaskActionBoundary } from "../agent-runtime/contracts/task-binding.js";
import {
  getTelegramSendTestMocks,
  importTelegramSendModule,
  installTelegramSendTestHooks,
} from "./send.test-harness.js";
installTelegramSendTestHooks();
const check = vi.hoisted(() => vi.fn());
vi.mock("../agent-runtime/state/index.js", () => ({ checkTaskActionBoundary: check }));
const { botApi, loadWebMedia } = getTelegramSendTestMocks();
const { sendMessageTelegram, editMessageTelegram } = await importTelegramSendModule();
const taskBoundary: TaskActionBoundary = {
  sessionFile: "/tmp/telegram-test.jsonl",
  binding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
  constraints: [],
};
beforeEach(() => {
  check.mockReset().mockReturnValue(undefined);
});
it("refuses task media invalidated during loading before Telegram send", async () => {
  loadWebMedia.mockImplementationOnce(async () => {
    check.mockReturnValue("Task action refused: paused");
    return { buffer: Buffer.from("image"), contentType: "image/png", fileName: "image.png" };
  });
  botApi.sendPhoto.mockResolvedValue({ message_id: 1, chat: { id: 123 } });
  await expect(
    sendMessageTelegram("123", "result", {
      token: "test",
      mediaUrl: "https://example.test/image.png",
      taskBoundary,
    }),
  ).rejects.toThrow("Task action refused");
  expect(botApi.sendPhoto).not.toHaveBeenCalled();
});
it("refuses stale preview edit", async () => {
  check.mockReturnValue("Task action refused: paused");
  botApi.editMessageText.mockResolvedValue({ message_id: 1, chat: { id: 123 } });
  await expect(
    editMessageTelegram("123", 1, "result", { token: "test", taskBoundary }),
  ).rejects.toThrow("Task action refused");
  expect(botApi.editMessageText).not.toHaveBeenCalled();
});

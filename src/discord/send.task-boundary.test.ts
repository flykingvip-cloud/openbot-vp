import { ChannelType } from "discord-api-types/v10";
import { beforeEach, expect, it, vi } from "vitest";
import type { TaskActionBoundary } from "../agent-runtime/contracts/task.js";
import { loadWebMedia } from "../web/media.js";
import { sendMessageDiscord, sendWebhookMessageDiscord } from "./send.js";
import { makeDiscordRest } from "./send.test-harness.js";
const check = vi.hoisted(() => vi.fn());
vi.mock("../agent-runtime/state/index.js", () => ({ checkTaskActionBoundary: check }));
vi.mock("../web/media.js", async () => {
  const { discordWebMediaMockFactory } = await import("./send.test-harness.js");
  return discordWebMediaMockFactory();
});
const taskBoundary: TaskActionBoundary = {
  sessionFile: "/tmp/discord-test.jsonl",
  binding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
  constraints: [],
};
it("refuses stale webhook delivery before HTTP", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  try {
    check.mockReturnValue("Task action refused: paused");
    await expect(
      sendWebhookMessageDiscord("result", {
        webhookId: "test",
        webhookToken: "test",
        taskBoundary,
      }),
    ).rejects.toThrow("Task action refused");
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
beforeEach(() => {
  vi.clearAllMocks();
  check.mockReturnValue(undefined);
});
it("refuses a task invalidated while loading media before posting", async () => {
  const { rest, postMock, getMock } = makeDiscordRest();
  getMock.mockResolvedValue({ type: ChannelType.GuildText });
  postMock.mockResolvedValue({ id: "m", channel_id: "789" });
  vi.mocked(loadWebMedia).mockImplementationOnce(async () => {
    check.mockReturnValue("Task action refused: paused");
    return {
      buffer: Buffer.from("img"),
      fileName: "image.png",
      contentType: "image/png",
      kind: "image",
    };
  });
  await expect(
    sendMessageDiscord("channel:789", "result", {
      cfg: {},
      rest,
      token: "t",
      mediaUrl: "https://example.test/image.png",
      taskBoundary,
    }),
  ).rejects.toThrow("Task action refused");
  expect(postMock).not.toHaveBeenCalled();
});
it("preserves independent unbound control delivery", async () => {
  const { rest, postMock, getMock } = makeDiscordRest();
  getMock.mockResolvedValue({ type: ChannelType.GuildText });
  postMock.mockResolvedValue({ id: "m", channel_id: "789" });
  check.mockReturnValue("Task action refused: paused");
  await expect(
    sendMessageDiscord("channel:789", "paused", { cfg: {}, rest, token: "t" }),
  ).resolves.toMatchObject({ messageId: "m" });
  expect(check).not.toHaveBeenCalled();
});

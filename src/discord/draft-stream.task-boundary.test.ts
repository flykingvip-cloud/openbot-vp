import { beforeEach, expect, it, vi } from "vitest";
import type { TaskActionBoundary } from "../agent-runtime/contracts/task.js";
import { createDiscordDraftStream } from "./draft-stream.js";
import { makeDiscordRest } from "./send.test-harness.js";
const check = vi.hoisted(() => vi.fn());
vi.mock("../agent-runtime/state/index.js", () => ({ checkTaskActionBoundary: check }));
const boundary: TaskActionBoundary = {
  sessionFile: "/tmp/discord-draft-test.jsonl",
  binding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
  constraints: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  check.mockReturnValue(undefined);
});
it("does not flush a pending preview after cancellation", async () => {
  const { rest, postMock, patchMock } = makeDiscordRest();
  const abort = new AbortController();
  const stream = createDiscordDraftStream({
    rest,
    channelId: "c",
    minInitialChars: 100,
    abortSignal: abort.signal,
  });
  stream.bindTaskBoundary(boundary);
  stream.update("pending");
  await stream.flush();
  abort.abort();
  await stream.stop();
  expect(postMock).not.toHaveBeenCalled();
  expect(patchMock).not.toHaveBeenCalled();
});
it("does not flush an invalidated task even on final stop", async () => {
  const { rest, postMock } = makeDiscordRest();
  const stream = createDiscordDraftStream({ rest, channelId: "c", minInitialChars: 100 });
  stream.bindTaskBoundary(boundary);
  stream.update("pending");
  await stream.flush();
  check.mockReturnValue("Task action refused: paused");
  await stream.stop();
  expect(postMock).not.toHaveBeenCalled();
});
it("does not retarget pending text to a replacement attempt", async () => {
  const { rest, postMock } = makeDiscordRest();
  const stream = createDiscordDraftStream({ rest, channelId: "c", minInitialChars: 100 });
  stream.bindTaskBoundary(boundary);
  stream.update("old pending");
  await stream.flush();
  stream.bindTaskBoundary({
    ...boundary,
    binding: { ...boundary.binding, executionAttempt: "replacement" },
  });
  await stream.stop();
  expect(postMock).not.toHaveBeenCalled();
});

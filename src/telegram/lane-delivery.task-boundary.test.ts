import { beforeEach, expect, it, vi } from "vitest";
import type { TaskActionBoundary } from "../agent-runtime/contracts/task-binding.js";
import { createTestDraftStream } from "./draft-stream.test-helpers.js";
import { createLaneTextDeliverer } from "./lane-delivery.js";
const check = vi.hoisted(() => vi.fn());
vi.mock("../agent-runtime/state/index.js", () => ({ checkTaskActionBoundary: check }));
const taskBoundary: TaskActionBoundary = {
  sessionFile: "/tmp/telegram-lane-test.jsonl",
  binding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
  constraints: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  check.mockReturnValue(undefined);
});
it("does not turn a task refusal during preview edit into a delivered receipt", async () => {
  const answer = {
    stream: createTestDraftStream({ messageId: 1 }),
    lastPartialText: "",
    hasStreamedMessage: true,
  };
  const markDelivered = vi.fn();
  const editPreview = vi.fn(async () => {
    check.mockReturnValue("Task action refused: paused");
    throw new Error("Task action refused: paused");
  });
  const deliver = createLaneTextDeliverer({
    lanes: {
      answer,
      reasoning: { stream: undefined, lastPartialText: "", hasStreamedMessage: false },
    },
    archivedAnswerPreviews: [],
    activePreviewLifecycleByLane: { answer: "transient", reasoning: "transient" },
    retainPreviewOnCleanupByLane: { answer: false, reasoning: false },
    draftMaxChars: 4096,
    applyTextToPayload: (payload, text) => ({ ...payload, text }),
    sendPayload: vi.fn(async () => true),
    flushDraftLane: async () => {},
    stopDraftLane: async () => {},
    editPreview,
    deletePreviewMessage: async () => {},
    log: vi.fn(),
    markDelivered,
  });
  await expect(
    deliver({
      laneName: "answer",
      text: "result",
      payload: { text: "result" },
      infoKind: "final",
      taskBoundary,
    }),
  ).rejects.toThrow("Task action refused");
  expect(editPreview).toHaveBeenCalledOnce();
  expect(markDelivered).not.toHaveBeenCalled();
});

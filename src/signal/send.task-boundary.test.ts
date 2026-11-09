import { beforeEach, expect, it, vi } from "vitest";
import type { TaskActionBoundary } from "../agent-runtime/contracts/task-binding.js";
import { sendMessageSignal } from "./send.js";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), attachment: vi.fn(), check: vi.fn() }));
vi.mock("../agent-runtime/state/index.js", () => ({ checkTaskActionBoundary: mocks.check }));
vi.mock("./accounts.js", () => ({
  resolveSignalAccount: () => ({
    accountId: "default",
    config: { account: "+15550001111" },
    baseUrl: "http://signal.local",
  }),
}));
vi.mock("./client.js", () => ({ signalRpcRequest: mocks.rpc }));
vi.mock("../media/outbound-attachment.js", () => ({
  resolveOutboundAttachmentFromUrl: mocks.attachment,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockReturnValue(undefined);
  mocks.rpc.mockResolvedValue({ timestamp: 123 });
});
const boundary: TaskActionBoundary = {
  sessionFile: "/tmp/signal-test.jsonl",
  binding: { taskId: "a", executionAttempt: "r", deliverableVersion: "v" },
  constraints: [],
};

it("refuses task output invalidated while resolving media before RPC", async () => {
  mocks.attachment.mockImplementation(async () => {
    mocks.check.mockReturnValue("Task action refused: paused");
    return { path: "/tmp/fake.png", contentType: "image/png" };
  });
  await expect(
    sendMessageSignal("+15550002222", "result", {
      cfg: {},
      mediaUrl: "https://example.test/fake.png",
      taskBoundary: boundary,
    }),
  ).rejects.toThrow("Task action refused");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("allows an independent control notice without a task boundary", async () => {
  mocks.check.mockReturnValue("Task action refused: paused");
  await expect(sendMessageSignal("+15550002222", "paused", { cfg: {} })).resolves.toMatchObject({
    messageId: "123",
  });
  expect(mocks.check).not.toHaveBeenCalled();
});

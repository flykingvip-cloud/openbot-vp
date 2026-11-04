import { beforeEach, expect, it, vi } from "vitest";
import { prepareVisibleDelivery } from "./prepare-visible.js";
const mocks = vi.hoisted(() => ({ register: vi.fn(), root: vi.fn(() => "/tmp/agent-a") }));
vi.mock("../../../task-outcome/pending-delivery.js", () => ({
  registerAwaitingDelivery: mocks.register,
}));
const contract = {
  id: "code-v1",
  version: "1",
  kind: "code",
  requiredValidators: ["test"],
} as const;
beforeEach(() => vi.clearAllMocks());
it("awaits preparation before registration and publishes the same stable receipt", async () => {
  let release!: () => void;
  const commit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const publish = vi.fn();
  const pending = prepareVisibleDelivery({
    resolvePersistRoot: mocks.root,
    agentId: " agent-a ",
    runId: "run-a",
    sessionKey: "session-a",
    contract,
    commitOutcome: commit,
    publishPending: publish,
  });
  expect(commit).toHaveBeenCalledWith(
    true,
    expect.objectContaining({
      acceptance: { status: "pending" },
      delivery: { status: "pending" },
      deliveryId: "delivery:run-a:visible",
    }),
  );
  expect(mocks.register).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  release();
  await pending;
  expect(mocks.register).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "agent-a",
      runId: "run-a",
      deliveryId: "delivery:run-a:visible",
    }),
  );
  expect(mocks.register.mock.calls[0][0]).toEqual(
    expect.objectContaining(publish.mock.calls[0][0]),
  );
  expect(mocks.register.mock.invocationCallOrder[0]).toBeLessThan(
    publish.mock.invocationCallOrder[0],
  );
});
it("does not expose a receipt if outcome persistence rejects", async () => {
  const publish = vi.fn();
  await expect(
    prepareVisibleDelivery({
      resolvePersistRoot: mocks.root,
      agentId: "agent-a",
      runId: "run-a",
      contract,
      commitOutcome: () => Promise.reject(new Error("persist")),
      publishPending: publish,
    }),
  ).rejects.toThrow("persist");
  expect(mocks.register).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
it("retains verified acceptance but never invents delivery or a missing agent", async () => {
  const commit = vi.fn();
  const publish = vi.fn();
  await prepareVisibleDelivery({
    resolvePersistRoot: mocks.root,
    agentId: " ",
    runId: "run-a",
    contract: { ...contract, acceptanceVerified: true },
    commitOutcome: commit,
    publishPending: publish,
  });
  expect(commit).toHaveBeenCalledWith(
    true,
    expect.objectContaining({ acceptance: { status: "passed" }, delivery: { status: "pending" } }),
  );
  expect(mocks.root).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
it("does not publish when pending registration fails", async () => {
  mocks.register.mockImplementationOnce(() => {
    throw new Error("register");
  });
  const publish = vi.fn();
  await expect(
    prepareVisibleDelivery({
      resolvePersistRoot: mocks.root,
      agentId: "agent-a",
      runId: "run-a",
      contract,
      commitOutcome: vi.fn(),
      publishPending: publish,
    }),
  ).rejects.toThrow("register");
  expect(publish).not.toHaveBeenCalled();
});
it.each([true, false])(
  "registers task completion identity only for verified acceptance: %s",
  async (verified) => {
    const binding = { taskId: "board-a", executionAttempt: "run-a", deliverableVersion: "v1" };
    await prepareVisibleDelivery({
      resolvePersistRoot: mocks.root,
      agentId: "agent-a",
      runId: "run-a",
      sessionFile: "/tmp/test-session.jsonl",
      completionBinding: binding,
      contract: { ...contract, acceptanceVerified: verified },
      commitOutcome: vi.fn(),
      publishPending: vi.fn(),
    });
    const registration = mocks.register.mock.calls[0][0];
    expect(registration.checkedTask).toEqual(
      verified ? { sessionFile: "/tmp/test-session.jsonl", binding } : undefined,
    );
  },
);
it("does not register an identity from another execution run", async () => {
  await prepareVisibleDelivery({
    resolvePersistRoot: mocks.root,
    agentId: "agent-a",
    runId: "run-a",
    sessionFile: "/tmp/test-session.jsonl",
    completionBinding: {
      taskId: "board-a",
      executionAttempt: "other-run",
      deliverableVersion: "v1",
    },
    contract: { ...contract, acceptanceVerified: true },
    commitOutcome: vi.fn(),
    publishPending: vi.fn(),
  });
  expect(mocks.register.mock.calls[0][0].checkedTask).toBeUndefined();
});

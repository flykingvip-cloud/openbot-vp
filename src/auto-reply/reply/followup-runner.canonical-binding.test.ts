import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { drainNextQueueItem } from "../../utils/queue-helpers.js";
import type { FollowupRun } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const resolveExecutionWorkspace = vi.fn();
const confirmPendingTurnDelivery = vi.fn();
const peekAwaitingDelivery = vi.fn();
const deliverQueuedReply = vi.fn();

vi.mock("../../gateway/workspace-resolver/execution-workspace.js", () => ({
  resolveExecutionWorkspace: (...args: unknown[]) => resolveExecutionWorkspace(...args),
}));

vi.mock("../../agent-runtime/wiring/delivery-confirm.js", () => ({
  confirmPendingTurnDelivery: (...args: unknown[]) => confirmPendingTurnDelivery(...args),
}));

vi.mock("../../task-outcome/pending-delivery.js", () => ({
  peekAwaitingDelivery: (...args: unknown[]) => peekAwaitingDelivery(...args),
}));

vi.mock("../../agent-runtime/delivery/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent-runtime/delivery/index.js")>();
  return {
    ...actual,
    deliverQueuedReply: (...args: unknown[]) => deliverQueuedReply(...args),
  };
});

const { createFollowupRunner } = await import("./followup-runner.js");

const ROOT = path.resolve("/tmp/canonical-followup-root");
const BINDING = {
  resourceId: "ws:tenant:seat:seat:asset:asset",
  bindingId: "binding",
  contentVersion: "2",
  rootPath: ROOT,
};

function queuedRun(
  workspaceDir: string,
  overrides: Partial<Omit<FollowupRun, "run">> & { run?: Partial<FollowupRun["run"]> } = {},
): FollowupRun {
  const base = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    originatingTo: "channel:C1",
    run: {
      sessionId: "session",
      sessionKey: "main",
      agentId: "robot",
      messageProvider: "whatsapp",
      agentAccountId: "primary",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir,
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as FollowupRun;
  return {
    ...base,
    ...overrides,
    run: {
      ...base.run,
      ...overrides.run,
    },
  };
}

function createRunner() {
  const typing = createMockTypingController();
  return {
    typing,
    runner: createFollowupRunner({
      typing,
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    }),
  };
}

beforeEach(() => {
  resolveExecutionWorkspace.mockReset();
  confirmPendingTurnDelivery.mockReset();
  confirmPendingTurnDelivery.mockResolvedValue(undefined);
  peekAwaitingDelivery.mockReset();
  deliverQueuedReply.mockReset();
  deliverQueuedReply.mockResolvedValue("delivered");
});

it("blocks a followup when the queued workspace no longer matches the canonical binding", async () => {
  resolveExecutionWorkspace.mockResolvedValue(BINDING);
  const { runner } = createRunner();
  await expect(runner(queuedRun("/tmp/old-queued-workspace"))).rejects.toThrow(
    /workspace_binding_changed/,
  );
  expect(resolveExecutionWorkspace).toHaveBeenCalled();
});

it("blocks when the path is unchanged but bindingId or contentVersion changed", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    bindingId: "binding-rotated",
    contentVersion: "9",
  });
  const { runner } = createRunner();
  const queued = queuedRun(ROOT, {
    run: {
      executionWorkspaceBinding: {
        resourceId: BINDING.resourceId,
        bindingId: BINDING.bindingId,
        contentVersion: BINDING.contentVersion,
      },
    },
  });
  await expect(runner(queued)).rejects.toThrow(/workspace_binding_changed/);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
});

it("blocks when the path is unchanged but only contentVersion changed", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    contentVersion: "3",
  });
  const { runner } = createRunner();
  await expect(
    runner(
      queuedRun(ROOT, {
        run: {
          executionWorkspaceBinding: {
            resourceId: BINDING.resourceId,
            bindingId: BINDING.bindingId,
            contentVersion: BINDING.contentVersion,
          },
        },
      }),
    ),
  ).rejects.toThrow(/workspace_binding_changed/);
});

it("delivery-only revalidates with read permission and still delivers on a read_only workspace", async () => {
  resolveExecutionWorkspace.mockImplementation(async (params: { operation: "read" | "write" }) => {
    if (params.operation === "write") {
      throw new Error("workspace_binding_required:binding_read_only");
    }
    return BINDING;
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const { runner, typing } = createRunner();
  const queued = queuedRun(ROOT, {
    asyncWaitDeliveryOnly: true,
    asyncWaitDeliveryPayloads: [{ text: "original visible reply" }],
    asyncWaitRecoveryBind: {
      jobId: "job-1",
      claimToken: "token-1",
      boundRunId: "run-1",
      boundDeliveryId: "delivery:run-1:visible",
    },
    run: {
      executionWorkspaceBinding: {
        resourceId: BINDING.resourceId,
        bindingId: BINDING.bindingId,
        contentVersion: BINDING.contentVersion,
      },
    },
  });
  await expect(runner(queued)).resolves.toBeUndefined();
  expect(resolveExecutionWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "read" }),
  );
  expect(deliverQueuedReply).toHaveBeenCalledTimes(1);
  expect(confirmPendingTurnDelivery).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "run-1",
      deliveryId: "delivery:run-1:visible",
      status: "delivered",
    }),
  );
  expect(typing.markRunComplete).toHaveBeenCalled();
  expect(typing.markDispatchIdle).toHaveBeenCalled();
});

it("delivery-only records a failed receipt and lets drain drop the item when identity changes at the same path", async () => {
  resolveExecutionWorkspace.mockResolvedValue({
    ...BINDING,
    bindingId: "binding-rotated",
    contentVersion: "9",
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const { runner, typing } = createRunner();
  const queued = queuedRun(ROOT, {
    asyncWaitDeliveryOnly: true,
    asyncWaitDeliveryPayloads: [{ text: "original visible reply" }],
    asyncWaitRecoveryBind: {
      jobId: "job-1",
      claimToken: "token-1",
      boundRunId: "run-1",
      boundDeliveryId: "delivery:run-1:visible",
    },
    run: {
      executionWorkspaceBinding: {
        resourceId: BINDING.resourceId,
        bindingId: BINDING.bindingId,
        contentVersion: BINDING.contentVersion,
      },
    },
  });
  const items = [queued];
  await expect(drainNextQueueItem(items, runner)).resolves.toBe(true);
  expect(items).toHaveLength(0);
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).toHaveBeenCalledTimes(1);
  expect(confirmPendingTurnDelivery).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "run-1",
      deliveryId: "delivery:run-1:visible",
      taskId: "task-1",
      status: "failed",
      error: expect.stringMatching(/workspace_binding_changed/),
    }),
  );
  expect(typing.markRunComplete).toHaveBeenCalled();
  expect(typing.markDispatchIdle).toHaveBeenCalled();
});

it("delivery-only does not demand write permission when recording a workspace failure", async () => {
  resolveExecutionWorkspace.mockImplementation(async (params: { operation: "read" | "write" }) => {
    if (params.operation === "write") {
      throw new Error("workspace_binding_required:binding_read_only");
    }
    return {
      ...BINDING,
      contentVersion: "changed",
    };
  });
  peekAwaitingDelivery.mockReturnValue({
    runId: "run-1",
    deliveryId: "delivery:run-1:visible",
    taskId: "task-1",
  });
  const { runner } = createRunner();
  const queued = queuedRun(ROOT, {
    asyncWaitDeliveryOnly: true,
    asyncWaitDeliveryPayloads: [{ text: "original visible reply" }],
    asyncWaitRecoveryBind: {
      jobId: "job-1",
      claimToken: "token-1",
      boundRunId: "run-1",
      boundDeliveryId: "delivery:run-1:visible",
    },
    run: {
      executionWorkspaceBinding: {
        resourceId: BINDING.resourceId,
        bindingId: BINDING.bindingId,
        contentVersion: BINDING.contentVersion,
      },
    },
  });
  await expect(runner(queued)).resolves.toBeUndefined();
  expect(resolveExecutionWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "read" }),
  );
  expect(deliverQueuedReply).not.toHaveBeenCalled();
  expect(confirmPendingTurnDelivery).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "failed",
      error: expect.stringMatching(/workspace_binding_changed/),
    }),
  );
});

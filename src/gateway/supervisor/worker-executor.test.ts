import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../../fabric/worker/types.js";
import { WorkerAuthError } from "./engine.js";
import type { NodeInvokePort } from "./node-invoke-port.js";
import { DEFAULT_SUPERVISOR_BUDGET, type SupervisedTask } from "./types.js";
import {
  createRoutingWorkerPort,
  GatewayWorkerExecutor,
  NodeAgentWorkerExecutor,
  WorkerPlacementError,
} from "./worker-executor.js";

function task(): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId: "task-1",
    goal: "goal",
    repoRoot: "/repo",
    worker: { backendId: "cursor-cli" },
    workspace: { id: "ws", root: "/ws", kind: "directory" },
    acceptance: { source: "user", steps: [] },
    state: "executing",
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

function nodeContext(): ExecutionContext {
  return {
    identity: { policy: "local_ide_login", status: "configured" },
    placement: {
      placement: "node_agent",
      executor: "node_agent",
      nodeAgentId: "mac-node",
      fallback: "escalate",
    },
    attribution: { workerId: "cursor-cli" },
  };
}

function fakeNodeInvoke(overrides?: Partial<NodeInvokePort>): NodeInvokePort {
  return {
    invoke: vi.fn(async () => ({
      ok: true,
      payloadJSON: JSON.stringify({ summary: "done on node", exitCode: 0 }),
    })),
    getDeclaredCommands: () => ["supervisor.worker.dispatch", "supervisor.worker.cancel"],
    isConnected: () => true,
    ...overrides,
  };
}

describe("createRoutingWorkerPort", () => {
  it("routes gateway placement to GatewayWorkerExecutor", async () => {
    const gatewayDispatch = vi.fn(async () => ({ summary: "ok", exitCode: 0 }));
    const port = createRoutingWorkerPort([
      { kind: "gateway", dispatch: gatewayDispatch },
      { kind: "node_agent", dispatch: vi.fn() },
    ]);
    await port.dispatch({
      task: task(),
      workerId: "codex-cli",
      context: {
        identity: { policy: "enterprise_shared", status: "validated" },
        placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
        attribution: { workerId: "codex-cli" },
      },
      prompt: "do work",
    });
    expect(gatewayDispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches to node agent when command is declared", async () => {
    const invoke = vi.fn(async () => ({
      ok: true,
      payloadJSON: JSON.stringify({ summary: "done on node", exitCode: 0 }),
    }));
    const invokePort = fakeNodeInvoke({ invoke });
    const port = createRoutingWorkerPort([
      new GatewayWorkerExecutor(undefined as never),
      new NodeAgentWorkerExecutor(invokePort),
    ]);
    const result = await port.dispatch({
      task: task(),
      workerId: "cursor-cli",
      context: nodeContext(),
      prompt: "do work",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("done on node");
  });

  it("throws WorkerPlacementError when node is offline", async () => {
    const invokePort = fakeNodeInvoke({ isConnected: () => false });
    const executor = new NodeAgentWorkerExecutor(invokePort);
    await expect(
      executor.dispatch({
        task: task(),
        workerId: "cursor-cli",
        context: nodeContext(),
        prompt: "do work",
      }),
    ).rejects.toBeInstanceOf(WorkerPlacementError);
  });

  it("throws WorkerPlacementError when dispatch command is not declared", async () => {
    const invokePort = fakeNodeInvoke({ getDeclaredCommands: () => [] });
    const executor = new NodeAgentWorkerExecutor(invokePort);
    await expect(
      executor.dispatch({
        task: task(),
        workerId: "cursor-cli",
        context: nodeContext(),
        prompt: "do work",
      }),
    ).rejects.toBeInstanceOf(WorkerPlacementError);
  });

  it("maps node auth failures to WorkerAuthError", async () => {
    const invokePort = fakeNodeInvoke({
      invoke: vi.fn(async () => ({
        ok: false,
        error: { code: "AUTH", message: "not logged in to cursor-agent" },
      })),
    });
    const executor = new NodeAgentWorkerExecutor(invokePort);
    await expect(
      executor.dispatch({
        task: task(),
        workerId: "cursor-cli",
        context: nodeContext(),
        prompt: "do work",
      }),
    ).rejects.toBeInstanceOf(WorkerAuthError);
  });
});

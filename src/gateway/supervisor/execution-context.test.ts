import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { CredentialResolver, PlacementResolver } from "../../fabric/worker/types.js";
import {
  createGatewayExecutionContextPort,
  GatewayPlacementResolver,
} from "./execution-context.js";
import { DEFAULT_SUPERVISOR_BUDGET, type SupervisedTask } from "./types.js";

function task(overrides: Partial<SupervisedTask> = {}): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId: "task-1",
    goal: "ship feature",
    repoRoot: "/repo",
    tenantId: "tenant-1",
    userId: "user-1",
    agentId: "agent-1",
    worker: { backendId: "codex-cli", model: "gpt-5" },
    workspace: { id: "ws-1", root: "/ws", kind: "directory" },
    acceptance: { source: "user", steps: [] },
    state: "planned",
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("supervisor execution context", () => {
  it("builds gateway ExecutionContext from credential and placement resolvers", async () => {
    const credentialResolver: CredentialResolver = {
      resolve: async (input) => ({
        policy: input.policy,
        status: "validated",
        credentialId: "corp-openai",
        credentialEnv: { OPENAI_API_KEY: "resolved" },
      }),
    };
    const port = createGatewayExecutionContextPort({
      cfg: {} as OpenBotConfig,
      credentialResolver,
      placementResolver: new GatewayPlacementResolver(),
    });
    const context = await port.resolve(task());
    expect(context).toMatchObject({
      identity: {
        policy: "enterprise_shared",
        status: "validated",
        credentialId: "corp-openai",
        credentialEnv: { OPENAI_API_KEY: "resolved" },
      },
      placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
      attribution: {
        tenantId: "tenant-1",
        userId: "user-1",
        credentialId: "corp-openai",
        workerId: "codex-cli",
        model: "gpt-5",
      },
    });
  });

  it("returns placement fallback instead of dispatch context when node agent is unavailable", async () => {
    const placementResolver: PlacementResolver = {
      resolve: async () => ({ fallback: "escalate", reason: "Node Agent offline" }),
    };
    const port = createGatewayExecutionContextPort({
      cfg: {} as OpenBotConfig,
      placementResolver,
    });
    await expect(port.resolve(task())).resolves.toEqual({
      fallback: "escalate",
      reason: "Node Agent offline",
    });
  });
});

it("attributes seatId from task.seatId and does not fall back to userId", async () => {
  const credentialResolver: CredentialResolver = {
    resolve: async (input) => ({
      policy: input.policy,
      status: "validated",
      credentialId: "corp-openai",
    }),
  };
  const placementResolver: PlacementResolver = {
    resolve: async (input) => {
      expect(input.seatId).toBe("1b25d120-013f-4ad5-b64a-bb0f9e1cd490");
      return { placement: "gateway", executor: "gateway", fallback: "escalate" };
    },
  };
  const port = createGatewayExecutionContextPort({
    cfg: {} as OpenBotConfig,
    credentialResolver,
    placementResolver,
  });
  const context = await port.resolve(
    task({
      seatId: "1b25d120-013f-4ad5-b64a-bb0f9e1cd490",
      userId: "user-should-not-be-seat",
    }),
  );
  expect(context).toMatchObject({
    attribution: {
      seatId: "1b25d120-013f-4ad5-b64a-bb0f9e1cd490",
      userId: "user-should-not-be-seat",
    },
  });
});

it("escalates node_agent placement when supportsSupervisorWorker is false", async () => {
  const resolver = new GatewayPlacementResolver({
    resolveNodeAgent: async () => ({
      nodeAgentId: "mac-1",
      online: true,
      supportsSupervisorWorker: false,
    }),
  });
  await expect(
    resolver.resolve({
      workerId: "cursor-cli",
      requested: "node_agent",
      tenantId: "t1",
      seatId: "seat-1",
    }),
  ).resolves.toMatchObject({
    fallback: "escalate",
    reason: expect.stringContaining("does not support supervisor"),
  });
});

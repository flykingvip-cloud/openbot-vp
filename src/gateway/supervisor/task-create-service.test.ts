import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupervisorPorts } from "./engine.js";
import { createSupervisedTask, SupervisorTaskCreateError } from "./task-create-service.js";

vi.mock("./feature.js", () => ({
  isSupervisorEnabled: () => true,
}));

vi.mock("./store.js", () => ({
  createTask: vi.fn(async (task) => task),
}));

vi.mock("./driver.js", () => ({
  tickSupervisedTask: vi.fn(() => Promise.resolve()),
}));

vi.mock("./commercial-run-gate.js", () => ({
  assertSupervisorTenantCommercialCapacity: vi.fn(async () => undefined),
}));

vi.mock("./execution-chain-gate.js", () => ({
  assertExecutionChainReady: vi.fn(async () => undefined),
  ExecutionChainGateError: class ExecutionChainGateError extends Error {
    code = "INVALID_REQUEST" as const;
    checkId: string;
    constructor(checkId: string, message: string) {
      super(message);
      this.name = "ExecutionChainGateError";
      this.checkId = checkId;
    }
  },
}));

vi.mock("./budget.js", () => ({
  buildTaskBudget: () => ({
    maxIterations: 3,
    maxCostUsd: 1,
    spentCostUsd: 0,
    maxDurationMs: 60_000,
    spentDurationMs: 0,
  }),
}));

vi.mock("./validator.js", () => ({
  ValidationAdapterRegistry: class {
    async planForRepo() {
      return {
        steps: [{ id: "test", command: "pnpm test", required: true }],
      };
    }
  },
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

describe("createSupervisedTask", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("creates a supervised task when repo and ports are valid", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-sup-create-"));
    await fs.mkdir(path.join(tempDir, ".git"));
    const ensure = vi.fn(async () => ({
      id: "ws-1",
      root: path.join(tempDir, "ws"),
      kind: "directory" as const,
    }));
    const ports = {
      workspace: { ensure },
    } as unknown as SupervisorPorts;

    const created = await createSupervisedTask(
      {
        goal: "Refactor supervisor UI",
        repoRoot: tempDir,
        workerBackendId: "codex-cli",
      },
      { ports },
    );

    expect(created.taskId).toMatch(/^sup_/);
    expect(created.goal).toBe("Refactor supervisor UI");
    expect(created.worker.backendId).toBe("codex-cli");
    expect(ensure).toHaveBeenCalled();
  });

  it("rejects non-git repo roots", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-sup-create-"));
    const ports = { workspace: { ensure: vi.fn() } } as unknown as SupervisorPorts;
    await expect(
      createSupervisedTask(
        { goal: "x", repoRoot: tempDir, workerBackendId: "codex-cli" },
        { ports },
      ),
    ).rejects.toBeInstanceOf(SupervisorTaskCreateError);
  });
});

describe("createSupervisedTask execution chain gate", () => {
  let gateTempDir = "";

  afterEach(async () => {
    if (gateTempDir) {
      await fs.rm(gateTempDir, { recursive: true, force: true });
      gateTempDir = "";
    }
    const { assertExecutionChainReady } = await import("./execution-chain-gate.js");
    vi.mocked(assertExecutionChainReady).mockReset();
    vi.mocked(assertExecutionChainReady).mockResolvedValue(undefined);
  });

  it("rejects when execution chain gate fails for node offline", async () => {
    const { assertExecutionChainReady, ExecutionChainGateError } =
      await import("./execution-chain-gate.js");
    vi.mocked(assertExecutionChainReady).mockRejectedValueOnce(
      new ExecutionChainGateError(
        "node-online",
        'execution chain not ready [node-online]: Node Agent "mac-1" is offline',
      ),
    );
    gateTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-sup-create-gate-"));
    await fs.mkdir(path.join(gateTempDir, ".git"));
    const ports = {
      workspace: { ensure: vi.fn() },
    } as unknown as SupervisorPorts;
    await expect(
      createSupervisedTask(
        { goal: "x", repoRoot: gateTempDir, workerBackendId: "cursor-cli", tenantId: "t1" },
        { ports },
      ),
    ).rejects.toMatchObject({
      name: "SupervisorTaskCreateError",
      message: expect.stringContaining("[node-online]"),
    });
  });
});

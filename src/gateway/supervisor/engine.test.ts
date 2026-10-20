import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../../fabric/worker/types.js";
import { abortSupervisedTask, tickSupervisedTask } from "./driver.js";
import {
  canTransitionTask,
  judge,
  superviseTick,
  WorkerAuthError,
  type SupervisorPorts,
  type WorkerPort,
} from "./engine.js";
import { SUPERVISOR_ENABLED_ENV, isSupervisorEnabled } from "./feature.js";
import { createTask, getTask, updateTask } from "./store.js";
import {
  DEFAULT_SUPERVISOR_BUDGET,
  type AcceptanceCriteria,
  type SupervisedTask,
  type ValidationReport,
} from "./types.js";
import { NodeValidationAdapter, ValidationAdapterRegistry } from "./validator.js";
import { createDirectoryWorkspaceProvider, createWorkspacePort } from "./workspace.js";

describe("feature — isSupervisorEnabled (default off)", () => {
  it("is off unless env or config enables it", () => {
    const noConfig = () => false;
    expect(isSupervisorEnabled({}, noConfig)).toBe(false);
    expect(isSupervisorEnabled({ [SUPERVISOR_ENABLED_ENV]: "0" }, noConfig)).toBe(false);
    expect(isSupervisorEnabled({ [SUPERVISOR_ENABLED_ENV]: "1" }, noConfig)).toBe(true);
    expect(isSupervisorEnabled({}, () => true)).toBe(true);
  });
});

describe("engine — judge + state machine", () => {
  const criteria: AcceptanceCriteria = {
    source: "user",
    steps: [
      { id: "test", argv: ["npm", "test"], required: true },
      { id: "lint", argv: ["npm", "run", "lint"], required: false },
    ],
  };

  it("judge passes only when all required steps ok", () => {
    const pass: ValidationReport = {
      passed: true,
      at: new Date().toISOString(),
      steps: [
        { id: "test", argv: ["npm", "test"], exitCode: 0, ok: true, durationMs: 1 },
        { id: "lint", argv: ["npm", "run", "lint"], exitCode: 1, ok: false, durationMs: 1 },
      ],
    };
    expect(judge(pass, criteria)).toBe(true);
    const fail = {
      ...pass,
      steps: [{ id: "test", argv: ["npm", "test"], exitCode: 1, ok: false, durationMs: 1 }],
    };
    expect(judge(fail, criteria)).toBe(false);
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionTask("planned", "dispatched")).toBe(true);
    expect(canTransitionTask("accepted", "executing")).toBe(false);
  });
});

function makeTask(taskId: string, state: SupervisedTask["state"] = "planned"): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId,
    goal: "add auth module",
    repoRoot: `/repo/${taskId}`,
    worker: { backendId: "kiro-cli" },
    workspace: { id: `ws-${taskId}`, root: `/ws/${taskId}`, kind: "directory" },
    acceptance: {
      steps: [{ id: "test", argv: ["npm", "test"], required: true }],
      source: "repo-detected",
    },
    state,
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

function defaultExecutionContext(task: SupervisedTask): ExecutionContext {
  return {
    identity: { policy: "enterprise_shared", status: "validated" },
    placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
    attribution: {
      workerId: task.worker.backendId,
      ...(task.worker.model ? { model: task.worker.model } : {}),
      ...(task.tenantId ? { tenantId: task.tenantId } : {}),
      ...(task.userId ? { userId: task.userId } : {}),
    },
  };
}

function fakePorts(
  over: Partial<SupervisorPorts> & {
    worker?: WorkerPort;
    escalator?: SupervisorPorts["escalator"];
    reporter?: SupervisorPorts["reporter"];
  },
): SupervisorPorts {
  const worker: WorkerPort =
    over.worker ??
    ({
      dispatch: async () => ({ summary: "done", exitCode: 0 }),
    } satisfies WorkerPort);
  const validator =
    over.validator ??
    ({
      validate: async () => ({
        passed: true,
        at: new Date().toISOString(),
        steps: [{ id: "test", argv: ["npm", "test"], exitCode: 0, ok: true, durationMs: 5 }],
      }),
    } satisfies SupervisorPorts["validator"]);
  const workspace =
    over.workspace ??
    ({
      ensure: async (t) => ({
        id: `ws-${t.taskId}`,
        root: `/ws/${t.taskId}`,
        kind: "directory" as const,
      }),
    } satisfies SupervisorPorts["workspace"]);
  const executionContext =
    over.executionContext ??
    ({
      resolve: async (task) => defaultExecutionContext(task),
    } satisfies SupervisorPorts["executionContext"]);
  return {
    executionContext,
    worker,
    validator,
    workspace,
    escalator: over.escalator,
    reporter: over.reporter,
  };
}

describe("engine — M1/M2 tick (fake ports)", () => {
  const enabled = { env: { OPENBOT_SUPERVISOR_ENABLED: "1" }, readConfig: () => false };

  it("planned → accepted when worker + validation succeed", async () => {
    const result = await superviseTick(makeTask("t-pass"), fakePorts({}), enabled);
    expect(result.state).toBe("accepted");
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]?.validation?.passed).toBe(true);
  });

  it("resolves ExecutionContext before dispatch and passes it to WorkerPort", async () => {
    const seen: Array<{ workerId: string; context: ExecutionContext }> = [];
    const ports = fakePorts({
      worker: {
        dispatch: async (input) => {
          seen.push({ workerId: input.workerId, context: input.context });
          return { summary: "done", exitCode: 0 };
        },
      },
    });
    const result = await superviseTick(makeTask("t-context"), ports, enabled);
    expect(result.state).toBe("accepted");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      workerId: "kiro-cli",
      context: {
        identity: { policy: "enterprise_shared" },
        placement: { executor: "gateway" },
      },
    });
  });

  it("persists only a redacted ExecutionContext snapshot on the iteration", async () => {
    const task = makeTask("t-context-redacted");
    const ports = fakePorts({
      executionContext: {
        resolve: async () => ({
          identity: {
            policy: "enterprise_shared",
            status: "validated",
            credentialId: "corp-key",
            credentialEnv: { OPENAI_API_KEY: "resolved-secret" },
          },
          placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
          attribution: {
            tenantId: "tenant-1",
            userId: "user-1",
            credentialId: "corp-key",
            workerId: "kiro-cli",
            model: "gpt-5",
          },
        }),
      },
    });
    const result = await superviseTick(task, ports, enabled);
    expect(result.state).toBe("accepted");
    expect(result.iterations[0]?.executionContext).toEqual({
      identity: {
        policy: "enterprise_shared",
        status: "validated",
        credentialId: "corp-key",
      },
      placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
      attribution: {
        tenantId: "tenant-1",
        userId: "user-1",
        credentialId: "corp-key",
        workerId: "kiro-cli",
        model: "gpt-5",
      },
    });
    expect(JSON.stringify(result)).not.toContain("resolved-secret");
    expect(JSON.stringify(result)).not.toContain("OPENAI_API_KEY");
  });

  it("fixing → retry → accepted on second round (M2)", async () => {
    let attempt = 0;
    const ports = fakePorts({
      validator: {
        validate: async () => {
          attempt += 1;
          if (attempt === 1) {
            return {
              passed: false,
              at: new Date().toISOString(),
              steps: [{ id: "test", argv: ["npm", "test"], exitCode: 1, ok: false, durationMs: 3 }],
            };
          }
          return {
            passed: true,
            at: new Date().toISOString(),
            steps: [{ id: "test", argv: ["npm", "test"], exitCode: 0, ok: true, durationMs: 3 }],
          };
        },
      },
    });
    let result = await superviseTick(makeTask("t-retry"), ports, enabled);
    expect(result.state).toBe("fixing");
    result = await superviseTick(result, ports, enabled);
    expect(result.state).toBe("accepted");
    expect(result.iterations).toHaveLength(2);
  });

  it("max_iterations stops with escalation ref", async () => {
    const escalator = { escalate: async () => ({ ref: "sc_test" }) };
    const failValidator = {
      validate: async () => ({
        passed: false,
        at: new Date().toISOString(),
        steps: [{ id: "test", argv: ["npm", "test"], exitCode: 1, ok: false, durationMs: 1 }],
      }),
    };
    const ports = fakePorts({ validator: failValidator, escalator });
    let t = makeTask("t-max", "planned");
    t = { ...t, budget: { ...t.budget, maxIterations: 1 } };
    t = await superviseTick(t, ports, enabled);
    expect(t.state).toBe("fixing");
    expect(t.iterations).toHaveLength(1);
    t = await superviseTick(t, ports, enabled);
    expect(t.state).toBe("max_iterations");
    expect(t.escalationRef).toBe("sc_test");
  });

  it("worker auth failure escalates without retry", async () => {
    const ports = fakePorts({
      worker: {
        dispatch: async () => {
          throw new WorkerAuthError();
        },
      },
      escalator: { escalate: async () => ({ ref: "sc_auth" }) },
    });
    const result = await superviseTick(makeTask("t-auth"), ports, enabled);
    expect(result.state).toBe("escalated");
    expect(result.escalationRef).toBe("sc_auth");
  });

  it("ExecutionContext fallback escalates before worker dispatch", async () => {
    const worker = { dispatch: vi.fn(async () => ({ summary: "should-not-run", exitCode: 0 })) };
    const escalator = { escalate: async () => ({ ref: "sc_context" }) };
    const result = await superviseTick(
      makeTask("t-context-fallback"),
      fakePorts({
        worker,
        escalator,
        executionContext: {
          resolve: async () => ({
            fallback: "escalate",
            reason: "Node Agent offline",
          }),
        },
      }),
      enabled,
    );
    expect(worker.dispatch).not.toHaveBeenCalled();
    expect(result.state).toBe("escalated");
    expect(result.escalationRef).toBe("sc_context");
  });

  it("missing credential escalates before worker dispatch with an actionable reason", async () => {
    const worker = { dispatch: vi.fn(async () => ({ summary: "should-not-run", exitCode: 0 })) };
    const escalator = {
      escalate: vi.fn(async (_task: unknown, _reason?: string) => ({ ref: "sc_cred" })),
    };
    const result = await superviseTick(
      makeTask("t-cred-missing"),
      fakePorts({
        worker,
        escalator,
        executionContext: {
          resolve: async () => ({
            identity: { policy: "enterprise_shared", status: "missing" },
            placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
            attribution: { workerId: "kiro-cli" },
          }),
        },
      }),
      enabled,
    );
    // No doomed run: worker never dispatched, task escalated.
    expect(worker.dispatch).not.toHaveBeenCalled();
    expect(result.state).toBe("escalated");
    expect(result.escalationRef).toBe("sc_cred");
    // Actionable, policy-aware reason surfaced to the escalator.
    expect(escalator.escalate).toHaveBeenCalledTimes(1);
    expect(String(escalator.escalate.mock.calls[0]?.[1])).toMatch(/credential/i);
  });

  it("configured credential (local_ide_login) is not blocked by the missing-credential gate", async () => {
    const worker = { dispatch: vi.fn(async () => ({ summary: "done", exitCode: 0 })) };
    const result = await superviseTick(
      makeTask("t-cred-configured"),
      fakePorts({
        worker,
        executionContext: {
          resolve: async () => ({
            identity: { policy: "local_ide_login", status: "configured" },
            placement: {
              placement: "node_agent",
              executor: "node_agent",
              nodeAgentId: "stub",
              fallback: "escalate",
            },
            attribution: { workerId: "cursor-cli" },
          }),
        },
      }),
      enabled,
    );
    expect(worker.dispatch).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("accepted");
  });

  it("WorkerPlacementError escalates without retry", async () => {
    const ports = fakePorts({
      worker: {
        dispatch: async () => {
          const { WorkerPlacementError } = await import("./worker-executor.js");
          throw new WorkerPlacementError("Node Agent execution is not wired yet (M5)");
        },
      },
      escalator: { escalate: async () => ({ ref: "sc_placement" }) },
      executionContext: {
        resolve: async () => ({
          identity: { policy: "local_ide_login", status: "configured" },
          placement: {
            placement: "node_agent",
            executor: "node_agent",
            nodeAgentId: "stub",
            fallback: "escalate",
          },
          attribution: { workerId: "cursor-cli" },
        }),
      },
    });
    const result = await superviseTick(makeTask("t-placement"), ports, enabled);
    expect(result.state).toBe("escalated");
    expect(result.escalationRef).toBe("sc_placement");
  });

  it("feature off is a no-op", async () => {
    const task = makeTask("t-off");
    const result = await superviseTick(task, fakePorts({}), {
      env: {},
      readConfig: () => false,
    });
    expect(result).toEqual(task);
  });
});

describe("engine — store integration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sup-engine-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("persists tick result via updateTask", async () => {
    await createTask(makeTask("t1"), dir);
    const ports = fakePorts({
      workspace: createWorkspacePort(createDirectoryWorkspaceProvider({ baseDir: dir })),
    });
    const next = await superviseTick(makeTask("t1"), ports, {
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    await updateTask("t1", () => next, dir);
    expect((await getTask("t1", dir))?.state).toBe("accepted");
  });
});

describe("validator — NodeValidationAdapter", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "sup-node-"));
    writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } }),
    );
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("detects package.json and plans test/lint steps", async () => {
    const adapter = new NodeValidationAdapter();
    expect(await adapter.detect(repo)).toBe(true);
    const plan = await adapter.plan(repo);
    expect(plan.source).toBe("repo-detected");
    expect(plan.steps.map((s) => s.id)).toEqual(["test", "lint"]);
  });

  it("registry returns first matching adapter plan", async () => {
    const plan = await new ValidationAdapterRegistry().planForRepo(repo);
    expect(plan?.steps.length).toBeGreaterThan(0);
  });
});

describe("driver — tick + abort (M2)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sup-driver-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("abortSupervisedTask marks non-terminal tasks aborted", async () => {
    await createTask(makeTask("t1", "fixing"), dir);
    const aborted = await abortSupervisedTask("t1", undefined, dir);
    expect(aborted?.state).toBe("aborted");
    expect((await getTask("t1", dir))?.state).toBe("aborted");
  });

  it("abortSupervisedTask calls worker.cancelActive when provided", async () => {
    await createTask(makeTask("t-abort-cancel", "executing"), dir);
    const cancelActive = vi.fn(async () => undefined);
    const ports = fakePorts({
      worker: { dispatch: async () => ({ summary: "", exitCode: 0 }), cancelActive },
    });
    const aborted = await abortSupervisedTask("t-abort-cancel", ports, dir);
    expect(aborted?.state).toBe("aborted");
    expect(cancelActive).toHaveBeenCalledWith("t-abort-cancel");
  });

  it("tickSupervisedTask persists executing checkpoint with activeRun", async () => {
    await createTask(makeTask("t-checkpoint"), dir);
    let releaseWorker!: () => void;
    const workerBlocked = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });
    const ports = fakePorts({
      workspace: createWorkspacePort(createDirectoryWorkspaceProvider({ baseDir: dir })),
      worker: {
        dispatch: async ({ onStarted }) => {
          await onStarted?.({ runId: "run-cp", workerId: "w-cp" });
          await workerBlocked;
          return { summary: "done", exitCode: 0 };
        },
      },
    });
    const tickPromise = tickSupervisedTask("t-checkpoint", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    await vi.waitFor(async () => {
      const snap = await getTask("t-checkpoint", dir);
      expect(snap?.activeRun).toEqual({ runId: "run-cp", workerId: "w-cp" });
      expect(snap?.state).toBe("executing");
    });
    releaseWorker();
    const next = await tickPromise;
    expect(next?.state).toBe("accepted");
    expect((await getTask("t-checkpoint", dir))?.activeRun).toBeUndefined();
  });

  it("resumeValidatingRound completes validation for stale validating snapshot", async () => {
    const task = makeTask("t-resume-val", "validating");
    task.iterations = [
      {
        index: 0,
        startedAt: new Date().toISOString(),
        workerSummary: "partial",
        exitCode: 0,
      },
    ];
    await createTask(task, dir);
    const ports = fakePorts({
      workspace: createWorkspacePort(createDirectoryWorkspaceProvider({ baseDir: dir })),
    });
    const next = await tickSupervisedTask("t-resume-val", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    expect(next?.state).toBe("accepted");
    expect(next?.iterations[0]?.validation?.passed).toBe(true);
  });

  it("tickSupervisedTask persists engine advances", async () => {
    await createTask(makeTask("t2"), dir);
    const ports = fakePorts({
      workspace: createWorkspacePort(createDirectoryWorkspaceProvider({ baseDir: dir })),
    });
    const next = await tickSupervisedTask("t2", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    expect(next?.state).toBe("accepted");
    expect((await getTask("t2", dir))?.state).toBe("accepted");
  });

  it("tickSupervisedTask uses worker.retryableExitCodes from production ports", async () => {
    await createTask(makeTask("t-retryable-codes"), dir);
    const ports = fakePorts({
      worker: {
        dispatch: async () => ({ summary: "failed once", exitCode: 7 }),
        getRetryableExitCodes: () => [7],
      },
    });
    const next = await tickSupervisedTask("t-retryable-codes", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    // exitCode=7 is treated as retryable by injected codes, so task proceeds to validation path.
    expect(next?.state).toBe("accepted");
  });

  it("tickSupervisedTask escalates non-retryable worker exit code", async () => {
    await createTask(makeTask("t-non-retryable"), dir);
    const ports = fakePorts({
      worker: {
        dispatch: async () => ({ summary: "auth/network fail", exitCode: 9 }),
        getRetryableExitCodes: () => [1, 2],
      },
      escalator: { escalate: async () => ({ ref: "sc_non_retryable" }) },
    });
    const next = await tickSupervisedTask("t-non-retryable", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    expect(next?.state).toBe("escalated");
    expect(next?.escalationRef).toBe("sc_non_retryable");
  });

  it("tickSupervisedTask recycles workspace when task reaches terminal state", async () => {
    await createTask(makeTask("t-recycle"), dir);
    const recycle = vi.fn(async () => undefined);
    const ports = fakePorts({
      workspace: {
        ensure: async (task) => ({
          id: `ws-${task.taskId}`,
          root: `/ws/${task.taskId}`,
          kind: "directory" as const,
        }),
        recycle,
      },
    });
    const next = await tickSupervisedTask("t-recycle", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    expect(next?.state).toBe("accepted");
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(recycle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ws-t-recycle",
      }),
    );
  });

  it("tickSupervisedTask emits final report on terminal transition", async () => {
    await createTask(makeTask("t-report"), dir);
    const finalReport = vi.fn(async () => undefined);
    const ports = fakePorts({
      workspace: createWorkspacePort(createDirectoryWorkspaceProvider({ baseDir: dir })),
      reporter: {
        taskStarted: vi.fn(async () => undefined),
        milestone: vi.fn(async () => undefined),
        progress: vi.fn(async () => undefined),
        finalReport,
      },
    });
    const next = await tickSupervisedTask("t-report", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    expect(next?.state).toBe("accepted");
    expect(finalReport).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t-report", state: "accepted" }),
    );
  });

  it("abortSupervisedTask emits final report for aborted task", async () => {
    await createTask(makeTask("t-abort-report", "fixing"), dir);
    const finalReport = vi.fn(async () => undefined);
    const ports = fakePorts({
      reporter: {
        taskStarted: vi.fn(async () => undefined),
        milestone: vi.fn(async () => undefined),
        progress: vi.fn(async () => undefined),
        finalReport,
      },
    });
    const aborted = await abortSupervisedTask("t-abort-report", ports, dir);
    expect(aborted?.state).toBe("aborted");
    expect(finalReport).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t-abort-report", state: "aborted" }),
    );
  });

  it("tickSupervisedTask forwards worker progress events to reporter", async () => {
    await createTask(makeTask("t-progress"), dir);
    const progress = vi.fn(async () => undefined);
    const ports = fakePorts({
      worker: {
        dispatch: async ({ onProgress }) => {
          onProgress?.({ type: "status", phase: "running" });
          return { summary: "done", exitCode: 0 };
        },
      },
      reporter: {
        taskStarted: vi.fn(async () => undefined),
        milestone: vi.fn(async () => undefined),
        progress,
        finalReport: vi.fn(async () => undefined),
      },
    });
    const next = await tickSupervisedTask("t-progress", ports, {
      storeDir: dir,
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
    });
    expect(next?.state).toBe("accepted");
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t-progress" }),
      expect.objectContaining({ type: "status", phase: "running" }),
    );
  });
});

describe("workspace — directory provider", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), "sup-ws-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("creates isolated per-task directories", async () => {
    const provider = createDirectoryWorkspaceProvider({ baseDir: base });
    const repoRoot = path.join(base, "repo");
    const a = await provider.create({ taskId: "a", repoRoot });
    const b = await provider.create({ taskId: "b", repoRoot });
    expect(a.root).not.toBe(b.root);
    expect(a.kind).toBe("directory");
  });

  it("destroy keeps artifacts and writes retained marker", async () => {
    const provider = createDirectoryWorkspaceProvider({ baseDir: base });
    const repoRoot = path.join(base, "repo");
    const ws = await provider.create({ taskId: "keep-artifacts", repoRoot });
    await provider.destroy({ taskId: "keep-artifacts", repoRoot }, ws);

    const marker = path.join(ws.root, ".openbot-supervisor-retained.json");
    expect(existsSync(ws.root)).toBe(true);
    expect(existsSync(marker)).toBe(true);

    const payload = JSON.parse(readFileSync(marker, "utf8")) as {
      retained: boolean;
      recyclable: boolean;
    };
    expect(payload.retained).toBe(true);
    expect(payload.recyclable).toBe(true);
  });
});

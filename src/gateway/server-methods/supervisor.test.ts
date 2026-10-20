import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeRegistry } from "../node-registry.js";
import type { SupervisorPorts } from "../supervisor/engine.js";

const writeConfigFile = vi.fn(async (_cfg?: unknown, _options?: unknown) => undefined);
const loadConfig = vi.fn(() => ({
  gateway: { supervisor: { enabled: false } },
}));
vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfig(),
  writeConfigFile: (cfg: unknown, options?: unknown) => writeConfigFile(cfg, options),
}));

import { setSupervisorPortsProvider, supervisorHandlers } from "./supervisor.js";

const resolveTrustedAttributionMock = vi.hoisted(() => vi.fn());

vi.mock("../scope-attribution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scope-attribution.js")>();
  return {
    ...actual,
    resolveTrustedAttribution: resolveTrustedAttributionMock,
  };
});

vi.mock("../supervisor/store.js", () => ({
  createTask: vi.fn(async (task: unknown) => task),
  getTask: vi.fn(async () => null),
  listTasks: vi.fn(async () => []),
  listActiveTasks: vi.fn(async () => []),
}));

vi.mock("../supervisor/driver.js", () => ({
  tickSupervisedTask: vi.fn(async () => null),
  abortSupervisedTask: vi.fn(async () => null),
}));

import { abortSupervisedTask, tickSupervisedTask } from "../supervisor/driver.js";
import { createTask, getTask, listActiveTasks, listTasks } from "../supervisor/store.js";

vi.mock("../supervisor/runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../supervisor/runner.js")>();
  return {
    ...actual,
    getSupervisorRunnerStatus: vi.fn(() => ({
      enabled: false,
      ownerId: "runner-test",
      maxConcurrency: 4,
      activeTicks: 0,
      activeLeases: 0,
      queuedCandidates: 0,
      lastSweepAtMs: null,
      lastSweepDriven: 0,
    })),
    listSupervisorLeases: vi.fn(() => []),
  };
});

import { getSupervisorRunnerStatus, listSupervisorLeases } from "../supervisor/runner.js";

vi.mock("./fabric.js", () => ({
  getFabricAuditStore: vi.fn(() => ({
    query: vi.fn(() => [{ id: "fab-1", correlationId: "task-a" }]),
    stats: vi.fn(() => ({ total: 1 })),
  })),
}));

vi.mock("../../agents/cli-backend-usage-attribution.js", () => ({
  queryCliBackendUsage: vi.fn(async () => [
    {
      tenantId: "t1",
      userId: "u1",
      backendId: "codex-cli",
      credentialId: "c1",
      executionId: "task-a:run-1",
    },
  ]),
}));

vi.mock("../supervisor/reporter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../supervisor/reporter.js")>();
  return {
    ...actual,
    readSupervisorReportEvents: vi.fn(async () => [{ type: "progress", taskId: "task-a" }]),
  };
});

import { queryCliBackendUsage } from "../../agents/cli-backend-usage-attribution.js";

type RespondCall = { ok: boolean; payload?: unknown; error?: unknown };
function capture() {
  const calls: RespondCall[] = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) =>
    calls.push({ ok, payload, error });
  return { calls, respond };
}

function ctx(
  params: Record<string, unknown>,
  respond: ReturnType<typeof capture>["respond"],
  client: {
    connId?: string;
    user?: string;
    sessionDomain?: "employee" | "enterprise" | "platform";
    sessionKind?: "platform-super-admin" | "platform-admin" | "enterprise-admin" | "member";
  } | null = null,
) {
  return {
    params,
    respond,
    client,
    req: {},
    isWebchatConnect: () => false,
    context: { nodeRegistry: new NodeRegistry() },
  } as never;
}

function ctxWithNode(
  params: Record<string, unknown>,
  respond: ReturnType<typeof capture>["respond"],
  client: { connId?: string; user?: string } | null = null,
) {
  const nodeRegistry = new NodeRegistry();
  nodeRegistry.register(
    {
      connId: "node-conn-1",
      connect: {
        client: { id: "node-client", displayName: "Daniel Mac", platform: "macos" },
        device: { id: "mac-node" },
        caps: [],
        commands: ["supervisor.worker.dispatch"],
      },
    } as never,
    {},
  );
  return {
    params,
    respond,
    client,
    req: {},
    isWebchatConnect: () => false,
    context: { nodeRegistry },
  } as never;
}

function fakePorts(repoRoot: string): SupervisorPorts {
  return {
    executionContext: {
      resolve: async () => ({ fallback: "escalate", reason: "not configured" }),
    },
    worker: {
      dispatch: async () => ({ summary: "ok", exitCode: 0 }),
    },
    validator: {
      validate: async () => ({
        passed: true,
        at: new Date().toISOString(),
        steps: [],
      }),
    },
    workspace: {
      ensure: async (task) => ({
        id: `ws-${task.taskId}`,
        root: path.join(repoRoot, "ws", task.taskId),
        kind: "directory",
      }),
    },
  };
}

describe("supervisor server handlers", () => {
  let repoRoot: string;

  beforeEach(async () => {
    process.env.OPENBOT_SUPERVISOR_ENABLED = "1";
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sup-handler-"));
    await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ scripts: { test: "echo ok", lint: "echo ok" } }),
      "utf8",
    );
    setSupervisorPortsProvider(() => fakePorts(repoRoot));
    resolveTrustedAttributionMock.mockReset();
    resolveTrustedAttributionMock.mockResolvedValue({});
    vi.mocked(createTask).mockReset();
    vi.mocked(getTask).mockReset();
    vi.mocked(listTasks).mockReset();
    vi.mocked(listActiveTasks).mockReset();
    vi.mocked(tickSupervisedTask).mockReset();
    vi.mocked(abortSupervisedTask).mockReset();
    vi.mocked(createTask).mockImplementation(async (task) => task);
    vi.mocked(listActiveTasks).mockResolvedValue([]);
  });

  afterEach(async () => {
    setSupervisorPortsProvider(null);
    delete process.env.OPENBOT_SUPERVISOR_ENABLED;
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it("create: 参数缺失时返回 INVALID_REQUEST", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.create"](ctx({ repoRoot }, respond));
    expect(calls[0]?.ok).toBe(false);
  });

  it("create: 仓库缺少 package.json（自动探测）时返回错误而非静默挂起", async () => {
    // Regression: with the repo-auto template, planForRepo returns null when no
    // package.json is detected. The handler must respond with an explicit error;
    // before the fix it returned without ever calling respond, leaving the
    // client RPC pending forever (UI stuck on "创建中…").
    const emptyRepo = await fs.mkdtemp(path.join(os.tmpdir(), "sup-no-pkg-"));
    await fs.mkdir(path.join(emptyRepo, ".git"), { recursive: true });
    const { calls, respond } = capture();
    try {
      await supervisorHandlers["supervisor.task.create"](
        ctx({ goal: "fix tests", repoRoot: emptyRepo, workerBackendId: "codex-cli" }, respond),
      );
    } finally {
      await fs.rm(emptyRepo, { recursive: true, force: true });
    }
    // Must have responded exactly once (no silent hang) with a failure.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(false);
    expect((calls[0]?.error as { message?: string })?.message).toContain("package.json");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("create: 成功创建并异步触发首轮 tick", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.create"](
      ctx({ goal: "fix tests", repoRoot, workerBackendId: "codex-cli" }, respond),
    );
    expect(calls[0]?.ok).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(tickSupervisedTask).toHaveBeenCalledTimes(1);
  });

  it("create: templateId 使用内置验收模板", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.create"](
      ctx(
        {
          goal: "fix tests",
          repoRoot,
          workerBackendId: "codex-cli",
          templateId: "node-test-only",
        },
        respond,
      ),
    );
    expect(calls[0]?.ok).toBe(true);
    const created = vi.mocked(createTask).mock.calls[0]?.[0] as {
      acceptance: { source: string; steps: unknown[] };
    };
    expect(created.acceptance.source).toBe("template");
    expect(created.acceptance.steps).toHaveLength(1);
  });

  it("template.list: 返回内置模板", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.template.list"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { templates: Array<{ id: string }> };
    expect(payload.templates.some((t) => t.id === "node-test-lint")).toBe(true);
  });

  it("worker.list: 返回带 worker 元数据的后端", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.worker.list"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { workers: unknown[] };
    expect(Array.isArray(payload.workers)).toBe(true);
  });

  it("worker.health: 返回只读健康状态且不暴露 credentialEnv", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.worker.health"](
      ctx({ backendId: "codex-cli", tenantId: "t1" }, respond),
    );
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      workers: Array<{ backendId: string; identity: Record<string, unknown>; auth: unknown }>;
    };
    expect(payload.workers.some((row) => row.backendId === "codex-cli")).toBe(true);
    const codex = payload.workers.find((row) => row.backendId === "codex-cli");
    expect(codex?.identity).not.toHaveProperty("credentialEnv");
    expect(JSON.stringify(payload)).not.toMatch(/credentialEnv/);
  });

  it("worker.policy: upsert + list + remove", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.worker.policy.upsert"](
      ctx(
        {
          tenantId: "t-policy",
          workerId: "codex-cli",
          credentialPolicy: "enterprise_shared",
          executionPlacement: "gateway",
        },
        respond,
        { sessionKind: "enterprise-admin" },
      ),
    );
    expect(calls[0]?.ok).toBe(true);
    await supervisorHandlers["supervisor.worker.policy.list"](
      ctx({ tenantId: "t-policy" }, respond),
    );
    expect(calls[1]?.ok).toBe(true);
    const listed = calls[1]?.payload as { policies: Array<{ workerId: string }> };
    expect(listed.policies.some((p) => p.workerId === "codex-cli")).toBe(true);
    await supervisorHandlers["supervisor.worker.policy.remove"](
      ctx({ tenantId: "t-policy", workerId: "codex-cli" }, respond, {
        sessionKind: "enterprise-admin",
      }),
    );
    expect(calls[2]?.ok).toBe(true);
  });

  it("worker.policy: employee and session writes are rejected", async () => {
    const { calls, respond } = capture();
    const params = {
      tenantId: "t-policy-denied",
      workerId: "codex-cli",
      credentialPolicy: "local_ide_login",
      executionPlacement: "node_agent",
    };
    await supervisorHandlers["supervisor.worker.policy.upsert"](
      ctx(params, respond, { sessionKind: "member", sessionDomain: "employee" }),
    );
    await supervisorHandlers["supervisor.worker.policy.upsert"](
      ctx(params, respond, { sessionDomain: "employee" }),
    );
    await supervisorHandlers["supervisor.worker.policy.upsert"](ctx(params, respond, null));
    await supervisorHandlers["supervisor.worker.policy.remove"](
      ctx({ tenantId: "t-policy-denied", workerId: "codex-cli" }, respond, {
        sessionKind: "member",
      }),
    );
    expect(calls.map((call) => call.ok)).toEqual([false, false, false, false]);
    for (const call of calls) {
      expect(JSON.stringify(call.error)).toMatch(/enterprise-admin only/);
    }
  });

  it("node.bind + bindings.list", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.node.bind"](
      ctx({ tenantId: "t1", seatId: "seat-1", nodeId: "mac-node" }, respond),
    );
    expect(calls[0]?.ok).toBe(true);
    await supervisorHandlers["supervisor.node.bindings.list"](ctx({ tenantId: "t1" }, respond));
    expect(calls[1]?.ok).toBe(true);
    const payload = calls[1]?.payload as { bindings: Array<{ nodeId: string }> };
    expect(payload.bindings.some((entry) => entry.nodeId === "mac-node")).toBe(true);
  });

  it("node binding request: employee create + admin approve auto-binds", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.node.bindingRequest.create"](
      ctxWithNode(
        { tenantId: "t-request", seatId: "seat-1", userId: "u1", nodeId: "mac-node" },
        respond,
      ),
    );
    expect(calls[0]?.ok).toBe(true);
    const created = calls[0]?.payload as { request: { requestId: string; status: string } };
    expect(created.request.status).toBe("pending");

    await supervisorHandlers["supervisor.node.bindingRequest.list"](
      ctx({ tenantId: "t-request" }, respond),
    );
    expect(calls[1]?.ok).toBe(true);
    const listed = calls[1]?.payload as { requests: Array<{ requestId: string }> };
    expect(listed.requests.some((entry) => entry.requestId === created.request.requestId)).toBe(
      true,
    );

    await supervisorHandlers["supervisor.node.bindingRequest.resolve"](
      ctx({ requestId: created.request.requestId, decision: "approved" }, respond, {
        user: "admin",
      }),
    );
    expect(calls[2]?.ok).toBe(true);
    const resolved = calls[2]?.payload as {
      binding: { tenantId: string; seatId: string; nodeId: string };
    };
    expect(resolved.binding).toMatchObject({
      tenantId: "t-request",
      seatId: "seat-1",
      nodeId: "mac-node",
    });
  });

  it("node.list: returns connected nodes array", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.node.list"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { nodes: unknown[] };
    expect(Array.isArray(payload.nodes)).toBe(true);
  });

  it("list: 支持 tenant/user 过滤", async () => {
    vi.mocked(listTasks).mockResolvedValue([
      { taskId: "a", tenantId: "t1", userId: "u1" } as never,
      { taskId: "b", tenantId: "t1", userId: "u2" } as never,
      { taskId: "c", tenantId: "t2", userId: "u2" } as never,
    ]);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.list"](
      ctx({ tenantId: "t1", userId: "u2" }, respond),
    );
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { tasks: Array<{ taskId: string }> };
    expect(payload.tasks.map((t) => t.taskId)).toEqual(["b"]);
  });

  it("list: 无 tenant/user 的任务在带过滤请求时仍可见", async () => {
    vi.mocked(listTasks).mockResolvedValue([
      { taskId: "scoped", tenantId: "t1", userId: "u2" } as never,
      { taskId: "unscoped" } as never,
      { taskId: "other-tenant", tenantId: "t2", userId: "u2" } as never,
    ]);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.list"](
      ctx({ tenantId: "t1", userId: "u2" }, respond),
    );
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { tasks: Array<{ taskId: string }> };
    expect(payload.tasks.map((t) => t.taskId).toSorted()).toEqual(["scoped", "unscoped"]);
  });

  it("list: 员工会话只返回本人任务，忽略伪造 userId，并隐藏无主任务", async () => {
    resolveTrustedAttributionMock.mockResolvedValue({
      ownerId: "user-self",
      tenantId: "t1",
    });
    vi.mocked(listTasks).mockResolvedValue([
      { taskId: "own", tenantId: "t1", userId: "user-self" } as never,
      { taskId: "own-email-legacy", tenantId: "t1", userId: "self@test.com" } as never,
      { taskId: "colleague", tenantId: "t1", userId: "user-colleague" } as never,
      { taskId: "orphan", tenantId: "t1" } as never,
      { taskId: "forged-match", tenantId: "t1", userId: "forged-user" } as never,
    ]);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.list"](
      ctx({ tenantId: "t1", userId: "forged-user" }, respond, {
        sessionDomain: "employee",
        user: "self@test.com",
      }),
    );
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { tasks: Array<{ taskId: string }> };
    expect(payload.tasks.map((t) => t.taskId).toSorted()).toEqual(["own", "own-email-legacy"]);
  });

  it("create: 员工会话用 actor.userId 盖章，忽略客户端伪造身份", async () => {
    resolveTrustedAttributionMock.mockResolvedValue({
      ownerId: "user-self",
      tenantId: "t1",
    });
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.create"](
      ctx(
        {
          goal: "fix bug",
          repoRoot,
          workerBackendId: "codex-cli",
          tenantId: "forged-tenant",
          userId: "forged-user",
        },
        respond,
        { sessionDomain: "employee", user: "self@test.com" },
      ),
    );
    expect(calls[0]?.ok).toBe(true);
    const created = vi.mocked(createTask).mock.calls[0]?.[0] as {
      userId?: string;
      tenantId?: string;
    };
    expect(created.userId).toBe("user-self");
    expect(created.tenantId).toBe("t1");
  });

  it("get: 员工会话不能读取同事任务", async () => {
    resolveTrustedAttributionMock.mockResolvedValue({
      ownerId: "user-self",
      tenantId: "t1",
    });
    vi.mocked(getTask).mockResolvedValue({
      taskId: "colleague-task",
      tenantId: "t1",
      userId: "user-colleague",
    } as never);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.get"](
      ctx({ taskId: "colleague-task" }, respond, {
        sessionDomain: "employee",
        user: "self@test.com",
      }),
    );
    expect(calls[0]?.ok).toBe(false);
  });

  it("abort: 透传 ports 到 abortSupervisedTask", async () => {
    vi.mocked(getTask).mockResolvedValue({ taskId: "x" } as never);
    vi.mocked(abortSupervisedTask).mockResolvedValue({ taskId: "x", state: "aborted" } as never);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.abort"](ctx({ taskId: "x" }, respond));
    expect(calls[0]?.ok).toBe(true);
    expect(abortSupervisedTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(abortSupervisedTask).mock.calls[0]?.[1]).toBeTruthy();
  });

  it("subscribe: 注册 connId 并返回 subscribed", async () => {
    vi.mocked(getTask).mockResolvedValue({ taskId: "task-a" } as never);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.subscribe"](
      ctx({ taskId: "task-a" }, respond, { connId: "conn-1" }),
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({ taskId: "task-a", subscribed: true });
  });

  it("audit: 聚合 Fabric + usage + report 事件", async () => {
    vi.mocked(getTask).mockResolvedValue({ taskId: "task-a", tenantId: "t1" } as never);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.task.audit"](ctx({ taskId: "task-a" }, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      fabricRecords: unknown[];
      usageAttribution: unknown[];
      reportEvents: unknown[];
    };
    expect(payload.fabricRecords).toHaveLength(1);
    expect(payload.usageAttribution).toHaveLength(1);
    expect(payload.reportEvents).toHaveLength(1);
    expect(queryCliBackendUsage).toHaveBeenCalledWith(
      expect.objectContaining({ executionIdPrefix: "task-a", tenantId: "t1" }),
    );
  });

  it("runner.status: 返回 Runner 状态与活跃候选数", async () => {
    vi.mocked(listActiveTasks).mockResolvedValue([{ taskId: "active-1" } as never]);
    vi.mocked(getSupervisorRunnerStatus).mockReturnValue({
      enabled: true,
      ownerId: "runner-test",
      maxConcurrency: 4,
      activeTicks: 1,
      activeLeases: 1,
      queuedCandidates: 0,
      lastSweepAtMs: 1_700_000_000_000,
      lastSweepDriven: 2,
    });
    vi.mocked(listSupervisorLeases).mockReturnValue([
      {
        taskId: "active-1",
        ownerId: "runner-test",
        acquiredAtMs: 1_700_000_000_000,
        expiresAtMs: 1_700_000_120_000,
      },
    ]);
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.runner.status"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      enabled: true,
      maxConcurrency: 4,
      activeTicks: 1,
      activeLeases: 1,
      queuedCandidates: 1,
    });
    expect(listSupervisorLeases).toHaveBeenCalled();
  });

  it("status: returns supervisor enablement sources", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.status"](ctx({}, respond));
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toEqual(
      expect.objectContaining({
        enabled: expect.any(Boolean),
        envEnabled: expect.any(Boolean),
        configEnabled: false,
        runnerEnabled: expect.any(Boolean),
      }),
    );
  });

  it("feature.set: persists gateway.supervisor.enabled", async () => {
    const { calls, respond } = capture();
    await supervisorHandlers["supervisor.feature.set"](ctx({ enabled: true }, respond));
    expect(writeConfigFile).toHaveBeenCalled();
    expect(calls[0]?.ok).toBe(true);
  });
});

/**
 * Full chain: employee agent tool → CronService.add → jobs.json →
 * cron.list (personal / 定时任务) and workbench.my-tasks.list (我的任务).
 *
 * Run:
 *   pnpm exec vitest run src/cron/owner-scheduled-task.chain.test.ts
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmployeeWorkbenchActor } from "../gateway/employee-workbench-scope.js";

const actorState = vi.hoisted(() => ({
  current: null as EmployeeWorkbenchActor | null,
}));

const attributionState = vi.hoisted(() => ({
  ownerId: "user-1" as string | undefined,
  tenantId: "tenant-a" as string | undefined,
  scope: { kind: "self" as const, ownerId: "user-1" },
}));

const storePathState = vi.hoisted(() => ({ current: "" }));

vi.mock("../gateway/employee-workbench-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/employee-workbench-scope.js")>();
  return {
    ...actual,
    resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
  };
});

vi.mock("../gateway/scope-attribution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/scope-attribution.js")>();
  return {
    ...actual,
    resolveQueryScope: vi.fn(async () => attributionState.scope),
    resolveTrustedAttribution: vi.fn(async () => ({
      ownerId: attributionState.ownerId,
      tenantId: attributionState.tenantId,
    })),
  };
});

vi.mock("./store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store.js")>();
  return {
    ...actual,
    resolveCronStorePath: (storePath?: string) => {
      if (storePath?.trim()) {
        return actual.resolveCronStorePath(storePath);
      }
      return storePathState.current || actual.resolveCronStorePath(storePath);
    },
  };
});

const { createScheduledTaskTool } = await import("../agents/tools/scheduled-task-tool.js");
const { cronHandlers } = await import("../gateway/server-methods/cron.js");
const { workbenchHandlers } = await import("../gateway/server-methods/workbench.js");
const { CronService } = await import("./service.js");
const { createNoopLogger } = await import("./service.test-harness.js");
const { loadCronStore } = await import("./store.js");
const { registerScheduledTaskCronPort } = await import("./owner-scheduled-task.js");

const ACTOR: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "owner@example.com",
  tenantId: "tenant-a",
  seatAgentIds: ["skill-incubator", "main"],
  seatSpaceIds: ["grp-1"],
};

const EMPLOYEE_CLIENT = {
  connect: {},
  user: "owner@example.com",
  platformUserId: "user-1",
  sessionDomain: "employee",
  sessionEnterpriseId: "tenant-a",
  sessionTenantId: "tenant-a",
};

const TOOL_IDENTITY = {
  agentSessionKey: "agent:skill-incubator:main",
  requesterAgentIdOverride: "skill-incubator",
  gatewayClientUser: "owner@example.com",
  gatewayClientSessionDomain: "employee" as const,
  gatewayClientPlatformUserId: "user-1",
  gatewayClientSessionEnterpriseId: "tenant-a",
};

const DAILY_EIGHT = { kind: "cron", expr: "0 8 * * *", tz: "Asia/Shanghai" } as const;

type ListedJob = {
  id: string;
  name: string;
  schedule: { kind: string; expr?: string; tz?: string; staggerMs?: number };
  sessionTarget: string;
  wakeMode: string;
  payload: { kind: string; message?: string };
  delivery?: { mode?: string; surfaces?: string[] };
  ownership?: { ownerId?: string; tenantId?: string };
  agentId?: string;
  sessionKey?: string;
  enabled?: boolean;
  state?: { nextRunAtMs?: number };
};

function captureRespond() {
  const calls: Array<{
    ok: boolean;
    payload?: unknown;
    error?: { message?: string };
  }> = [];
  return {
    calls,
    respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      calls.push({ ok, payload, error });
    },
  };
}

async function withStore(
  run: (env: { cron: CronService; storePath: string }) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-scheduled-task-"));
  const storePath = path.join(root, "cron", "jobs.json");
  storePathState.current = storePath;
  const cron = new CronService({
    storePath,
    cronEnabled: true,
    log: createNoopLogger(),
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const, summary: "ok" })),
  });
  await cron.start();
  registerScheduledTaskCronPort({
    add: (job) => cron.add(job),
  });
  try {
    await run({ cron, storePath });
  } finally {
    registerScheduledTaskCronPort(null);
    cron.stop();
    storePathState.current = "";
    await fs.rm(root, { recursive: true, force: true });
  }
}

function ownerTool(overrides?: Partial<typeof TOOL_IDENTITY> & { agentSessionKey?: string }) {
  const tool = createScheduledTaskTool({ ...TOOL_IDENTITY, ...overrides });
  if (!tool.execute) {
    throw new Error("scheduled_task has no execute");
  }
  return tool;
}

async function executeAdd(
  args: Record<string, unknown>,
  overrides?: Partial<typeof TOOL_IDENTITY> & { agentSessionKey?: string },
): Promise<{ job: ListedJob }> {
  const tool = ownerTool(overrides);
  const result = await tool.execute("call-1", args);
  return result.details as { job: ListedJob };
}

describe("owner scheduled task chain", () => {
  afterEach(() => {
    registerScheduledTaskCronPort(null);
    actorState.current = ACTOR;
    attributionState.ownerId = "user-1";
    attributionState.tenantId = "tenant-a";
    attributionState.scope = { kind: "self", ownerId: "user-1" };
    storePathState.current = "";
  });

  it("creates a daily 08:00 Asia/Shanghai job that cron.list and 我的任务 both return", async () => {
    actorState.current = ACTOR;
    await withStore(async ({ cron, storePath }) => {
      const created = await executeAdd({
        action: "add",
        name: "未读邮件摘要",
        message: "汇总未读邮件，并把摘要发回当前会话。",
        dailyTime: "08:00",
        tz: "Asia/Shanghai",
      });

      const stored = await loadCronStore(storePath);
      expect(stored.jobs).toHaveLength(1);
      const job = stored.jobs[0];
      expect(job.id).toBe(created.job.id);
      expect(job.name).toBe("未读邮件摘要");
      expect(job.enabled).toBe(true);
      expect(job.agentId).toBe("skill-incubator");
      expect(job.sessionKey).toBe("agent:skill-incubator:main");
      expect(job.schedule).toEqual(DAILY_EIGHT);
      expect(job.schedule).not.toHaveProperty("staggerMs");
      expect(job.sessionTarget).toBe("isolated");
      expect(job.wakeMode).toBe("now");
      expect(job.payload).toEqual({
        kind: "agentTurn",
        message: "汇总未读邮件，并把摘要发回当前会话。",
      });
      expect(job.delivery).toEqual({ mode: "none", surfaces: ["workbench-agent-main"] });
      expect(job.ownership).toEqual({ ownerId: "user-1", tenantId: "tenant-a" });
      expect(job.description).toBe("汇总未读邮件，并把摘要发回当前会话。");
      expect(Number.isFinite(job.state.nextRunAtMs)).toBe(true);

      const raw = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
        version: number;
        jobs: Array<{ schedule: Record<string, unknown> }>;
      };
      expect(raw.version).toBe(1);
      expect(raw.jobs[0]?.schedule).toEqual(DAILY_EIGHT);

      await cron.add({
        name: "同事的任务",
        enabled: true,
        agentId: "skill-incubator",
        sessionKey: "agent:skill-incubator:main",
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "colleague only" },
        delivery: { mode: "none" },
        ownership: { ownerId: "user-2", tenantId: "tenant-a" },
      });

      const list = captureRespond();
      await cronHandlers["cron.list"]({
        params: { ownerScope: "personal", includeDisabled: true },
        respond: list.respond,
        client: EMPLOYEE_CLIENT,
        context: {
          cron,
          cronStorePath: storePath,
          logGateway: { info: vi.fn(), warn: vi.fn() },
        },
      } as never);
      expect(list.calls[0]?.ok).toBe(true);
      const listed = list.calls[0]?.payload as { jobs: ListedJob[] } | undefined;
      expect(listed?.jobs.map((entry) => entry.id)).toEqual([job.id]);
      expect(listed?.jobs[0]?.schedule).toEqual(DAILY_EIGHT);
      expect(listed?.jobs[0]?.name).toBe("未读邮件摘要");

      const myTasks = captureRespond();
      await workbenchHandlers["workbench.my-tasks.list"]({
        params: {},
        respond: myTasks.respond,
        client: EMPLOYEE_CLIENT,
        context: {},
      } as never);
      expect(myTasks.calls[0]?.ok).toBe(true);
      const tasks = myTasks.calls[0]?.payload as {
        cronCount: number;
        cronJobs: Array<{ id: string; title: string; status?: string; kind: string }>;
      };
      expect(tasks.cronJobs.map((entry) => entry.id)).toEqual([`cron:${job.id}`]);
      expect(tasks.cronJobs[0]).toMatchObject({
        kind: "cron",
        title: "未读邮件摘要",
        status: "enabled",
      });
      expect(tasks.cronCount).toBe(1);
      expect(tasks.cronJobs.some((entry) => entry.title === "同事的任务")).toBe(false);
    });
  });

  it("defaults omitted dailyTime and tz to 08:00 Asia/Shanghai", async () => {
    actorState.current = ACTOR;
    await withStore(async ({ storePath }) => {
      await executeAdd({
        action: "create",
        name: "默认早报",
        message: "每天早上汇总。",
      });
      const stored = await loadCronStore(storePath);
      expect(stored.jobs[0]?.schedule).toEqual(DAILY_EIGHT);
    });
  });

  it("lets expr replace dailyTime and pins a collaboration chat to the group surface", async () => {
    actorState.current = ACTOR;
    await withStore(async ({ storePath }) => {
      await executeAdd(
        {
          action: "add",
          name: "周一早报",
          message: "只在周一早上发到群里。",
          dailyTime: "08:00",
          expr: "15 9 * * 1",
          tz: "Asia/Shanghai",
        },
        {
          agentSessionKey: "space:grp-1",
          requesterAgentIdOverride: "skill-incubator",
        },
      );
      const stored = await loadCronStore(storePath);
      const job = stored.jobs[0];
      expect(job.schedule).toEqual({ kind: "cron", expr: "15 9 * * 1", tz: "Asia/Shanghai" });
      expect(job.schedule).not.toHaveProperty("staggerMs");
      expect(job.sessionKey).toBe("space:grp-1");
      expect(job.agentId).toBe("skill-incubator");
      expect(job.delivery).toEqual({ mode: "none", surfaces: ["workbench-collab-group"] });
    });
  });

  it("does not write the store when the gateway cron port is not registered", async () => {
    actorState.current = ACTOR;
    await withStore(async ({ storePath }) => {
      registerScheduledTaskCronPort(null);
      const tool = ownerTool();
      await expect(
        tool.execute("call-1", {
          action: "add",
          name: "不应写入",
          message: "调度器没起来。",
          dailyTime: "08:00",
          tz: "Asia/Shanghai",
        }),
      ).rejects.toThrow(/openbot cron/);
      const stored = await loadCronStore(storePath);
      expect(stored.jobs).toEqual([]);
    });
  });
});

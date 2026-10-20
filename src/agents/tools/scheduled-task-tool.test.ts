import { afterEach, describe, expect, it, vi } from "vitest";
import type { CronJobCreate } from "../../cron/types.js";
import type { EmployeeWorkbenchActor } from "../../gateway/employee-workbench-scope.js";
import { isToolAllowedByPolicyName, resolveSubagentToolPolicy } from "../pi-tools.policy.js";
import { isToolAllowed, resolveSandboxToolPolicyForAgent } from "../sandbox/tool-policy.js";
import { applyOwnerOnlyToolPolicy, resolveToolProfilePolicy } from "../tool-policy.js";
import type { AnyAgentTool } from "./common.js";

const actorState = vi.hoisted(() => ({
  current: null as EmployeeWorkbenchActor | null,
}));

vi.mock("../../gateway/employee-workbench-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../gateway/employee-workbench-scope.js")>();
  return {
    ...actual,
    resolveEmployeeWorkbenchActor: vi.fn(async () => actorState.current),
  };
});

const { registerScheduledTaskCronPort } = await import("../../cron/owner-scheduled-task.js");
const { createScheduledTaskTool } = await import("./scheduled-task-tool.js");

const ACTOR: EmployeeWorkbenchActor = {
  userId: "user-1",
  userEmail: "owner@example.com",
  tenantId: "tenant-a",
  seatAgentIds: ["skill-incubator", "main"],
  seatSpaceIds: ["grp-1"],
};

const IDENTITY = {
  agentSessionKey: "agent:skill-incubator:main",
  requesterAgentIdOverride: "skill-incubator",
  gatewayClientUser: "owner@example.com",
  gatewayClientSessionDomain: "employee" as const,
  gatewayClientPlatformUserId: "user-1",
  gatewayClientSessionEnterpriseId: "tenant-a",
};

const ADD_ARGS = {
  action: "add",
  name: "未读邮件摘要",
  message: "汇总未读邮件。",
  dailyTime: "08:00",
  tz: "Asia/Shanghai",
};

function toolFor(
  overrides?: Partial<typeof IDENTITY> & {
    gatewayClientUser?: string;
    gatewayClientPlatformUserId?: string;
  },
) {
  const tool = createScheduledTaskTool({ ...IDENTITY, ...overrides });
  if (!tool.execute) {
    throw new Error("scheduled_task has no execute");
  }
  return tool;
}

describe("scheduled_task tool", () => {
  afterEach(() => {
    registerScheduledTaskCronPort(null);
    actorState.current = null;
  });

  it("stays visible in the sandbox and coding/messaging profiles, and to non-owner senders", () => {
    const sandbox = resolveSandboxToolPolicyForAgent(undefined, "skill-incubator");
    const policy = { allow: sandbox.allow, deny: sandbox.deny };
    expect(isToolAllowed(policy, "scheduled_task")).toBe(true);
    expect(isToolAllowed(policy, "cron")).toBe(false);
    expect(resolveToolProfilePolicy("coding")?.allow).toContain("scheduled_task");
    expect(resolveToolProfilePolicy("messaging")?.allow).toContain("scheduled_task");
    expect(isToolAllowedByPolicyName("scheduled_task", resolveSubagentToolPolicy())).toBe(false);

    const scheduled = createScheduledTaskTool(IDENTITY);
    const cron = {
      name: "cron",
      ownerOnly: true,
      execute: async () => ({ content: [], details: {} }),
    } as unknown as AnyAgentTool;
    const filtered = applyOwnerOnlyToolPolicy([scheduled, cron], false);
    expect(filtered.map((entry) => entry.name)).toEqual(["scheduled_task"]);
    expect(scheduled.description).toContain("openbot cron");
    expect(scheduled.description).toContain("HEARTBEAT.md");
  });

  it("refuses when the caller is not a signed-in owner", async () => {
    const add = vi.fn();
    registerScheduledTaskCronPort({ add });
    actorState.current = ACTOR;
    const anonymous = toolFor({
      gatewayClientUser: "",
      gatewayClientPlatformUserId: "",
    });
    await expect(anonymous.execute("call-1", ADD_ARGS)).rejects.toMatchObject({
      name: "ToolAuthorizationError",
      message: expect.stringContaining("signed-in owner"),
    });

    actorState.current = null;
    await expect(toolFor().execute("call-1", ADD_ARGS)).rejects.toMatchObject({
      name: "ToolAuthorizationError",
      message: expect.stringContaining("signed-in owner"),
    });
    expect(add).not.toHaveBeenCalled();
  });

  it("refuses another agent, an unowned agent, and another conversation", async () => {
    const add = vi.fn();
    registerScheduledTaskCronPort({ add });
    actorState.current = ACTOR;

    await expect(
      toolFor().execute("call-1", { ...ADD_ARGS, agentId: "other-bot" }),
    ).rejects.toThrow(/another agent/);
    await expect(
      toolFor({ requesterAgentIdOverride: "other-bot" }).execute("call-1", ADD_ARGS),
    ).rejects.toThrow(/another agent/);

    actorState.current = { ...ACTOR, seatAgentIds: ["main"] };
    await expect(toolFor().execute("call-1", ADD_ARGS)).rejects.toThrow(/for this agent/);

    actorState.current = ACTOR;
    await expect(
      toolFor().execute("call-1", {
        ...ADD_ARGS,
        sessionKey: "agent:other-bot:main",
      }),
    ).rejects.toThrow(/another conversation/);
    expect(add).not.toHaveBeenCalled();
  });

  it("tells the model not to shell out when the gateway scheduler is down", async () => {
    actorState.current = ACTOR;
    registerScheduledTaskCronPort(null);
    await expect(toolFor().execute("call-1", ADD_ARGS)).rejects.toThrow(
      /Do not shell out to `openbot cron`/,
    );
    await expect(toolFor().execute("call-1", ADD_ARGS)).rejects.toThrow(/HEARTBEAT\.md/);
  });

  it("returns the stored job shape from the cron port", async () => {
    actorState.current = ACTOR;
    const add = vi.fn(async (job: CronJobCreate) => ({
      ...job,
      id: "job-fixed",
      createdAtMs: 10,
      updatedAtMs: 10,
      state: { nextRunAtMs: 20 },
    }));
    registerScheduledTaskCronPort({ add });
    const result = await toolFor().execute("call-1", ADD_ARGS);
    const details = result.details as {
      ok: boolean;
      action: string;
      job: { id: string; schedule: unknown; ownership: unknown; delivery: unknown };
    };
    expect(details.ok).toBe(true);
    expect(details.action).toBe("add");
    expect(details.job.id).toBe("job-fixed");
    expect(details.job.schedule).toEqual({
      kind: "cron",
      expr: "0 8 * * *",
      tz: "Asia/Shanghai",
    });
    expect(details.job.ownership).toEqual({ ownerId: "user-1", tenantId: "tenant-a" });
    expect(details.job.delivery).toEqual({
      mode: "none",
      surfaces: ["workbench-agent-main"],
    });
    expect(add).toHaveBeenCalledTimes(1);
  });
});

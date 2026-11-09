import { describe, expect, it, vi } from "vitest";
import { commitAutomaticPark } from "../../conversation-task/session-task-board.js";
import type { CronJob } from "../types.js";
vi.mock("../../conversation-task/session-task-board.js", async (original) => ({
  ...(await original<typeof import("../../conversation-task/session-task-board.js")>()),
  commitAutomaticPark: vi.fn(),
}));
import {
  formatCronResultSurfaceMessage,
  resolveCronSurfaceSessionKey,
  surfaceCronJobResult,
} from "./result-surfacing.js";

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn().mockResolvedValue({ ok: true }),
}));

const { callGateway } = await import("../../gateway/call.js");

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    name: "系统skill应用分析",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "cron", expr: "15 16 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "analyze" },
    agentId: "bot-2",
    delivery: { mode: "none", surfaces: ["workbench-agent-main"] },
    ...overrides,
  };
}

describe("formatCronResultSurfaceMessage", () => {
  it("includes status and summary", () => {
    const text = formatCronResultSurfaceMessage({
      job: makeJob(),
      status: "ok",
      summary: "共 12 个 Skill",
      durationMs: 65_000,
    });
    expect(text).toContain("系统skill应用分析");
    expect(text).toContain("✅ 成功");
    expect(text).toContain("共 12 个 Skill");
    expect(text).toContain("1 分 5 秒");
    expect(text).toContain("## 任务摘要");
    expect(text).toContain("## 任务成果");
  });

  it("shows agent summary when only delivery failed", () => {
    const text = formatCronResultSurfaceMessage({
      job: makeJob(),
      status: "error",
      error: "⚠️ ✉️ Message failed",
      summary: "报告已生成：共 65 个 Skill。".repeat(3),
      durationMs: 152_000,
    });
    expect(text).toContain("✅ 执行成功（外部通知未送达）");
    expect(text).toContain("报告已生成");
    expect(text).toContain("## 任务成果");
    expect(text).not.toContain("**摘要**\n⚠️");
  });
});

describe("resolveCronSurfaceSessionKey", () => {
  it("resolves agent main session", () => {
    expect(
      resolveCronSurfaceSessionKey({
        cfg: { session: { mainKey: "main" } },
        job: makeJob(),
        agentId: "bot-2",
        surface: "workbench-agent-main",
      }),
    ).toBe("agent:bot-2:main");
  });

  it("resolves employee steward main session from cron ownership", () => {
    expect(
      resolveCronSurfaceSessionKey({
        cfg: { session: { mainKey: "main" } },
        job: makeJob({
          ownership: { tenantId: "001", ownerId: "user-elle" },
        }),
        agentId: "main",
        surface: "workbench-agent-main",
      }),
    ).toBe("agent:main:employee:user-elle");
  });

  it("uses job.sessionKey for collaboration surface", () => {
    expect(
      resolveCronSurfaceSessionKey({
        cfg: { session: { mainKey: "main" } },
        job: makeJob({
          sessionKey: "agent:bot-2:main:space:space-a",
        }),
        agentId: "bot-2",
        surface: "workbench-collab-group",
      }),
    ).toBe("agent:bot-2:main:space:space-a");
  });
});

describe("surfaceCronJobResult", () => {
  it("injects result into workbench session via chat.inject", async () => {
    vi.mocked(callGateway).mockClear();
    const surfaced = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: makeJob(),
      agentId: "bot-2",
      result: { status: "ok", summary: "完成" },
      durationMs: 1000,
    });
    expect(surfaced).toEqual(["agent:bot-2:main"]);
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "chat.inject",
        params: expect.objectContaining({
          sessionKey: "agent:bot-2:main",
          label: expect.stringContaining("定时任务"),
          cronJobId: "job-1",
        }),
      }),
    );
  });

  it("injects a parked notice, not the full result, when FOCUS is occupied (EA-B4)", async () => {
    vi.mocked(callGateway).mockClear();
    vi.mocked(commitAutomaticPark).mockClear();
    const nowMs = Date.now();
    const surfaced = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: makeJob(),
      agentId: "bot-2",
      result: { status: "ok", summary: "完成" },
      durationMs: 1000,
      nowMs,
      lastUserAtMs: nowMs - 60_000,
    });
    expect(surfaced).toEqual(["agent:bot-2:main"]);
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "chat.inject",
        params: expect.objectContaining({
          sessionKey: "agent:bot-2:main",
          cronJobId: "job-1",
          cronResultKind: "parked_notice",
          message: expect.stringContaining("[CRON_PARKED_NOTICE]"),
        }),
      }),
    );
    const injected = vi.mocked(callGateway).mock.calls[0]?.[0] as {
      params?: { message?: string };
    };
    expect(injected?.params?.message).not.toContain("## 任务成果");
    expect(commitAutomaticPark).not.toHaveBeenCalled();
    expect(injected?.params?.message).not.toContain("结果已挂起");
    expect(injected?.params?.message).toContain("未新增或调整个人待办");
  });

  // Regression: the inject runs over a loopback CLI/operator socket that carries no
  // user, so under shared tenant addressing the handler had no identity to resolve a
  // tenant from and failed closed. Production symptom, every run of 11 of 15 jobs:
  //   cron: workbench result surface inject failed (... sessionKey=agent:main:employee:<uuid>,
  //   err=TenantContextError: tenant context required but the session has none:
  //   code=unresolved_tenant)
  it("hands the job owner to chat.inject so the tenant store can be resolved", async () => {
    vi.mocked(callGateway).mockClear();
    const surfaced = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: makeJob({
        agentId: "main",
        ownership: { tenantId: "001", ownerId: "user-elle" },
      }),
      agentId: "main",
      result: { status: "ok", summary: "完成" },
      durationMs: 1000,
    });
    expect(surfaced).toEqual(["agent:main:employee:user-elle"]);
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "chat.inject",
        params: expect.objectContaining({
          sessionKey: "agent:main:employee:user-elle",
          // The same owner id that built the session key must also travel as the
          // owner hint, otherwise the handler cannot derive the tenant.
          sessionOwnerPlatformUserId: "user-elle",
        }),
      }),
    );
  });

  it("omits the owner hint for a platform-global job that has no ownership", async () => {
    vi.mocked(callGateway).mockClear();
    await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: makeJob(),
      agentId: "bot-2",
      result: { status: "ok", summary: "完成" },
      durationMs: 1000,
    });
    const injected = vi.mocked(callGateway).mock.calls[0]?.[0] as {
      params?: Record<string, unknown>;
    };
    expect(injected?.params).not.toHaveProperty("sessionOwnerPlatformUserId");
  });
});

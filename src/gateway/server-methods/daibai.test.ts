import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStewardMemory } from "../../support-cases/steward-memory-store.js";
import { daibaiHandlers } from "./daibai.js";
import { supportCasesHandlers } from "./support-cases.js";

let stateDir: string;
let envSnapshot: string | undefined;

beforeEach(async () => {
  envSnapshot = process.env.OPENCLAW_STATE_DIR;
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-daibai-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(async () => {
  if (envSnapshot === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = envSnapshot;
  }
  // Allow fire-and-forget steward memory write-back to settle before cleanup.
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("user.daibai handlers", () => {
  it("blocks execute when the client lacks the required write scope (escalation guidance)", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "support.case.create",
        payload: { userProblem: "x" },
      },
      respond: respond as never,
      context: {} as never,
      // Read-only client: has connect params but only operator.read.
      client: { connect: { scopes: ["operator.read"] } } as never,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as { status: string; message: string };
    expect(payload.status).toBe("blocked");
    expect(payload.message).toContain("升级");
  });

  it("blocks robot-skills when the target agent is not manageable (ownership preflight)", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        actionId: "robot-skills.toggle",
        payload: { agentId: "some-other-agent", skillId: "s1", enabled: true },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as { status: string; message: string };
    expect(payload.status).toBe("blocked");
    expect(payload.message).toContain("可管理");
  });

  it("returns pending_confirmation on first call for a confirm-required action", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        // "main" is the default/manageable agent in an empty test config.
        actionId: "robot-skills.toggle",
        payload: { agentId: "main", skillId: "s1", enabled: true },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as {
      status: string;
      confirmation?: { proposalId: string; confirmationToken: string };
      confirmationDetail?: {
        title: string;
        impact?: string;
        irreversible: boolean;
        expiresAtMs: number;
      };
    };
    expect(payload.status).toBe("pending_confirmation");
    expect(payload.confirmation?.proposalId).toMatch(/^dbc_/);
    expect(payload.confirmation?.confirmationToken).toBeTruthy();
    // 8.4: confirmation card detail surfaced (title/impact/irreversible/expiry).
    expect(payload.confirmationDetail?.title).toBe("启停机器人技能");
    expect(payload.confirmationDetail?.impact).toBeTruthy();
    expect(payload.confirmationDetail?.irreversible).toBe(false);
    expect(payload.confirmationDetail?.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("marks irreversible actions in the confirmation detail (robot-skills.remove)", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        actionId: "robot-skills.remove",
        payload: { agentId: "main", skillId: "s1" },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as {
      status: string;
      confirmationDetail?: { irreversible: boolean };
    };
    expect(payload.status).toBe("pending_confirmation");
    expect(payload.confirmationDetail?.irreversible).toBe(true);
  });

  it("blocks a second call carrying an invalid confirmation ticket", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        actionId: "robot-skills.toggle",
        payload: { agentId: "main", skillId: "s1", enabled: true },
        proposalId: "dbc_does-not-exist",
        confirmationToken: "bogus",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as { status: string };
    expect(payload.status).toBe("blocked");
  });

  it("surfaces usage:budget as the secondary-permission hint for budget.set (confirm-required)", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        actionId: "budget.set",
        payload: { monthlyLimitCents: 100000 },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as {
      status: string;
      confirmationDetail?: { secondaryPermission?: string; irreversible: boolean };
    };
    expect(payload.status).toBe("pending_confirmation");
    expect(payload.confirmationDetail?.secondaryPermission).toBe("usage:budget");
    expect(payload.confirmationDetail?.irreversible).toBe(false);
  });

  it("returns support-aware ask suggestions", async () => {
    const respond = vi.fn();

    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        message: "我想反馈一个新的 skill 需求",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      summary: "",
      suggestedActions: [
        expect.objectContaining({
          actionId: "support.case.create",
        }),
      ],
    });
  });

  it("can close a support case through daibai.execute", async () => {
    const createRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "support.case.create",
        payload: { userProblem: "请帮我建一个待关闭的支持单" },
      },
      respond: createRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const created = createRespond.mock.calls.at(-1)?.[1] as { caseId?: string };
    expect(created.caseId).toBeTruthy();

    const closeRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "support.case.close",
        payload: { caseId: created.caseId },
      },
      respond: closeRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(closeRespond.mock.calls.at(-1)?.[1]).toMatchObject({
      actionId: "support.case.close",
      status: "executed",
      caseId: created.caseId,
      supportCase: expect.objectContaining({ status: "closed" }),
    });
  });

  it("returns no canned summary or forced support chip for casual chat", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "agent:main:employee:user-1",
        message: "今天是星期几",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as {
      summary?: string;
      suggestedActions?: Array<{ actionId: string }>;
      guide?: unknown;
      route?: unknown;
      workspaceOverview?: unknown;
    };
    expect(payload.summary).toBe("");
    expect(payload.workspaceOverview).toBeUndefined();
    expect(payload.guide).toBeUndefined();
    expect(payload.route).toBeUndefined();
    expect(payload.suggestedActions ?? []).toEqual([]);
  });

  it("does not recite workspace inventory for greetings like 早上好", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "agent:main:employee:user-1",
        message: "早上好",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as {
      summary?: string;
      workspaceOverview?: unknown;
    };
    expect(payload.summary).not.toContain("当前可见");
    expect(payload.summary).toContain("大白");
    expect(payload.workspaceOverview).toBeUndefined();
  });

  it("returns supervisor task suggestions for development requests when supervisor is enabled", async () => {
    const previous = process.env.OPENBOT_SUPERVISOR_ENABLED;
    process.env.OPENBOT_SUPERVISOR_ENABLED = "1";
    const respond = vi.fn();
    try {
      await daibaiHandlers["user.daibai.ask"]({
        req: {} as never,
        params: {
          userId: "user-1",
          tenantId: "tenant-1",
          sessionKey: "agent:main:employee:user-1",
          message: "用 codex 优化开发监督 Tab 的 UI，并跑测试",
        },
        respond: respond as never,
        context: {} as never,
        client: null,
        isWebchatConnect: () => false,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_SUPERVISOR_ENABLED;
      } else {
        process.env.OPENBOT_SUPERVISOR_ENABLED = previous;
      }
    }

    const payload = respond.mock.calls.at(-1)?.[1] as {
      summary?: string;
      suggestedActions?: Array<{
        actionId: string;
        payload?: Record<string, unknown>;
      }>;
    };
    const action = payload.suggestedActions?.find(
      (entry) => entry.actionId === "supervisor.task.create",
    );
    expect(action).toBeTruthy();
    expect(action?.payload).toMatchObject({
      goal: expect.stringContaining("开发监督 Tab"),
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(action?.payload?.repoRoot).toEqual(expect.any(String));
    expect(action?.payload?.workerBackendId).toEqual(expect.any(String));
    expect(action?.payload?.templateId).toEqual(expect.any(String));
  });

  it("returns onboarding presentation without support escalation noise", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        message:
          "请你以新用户引导员的身份，用对话方式给我一个简洁的首次登录操作指南，并说明接下来你还能继续代办什么。",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const payload = respond.mock.calls.at(-1)?.[1] as {
      summary?: string;
      presentation?: string;
      rationale?: string;
      supportContext?: unknown;
      suggestedActions: Array<{ actionId: string }>;
      route?: { escalationDraft?: unknown };
    };
    expect(payload.presentation).toBe("onboarding");
    expect(payload.rationale).toBeUndefined();
    expect(payload.supportContext).toBeUndefined();
    expect(payload.suggestedActions).toEqual([]);
    expect(payload.route?.escalationDraft).toBeUndefined();
    expect(payload.summary).toContain("数字员工团队");
    expect(payload.summary).not.toMatch(/欢迎入驻\s*openbot/i);
  });

  it("does not record the onboarding guide话术 into steward memory (no intent pollution)", async () => {
    const respond = vi.fn();
    const onboardingPrompt =
      "请你以新用户引导员的身份，用对话方式给我一个简洁的首次登录操作指南，并说明接下来你还能继续代办什么。";
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-mem-1",
        tenantId: "tenant-mem-1",
        sessionKey: "main",
        message: onboardingPrompt,
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    // Allow the fire-and-forget write-back to settle, then assert nothing leaked.
    await new Promise((r) => setTimeout(r, 60));
    const memory = await loadStewardMemory({ userId: "user-mem-1", tenantId: "tenant-mem-1" });
    expect(memory.lastIntents.some((entry) => entry.summary === onboardingPrompt)).toBe(false);
  });

  it("records genuine user questions into steward memory", async () => {
    const respond = vi.fn();
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-mem-2",
        tenantId: "tenant-mem-2",
        sessionKey: "main",
        message: "导出报表一直失败",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    await new Promise((r) => setTimeout(r, 60));
    const memory = await loadStewardMemory({ userId: "user-mem-2", tenantId: "tenant-mem-2" });
    expect(memory.lastIntents.some((entry) => entry.summary === "导出报表一直失败")).toBe(true);
  });

  it("creates and advances support cases through daibai.execute", async () => {
    const respond = vi.fn();

    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "support.case.create",
        payload: {
          userProblem: "创建 skill 时不知道 schema 应该怎么写",
        },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const createPayload = respond.mock.calls.at(-1)?.[1] as { caseId: string };
    expect(createPayload.caseId).toMatch(/^sc_/);

    await supportCasesHandlers["support.cases.resolve"]({
      req: {} as never,
      params: {
        caseId: createPayload.caseId,
        proposal: {
          proposalVersion: 1,
          userFacingReply: "请先确认 skill 触发词和输入 schema。",
          recommendedActionId: "support.case.apply_resolution",
          requiresUserConfirmation: true,
          updatedAtMs: Date.now(),
        },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        message: "请继续帮我跟进",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      supportContext: expect.objectContaining({
        openCaseCount: 1,
        latestCase: expect.objectContaining({
          caseId: createPayload.caseId,
          status: "resolved",
        }),
      }),
      latestProposal: expect.objectContaining({
        caseId: createPayload.caseId,
        proposalVersion: 1,
        userFacingReply: "请先确认 skill 触发词和输入 schema。",
        requiresUserConfirmation: true,
        seenByUser: false,
      }),
      suggestedActions: [
        expect.objectContaining({
          actionId: "support.case.reply_user",
          payload: expect.objectContaining({
            caseId: createPayload.caseId,
            proposalVersion: 1,
          }),
        }),
      ],
    });

    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "support.case.reply_user",
        payload: {
          caseId: createPayload.caseId,
          proposalVersion: 1,
        },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      actionId: "support.case.reply_user",
      supportCase: expect.objectContaining({
        status: "waiting_user",
        proposalSeenByUserVersion: 1,
      }),
    });

    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        message: "请继续帮我跟进",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      supportContext: expect.objectContaining({
        openCaseCount: 1,
        waitingOnUserCount: 1,
        latestCase: expect.objectContaining({
          caseId: createPayload.caseId,
          status: "waiting_user",
        }),
      }),
      latestProposal: expect.objectContaining({
        caseId: createPayload.caseId,
        proposalVersion: 1,
        userFacingReply: "请先确认 skill 触发词和输入 schema。",
        requiresUserConfirmation: true,
        seenByUser: true,
      }),
      suggestedActions: [
        expect.objectContaining({
          actionId: "support.case.apply_resolution",
          payload: expect.objectContaining({
            caseId: createPayload.caseId,
          }),
        }),
      ],
    });

    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "support.case.apply_resolution",
        payload: {
          caseId: createPayload.caseId,
        },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      actionId: "support.case.apply_resolution",
      status: "executed",
      supportCase: expect.objectContaining({
        status: "closed",
      }),
    });

    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        message: "请继续帮我跟进",
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      summary: "",
      suggestedActions: [],
    });
    expect(respond.mock.calls.at(-1)?.[1]?.supportContext).toBeUndefined();
    expect(respond.mock.calls.at(-1)?.[1]?.latestProposal).toBeUndefined();
  });

  it("requires confirmation then writes schedule.entry.add to the schedule store", async () => {
    const pendingRespond = vi.fn();
    const startAtMs = Date.UTC(2026, 6, 3, 7, 0, 0);
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "schedule.entry.add",
        payload: {
          title: "产品评审",
          startAtMs,
          kind: "personal",
        },
      },
      respond: pendingRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const pending = pendingRespond.mock.calls.at(-1)?.[1] as {
      status: string;
      confirmation?: { proposalId: string; confirmationToken: string };
      confirmationDetail?: { title?: string; impact?: string };
    };
    expect(pending.status).toBe("pending_confirmation");
    expect(pending.confirmationDetail?.title).toBe("添加日程");
    expect(pending.confirmation?.proposalId).toBeTruthy();
    expect(pending.confirmation?.confirmationToken).toBeTruthy();

    const confirmRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        actionId: "schedule.entry.add",
        payload: {
          title: "产品评审",
          startAtMs,
          kind: "personal",
        },
        proposalId: pending.confirmation!.proposalId,
        confirmationToken: pending.confirmation!.confirmationToken,
      },
      respond: confirmRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(confirmRespond.mock.calls.at(-1)?.[1]).toMatchObject({
      actionId: "schedule.entry.add",
      status: "executed",
      message: expect.stringContaining("产品评审"),
    });
  });
});

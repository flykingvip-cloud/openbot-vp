/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import {
  askDaibai,
  clearDaibaiAskResultOnChatSend,
  executeDaibaiAction,
  maybeRefreshDaibaiSuggestionsOnChatFinal,
  resolveDaibaiIdentity,
  shouldAutoAskDaibai,
  type DaibaiState,
} from "./daibai.ts";

function createHost(overrides: Partial<DaibaiState> = {}) {
  const request = vi.fn();
  const host: DaibaiState = {
    client: {
      request,
    } as never,
    connected: true,
    hello: {
      auth: {
        provider: "trusted-proxy",
        user: "alice@example.com",
        tenantId: "acme",
      },
    } as never,
    platformAuthState: null,
    bootstrapAuthSession: null,
    sessionKey: "main",
    daibaiSourceSessionKey: null,
    chatMessage: "",
    daibaiLastMessage: null,
    daibaiLoading: false,
    daibaiError: null,
    daibaiAskResult: null,
    daibaiExecuteResult: null,
    daibaiActionLoading: false,
    daibaiActionPendingId: null,
    daibaiActionError: null,
    daibaiPendingConfirmation: null,
    ...overrides,
  };
  return { host, request };
}

describe("daibai controller", () => {
  it("auto-asks only when Daibai is the active assistant entry and chat is empty", () => {
    expect(
      shouldAutoAskDaibai({
        connected: true,
        tab: "me",
        workbenchPrimaryModule: "assistant",
        workbenchTeamSelectedKey: "main",
        sessionKey: "main",
        hello: null,
        platformAuthState: null,
        bootstrapAuthSession: null,
        daibaiLoading: false,
        daibaiAskResult: null,
        daibaiError: null,
        chatMessages: [],
      }),
    ).toBe(true);
    expect(
      shouldAutoAskDaibai({
        connected: true,
        tab: "me",
        workbenchPrimaryModule: "assistant",
        workbenchTeamSelectedKey: "main",
        sessionKey: "main",
        hello: null,
        platformAuthState: null,
        bootstrapAuthSession: null,
        daibaiLoading: false,
        daibaiAskResult: null,
        daibaiError: null,
        chatMessages: [{ role: "user", content: "你好" }],
      }),
    ).toBe(false);
    expect(
      shouldAutoAskDaibai({
        connected: true,
        tab: "me",
        workbenchPrimaryModule: "collaboration",
        workbenchTeamSelectedKey: "space:product",
        sessionKey: "space:product",
        daibaiLoading: false,
        hello: null,
        platformAuthState: null,
        bootstrapAuthSession: null,
        daibaiAskResult: null,
        daibaiError: null,
      }),
    ).toBe(false);
  });

  it("preserves prior chip state when starting a new ask refresh", async () => {
    const { host, request } = createHost({
      daibaiAskResult: {
        summary: "",
        suggestedActions: [{ actionId: "support.case.create", label: "x", description: "y" }],
      } as never,
      chatMessage: "新需求",
    });
    request.mockResolvedValueOnce({
      summary: "",
      suggestedActions: [],
    } as never);

    await askDaibai(host, "新需求");

    expect(host.daibaiLastMessage).toBe("新需求");
    expect(host.chatMessage).toBe("");
    expect(host.daibaiAskResult?.suggestedActions).toEqual([]);
  });

  it("surfaces error when a second ask arrives while loading", async () => {
    const { host, request } = createHost();
    let resolveFirst: (value: unknown) => void = () => {};
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const first = askDaibai(host, "第一条");
    await Promise.resolve();
    await askDaibai(host, "第二条");

    expect(host.daibaiError).toContain("仍在处理中");
    resolveFirst({
      summary: "第一条完成",
      suggestedActions: [],
    });
    await first;
  });

  it("requests user.daibai.ask with resolved user identity", async () => {
    const { host, request } = createHost();
    request.mockResolvedValueOnce({
      summary: "",
      suggestedActions: [],
    } as never);

    await askDaibai(host, "请帮我检查 skill 创建问题");

    expect(request).toHaveBeenCalledWith("user.daibai.ask", {
      userId: "alice@example.com",
      tenantId: "acme",
      sessionKey: "main",
      message: "请帮我检查 skill 创建问题",
    });
    expect(host.daibaiAskResult?.summary).toBe("");
    expect(host.daibaiLastMessage).toBe("请帮我检查 skill 创建问题");
  });

  it("prefers employeeUserId over login email for daibai identity", () => {
    const identity = resolveDaibaiIdentity({
      hello: null,
      platformAuthState: {
        session: { user: "ceo@example.com", tenantId: "tenant-a" },
        employeeAccess: { employeeUserId: "emp-uuid-42", agentIds: [] },
      } as never,
      bootstrapAuthSession: null,
    });
    expect(identity).toEqual({
      userId: "emp-uuid-42",
      tenantId: "tenant-a",
    });
  });

  it("falls back to employeeUserId when trusted session has no email", async () => {
    const { host, request } = createHost({
      hello: null,
      platformAuthState: {
        session: { tenantId: "tenant-a" },
        employeeAccess: { employeeUserId: "emp-uuid-42", agentIds: [] },
      } as never,
    });
    request.mockResolvedValueOnce({
      summary: "ok",
      suggestedActions: [],
    } as never);

    await askDaibai(host, "创建开发监督任务");

    expect(request).toHaveBeenCalledWith("user.daibai.ask", {
      userId: "emp-uuid-42",
      tenantId: "tenant-a",
      sessionKey: "main",
      message: "创建开发监督任务",
    });
  });

  it("treats employee-remapped steward sessionKey as same surface on chat.final refresh", async () => {
    const { host, request } = createHost({
      sessionKey: "main",
      chatMessages: [{ role: "user", content: "早上好" }],
      tab: "me",
      workbenchPrimaryModule: "assistant",
      workbenchTeamSelectedKey: "main",
      hello: {
        auth: {
          provider: "trusted-proxy",
          user: "alice@example.com",
          tenantId: "acme",
        },
        snapshot: {
          sessionDefaults: {
            mainSessionKey: "agent:main:employee:alice",
          },
        },
      },
    } as never);
    request.mockResolvedValueOnce({
      summary: "你好，我是大白。有什么可以帮你的？",
      suggestedActions: [],
    } as never);

    await maybeRefreshDaibaiSuggestionsOnChatFinal(host as never, {
      sessionKey: "agent:main:employee:alice",
    });

    expect(request).toHaveBeenCalledWith(
      "user.daibai.ask",
      expect.objectContaining({ message: "早上好" }),
    );
    expect(host.daibaiAskResult?.summary).toContain("大白");
  });

  it("clears stale ask prelude when a real chat send starts", () => {
    const { host } = createHost({
      daibaiAskResult: {
        summary: "当前可见 4 个机器人、4 个协作群。",
        suggestedActions: [],
      } as never,
    });
    clearDaibaiAskResultOnChatSend(host);
    expect(host.daibaiAskResult).toBeNull();
  });

  it("executes support.case.create and refreshes the ask result", async () => {
    const { host, request } = createHost({
      chatMessage: "我想提一个新的 skill 需求",
      daibaiLastMessage: "我想提一个新的 skill 需求",
    });
    request
      .mockResolvedValueOnce({
        actionId: "support.case.create",
        status: "executed",
        message: "我已经帮你创建支持单。",
        caseId: "sc_1",
      } as never)
      .mockResolvedValueOnce({
        summary: "",
        suggestedActions: [],
      } as never);

    await executeDaibaiAction(host, "support.case.create");

    expect(request).toHaveBeenNthCalledWith(1, "user.daibai.execute", {
      userId: "alice@example.com",
      tenantId: "acme",
      sessionKey: "main",
      actionId: "support.case.create",
      payload: {
        sourceSessionKey: "main",
        userProblem: "我想提一个新的 skill 需求",
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, "user.daibai.ask", {
      userId: "alice@example.com",
      tenantId: "acme",
      sessionKey: "main",
      message: "我想提一个新的 skill 需求",
    });
    expect(host.daibaiExecuteResult?.caseId).toBe("sc_1");
    expect(host.daibaiAskResult?.summary).toBe("");
  });
});

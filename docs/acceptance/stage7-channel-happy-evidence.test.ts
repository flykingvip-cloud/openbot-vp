/**
 * Stage 7 WeCom / Feishu / DingTalk happy/observable probes (CONDITIONAL vs §5.7).
 *
 * Proven (narrow): in-process plugin inbound + mocked dispatch/outbound routing
 * to agentId=main. Explicitly NOT Gateway WS and NOT live IM cloud HTTP.
 * Ledger grades these paths CONDITIONAL against the original matrix proposition
 * (Gateway + channel reply). Live DingTalk sendText / Client credentials stay
 * NOT_RUN / NEEDS_LIVE_CHANNEL.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/feishu";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processDingtalkInbound } from "../../extensions/dingtalk/src/monitor.ts";
import { setDingtalkRuntime } from "../../extensions/dingtalk/src/runtime.js";
import type { ResolvedDingtalkAccount } from "../../extensions/dingtalk/src/types.ts";
import { handleFeishuMessage, type FeishuMessageEvent } from "../../extensions/feishu/src/bot.js";
import { setFeishuRuntime } from "../../extensions/feishu/src/runtime.js";
import { createPluginRuntimeMock } from "../../extensions/test-utils/plugin-runtime-mock.js";
import { processWecomInbound } from "../../extensions/wecom/src/monitor.ts";
import { setWecomRuntime } from "../../extensions/wecom/src/runtime.js";
import type { ResolvedWecomAccount } from "../../extensions/wecom/src/types.ts";

const {
  mockCreateFeishuReplyDispatcher,
  mockSendMessageFeishu,
  mockResolveAgentRoute,
  mockDispatchReplyFromConfig,
} = vi.hoisted(() => ({
  mockCreateFeishuReplyDispatcher: vi.fn(() => ({
    dispatcher: {
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => undefined),
    },
    replyOptions: {},
    markDispatchIdle: vi.fn(),
  })),
  mockSendMessageFeishu: vi.fn().mockResolvedValue({ messageId: "om_out", chatId: "oc-dm" }),
  mockResolveAgentRoute: vi.fn(() => ({
    agentId: "main",
    channel: "feishu",
    accountId: "default",
    sessionKey: "agent:main:feishu:dm:ou-stage7",
    mainSessionKey: "agent:main:main",
    matchedBy: "default",
  })),
  mockDispatchReplyFromConfig: vi
    .fn()
    .mockResolvedValue({ queuedFinal: true, counts: { final: 1 } }),
}));

vi.mock("../../extensions/feishu/src/reply-dispatcher.js", () => ({
  createFeishuReplyDispatcher: mockCreateFeishuReplyDispatcher,
}));

vi.mock("../../extensions/feishu/src/send.js", () => ({
  sendMessageFeishu: mockSendMessageFeishu,
  getMessageFeishu: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../extensions/feishu/src/client.js", () => ({
  createFeishuClient: vi.fn(() => ({
    contact: {
      user: {
        get: vi.fn().mockResolvedValue({ data: { user: { name: "Stage7 Sender" } } }),
      },
    },
  })),
}));

vi.mock("../../extensions/wecom/src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../extensions/wecom/src/api.js")>();
  return {
    ...actual,
    sendWecomTextMessage: vi.fn().mockResolvedValue({ errcode: 0 }),
  };
});

vi.mock("../../extensions/wecom/src/dispatch.runtime.js", () => ({
  dispatchInboundReplyWithBase: vi.fn(
    async (params: {
      route: { agentId?: string; sessionKey?: string };
      deliver: (payload: { text?: string }) => Promise<void>;
    }) => {
      expect(params.route.agentId).toBe("main");
      await params.deliver({ text: "stage7-wecom-reply" });
    },
  ),
}));

vi.mock("../../extensions/dingtalk/src/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../extensions/dingtalk/src/api.js")>();
  return {
    ...actual,
    sendDingtalkMessage: vi.fn().mockResolvedValue({ messageId: "dt-stage7-out" }),
  };
});

vi.mock("../../extensions/dingtalk/src/dispatch.runtime.js", () => ({
  dispatchInboundReplyWithBase: vi.fn(
    async (params: {
      route: { agentId?: string; sessionKey?: string };
      deliver: (payload: { text?: string }) => Promise<void>;
    }) => {
      expect(params.route.agentId).toBe("main");
      await params.deliver({ text: "stage7-dingtalk-reply" });
    },
  ),
}));

describe("stage 7 Feishu happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgentRoute.mockReturnValue({
      agentId: "main",
      channel: "feishu",
      accountId: "default",
      sessionKey: "agent:main:feishu:dm:ou-stage7",
      mainSessionKey: "agent:main:main",
      matchedBy: "default",
    });
    setFeishuRuntime(
      createPluginRuntimeMock({
        channel: {
          routing: {
            resolveAgentRoute:
              mockResolveAgentRoute as unknown as PluginRuntime["channel"]["routing"]["resolveAgentRoute"],
          },
          reply: {
            resolveEnvelopeFormatOptions: vi.fn(() => ({})),
            formatAgentEnvelope: vi.fn((params: { body: string }) => params.body),
            finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
            dispatchReplyFromConfig: mockDispatchReplyFromConfig,
            withReplyDispatcher: vi.fn(
              async ({
                dispatcher,
                run,
                onSettled,
              }: Parameters<PluginRuntime["channel"]["reply"]["withReplyDispatcher"]>[0]) => {
                try {
                  return await run();
                } finally {
                  dispatcher.markComplete();
                  await dispatcher.waitForIdle();
                  await onSettled?.();
                }
              },
            ),
          },
          commands: {
            shouldComputeCommandAuthorized: vi.fn(() => false),
            resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
          },
          pairing: {
            readAllowFromStore: vi.fn().mockResolvedValue([]),
            upsertPairingRequest: vi.fn(),
            buildPairingReply: vi.fn(),
          },
          text: {
            hasControlCommand: vi.fn(() => false),
          },
        },
      }),
    );
  });

  it("routes an inbound Feishu DM to agent main and opens the reply dispatcher", async () => {
    const event: FeishuMessageEvent = {
      sender: {
        sender_id: { open_id: "ou-stage7" },
        sender_type: "user",
      },
      message: {
        message_id: "om_stage7_in",
        chat_id: "oc-dm",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello stage7" }),
      },
    };

    await handleFeishuMessage({
      cfg: {
        channels: {
          feishu: {
            appId: "cli_stage7",
            appSecret: "sec_stage7",
            dmPolicy: "open",
          },
        },
      } as never,
      event,
      runtime: {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn((code: number): never => {
          throw new Error(`exit ${code}`);
        }),
      } as never,
    });

    expect(mockResolveAgentRoute).toHaveBeenCalled();
    const route = mockResolveAgentRoute.mock.results[0]?.value as { agentId: string };
    expect(route.agentId).toBe("main");
    expect(mockCreateFeishuReplyDispatcher).toHaveBeenCalled();
    expect(mockDispatchReplyFromConfig).toHaveBeenCalled();
  });
});

describe("stage 7 WeCom happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWecomRuntime(
      createPluginRuntimeMock({
        channel: {
          commands: {
            shouldHandleTextCommands: vi.fn(() => false),
          },
          text: {
            hasControlCommand: vi.fn(() => false),
          },
          routing: {
            resolveAgentRoute: vi.fn(() => ({
              agentId: "main",
              channel: "wecom",
              accountId: "default",
              sessionKey: "agent:main:wecom:dm:sender-stage7",
              mainSessionKey: "agent:main:main",
              matchedBy: "default",
            })),
          },
          reply: {
            finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
          },
          pairing: {
            readAllowFromStore: vi.fn().mockResolvedValue([]),
            upsertPairingRequest: vi.fn(),
            buildPairingReply: vi.fn(),
          },
        },
      }) as never,
    );
  });

  it("routes an inbound WeCom text to agent main and delivers a channel reply", async () => {
    const { sendWecomTextMessage } = await import("../../extensions/wecom/src/api.js");
    const { dispatchInboundReplyWithBase } =
      await import("../../extensions/wecom/src/dispatch.runtime.js");

    const account = {
      accountId: "default",
      enabled: true,
      configured: true,
      config: { dm: { policy: "open" }, connectionMode: "callback" },
      connectionMode: "callback",
      corpId: "ww-stage7",
      agentId: 1000001,
      secret: "sec",
      token: "tok",
      encodingAesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    } satisfies ResolvedWecomAccount;

    await processWecomInbound({
      message: {
        msgType: "text",
        fromUserName: "sender-stage7",
        content: "hello wecom stage7",
        msgId: "msg-stage7",
        createTime: 1_710_000_000,
      },
      account,
      config: { channels: { wecom: account.config } } as never,
      runtime: { log: vi.fn(), error: vi.fn() },
    });

    expect(dispatchInboundReplyWithBase).toHaveBeenCalled();
    const call = vi.mocked(dispatchInboundReplyWithBase).mock.calls[0]?.[0] as {
      route: { agentId: string };
    };
    expect(call.route.agentId).toBe("main");
    expect(sendWecomTextMessage).toHaveBeenCalled();
    const sent = vi.mocked(sendWecomTextMessage).mock.calls[0]?.[0] as {
      to: string;
      text: string;
    };
    expect(sent.to).toBe("sender-stage7");
    expect(sent.text).toContain("stage7-wecom-reply");
  });
});

describe("stage 7 DingTalk happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDingtalkRuntime(
      createPluginRuntimeMock({
        channel: {
          commands: {
            shouldHandleTextCommands: vi.fn(() => false),
          },
          text: {
            hasControlCommand: vi.fn(() => false),
          },
          routing: {
            resolveAgentRoute: vi.fn(() => ({
              agentId: "main",
              channel: "dingtalk",
              accountId: "default",
              sessionKey: "agent:main:dingtalk:dm:sender-stage7-dt",
              mainSessionKey: "agent:main:main",
              matchedBy: "default",
            })),
          },
          reply: {
            finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
          },
          pairing: {
            readAllowFromStore: vi.fn().mockResolvedValue([]),
            upsertPairingRequest: vi.fn(),
            buildPairingReply: vi.fn(),
          },
        },
      }) as never,
    );
  });

  it("routes an inbound DingTalk text to agent main and delivers a channel reply", async () => {
    const { sendDingtalkMessage } = await import("../../extensions/dingtalk/src/api.js");
    const { dispatchInboundReplyWithBase } =
      await import("../../extensions/dingtalk/src/dispatch.runtime.js");

    const account = {
      accountId: "default",
      name: "stage7-dingtalk",
      enabled: true,
      configured: true,
      config: {
        clientId: "ding-stage7",
        clientSecret: "sec-stage7",
        dm: { policy: "open" },
        connectionMode: "stream",
      },
      clientId: "ding-stage7",
      clientSecret: "sec-stage7",
      connectionMode: "stream",
      robotCode: "ding-stage7",
    } satisfies ResolvedDingtalkAccount;

    await processDingtalkInbound({
      message: {
        msgtype: "text",
        text: { content: "hello dingtalk stage7" },
        msgId: "msg-stage7-dt",
        createAt: "1710000000000",
        conversationType: "1",
        conversationId: "cid-stage7",
        senderId: "sender-stage7-dt",
        senderNick: "Stage7 DT",
      },
      account,
      config: { channels: { dingtalk: account.config } } as never,
      runtime: { log: vi.fn(), error: vi.fn() },
    });

    expect(dispatchInboundReplyWithBase).toHaveBeenCalled();
    const call = vi.mocked(dispatchInboundReplyWithBase).mock.calls[0]?.[0] as {
      route: { agentId: string };
    };
    expect(call.route.agentId).toBe("main");
    expect(sendDingtalkMessage).toHaveBeenCalled();
    const sent = vi.mocked(sendDingtalkMessage).mock.calls[0]?.[0] as {
      to: string;
      text: string;
    };
    expect(sent.to).toBe("sender-stage7-dt");
    expect(sent.text).toContain("stage7-dingtalk-reply");
  });
});

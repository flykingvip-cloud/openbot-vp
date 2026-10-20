import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWechatTextMessage } from "./api.js";
import {
  resolveWechatGatewayWebhookListen,
  startWechatGatewayInboundWebhook,
  type WechatGatewayInboundServer,
} from "./inbound-webhook.js";
import {
  handleWechatPersonalInboundEvent,
  parseWechatInboundPayload,
  setWechatInboundDispatchForTest,
} from "./inbound.js";
import type { ResolvedWechatAccount } from "./types.js";
import {
  createFailClosedWechatPersonalWorker,
  createMemoryWechatPersonalWorker,
} from "./worker-contract.js";
import { resetWechatPersonalWorker, setWechatPersonalWorker } from "./worker.js";

const account: ResolvedWechatAccount = {
  accountId: "default",
  name: null,
  enabled: true,
  configured: true,
  config: { apiKey: "", proxyUrl: "" },
  apiKey: "",
  proxyUrl: "http://example.invalid:9",
  webhookHost: null,
  webhookPort: 18789,
  webhookPath: "/webhook/wechat",
  deviceType: "ipad",
};

describe("wechat personal inbound takeover", () => {
  let inboundServer: WechatGatewayInboundServer | null = null;

  afterEach(async () => {
    setWechatInboundDispatchForTest(null);
    resetWechatPersonalWorker();
    await inboundServer?.stop();
    inboundServer = null;
  });

  it("parses text DMs and skips group/media/fromSelf", () => {
    expect(
      parseWechatInboundPayload({
        msgType: "text",
        fromUser: "wxid_peer",
        content: "hello",
      }),
    ).toEqual({
      skip: false,
      fromUser: "wxid_peer",
      text: "hello",
      accountId: "default",
      msgId: undefined,
      nickname: undefined,
    });
    expect(
      parseWechatInboundPayload({
        msgType: "text",
        fromUser: "wxid_peer",
        content: "hi",
        isGroup: true,
      }),
    ).toEqual({ skip: true, reason: "group" });
    expect(
      parseWechatInboundPayload({
        msgType: "image",
        fromUser: "wxid_peer",
        fileUrl: "http://127.0.0.1/img",
      }),
    ).toEqual({ skip: true, reason: "media" });
    expect(
      parseWechatInboundPayload({
        msgType: "text",
        fromUser: "wxid_self",
        content: "echo",
        fromSelf: true,
      }),
    ).toEqual({ skip: true, reason: "fromSelf" });
  });

  it("dispatches inbound text with fromUser and text", async () => {
    const dispatch = vi.fn(async () => {});
    setWechatInboundDispatchForTest(dispatch);
    const result = await handleWechatPersonalInboundEvent({
      payloadJSON: JSON.stringify({
        msgType: "text",
        fromUser: "wxid_alice",
        content: "ping",
        accountId: "default",
      }),
    });
    expect(result).toEqual({ handled: true });
    expect(dispatch).toHaveBeenCalledWith({
      fromUser: "wxid_alice",
      text: "ping",
      accountId: "default",
      sessionKey: "wechat:default:wxid_alice",
    });
  });

  it("does not dispatch group, media, or fromSelf", async () => {
    const dispatch = vi.fn(async () => {});
    setWechatInboundDispatchForTest(dispatch);
    await expect(
      handleWechatPersonalInboundEvent({
        payload: { msgType: "text", fromUser: "wxid_g", content: "x", isGroup: true },
      }),
    ).resolves.toEqual({ handled: false, reason: "group" });
    await expect(
      handleWechatPersonalInboundEvent({
        payload: { msgType: "voice", fromUser: "wxid_g", content: "x" },
      }),
    ).resolves.toEqual({ handled: false, reason: "media" });
    await expect(
      handleWechatPersonalInboundEvent({
        payload: {
          msgType: "text",
          fromUser: "wxid_self",
          content: "mine",
          fromSelf: true,
        },
      }),
    ).resolves.toEqual({ handled: false, reason: "fromSelf" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("sendText uses the worker and never LIVE proxyUrl", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const worker = createMemoryWechatPersonalWorker({ wxid: "wxid_self" });
    worker.forceLogin("wxid_self");
    setWechatPersonalWorker(worker);
    const sent = await sendWechatTextMessage({ account, to: "wxid_peer", text: "hi" });
    expect(sent.messageId).toMatch(/^wechat-mem-/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("sendText is fail-closed without a worker even if proxyUrl is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setWechatPersonalWorker(createFailClosedWechatPersonalWorker());
    await expect(sendWechatTextMessage({ account, to: "wxid_peer", text: "hi" })).rejects.toThrow(
      /offline|unreachable/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("cloud Gateway webhook bind is null (no public or loopback bind)", () => {
    expect(resolveWechatGatewayWebhookListen({ allowLocalSidecar: false })).toBeNull();
    expect(resolveWechatGatewayWebhookListen({ allowLocalSidecar: true })?.host).toBe("127.0.0.1");
    expect(resolveWechatGatewayWebhookListen({ allowLocalSidecar: true })?.port).toBe(18789);
  });

  it("loopback webhook POST text DM hits test dispatch and binds 127.0.0.1 only", async () => {
    const dispatch = vi.fn(async () => {});
    setWechatInboundDispatchForTest(dispatch);
    inboundServer = await startWechatGatewayInboundWebhook({ port: 0 });
    expect(inboundServer.host).toBe("127.0.0.1");
    expect(inboundServer.host).not.toBe("0.0.0.0");
    const res = await fetch(`http://127.0.0.1:${inboundServer.port}/webhook/wechat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgType: "text",
        fromUser: "wxid_loop",
        content: "loop-hi",
      }),
    });
    expect(res.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      fromUser: "wxid_loop",
      text: "loop-hi",
      accountId: "default",
      sessionKey: "wechat:default:wxid_loop",
    });
  });
});

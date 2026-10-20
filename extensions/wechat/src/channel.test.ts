import { afterEach, describe, expect, it } from "vitest";
import { createStartAccountContext } from "../../test-utils/start-account-context.js";
import { probeWechat } from "./api.js";
import { wechatPlugin } from "./channel.js";
import { resolveWechatGatewayWebhookListen } from "./inbound-webhook.js";
import { startWechatLoginWithQr } from "./login-qr.js";
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
  proxyUrl: "",
  webhookHost: null,
  webhookPort: 18789,
  webhookPath: "/webhook/wechat",
  deviceType: "ipad",
};

describe("wechat personal channel QR/worker", () => {
  afterEach(() => {
    resetWechatPersonalWorker();
  });

  it("exposes loginWithQrStart/Wait and logoutAccount", () => {
    expect(typeof wechatPlugin.gateway?.loginWithQrStart).toBe("function");
    expect(typeof wechatPlugin.gateway?.loginWithQrWait).toBe("function");
    expect(typeof wechatPlugin.gateway?.logoutAccount).toBe("function");
  });

  it("probe is fail-closed when worker is unreachable", async () => {
    setWechatPersonalWorker(createFailClosedWechatPersonalWorker());
    const probe = await probeWechat(account);
    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/offline|unreachable/i);
  });

  it("loginWithQrStart is fail-closed without a worker", async () => {
    setWechatPersonalWorker(createFailClosedWechatPersonalWorker());
    const started = await startWechatLoginWithQr({});
    expect(started.qrDataUrl).toBeUndefined();
  });

  it("loginWithQrStart returns a QR when the local worker is online", async () => {
    setWechatPersonalWorker(createMemoryWechatPersonalWorker({ wxid: "wxid_channel" }));
    const started = await wechatPlugin.gateway?.loginWithQrStart?.({ accountId: "default" });
    expect(started?.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const waited = await wechatPlugin.gateway?.loginWithQrWait?.({ accountId: "default" });
    expect(waited?.connected).toBe(true);
  });

  it("startAccount is fail-closed without a worker", async () => {
    setWechatPersonalWorker(createFailClosedWechatPersonalWorker());
    const abort = new AbortController();
    await expect(
      wechatPlugin.gateway!.startAccount!(
        createStartAccountContext({ account, abortSignal: abort.signal }),
      ),
    ).rejects.toThrow(/offline|unreachable/i);
  });

  it("startAccount marks running when the worker is logged_in", async () => {
    const worker = createMemoryWechatPersonalWorker({ wxid: "wxid_channel" });
    worker.forceLogin("wxid_channel");
    setWechatPersonalWorker(worker);
    const abort = new AbortController();
    const patches: Array<{ running?: boolean }> = [];
    const task = wechatPlugin.gateway!.startAccount!(
      createStartAccountContext({
        account,
        abortSignal: abort.signal,
        statusPatchSink: (next) => patches.push({ running: next.running }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(patches).toContainEqual({ running: true });
    expect(resolveWechatGatewayWebhookListen({ allowLocalSidecar: false })).toBeNull();
    abort.abort();
    await task;
  });
});

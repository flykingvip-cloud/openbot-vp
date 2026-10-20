/**
 * Stage 7 probes that can run in-process.
 *
 * WeCom negative: wrong callback signature → 401, inbound not processed.
 * Feishu negative: webhook without verificationToken fails closed.
 * DingTalk negative: unconfiguredReason fails closed without network.
 * Doctor + onboard happy: legacy migration preview + enterprise IM onboarding
 * adapters appear on the product path when WeCom/Feishu/DingTalk plugins are
 * registered (real plugin.onboarding, not stubs).
 *
 * Happy-path channel replies (WeCom/Feishu) live in
 * stage7-channel-happy-evidence.test.ts. Devices and DingTalk network happy
 * paths stay NOT_RUN (no device / no Client credentials).
 */
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dingtalkPlugin } from "../../extensions/dingtalk/src/channel.ts";
import { feishuPlugin } from "../../extensions/feishu/src/channel.ts";
import { monitorSingleAccount } from "../../extensions/feishu/src/monitor.account.ts";
import { stopFeishuMonitor } from "../../extensions/feishu/src/monitor.ts";
import type { ResolvedFeishuAccount } from "../../extensions/feishu/src/types.ts";
import { wecomPlugin } from "../../extensions/wecom/src/channel.ts";
import type { ResolvedWecomAccount } from "../../extensions/wecom/src/types.ts";
import {
  computeWecomSignature,
  encryptWecomPayload,
  handleWecomWebhookRequest,
  registerWecomWebhookTarget,
} from "../../extensions/wecom/src/webhook.ts";
import { maybeRepairLegacyCronStore } from "../../src/commands/doctor-cron.ts";
import { listChannelOnboardingAdapters } from "../../src/commands/onboarding/registry.ts";
import { makeMockHttpResponse } from "../../src/gateway/test-http-response.ts";
import { detectLegacyStateMigrations } from "../../src/infra/state-migrations.ts";
import { setActivePluginRegistry } from "../../src/plugins/runtime.ts";
import { createTestRegistry } from "../../src/test-utils/channel-plugins.ts";

const encodingAesKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const corpId = "ww1234567890";

function postRequest(url: string, body: string): IncomingMessage {
  const stream = Readable.from([Buffer.from(body, "utf8")]) as IncomingMessage;
  stream.method = "POST";
  stream.url = url;
  stream.headers = { "content-length": String(Buffer.byteLength(body)) };
  return stream;
}

describe("stage 7 channel and doctor probes", () => {
  const emptyRegistry = createTestRegistry([]);

  beforeEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  afterEach(() => {
    stopFeishuMonitor();
    setActivePluginRegistry(emptyRegistry);
  });

  it("rejects a WeCom callback when the signature does not match", async () => {
    const token = "stage7-wecom-token";
    const timestamp = "1710000000";
    const nonce = "stage7nonce";
    const plain =
      "<xml><MsgType><![CDATA[text]]></MsgType><FromUserName><![CDATA[sender-1]]></FromUserName><Content><![CDATA[hello]]></Content></xml>";
    const encrypted = encryptWecomPayload({ encodingAesKey, plainText: plain, corpId });
    const account = {
      accountId: "stage7",
      enabled: true,
      configured: true,
      config: { webhookPath: "/wecom-stage7", connectionMode: "callback" },
      connectionMode: "callback",
      corpId,
      agentId: 1000001,
      secret: "stage7-secret",
      token,
      encodingAesKey,
    } satisfies ResolvedWecomAccount;
    const unregister = registerWecomWebhookTarget({
      account,
      config: {},
      path: "/wecom-stage7",
      runtime: {},
    });
    const processed: string[] = [];
    try {
      const badSignature = computeWecomSignature({
        token: "not-the-account-token",
        timestamp,
        nonce,
        value: encrypted,
      });
      const query = new URLSearchParams({
        msg_signature: badSignature,
        timestamp,
        nonce,
      });
      const { res, end } = makeMockHttpResponse();
      const handled = await handleWecomWebhookRequest(
        postRequest(
          `/wecom-stage7?${query.toString()}`,
          `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`,
        ),
        res,
        async ({ message }) => {
          processed.push(message.fromUserName);
        },
      );
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(401);
      expect(end).toHaveBeenCalledWith("unauthorized");
      expect(processed).toEqual([]);
    } finally {
      unregister();
    }
  });

  it("fails closed when Feishu webhook mode has no verification token", async () => {
    const account = {
      accountId: "stage7-feishu",
      selectionSource: "explicit",
      enabled: true,
      configured: true,
      appId: "cli_stage7",
      appSecret: "secret_stage7",
      domain: "feishu",
      config: {
        enabled: true,
        appId: "cli_stage7",
        appSecret: "secret_stage7",
        connectionMode: "webhook",
      },
    } satisfies ResolvedFeishuAccount;

    await expect(
      monitorSingleAccount({
        cfg: { channels: { feishu: account.config } },
        account,
        botOpenIdSource: { kind: "prefetched", botOpenId: "ou_stage7_bot", botName: "stage7" },
      }),
    ).rejects.toThrow(/requires verificationToken/);
  });

  it("DingTalk unconfiguredReason fails closed without network", () => {
    const reason = dingtalkPlugin.config?.unconfiguredReason?.({} as never);
    expect(reason).toContain("Client ID");
    expect(reason).toContain("Client Secret");
    expect(dingtalkPlugin.config?.isConfigured?.({ configured: false } as never)).toBe(false);
    expect(dingtalkPlugin.config?.isConfigured?.({ configured: true } as never)).toBe(true);
  });

  it("doctor migration preview + enterprise IM onboarding on product path", async () => {
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "wecom", plugin: wecomPlugin, source: "stage7-evidence" },
        { pluginId: "feishu", plugin: feishuPlugin, source: "stage7-evidence" },
        { pluginId: "dingtalk", plugin: dingtalkPlugin, source: "stage7-evidence" },
      ]),
    );

    const channels = listChannelOnboardingAdapters().map((adapter) => adapter.channel);
    expect(channels).toContain("wecom");
    expect(channels).toContain("feishu");
    expect(channels).toContain("dingtalk");
    expect(wecomPlugin.onboarding?.channel).toBe("wecom");
    expect(feishuPlugin.onboarding?.channel).toBe("feishu");
    expect(dingtalkPlugin.onboarding?.channel).toBe("dingtalk");

    const wecomStatus = await wecomPlugin.onboarding!.getStatus({
      cfg: {},
      accountOverrides: {},
    });
    expect(wecomStatus.configured).toBe(false);
    expect(wecomStatus.statusLines.join("\n")).toMatch(/needs/i);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage7-doctor-"));
    const sessionsDir = path.join(root, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, "legacy.jsonl"), '{"type":"message"}\n', "utf8");
    const detected = await detectLegacyStateMigrations({
      cfg: {},
      env: { OPENCLAW_STATE_DIR: root } as NodeJS.ProcessEnv,
    });
    expect(detected.preview.join("\n")).toContain(
      `- Sessions: ${path.join(root, "sessions")} → ${path.join(root, "agents", "main", "sessions")}`,
    );
    expect(fs.existsSync(path.join(root, "agents", "main", "sessions"))).toBe(false);

    const storePath = path.join(root, "jobs.json");
    const before = JSON.stringify(
      {
        version: 1,
        jobs: [
          {
            jobId: "legacy-job",
            schedule: { kind: "cron", cron: "*/5 * * * *", tz: "UTC" },
            message: "say hi",
          },
        ],
      },
      null,
      2,
    );
    fs.writeFileSync(storePath, before, "utf8");
    await maybeRepairLegacyCronStore({
      cfg: { cron: { store: storePath } },
      options: {},
      prompter: { confirm: async () => false },
    });
    expect(fs.readFileSync(storePath, "utf8")).toBe(before);
  });
});

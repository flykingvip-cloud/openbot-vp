import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearWechatComponentTicketStoreCache,
  loadWechatComponentTicketStore,
  resolveWechatComponentVerifyTicketFromEnvOrCache,
  saveWechatComponentVerifyTicket,
} from "./wechat-component-ticket-store.js";
import {
  isWechatComponentOAuthConfigured,
  isWechatComponentOAuthCredentialsConfigured,
  resolveWechatComponentOAuthConfig,
} from "./wechat-component.js";
import {
  computeWechatOpenPlatformSignature,
  decryptWechatOpenPlatformPayload,
  encryptWechatOpenPlatformPayload,
  verifyWechatOpenPlatformSignature,
} from "./wechat-open-platform-crypto.js";

describe("wechat component oauth", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    clearWechatComponentTicketStoreCache();
  });

  it("treats oauth as configured when only appId and secret exist", () => {
    process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_APPID = "wx_component";
    process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_SECRET = "secret";
    delete process.env.OPENBOT_ENTERPRISE_WECHAT_OAUTH_REDIRECT_URI;

    expect(isWechatComponentOAuthCredentialsConfigured()).toBe(true);
    expect(isWechatComponentOAuthConfigured()).toBe(true);
    expect(resolveWechatComponentOAuthConfig()).toBeNull();
    expect(
      resolveWechatComponentOAuthConfig({
        redirectUri:
          "http://127.0.0.1:18789/__openbot/enterprise/t1/oauth/wechat-official/callback",
      }),
    ).not.toBeNull();
  });

  it("persists and resolves component_verify_ticket", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wechat-ticket-"));
    const storePath = path.join(dir, "ticket.json");
    await saveWechatComponentVerifyTicket({
      componentAppId: "wx_component",
      verifyTicket: "ticket-value",
      nowIso: "2026-07-12T00:00:00.000Z",
      storePath,
    });
    clearWechatComponentTicketStoreCache();
    const loaded = await loadWechatComponentTicketStore(storePath);
    expect(loaded.verifyTicket).toBe("ticket-value");
    process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_APPID = "wx_component";
    expect(resolveWechatComponentVerifyTicketFromEnvOrCache(loaded)).toBe("ticket-value");
  });

  it("encrypts and decrypts open platform payloads", () => {
    const encodingAesKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    const receiveId = "wx_component_app";
    const plainText =
      "<xml><ComponentVerifyTicket><![CDATA[ticket]]></ComponentVerifyTicket></xml>";
    const encrypted = encryptWechatOpenPlatformPayload({
      encodingAesKey,
      plainText,
      receiveId,
    });
    const signature = computeWechatOpenPlatformSignature({
      token: "token",
      timestamp: "1710000000",
      nonce: "nonce",
      value: encrypted,
    });
    expect(
      verifyWechatOpenPlatformSignature({
        token: "token",
        timestamp: "1710000000",
        nonce: "nonce",
        value: encrypted,
        signature,
      }),
    ).toBe(true);
    const decrypted = decryptWechatOpenPlatformPayload({
      encodingAesKey,
      encrypted,
      receiveId,
    });
    expect(decrypted).toBe(plainText);
  });
});

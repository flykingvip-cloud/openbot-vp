import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import {
  bindUserOperationalIdentityViaWechatPersonalExisting,
  createUserOperationalIdentity,
  probeWechatPersonalQrWorker,
  recheckWechatPersonalChannel,
  type UserOperationalIdentityHost,
  type UserOperationalIdentitySnapshot,
} from "./user-operational-identity.ts";

function isIdentitySnapshotMethod(method: string): boolean {
  return (
    method === "user-operational-identity.list" ||
    method === "user-operational-identity.binding-request.list-pending" ||
    method === "user-operational-identity.continuation.list-pending"
  );
}

function createHost(
  request: ReturnType<typeof vi.fn>,
  extras?: Partial<UserOperationalIdentityHost>,
): UserOperationalIdentityHost {
  const snapshot: UserOperationalIdentitySnapshot = {
    identities: [],
    grants: [],
    usageHistory: [],
    providerCatalog: [
      {
        provider: "wechat-personal",
        label: "微信个人号",
        category: "social",
        rolloutTier: "pilot",
        registrationReady: true,
        authMode: "qr_channel",
        operationalActions: [],
        reauthHint: "",
        degradedHint: "不等于公众号",
      },
    ],
    pendingBindingRequests: [],
  };
  return {
    client: { request } as unknown as UserOperationalIdentityHost["client"],
    connected: true,
    userOperationalIdentities: snapshot,
    userOperationalIdentityBusy: false,
    userOperationalIdentityError: null,
    userOperationalIdentityNotice: null,
    userOperationalIdentityNav: "add:wechat-personal",
    userOperationalIdentityEditorOpen: true,
    userOperationalIdentityEditorProvider: "wechat-personal",
    userOperationalIdentityEditorDisplayName: "我的微信",
    userOperationalIdentityEditorCredentialHandleId: "",
    userOperationalIdentityEditorAppId: "",
    userOperationalIdentityEditorAppSecret: "",
    userOperationalIdentityEditorSmtpHost: "",
    userOperationalIdentityEditorSmtpPort: "587",
    userOperationalIdentityEditorSmtpUser: "",
    userOperationalIdentityEditorImapHost: "",
    userOperationalIdentityEditorImapPort: "993",
    userOperationalIdentityEditorImapUser: "",
    userOperationalIdentityEditorUsePlatformSmtp: false,
    userOperationalIdentityEditorPersonalEmailPresetNote: null,
    userOperationalIdentityEditorIdentityId: null,
    wechatPersonalQrWorkerOnline: null,
    wechatPersonalQrStatus: "idle",
    wechatPersonalQrDataUrl: null,
    wechatPersonalQrMessage: null,
    wechatPersonalQrWxid: null,
    userOperationalIdentityEditorGrantAgentId: "bot-1",
    userOperationalIdentityOAuthSessionId: null,
    userOperationalIdentityReturnSessionKey: null,
    userOperationalIdentityReturnModule: null,
    userOperationalIdentityContinuationToken: null,
    userOperationalIdentityContinuationNotice: null,
    ...extras,
  };
}

describe("wechat-personal native bind controller", () => {
  it("probe renders detected wxid/nickname and never starts QR", async () => {
    const request = vi.fn(async (method: string) => {
      expect(method).toBe("user-operational-identity.wechat-personal.status");
      return {
        workerOnline: true,
        loggedIn: true,
        wxid: "wxid_native",
        nickname: "本机微信",
      };
    });
    const host = createHost(request);
    await probeWechatPersonalQrWorker(host);
    expect(host.wechatPersonalQrStatus).toBe("logged_in");
    expect(host.wechatPersonalQrMessage).toBe("已检测到本机微信：本机微信 / wxid_native");
    expect(host.wechatPersonalQrDataUrl).toBeNull();
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "user-operational-identity.wechat-personal.status",
    ]);
  });

  it("probe renders logged-out and offline setup copy", async () => {
    const loggedOut = createHost(vi.fn(async () => ({ workerOnline: true, loggedIn: false })));
    await probeWechatPersonalQrWorker(loggedOut);
    expect(loggedOut.wechatPersonalQrStatus).toBe("idle");
    expect(loggedOut.wechatPersonalQrMessage).toContain("还没有可用的微信登录态");

    const offline = createHost(vi.fn(async () => ({ workerOnline: false })));
    await probeWechatPersonalQrWorker(offline);
    expect(offline.wechatPersonalQrStatus).toBe("offline");
    expect(offline.wechatPersonalQrMessage).toContain("本机微信通道未连接");
  });

  it("recheck probes status and does not bind or start QR", async () => {
    const request = vi.fn(async (method: string) => {
      expect(method).toBe("user-operational-identity.wechat-personal.status");
      return { workerOnline: true, loggedIn: false };
    });
    const host = createHost(request, { userOperationalIdentityBusy: true });
    const online = await recheckWechatPersonalChannel(host);
    expect(online).toBe(true);
    expect(host.userOperationalIdentityBusy).toBe(false);
    expect(host.wechatPersonalQrMessage).toContain("还没有可用的微信登录态");
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "user-operational-identity.wechat-personal.status",
    ]);
  });

  it("bind-existing calls the new RPC and never qr.start/qr.wait", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "user-operational-identity.wechat-personal.status") {
        return { workerOnline: true, loggedIn: true, wxid: "wxid_native", nickname: "本机微信" };
      }
      if (isIdentitySnapshotMethod(method)) {
        return { ownerId: "u1", identities: [], grants: [], requests: [], continuations: [] };
      }
      if (method === "user-operational-identity.wechat-personal.bind-existing") {
        return {
          connected: true,
          wxid: "wxid_native",
          nickname: "本机微信",
          identity: { identityId: "id-1" },
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const host = createHost(request);
    const ok = await bindUserOperationalIdentityViaWechatPersonalExisting(host, {
      displayName: "我的微信",
      agentId: "bot-1",
    });
    expect(ok).toBe(true);
    expect(host.userOperationalIdentityNotice).toContain("微信个人号已绑定");
    const methods = request.mock.calls.map((call) => call[0]);
    expect(methods[0]).toBe("user-operational-identity.wechat-personal.status");
    expect(methods).toContain("user-operational-identity.wechat-personal.bind-existing");
    expect(methods).not.toContain("user-operational-identity.wechat-personal.qr.start");
    expect(methods).not.toContain("user-operational-identity.wechat-personal.qr.wait");
    const bindCall = request.mock.calls.find(
      (call) => call[0] === "user-operational-identity.wechat-personal.bind-existing",
    );
    expect(bindCall?.[1]).toMatchObject({
      displayName: "我的微信",
      agentId: "bot-1",
    });
  });

  it("createUserOperationalIdentity uses bind-existing instead of QR", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "user-operational-identity.wechat-personal.status") {
        return { workerOnline: true, loggedIn: true, wxid: "wxid_native" };
      }
      if (isIdentitySnapshotMethod(method)) {
        return { ownerId: "u1", identities: [], grants: [], requests: [], continuations: [] };
      }
      if (method === "user-operational-identity.wechat-personal.bind-existing") {
        return { connected: true, wxid: "wxid_native", identity: { identityId: "id-1" } };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const host = createHost(request);
    const ok = await createUserOperationalIdentity(host, {
      displayName: "我的微信",
      provider: "wechat-personal",
    });
    expect(ok).toBe(true);
    expect(request.mock.calls.map((call) => call[0])).not.toContain(
      "user-operational-identity.wechat-personal.qr.start",
    );
    expect(request.mock.calls.map((call) => call[0])).not.toContain(
      "user-operational-identity.wechat-personal.qr.wait",
    );
    expect(request.mock.calls.map((call) => call[0])).toContain(
      "user-operational-identity.wechat-personal.bind-existing",
    );
  });

  it("maps structured bind errors instead of treating 501 as a QR failure", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "user-operational-identity.wechat-personal.status") {
        return { workerOnline: true, loggedIn: true, wxid: "wxid_native" };
      }
      throw new GatewayRequestError({
        code: "UNAVAILABLE",
        message: "NATIVE_WECHAT_SESSION_REQUIRED",
        details: { code: "NATIVE_WECHAT_SESSION_REQUIRED" },
      });
    });
    const host = createHost(request);
    const ok = await bindUserOperationalIdentityViaWechatPersonalExisting(host);
    expect(ok).toBe(false);
    expect(host.userOperationalIdentityError).toContain("不能扫码登录");
    expect(host.userOperationalIdentityError).not.toContain("扫码超时");
  });
});

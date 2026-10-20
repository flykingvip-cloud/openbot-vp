import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequiredDomain, guardSessionDomain } from "./platform-auth/session-domain.js";
import { listGatewayMethods } from "./server-methods-list.js";
import { bindUserOperationalIdentityManualCredentials } from "./user-operational-identity-credentials.js";
import { startUserOperationalIdentityOAuthSession } from "./user-operational-identity-oauth.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import { listUserOperationalIdentityProviderCatalog } from "./user-operational-identity-providers.js";
import { registerUserOperationalIdentity } from "./user-operational-identity-store.js";
import {
  bindExistingWechatPersonalNativeSession,
  resolveWechatPersonalExistingSessionSnapshot,
} from "./user-operational-identity-wechat/bind-existing.js";
import { bindWechatPersonalIdentityFromWxid } from "./user-operational-identity-wechat/bind.js";
import {
  startWechatLoginWithQr,
  waitForWechatLogin,
} from "./user-operational-identity-wechat/login-qr.js";
import {
  createFailClosedWechatPersonalWorker,
  createMemoryWechatPersonalWorker,
  resetWechatPersonalWorker,
  setWechatPersonalWorker,
} from "./user-operational-identity-wechat/worker.js";

describe("wechat-personal QR bind slice", () => {
  const nowIso = "2026-08-31T09:00:00.000Z";
  const ownerId = "user-wx-1";

  afterEach(() => {
    resetWechatPersonalWorker();
  });

  it("registers bind-existing as a self-scoped WRITE identity method", () => {
    expect(listGatewayMethods()).toContain(
      "user-operational-identity.wechat-personal.bind-existing",
    );
    expect(getRequiredDomain("user-operational-identity.wechat-personal.bind-existing")).not.toBe(
      "any",
    );
    expect(
      guardSessionDomain("user-operational-identity.wechat-personal.bind-existing", "employee")
        .allowed,
    ).toBe(true);
  });

  it("lists wechat-personal as registrationReady qr_channel (not 公众号)", () => {
    const entry = listUserOperationalIdentityProviderCatalog().find(
      (item) => item.provider === "wechat-personal",
    );
    expect(entry).toMatchObject({
      label: "微信个人号",
      registrationReady: true,
      authMode: "qr_channel",
      rolloutTier: "deferred",
      operationalActions: [{ action: "probe_status", label: "探测通道" }],
    });
    expect(entry?.degradedHint).toContain("不等于公众号");
  });

  it("rejects credentials.bind for wechat-personal (not oauth, not manual)", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "wechat-personal",
      displayName: "My WeChat",
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_QR_CHANNEL_REQUIRED");
  });

  it("rejects oauth.start for wechat-personal", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = startUserOperationalIdentityOAuthSession({
      store,
      ownerId,
      provider: "wechat-personal",
      displayName: "My WeChat",
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_QR_CHANNEL_REQUIRED");
  });

  it("QR start is fail-closed when no worker/node is online", async () => {
    setWechatPersonalWorker(createFailClosedWechatPersonalWorker());
    const started = await startWechatLoginWithQr({ accountId: "default" });
    expect(started.qrDataUrl).toBeUndefined();
    expect(started.message).toMatch(/offline|unreachable/i);
  });

  it("create is fail-closed without a worker even if identity catalog is ready", async () => {
    setWechatPersonalWorker(createFailClosedWechatPersonalWorker());
    const started = await startWechatLoginWithQr({});
    expect(started.qrDataUrl).toBeUndefined();
    const waited = await waitForWechatLogin({});
    expect(waited.connected).toBe(false);
  });

  it("binds wxid after QR wait and rejects duplicate wxid", async () => {
    const worker = createMemoryWechatPersonalWorker({ wxid: "wxid_abc123" });
    setWechatPersonalWorker(worker);
    const started = await startWechatLoginWithQr({ accountId: "default" });
    expect(started.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const waited = await waitForWechatLogin({ accountId: "default" });
    expect(waited.connected).toBe(true);
    expect(waited.wxid).toBe("wxid_abc123");

    const store = normalizeUserOperationalIdentityStore(null);
    const bound = await bindWechatPersonalIdentityFromWxid({
      store,
      ownerId,
      displayName: "我的微信",
      wxid: waited.wxid ?? "",
      agentId: "main",
      nowIso,
      skipRouteBinding: true,
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      return;
    }
    expect(bound.identity.provider).toBe("wechat-personal");
    expect(bound.identity.externalAccountId).toBe("wxid_abc123");
    expect(bound.grant?.agentId).toBe("main");

    const duplicate = await bindWechatPersonalIdentityFromWxid({
      store,
      ownerId,
      displayName: "另一个名字",
      wxid: "wxid_abc123",
      nowIso,
      skipRouteBinding: true,
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) {
      return;
    }
    expect(duplicate.code).toBe("USER_IDENTITY_EXTERNAL_ACCOUNT_ALREADY_BOUND");
  });

  it("binds existing native session without loginStart/loginWait", async () => {
    const worker = createMemoryWechatPersonalWorker({
      wxid: "wxid_native_1",
      nickname: "本机微信",
    });
    const loginStart = vi.spyOn(worker, "loginStart");
    const loginWait = vi.spyOn(worker, "loginWait");
    worker.forceLogin("wxid_native_1", "本机微信");
    setWechatPersonalWorker(worker);

    const store = normalizeUserOperationalIdentityStore(null);
    const bound = await bindExistingWechatPersonalNativeSession({
      writeLock: async (fn) => await fn(store),
      ownerId,
      displayName: "我的微信",
      agentId: "main",
      nowIso,
      skipRouteBinding: true,
    });

    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      return;
    }
    expect(bound.wxid).toBe("wxid_native_1");
    expect(bound.nickname).toBe("本机微信");
    expect(bound.identity.provider).toBe("wechat-personal");
    expect(bound.identity.externalAccountId).toBe("wxid_native_1");
    expect(bound.grant?.agentId).toBe("main");
    expect(loginStart).not.toHaveBeenCalled();
    expect(loginWait).not.toHaveBeenCalled();
  });

  it("returns structured not-logged-in when sidecar is online but logged out", async () => {
    const worker = createMemoryWechatPersonalWorker();
    const loginStart = vi.spyOn(worker, "loginStart");
    setWechatPersonalWorker(worker);

    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindExistingWechatPersonalNativeSession({
      writeLock: async (fn) => await fn(store),
      ownerId,
      displayName: "我的微信",
      nowIso,
      skipRouteBinding: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN");
    expect(loginStart).not.toHaveBeenCalled();
  });

  it("returns existing offline error when worker is unreachable", async () => {
    setWechatPersonalWorker(createFailClosedWechatPersonalWorker());
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindExistingWechatPersonalNativeSession({
      writeLock: async (fn) => await fn(store),
      ownerId,
      nowIso,
      skipRouteBinding: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE");
  });

  it("fails closed when logged in without wxid", async () => {
    const worker = createMemoryWechatPersonalWorker();
    worker.forceLogin("");
    setWechatPersonalWorker(worker);

    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindExistingWechatPersonalNativeSession({
      writeLock: async (fn) => await fn(store),
      ownerId,
      nowIso,
      skipRouteBinding: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_WXID_REQUIRED");
  });

  it("preserves duplicate wxid rejection for existing-session bind", async () => {
    const worker = createMemoryWechatPersonalWorker({ wxid: "wxid_dup" });
    worker.forceLogin("wxid_dup", "重复号");
    setWechatPersonalWorker(worker);

    const store = normalizeUserOperationalIdentityStore(null);
    const first = await bindExistingWechatPersonalNativeSession({
      writeLock: async (fn) => await fn(store),
      ownerId,
      displayName: "第一号",
      agentId: "main",
      nowIso,
      skipRouteBinding: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.grant?.agentId).toBe("main");

    const duplicate = await bindExistingWechatPersonalNativeSession({
      writeLock: async (fn) => await fn(store),
      ownerId,
      displayName: "第二号",
      nowIso,
      skipRouteBinding: true,
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) {
      return;
    }
    expect(duplicate.code).toBe("USER_IDENTITY_EXTERNAL_ACCOUNT_ALREADY_BOUND");
  });

  it("probes the worker before acquiring the identity write lock", async () => {
    const events: string[] = [];
    const store = normalizeUserOperationalIdentityStore(null);
    const bound = await bindExistingWechatPersonalNativeSession({
      probeWorker: async () => {
        events.push("probe");
        return {
          ok: true,
          online: true,
          loggedIn: true,
          wxid: "wxid_lock_order",
          nickname: "锁序",
        };
      },
      writeLock: async (fn) => {
        events.push("lock");
        return fn(store);
      },
      ownerId,
      displayName: "锁序微信",
      agentId: "main",
      nowIso,
      skipRouteBinding: true,
    });
    expect(bound.ok).toBe(true);
    expect(events).toEqual(["probe", "lock"]);
    if (bound.ok) {
      expect(bound.wxid).toBe("wxid_lock_order");
    }
  });

  it("does not acquire the write lock when the sidecar is not logged in", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const writeLock = vi.fn(async (fn) => await fn(store));
    const resolved = await resolveWechatPersonalExistingSessionSnapshot({
      probeWorker: async () => ({ ok: true, online: true, loggedIn: false }),
    });
    const result = await bindExistingWechatPersonalNativeSession({
      probeWorker: async () => ({ ok: true, online: true, loggedIn: false }),
      writeLock,
      ownerId,
      nowIso,
      skipRouteBinding: true,
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.code).toBe("USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN");
    }
    expect(result.ok).toBe(false);
    expect(writeLock).not.toHaveBeenCalled();
  });

  it("registerUserOperationalIdentity now accepts wechat-personal", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "微信个人号",
      provider: "wechat-personal",
      credentialHandleId: "wechat-personal:wxid_ready",
      externalAccountId: "wxid_ready",
      nowIso,
      credentialVerified: true,
    });
    expect(result.ok).toBe(true);
  });
});

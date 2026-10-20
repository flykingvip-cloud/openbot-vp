import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeUserOperationalIdentityAction } from "./user-operational-identity-execution.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import * as secretsModule from "./user-operational-identity-secrets.js";
import { registerUserOperationalIdentity } from "./user-operational-identity-store.js";

const fetchTokenMock = vi.fn();
const executeSharedMock = vi.fn();
const probeMock = vi.fn();

vi.mock("./enterprise-operational-identity-wechat-official-api.js", () => ({
  fetchWechatOfficialClientCredentialToken: (...args: unknown[]) => fetchTokenMock(...args),
}));

vi.mock("./wechat-official/execute-operational-actions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./wechat-official/execute-operational-actions.js")>();
  return {
    ...actual,
    executeWechatOfficialActionsWithAccessToken: (...args: unknown[]) => executeSharedMock(...args),
  };
});

vi.mock("./user-operational-identity-credentials.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./user-operational-identity-credentials.js")>();
  return {
    ...actual,
    probeWechatOfficialCredentials: (...args: unknown[]) => probeMock(...args),
  };
});

describe("user wechat-official execution", () => {
  const nowIso = "2026-08-10T08:00:00.000Z";
  const ownerId = "user-1";
  const agentId = "agent-owned-1";
  const handleId = "cred-wechat-1";
  const appId = "wx1234567890abcdef";

  const wechatSecret = {
    handleId,
    ownerId,
    provider: "wechat-official" as const,
    kind: "wechat_oa" as const,
    accessToken: "app-secret-value",
    accountLabel: appId,
    metadata: { appId },
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(
      secretsModule,
      "loadUserOperationalIdentityCredentialSecretForHandle",
    ).mockResolvedValue(wechatSecret);
    fetchTokenMock.mockResolvedValue({ accessToken: "oa-token-1", expiresIn: 7200 });
    executeSharedMock.mockResolvedValue({
      authorizerAppId: appId,
      mediaId: "draft-media-1",
      status: "draft_created",
    });
    probeMock.mockResolvedValue({ ok: true, accessToken: "oa-token-probe" });
  });

  function seedWechatIdentity(store: ReturnType<typeof normalizeUserOperationalIdentityStore>) {
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My WeChat OA",
      provider: "wechat-official",
      credentialHandleId: handleId,
      externalAccountId: appId,
      nowIso,
      credentialVerified: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("seed failed");
    }
    return created.identity;
  }

  it("verify_credentials still probes AppID + AppSecret", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedWechatIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "wechat-official",
      action: "verify_credentials",
      payload: {},
      ownerId,
      agentId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(probeMock).toHaveBeenCalledWith({ appId, appSecret: "app-secret-value" });
    expect(fetchTokenMock).not.toHaveBeenCalled();
    expect(result.output.verified).toBe(true);
  });

  it("publish_draft exchanges client_credential token then calls shared execution core", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedWechatIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "wechat-official",
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbUrl: "https://example.com/cover.jpg",
      },
      ownerId,
      agentId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(fetchTokenMock).toHaveBeenCalledWith({
      appId,
      appSecret: "app-secret-value",
      forceRefresh: false,
    });
    expect(executeSharedMock).toHaveBeenCalledWith({
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbUrl: "https://example.com/cover.jpg",
      },
      accessToken: "oa-token-1",
      appId,
    });
    expect(result.output.status).toBe("draft_created");
  });

  it("retries client_credential exchange once then still publishes", async () => {
    fetchTokenMock.mockRejectedValueOnce(new Error("temporary token failure"));
    fetchTokenMock.mockResolvedValueOnce({ accessToken: "oa-token-2", expiresIn: 7200 });
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedWechatIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "wechat-official",
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbMediaId: "thumb-1",
      },
      ownerId,
      agentId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(fetchTokenMock).toHaveBeenNthCalledWith(1, {
      appId,
      appSecret: "app-secret-value",
      forceRefresh: false,
    });
    expect(fetchTokenMock).toHaveBeenNthCalledWith(2, {
      appId,
      appSecret: "app-secret-value",
      forceRefresh: true,
    });
    expect(executeSharedMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "oa-token-2" }),
    );
  });

  it("retries the WeChat draft call after access_token expired", async () => {
    executeSharedMock
      .mockRejectedValueOnce(new Error("access_token expired rid: xyz"))
      .mockResolvedValueOnce({
        authorizerAppId: appId,
        mediaId: "draft-media-retry",
        status: "draft_created",
      });
    fetchTokenMock
      .mockResolvedValueOnce({ accessToken: "oa-token-1", expiresIn: 7200 })
      .mockResolvedValueOnce({ accessToken: "oa-token-fresh", expiresIn: 7200 });
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedWechatIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "wechat-official",
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbMediaId: "thumb-1",
      },
      ownerId,
      agentId,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(executeSharedMock).toHaveBeenCalledTimes(2);
    expect(executeSharedMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ accessToken: "oa-token-fresh" }),
    );
  });

  it("does not send AppSecret as a WeChat API ticket when both exchanges fail", async () => {
    fetchTokenMock.mockRejectedValue(new Error("IP 白名单未放行"));
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedWechatIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "wechat-official",
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbMediaId: "thumb-1",
      },
      ownerId,
      agentId,
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("无法换取公众号票据");
    expect(executeSharedMock).not.toHaveBeenCalled();
    expect(fetchTokenMock).toHaveBeenCalledTimes(2);
    expect(fetchTokenMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ forceRefresh: true }),
    );
  });

  it("rejects sync_* data sync actions with explicit not-implemented error", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const identity = seedWechatIdentity(store);
    const result = await executeUserOperationalIdentityAction({
      store,
      identity,
      provider: "wechat-official",
      action: "sync_follower_stats",
      payload: {},
      ownerId,
      agentId,
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("not implemented");
    expect(fetchTokenMock).not.toHaveBeenCalled();
  });
});

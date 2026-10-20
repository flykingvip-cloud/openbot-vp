import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeUserOperationalIdentityAction } from "./user-operational-identity-execution.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import * as secretsModule from "./user-operational-identity-secrets.js";
import { executeSocialManualIdentityAction } from "./user-operational-identity-social.js";
import { registerUserOperationalIdentity } from "./user-operational-identity-store.js";

describe("user operational identity social execution", () => {
  const nowIso = "2026-07-26T12:00:00.000Z";
  const ownerId = "user-social-1";
  const handleId = "cred-social-1";

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_SOCIAL_SIMULATE;
    delete process.env.OPENBOT_XIAOHONGSHU_API_BASE;
  });

  afterEach(() => {
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_SOCIAL_SIMULATE;
    delete process.env.OPENBOT_XIAOHONGSHU_API_BASE;
  });

  it("simulates weibo publish_post for simulated credentials", async () => {
    const result = await executeSocialManualIdentityAction({
      provider: "weibo",
      action: "publish_post",
      payload: { body: "hello weibo" },
      secret: {
        handleId,
        ownerId,
        provider: "weibo",
        kind: "social_account",
        accessToken: "simulated:weibo:token",
        accountLabel: "我的微博",
        metadata: { accountHandle: "weibo_user" },
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
    expect(result.simulated).toBe(true);
    expect(result.provider).toBe("weibo");
    expect(result.text).toBe("hello weibo");
    expect(result.postId).toBeTypeOf("string");
  });

  it("calls Weibo statuses/update for real publish_post", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ id: 123, idstr: "123", text: "hello weibo", mid: "123" }),
    ) as unknown as typeof fetch;
    const result = await executeSocialManualIdentityAction({
      provider: "weibo",
      action: "publish_post",
      payload: { message: "hello weibo" },
      secret: {
        handleId,
        ownerId,
        provider: "weibo",
        kind: "social_account",
        accessToken: "wb-token",
        metadata: { accountHandle: "123456" },
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      fetchImpl,
    });
    expect(result.simulated).toBe(false);
    expect(result.postId).toBe("123");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const called = vi.mocked(fetchImpl).mock.calls[0]?.[0];
    const calledUrl =
      typeof called === "string" ? called : called instanceof URL ? called.href : "";
    expect(calledUrl).toContain("/2/statuses/update.json");
    expect(calledUrl).toContain("access_token=wb-token");
  });

  it("requires OPENBOT_XIAOHONGSHU_API_BASE for live xiaohongshu publish", async () => {
    await expect(
      executeSocialManualIdentityAction({
        provider: "xiaohongshu",
        action: "publish_post",
        payload: { body: "note" },
        secret: {
          handleId,
          ownerId,
          provider: "xiaohongshu",
          kind: "social_account",
          accessToken: "xhs-cookie",
          metadata: { accountHandle: "xhs_user" },
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      }),
    ).rejects.toThrow(/OPENBOT_XIAOHONGSHU_API_BASE/);
  });

  it("uses builtin:simulate connector for xiaohongshu without external API", async () => {
    process.env.OPENBOT_XIAOHONGSHU_API_BASE = "builtin:simulate";
    const result = await executeSocialManualIdentityAction({
      provider: "xiaohongshu",
      action: "publish_post",
      payload: { body: "模拟笔记" },
      secret: {
        handleId,
        ownerId,
        provider: "xiaohongshu",
        kind: "social_account",
        accessToken: "dev-token",
        metadata: { accountHandle: "xhs_user" },
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
    expect(result.simulated).toBe(true);
    expect(result.connector).toBe("builtin:simulate");
    expect(result.text).toBe("模拟笔记");
  });

  it("publishes xiaohongshu note when API base is configured", async () => {
    process.env.OPENBOT_XIAOHONGSHU_API_BASE = "https://xhs.example.com";
    const fetchImpl = vi.fn(async () => Response.json({ id: "note-1" })) as unknown as typeof fetch;
    const result = await executeSocialManualIdentityAction({
      provider: "xiaohongshu",
      action: "publish_post",
      payload: { title: "标题", body: "正文" },
      secret: {
        handleId,
        ownerId,
        provider: "xiaohongshu",
        kind: "social_account",
        accessToken: "xhs-token",
        metadata: { accountHandle: "xhs_user" },
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      fetchImpl,
    });
    expect(result.simulated).toBe(false);
    expect(result.noteId).toBe("note-1");
    const called = vi.mocked(fetchImpl).mock.calls[0]?.[0];
    const calledUrl =
      typeof called === "string" ? called : called instanceof URL ? called.href : "";
    expect(calledUrl).toBe("https://xhs.example.com/v1/notes");
  });

  it("wires weibo execute through user-operational-identity action entry", async () => {
    vi.spyOn(
      secretsModule,
      "loadUserOperationalIdentityCredentialSecretForHandle",
    ).mockResolvedValue({
      handleId,
      ownerId,
      provider: "weibo",
      kind: "social_account",
      accessToken: "simulated:weibo",
      metadata: { accountHandle: "wb" },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    const store = normalizeUserOperationalIdentityStore(null);
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "微博",
      provider: "weibo",
      credentialHandleId: handleId,
      nowIso,
      credentialVerified: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const result = await executeUserOperationalIdentityAction({
      store,
      identity: created.identity,
      provider: "weibo",
      action: "publish_post",
      payload: { body: "from execute" },
      ownerId,
      agentId: "agent-1",
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.simulated).toBe(true);
    expect(result.output.text).toBe("from execute");
  });
});

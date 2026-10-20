import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshCredentialMock = vi.fn();
const persistLockMock = vi.fn();
const addDraftMock = vi.fn();
const submitPublishMock = vi.fn();
const broadcastMock = vi.fn();
const uploadThumbMock = vi.fn();
const uploadContentImageMock = vi.fn();
const rewriteContentImagesMock = vi.fn();
const getPublishStatusMock = vi.fn();

vi.mock("./enterprise-operational-identity-wechat-official-credential.js", () => ({
  refreshWechatOfficialOperationalAccessToken: (...args: unknown[]) =>
    refreshCredentialMock(...args),
}));

vi.mock("./enterprise-operational-identity-oauth/credential-secrets-persistence.js", () => ({
  withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock: (...args: unknown[]) =>
    persistLockMock(...args),
}));

vi.mock("./enterprise-operational-identity-wechat-official-api.js", () => ({
  addWechatOfficialDraft: (...args: unknown[]) => addDraftMock(...args),
  submitWechatOfficialFreePublish: (...args: unknown[]) => submitPublishMock(...args),
  broadcastWechatOfficialArticle: (...args: unknown[]) => broadcastMock(...args),
  uploadWechatOfficialThumbFromSource: (...args: unknown[]) => uploadThumbMock(...args),
  uploadWechatOfficialContentImageFromSource: (...args: unknown[]) =>
    uploadContentImageMock(...args),
  rewriteWechatOfficialHtmlContentImages: (...args: unknown[]) => rewriteContentImagesMock(...args),
  getWechatOfficialFreePublishStatus: (...args: unknown[]) => getPublishStatusMock(...args),
}));

const { parseEnterpriseOperationalIdentityWechatPayload, executeWechatOfficialOperationalAction } =
  await import("./enterprise-operational-identity-wechat-official-execution.js");

describe("parseEnterpriseOperationalIdentityWechatPayload", () => {
  it("normalizes wechat article fields", () => {
    expect(
      parseEnterpriseOperationalIdentityWechatPayload({
        title: " 标题 ",
        body: " 正文 ",
        thumb_media_id: "thumb-1",
        media_id: "media-1",
        send_to_all: "false",
        tag_id: "12",
      }),
    ).toEqual({
      title: "标题",
      content: "正文",
      thumbMediaId: "thumb-1",
      mediaId: "media-1",
      sendToAll: false,
      tagId: 12,
    });
  });
});

describe("executeWechatOfficialOperationalAction", () => {
  const secret = {
    credentialBindingId: "cred-1",
    tenantId: "acme",
    connectorId: "wechat-official",
    kind: "oauth_token" as const,
    accessToken: "token-1",
    refreshToken: "refresh-1",
    externalAccountId: "wx-app-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    refreshCredentialMock.mockResolvedValue({ secret, refreshed: false });
    persistLockMock.mockImplementation(
      async (fn: (store: { secrets: Record<string, unknown> }) => unknown) => fn({ secrets: {} }),
    );
    rewriteContentImagesMock.mockImplementation(async ({ html }: { html: string }) => ({
      html,
      rewritten: [],
      skipped: [],
    }));
  });

  it("creates draft via publish_draft with thumbUrl upload", async () => {
    uploadThumbMock.mockResolvedValue({
      mediaId: "thumb-media-1",
      filename: "thumb.jpg",
      bytes: 1200,
    });
    addDraftMock.mockResolvedValue({ mediaId: "draft-media-1" });
    const output = await executeWechatOfficialOperationalAction({
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbUrl: "https://example.com/cover.jpg",
      },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("draft_created");
    expect(output.thumbMediaId).toBe("thumb-media-1");
    expect(uploadThumbMock).toHaveBeenCalledOnce();
    expect(addDraftMock).toHaveBeenCalledOnce();
  });

  it("uploads thumb via upload_thumb action", async () => {
    uploadThumbMock.mockResolvedValue({
      mediaId: "thumb-media-2",
      filename: "cover.png",
      bytes: 900,
    });
    const output = await executeWechatOfficialOperationalAction({
      action: "upload_thumb",
      payload: { thumbBase64: "aGVsbG8=" },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("thumb_uploaded");
    expect(output.thumbMediaId).toBe("thumb-media-2");
  });

  it("uploads thumb via upload_thumb imageBase64 alias", async () => {
    uploadThumbMock.mockResolvedValue({
      mediaId: "thumb-media-alias",
      filename: "cover.jpg",
      bytes: 900,
    });
    const output = await executeWechatOfficialOperationalAction({
      action: "upload_thumb",
      payload: { imageBase64: "aGVsbG8=" },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("thumb_uploaded");
    expect(uploadThumbMock).toHaveBeenCalledWith(
      expect.objectContaining({ thumbBase64: "aGVsbG8=" }),
    );
  });

  it("uploads content image via upload_content_image action", async () => {
    uploadContentImageMock.mockResolvedValue({
      url: "https://mmbiz.qpic.cn/content/1",
      filename: "inline.jpg",
      bytes: 800,
    });
    const output = await executeWechatOfficialOperationalAction({
      action: "upload_content_image",
      payload: { imageUrl: "https://example.com/inline.jpg" },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("content_image_uploaded");
    expect(output.imageUrl).toBe("https://mmbiz.qpic.cn/content/1");
  });

  it("rewrites external img src when creating draft", async () => {
    rewriteContentImagesMock.mockResolvedValue({
      html: '<p><img src="https://mmbiz.qpic.cn/content/1" /></p>',
      rewritten: [{ source: "https://example.com/a.jpg", url: "https://mmbiz.qpic.cn/content/1" }],
      skipped: [],
    });
    addDraftMock.mockResolvedValue({ mediaId: "draft-media-2" });
    const output = await executeWechatOfficialOperationalAction({
      action: "publish_draft",
      payload: {
        title: "图文",
        content: '<p><img src="https://example.com/a.jpg" /></p>',
        thumbMediaId: "thumb-1",
      },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.contentImagesRewritten).toHaveLength(1);
    expect(addDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        article: expect.objectContaining({
          content: '<p><img src="https://mmbiz.qpic.cn/content/1" /></p>',
        }),
      }),
    );
  });

  it("queries publish status", async () => {
    getPublishStatusMock.mockResolvedValue({ publish_status: 0 });
    const output = await executeWechatOfficialOperationalAction({
      action: "get_publish_status",
      payload: { publishId: "pub-1" },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.publishId).toBe("pub-1");
    expect(getPublishStatusMock).toHaveBeenCalledOnce();
  });

  it("creates draft via publish_draft", async () => {
    addDraftMock.mockResolvedValue({ mediaId: "draft-media-1" });
    const output = await executeWechatOfficialOperationalAction({
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbMediaId: "thumb-1",
      },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("draft_created");
    expect(output.mediaId).toBe("draft-media-1");
    expect(addDraftMock).toHaveBeenCalledOnce();
  });

  it("submits free publish for publish_article with mediaId", async () => {
    submitPublishMock.mockResolvedValue({ publishId: "pub-1" });
    const output = await executeWechatOfficialOperationalAction({
      action: "publish_article",
      payload: { mediaId: "draft-media-1" },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("publish_submitted");
    expect(output.publishId).toBe("pub-1");
    expect(submitPublishMock).toHaveBeenCalledOnce();
    expect(addDraftMock).not.toHaveBeenCalled();
  });

  it("broadcasts article with mediaId", async () => {
    broadcastMock.mockResolvedValue({ msgId: "10001", msgDataId: "20002" });
    const output = await executeWechatOfficialOperationalAction({
      action: "broadcast_article",
      payload: { mediaId: "draft-media-1", sendToAll: true },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("broadcast_sent");
    expect(output.msgId).toBe("10001");
    expect(broadcastMock).toHaveBeenCalledOnce();
  });

  it("retries ticket exchange once then still publishes with the cached ticket", async () => {
    refreshCredentialMock.mockRejectedValueOnce(new Error("IP 白名单未放行"));
    refreshCredentialMock.mockRejectedValueOnce(new Error("IP 白名单未放行"));
    addDraftMock.mockResolvedValue({ mediaId: "draft-from-cache" });
    const output = await executeWechatOfficialOperationalAction({
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbMediaId: "thumb-1",
      },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.status).toBe("draft_created");
    expect(output.mediaId).toBe("draft-from-cache");
    expect(refreshCredentialMock).toHaveBeenCalledTimes(2);
    expect(addDraftMock).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "token-1" }));
  });

  it("force-refreshes once and retries the WeChat call after access_token expired", async () => {
    refreshCredentialMock
      .mockResolvedValueOnce({ secret, refreshed: false })
      .mockResolvedValueOnce({
        secret: { ...secret, accessToken: "token-2" },
        refreshed: true,
      });
    addDraftMock
      .mockRejectedValueOnce(new Error("access_token expired rid: abc"))
      .mockResolvedValueOnce({ mediaId: "draft-after-retry" });
    const output = await executeWechatOfficialOperationalAction({
      action: "publish_draft",
      payload: {
        title: "Hello",
        content: "<p>Hi</p>",
        thumbMediaId: "thumb-1",
      },
      secret,
      credentialBindingId: "cred-1",
    });
    expect(output.mediaId).toBe("draft-after-retry");
    expect(addDraftMock).toHaveBeenCalledTimes(2);
    expect(addDraftMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ accessToken: "token-2" }),
    );
    expect(persistLockMock).toHaveBeenCalledOnce();
  });
});

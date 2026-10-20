import { beforeEach, describe, expect, it, vi } from "vitest";

const addArticleMock = vi.fn();
const publishVideoMock = vi.fn();
const resolveClientMock = vi.fn();
const maybeRefreshMock = vi.fn();

vi.mock("./enterprise-operational-identity-bilibili-api.js", () => ({
  addBilibiliArticle: (...args: unknown[]) => addArticleMock(...args),
  publishBilibiliVideoFromSource: (...args: unknown[]) => publishVideoMock(...args),
  resolveBilibiliOpenClientConfig: (...args: unknown[]) => resolveClientMock(...args),
}));

vi.mock("./enterprise-operational-identity-providers/credential-refresh.js", () => ({
  maybeRefreshOperationalIdentityCredential: (...args: unknown[]) => maybeRefreshMock(...args),
}));

const { parseEnterpriseOperationalIdentityBilibiliPayload, executeBilibiliOperationalAction } =
  await import("./enterprise-operational-identity-bilibili-execution.js");

describe("parseEnterpriseOperationalIdentityBilibiliPayload", () => {
  it("normalizes article and video fields", () => {
    expect(
      parseEnterpriseOperationalIdentityBilibiliPayload({
        title: " 标题 ",
        body: " 正文 ",
        tid: "21",
        tag: " OpenBot ",
      }),
    ).toEqual({
      title: "标题",
      content: "正文",
      body: "正文",
      tid: 21,
      tags: "OpenBot",
      tag: "OpenBot",
    });
  });
});

describe("executeBilibiliOperationalAction", () => {
  const secret = {
    credentialBindingId: "cred-bili",
    tenantId: "acme",
    connectorId: "bilibili",
    kind: "oauth_token" as const,
    accessToken: "token-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveClientMock.mockReturnValue({ clientId: "client-1", clientSecret: "secret-1" });
    maybeRefreshMock.mockResolvedValue(secret);
  });

  it("publish_article submits article", async () => {
    addArticleMock.mockResolvedValue({ articleId: 12345 });

    const result = await executeBilibiliOperationalAction({
      action: "publish_article",
      payload: { title: "专栏标题", content: "专栏正文" },
      secret,
      credentialBindingId: "cred-bili",
    });

    expect(result.status).toBe("article_submitted");
    expect(result.articleId).toBe(12345);
    expect(addArticleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "token-1",
        clientId: "client-1",
        title: "专栏标题",
        content: "专栏正文",
      }),
    );
  });

  it("publish_video uploads and submits archive", async () => {
    publishVideoMock.mockResolvedValue({
      uploadToken: "ut-1",
      coverUrl: "https://cover.example/a.jpg",
      resourceId: "res-1",
      videoBytes: 2048,
      videoFilename: "clip.mp4",
    });

    const result = await executeBilibiliOperationalAction({
      action: "publish_video",
      payload: {
        title: "视频标题",
        tid: 21,
        tag: "OpenBot",
        videoUrl: "https://example.com/clip.mp4",
        coverUrl: "https://example.com/cover.jpg",
      },
      secret,
      credentialBindingId: "cred-bili",
    });

    expect(result.status).toBe("video_submitted");
    expect(result.resourceId).toBe("res-1");
    expect(publishVideoMock).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadVideoMock = vi.fn();
const createVideoMock = vi.fn();
const maybeRefreshMock = vi.fn();

vi.mock("./enterprise-operational-identity-douyin-api.js", () => ({
  uploadDouyinVideo: (...args: unknown[]) => uploadVideoMock(...args),
  createDouyinVideo: (...args: unknown[]) => createVideoMock(...args),
}));

vi.mock("./enterprise-operational-identity-providers/credential-refresh.js", () => ({
  maybeRefreshOperationalIdentityCredential: (...args: unknown[]) => maybeRefreshMock(...args),
}));

const { parseEnterpriseOperationalIdentityDouyinPayload, executeDouyinOperationalAction } =
  await import("./enterprise-operational-identity-douyin-execution.js");

describe("parseEnterpriseOperationalIdentityDouyinPayload", () => {
  it("normalizes douyin publish fields", () => {
    expect(
      parseEnterpriseOperationalIdentityDouyinPayload({
        text: " 标题 ",
        video_url: " https://example.com/v.mp4 ",
        private_status: "0",
      }),
    ).toEqual({
      text: "标题",
      videoUrl: "https://example.com/v.mp4",
      privateStatus: 0,
    });
  });
});

describe("executeDouyinOperationalAction", () => {
  const secret = {
    credentialBindingId: "cred-douyin",
    tenantId: "acme",
    connectorId: "douyin",
    kind: "oauth_token" as const,
    accessToken: "token-1",
    externalAccountId: "open-123",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    maybeRefreshMock.mockResolvedValue(secret);
  });

  it("publish_video uploads then creates video", async () => {
    uploadVideoMock.mockResolvedValue({
      videoId: "@encrypted-video-id",
      videoBytes: 1024,
      videoFilename: "clip.mp4",
    });
    createVideoMock.mockResolvedValue({
      itemId: "item-1",
      videoId: "7215132967188970000",
    });

    const result = await executeDouyinOperationalAction({
      action: "publish_video",
      payload: {
        text: "新品发布",
        videoUrl: "https://example.com/clip.mp4",
      },
      secret,
      credentialBindingId: "cred-douyin",
      externalAccountId: "open-123",
    });

    expect(result.status).toBe("video_published");
    expect(result.douyinVideoId).toBe("7215132967188970000");
    expect(uploadVideoMock).toHaveBeenCalled();
    expect(createVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "token-1",
        openId: "open-123",
        videoId: "@encrypted-video-id",
        text: "新品发布",
      }),
    );
  });

  it("publish_video skips upload when videoId provided", async () => {
    createVideoMock.mockResolvedValue({ videoId: "7215132967188970001" });

    await executeDouyinOperationalAction({
      action: "publish_video",
      payload: {
        videoId: "@existing-id",
        text: "复用已上传视频",
      },
      secret,
      credentialBindingId: "cred-douyin",
      externalAccountId: "open-123",
    });

    expect(uploadVideoMock).not.toHaveBeenCalled();
    expect(createVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "@existing-id" }),
    );
  });
});

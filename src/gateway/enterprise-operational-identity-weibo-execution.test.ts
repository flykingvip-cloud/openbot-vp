import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadPicMock = vi.fn();
const postStatusMock = vi.fn();
const postStatusWithPicMock = vi.fn();
const maybeRefreshMock = vi.fn();

vi.mock("./enterprise-operational-identity-weibo-api.js", () => ({
  uploadWeiboPic: (...args: unknown[]) => uploadPicMock(...args),
  postWeiboStatus: (...args: unknown[]) => postStatusMock(...args),
  postWeiboStatusWithPic: (...args: unknown[]) => postStatusWithPicMock(...args),
}));

vi.mock("./enterprise-operational-identity-providers/credential-refresh.js", () => ({
  maybeRefreshOperationalIdentityCredential: (...args: unknown[]) => maybeRefreshMock(...args),
}));

const { parseEnterpriseOperationalIdentityWeiboPayload, executeWeiboOperationalAction } =
  await import("./enterprise-operational-identity-weibo-execution.js");

describe("parseEnterpriseOperationalIdentityWeiboPayload", () => {
  it("normalizes weibo post and pic fields", () => {
    expect(
      parseEnterpriseOperationalIdentityWeiboPayload({
        message: " Hello ",
        pic_id: " pic-1 ",
        pic_url: " https://example.com/a.jpg ",
        visible: "0",
      }),
    ).toEqual({
      message: "Hello",
      picId: "pic-1",
      picUrl: "https://example.com/a.jpg",
      visible: 0,
    });
  });
});

describe("executeWeiboOperationalAction", () => {
  const secret = {
    credentialBindingId: "cred-weibo",
    tenantId: "acme",
    connectorId: "weibo",
    kind: "oauth_token" as const,
    accessToken: "token-1",
    externalAccountId: "12345",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    maybeRefreshMock.mockResolvedValue(secret);
  });

  it("upload_image returns picId", async () => {
    uploadPicMock.mockResolvedValue({
      picId: "pic-99",
      picMd5: "abc",
      picBytes: 100,
      picFilename: "pic.jpg",
    });

    const result = await executeWeiboOperationalAction({
      action: "upload_image",
      payload: { picUrl: "https://example.com/pic.jpg" },
      secret,
      credentialBindingId: "cred-weibo",
      externalAccountId: "12345",
    });

    expect(result.status).toBe("pic_uploaded");
    expect(result.picId).toBe("pic-99");
    expect(uploadPicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "token-1",
        picUrl: "https://example.com/pic.jpg",
      }),
    );
  });

  it("post_status publishes text with picId", async () => {
    postStatusMock.mockResolvedValue({
      idstr: "5012345678901234",
      mid: "mid-1",
      createdAt: "Mon Jan 01 00:00:00 +0800 2026",
    });

    const result = await executeWeiboOperationalAction({
      action: "post_status",
      payload: { message: "Hello Weibo", picId: "pic-99" },
      secret,
      credentialBindingId: "cred-weibo",
      externalAccountId: "12345",
    });

    expect(result.status).toBe("posted");
    expect(result.weiboId).toBe("5012345678901234");
    expect(postStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "token-1",
        status: "Hello Weibo",
        picId: "pic-99",
      }),
    );
  });

  it("post_status with picUrl uses upload endpoint", async () => {
    postStatusWithPicMock.mockResolvedValue({
      idstr: "5012345678909999",
    });

    await executeWeiboOperationalAction({
      action: "post_status",
      payload: {
        message: "带图微博",
        picUrl: "https://example.com/pic.jpg",
      },
      secret,
      credentialBindingId: "cred-weibo",
    });

    expect(postStatusWithPicMock).toHaveBeenCalled();
    expect(postStatusMock).not.toHaveBeenCalled();
  });

  it("rejects post_status without message", async () => {
    await expect(
      executeWeiboOperationalAction({
        action: "post_status",
        payload: {},
        secret,
        credentialBindingId: "cred-weibo",
      }),
    ).rejects.toThrow("post_status 需要 message");
  });
});

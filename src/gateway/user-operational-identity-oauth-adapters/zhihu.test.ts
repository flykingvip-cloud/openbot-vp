import { describe, expect, it } from "vitest";
import { zhihuOAuthAdapter } from "./zhihu.js";

describe("zhihu oauth adapter", () => {
  it("builds authorize url with scope and state", () => {
    const url = zhihuOAuthAdapter.buildAuthorizeUrl({
      config: {
        clientId: "zhihu-client",
        clientSecret: "secret",
        redirectUri: "https://example.com/callback",
      },
      state: "state-123",
    });
    expect(url).toContain("client_id=zhihu-client");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=state-123");
    expect(url).toContain("scope=");
  });

  it("returns null config when env is missing", () => {
    const previous = {
      clientId: process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_CLIENT_ID,
      clientSecret: process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_CLIENT_SECRET,
      redirectUri: process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_REDIRECT_URI,
    };
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_CLIENT_ID;
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_CLIENT_SECRET;
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_REDIRECT_URI;
    expect(zhihuOAuthAdapter.resolveConfig()).toBeNull();
    if (previous.clientId) {
      process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_CLIENT_ID = previous.clientId;
    }
    if (previous.clientSecret) {
      process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_CLIENT_SECRET = previous.clientSecret;
    }
    if (previous.redirectUri) {
      process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_REDIRECT_URI = previous.redirectUri;
    }
  });
});

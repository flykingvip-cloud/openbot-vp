// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSalesforceAuthorizeUrl,
  exchangeSalesforceAuthorizationCode,
  resolveSalesforceOAuthConfig,
} from "./salesforce-oauth.js";

describe("salesforce oauth adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns null config when client credentials are absent", () => {
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_SALESFORCE_CLIENT_ID", "");
    vi.stubEnv("OPENBOT_SALESFORCE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_SALESFORCE_CLIENT_SECRET", "");
    vi.stubEnv("OPENBOT_SALESFORCE_OAUTH_CLIENT_SECRET", "");
    expect(resolveSalesforceOAuthConfig({ redirectUri: "https://app.example.com/cb" })).toBeNull();
  });

  it("resolves config from env with a redirect override and default login host", () => {
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_SALESFORCE_CLIENT_ID", "cid");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_SALESFORCE_CLIENT_SECRET", "csecret");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_SALESFORCE_LOGIN_URL", "");
    vi.stubEnv("OPENBOT_SALESFORCE_OAUTH_LOGIN_URL", "");
    const config = resolveSalesforceOAuthConfig({ redirectUri: "https://app.example.com/cb" });
    expect(config).not.toBeNull();
    expect(config?.clientId).toBe("cid");
    expect(config?.redirectUri).toBe("https://app.example.com/cb");
    expect(config?.loginUrl).toBe("https://login.salesforce.com");
  });

  it("builds an authorize URL with code response type, state and login host", () => {
    const url = buildSalesforceAuthorizeUrl({
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      state: "state-xyz",
      loginUrl: "https://test.salesforce.com",
    });
    expect(url).toContain("https://test.salesforce.com/services/oauth2/authorize");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=state-xyz");
  });

  it("exchanges an authorization code for an access token + instance url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "tok-123",
              instance_url: "https://na1.my.salesforce.com",
              refresh_token: "refresh-1",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const result = await exchangeSalesforceAuthorizationCode({
      code: "code-1",
      redirectUri: "https://app.example.com/cb",
      clientId: "cid",
      clientSecret: "csecret",
    });
    expect(result.accessToken).toBe("tok-123");
    expect(result.instanceUrl).toBe("https://na1.my.salesforce.com");
    expect(result.refreshToken).toBe("refresh-1");
  });

  it("throws when token exchange returns a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_grant", { status: 400 })),
    );
    await expect(
      exchangeSalesforceAuthorizationCode({
        code: "bad",
        redirectUri: "https://app.example.com/cb",
        clientId: "cid",
        clientSecret: "csecret",
      }),
    ).rejects.toThrow();
  });
});

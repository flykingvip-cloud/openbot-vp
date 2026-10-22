import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildYonyouTplusAuthorizeUrl,
  exchangeYonyouTplusAuthorizationCode,
  readYonyouTplusCredentialInput,
  refreshYonyouTplusAccessToken,
  resolveYonyouTplusOAuthConfig,
  yonyouTplusCredentialInputHasMaterial,
} from "./yonyou-tplus-oauth.js";

const ENV_KEYS = [
  "OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY",
  "OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET",
  "OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_ORG_ID",
  "OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_NAME",
  "OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_REDIRECT_URI",
  "OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_GATEWAY",
] as const;

describe("yonyou tplus oauth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("builds the Chanjet market authorize URL", () => {
    const url = new URL(
      buildYonyouTplusAuthorizeUrl({
        appKey: "ak-test",
        orgId: "90001198862",
        appName: "tpluscloud",
        state: "state-1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://market.chanjet.com/user/v2/authorize");
    expect(url.searchParams.get("appKey")).toBe("ak-test");
    expect(url.searchParams.get("orgId")).toBe("90001198862");
    expect(url.searchParams.get("appName")).toBe("tpluscloud");
    expect(url.searchParams.get("scope")).toBe("auth_all");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("defaults appName to tpluscloud", () => {
    const url = new URL(
      buildYonyouTplusAuthorizeUrl({
        appKey: "ak-test",
        orgId: "org-1",
        state: "state-1",
      }),
    );
    expect(url.searchParams.get("appName")).toBe("tpluscloud");
  });

  it("requires app key, secret, redirect, and org id before live oauth", () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    expect(
      resolveYonyouTplusOAuthConfig({ redirectUri: "https://gw.example/cb", orgId: "1" }),
    ).toBe(null);
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY", "ak-test");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET", "as-test");
    expect(resolveYonyouTplusOAuthConfig()).toBeNull();
    const config = resolveYonyouTplusOAuthConfig({
      redirectUri: "https://gw.example/cb",
      orgId: "90001198862",
      appName: "Tplus",
    });
    expect(config).toMatchObject({
      appKey: "ak-test",
      appSecret: "as-test",
      orgId: "90001198862",
      appName: "Tplus",
      redirectUri: "https://gw.example/cb",
      gatewayOrigin: "https://openapi.chanjet.com",
    });
  });

  it("exchanges an authorization code at /auth/v2/getToken", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        code: "200",
        message: "成功",
        result: {
          access_token: "open-token-1",
          refresh_token: "refresh-1",
          user_auth_permanent_code: "perm-1",
          org_id: "90001198862",
          app_name: "tpluscloud",
          sid: "6",
          expires_in: 518400,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await exchangeYonyouTplusAuthorizationCode({
      appKey: "ak-test",
      appSecret: "as-test",
      code: "c-temp",
      redirectUri: "https://gw.example/oauth/callback",
    });
    expect(result.accessToken).toBe("open-token-1");
    expect(result.refreshToken).toBe("refresh-1");
    expect(result.permanentCode).toBe("perm-1");
    expect(result.orgId).toBe("90001198862");
    expect(result.appName).toBe("tpluscloud");
    expect(result.sid).toBe("6");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://openapi.chanjet.com/auth/v2/getToken?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("grantType")).toBe("authorization_code");
    expect(parsed.searchParams.get("code")).toBe("c-temp");
    expect(parsed.searchParams.get("redirectUri")).toBe("https://gw.example/oauth/callback");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      appKey: "ak-test",
      appSecret: "as-test",
      "Content-Type": "application/json",
    });
  });

  it("refreshes a token at /auth/v2/refreshToken", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        code: "200",
        result: {
          access_token: "open-token-2",
          refresh_token: "refresh-2",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await refreshYonyouTplusAccessToken({
      appKey: "ak-test",
      appSecret: "as-test",
      refreshToken: "refresh-1",
    });
    expect(result.accessToken).toBe("open-token-2");
    expect(result.refreshToken).toBe("refresh-2");
    const [url] = fetchMock.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/auth/v2/refreshToken");
    expect(parsed.searchParams.get("grantType")).toBe("refresh_token");
    expect(parsed.searchParams.get("refreshToken")).toBe("refresh-1");
  });

  it("reads credential upsert fields without treating blanks as values", () => {
    const input = readYonyouTplusCredentialInput({
      appKey: " ak ",
      appSecret: "",
      openToken: "token-1",
      orgId: " 9000 ",
    });
    expect(input).toEqual({
      appKey: "ak",
      appSecret: undefined,
      openToken: "token-1",
      refreshToken: undefined,
      permanentCode: undefined,
      orgId: "9000",
      appName: undefined,
      sid: undefined,
      idMarketingOrgan: undefined,
    });
    expect(yonyouTplusCredentialInputHasMaterial(input)).toBe(true);
    expect(yonyouTplusCredentialInputHasMaterial({})).toBe(false);
  });
});

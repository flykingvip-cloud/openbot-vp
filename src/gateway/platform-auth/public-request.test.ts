import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../../test-utils/env.js";
import {
  isConfiguredPublicPlatformRequest,
  isLocalOrConfiguredPublicPlatformAccess,
  resolvePublicPlatformBaseUrl,
  resolvePublicPlatformBaseUrls,
} from "./public-request.js";

function makeRequest(params: {
  host?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  remoteAddress?: string;
}): IncomingMessage {
  const req = {
    headers: {
      ...(params.host ? { host: params.host } : {}),
      ...(params.forwardedHost ? { "x-forwarded-host": params.forwardedHost } : {}),
      ...(params.forwardedProto ? { "x-forwarded-proto": params.forwardedProto } : {}),
    },
    socket: { remoteAddress: params.remoteAddress ?? "127.0.0.1" },
  } as IncomingMessage;
  return req;
}

describe("public-request", () => {
  it("detects configured public reverse-proxy requests", async () => {
    await withEnvAsync({ OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love" }, async () => {
      const req = makeRequest({
        host: "www.openbot.love",
        forwardedHost: "www.openbot.love",
        forwardedProto: "https",
        remoteAddress: "127.0.0.1",
      });
      expect(isConfiguredPublicPlatformRequest(req)).toBe(true);
      expect(isLocalOrConfiguredPublicPlatformAccess({ req, localDirect: false })).toBe(true);
    });
  });

  it("rejects public host when env base URL is unset", async () => {
    await withEnvAsync(
      {
        OPENBOT_PUBLIC_APP_BASE_URL: undefined,
        OPENBOT_PUBLIC_APP_BASE_URLS: undefined,
        OPENBOT_PUBLIC_HOME_BASE_URL: undefined,
        OPENBOT_PUBLIC_WEB_BASE_URL: undefined,
        OPENBOT_PUBLIC_BASE_URL: undefined,
        OPENCLAW_PUBLIC_APP_BASE_URL: undefined,
        OPENCLAW_PUBLIC_APP_BASE_URLS: undefined,
        OPENCLAW_PUBLIC_HOME_BASE_URL: undefined,
        OPENCLAW_PUBLIC_WEB_BASE_URL: undefined,
        OPENCLAW_PUBLIC_BASE_URL: undefined,
      },
      async () => {
        const req = makeRequest({
          host: "www.openbot.love",
          forwardedHost: "www.openbot.love",
          forwardedProto: "https",
        });
        expect(isConfiguredPublicPlatformRequest(req)).toBe(false);
        expect(isLocalOrConfiguredPublicPlatformAccess({ req, localDirect: false })).toBe(false);
      },
    );
  });

  it("treats localDirect as sufficient without forwarded headers", async () => {
    const req = makeRequest({ host: "127.0.0.1:18789" });
    expect(isLocalOrConfiguredPublicPlatformAccess({ req, localDirect: true })).toBe(true);
  });

  it("allows enterprise/biz host when listed beside admin in APP_BASE_URLS", async () => {
    await withEnvAsync(
      {
        OPENBOT_PUBLIC_APP_BASE_URL: "https://admin.openbot.love",
        OPENBOT_PUBLIC_APP_BASE_URLS:
          "https://admin.openbot.love,https://biz.openbot.love,https://gw.openbot.love",
        OPENBOT_PUBLIC_HOME_BASE_URL: "https://www.openbot.love",
      },
      async () => {
        expect(resolvePublicPlatformBaseUrl()).toBe("https://admin.openbot.love");
        expect(resolvePublicPlatformBaseUrls()).toEqual([
          "https://admin.openbot.love",
          "https://biz.openbot.love",
          "https://gw.openbot.love",
          "https://www.openbot.love",
        ]);

        const bizReq = makeRequest({
          host: "biz.openbot.love",
          forwardedHost: "biz.openbot.love",
          forwardedProto: "https",
        });
        expect(isConfiguredPublicPlatformRequest(bizReq)).toBe(true);

        const gwReq = makeRequest({
          host: "gw.openbot.love",
          forwardedHost: "gw.openbot.love",
          forwardedProto: "https",
        });
        expect(isConfiguredPublicPlatformRequest(gwReq)).toBe(true);

        const wwwReq = makeRequest({
          host: "www.openbot.love",
          forwardedHost: "www.openbot.love",
          forwardedProto: "https",
        });
        expect(isConfiguredPublicPlatformRequest(wwwReq)).toBe(true);
      },
    );
  });

  it("accepts comma-separated OPENBOT_PUBLIC_APP_BASE_URL values", async () => {
    await withEnvAsync(
      {
        OPENBOT_PUBLIC_APP_BASE_URL:
          "https://admin.openbot.love, https://biz.openbot.love, https://openbot.love",
        OPENBOT_PUBLIC_APP_BASE_URLS: undefined,
        OPENBOT_PUBLIC_HOME_BASE_URL: undefined,
      },
      async () => {
        expect(resolvePublicPlatformBaseUrl()).toBe("https://admin.openbot.love");
        const bizReq = makeRequest({
          forwardedHost: "biz.openbot.love",
          forwardedProto: "https",
        });
        expect(isConfiguredPublicPlatformRequest(bizReq)).toBe(true);
      },
    );
  });
});

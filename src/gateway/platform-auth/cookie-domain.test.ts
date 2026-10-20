import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { buildClearedCookieHeader, buildCookieHeader } from "./auth-helpers.js";
import { resolvePlatformAuthConfig } from "./config.js";

function secureRequest(host = "www.openbot.example.com"): IncomingMessage {
  return {
    headers: { host, "x-forwarded-proto": "https" },
    socket: {},
  } as unknown as IncomingMessage;
}

describe("platform auth cookie domain", () => {
  it("normalizes an explicitly configured parent domain", () => {
    const config = resolvePlatformAuthConfig({
      userHeader: "x-forwarded-user",
      platformAuth: { enabled: true, cookieDomain: ".OpenBot.Example.com" },
    });

    expect(config?.cookieDomain).toBe("openbot.example.com");
  });

  it("keeps the default cookie host-only", () => {
    const config = resolvePlatformAuthConfig({
      userHeader: "x-forwarded-user",
      platformAuth: { enabled: true },
    });

    expect(config?.cookieDomain).toBeUndefined();
    expect(buildCookieHeader(secureRequest(), "session", "signed", 60)).not.toContain("Domain=");
  });

  it("uses the same parent domain for session issuance and logout", () => {
    const issued = buildCookieHeader(
      secureRequest(),
      "session",
      "signed",
      60,
      "openbot.example.com",
    );
    const cleared = buildClearedCookieHeader(secureRequest(), "session", "openbot.example.com");

    expect(issued).toContain("Domain=openbot.example.com");
    expect(issued).toContain("Secure");
    expect(cleared).toContain("Domain=openbot.example.com");
    expect(cleared).toContain("Max-Age=0");
  });

  it("refuses to issue a configured parent-domain cookie for an unrelated host", () => {
    expect(() =>
      buildCookieHeader(
        secureRequest("attacker.example.net"),
        "session",
        "signed",
        60,
        "openbot.example.com",
      ),
    ).toThrow("cookieDomain does not match the request host");
  });

  it.each(["localhost", "bad domain.example", "example.com; Secure", "-bad.example.com"])(
    "rejects unsafe cookie domain %s",
    (cookieDomain) => {
      expect(() =>
        resolvePlatformAuthConfig({
          userHeader: "x-forwarded-user",
          platformAuth: { enabled: true, cookieDomain },
        }),
      ).toThrow("cookieDomain must be a DNS domain");
    },
  );
});

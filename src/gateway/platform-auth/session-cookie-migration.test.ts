import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  parseCookieHeader,
  parseCookieHeaderValues,
  pickValidPlatformAuthCookieValue,
} from "./session-context.js";

function reqWithCookie(cookie: string): IncomingMessage {
  return { headers: { cookie } } as IncomingMessage;
}

function sign(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

describe("platform auth cookie Domain= migration", () => {
  const secret = "test-secret";
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const valid = `${sessionId}.${sign(secret, sessionId)}`;

  it("skips empty host-only duplicates when listing cookie values", () => {
    const values = parseCookieHeaderValues(
      reqWithCookie(`openbot_platform_session=; openbot_platform_session=${valid}`),
      "openbot_platform_session",
    );
    expect(values).toEqual([valid]);
  });

  it("lists both stale host-only and valid Domain cookies", () => {
    const values = parseCookieHeaderValues(
      reqWithCookie(`openbot_platform_session=dead.beef; openbot_platform_session=${valid}`),
      "openbot_platform_session",
    );
    expect(values).toEqual(["dead.beef", valid]);
  });

  it("parseCookieHeader no longer stops on an empty first duplicate", () => {
    expect(
      parseCookieHeader(
        reqWithCookie(`openbot_platform_session=; openbot_platform_session=${valid}`),
        "openbot_platform_session",
      ),
    ).toBe(valid);
  });

  it("pickValidPlatformAuthCookieValue prefers the HMAC-valid duplicate", () => {
    expect(
      pickValidPlatformAuthCookieValue({
        values: ["dead.beef", valid],
        secret,
        sessions: {
          [sessionId]: {
            id: sessionId,
            userId: "user-1",
            createdAt: "2026-08-06T00:00:00.000Z",
            updatedAt: "2026-08-06T00:00:00.000Z",
            sessionIssuedAt: "2026-08-06T00:00:00.000Z",
            expiresAt: "2026-08-13T00:00:00.000Z",
            sessionKind: "platform-super-admin",
            domain: "platform",
          },
        },
      }),
    ).toBe(valid);
  });

  it("pickValidPlatformAuthCookieValue rejects valid signatures for missing sessions", () => {
    expect(
      pickValidPlatformAuthCookieValue({
        values: [valid],
        secret,
        sessions: {},
      }),
    ).toBeNull();
  });
});

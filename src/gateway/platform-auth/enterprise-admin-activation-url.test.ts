import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  buildEnterpriseAdminActivationUrl,
  resolveEnterpriseAdminActivationOrigin,
} from "./routes-enterprise.js";

function makeReq(host: string): IncomingMessage {
  return {
    headers: { host },
    socket: { remoteAddress: "127.0.0.1" },
  } as IncomingMessage;
}

describe("buildEnterpriseAdminActivationUrl", () => {
  it("rewrites admin origin to biz and uses authMode + enterprise/login", () => {
    const prev = process.env.OPENBOT_PUBLIC_APP_BASE_URL;
    process.env.OPENBOT_PUBLIC_APP_BASE_URL = "https://admin.openbot.love";
    try {
      expect(resolveEnterpriseAdminActivationOrigin(makeReq("admin.openbot.love"))).toBe(
        "https://biz.openbot.love",
      );
      const url = buildEnterpriseAdminActivationUrl({
        req: makeReq("admin.openbot.love"),
        code: "ADMIN-ABC123",
        email: "admin@acme.test",
        adminName: "张三",
      });
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://biz.openbot.love");
      expect(parsed.pathname).toBe("/enterprise/login");
      expect(parsed.searchParams.get("authMode")).toBe("enterprise-activate");
      expect(parsed.searchParams.get("code")).toBe("ADMIN-ABC123");
      expect(parsed.searchParams.get("email")).toBe("admin@acme.test");
      expect(parsed.searchParams.get("name")).toBe("张三");
      expect(parsed.hash).toBe("#auth");
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_PUBLIC_APP_BASE_URL;
      } else {
        process.env.OPENBOT_PUBLIC_APP_BASE_URL = prev;
      }
    }
  });
});

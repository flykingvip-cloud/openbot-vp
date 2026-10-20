import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { buildEmployeeActivationUrl, resolveEmployeeActivationOrigin } from "./routes-employee.js";

function makeReq(host: string): IncomingMessage {
  return {
    headers: { host },
    socket: { remoteAddress: "127.0.0.1" },
  } as IncomingMessage;
}

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("buildEmployeeActivationUrl", () => {
  it("rewrites enterprise/admin/gw hosts to the employee surface", () => {
    withEnv(
      {
        OPENBOT_PUBLIC_APP_BASE_URL: "https://admin.openbot.love",
        OPENBOT_PUBLIC_EMPLOYEE_BASE_URL: undefined,
        OPENBOT_PUBLIC_HOME_BASE_URL: undefined,
      },
      () => {
        expect(resolveEmployeeActivationOrigin(makeReq("biz.openbot.love"))).toBe(
          "https://www.openbot.love",
        );
        const url = buildEmployeeActivationUrl({
          req: makeReq("biz.openbot.love"),
          code: "EMP-123456",
          email: "member@example.com",
          employeeName: "张三",
        });
        const parsed = new URL(url);
        expect(parsed.origin).toBe("https://www.openbot.love");
        expect(parsed.pathname).toBe("/me");
        expect(parsed.searchParams.get("authMode")).toBe("employee-register");
        expect(parsed.searchParams.get("code")).toBe("EMP-123456");
        expect(url).not.toContain("biz.openbot.love");
        expect(url).not.toContain("admin.openbot.love");
        expect(url).not.toContain("/enterprise/login");
      },
    );
  });

  it("does not trust a biz HOME or EMPLOYEE base as the employee login origin", () => {
    withEnv(
      {
        OPENBOT_PUBLIC_APP_BASE_URL: "https://admin.openbot.love",
        OPENBOT_PUBLIC_EMPLOYEE_BASE_URL: "https://biz.openbot.love",
        OPENBOT_PUBLIC_HOME_BASE_URL: "https://biz.openbot.love",
      },
      () => {
        const url = buildEmployeeActivationUrl({
          req: makeReq("biz.openbot.love"),
          code: "EMP-999",
          email: "hire@example.com",
        });
        expect(url.startsWith("https://www.openbot.love/me?")).toBe(true);
        expect(url).toContain("authMode=employee-register");
        expect(url).not.toContain("biz.openbot.love");
        expect(url).not.toContain("/enterprise/login");
      },
    );
  });

  it("keeps loopback origins for local Control UI", () => {
    withEnv(
      {
        OPENBOT_PUBLIC_APP_BASE_URL: undefined,
        OPENBOT_PUBLIC_EMPLOYEE_BASE_URL: undefined,
        OPENBOT_PUBLIC_HOME_BASE_URL: undefined,
        OPENBOT_PUBLIC_WEB_BASE_URL: undefined,
        OPENBOT_PUBLIC_BASE_URL: undefined,
      },
      () => {
        expect(resolveEmployeeActivationOrigin(makeReq("127.0.0.1:18789"))).toBe(
          "http://127.0.0.1:18789",
        );
      },
    );
  });
});

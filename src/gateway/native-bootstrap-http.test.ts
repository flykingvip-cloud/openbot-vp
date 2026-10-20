import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeBootstrapHttpHandler,
  type NativeBootstrapHttpDeps,
} from "./native-bootstrap-http.js";
import type { ResolvedPlatformAuthConfig } from "./platform-auth/config.js";
import type { PlatformAuthSessionContext, PlatformAuthStore } from "./platform-auth/store-types.js";

type FakeRes = ServerResponse & {
  _headers: Record<string, unknown>;
  _body: () => string;
};

function makeRes(): FakeRes {
  const headers: Record<string, unknown> = {};
  let body = "";
  let ended = false;
  const res = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(chunk?: string) {
      if (chunk) {
        body += chunk;
      }
      ended = true;
    },
    write(chunk: string) {
      body += chunk;
    },
    get headersSent() {
      return ended;
    },
    _headers: headers,
    _body: () => body,
  };
  return res as unknown as FakeRes;
}

function makeReq(url: string, method: string): IncomingMessage {
  return { url, method, headers: {} } as unknown as IncomingMessage;
}

const fakeConfig = {
  cookieName: "openbot_session",
  sessionTtlHours: 24,
} as ResolvedPlatformAuthConfig;
const fakeStore = { users: {} } as unknown as PlatformAuthStore;
const employeeContext = {
  user: { id: "user-1", email: "employee@example.com" },
  membership: {
    id: "membership-1",
    userId: "user-1",
    enterpriseId: "enterprise-1",
    membershipRole: "member",
  },
  enterprise: { id: "enterprise-1" },
  sessionKind: "member",
} as unknown as PlatformAuthSessionContext;

function baseDeps(overrides?: Partial<NativeBootstrapHttpDeps>): Partial<NativeBootstrapHttpDeps> {
  return {
    resolvePlatformAuthConfig: () => fakeConfig,
    loadStore: async () => fakeStore,
    readSessionContext: async () => employeeContext,
    resolveEmployeeSessionContext: () => employeeContext,
    establishSessionCookie: async ({ res }) => {
      res.setHeader("Set-Cookie", ["openbot_session=signed.value; HttpOnly; SameSite=Lax; Path=/"]);
    },
    ...overrides,
  };
}

async function mintToken(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  target: string,
): Promise<string> {
  const res = makeRes();
  await handler(
    makeReq(`/native/bootstrap/mint?target=${encodeURIComponent(target)}`, "POST"),
    res,
  );
  const body = JSON.parse(res._body()) as { token: string };
  return body.token;
}

describe("/native/bootstrap/mint", () => {
  it("returns 401 without an authenticated session", async () => {
    const handler = createNativeBootstrapHttpHandler(
      baseDeps({ readSessionContext: async () => null }),
    );
    const res = makeRes();
    const handled = await handler(
      makeReq("/native/bootstrap/mint?target=/embed/employee/overview", "POST"),
      res,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
  });

  it("rejects an authenticated but unbound platform session", async () => {
    const handler = createNativeBootstrapHttpHandler(
      baseDeps({
        readSessionContext: async () => ({
          ...employeeContext,
          membership: null,
          enterprise: null,
          sessionKind: "platform-super-admin",
        }),
      }),
    );
    const res = makeRes();
    await handler(makeReq("/native/bootstrap/mint?target=/embed/employee/overview", "POST"), res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects non-POST with 405", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const res = makeRes();
    await handler(makeReq("/native/bootstrap/mint", "GET"), res);
    expect(res.statusCode).toBe(405);
    expect(res.getHeader("allow")).toBe("POST");
  });

  it("mints a single-use token + bootstrap path for the authenticated user", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const res = makeRes();
    await handler(makeReq("/native/bootstrap/mint?target=/embed/employee/workspace", "POST"), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res._body());
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe("string");
    expect(body.target).toBe("/embed/employee/workspace");
    expect(body.bootstrapPath).toContain("/native/bootstrap?token=");
    expect(body.bootstrapPath).toContain("target=%2Fembed%2Femployee%2Fworkspace");
  });

  it("coerces an unsafe mint target to the default surface", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const res = makeRes();
    await handler(makeReq("/native/bootstrap/mint?target=https://evil.com", "POST"), res);
    const body = JSON.parse(res._body());
    expect(body.target).toBe("/embed/employee/overview");
  });

  it("mints the site homepage as a bootstrap target", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const res = makeRes();
    await handler(makeReq("/native/bootstrap/mint?target=%2F", "POST"), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res._body());
    expect(body.target).toBe("/");
    expect(body.bootstrapPath).toContain("target=%2F");
  });
});

describe("/native/bootstrap (consume)", () => {
  it("consumes a token, sets a session cookie, and 302-redirects to the target", async () => {
    const establishSessionCookie = vi.fn(async ({ res }: { res: ServerResponse }) => {
      res.setHeader("Set-Cookie", ["openbot_session=signed; HttpOnly"]);
    });
    const resolveEmployeeSessionContext = vi.fn(() => employeeContext);
    const handler = createNativeBootstrapHttpHandler(
      baseDeps({ establishSessionCookie, resolveEmployeeSessionContext }),
    );
    const token = await mintToken(handler, "/embed/employee/workspace");

    const res = makeRes();
    await handler(
      makeReq(
        `/native/bootstrap?token=${encodeURIComponent(token)}&target=/embed/employee/workspace`,
        "GET",
      ),
      res,
    );
    expect(res.statusCode).toBe(302);
    expect(res.getHeader("location")).toBe("/embed/employee/workspace");
    expect(res.getHeader("set-cookie")).toBeTruthy();
    expect(establishSessionCookie).toHaveBeenCalledTimes(1);
    expect(resolveEmployeeSessionContext).toHaveBeenCalledWith(
      fakeStore,
      "user-1",
      "membership-1",
      "enterprise-1",
    );
  });

  it("is single-use: replaying a consumed token returns 401", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const token = await mintToken(handler, "/embed/employee/overview");

    const first = makeRes();
    await handler(makeReq(`/native/bootstrap?token=${encodeURIComponent(token)}`, "GET"), first);
    expect(first.statusCode).toBe(302);

    const second = makeRes();
    await handler(makeReq(`/native/bootstrap?token=${encodeURIComponent(token)}`, "GET"), second);
    expect(second.statusCode).toBe(401);
  });

  it("returns 401 for an unknown token and 400 when the token is missing", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());

    const unknown = makeRes();
    await handler(makeReq("/native/bootstrap?token=not-a-real-token", "GET"), unknown);
    expect(unknown.statusCode).toBe(401);

    const missing = makeRes();
    await handler(makeReq("/native/bootstrap", "GET"), missing);
    expect(missing.statusCode).toBe(400);
  });

  it("returns 401 when the bound user no longer exists", async () => {
    const handler = createNativeBootstrapHttpHandler(
      baseDeps({ resolveEmployeeSessionContext: () => null }),
    );
    const token = await mintToken(handler, "/embed/employee/overview");
    const res = makeRes();
    await handler(makeReq(`/native/bootstrap?token=${encodeURIComponent(token)}`, "GET"), res);
    expect(res.statusCode).toBe(401);
  });

  it("falls back to the minted target when the URL target is tampered", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const token = await mintToken(handler, "/embed/employee/workspace");
    const res = makeRes();
    await handler(
      makeReq(
        `/native/bootstrap?token=${encodeURIComponent(token)}&target=${encodeURIComponent("//evil.com")}`,
        "GET",
      ),
      res,
    );
    expect(res.statusCode).toBe(302);
    // Tampered URL target is rejected; the validated minted target is used.
    expect(res.getHeader("location")).toBe("/embed/employee/workspace");
  });

  it("rejects non-GET with 405", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const res = makeRes();
    await handler(makeReq("/native/bootstrap?token=x", "POST"), res);
    expect(res.statusCode).toBe(405);
    expect(res.getHeader("allow")).toBe("GET");
  });

  it("302-redirects to the site homepage when minted with target=/", async () => {
    const handler = createNativeBootstrapHttpHandler(baseDeps());
    const token = await mintToken(handler, "/");
    const res = makeRes();
    await handler(
      makeReq(
        `/native/bootstrap?token=${encodeURIComponent(token)}&target=${encodeURIComponent("/")}`,
        "GET",
      ),
      res,
    );
    expect(res.statusCode).toBe(302);
    expect(res.getHeader("location")).toBe("/");
  });
});

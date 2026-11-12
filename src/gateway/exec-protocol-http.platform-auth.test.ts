import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  TEST_TENANT,
  baseSubmitBody,
  inlineJsonInput,
  startIsolatedPair,
  uniqueIdempotencyKey,
  waitFor,
  type IsolatedPair,
} from "../exec-protocol/test-helpers.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "./control-ui-contract.js";
import { explicitIsolationFacadeFields } from "./exec-protocol-config.js";
import {
  EXEC_PROTOCOL_SHA256_HEADER,
  handleExecProtocolHttpRequest,
} from "./exec-protocol-http.js";
import { handleControlUiPlatformAuthRequest } from "./platform-auth.js";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import { makeMockHttpResponse } from "./test-http-response.js";

const PLATFORM_USER_EMAIL = "owner@iso-t166.example.com";
const PLATFORM_USER_PASSWORD = "password-123";

function makeJsonRequest(params: {
  url: string;
  method: "POST" | "GET";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}): IncomingMessage {
  const body = params.body ? JSON.stringify(params.body) : "";
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  Object.assign(req, {
    url: params.url,
    method: params.method,
    headers: params.headers ?? {},
  });
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: "127.0.0.1" },
    configurable: true,
  });
  return req;
}

function getPrimarySetCookie(
  setHeader: ReturnType<typeof makeMockHttpResponse>["setHeader"],
): string | undefined {
  const raw = setHeader.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.find((value): value is string => typeof value === "string" && value.includes("="));
  }
  return undefined;
}

function cookieHeader(setCookie: string): string {
  return setCookie.split(";")[0] ?? setCookie;
}

function platformTrustedProxy(storePath: string) {
  return {
    userHeader: "x-forwarded-user",
    platformAuth: {
      enabled: true,
      requireMfaForPlatformAdmins: false,
      store: storePath,
    },
  };
}

function platformAuthConfig(storePath: string): ResolvedGatewayAuth {
  return {
    mode: "trusted-proxy",
    allowTailscale: false,
    trustedProxy: platformTrustedProxy(storePath),
  };
}

describe("gateway exec-protocol HTTP facade (platformAuth cookie sessions)", () => {
  const servers: Server[] = [];
  const pairs: IsolatedPair[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    await Promise.all(pairs.splice(0).map((pair) => pair.stop()));
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  afterAll(async () => {
    await Promise.all(pairs.splice(0).map((pair) => pair.stop()));
  });

  async function startFacade(params: { pair: IsolatedPair; storePath: string }): Promise<string> {
    const execProtocol = {
      enabled: true,
      leaseToken: params.pair.leaseToken,
      controlPlaneUrl: params.pair.a.baseUrl,
      ...explicitIsolationFacadeFields(params.pair.configA),
    };
    const server = createServer((req, res) => {
      void handleExecProtocolHttpRequest(req, res, {
        auth: platformAuthConfig(params.storePath),
        trustedProxies: ["127.0.0.1", "::1"],
        execProtocol,
        env: {},
      }).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: { message: "not owned", type: "not_owned" } }));
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind platform-auth facade test port");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async function bootstrapPlatformStore(): Promise<{
    storePath: string;
    trustedProxy: ReturnType<typeof platformTrustedProxy>;
  }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-exec-protocol-pa-"));
    tempDirs.push(tempDir);
    const storePath = path.join(tempDir, "platform-auth.json");
    const trustedProxy = platformTrustedProxy(storePath);
    const bootstrapReq = makeJsonRequest({
      url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
      method: "POST",
      headers: { host: "127.0.0.1:18789" },
      body: {
        email: PLATFORM_USER_EMAIL,
        password: PLATFORM_USER_PASSWORD,
        displayName: "Isolation Owner",
      },
    });
    const bootstrap = makeMockHttpResponse();
    const handled = await handleControlUiPlatformAuthRequest(bootstrapReq, bootstrap.res, {
      trustedProxy,
      localDirect: true,
    });
    expect(handled).toBe(true);
    expect(bootstrap.res.statusCode).toBe(201);
    return { storePath, trustedProxy };
  }

  async function attachIsolationMembership(storePath: string): Promise<void> {
    const store = JSON.parse(await fs.readFile(storePath, "utf8")) as PlatformAuthStore;
    const ownerUser = Object.values(store.users).find(
      (user) => user.normalizedEmail === PLATFORM_USER_EMAIL,
    );
    expect(ownerUser).toBeDefined();
    if (!ownerUser) {
      throw new Error("expected bootstrap user");
    }
    const nowIso = new Date().toISOString();
    store.enterprises[TEST_TENANT] = {
      id: TEST_TENANT,
      name: "Isolation Tenant",
      slug: "isolation-tenant",
      status: "trial",
      plan: "trial",
      billingStatus: "trialing",
      createdSource: "self-service",
      createdAt: nowIso,
      updatedAt: nowIso,
      seatQuota: 5,
      seatUsed: 1,
    };
    store.memberships[`membership-owner-${TEST_TENANT}`] = {
      id: `membership-owner-${TEST_TENANT}`,
      userId: ownerUser.id,
      enterpriseId: TEST_TENANT,
      membershipRole: "enterprise-admin",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
  }

  async function loginCookie(
    trustedProxy: ReturnType<typeof platformTrustedProxy>,
    body: Record<string, unknown>,
  ): Promise<string> {
    const loginReq = makeJsonRequest({
      url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
      method: "POST",
      headers: { host: "127.0.0.1:18789" },
      body: {
        email: PLATFORM_USER_EMAIL,
        password: PLATFORM_USER_PASSWORD,
        ...body,
      },
    });
    const login = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(loginReq, login.res, {
      trustedProxy,
      localDirect: true,
    });
    expect(login.res.statusCode).toBe(200);
    const sessionCookie = getPrimarySetCookie(login.setHeader);
    expect(typeof sessionCookie).toBe("string");
    return cookieHeader(String(sessionCookie));
  }

  it("allows submit, status, and download with a membership-scoped enterprise cookie", async () => {
    const { storePath, trustedProxy } = await bootstrapPlatformStore();
    await attachIsolationMembership(storePath);
    const membershipCookie = await loginCookie(trustedProxy, {
      expectedSessionKind: "enterprise-admin",
    });

    const pair = await startIsolatedPair();
    pairs.push(pair);
    const url = await startFacade({ pair, storePath });
    const cookieHeaders = {
      "content-type": "application/json",
      cookie: membershipCookie,
    };

    const submittedRes = await fetch(`${url}/v1/exec-protocol/tasks`, {
      method: "POST",
      headers: cookieHeaders,
      body: JSON.stringify(
        baseSubmitBody({
          toolCallId: uniqueIdempotencyKey("tool"),
          input: inlineJsonInput({ message: "cookie-ok" }),
        }),
      ),
    });
    expect(submittedRes.status).toBe(201);
    const submitted = (await submittedRes.json()) as { taskId: string };
    expect(submitted.taskId).toMatch(/^tsk_[a-f0-9]{32}$/);

    const done = await waitFor(
      async () => {
        const statusRes = await fetch(`${url}/v1/exec-protocol/tasks/status`, {
          method: "POST",
          headers: cookieHeaders,
          body: JSON.stringify({ taskId: submitted.taskId }),
        });
        const payload = (await statusRes.json()) as {
          state?: string;
          artifacts?: Array<{ artifactId: string; sha256: string }>;
        };
        return { status: statusRes.status, payload };
      },
      (result) => result.status === 200 && result.payload.state === "succeeded",
    );
    const artifact = done.payload.artifacts?.[0];
    if (!artifact) {
      throw new Error("expected an artifact on the succeeded task");
    }

    const raw = await fetch(
      `${url}/v1/exec-protocol/tasks/${submitted.taskId}/artifacts/${artifact.artifactId}`,
      { headers: { cookie: membershipCookie } },
    );
    expect(raw.status).toBe(200);
    const rawBytes = new Uint8Array(await raw.arrayBuffer());
    expect(raw.headers.get(EXEC_PROTOCOL_SHA256_HEADER)).toBe(artifact.sha256);
    expect(rawBytes.byteLength).toBeGreaterThan(0);
  });

  it("returns 403 exec_protocol_tenant_required for an unbound platform-super-admin cookie", async () => {
    const { storePath, trustedProxy } = await bootstrapPlatformStore();
    await attachIsolationMembership(storePath);
    const platformCookie = await loginCookie(trustedProxy, {
      expectedPlatformRole: "admin",
    });

    const pair = await startIsolatedPair();
    pairs.push(pair);
    const url = await startFacade({ pair, storePath });

    const res = await fetch(`${url}/v1/exec-protocol/tasks/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: platformCookie,
      },
      body: JSON.stringify({ taskId: "tsk_dummy" }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error?: { type?: string } };
    expect(json.error?.type).toBe("exec_protocol_tenant_required");
  });
});

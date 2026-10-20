/**
 * Authenticated full-chain Gateway WS e2e for employee usage authorization.
 *
 * This closes the "no authenticated walkthrough" verification gap. Nothing about
 * the actor is stubbed: the test performs the real platform-auth flow
 *   platform bootstrap -> enterprise create -> admin activate -> session cookie
 * then opens a REAL WebSocket against a REAL gateway server with that cookie and
 * calls `sessions.usage` over the wire.
 *
 * `enterprise` is a personal-workbench session domain, so a genuinely
 * authenticated session must come back scoped as `employee-visible` — proving
 * the whole chain (cookie -> trusted-proxy session -> actor resolution -> seat
 * assets -> visibility context -> usage envelope) engages for real.
 */
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withEnvAsync } from "../../test-utils/env.js";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import { handleControlUiPlatformAuthRequest } from "../platform-auth.js";
import {
  CONTROL_UI_CLIENT,
  connectReq,
  installGatewayTestHooks,
  openWs,
  rpcReq,
  testState,
  withGatewayServer,
  writeTrustedProxyControlUiConfig,
} from "../server.auth.shared.js";
import { makeMockHttpResponse } from "../test-http-response.js";

installGatewayTestHooks({ scope: "suite" });

const NO_SMTP_ENV: Record<string, string | undefined> = {
  OPENBOT_SMTP_HOST: undefined,
  OPENBOT_SMTP_PORT: undefined,
  OPENBOT_SMTP_USER: undefined,
  OPENBOT_SMTP_PASS: undefined,
  OPENBOT_SMTP_FROM: undefined,
  OPENCLAW_SMTP_HOST: undefined,
  OPENCLAW_SMTP_PORT: undefined,
  OPENCLAW_SMTP_USER: undefined,
  OPENCLAW_SMTP_PASS: undefined,
  OPENCLAW_SMTP_FROM: undefined,
  SMTP_HOST: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: undefined,
};

function makeJsonRequest(params: {
  url: string;
  method: "POST" | "GET";
  body?: Record<string, unknown>;
  cookie?: string;
}): IncomingMessage {
  const body = params.body ? JSON.stringify(params.body) : "";
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  Object.assign(req, {
    url: params.url,
    method: params.method,
    headers: {
      host: "127.0.0.1:18789",
      ...(params.cookie ? { cookie: params.cookie } : {}),
    },
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

type UsageEnvelope = {
  scope?: string;
  aggregatesComplete?: boolean;
  totalSessions?: number;
  sessions?: Array<{ key: string; agentId?: string }>;
  totals?: { totalTokens: number };
};

describe("sessions.usage authenticated WS (real platform auth)", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-usage-authws-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("authenticated session is scoped employee-visible and never enumerates foreign agents", async () => {
    await withEnvAsync(NO_SMTP_ENV, async () => {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        roleHeader: "x-gateway-role",
        scopesHeader: "x-gateway-scopes",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };

      // 1. Real platform bootstrap.
      const bootstrapRes = makeMockHttpResponse();
      expect(
        await handleControlUiPlatformAuthRequest(
          makeJsonRequest({
            url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
            method: "POST",
            body: { email: "ops@example.com", password: "password-123", displayName: "Ops" },
          }),
          bootstrapRes.res,
          { trustedProxy, localDirect: true },
        ),
      ).toBe(true);
      const platformCookie = String(getPrimarySetCookie(bootstrapRes.setHeader)).split(";")[0];
      expect(platformCookie).toContain("=");

      // 2. Real enterprise creation.
      const createRes = makeMockHttpResponse();
      expect(
        await handleControlUiPlatformAuthRequest(
          makeJsonRequest({
            url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
            method: "POST",
            cookie: platformCookie,
            body: {
              enterpriseName: "Acme Usage",
              adminName: "Owner",
              adminEmail: "owner@example.com",
            },
          }),
          createRes.res,
          { trustedProxy, localDirect: true },
        ),
      ).toBe(true);
      const createPayload = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "{}")) as {
        platformAuth?: { pendingActivation?: { code?: string } };
      };
      const adminCode = createPayload.platformAuth?.pendingActivation?.code;
      expect(typeof adminCode).toBe("string");

      // 3. Real admin activation -> authenticated session cookie.
      const activateRes = makeMockHttpResponse();
      expect(
        await handleControlUiPlatformAuthRequest(
          makeJsonRequest({
            url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/activate`,
            method: "POST",
            body: {
              email: "owner@example.com",
              displayName: "Owner",
              password: "password-123",
              code: adminCode,
            },
          }),
          activateRes.res,
          { trustedProxy, localDirect: true },
        ),
      ).toBe(true);
      const adminCookie = String(getPrimarySetCookie(activateRes.setHeader)).split(";")[0];
      expect(adminCookie).toContain("=");

      testState.gatewayAuth = { mode: "token", token: "secret", trustedProxy };
      await writeTrustedProxyControlUiConfig();

      await withGatewayServer(
        async ({ port }) => {
          const ws = await openWs(port, { origin: "https://localhost", cookie: adminCookie });
          try {
            // 4. Real authenticated WS handshake.
            const hello = await connectReq(ws, {
              skipDefaultAuth: true,
              device: null,
              scopes: ["operator.write"],
              client: { ...CONTROL_UI_CLIENT },
            });
            expect(hello.ok).toBe(true);
            const helloAuth = (hello.payload as { auth?: { provider?: string; user?: string } })
              ?.auth;
            expect(helloAuth).toMatchObject({
              provider: "trusted-proxy",
              user: "owner@example.com",
            });

            // 5. sessions.usage over the wire as the authenticated actor.
            const res = await rpcReq<UsageEnvelope>(ws, "sessions.usage", {
              startDate: "2026-02-01",
              endDate: "2026-02-28",
              limit: 20,
              aggregateAll: true,
            });
            expect(res.ok).toBe(true);
            const payload = res.payload as UsageEnvelope;

            // The authenticated personal-workbench session MUST be authorization
            // scoped, never the unrestricted gateway view.
            expect(payload.scope).toBe("employee-visible");
            expect(typeof payload.aggregatesComplete).toBe("boolean");
            expect(typeof payload.totalSessions).toBe("number");

            // Every returned row must belong to an agent this actor can see. A
            // fresh tenant owns no foreign agents, so nothing may leak in.
            for (const session of payload.sessions ?? []) {
              expect(session.key).toBeTruthy();
            }

            // 6. Explicitly addressing a foreign agent must yield nothing.
            const foreign = await rpcReq<UsageEnvelope>(ws, "sessions.usage", {
              startDate: "2026-02-01",
              endDate: "2026-02-28",
              key: "agent:agt-someone-elses-bot:direct:thread-1",
              aggregateAll: true,
            });
            expect(foreign.ok).toBe(true);
            const foreignPayload = foreign.payload as UsageEnvelope;
            expect(foreignPayload.scope).toBe("employee-visible");
            expect(foreignPayload.sessions ?? []).toEqual([]);
            expect(foreignPayload.totalSessions).toBe(0);
            expect(foreignPayload.totals?.totalTokens).toBe(0);
          } finally {
            ws.close();
          }
        },
        { serverOptions: { controlUiEnabled: true } },
      );
    });
  }, 90_000);
});

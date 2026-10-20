/**
 * Trusted-proxy full-chain live Gateway WS e2e for evolution-runtime-closure.
 *
 * No membership / agent-tenant stubs. Real platform-auth:
 *   platform bootstrap → enterprise create/activate → cookie session on WS
 * then RPC: ingest → apply-limit → apply-redirect → snapshot.
 */
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withEnvAsync } from "../../test-utils/env.js";
import { upsertAgent } from "../agent-runtime-store.js";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import { setGovernanceKillSwitch } from "../evolution-governance/index.js";
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
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { makeMockHttpResponse } from "../test-http-response.js";
import {
  listPatternCandidates,
  resetPatternDetectionStoreForTests,
  structureHashFromText,
} from "./index.js";

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

function seedOwnedAgent(runtimeAgentId: string, tenantId: string) {
  const now = Date.now();
  upsertAgent({
    runtimeAgentId,
    name: runtimeAgentId,
    runtimeVersion: "1",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: [tenantId],
    boundCapabilityCount: 1,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: now,
    lastActiveAt: now,
  });
}

describe("evolution-runtime-closure trusted-proxy live WS", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-erc-tp-"));
    resetPatternDetectionStoreForTests();
    setGovernanceKillSwitch(false);
  });

  afterEach(async () => {
    setGovernanceKillSwitch(false);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("platform session cookie → WS ingest → limit → redirect → snapshot (no membership stub)", async () => {
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

      const bootstrapRes = makeMockHttpResponse();
      expect(
        await handleControlUiPlatformAuthRequest(
          makeJsonRequest({
            url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
            method: "POST",
            body: {
              email: "ops@example.com",
              password: "password-123",
              displayName: "Ops",
            },
          }),
          bootstrapRes.res,
          { trustedProxy, localDirect: true },
        ),
      ).toBe(true);
      const platformCookie = String(getPrimarySetCookie(bootstrapRes.setHeader)).split(";")[0];
      expect(platformCookie).toContain("=");

      const createRes = makeMockHttpResponse();
      expect(
        await handleControlUiPlatformAuthRequest(
          makeJsonRequest({
            url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
            method: "POST",
            cookie: platformCookie,
            body: {
              enterpriseName: "Acme Evolution",
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
      const activatePayload = JSON.parse(String(activateRes.end.mock.calls[0]?.[0] ?? "{}")) as {
        session?: { tenantId?: string; user?: string; scopes?: string[] };
      };
      const tenantId = canonicalizeTenantId(activatePayload.session?.tenantId ?? null);
      expect(tenantId).toBeTruthy();
      expect(activatePayload.session?.user).toBe("owner@example.com");
      expect(activatePayload.session?.scopes).toContain("operator.admin");
      const adminCookie = String(getPrimarySetCookie(activateRes.setHeader)).split(";")[0];
      expect(adminCookie).toContain("=");

      seedOwnedAgent("agent-a", tenantId!);
      seedOwnedAgent("agent-b", tenantId!);

      testState.gatewayAuth = {
        mode: "token",
        token: "secret",
        trustedProxy,
      };
      await writeTrustedProxyControlUiConfig();

      await withGatewayServer(
        async ({ port }) => {
          const ws = await openWs(port, {
            origin: "https://localhost",
            cookie: adminCookie,
          });
          try {
            const hello = await connectReq(ws, {
              skipDefaultAuth: true,
              device: null,
              // Client self-assert would claim write-only; scopesHeader forces session scopes.
              scopes: ["operator.write"],
              client: { ...CONTROL_UI_CLIENT },
            });
            expect(hello.ok).toBe(true);
            const helloAuth = (
              hello.payload as { auth?: { provider?: string; user?: string; scopes?: string[] } }
            )?.auth;
            expect(helloAuth).toMatchObject({
              provider: "trusted-proxy",
              user: "owner@example.com",
            });
            expect(helloAuth?.scopes).toContain("operator.admin");
            expect(helloAuth?.scopes).toContain("operator.approvals");

            const inHash = structureHashFromText("# tp ingest\n1. a");
            const outHash = structureHashFromText("# tp out\n- ok");
            for (let i = 1; i <= 3; i += 1) {
              const ingest = await rpcReq(ws, "pattern-detection.ingest-sample", {
                agentId: "agent-a",
                runId: `tp-run-${i}`,
                taskId: `tp-task-${i}`,
                inputStructureHash: inHash,
                outputStructureHash: outHash,
                toolsUsed: ["notes"],
                success: true,
              });
              expect(ingest.ok).toBe(true);
            }

            const candidates = listPatternCandidates({
              agentId: "agent-a",
              tenantId: tenantId!,
            });
            expect(candidates[0]?.tenantId).toBe(tenantId);
            expect(candidates[0]?.contract.toolsRequired).toEqual(["notes"]);

            const limit = await rpcReq<{ ok?: boolean }>(ws, "evolution-governance.apply-limit", {
              runtimeAgentId: "agent-a",
              reason: "tp-e2e-limit",
            });
            expect(limit.ok).toBe(true);
            expect(limit.payload?.ok).toBe(true);

            const redirect = await rpcReq<{ ok?: boolean }>(
              ws,
              "evolution-governance.apply-redirect",
              {
                runtimeAgentId: "agent-a",
                targetAgentId: "agent-b",
                reason: "tp-e2e-redirect",
              },
            );
            expect(redirect.ok).toBe(true);
            expect(redirect.payload?.ok).toBe(true);

            const snapshot = await rpcReq<{
              limits?: Record<string, unknown>;
              redirects?: Record<string, { targetAgentId?: string }>;
            }>(ws, "evolution-governance.snapshot", {});
            expect(snapshot.ok).toBe(true);
            expect(snapshot.payload?.limits?.["agent-a"]).toBeTruthy();
            expect(snapshot.payload?.redirects?.["agent-a"]?.targetAgentId).toBe("agent-b");
          } finally {
            ws.close();
          }
        },
        { serverOptions: { controlUiEnabled: true } },
      );
    });
  }, 90_000);
});

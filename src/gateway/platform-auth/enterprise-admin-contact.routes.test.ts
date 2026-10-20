import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import { makeMockHttpResponse } from "../test-http-response.js";
import { resolvePlatformAuthConfig } from "./config.js";
import { handleControlUiPlatformAuthRequest } from "./control-ui-dispatcher.js";
import { loadStore } from "./store.js";

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

describe("platform enterprise admin contact routes", () => {
  it("exposes contact on directory and supports update + resend", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-admin-contact-"));
    try {
      process.env.OPENCLAW_HOME = tempDir;
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };

      const bootstrap = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "ops@example.com",
            password: "password-123",
            displayName: "Ops",
          },
        }),
        bootstrap.res,
        { trustedProxy, localDirect: true },
      );
      const cookie = getPrimarySetCookie(bootstrap.setHeader);
      expect(cookie).toBeTruthy();
      const cookieHeader = String(cookie).split(";")[0] ?? "";

      const createRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/enterprise/create`,
          method: "POST",
          headers: { host: "127.0.0.1:18789", cookie: cookieHeader },
          body: {
            enterpriseName: "四惠物流",
            adminName: "李管理员",
            adminEmail: "admin@sihui.test",
            creationMode: "quick-trial",
          },
        }),
        createRes.res,
        { trustedProxy, localDirect: true },
      );
      const createPayload = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok?: boolean;
        platformAuth?: {
          platformEnterprises?: Array<{
            id?: string;
            name?: string;
            contact?: { contactName?: string; contactEmail?: string; status?: string };
          }>;
          pendingActivation?: {
            code?: string;
            email?: string;
            enterpriseId?: string;
            activationUrl?: string;
          };
        };
      };
      expect(createPayload.ok).toBe(true);
      const enterprise = createPayload.platformAuth?.platformEnterprises?.find(
        (entry) => entry.name === "四惠物流",
      );
      expect(enterprise?.contact).toEqual(
        expect.objectContaining({
          contactName: "李管理员",
          contactEmail: "admin@sihui.test",
          status: "pending_activation",
        }),
      );
      const enterpriseId = enterprise?.id;
      expect(enterpriseId).toBeTruthy();
      expect(createPayload.platformAuth?.pendingActivation?.enterpriseId).toBe(enterpriseId);
      expect(createPayload.platformAuth?.pendingActivation?.activationUrl).toMatch(
        /\/enterprise\/login\?.*authMode=enterprise-activate/,
      );
      expect(createPayload.platformAuth?.pendingActivation?.activationUrl).toContain(
        `code=${encodeURIComponent(createPayload.platformAuth?.pendingActivation?.code ?? "")}`,
      );

      const configAfterCreate = resolvePlatformAuthConfig(trustedProxy);
      expect(configAfterCreate).toBeTruthy();
      const storeAfterCreate = await loadStore(configAfterCreate!);
      const createNotification = Object.values(storeAfterCreate.leadNotifications).find(
        (entry) =>
          entry.type === "admin-activation-email" &&
          entry.enterpriseId === enterpriseId &&
          typeof entry.payload?.activationUrl === "string",
      );
      expect(createNotification?.payload).toEqual(
        expect.objectContaining({
          code: createPayload.platformAuth?.pendingActivation?.code,
          activationUrl: createPayload.platformAuth?.pendingActivation?.activationUrl,
          adminEmail: "admin@sihui.test",
        }),
      );

      const updateRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/enterprise/admin/update`,
          method: "POST",
          headers: { host: "127.0.0.1:18789", cookie: cookieHeader },
          body: {
            enterpriseId,
            adminName: "王管理员",
            adminEmail: "wang@sihui.test",
            resendActivation: true,
          },
        }),
        updateRes.res,
        { trustedProxy, localDirect: true },
      );
      const updatePayload = JSON.parse(String(updateRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok?: boolean;
        error?: string;
        platformAuth?: {
          platformEnterprises?: Array<{
            id?: string;
            contact?: { contactName?: string; contactEmail?: string; status?: string };
          }>;
          pendingActivation?: { email?: string; code?: string };
        };
      };
      expect(updatePayload.ok).toBe(true);
      expect(
        updatePayload.platformAuth?.platformEnterprises?.find((entry) => entry.id === enterpriseId)
          ?.contact,
      ).toEqual(
        expect.objectContaining({
          contactName: "王管理员",
          contactEmail: "wang@sihui.test",
          status: "pending_activation",
        }),
      );

      const resendRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/enterprise/admin/activation/send`,
          method: "POST",
          headers: { host: "127.0.0.1:18789", cookie: cookieHeader },
          body: { enterpriseId },
        }),
        resendRes.res,
        { trustedProxy, localDirect: true },
      );
      const resendPayload = JSON.parse(String(resendRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok?: boolean;
        platformAuth?: {
          pendingActivation?: {
            email?: string;
            code?: string;
            enterpriseId?: string;
            activationUrl?: string;
          };
        };
      };
      expect(resendPayload.ok).toBe(true);
      expect(resendPayload.platformAuth?.pendingActivation?.email).toBe("wang@sihui.test");
      expect(resendPayload.platformAuth?.pendingActivation?.enterpriseId).toBe(enterpriseId);
      expect(resendPayload.platformAuth?.pendingActivation?.activationUrl).toMatch(
        /authMode=enterprise-activate/,
      );
      expect(resendPayload.platformAuth?.pendingActivation?.activationUrl).toContain(
        "wang%40sihui.test",
      );

      const config = resolvePlatformAuthConfig(trustedProxy);
      expect(config).toBeTruthy();
      const store = await loadStore(config!);
      const pending = Object.values(store.adminProvisions).find(
        (entry) => entry.enterpriseId === enterpriseId && entry.status === "pending_activation",
      );
      expect(pending).toMatchObject({
        adminName: "王管理员",
        adminEmail: "wang@sihui.test",
      });
    } finally {
      delete process.env.OPENCLAW_HOME;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

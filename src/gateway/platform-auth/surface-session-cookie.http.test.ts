import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
/**
 * Real HTTP cookie jar. Proves a browser that stored both surface cookies
 * still sees only the cookie for the host it is on, and that an employee
 * session cannot mint a platform session by calling /session/switch.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import { assignSeatToEmployee, ensureSeatForProvision } from "../enterprise-seat-assets-store.js";
import { handleControlUiPlatformAuthRequest, type PlatformAuthStore } from "../platform-auth.js";
import { activateMfaEnrollment, enrollMfa } from "./mfa-store.js";
import { currentTotp } from "./mfa-totp.js";
import {
  loadSeatAssetsStoreForTenantId,
  saveSeatAssetsStoreForTenantId,
} from "./seat-store-loader.js";

const AUTH = CONTROL_UI_PLATFORM_AUTH_BASE_PATH;

type StoredCookie = {
  name: string;
  value: string;
  domain: string | null;
  host: string;
};

type HttpResult = {
  status: number;
  json: Record<string, unknown>;
  setCookie: string[];
};

function absorbCookies(jar: StoredCookie[], host: string, setCookie: string[]): void {
  const hostname = host.split(":")[0]?.toLowerCase() ?? host;
  for (const line of setCookie) {
    const parts = line.split(";").map((part) => part.trim());
    const pair = parts[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const domainAttr = parts.find((part) => part.toLowerCase().startsWith("domain="));
    const domain = domainAttr
      ? domainAttr.slice("domain=".length).replace(/^\./, "").toLowerCase()
      : null;
    const maxAge = parts.find((part) => part.toLowerCase().startsWith("max-age="));
    const cleared = !value || maxAge?.slice("max-age=".length) === "0";
    const kept = jar.filter((cookie) => cookie.name !== name || cookie.domain !== domain);
    jar.length = 0;
    jar.push(...kept);
    if (!cleared) {
      jar.push({ name, value, domain, host: hostname });
    }
  }
}

function cookieHeader(jar: StoredCookie[], host: string): string {
  const hostname = host.split(":")[0]?.toLowerCase() ?? host;
  return jar
    .filter((cookie) => {
      if (cookie.domain) {
        return hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
      }
      return cookie.host === hostname;
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function bindSeat(tenantId: string, employeeId: string): Promise<void> {
  const nowIso = "2026-10-17T00:00:00.000Z";
  const seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
  const seat = ensureSeatForProvision({
    store: seatStore,
    tenantId,
    seatTitle: `Seat ${tenantId}`,
    reuseByTitle: true,
    nowIso,
  });
  assignSeatToEmployee({
    store: seatStore,
    tenantId,
    seatId: seat.seatId,
    employeeId,
    nowIso,
  });
  await saveSeatAssetsStoreForTenantId(tenantId, seatStore);
}

describe("surface session cookies over HTTP", () => {
  let tempDir = "";
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps each host on its own cookie and refuses a platform switch from the employee host", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-surface-cookie-"));
    const storePath = path.join(tempDir, "platform-auth.json");
    const trustedProxy = {
      enabled: true,
      userHeader: "x-forwarded-user",
      platformAuth: {
        enabled: true,
        store: storePath,
        requireMfaForPlatformAdmins: true,
        cookieDomain: "openbot.love",
      },
    };
    server = http.createServer((req, res) => {
      void handleControlUiPlatformAuthRequest(req, res, { trustedProxy, localDirect: true });
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const jar: StoredCookie[] = [];

    const call = async (
      host: string,
      method: "GET" | "POST",
      urlPath: string,
      body?: Record<string, unknown>,
    ): Promise<HttpResult> => {
      const payload = body ? JSON.stringify(body) : "";
      const result = await new Promise<HttpResult>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            method,
            path: urlPath,
            headers: {
              host,
              origin: `https://${host}`,
              accept: "application/json",
              ...(payload
                ? {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(payload),
                  }
                : {}),
              cookie: cookieHeader(jar, host),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              const setCookie = res.headers["set-cookie"] ?? [];
              resolve({
                status: res.statusCode ?? 0,
                json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
                setCookie: Array.isArray(setCookie) ? setCookie : [setCookie],
              });
            });
          },
        );
        req.on("error", reject);
        if (payload) {
          req.write(payload);
        }
        req.end();
      });
      absorbCookies(jar, host, result.setCookie);
      return result;
    };

    const bootstrap = await call("www.openbot.love", "POST", `${AUTH}/platform/bootstrap`, {
      email: "root@example.com",
      password: "password-123",
      displayName: "Root",
    });
    expect(bootstrap.status).toBe(201);

    const store = JSON.parse(await fs.readFile(storePath, "utf8")) as PlatformAuthStore;
    const user = Object.values(store.users).find(
      (entry) => entry.normalizedEmail === "root@example.com",
    );
    expect(user).toBeTruthy();
    const nowIso = "2026-10-17T00:00:00.000Z";
    const enterpriseA = `ent-${randomUUID()}`;
    const enterpriseB = `ent-${randomUUID()}`;
    const names: Record<string, string> = { [enterpriseA]: "甲企业", [enterpriseB]: "乙企业" };
    for (const enterpriseId of [enterpriseA, enterpriseB]) {
      store.enterprises[enterpriseId] = {
        id: enterpriseId,
        name: names[enterpriseId] ?? enterpriseId,
        slug: enterpriseId,
        status: "paid",
        plan: "paid",
        createdSource: "platform-created",
        billingStatus: "active",
        createdAt: nowIso,
        updatedAt: nowIso,
        seatQuota: 5,
        seatUsed: 1,
      };
      store.memberships[`mem-${enterpriseId}`] = {
        id: `mem-${enterpriseId}`,
        userId: user!.id,
        enterpriseId,
        membershipRole: "member",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }
    await fs.writeFile(storePath, JSON.stringify(store));

    const ambiguous = await call("www.openbot.love", "POST", `${AUTH}/login`, {
      email: "root@example.com",
      password: "password-123",
      sessionDomain: "employee",
    });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.json.code).toBe("PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED");
    const choices = ambiguous.json.membershipChoices as Array<{
      membershipId: string;
      enterpriseId: string;
      enterpriseName: string;
    }>;
    expect(choices).toHaveLength(2);
    expect(new Set(choices.map((choice) => choice.enterpriseName))).toEqual(
      new Set(["甲企业", "乙企业"]),
    );

    const chosen = choices.find((choice) => choice.enterpriseId === enterpriseA);
    expect(chosen).toBeTruthy();
    const unverified = await call("www.openbot.love", "POST", `${AUTH}/login`, {
      email: "root@example.com",
      password: "password-123",
      sessionDomain: "employee",
      membershipId: chosen?.membershipId,
      tenantId: enterpriseA,
    });
    expect(unverified.status).toBe(409);
    expect(unverified.json.code).toBe("PLATFORM_AUTH_POSITION_UNVERIFIED");

    await bindSeat(enterpriseA, user!.id);
    const employee = await call("www.openbot.love", "POST", `${AUTH}/login`, {
      email: "root@example.com",
      password: "password-123",
      sessionDomain: "employee",
      membershipId: chosen?.membershipId,
      tenantId: enterpriseA,
    });
    expect(employee.status).toBe(200);
    expect((employee.json.platformAuth as { sessionKind?: string }).sessionKind).toBe("member");
    expect(jar.some((cookie) => cookie.name.endsWith("__employee"))).toBe(true);

    const elevated = await call("www.openbot.love", "POST", `${AUTH}/session/switch`, {
      targetSessionKind: "platform-super-admin",
    });
    expect(elevated.status).toBe(403);
    expect(elevated.json.code).toBe("PLATFORM_AUTH_PLATFORM_ENTRY_REQUIRED");
    expect(elevated.setCookie.some((line) => line.includes("__platform="))).toBe(false);

    const enrolled = await enrollMfa(user!.id, user!.email);
    const secret = new URL(enrolled.otpAuthUrl).searchParams.get("secret");
    expect(secret).toBeTruthy();
    expect(await activateMfaEnrollment(user!.id, currentTotp(secret!))).toBe(true);
    const platform = await call("admin.openbot.love", "POST", `${AUTH}/login`, {
      email: "root@example.com",
      password: "password-123",
      sessionDomain: "platform",
      expectedPlatformRole: "super-admin",
      mfaCode: enrolled.recoveryCodes[0],
    });
    expect(platform.status).toBe(200);
    expect(jar.some((cookie) => cookie.name.endsWith("__platform"))).toBe(true);
    const after = JSON.parse(await fs.readFile(storePath, "utf8")) as PlatformAuthStore;
    const platformSessions = Object.values(after.sessions).filter(
      (session) => session.domain === "platform",
    );
    // Bootstrap may already hold a platform session. Only the authenticator
    // login records verification strength; the older session stays unmarked.
    expect(platformSessions.filter((session) => session.mfaVerified === true)).toHaveLength(1);
    expect(platformSessions.some((session) => session.mfaVerified === undefined)).toBe(true);
    const employeeSession = Object.values(after.sessions).find(
      (session) => session.domain === "employee",
    );
    expect(employeeSession?.mfaVerified).toBeUndefined();

    const onEmployeeHost = await call("www.openbot.love", "GET", `${AUTH}/session`);
    expect(onEmployeeHost.status).toBe(200);
    expect((onEmployeeHost.json as { sessionKind?: string }).sessionKind).toBe("member");

    const onPlatformHost = await call("admin.openbot.love", "GET", `${AUTH}/session`);
    expect(onPlatformHost.status).toBe(200);
    expect((onPlatformHost.json as { sessionKind?: string }).sessionKind).toBe(
      "platform-super-admin",
    );
  });
});

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeDevicePlatformControl } from "../integrations/device-platform/control-client.js";
import type { IdentityDirectory, TrustedActor } from "../integrations/device-platform/identity.js";
import { devicePlatformPathsUnder } from "../integrations/device-platform/paths.js";
import { DevicePlatformService } from "../integrations/device-platform/service.js";
import { DevicePlatformStore } from "../integrations/device-platform/store.js";
import {
  handleDevicePlatformHttpRequest,
  type DevicePlatformGatewaySession,
} from "./device-platform-http.js";

function service(): DevicePlatformService {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-platform-gw-"));
  const directory: IdentityDirectory = {
    resolveActor(): TrustedActor | null {
      return null;
    },
    getDigitalHuman: () => null,
    hasDigitalHumanUse: () => false,
  };
  return new DevicePlatformService({
    store: new DevicePlatformStore(devicePlatformPathsUnder(root)),
    directory,
    control: new FakeDevicePlatformControl(),
    mode: "test",
  });
}

function session(partial: Partial<DevicePlatformGatewaySession>): DevicePlatformGatewaySession {
  return {
    userId: "user-1",
    displayName: "User",
    status: "active",
    sessionKind: "member",
    platformUser: false,
    ...partial,
  };
}

async function call(
  method: string,
  requestPath: string,
  current: DevicePlatformGatewaySession | null,
  body?: unknown,
): Promise<{ status: number; text: string; owned: boolean }> {
  const platform = service();
  const server = http.createServer((req, res) => {
    void handleDevicePlatformHttpRequest(req, res, {
      service: platform,
      resolveSession: async () => current,
    }).then((owned) => {
      if (!owned && !res.writableEnded) {
        res.statusCode = 599;
        res.end("not-owned");
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${requestPath}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, text: await response.text(), owned: response.status !== 599 };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("device platform gateway admin routes", () => {
  it("allows only a platform-admin session and does not own the integrations stub", async () => {
    const missing = await call("GET", "/api/device-platform/v1/admin/connections", null);
    expect(missing.status).toBe(401);

    const enterprise = await call(
      "GET",
      "/api/device-platform/v1/admin/connections",
      session({ sessionKind: "enterprise-admin", platformUser: false }),
    );
    expect(enterprise.status).toBe(403);

    const employeeOfAdmin = await call(
      "GET",
      "/api/device-platform/v1/admin/connections",
      session({ sessionKind: "member", platformUser: true }),
    );
    expect(employeeOfAdmin.status).toBe(403);

    const admin = await call(
      "GET",
      "/api/device-platform/v1/admin/connections",
      session({ sessionKind: "platform-admin", platformUser: true, displayName: "Admin" }),
    );
    expect(admin.status).toBe(200);
    expect(admin.text).toContain("connections");

    const userRoute = await call(
      "GET",
      "/api/device-platform/v1/me/devices",
      session({ sessionKind: "platform-admin", platformUser: true }),
    );
    expect(userRoute.status).toBe(403);

    const member = await call(
      "GET",
      "/api/device-platform/v1/me/devices",
      session({
        sessionKind: "member",
        tenantId: "tenant-1",
        membershipId: "mem-1",
        membershipRole: "member",
      }),
    );
    expect(member.status).toBe(200);
    expect(member.text).toContain("devices");
    expect(member.text).not.toContain("serviceBaseUrl");

    const integrations = await call("GET", "/api/integrations/v1/health", null);
    expect(integrations.status).toBe(599);
    expect(integrations.text).toBe("not-owned");
  });
});

import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTH_NONE,
  createTestGatewayServer,
  withGatewayTempConfig,
} from "../../gateway/server-http.test-harness.js";

const serverSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../gateway/server-http.ts"),
  "utf8",
);

describe("production gateway device-platform mount", () => {
  it("wires admin and me routes on the gateway HTTP server and leaves the stub off", () => {
    expect(serverSource).toContain('name: "device-platform-admin"');
    expect(serverSource).toContain("handleDevicePlatformHttpRequest");
    expect(serverSource).not.toContain("device-digital-human/stub-server");
    expect(serverSource).not.toContain("device-digital-human/http");
    expect(serverSource).not.toMatch(/from\s+["'][^"']*device-digital-human/);
  });

  it("serves management routes from createGatewayHttpServer and does not own integrations", async () => {
    await withGatewayTempConfig("device-platform-mount", async () => {
      const server = createTestGatewayServer({ resolvedAuth: AUTH_NONE });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const me = await fetch(`${base}/api/device-platform/v1/me/devices`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(me.status).toBe(401);
        const meBody = (await me.json()) as { ok: boolean; error: { code: string } };
        expect(meBody).toEqual({
          ok: false,
          error: { code: "UNAUTHENTICATED", message: "Login session is required" },
        });

        const admin = await fetch(`${base}/api/device-platform/v1/admin/connections`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(admin.status).toBe(401);

        const post = await fetch(`${base}/api/device-platform/v1/me/operations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId: "op-1", kind: "add" }),
          signal: AbortSignal.timeout(5_000),
        });
        expect(post.status).toBe(401);

        const controlHealth = await fetch(`${base}/api/device-platform/v1/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(controlHealth.status).toBe(404);
        const controlBody = (await controlHealth.json()) as { error: { code: string } };
        expect(controlBody.error.code).toBe("NOT_FOUND");

        const stub = await fetch(`${base}/api/integrations/v1/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(stub.status).toBe(404);
        expect(await stub.text()).toBe("Not Found");
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });
  });
});

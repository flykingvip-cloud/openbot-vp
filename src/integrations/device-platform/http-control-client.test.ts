import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { deviceControlUrl, HttpDevicePlatformControl } from "./http-control-client.js";

const healthBody = {
  ok: true,
  service: "device-control",
  apiPrefix: "/api/device-platform/v1",
  maturity: "v1-frozen",
  grayRelease: false,
  realDeviceDelivery: false,
  firmwareUrl: null,
  executable: false,
  flash: false,
  massFlash: false,
};

const capabilitiesBody = {
  apiPrefix: "/api/device-platform/v1",
  audience: "openbot-service-client",
  auth: "serviceBasic",
  browserIdentity: false,
  routes: ["GET /api/device-platform/v1/health"],
  openBot: {
    prefix: "/api/integrations/v1",
    consent: "pkce-s256",
    grantExchange: "POST /grants/exchange",
    pairFieldsAccepted: false,
  },
  ota: { flash: false, massFlash: false, firmwareUrl: null },
};

async function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe("HttpDevicePlatformControl", () => {
  it("joins the device-platform origin and refuses integrations paths", () => {
    expect(deviceControlUrl("http://127.0.0.1:8791", "/health")).toBe(
      "http://127.0.0.1:8791/api/device-platform/v1/health",
    );
    expect(deviceControlUrl("http://127.0.0.1:8791/api/device-platform/v1", "/health")).toBe(
      "http://127.0.0.1:8791/api/device-platform/v1/health",
    );
    expect(deviceControlUrl("https://platform.example/control", "/capabilities")).toBe(
      "https://platform.example/api/device-platform/v1/capabilities",
    );
    expect(() =>
      deviceControlUrl("https://platform.example", "/api/integrations/v1/health"),
    ).toThrow(/integrations/i);
  });

  it("calls health and capabilities with service Basic and keeps pairing on the device platform", async () => {
    const hits: string[] = [];
    const bodies: string[] = [];
    const server = await listen((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        bodies.push(Buffer.concat(chunks).toString("utf8"));
        const header = req.headers.authorization ?? "";
        expect(header.startsWith("Basic ")).toBe(true);
        const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
        expect(decoded).toBe("device-platform:service-secret-16+");
        if (req.url === "/api/device-platform/v1/health") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(healthBody));
          return;
        }
        if (req.url === "/api/device-platform/v1/capabilities") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(capabilitiesBody));
          return;
        }
        if (req.url === "/api/device-platform/v1/pair-challenges") {
          res.statusCode = 201;
          res.end(
            JSON.stringify({
              pairChallenge: "pch_abcdefgh",
              deviceId: "dev-1",
              pairingCode: "123456",
              expiresAtMs: 1,
              status: "pending",
            }),
          );
          return;
        }
        if (req.url === "/api/device-platform/v1/devices/dev-1/bind") {
          expect(req.headers["x-openbot-grant-credential"]).toBe("grant-cred");
          res.end(
            JSON.stringify({
              deviceId: "dev-1",
              servicePrincipal: "device-platform",
              ownership: "verified",
              bindStatus: "bound",
              revoked: false,
              authorizationRef: "azr_1",
              source: "openbot-grant",
            }),
          );
          return;
        }
        if (
          req.url === "/api/device-platform/v1/devices/dev-1/stop" ||
          req.url === "/api/device-platform/v1/devices/dev-1/revoke"
        ) {
          expect(req.headers["x-openbot-grant-credential"]).toBeUndefined();
          res.end(
            JSON.stringify({
              deviceId: "dev-1",
              servicePrincipal: "device-platform",
              ownership: "verified",
              bindStatus: "revoked",
              revoked: true,
              clearedTokens: 1,
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not_device_platform", message: "no" }));
      });
    });
    try {
      const client = new HttpDevicePlatformControl({
        serviceBaseUrl: server.baseUrl,
        serviceUser: "device-platform",
        servicePassword: "service-secret-16+",
      });
      await client.getHealth();
      await client.getCapabilities();
      await client.createPairChallenge("dev-1");
      await client.applyBind({
        deviceId: "dev-1",
        authorizationRef: "azr_1",
        grantCredential: "grant-cred",
      });
      const stopped = await client.stopLocal("dev-1");
      const revoked = await client.revokeLocal("dev-1");
      expect(stopped.clearedTokens).toBe(1);
      expect(revoked.bindStatus).toBe("revoked");
      expect(hits.some((hit) => hit.includes("/api/integrations/"))).toBe(false);
      expect(
        bodies.some((body) => body.includes("pairChallenge") || body.includes("pairingCode")),
      ).toBe(false);
      const bindBody = bodies.find((body) => body.includes("azr_1")) ?? "";
      expect(bindBody).not.toContain("pairingCode");
      expect(bindBody).not.toContain("pairChallenge");
    } finally {
      await server.close();
    }
  });

  it("does not treat a redirect or a failed health response as success", async () => {
    const redirect = await listen((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", "http://169.254.169.254/latest");
      res.end();
    });
    const failed = await listen((_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized", message: "no" }));
    });
    try {
      const redirected = new HttpDevicePlatformControl({
        serviceBaseUrl: redirect.baseUrl,
        serviceUser: "device-platform",
        servicePassword: "service-secret-16+",
      });
      await expect(redirected.getHealth()).rejects.toMatchObject({ code: "REDIRECT" });
      const denied = new HttpDevicePlatformControl({
        serviceBaseUrl: failed.baseUrl,
        serviceUser: "device-platform",
        servicePassword: "service-secret-16+",
      });
      await expect(denied.getHealth()).rejects.toMatchObject({ code: "unauthorized" });
    } finally {
      await redirect.close();
      await failed.close();
    }
  });
});

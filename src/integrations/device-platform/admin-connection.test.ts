import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleDevicePlatformRequest } from "./api.js";
import { FakeDevicePlatformControl } from "./control-client.js";
import type { DigitalHumanRecord, IdentityDirectory, TrustedActor } from "./identity.js";
import { devicePlatformPathsUnder } from "./paths.js";
import { DevicePlatformService } from "./service.js";
import { DevicePlatformStore } from "./store.js";
import { DevicePlatformError } from "./types.js";

const SECRET = "service-secret-16+";

function actor(partial: Partial<TrustedActor> & Pick<TrustedActor, "userId">): TrustedActor {
  return {
    displayName: partial.userId,
    tenantId: "tenant-1",
    membershipId: `mem-${partial.userId}`,
    membershipRole: "member",
    platformAdmin: false,
    status: "active",
    ...partial,
  };
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-platform-admin-"));
  const directory: IdentityDirectory = {
    resolveActor(sessionRef: string): TrustedActor | null {
      if (sessionRef === "session-admin") {
        return admin;
      }
      if (sessionRef === "session-user") {
        return user;
      }
      return null;
    },
    getDigitalHuman(): DigitalHumanRecord | null {
      return {
        digitalHumanId: "dh-shared",
        tenantId: "tenant-1",
        gatewayAgentId: "agent-shared",
        displayName: "Shared",
        status: "active",
      };
    },
    hasDigitalHumanUse: () => true,
  };
  const user = actor({ userId: "user-a" });
  const admin = actor({
    userId: "admin",
    tenantId: "platform",
    membershipId: "mem-admin",
    membershipRole: "enterprise-admin",
    platformAdmin: true,
    displayName: "Admin",
  });
  const store = new DevicePlatformStore(devicePlatformPathsUnder(root));
  const service = new DevicePlatformService({
    store,
    directory,
    control: new FakeDevicePlatformControl(),
    verifyServiceClient: (clientId, secret) => clientId === "device-platform" && secret === SECRET,
    mode: "test",
  });
  return { store, service, user, admin };
}

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
  routes: ["GET /health"],
  openBot: {
    prefix: "/api/integrations/v1",
    consent: "pkce-s256",
    grantExchange: "POST /grants/exchange",
    pairFieldsAccepted: false,
  },
  ota: { flash: false, massFlash: false, firmwareUrl: null },
};

async function serve(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(respond);
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

describe("platform admin device platform connection", () => {
  it("keeps admin configuration admin-only and does not echo the service secret", async () => {
    const { service, store, admin, user } = harness();
    const saved = await handleDevicePlatformRequest(service, {
      method: "PUT",
      path: "/api/device-platform/v1/admin/connections/plat-1",
      headers: { "x-openbot-session": "session-admin" },
      body: {
        displayName: "生产设备平台",
        environment: "development",
        serviceBaseUrl: "http://127.0.0.1:8791",
        contractVersion: "v1-draft",
        credentialRef: "cred://device-platform/plat-1",
        clientIdentity: "device-platform",
        registrationNotes: "Register the OpenBot capability client",
        callbackAllowlist: ["http://127.0.0.1:8787/callback"],
        serviceClientIds: ["device-platform"],
        enabled: true,
      },
    });
    expect(saved.status).toBe(200);
    const credential = await handleDevicePlatformRequest(service, {
      method: "PUT",
      path: "/api/device-platform/v1/admin/connections/plat-1/credential",
      headers: { "x-openbot-session": "session-admin" },
      body: { clientSecret: SECRET },
    });
    expect(credential.status).toBe(200);
    expect(JSON.stringify(credential.body)).not.toContain(SECRET);
    expect(credential.body.connection).toMatchObject({
      credentialPresent: true,
      disabledDisposition: "block_new_keep_existing",
      displayName: "生产设备平台",
    });
    const again = await handleDevicePlatformRequest(service, {
      method: "PUT",
      path: "/api/device-platform/v1/admin/connections/plat-1/credential",
      headers: { "x-openbot-session": "session-admin" },
      body: { clientSecret: "another-secret-16+" },
    });
    expect(again.status).toBe(409);

    const listed = await handleDevicePlatformRequest(service, {
      method: "GET",
      path: "/api/device-platform/v1/admin/connections",
      headers: { "x-openbot-session": "session-user" },
    });
    expect(listed.status).toBe(403);
    expect(() => service.listConnections(user)).toThrow(DevicePlatformError);

    const connectionText = fs.readFileSync(store.locations.connectionFile, "utf8");
    expect(connectionText).not.toContain(SECRET);
    const credentialText = fs.readFileSync(store.locations.credentialFile, "utf8");
    expect(credentialText).toContain(SECRET);
    expect(service.getConnection(admin, "plat-1").credentialRef).toBe(
      "cred://device-platform/plat-1",
    );
    expect(
      service.upsertConnection(admin, "plat-new", {
        environment: "development",
        serviceBaseUrl: "http://127.0.0.1:8791",
        credentialRef: "cred://device-platform/plat-new",
        clientIdentity: "device-platform",
        serviceClientIds: ["device-platform"],
      }).contractVersion,
    ).toBe("v1");
  });

  it("does not mark the connector healthy when health or capabilities fail", async () => {
    const { service, admin } = harness();
    const down = await serve((_req, res) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "http_failed", message: SECRET }));
    });
    const partial = await serve((req, res) => {
      if (req.url?.endsWith("/health")) {
        res.end(JSON.stringify(healthBody));
        return;
      }
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "http_failed", message: "capabilities down" }));
    });
    const stale = await serve((_req, res) => {
      res.end(JSON.stringify({ ...healthBody, maturity: "draft" }));
    });
    try {
      service.upsertConnection(admin, "plat-down", {
        environment: "development",
        serviceBaseUrl: down.baseUrl,
        contractVersion: "v1-draft",
        credentialRef: "cred://down",
        clientIdentity: "device-platform",
        serviceClientIds: ["device-platform"],
      });
      service.setConnectionCredential(admin, "plat-down", { clientSecret: SECRET });
      const failed = await service.testConnection(admin, "plat-down");
      expect(failed.connection.health).toBe("down");
      expect(failed.connection.health).not.toBe("ok");
      expect(failed.connection.contractVersion).toBe("v1-draft");
      expect(JSON.stringify(failed)).not.toContain(SECRET);
      expect(failed.checks.capabilities).toBe("skipped");

      service.upsertConnection(admin, "plat-partial", {
        environment: "development",
        serviceBaseUrl: partial.baseUrl,
        contractVersion: "v1-draft",
        credentialRef: "cred://partial",
        clientIdentity: "device-platform",
        serviceClientIds: ["device-platform"],
      });
      service.setConnectionCredential(admin, "plat-partial", { clientSecret: SECRET });
      const mixed = await service.testConnection(admin, "plat-partial");
      expect(mixed.partial).toBe(true);
      expect(mixed.connection.health).toBe("down");
      expect(mixed.connection.contractVersion).toBe("v1");
      expect(mixed.checks.health).toBe("ok");
      expect(mixed.checks.capabilities).toBe("failed");

      service.upsertConnection(admin, "plat-stale", {
        environment: "development",
        serviceBaseUrl: stale.baseUrl,
        contractVersion: "v1-draft",
        credentialRef: "cred://stale",
        clientIdentity: "device-platform",
        serviceClientIds: ["device-platform"],
      });
      service.setConnectionCredential(admin, "plat-stale", { clientSecret: SECRET });
      const rejected = await service.testConnection(admin, "plat-stale");
      expect(rejected.connection.health).toBe("down");
      expect(rejected.connection.contractVersion).toBe("v1-draft");
    } finally {
      await down.close();
      await partial.close();
      await stale.close();
    }
  });

  it("marks the connector healthy only after both checks and blocks new auth when disabled", async () => {
    const { service, admin, user } = harness();
    const server = await serve((req, res) => {
      if (req.url?.endsWith("/health")) {
        res.end(JSON.stringify(healthBody));
        return;
      }
      res.end(JSON.stringify(capabilitiesBody));
    });
    try {
      service.upsertConnection(admin, "plat-1", {
        environment: "development",
        serviceBaseUrl: server.baseUrl,
        contractVersion: "v1-draft",
        credentialRef: "cred://device-platform/plat-1",
        clientIdentity: "device-platform",
        serviceClientIds: ["device-platform"],
        enabled: true,
      });
      service.setConnectionCredential(admin, "plat-1", { clientSecret: SECRET });
      const ok = await service.testConnection(admin, "plat-1");
      expect(ok.connection.health).toBe("ok");
      expect(ok.connection.contractVersion).toBe("v1");
      expect(ok.partial).toBe(false);

      const added = await service.submitOperation(user, {
        operationId: "op-admin-disable",
        kind: "add",
        platformId: "plat-1",
        externalDeviceId: "ext-1",
        digitalHumanId: "dh-shared",
        displayName: "ext-1",
        scopes: ["chat"],
        pairing: { challenge: "c1", proof: "ok:c1" },
      });
      service.upsertConnection(admin, "plat-1", {
        environment: "development",
        serviceBaseUrl: server.baseUrl,
        contractVersion: "v1-draft",
        credentialRef: "cred://device-platform/plat-1",
        clientIdentity: "device-platform",
        serviceClientIds: ["device-platform"],
        enabled: false,
      });
      expect(service.listPersonalSettingsDevices(user)).toHaveLength(1);
      expect(service.getConnection(admin, "plat-1").enabled).toBe(false);
      expect(service.getConnection(admin, "plat-1").disabledDisposition).toBe(
        "block_new_keep_existing",
      );
      await expect(
        service.submitOperation(user, {
          operationId: "op-admin-disable-2",
          kind: "add",
          platformId: "plat-1",
          externalDeviceId: "ext-2",
          digitalHumanId: "dh-shared",
          displayName: "ext-2",
          scopes: ["chat"],
          pairing: { challenge: "c2", proof: "ok:c2" },
        }),
      ).rejects.toMatchObject({ code: "PLATFORM_DISABLED" });
      expect(() =>
        service.authorizeCapability(user, {
          serviceClientId: "device-platform",
          serviceSecret: SECRET,
          authorizationRef: added.device?.binding?.authorizationRef ?? "",
          grantCredential:
            service.peekGrantCredential(added.device?.binding?.authorizationRef ?? "") ?? "",
        }),
      ).toThrow(DevicePlatformError);
    } finally {
      await server.close();
    }
  });
});

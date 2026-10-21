import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StubConfig } from "../device-digital-human/config.js";
import { listenDeviceDh } from "../device-digital-human/http.js";
import { DeviceDhService } from "../device-digital-human/service.js";
import { basicHeader } from "../device-digital-human/util.js";
import { FakeDevicePlatformControl } from "./control-client.js";
import {
  digitalHumanUseAllowed,
  type DigitalHumanRecord,
  type IdentityDirectory,
  type TrustedActor,
} from "./identity.js";
import { devicePlatformPathsUnder } from "./paths.js";
import { DevicePlatformService } from "./service.js";
import { DevicePlatformStore } from "./store.js";
import {
  assertLoopbackStubOrigin,
  HttpStubGrantRegistry,
  stubGrantRegistryFromEnv,
} from "./stub-grant-registry.js";
import { DevicePlatformError } from "./types.js";

const consentSecret = "consent-secret-16+";
const serviceSecret = "service-secret-16+";
const redirectUri = "https://device.example/callback";
const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../device-digital-human/examples/fixtures",
);

function stubConfig(): StubConfig {
  return {
    clients: [
      {
        clientId: "consent-sim",
        secret: consentSecret,
        role: "consent",
        allowedDigitalHumanIds: ["agent-demo-1", "agent-demo-2"],
        scopes: ["chat", "camera.capture", "media.read"],
      },
      {
        clientId: "device-platform",
        secret: serviceSecret,
        role: "service",
        redirectUris: [redirectUri],
      },
    ],
    digitalHumans: [
      {
        digitalHumanId: "agent-demo-1",
        displayName: "Demo Assistant",
        status: "active",
        userSubject: "user-demo",
        tenantId: "tenant-demo",
      },
      {
        digitalHumanId: "agent-demo-2",
        displayName: "Demo Two",
        status: "active",
        userSubject: "user-two",
        tenantId: "tenant-demo",
      },
    ],
  };
}

async function startStub() {
  const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
  return listenDeviceDh({ service, fixtureDir, port: 0 });
}

function registryFor(origin: string): HttpStubGrantRegistry {
  return new HttpStubGrantRegistry({
    origin,
    consentUser: "consent-sim",
    consentPassword: consentSecret,
    serviceUser: "device-platform",
    servicePassword: serviceSecret,
    redirectUri,
  });
}

async function readGrant(origin: string, authorizationRef: string, credential: string) {
  const response = await fetch(
    `${origin}/api/integrations/v1/grants/${encodeURIComponent(authorizationRef)}`,
    {
      headers: {
        authorization: basicHeader("device-platform", serviceSecret),
        "x-openbot-grant-credential": credential,
      },
    },
  );
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

class MemoryDirectory implements IdentityDirectory {
  readonly sessions = new Map<string, TrustedActor>();
  readonly humans = new Map<string, DigitalHumanRecord>();
  readonly permitted = new Map<string, string[]>();

  resolveActor(sessionRef: string): TrustedActor | null {
    return this.sessions.get(sessionRef) ?? null;
  }

  getDigitalHuman(digitalHumanId: string): DigitalHumanRecord | null {
    return this.humans.get(digitalHumanId) ?? null;
  }

  hasDigitalHumanUse(actor: TrustedActor, human: DigitalHumanRecord): boolean {
    return digitalHumanUseAllowed({
      actor,
      human,
      permittedAgentIds: this.permitted.get(actor.userId) ?? [],
    });
  }
}

function management(origin: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grant-registry-"));
  const directory = new MemoryDirectory();
  const user: TrustedActor = {
    userId: "user-a",
    displayName: "User A",
    tenantId: "tenant-1",
    membershipId: "mem-user-a",
    membershipRole: "member",
    platformAdmin: false,
    status: "active",
  };
  const admin: TrustedActor = {
    userId: "admin",
    displayName: "Admin",
    tenantId: "platform",
    membershipId: "mem-admin",
    membershipRole: "enterprise-admin",
    platformAdmin: true,
    status: "active",
  };
  directory.sessions.set("session-a", user);
  directory.sessions.set("session-admin", admin);
  for (const id of ["agent-demo-1", "agent-demo-2"]) {
    directory.humans.set(id, {
      digitalHumanId: id,
      tenantId: "tenant-1",
      gatewayAgentId: id,
      displayName: id,
      status: "active",
    });
  }
  directory.permitted.set("user-a", ["agent-demo-1", "agent-demo-2"]);
  const store = new DevicePlatformStore(devicePlatformPathsUnder(root));
  const service = new DevicePlatformService({
    store,
    directory,
    control: new FakeDevicePlatformControl(),
    env: {},
    grantRegistry: registryFor(origin),
  });
  service.upsertConnection(admin, "plat-1", {
    serviceBaseUrl: "https://platform.example/control",
    contractVersion: "1",
    credentialRef: "cred://device-platform/plat-1",
    serviceClientIds: ["device-platform"],
    enabled: true,
  });
  return { service, store, user };
}

describe("integrations stub grant registry", () => {
  it("returns a GrantView from the same stub origin after exchange, rebind, and revoke", async () => {
    const stub = await startStub();
    try {
      const registry = registryFor(stub.url);
      const issued = await registry.issue({
        digitalHumanId: "agent-demo-1",
        deviceId: "cam-1",
        scopes: ["chat", "camera.capture", "media.read"],
        serviceAudience: "device-platform",
      });
      const loaded = await readGrant(
        stub.url,
        issued.authorizationRef,
        issued.authorizationCredential,
      );
      expect(loaded.status).toBe(200);
      expect(loaded.json.authorizationCredential).toBeUndefined();
      expect(loaded.json.authorizationRef).toBe(issued.authorizationRef);
      expect(loaded.json.bindingVersion).toBe(1);
      expect(loaded.json.digitalHumanId).toBe("agent-demo-1");
      expect(loaded.json.deviceId).toBe("cam-1");
      expect(loaded.json.status).toBe("active");
      expect((loaded.json.assistant as { displayName?: string }).displayName).toBe(
        "Demo Assistant",
      );

      const rebound = await registry.rebind({
        authorizationRef: issued.authorizationRef,
        digitalHumanId: "agent-demo-2",
      });
      const afterRebind = await readGrant(
        stub.url,
        issued.authorizationRef,
        issued.authorizationCredential,
      );
      expect(rebound.authorizationRef).toBe(issued.authorizationRef);
      expect(afterRebind.status).toBe(200);
      expect(afterRebind.json.bindingVersion).toBe(2);
      expect(afterRebind.json.digitalHumanId).toBe("agent-demo-2");
      expect(afterRebind.json.deviceId).toBe("cam-1");
      expect((afterRebind.json.assistant as { digitalHumanId?: string }).digitalHumanId).toBe(
        "agent-demo-2",
      );

      await registry.revoke({
        authorizationRef: issued.authorizationRef,
        authorizationCredential: issued.authorizationCredential,
      });
      const afterRevoke = await readGrant(
        stub.url,
        issued.authorizationRef,
        issued.authorizationCredential,
      );
      expect(afterRevoke.status).toBe(200);
      expect(afterRevoke.json.status).toBe("revoked");
      expect(afterRevoke.json.bindingVersion).toBe(2);
      expect(afterRevoke.json.authorizationRef).toBe(issued.authorizationRef);
    } finally {
      await stub.close();
    }
  });

  it("registers device-platform add, rebind, and revoke on the stub device-control reads", async () => {
    const stub = await startStub();
    try {
      const { service, store, user } = management(stub.url);
      const added = await service.submitOperation(user, {
        operationId: "op-add",
        kind: "add",
        platformId: "plat-1",
        externalDeviceId: "cam-1",
        digitalHumanId: "agent-demo-1",
        displayName: "cam-1",
        scopes: ["chat", "camera.capture"],
        pairing: { challenge: "c1", proof: "ok:c1" },
      });
      const authorizationRef = added.device?.binding?.authorizationRef ?? "";
      const credential = service.peekGrantCredential(authorizationRef) ?? "";
      expect(authorizationRef.startsWith("azr_")).toBe(true);
      expect(credential.startsWith("obgc_")).toBe(true);

      const loaded = await readGrant(stub.url, authorizationRef, credential);
      expect(loaded.status).toBe(200);
      expect(loaded.json.authorizationRef).toBe(authorizationRef);
      expect(loaded.json.deviceId).toBe("cam-1");
      expect(loaded.json.digitalHumanId).toBe("agent-demo-1");
      expect(loaded.json.bindingVersion).toBe(1);
      expect(loaded.json.assistant).toBeTruthy();
      const local = store.loadTenant("tenant-1").grants[authorizationRef];
      expect(local?.deviceId).not.toBe(loaded.json.deviceId);
      expect(local?.authorizationRef).toBe(authorizationRef);

      const rebound = await service.submitOperation(user, {
        operationId: "op-rebind",
        kind: "rebind",
        deviceId: added.device?.deviceId,
        digitalHumanId: "agent-demo-2",
        scopes: ["chat"],
      });
      expect(rebound.device?.binding?.authorizationRef).toBe(authorizationRef);
      expect(rebound.device?.binding?.expectedBindingVersion).toBe(2);
      const afterRebind = await readGrant(stub.url, authorizationRef, credential);
      expect(afterRebind.status).toBe(200);
      expect(afterRebind.json.bindingVersion).toBe(2);
      expect(afterRebind.json.digitalHumanId).toBe("agent-demo-2");
      expect(afterRebind.json.status).toBe("active");

      await service.submitOperation(user, {
        operationId: "op-revoke",
        kind: "revoke",
        deviceId: added.device?.deviceId,
      });
      const afterRevoke = await readGrant(stub.url, authorizationRef, credential);
      expect(afterRevoke.status).toBe(200);
      expect(afterRevoke.json.status).toBe("revoked");
      expect(afterRevoke.json.bindingVersion).toBe(2);
      expect(service.peekGrantCredential(authorizationRef)).toBeUndefined();
    } finally {
      await stub.close();
    }
  });

  it("does not keep a management-only grant when the stub rejects issuance", async () => {
    const { service, store, user } = management("http://127.0.0.1:9");
    await expect(
      service.submitOperation(user, {
        operationId: "op-add-down",
        kind: "add",
        platformId: "plat-1",
        externalDeviceId: "cam-down",
        digitalHumanId: "agent-demo-1",
        displayName: "cam-down",
        scopes: ["chat"],
        pairing: { challenge: "c1", proof: "ok:c1" },
      }),
    ).rejects.toBeInstanceOf(DevicePlatformError);
    expect(Object.keys(store.loadTenant("tenant-1").grants)).toHaveLength(0);
  });

  it("stays off unless both Basic pairs are set, and refuses a public stub origin", () => {
    expect(stubGrantRegistryFromEnv({})).toBeUndefined();
    expect(
      stubGrantRegistryFromEnv({
        OPENBOT_STUB_SERVICE_USER: "device-platform",
        OPENBOT_STUB_SERVICE_PASSWORD: serviceSecret,
      }),
    ).toBeUndefined();
    expect(() => assertLoopbackStubOrigin("https://stub.example")).toThrow(DevicePlatformError);
    expect(assertLoopbackStubOrigin("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
  });
});

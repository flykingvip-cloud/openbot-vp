import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleDevicePlatformRequest } from "./api.js";
import { FakeDevicePlatformControl } from "./control-client.js";
import { assertNoForbiddenUserKeys } from "./dto.js";
import { bodyHash } from "./idempotency.js";
import {
  actorFromPlatformRecords,
  digitalHumanUseAllowed,
  type DigitalHumanRecord,
  type IdentityDirectory,
  type TrustedActor,
} from "./identity.js";
import { devicePlatformPathsUnder } from "./paths.js";
import { DevicePlatformService } from "./service.js";
import { DevicePlatformStore } from "./store.js";
import { DevicePlatformError } from "./types.js";

const SECRET = "client-secret-value";
const PRIVATE_KEY = "device-private-key";
const VENDOR_KEY = "vendor-key-value";
const SERVICE_URL = "https://platform.example/control";
const RAW = "raw-diagnostic-dump";

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

function harness(env: NodeJS.ProcessEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-platform-"));
  const directory = new MemoryDirectory();
  const userA = actor({ userId: "user-a" });
  const userB = actor({ userId: "user-b" });
  const admin = actor({
    userId: "admin",
    tenantId: "platform",
    membershipId: "mem-admin",
    membershipRole: "enterprise-admin",
    platformAdmin: true,
    displayName: "Admin",
  });
  directory.sessions.set("session-a", userA);
  directory.sessions.set("session-b", userB);
  directory.sessions.set("session-admin", admin);
  directory.humans.set("dh-shared", {
    digitalHumanId: "dh-shared",
    tenantId: "tenant-1",
    gatewayAgentId: "agent-shared",
    displayName: "Shared",
    status: "active",
    ownerId: "user-a",
  });
  directory.humans.set("dh-a", {
    digitalHumanId: "dh-a",
    tenantId: "tenant-1",
    gatewayAgentId: "agent-a",
    displayName: "A",
    status: "active",
    ownerId: "user-b",
  });
  directory.permitted.set("user-a", ["dh-shared", "dh-a"]);
  directory.permitted.set("user-b", ["dh-shared"]);
  const control = new FakeDevicePlatformControl();
  const store = new DevicePlatformStore(devicePlatformPathsUnder(root));
  const service = new DevicePlatformService({
    store,
    directory,
    control,
    env,
    verifyServiceClient: (clientId, secret) =>
      clientId === "device-platform" && secret === "service-secret-16+",
  });
  service.upsertConnection(admin, "plat-1", {
    serviceBaseUrl: SERVICE_URL,
    contractVersion: "1",
    credentialRef: "cred://device-platform/plat-1",
    serviceClientIds: ["device-platform"],
    enabled: true,
  });
  return { root, directory, control, store, service, userA, userB, admin };
}

function addBody(operationId: string, externalDeviceId: string, digitalHumanId = "dh-shared") {
  return {
    operationId,
    kind: "add" as const,
    platformId: "plat-1",
    externalDeviceId,
    digitalHumanId,
    displayName: externalDeviceId,
    scopes: ["chat"],
    pairing: { challenge: "c1", proof: "ok:c1" },
  };
}

describe("device platform management", () => {
  it("keeps one binding source for personal settings and the digital-human list", async () => {
    const { service, userA } = harness();
    const added = await service.submitOperation(userA, addBody("op-add", "ext-1"));
    const personal = service.listPersonalSettingsDevices(userA);
    const onHuman = service.listDigitalHumanDevices(userA, "dh-shared");
    expect(personal).toHaveLength(1);
    expect(onHuman).toEqual(personal);
    expect(onHuman[0]?.binding?.bindingId).toBe(added.device?.binding?.bindingId);
    expect(onHuman[0]?.binding?.authorizationRef).toBe(added.device?.binding?.authorizationRef);

    const rebound = await service.submitOperation(userA, {
      operationId: "op-rebind",
      kind: "rebind",
      deviceId: added.device?.deviceId,
      digitalHumanId: "dh-a",
      scopes: ["chat"],
    });
    const personalAfter = service.listPersonalSettingsDevices(userA);
    const humanAfter = service.listDigitalHumanDevices(userA, "dh-a");
    expect(personalAfter[0]?.binding?.expectedBindingVersion).toBe(2);
    expect(personalAfter[0]?.binding?.bindingId).toBe(rebound.device?.binding?.bindingId);
    expect(humanAfter[0]?.binding?.authorizationRef).toBe(
      personalAfter[0]?.binding?.authorizationRef,
    );
    expect(service.listDigitalHumanDevices(userA, "dh-shared")).toEqual([]);
    const foreground = personalAfter.filter((device) => device.binding);
    expect(foreground).toHaveLength(1);
  });

  it("hides another user's device even on a shared digital human", async () => {
    const { service, userA, userB } = harness();
    const added = await service.submitOperation(userA, addBody("op-a", "ext-a"));
    const deviceId = added.device?.deviceId ?? "";
    expect(service.listPersonalSettingsDevices(userB)).toEqual([]);
    expect(service.listDigitalHumanDevices(userB, "dh-shared")).toEqual([]);
    expect(() => service.getDevice(userB, deviceId)).toThrow(DevicePlatformError);
    await expect(
      service.submitOperation(userB, {
        operationId: "op-b-revoke",
        kind: "revoke",
        deviceId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.submitOperation(userB, addBody("op-owner", "ext-a")),
    ).rejects.toMatchObject({
      code: "DEVICE_CLAIMED",
    });
  });

  it("rejects raw secrets instead of storing them", async () => {
    const { service, store, userA, admin } = harness();
    expect(() =>
      service.upsertConnection(
        admin,
        "plat-1",
        {
          serviceBaseUrl: SERVICE_URL,
          credentialRef: "cred://x",
          serviceClientIds: ["device-platform"],
        },
        { clientSecret: SECRET, devicePrivateKey: PRIVATE_KEY, vendorKey: VENDOR_KEY },
      ),
    ).toThrow(DevicePlatformError);
    await expect(
      service.submitOperation(userA, addBody("op-secret", "ext-secret"), {
        ...addBody("op-secret", "ext-secret"),
        clientSecret: SECRET,
      }),
    ).rejects.toMatchObject({ code: "SECRET_REJECTED" });
    expect(fs.existsSync(store.locations.tenantFile("tenant-1"))).toBe(false);
    const connectionText = fs.readFileSync(store.locations.connectionFile, "utf8");
    expect(connectionText).not.toContain(SECRET);
    expect(connectionText).not.toContain(PRIVATE_KEY);
    expect(connectionText).not.toContain(VENDOR_KEY);
  });

  it("serves user DTOs without secrets and keeps admin connection config admin-only", async () => {
    const { service, store, userA, userB, admin } = harness();
    const added = await service.submitOperation(userA, addBody("op-dto", "ext-dto"));
    const personal = service.listPersonalSettingsDevices(userA);
    const human = service.listDigitalHumanDevices(userA, "dh-shared");
    const operation = added.operation;
    for (const payload of [personal, human, added.device, operation]) {
      assertNoForbiddenUserKeys(payload);
      const text = JSON.stringify(payload);
      expect(text).not.toContain(SERVICE_URL);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(PRIVATE_KEY);
      expect(text).not.toContain(VENDOR_KEY);
      expect(text).not.toContain(RAW);
      expect(text).not.toContain("cred://");
      expect(text).not.toContain("obgc_");
    }
    const shardText = fs.readFileSync(store.locations.tenantFile("tenant-1"), "utf8");
    expect(shardText).not.toContain(SERVICE_URL);
    expect(shardText).not.toContain(SECRET);
    expect(shardText).not.toContain(RAW);
    expect(shardText).not.toContain("obgc_");

    const adminView = service.getConnection(admin, "plat-1");
    expect(adminView.serviceBaseUrl).toBe(SERVICE_URL);
    expect(adminView.credentialRef).toBe("cred://device-platform/plat-1");
    expect(JSON.stringify(adminView)).not.toContain(SECRET);

    expect(() => service.listConnections(userB)).toThrow(DevicePlatformError);
    expect(() =>
      service.upsertConnection(userA, "plat-2", {
        serviceBaseUrl: "https://other.example",
        credentialRef: "cred://other",
        serviceClientIds: ["device-platform"],
      }),
    ).toThrow(/admin/i);

    const listed = await handleDevicePlatformRequest(service, {
      method: "GET",
      path: "/api/device-platform/v1/admin/connections",
      headers: { "x-openbot-session": "session-a" },
    });
    expect(listed.status).toBe(403);
    const adminList = await handleDevicePlatformRequest(service, {
      method: "GET",
      path: "/api/device-platform/v1/admin/connections",
      headers: { "x-openbot-session": "session-admin" },
    });
    expect(adminList.status).toBe(200);
    expect(JSON.stringify(adminList.body)).toContain(SERVICE_URL);
    expect(JSON.stringify(adminList.body)).not.toContain(SECRET);

    const userList = await handleDevicePlatformRequest(service, {
      method: "GET",
      path: "/api/device-platform/v1/me/devices",
      headers: { "x-openbot-session": "session-a" },
    });
    expect(userList.status).toBe(200);
    expect(JSON.stringify(userList.body)).not.toContain(SERVICE_URL);
    expect(JSON.stringify(userList.body)).not.toContain(RAW);
  });

  it("keeps operationId idempotency for add, rebind, and revoke", async () => {
    const { service, control, store, userA } = harness();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    control.holdNext(gate);
    const first = service.submitOperation(userA, addBody("op-inflight", "ext-inflight"));
    const duplicate = await service.submitOperation(userA, addBody("op-inflight", "ext-inflight"));
    expect(duplicate.operation.inflight).toBe(true);
    expect(duplicate.operation.disposition).toBe("duplicate");
    expect(control.calls.filter((call) => call === "health")).toHaveLength(1);
    release();
    const completed = await first;
    expect(completed.device?.binding?.status).toBe("active");
    const again = await service.submitOperation(userA, addBody("op-inflight", "ext-inflight"));
    expect(again.operation.disposition).toBe("duplicate");
    expect(again.operation.inflight).toBeUndefined();
    expect(service.listPersonalSettingsDevices(userA)).toHaveLength(1);

    await expect(
      service.submitOperation(userA, addBody("op-inflight", "ext-other")),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(service.listPersonalSettingsDevices(userA)).toHaveLength(1);

    const deviceId = completed.device?.deviceId ?? "";
    const authorizationRef = completed.device?.binding?.authorizationRef ?? "";
    const hash = bodyHash({ tool: "camera.capture" });
    expect(service.reserveToolResult("tenant-1", "tool-1", hash, authorizationRef)).toBe(
      "reserved",
    );
    expect(service.reserveToolResult("tenant-1", "tool-1", hash, authorizationRef)).toBe(
      "duplicate",
    );
    expect(
      service.reserveToolResult(
        "tenant-1",
        "tool-1",
        bodyHash({ tool: "other" }),
        authorizationRef,
      ),
    ).toBe("conflict");
    service.completeToolResult("tenant-1", "tool-1", hash, { ok: true });
    expect(service.reserveToolResult("tenant-1", "tool-open", hash, authorizationRef)).toBe(
      "reserved",
    );

    await service.submitOperation(userA, { operationId: "op-revoke", kind: "revoke", deviceId });
    const shard = store.loadTenant("tenant-1");
    expect(shard.idempotency["tool-open"]).toBeUndefined();
    expect(shard.idempotency["tool-1"]?.response).toEqual({ ok: true });
    expect(service.listPersonalSettingsDevices(userA)[0]?.binding).toBeNull();
  });

  it("distinguishes expected and applied binding versions", async () => {
    const { service, control, store, userA } = harness();
    control.appliedBindingVersion = 0;
    const lagging = await service.submitOperation(userA, addBody("op-lag", "ext-lag"));
    expect(lagging.device?.binding?.expectedBindingVersion).toBe(1);
    expect(lagging.device?.binding?.appliedBindingVersion).toBe(0);
    expect(lagging.device?.binding?.authorizationEstablished).toBe(true);
    expect(lagging.device?.binding?.platformApplied).toBe(false);
    expect(lagging.device?.binding?.deviceEffect).toBe(false);
    expect(lagging.device?.binding?.status).toBe("applying");

    control.appliedBindingVersion = undefined;
    const applied = await service.submitOperation(
      userA,
      addBody("op-applied", "ext-applied", "dh-a"),
    );
    expect(applied.device?.binding?.expectedBindingVersion).toBe(1);
    expect(applied.device?.binding?.appliedBindingVersion).toBe(1);
    expect(applied.device?.binding?.platformApplied).toBe(true);
    expect(applied.device?.binding?.authorizationEstablished).toBe(true);
    expect(applied.device?.binding?.deviceEffect).toBe(false);

    const rebound = await service.submitOperation(userA, {
      operationId: "op-rebind-version",
      kind: "rebind",
      deviceId: applied.device?.deviceId,
      digitalHumanId: "dh-shared",
      scopes: ["chat", "camera.capture"],
    });
    expect(rebound.device?.binding?.expectedBindingVersion).toBe(2);
    expect(rebound.device?.binding?.appliedBindingVersion).toBe(2);
    expect(rebound.device?.binding?.platformApplied).toBe(true);
    expect(rebound.device?.binding?.deviceEffect).toBe(false);
    expect(rebound.device?.binding?.authorizationRef).not.toBe(
      applied.device?.binding?.authorizationRef,
    );
    const shard = store.loadTenant("tenant-1");
    expect(
      shard.bindingHistory.some(
        (entry) => entry.authorizationRef === applied.device?.binding?.authorizationRef,
      ),
    ).toBe(true);
    const foreground = Object.values(shard.bindings).filter(
      (binding) => binding.deviceId === applied.device?.deviceId && binding.status !== "revoked",
    );
    expect(foreground).toHaveLength(1);
    foreground[0].deviceEffect = true;
    store.saveTenant("tenant-1", shard);
    expect(service.getDevice(userA, applied.device?.deviceId ?? "").binding?.deviceEffect).toBe(
      true,
    );
  });

  it("reloads records after restart and does not replay side effects", async () => {
    const { service, store, control, userA, directory } = harness();
    const added = await service.submitOperation(userA, addBody("op-persist", "ext-persist"));
    service.recordIntegrationRecovery("tenant-1", {
      runs: {
        run1: {
          runId: "run1",
          tenantId: "tenant-1",
          status: "running",
          retryable: true,
          createdAt: "2026-10-20T00:00:00.000Z",
        },
      },
      idempotency: {
        done: {
          key: "done",
          hash: "a",
          inflight: false,
          response: { ok: true },
          createdAt: "2026-10-20T00:00:00.000Z",
        },
        open: {
          key: "open",
          hash: "b",
          inflight: true,
          authorizationRef: added.device?.binding?.authorizationRef,
          createdAt: "2026-10-20T00:00:00.000Z",
        },
      },
      toolRequests: {
        req: {
          requestId: "req",
          tenantId: "tenant-1",
          state: "pending",
          updatedAt: "2026-10-20T00:00:00.000Z",
        },
      },
    });
    const restartedControl = new FakeDevicePlatformControl();
    const restarted = new DevicePlatformService({
      store,
      directory,
      control: restartedControl,
      verifyServiceClient: () => false,
    });
    expect(restartedControl.calls).toEqual([]);
    const shard = store.loadTenant("tenant-1");
    expect(shard.runs.run1?.status).toBe("interrupted");
    expect(shard.runs.run1?.errorCode).toBe("UNKNOWN_AFTER_RESTART");
    expect(shard.idempotency.open).toBeUndefined();
    expect(shard.idempotency.done?.response).toEqual({ ok: true });
    expect(shard.toolRequests.req?.state).toBe("expired");
    const devices = restarted.listPersonalSettingsDevices(userA);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.deviceId).toBe(added.device?.deviceId);
    expect(control.calls.some((call) => call.startsWith("queryDevices:tenant-1:user-a"))).toBe(
      true,
    );
  });

  it("requires membership and a use grant, and rejects debug overrides", async () => {
    expect(
      digitalHumanUseAllowed({
        actor: actor({ userId: "user-a" }),
        human: {
          digitalHumanId: "dh-a",
          tenantId: "tenant-1",
          gatewayAgentId: "agent-a",
          displayName: "A",
          status: "active",
          ownerId: "user-a",
        },
        permittedAgentIds: [],
      }),
    ).toBe(false);
    expect(
      digitalHumanUseAllowed({
        actor: actor({ userId: "user-a" }),
        human: {
          digitalHumanId: "dh-a",
          tenantId: "tenant-1",
          gatewayAgentId: "agent-a",
          displayName: "A",
          status: "active",
          ownerId: "someone-else",
        },
        permittedAgentIds: ["agent-a"],
      }),
    ).toBe(true);

    const employeeAdmin = actorFromPlatformRecords({
      session: {
        userId: "admin",
        membershipId: "mem",
        enterpriseId: "tenant-1",
        sessionKind: "member",
      },
      user: { id: "admin", displayName: "Admin", status: "active", platformAdmin: true },
      membership: {
        id: "mem",
        userId: "admin",
        enterpriseId: "tenant-1",
        membershipRole: "member",
      },
    });
    expect(employeeAdmin?.platformAdmin).toBe(false);
    expect(
      actorFromPlatformRecords({
        session: { userId: "admin", sessionKind: "platform-admin" },
        user: { id: "admin", displayName: "Admin", status: "active", platformAdmin: true },
        membership: null,
      }),
    ).toBeNull();

    const { service, userB } = harness();
    await expect(
      service.submitOperation(userB, addBody("op-use", "ext-use", "dh-a")),
    ).rejects.toMatchObject({
      code: "USE_DENIED",
    });
    const http = await handleDevicePlatformRequest(service, {
      method: "POST",
      path: "/api/device-platform/v1/me/operations",
      headers: { "x-openbot-session": "session-a" },
      body: { ...addBody("op-override", "ext-override"), userId: "user-b", sessionKey: "forced" },
    });
    expect(http.status).toBe(400);
    expect(http.body.error).toMatchObject({ code: "IDENTITY_OVERRIDE" });

    const debugEnv: NodeJS.ProcessEnv = {};
    const debug = harness(debugEnv);
    debugEnv.OPENBOT_DEVICE_DH_AGENT_DEBUG = "1";
    expect(() => debug.service.listPersonalSettingsDevices(debug.userA)).toThrow(
      DevicePlatformError,
    );
    const forcedEnv: NodeJS.ProcessEnv = {};
    const forced = harness(forcedEnv);
    forcedEnv.OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE = "1";
    expect(() => forced.service.listPersonalSettingsDevices(forced.userA)).toThrow(/formal/i);
  });

  it("requires both a service client and a user grant on capability calls", async () => {
    const { service, userA, userB } = harness();
    const added = await service.submitOperation(userA, addBody("op-cap", "ext-cap"));
    const authorizationRef = added.device?.binding?.authorizationRef ?? "";
    const grantCredential = service.peekGrantCredential(authorizationRef) ?? "";
    expect(grantCredential.startsWith("obgc_")).toBe(true);

    const ok = service.authorizeCapability(userA, {
      serviceClientId: "device-platform",
      serviceSecret: "service-secret-16+",
      authorizationRef,
      grantCredential,
    });
    expect(ok.deviceId).toBe(added.device?.deviceId);
    expect(JSON.stringify(ok)).not.toContain(grantCredential);

    expect(() =>
      service.authorizeCapability(userA, {
        serviceClientId: "device-platform",
        serviceSecret: "wrong-secret-value",
        authorizationRef,
        grantCredential,
      }),
    ).toThrow(/service client/i);
    expect(() =>
      service.authorizeCapability(userA, {
        serviceClientId: "device-platform",
        serviceSecret: "service-secret-16+",
        authorizationRef,
        grantCredential: "obgc_wrong",
      }),
    ).toThrow(/grant/i);
    expect(() =>
      service.authorizeCapability(userB, {
        serviceClientId: "device-platform",
        serviceSecret: "service-secret-16+",
        authorizationRef,
        grantCredential,
      }),
    ).toThrow(DevicePlatformError);
  });

  it("retries a failed health check only when asked", async () => {
    const { service, control, userA } = harness();
    control.healthStatus = "down";
    await expect(
      service.submitOperation(userA, addBody("op-health", "ext-health")),
    ).rejects.toMatchObject({
      code: "PLATFORM_UNAVAILABLE",
    });
    expect(service.listPersonalSettingsDevices(userA)).toHaveLength(1);
    control.healthStatus = "ok";
    const calls = control.calls.length;
    const restartedCalls = calls;
    expect(service.listPersonalSettingsDevices(userA)[0]?.binding).toBeNull();
    const retried = await service.retryOperation(userA, "op-health");
    expect(retried.device?.binding?.status).toBe("active");
    expect(control.calls.length).toBeGreaterThan(restartedCalls);
  });
});

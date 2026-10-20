import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleDevicePlatformRequest } from "./api.js";
import type { DevicePlatformControlClient } from "./control-client.js";
import { assertNoForbiddenUserKeys } from "./dto.js";
import type { IdentityDirectory, TrustedActor } from "./identity.js";
import { devicePlatformPathsUnder } from "./paths.js";
import { DevicePlatformService } from "./service.js";
import { DevicePlatformStore } from "./store.js";
import {
  DEVICE_PLATFORM_CONTROL_CONTRACT,
  DEVICE_PLATFORM_SCHEMA_VERSION,
  type DeviceAssociation,
  type DeviceBinding,
  type ManagementOperation,
  type TenantShard,
} from "./types.js";

const SECRET = "recovery-secret-value";
const NOW = "2026-10-20T00:00:00.000Z";

describe("device platform restart recovery", () => {
  it("keeps records queryable and does not replay side effects", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-platform-recovery-"));
    const store = new DevicePlatformStore(devicePlatformPathsUnder(root));
    const directory = new MemoryDirectory();
    const admin = actor({
      userId: "admin",
      tenantId: "platform",
      membershipId: "mem-admin",
      membershipRole: "enterprise-admin",
      platformAdmin: true,
      displayName: "Admin",
    });
    const user = actor({ userId: "user-a" });
    const seeding = new DevicePlatformService({
      store,
      directory,
      control: silentControl(),
      mode: "formal",
      env: {},
    });
    seeding.upsertConnection(admin, "plat-1", {
      displayName: "Platform",
      environment: "production",
      serviceBaseUrl: "https://platform.example/control",
      contractVersion: "1",
      credentialRef: "cred://device-platform/plat-1",
      clientIdentity: "device-platform",
      serviceClientIds: ["device-platform"],
      enabled: true,
    });
    seeding.setConnectionCredential(admin, "plat-1", { clientSecret: SECRET });

    const active = association("dev-active", "ext-active");
    const applying = association("dev-applying", "ext-applying");
    const shard: TenantShard = {
      schemaVersion: DEVICE_PLATFORM_SCHEMA_VERSION,
      associations: {
        [active.deviceId]: active,
        [applying.deviceId]: applying,
      },
      bindings: {
        "bind-active": binding(active, "active"),
        "bind-applying": binding(applying, "applying"),
      },
      bindingHistory: [],
      operations: {
        "op-done": operation("op-done", "succeeded", active.deviceId),
        "op-open": operation("op-open", "in_progress", applying.deviceId),
      },
      projections: {},
      grants: {
        azr_kept: {
          authorizationRef: "azr_kept",
          credentialHash: "hash-only",
          serviceClientId: "device-platform",
          digitalHumanId: "dh-a",
          deviceId: active.deviceId,
          userId: "user-a",
          tenantId: "tenant-1",
          scopes: ["chat"],
          bindingVersion: 1,
          status: "active",
          issuedAt: NOW,
        },
      },
      runs: {
        "run-done": {
          runId: "run-done",
          tenantId: "tenant-1",
          status: "completed",
          retryable: false,
          createdAt: NOW,
          finishedAt: NOW,
        },
        "run-open": {
          runId: "run-open",
          tenantId: "tenant-1",
          status: "running",
          retryable: true,
          createdAt: NOW,
        },
      },
      events: [],
      toolRequests: {
        req: {
          requestId: "req",
          tenantId: "tenant-1",
          state: "pending",
          updatedAt: NOW,
        },
      },
      idempotency: {
        done: {
          key: "done",
          hash: "a",
          inflight: false,
          response: { ok: true },
          createdAt: NOW,
        },
        open: {
          key: "open",
          hash: "b",
          inflight: true,
          authorizationRef: "azr_kept",
          createdAt: NOW,
        },
      },
    };
    store.saveTenant("tenant-1", shard);
    expect(fs.readFileSync(store.locations.tenantFile("tenant-1"), "utf8")).not.toContain("obgc_");

    const calls: string[] = [];
    const restarted = new DevicePlatformService({
      store,
      directory,
      control: recordingControl(calls),
      mode: "formal",
      env: {},
    });
    expect(calls).toEqual([]);

    const devices = await handleDevicePlatformRequest(
      restarted,
      { method: "GET", path: "/api/device-platform/v1/me/devices" },
      user,
    );
    expect(devices.status).toBe(200);
    assertNoForbiddenUserKeys(devices.body);
    const listed = devices.body.devices as Array<{
      deviceId: string;
      binding: { status: string } | null;
    }>;
    expect(listed.map((item) => item.deviceId).toSorted()).toEqual(["dev-active", "dev-applying"]);
    expect(listed.find((item) => item.deviceId === "dev-active")?.binding?.status).toBe("active");
    expect(listed.find((item) => item.deviceId === "dev-applying")?.binding?.status).toBe("error");
    expect(JSON.stringify(devices.body)).not.toContain(SECRET);
    expect(JSON.stringify(devices.body)).not.toContain("https://platform.example");
    expect(JSON.stringify(devices.body)).not.toContain("obgc_");

    const connections = await handleDevicePlatformRequest(
      restarted,
      { method: "GET", path: "/api/device-platform/v1/admin/connections" },
      admin,
    );
    expect(connections.status).toBe(200);
    expect(JSON.stringify(connections.body)).toContain("plat-1");
    expect(JSON.stringify(connections.body)).toContain("https://platform.example/control");
    expect(JSON.stringify(connections.body)).not.toContain(SECRET);

    const recovered = store.loadTenant("tenant-1");
    expect(recovered.associations["dev-active"]?.externalDeviceId).toBe("ext-active");
    expect(recovered.operations["op-done"]?.status).toBe("succeeded");
    expect(recovered.operations["op-open"]).toMatchObject({
      status: "interrupted",
      retryable: true,
      failure: { code: "UNKNOWN_AFTER_RESTART" },
    });
    expect(recovered.runs["run-done"]?.status).toBe("completed");
    expect(recovered.runs["run-open"]).toMatchObject({
      status: "interrupted",
      retryable: false,
      errorCode: "UNKNOWN_AFTER_RESTART",
    });
    expect(recovered.bindings["bind-active"]?.status).toBe("active");
    expect(recovered.bindings["bind-applying"]).toMatchObject({
      status: "error",
      failureCode: "UNKNOWN_AFTER_RESTART",
    });
    expect(recovered.idempotency.open).toBeUndefined();
    expect(recovered.idempotency.done?.response).toEqual({ ok: true });
    expect(recovered.toolRequests.req?.state).toBe("expired");
    expect(recovered.grants.azr_kept?.credentialHash).toBe("hash-only");
    expect(calls).toEqual([]);

    await expect(restarted.retryOperation(user, "op-open")).rejects.toThrow(/replay/);
    expect(calls).toEqual(["health"]);
  });
});

class MemoryDirectory implements IdentityDirectory {
  resolveActor(): null {
    return null;
  }

  getDigitalHuman(): null {
    return null;
  }

  hasDigitalHumanUse(): boolean {
    return false;
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

function association(deviceId: string, externalDeviceId: string): DeviceAssociation {
  return {
    deviceId,
    platformId: "plat-1",
    externalDeviceId,
    tenantId: "tenant-1",
    claimingUserId: "user-a",
    displayName: externalDeviceId,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function binding(row: DeviceAssociation, status: "active" | "applying"): DeviceBinding {
  return {
    bindingId: status === "active" ? "bind-active" : "bind-applying",
    deviceId: row.deviceId,
    platformId: row.platformId,
    externalDeviceId: row.externalDeviceId,
    tenantId: row.tenantId,
    userId: "user-a",
    digitalHumanId: "dh-a",
    scopes: ["chat"],
    authorizationRef: status === "active" ? "azr_kept" : undefined,
    expectedBindingVersion: 1,
    appliedBindingVersion: status === "active" ? 1 : 0,
    status,
    authorizationEstablished: status === "active",
    platformApplied: status === "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function operation(
  operationId: string,
  status: "succeeded" | "in_progress",
  deviceId: string,
): ManagementOperation {
  return {
    operationId,
    kind: "add",
    tenantId: "tenant-1",
    userId: "user-a",
    bodyHash: "seed",
    status,
    progress: status,
    deviceId,
    retryable: false,
    request: {
      kind: "add",
      platformId: "plat-1",
      externalDeviceId: deviceId === "dev-applying" ? "ext-applying" : "ext-active",
      digitalHumanId: "dh-a",
      challenge: "pch_recoverychallenge",
      proof: "123456",
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function silentControl(): DevicePlatformControlClient {
  return recordingControl([]);
}

function recordingControl(calls: string[]): DevicePlatformControlClient {
  const boom = async (name: string): Promise<never> => {
    calls.push(name);
    throw new Error(`replay ${name}`);
  };
  return {
    contract: DEVICE_PLATFORM_CONTROL_CONTRACT,
    discoverCapabilities: () => boom("discoverCapabilities"),
    verifyPairingChallenge: () => boom("verifyPairingChallenge"),
    queryDevices: () => boom("queryDevices"),
    applyBinding: () => boom("applyBinding"),
    getBindingApplicationStatus: () => boom("getBindingApplicationStatus"),
    stopOrRevoke: () => boom("stopOrRevoke"),
    syncStatus: () => boom("syncStatus"),
    health: () => boom("health"),
  };
}

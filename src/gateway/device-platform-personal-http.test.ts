import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectorHttpControl } from "../integrations/device-platform/connector-http-control.js";
import { assertNoForbiddenUserKeys } from "../integrations/device-platform/dto.js";
import {
  digitalHumanUseAllowed,
  type DigitalHumanRecord,
  type IdentityDirectory,
  type TrustedActor,
} from "../integrations/device-platform/identity.js";
import { devicePlatformPathsUnder } from "../integrations/device-platform/paths.js";
import { DevicePlatformService } from "../integrations/device-platform/service.js";
import { DevicePlatformStore } from "../integrations/device-platform/store.js";
import {
  handleDevicePlatformHttpRequest,
  type DevicePlatformGatewaySession,
} from "./device-platform-http.js";

const SECRET = "service-secret-value";
const SERVICE_USER = "device-platform";
const CHALLENGE = "pch_camerachallenge";
const DEVICE_ID = "cam-1";
const CODE = "123456";

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

type Challenge = {
  deviceId: string;
  code: string;
  expiresAtMs: number;
  redeemedBy?: string;
  redeemedCode?: string;
};

class MemoryDirectory implements IdentityDirectory {
  readonly humans = new Map<string, DigitalHumanRecord>();
  readonly permitted = new Map<string, string[]>();

  resolveActor(): null {
    return null;
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

  listUsableDigitalHumans(actor: TrustedActor): DigitalHumanRecord[] {
    return (this.permitted.get(actor.userId) ?? [])
      .map((id) => this.humans.get(id))
      .filter((human): human is DigitalHumanRecord => Boolean(human));
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

function session(userId: string): DevicePlatformGatewaySession {
  return {
    userId,
    displayName: userId,
    status: "active",
    sessionKind: "member",
    platformUser: false,
    tenantId: "tenant-1",
    membershipId: `mem-${userId}`,
    membershipRole: "member",
    permittedAgentIds: userId === "user-b" ? ["dh-shared"] : ["dh-shared", "dh-a"],
  };
}

function startPlatform() {
  const challenges = new Map<string, Challenge>();
  const devices = new Map<string, Record<string, unknown>>();
  const calls: Array<{ url: string; body: string; grant?: string }> = [];
  challenges.set(CHALLENGE, {
    deviceId: DEVICE_ID,
    code: CODE,
    expiresAtMs: Date.now() + 10 * 60 * 1000,
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const grant = req.headers["x-openbot-grant-credential"];
      calls.push({
        url: url.pathname,
        body,
        ...(typeof grant === "string" ? { grant } : {}),
      });
      const auth = req.headers.authorization ?? "";
      const expected = `Basic ${Buffer.from(`${SERVICE_USER}:${SECRET}`, "utf8").toString("base64")}`;
      if (auth !== expected) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (url.pathname.endsWith("/health")) {
        send(res, 200, healthBody);
        return;
      }
      if (url.pathname.endsWith("/capabilities")) {
        send(res, 200, capabilitiesBody);
        return;
      }
      const redeem = url.pathname.match(/\/pair-challenges\/([^/]+)\/redeem$/);
      if (req.method === "POST" && redeem?.[1]) {
        redeemChallenge(res, decodeURIComponent(redeem[1]), body, challenges);
        return;
      }
      const bind = url.pathname.match(/\/devices\/([^/]+)\/bind$/);
      if (bind?.[1] && req.method === "GET") {
        send(
          res,
          200,
          devices.get(decodeURIComponent(bind[1])) ?? unbound(decodeURIComponent(bind[1])),
        );
        return;
      }
      if (bind?.[1] && req.method === "POST") {
        if (body.includes("pairingCode") || body.includes("pairChallenge")) {
          send(res, 400, { error: "pairing_wrong" });
          return;
        }
        if (!grant) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const deviceId = decodeURIComponent(bind[1]);
        const stored = {
          deviceId,
          servicePrincipal: SERVICE_USER,
          ownership: "verified",
          bindStatus: "bound",
          revoked: false,
          authorizationRef: parsed.authorizationRef,
          bindingVersion: parsed.bindingVersion,
          digitalHumanId: parsed.digitalHumanId,
          model: "Lens-1",
          rawDiagnostics: "raw-diagnostic-dump",
        };
        devices.set(deviceId, stored);
        send(res, 200, stored);
        return;
      }
      const revoke = url.pathname.match(/\/devices\/([^/]+)\/revoke$/);
      if (revoke?.[1] && req.method === "POST") {
        const deviceId = decodeURIComponent(revoke[1]);
        const stored = {
          ...(devices.get(deviceId) ?? unbound(deviceId)),
          bindStatus: "revoked",
          revoked: true,
          clearedTokens: 1,
        };
        devices.set(deviceId, stored);
        send(res, 200, stored);
        return;
      }
      send(res, 404, { error: "http_failed" });
    });
  });

  return new Promise<{
    baseUrl: string;
    calls: typeof calls;
    challenges: Map<string, Challenge>;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
        challenges,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

function unbound(deviceId: string): Record<string, unknown> {
  return {
    deviceId,
    servicePrincipal: SERVICE_USER,
    ownership: "pending",
    bindStatus: "unbound",
    revoked: false,
  };
}

function redeemChallenge(
  res: http.ServerResponse,
  id: string,
  body: string,
  challenges: Map<string, Challenge>,
): void {
  const challenge = challenges.get(id);
  const parsed = JSON.parse(body) as { deviceId?: string; pairingCode?: string };
  if (!challenge) {
    send(res, 400, { error: "pairing_wrong" });
    return;
  }
  if (Date.now() > challenge.expiresAtMs) {
    send(res, 400, { error: "pairing_expired" });
    return;
  }
  if (parsed.deviceId !== challenge.deviceId) {
    send(res, 400, { error: "pairing_mismatch" });
    return;
  }
  if (challenge.redeemedBy) {
    if (challenge.redeemedBy === SERVICE_USER && challenge.redeemedCode === parsed.pairingCode) {
      send(res, 200, ownership(id, challenge.deviceId));
      return;
    }
    send(res, 400, { error: "pairing_replay" });
    return;
  }
  if (parsed.pairingCode !== challenge.code) {
    send(res, 400, { error: "pairing_wrong" });
    return;
  }
  challenge.redeemedBy = SERVICE_USER;
  challenge.redeemedCode = parsed.pairingCode;
  send(res, 200, ownership(id, challenge.deviceId));
}

function ownership(pairChallenge: string, deviceId: string) {
  return {
    pairChallenge,
    deviceId,
    servicePrincipal: SERVICE_USER,
    status: "redeemed",
    ownership: "verified",
  };
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function harness() {
  const platform = await startPlatform();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-personal-"));
  const directory = new MemoryDirectory();
  directory.humans.set("dh-shared", {
    digitalHumanId: "dh-shared",
    tenantId: "tenant-1",
    gatewayAgentId: "agent-shared",
    displayName: "共享数字人",
    status: "active",
    ownerId: "user-b",
  });
  directory.humans.set("dh-a", {
    digitalHumanId: "dh-a",
    tenantId: "tenant-1",
    gatewayAgentId: "agent-a",
    displayName: "我的数字人",
    status: "active",
    ownerId: "user-a",
  });
  directory.permitted.set("user-a", ["dh-shared", "dh-a"]);
  directory.permitted.set("user-b", ["dh-shared"]);
  const store = new DevicePlatformStore(devicePlatformPathsUnder(root));
  const service = new DevicePlatformService({
    store,
    directory,
    control: new ConnectorHttpControl(
      {
        loadConnection: (platformId) => store.loadConnections().connections[platformId] ?? null,
        loadCredential: (platformId) => store.loadCredential(platformId),
      },
      fetch,
    ),
    mode: "test",
  });
  const admin = actor({
    userId: "admin",
    tenantId: "platform",
    membershipId: "mem-admin",
    membershipRole: "enterprise-admin",
    platformAdmin: true,
  });
  service.upsertConnection(admin, "plat-1", {
    displayName: "实验室设备",
    environment: "development",
    serviceBaseUrl: platform.baseUrl,
    contractVersion: "v1-draft",
    credentialRef: "cred://device-platform/plat-1",
    clientIdentity: SERVICE_USER,
    serviceClientIds: [SERVICE_USER],
    enabled: true,
  });
  service.setConnectionCredential(admin, "plat-1", { clientSecret: SECRET });
  const userA = actor({ userId: "user-a" });
  const userB = actor({ userId: "user-b" });
  return { platform, service, userA, userB };
}

async function call(
  service: DevicePlatformService,
  current: DevicePlatformGatewaySession | null,
  method: string,
  requestPath: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const server = http.createServer((req, res) => {
    void handleDevicePlatformHttpRequest(req, res, {
      service,
      resolveSession: async () => current,
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
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function addBody(
  operationId: string,
  proof = CODE,
  externalDeviceId = DEVICE_ID,
  digitalHumanId = "dh-shared",
) {
  return {
    operationId,
    kind: "add",
    platformId: "plat-1",
    externalDeviceId,
    digitalHumanId,
    displayName: "门口相机",
    scopes: ["chat"],
    pairing: { challenge: CHALLENGE, proof },
  };
}

describe("personal device routes", () => {
  it("adds, lists, rebinds, and revokes through the connector origin", async () => {
    const { platform, service } = await harness();
    try {
      const added = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-add"),
      );
      expect(added.status).toBe(200);
      const device = (added.json.device ?? {}) as Record<string, unknown>;
      const binding = device.binding as Record<string, unknown>;
      expect(binding.status).toBe("active");
      expect(binding.digitalHumanId).toBe("dh-shared");
      expect(device.displayName).toBe("门口相机");
      expect(device.model).toBe("Lens-1");
      expect((device.status as Record<string, unknown>).presence).toBe("unknown");
      expect((device.status as Record<string, unknown>).online).toBe(false);
      assertNoForbiddenUserKeys(added.json);
      expect(added.text).not.toContain(SECRET);
      expect(added.text).not.toContain(platform.baseUrl);
      expect(added.text).not.toContain("obgc_");
      expect(added.text).not.toContain("raw-diagnostic");
      expect(added.text).not.toContain("cred://");

      const listed = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/devices",
      );
      expect(listed.status).toBe(200);
      expect(JSON.stringify(listed.json.devices)).toContain("门口相机");
      const hidden = await call(
        service,
        session("user-b"),
        "GET",
        "/api/device-platform/v1/me/devices",
      );
      expect(hidden.json.devices).toEqual([]);
      const platforms = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/platforms",
      );
      expect(JSON.stringify(platforms.json)).toContain("实验室设备");
      expect(platforms.text).not.toContain(platform.baseUrl);
      expect(platforms.text).not.toContain(SECRET);
      const humans = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/digital-humans",
      );
      expect(JSON.stringify(humans.json)).toContain("我的数字人");

      const deviceId = String(device.deviceId);
      const denied = await call(
        service,
        session("user-b"),
        "GET",
        `/api/device-platform/v1/me/devices/${deviceId}`,
      );
      expect(denied.status).toBe(404);
      const stolen = await call(
        service,
        session("user-b"),
        "POST",
        "/api/device-platform/v1/me/operations",
        {
          operationId: "op-steal",
          kind: "revoke",
          deviceId,
        },
      );
      expect(stolen.status).toBe(404);

      const rebound = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        {
          operationId: "op-rebind",
          kind: "rebind",
          deviceId,
          digitalHumanId: "dh-a",
          scopes: ["chat", "camera.capture"],
        },
      );
      expect(rebound.status).toBe(200);
      expect(
        ((rebound.json.device as Record<string, unknown>).binding as Record<string, unknown>)
          .digitalHumanId,
      ).toBe("dh-a");
      expect(
        ((rebound.json.device as Record<string, unknown>).binding as Record<string, unknown>)
          .expectedBindingVersion,
      ).toBe(2);

      const revoked = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        {
          operationId: "op-revoke",
          kind: "revoke",
          deviceId,
        },
      );
      expect(revoked.status).toBe(200);
      expect((revoked.json.device as Record<string, unknown>).binding).toBeNull();

      const bindCalls = platform.calls.filter((call) => call.url.endsWith("/bind") && call.body);
      expect(bindCalls.length).toBeGreaterThan(0);
      expect(bindCalls.every((call) => call.grant?.startsWith("obgc_"))).toBe(true);
      expect(
        bindCalls.some(
          (call) => call.body.includes("pairingCode") || call.body.includes("pairChallenge"),
        ),
      ).toBe(false);
      expect(platform.calls.some((call) => call.url.includes("/api/integrations/"))).toBe(false);
      expect(platform.calls.every((call) => call.url.startsWith("/api/device-platform/v1/"))).toBe(
        true,
      );
    } finally {
      await platform.close();
    }
  });

  it("rejects a wrong code without consuming it, then accepts the same code", async () => {
    const { platform, service } = await harness();
    try {
      const wrong = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-wrong", "000000"),
      );
      expect(wrong.status).toBe(400);
      expect(JSON.stringify(wrong.json)).toContain("PAIRING_WRONG");
      const listed = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/devices",
      );
      const devices = listed.json.devices as Array<{ binding: { status: string } | null }>;
      expect(devices[0]?.binding?.status).not.toBe("active");

      const again = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-right"),
      );
      expect(again.status).toBe(200);
      expect(
        ((again.json.device as Record<string, unknown>).binding as Record<string, unknown>).status,
      ).toBe("active");
      expect(platform.challenges.get(CHALLENGE)?.redeemedCode).toBe(CODE);
    } finally {
      await platform.close();
    }
  });

  it("rejects expired, replayed, and mismatched pairing codes", async () => {
    const { platform, service } = await harness();
    try {
      platform.challenges.set(CHALLENGE, {
        deviceId: DEVICE_ID,
        code: CODE,
        expiresAtMs: Date.now() - 1000,
      });
      const expired = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-expired"),
      );
      expect(expired.status).toBe(400);
      expect(JSON.stringify(expired.json)).toContain("PAIRING_EXPIRED");

      platform.challenges.set(CHALLENGE, {
        deviceId: DEVICE_ID,
        code: CODE,
        expiresAtMs: Date.now() + 10 * 60 * 1000,
      });
      const mismatch = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-mismatch", CODE, "cam-2"),
      );
      expect(mismatch.status).toBe(400);
      expect(JSON.stringify(mismatch.json)).toContain("PAIRING_MISMATCH");
      expect(platform.calls.filter((call) => call.url.endsWith("/bind") && call.body).length).toBe(
        0,
      );

      const added = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-once"),
      );
      expect(added.status).toBe(200);
      const deviceId = String((added.json.device as Record<string, unknown>).deviceId);
      await call(service, session("user-a"), "POST", "/api/device-platform/v1/me/operations", {
        operationId: "op-clear",
        kind: "revoke",
        deviceId,
      });
      const replay = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-replay", "654321"),
      );
      expect(replay.status).toBe(400);
      expect(JSON.stringify(replay.json)).toContain("PAIRING_REPLAY");
      const after = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/devices",
      );
      const rows = after.json.devices as Array<{ binding: { status: string } | null }>;
      expect(rows.every((row) => row.binding?.status !== "active")).toBe(true);
    } finally {
      await platform.close();
    }
  });

  it("rejects pairing field names on the OpenBot user API", async () => {
    const { platform, service } = await harness();
    try {
      const rejected = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        {
          ...addBody("op-names"),
          pairingCode: CODE,
        },
      );
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.json)).toContain("VALIDATION");
      expect(platform.calls.filter((call) => call.url.includes("/redeem")).length).toBe(0);
    } finally {
      await platform.close();
    }
  });

  it("keeps personal settings and the digital-human list on one store", async () => {
    const { platform, service } = await harness();
    try {
      const preselected = await call(
        service,
        session("user-b"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-preselect", CODE, DEVICE_ID, "dh-a"),
      );
      expect(preselected.status).toBe(403);
      expect(JSON.stringify(preselected.json)).toContain("USE_DENIED");
      expect(platform.calls.filter((item) => item.url.includes("/redeem")).length).toBe(0);

      const hiddenHuman = await call(
        service,
        session("user-b"),
        "GET",
        "/api/device-platform/v1/me/digital-humans/dh-a/devices",
      );
      expect(hiddenHuman.status).toBe(403);
      expect(JSON.stringify(hiddenHuman.json)).toContain("USE_DENIED");

      const added = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        addBody("op-share"),
      );
      expect(added.status).toBe(200);
      const deviceId = String((added.json.device as Record<string, unknown>).deviceId);
      const personal = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/devices",
      );
      const onHuman = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/digital-humans/dh-shared/devices",
      );
      expect(onHuman.status).toBe(200);
      expect(onHuman.json.devices).toEqual(personal.json.devices);
      expect(onHuman.text).toContain(deviceId);
      expect(onHuman.text).not.toContain(SECRET);
      expect(onHuman.text).not.toContain(platform.baseUrl);
      expect(onHuman.text).not.toContain("raw-diagnostic");
      expect(onHuman.text).not.toContain("obgc_");
      expect(onHuman.text).not.toContain("cred://");

      const sharedWithOther = await call(
        service,
        session("user-b"),
        "GET",
        "/api/device-platform/v1/me/digital-humans/dh-shared/devices",
      );
      expect(sharedWithOther.status).toBe(200);
      expect(sharedWithOther.json.devices).toEqual([]);
      expect(sharedWithOther.text).not.toContain(deviceId);
      expect(sharedWithOther.text).not.toContain("门口相机");

      const rebound = await call(
        service,
        session("user-a"),
        "POST",
        "/api/device-platform/v1/me/operations",
        {
          operationId: "op-share-rebind",
          kind: "rebind",
          deviceId,
          digitalHumanId: "dh-a",
          scopes: ["chat"],
        },
      );
      expect(rebound.status).toBe(200);
      const left = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/digital-humans/dh-shared/devices",
      );
      expect(left.json.devices).toEqual([]);
      const moved = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/digital-humans/dh-a/devices",
      );
      const personalAfter = await call(
        service,
        session("user-a"),
        "GET",
        "/api/device-platform/v1/me/devices",
      );
      expect(moved.json.devices).toEqual(personalAfter.json.devices);
    } finally {
      await platform.close();
    }
  });
});

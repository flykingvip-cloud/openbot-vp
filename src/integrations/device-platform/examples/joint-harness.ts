/**
 * Staging joint harness for OpenBot management routes and device-control.
 *
 * CI injects a loopback fake. The live device-control origin defaults to
 * http://127.0.0.1:8791 and is not contacted here. A harness pass is not
 * hardware evidence and not a cross-host pass.
 */

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { handleDevicePlatformRequest } from "../api.js";
import { ConnectorHttpControl } from "../connector-http-control.js";
import type { DevicePlatformControlClient } from "../control-client.js";
import { assertNoForbiddenUserKeys } from "../dto.js";
import {
  digitalHumanUseAllowed,
  type DigitalHumanRecord,
  type IdentityDirectory,
  type TrustedActor,
} from "../identity.js";
import { devicePlatformPathsUnder } from "../paths.js";
import { DevicePlatformService } from "../service.js";
import { DevicePlatformStore } from "../store.js";

export const DEFAULT_DEVICE_CONTROL_BASE_URL = "http://127.0.0.1:8791";
export const DEFAULT_OPENBOT_BASE_URL = "http://127.0.0.1:18789";

/**
 * Pin for Agent A: B4 main tip this joint branched from.
 * After merge, the coordinator publishes the new MERGE_SHA. Do not invent it.
 */
export const OPENBOT_CONTRACT_SHA = "490a69669c0cf9e68173ceb25cfa89c99438dfb9";
export const OPENBOT_OPENAPI_RAW_URL =
  "https://raw.githubusercontent.com/flykingvip-cloud/openbot-vp/490a69669c0cf9e68173ceb25cfa89c99438dfb9/docs/integrations/device-digital-human/openapi.yaml";

/** Historical device-control draft freeze. Not OPENBOT_CONTRACT_SHA. */
export const DEVICE_CONTROL_CONTRACT_SHA = "4ac6f2823c69a4c471fe89592a411a15535c0b81";
export const DEVICE_CONTROL_OPENAPI_RAW_URL =
  "https://raw.githubusercontent.com/flykingvip-cloud/openbot-device-sdk/4ac6f2823c69a4c471fe89592a411a15535c0b81/contracts/device-platform/device-control.openapi.yaml";

const SERVICE_USER = "device-platform";
const SERVICE_SECRET = "harness-only-secret";
const CHALLENGE = "pch_jointchallenge";
const EXTERNAL_DEVICE_ID = "cam-1";
const PAIRING_CODE = "123456";
const PLATFORM_ID = "plat-local";

const healthBody = {
  ok: true,
  service: "device-control",
  apiPrefix: "/api/device-platform/v1",
  maturity: "agent-b-freeze-draft",
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

export type RecordedControlCall = {
  method: string;
  path: string;
  body: string;
  grant?: string;
};

/**
 * Same path prefix on two origins is a collision. Device-control must not be
 * the OpenBot gateway host.
 */
export function assertSeparateControlOrigin(openBotBaseUrl: string, controlBaseUrl: string): void {
  const openBot = new URL(openBotBaseUrl);
  const control = new URL(controlBaseUrl);
  if (openBot.origin === control.origin) {
    throw new Error(
      "connector baseURL must be the device-control origin, not the OpenBot host; /api/device-platform/v1 collides",
    );
  }
}

export async function startFakeDeviceControl(): Promise<{
  baseUrl: string;
  calls: RecordedControlCall[];
  challenges: Map<string, Challenge>;
  close: () => Promise<void>;
}> {
  const challenges = new Map<string, Challenge>();
  const devices = new Map<string, Record<string, unknown>>();
  const calls: RecordedControlCall[] = [];
  challenges.set(CHALLENGE, {
    deviceId: EXTERNAL_DEVICE_ID,
    code: PAIRING_CODE,
    expiresAtMs: Date.now() + 10 * 60 * 1000,
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const grantHeader = req.headers["x-openbot-grant-credential"];
      const grant = typeof grantHeader === "string" ? grantHeader : undefined;
      calls.push({
        method: req.method ?? "GET",
        path: url.pathname,
        body,
        ...(grant ? { grant } : {}),
      });
      if (url.pathname.startsWith("/api/integrations/")) {
        send(res, 404, { error: "not_device_platform" });
        return;
      }
      const expected = `Basic ${Buffer.from(`${SERVICE_USER}:${SERVICE_SECRET}`, "utf8").toString("base64")}`;
      if ((req.headers.authorization ?? "") !== expected) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (req.method === "GET" && url.pathname.endsWith("/health")) {
        send(res, 200, healthBody);
        return;
      }
      if (req.method === "GET" && url.pathname.endsWith("/capabilities")) {
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
          send(res, 400, { error: "pair_field" });
          return;
        }
        if (!grant) {
          send(res, 401, { error: "grant_credential" });
          return;
        }
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (typeof parsed.authorizationRef !== "string" || !parsed.authorizationRef) {
          send(res, 400, { error: "grant_ref" });
          return;
        }
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
          source: "openbot-grant",
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

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    challenges,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export type JointHarnessReport = {
  controlBaseUrl: string;
  listedBefore: number;
  deviceId: string;
  reboundDigitalHumanId: string;
  revoked: boolean;
  restartedListed: boolean;
  callsDuringRestart: number;
  grayRelease: boolean;
  bindGrant?: string;
  authorizationRef?: string;
};

export async function runJointHarness(): Promise<JointHarnessReport> {
  assertSeparateControlOrigin(DEFAULT_OPENBOT_BASE_URL, DEFAULT_DEVICE_CONTROL_BASE_URL);
  const platform = await startFakeDeviceControl();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-joint-"));
  const directory = new MemoryDirectory();
  directory.humans.set("dh-a", human("dh-a", "agent-a", "我的数字人"));
  directory.humans.set("dh-shared", human("dh-shared", "agent-shared", "共享数字人"));
  directory.permitted.set("user-a", ["dh-a", "dh-shared"]);
  const store = new DevicePlatformStore(devicePlatformPathsUnder(root));
  const control = connector(store);
  const service = new DevicePlatformService({
    store,
    directory,
    control,
    mode: "formal",
    env: {},
  });
  const admin = actor({
    userId: "admin",
    tenantId: "platform",
    membershipId: "mem-admin",
    membershipRole: "enterprise-admin",
    platformAdmin: true,
  });
  const user = actor({ userId: "user-a" });
  try {
    service.upsertConnection(admin, PLATFORM_ID, {
      displayName: "Loopback device-control",
      environment: "development",
      serviceBaseUrl: platform.baseUrl,
      contractVersion: "agent-b-freeze-draft",
      credentialRef: "cred://device-platform/plat-local",
      clientIdentity: SERVICE_USER,
      serviceClientIds: [SERVICE_USER],
      enabled: true,
    });
    const stored = service.setConnectionCredential(admin, PLATFORM_ID, {
      clientSecret: SERVICE_SECRET,
    });
    if (JSON.stringify(stored).includes(SERVICE_SECRET)) {
      throw new Error("credential route echoed the service secret");
    }

    const before = await handleDevicePlatformRequest(
      service,
      { method: "GET", path: "/api/device-platform/v1/me/devices" },
      user,
    );
    assertNoForbiddenUserKeys(before.body);

    const added = await handleDevicePlatformRequest(
      service,
      {
        method: "POST",
        path: "/api/device-platform/v1/me/operations",
        body: {
          operationId: "op-add-1",
          kind: "add",
          platformId: PLATFORM_ID,
          externalDeviceId: EXTERNAL_DEVICE_ID,
          digitalHumanId: "dh-a",
          displayName: "Camera",
          scopes: ["chat", "camera.capture"],
          pairing: { challenge: CHALLENGE, proof: PAIRING_CODE },
        },
      },
      user,
    );
    if (added.status !== 200) {
      throw new Error(`add failed: ${added.status} ${JSON.stringify(added.body)}`);
    }
    assertNoForbiddenUserKeys(added.body);
    const deviceId = readDeviceId(added.body);
    const authorizationRef = readAuthorizationRef(added.body);

    const rebound = await handleDevicePlatformRequest(
      service,
      {
        method: "POST",
        path: "/api/device-platform/v1/me/operations",
        body: {
          operationId: "op-rebind-1",
          kind: "rebind",
          deviceId,
          digitalHumanId: "dh-shared",
          scopes: ["chat"],
        },
      },
      user,
    );
    if (rebound.status !== 200) {
      throw new Error(`rebind failed: ${rebound.status} ${JSON.stringify(rebound.body)}`);
    }
    assertNoForbiddenUserKeys(rebound.body);

    const revoked = await handleDevicePlatformRequest(
      service,
      {
        method: "POST",
        path: "/api/device-platform/v1/me/operations",
        body: { operationId: "op-revoke-1", kind: "revoke", deviceId },
      },
      user,
    );
    if (revoked.status !== 200) {
      throw new Error(`revoke failed: ${revoked.status} ${JSON.stringify(revoked.body)}`);
    }
    assertNoForbiddenUserKeys(revoked.body);

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
    });
    const callsBeforeRestart = platform.calls.length;
    const restarted = new DevicePlatformService({
      store,
      directory,
      control: connector(store),
      mode: "formal",
      env: {},
    });
    const callsDuringRestart = platform.calls.length - callsBeforeRestart;
    const after = await handleDevicePlatformRequest(
      restarted,
      { method: "GET", path: "/api/device-platform/v1/me/devices" },
      user,
    );
    assertNoForbiddenUserKeys(after.body);
    const shard = store.loadTenant("tenant-1");
    if (shard.runs.run1?.status !== "interrupted") {
      throw new Error("in-flight run was not marked interrupted");
    }
    if (callsDuringRestart !== 0) {
      throw new Error("restart replayed a device-control call");
    }

    const bind = platform.calls.find(
      (call) => call.method === "POST" && /\/devices\/[^/]+\/bind$/.test(call.path),
    );
    if (!bind?.grant || bind.grant.length < 8) {
      throw new Error("bind did not send X-OpenBot-Grant-Credential");
    }
    if (bind.body.includes("pairingCode") || bind.body.includes("pairChallenge")) {
      throw new Error("bind body included pairing fields");
    }
    if (!bind.body.includes(authorizationRef)) {
      throw new Error("bind did not send the OpenBot authorizationRef");
    }
    if (
      JSON.stringify(after.body).includes(bind.grant) ||
      JSON.stringify(added.body).includes(bind.grant)
    ) {
      throw new Error("user payload included grant plaintext");
    }
    if (platform.calls.some((call) => call.path.startsWith("/api/integrations/"))) {
      throw new Error("control client called the integrations prefix");
    }
    const listed = after.body.devices;
    const restartedListed =
      Array.isArray(listed) &&
      listed.some((item) => {
        return isRecord(item) && item.deviceId === deviceId;
      });
    const reboundHuman =
      isRecord(rebound.body.device) && isRecord(rebound.body.device.binding)
        ? rebound.body.device.binding.digitalHumanId
        : undefined;

    return {
      controlBaseUrl: platform.baseUrl,
      listedBefore: Array.isArray(before.body.devices) ? before.body.devices.length : -1,
      deviceId,
      reboundDigitalHumanId: typeof reboundHuman === "string" ? reboundHuman : "",
      revoked: isRecord(revoked.body.device) && revoked.body.device.binding == null,
      restartedListed,
      callsDuringRestart,
      grayRelease: healthBody.grayRelease,
      bindGrant: bind.grant,
      authorizationRef,
    };
  } finally {
    await platform.close();
  }
}

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

function human(
  digitalHumanId: string,
  gatewayAgentId: string,
  displayName: string,
): DigitalHumanRecord {
  return {
    digitalHumanId,
    tenantId: "tenant-1",
    gatewayAgentId,
    displayName,
    status: "active",
  };
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

function connector(store: DevicePlatformStore): DevicePlatformControlClient {
  return new ConnectorHttpControl(
    {
      loadConnection: (platformId) => store.loadConnections().connections[platformId] ?? null,
      loadCredential: (platformId) => store.loadCredential(platformId),
    },
    fetch,
  );
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
  if (!challenge || Date.now() > challenge.expiresAtMs) {
    send(res, 400, { error: challenge ? "pair_expired" : "pair_missing" });
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

function readDeviceId(body: Record<string, unknown>): string {
  if (!isRecord(body.device) || typeof body.device.deviceId !== "string") {
    throw new Error("add response has no deviceId");
  }
  return body.device.deviceId;
}

function readAuthorizationRef(body: Record<string, unknown>): string {
  if (
    !isRecord(body.device) ||
    !isRecord(body.device.binding) ||
    typeof body.device.binding.authorizationRef !== "string"
  ) {
    throw new Error("add response has no authorizationRef");
  }
  return body.device.binding.authorizationRef;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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
import { fileURLToPath } from "node:url";
import type { StubConfig } from "../../device-digital-human/config.js";
import { listenDeviceDh } from "../../device-digital-human/http.js";
import { DeviceDhService } from "../../device-digital-human/service.js";
import { basicHeader } from "../../device-digital-human/util.js";
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
import { HttpStubGrantRegistry } from "../stub-grant-registry.js";

export const DEFAULT_DEVICE_CONTROL_BASE_URL = "http://127.0.0.1:8791";
export const DEFAULT_OPENBOT_BASE_URL = "http://127.0.0.1:18789";
/** Integrations stub. Grant exchange lands here, not on the OpenBot admin host. */
export const DEFAULT_STUB_BASE_URL = "http://127.0.0.1:8787";

/**
 * Pin for Agent A: OpenBot main tip after B5, the tree this joint branched from.
 * After merge, the coordinator publishes the new MERGE_SHA. Do not invent it.
 */
export const OPENBOT_CONTRACT_SHA = "d7f0e1d834dc9ccece6723f6d71dea8fa0cfcb1f";
export const OPENBOT_OPENAPI_RAW_URL =
  "https://raw.githubusercontent.com/flykingvip-cloud/openbot-vp/d7f0e1d834dc9ccece6723f6d71dea8fa0cfcb1f/docs/integrations/device-digital-human/openapi.yaml";

/**
 * Device-sdk main tip Agent A named. Not a freeze.
 * Relative to docs merge 69cfb924: no field, path, or error-code changes.
 * info.version stays v1-draft. Health maturity stays agent-b-freeze-draft.
 */
export const DEVICE_SDK_MAIN_TIP = "9af0e59f6bce632fb2a38efc84a5dd3902551da5";
export const DEVICE_SDK_DOCS_MERGE_PREFIX = "69cfb924";
/** Their v1-frozen PR. CONTROL_FREEZE_SHA is assigned when that PR merges. */
export const DEVICE_SDK_V1_FROZEN_PR = "bc-860051cc";
/** Placeholder. Do not invent a commit SHA before Agent A merges the freeze. */
export const CONTROL_FREEZE_SHA = "TBD";
export const DEVICE_CONTROL_OPENAPI_PATH =
  "contracts/device-platform/device-control.openapi.yaml";

/** Historical device-control draft freeze. Not OPENBOT_CONTRACT_SHA and not CONTROL_FREEZE_SHA. */
export const DEVICE_CONTROL_CONTRACT_SHA = "4ac6f2823c69a4c471fe89592a411a15535c0b81";
export const DEVICE_CONTROL_OPENAPI_RAW_URL =
  "https://raw.githubusercontent.com/flykingvip-cloud/openbot-device-sdk/4ac6f2823c69a4c471fe89592a411a15535c0b81/contracts/device-platform/device-control.openapi.yaml";

/**
 * Mock joint order. CI speaks these routes on ephemeral ports.
 * The documented origins stay 8791 (device-control) and 8787 (grant stub).
 */
export const MOCK_JOINT_ORDER = [
  "control:health",
  "control:capabilities",
  "control:pair",
  "control:health",
  "control:capabilities",
  "control:redeem",
  "stub:consent",
  "stub:exchange",
  "control:bind",
  "stub:rebind",
  "control:bind",
  "control:revoke",
  "stub:revoke",
  "stub:grant-get",
  "stub:conversations",
] as const;

const SERVICE_USER = "device-platform";
const SERVICE_SECRET = "harness-only-secret";
const CONSENT_USER = "consent-sim";
const CONSENT_SECRET = "harness-consent-secret";
const REDIRECT_URI = "https://device.example/callback";
const CHALLENGE = "pch_jointchallenge";
const CREATED_CHALLENGE = "pch_createdjoint";
const EXTERNAL_DEVICE_ID = "cam-1";
const PAIRING_CODE = "123456";
const CREATED_CODE = "246810";
const PLATFORM_ID = "plat-local";
const HUMAN_A = "dh-a";
const HUMAN_B = "dh-b";

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

export async function startFakeDeviceControl(trace: string[] = []): Promise<{
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
      const method = req.method ?? "GET";
      calls.push({
        method,
        path: url.pathname,
        body,
        ...(grant ? { grant } : {}),
      });
      noteControl(trace, method, url.pathname);
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
      if (req.method === "POST" && url.pathname.endsWith("/pair-challenges")) {
        const parsed = JSON.parse(body) as { deviceId?: string };
        if (!parsed.deviceId) {
          send(res, 400, { error: "validation" });
          return;
        }
        challenges.set(CREATED_CHALLENGE, {
          deviceId: parsed.deviceId,
          code: CREATED_CODE,
          expiresAtMs: Date.now() + 10 * 60 * 1000,
        });
        send(res, 201, {
          pairChallenge: CREATED_CHALLENGE,
          deviceId: parsed.deviceId,
          pairingCode: CREATED_CODE,
          expiresAtMs: challenges.get(CREATED_CHALLENGE)?.expiresAtMs,
          status: "pending",
        });
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

export type VoicePhotoSimulation = {
  tier: "模拟";
  voice: "stub";
  photo: "stub";
  deviceEffect: false;
  hardware: false;
};

/**
 * Voice and photo have no hardware path in this harness.
 * A set gray-release or real-device flag refuses the stub instead of promoting it.
 */
export function simulateVoiceAndPhoto(flags: {
  grayRelease: boolean;
  realDeviceDelivery: boolean;
}): VoicePhotoSimulation {
  if (flags.grayRelease || flags.realDeviceDelivery) {
    throw new Error(
      "voice and photo stay 真机-only until grayRelease and realDeviceDelivery are explicitly true",
    );
  }
  return {
    tier: "模拟",
    voice: "stub",
    photo: "stub",
    deviceEffect: false,
    hardware: false,
  };
}

export type JointHarnessReport = {
  controlBaseUrl: string;
  stubBaseUrl: string;
  documentedControlBaseUrl: string;
  documentedStubBaseUrl: string;
  documentedOpenBotBaseUrl: string;
  listedBefore: number;
  deviceId: string;
  bindingId: string;
  authorizationRef: string;
  sameBindingOnHumanA: boolean;
  reboundDigitalHumanId: string;
  sameBindingOnHumanB: boolean;
  humanAClearedAfterRebind: boolean;
  revoked: boolean;
  personalClearedAfterRevoke: boolean;
  humanBClearedAfterRevoke: boolean;
  grantStatusAfterRevoke: string;
  oldAuthCannotExecute: boolean;
  capabilityRejectedAfterRevoke: boolean;
  adminHealthOk: boolean;
  restartedListed: boolean;
  callsDuringRestart: number;
  grayRelease: boolean;
  realDeviceDelivery: boolean;
  voicePhoto: VoicePhotoSimulation;
  trace: string[];
  bindGrant?: string;
};

export function assertMockJointOrder(trace: string[]): void {
  let from = 0;
  for (const step of MOCK_JOINT_ORDER) {
    const index = trace.indexOf(step, from);
    if (index < 0) {
      throw new Error(`mock joint order missing ${step} after ${from}: ${trace.join(" | ")}`);
    }
    from = index + 1;
  }
}

export async function runJointHarness(): Promise<JointHarnessReport> {
  assertSeparateControlOrigin(DEFAULT_OPENBOT_BASE_URL, DEFAULT_DEVICE_CONTROL_BASE_URL);
  assertSeparateControlOrigin(DEFAULT_OPENBOT_BASE_URL, DEFAULT_STUB_BASE_URL);
  assertSeparateControlOrigin(DEFAULT_DEVICE_CONTROL_BASE_URL, DEFAULT_STUB_BASE_URL);
  const trace: string[] = [];
  const platform = await startFakeDeviceControl(trace);
  const stub = await startJointStub(trace);
  assertSeparateControlOrigin(DEFAULT_OPENBOT_BASE_URL, platform.baseUrl);
  assertSeparateControlOrigin(platform.baseUrl, stub.url);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "device-joint-"));
  const directory = new MemoryDirectory();
  directory.humans.set(HUMAN_A, human(HUMAN_A, "agent-a", "数字人 A"));
  directory.humans.set(HUMAN_B, human(HUMAN_B, "agent-b", "数字人 B"));
  directory.permitted.set("user-a", [HUMAN_A, HUMAN_B]);
  const store = new DevicePlatformStore(devicePlatformPathsUnder(root));
  const control = connector(store);
  const service = new DevicePlatformService({
    store,
    directory,
    control,
    mode: "formal",
    env: {},
    grantRegistry: new HttpStubGrantRegistry({
      origin: stub.url,
      consentUser: CONSENT_USER,
      consentPassword: CONSENT_SECRET,
      serviceUser: SERVICE_USER,
      servicePassword: SERVICE_SECRET,
      redirectUri: REDIRECT_URI,
      fetchImpl: stub.fetchImpl,
    }),
    verifyServiceClient: (clientId, secret) =>
      clientId === SERVICE_USER && secret === SERVICE_SECRET,
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
    const registered = await handleDevicePlatformRequest(
      service,
      {
        method: "PUT",
        path: `/api/device-platform/v1/admin/connections/${PLATFORM_ID}`,
        body: {
          displayName: "Loopback device-control",
          environment: "development",
          serviceBaseUrl: platform.baseUrl,
          contractVersion: "v1-draft",
          credentialRef: "cred://device-platform/plat-local",
          clientIdentity: SERVICE_USER,
          serviceClientIds: [SERVICE_USER],
          enabled: true,
        },
      },
      admin,
    );
    if (registered.status !== 200) {
      throw new Error(`admin register failed: ${registered.status}`);
    }
    const stored = await handleDevicePlatformRequest(
      service,
      {
        method: "PUT",
        path: `/api/device-platform/v1/admin/connections/${PLATFORM_ID}/credential`,
        body: { clientSecret: SERVICE_SECRET },
      },
      admin,
    );
    if (stored.status !== 200 || JSON.stringify(stored.body).includes(SERVICE_SECRET)) {
      throw new Error("credential route echoed the service secret");
    }
    const probed = await handleDevicePlatformRequest(
      service,
      {
        method: "POST",
        path: `/api/device-platform/v1/admin/connections/${PLATFORM_ID}/test`,
      },
      admin,
    );
    if (probed.status !== 200 || !isRecord(probed.body.checks)) {
      throw new Error(`admin health failed: ${probed.status} ${JSON.stringify(probed.body)}`);
    }
    if (probed.body.checks.health !== "ok" || probed.body.checks.capabilities !== "ok") {
      throw new Error("admin health did not pass on the connector origin");
    }
    if (JSON.stringify(probed.body).includes(SERVICE_SECRET)) {
      throw new Error("admin health echoed the service secret");
    }

    const paired = await fetch(`${platform.baseUrl}/api/device-platform/v1/pair-challenges`, {
      method: "POST",
      headers: {
        authorization: basicHeader(SERVICE_USER, SERVICE_SECRET),
        "content-type": "application/json",
      },
      body: JSON.stringify({ deviceId: EXTERNAL_DEVICE_ID }),
    });
    const pairBody = (await paired.json()) as Record<string, unknown>;
    if (paired.status !== 201 || pairBody.pairChallenge !== CREATED_CHALLENGE) {
      throw new Error(`pair challenge failed: ${paired.status}`);
    }
    if (pairBody.pairingCode !== CREATED_CODE) {
      throw new Error("pair challenge did not return the harness code");
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
          digitalHumanId: HUMAN_A,
          displayName: "Camera",
          scopes: ["chat", "camera.capture"],
          pairing: { challenge: CREATED_CHALLENGE, proof: CREATED_CODE },
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
    const bindingId = readBindingId(added.body);
    const voicePhoto = simulateVoiceAndPhoto({
      grayRelease: healthBody.grayRelease,
      realDeviceDelivery: healthBody.realDeviceDelivery,
    });

    const personalA = await listDevices(service, user, "/api/device-platform/v1/me/devices");
    const humanA = await listDevices(
      service,
      user,
      `/api/device-platform/v1/me/digital-humans/${HUMAN_A}/devices`,
    );
    const personalBindingA = listedBinding(personalA, deviceId);
    const humanBindingA = listedBinding(humanA, deviceId);
    if (
      !personalBindingA ||
      !humanBindingA ||
      personalBindingA.bindingId !== bindingId ||
      humanBindingA.bindingId !== bindingId ||
      personalBindingA.authorizationRef !== authorizationRef ||
      humanBindingA.authorizationRef !== authorizationRef ||
      humanBindingA.digitalHumanId !== HUMAN_A
    ) {
      throw new Error("personal settings and digital human A do not share the binding");
    }

    const grantCredential = service.peekGrantCredential(authorizationRef);
    if (!grantCredential) {
      throw new Error("add did not keep a grant credential for the stub");
    }
    const activeGrant = await readStubGrant(stub, authorizationRef, grantCredential);
    if (activeGrant.status !== 200 || activeGrant.json.status !== "active") {
      throw new Error("stub grant was not active after exchange");
    }
    if (activeGrant.json.digitalHumanId !== HUMAN_A) {
      throw new Error("stub grant digital human does not match A");
    }
    const authorized = await authorize(service, user, authorizationRef, grantCredential);
    if (authorized.status !== 200) {
      throw new Error(`capability authorize failed before revoke: ${authorized.status}`);
    }

    const rebound = await handleDevicePlatformRequest(
      service,
      {
        method: "POST",
        path: "/api/device-platform/v1/me/operations",
        body: {
          operationId: "op-rebind-1",
          kind: "rebind",
          deviceId,
          digitalHumanId: HUMAN_B,
          scopes: ["chat"],
        },
      },
      user,
    );
    if (rebound.status !== 200) {
      throw new Error(`rebind failed: ${rebound.status} ${JSON.stringify(rebound.body)}`);
    }
    assertNoForbiddenUserKeys(rebound.body);
    const personalB = await listDevices(service, user, "/api/device-platform/v1/me/devices");
    const humanB = await listDevices(
      service,
      user,
      `/api/device-platform/v1/me/digital-humans/${HUMAN_B}/devices`,
    );
    const humanAAfter = await listDevices(
      service,
      user,
      `/api/device-platform/v1/me/digital-humans/${HUMAN_A}/devices`,
    );
    const personalBindingB = listedBinding(personalB, deviceId);
    const humanBindingB = listedBinding(humanB, deviceId);
    if (
      !personalBindingB ||
      !humanBindingB ||
      personalBindingB.bindingId !== bindingId ||
      humanBindingB.bindingId !== bindingId ||
      personalBindingB.authorizationRef !== authorizationRef ||
      humanBindingB.authorizationRef !== authorizationRef ||
      personalBindingB.digitalHumanId !== HUMAN_B ||
      humanBindingB.digitalHumanId !== HUMAN_B
    ) {
      throw new Error("personal settings and digital human B do not share the rebound binding");
    }
    if (listedBinding(humanAAfter, deviceId)) {
      throw new Error("digital human A still lists the device after rebind");
    }

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
    const personalRevoked = await listDevices(service, user, "/api/device-platform/v1/me/devices");
    const humanBRevoked = await listDevices(
      service,
      user,
      `/api/device-platform/v1/me/digital-humans/${HUMAN_B}/devices`,
    );
    const revokedGrant = await readStubGrant(stub, authorizationRef, grantCredential);
    const executed = await stub.fetchImpl(`${stub.url}/api/integrations/v1/conversations`, {
      method: "POST",
      headers: {
        authorization: basicHeader(SERVICE_USER, SERVICE_SECRET),
        "content-type": "application/json",
        "x-openbot-grant-credential": grantCredential,
      },
      body: JSON.stringify({ deviceId: EXTERNAL_DEVICE_ID }),
    });
    const executedBody = (await executed.json()) as Record<string, unknown>;
    const rejected = await authorize(service, user, authorizationRef, grantCredential);
    const oldAuthCannotExecute =
      revokedGrant.status === 200 &&
      revokedGrant.json.status === "revoked" &&
      executed.status === 401 &&
      isRecord(executedBody.error) &&
      executedBody.error.code === "AUTH_REVOKED" &&
      rejected.status !== 200;

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
      JSON.stringify(added.body).includes(bind.grant) ||
      JSON.stringify(personalA).includes(bind.grant)
    ) {
      throw new Error("user payload included grant plaintext");
    }
    if (platform.calls.some((call) => call.path.startsWith("/api/integrations/"))) {
      throw new Error("control client called the integrations prefix");
    }
    if (trace.some((step) => step.startsWith("stub:") && step.includes("media"))) {
      throw new Error("voice/photo stub touched media upload");
    }
    assertMockJointOrder(trace);
    if (!oldAuthCannotExecute) {
      throw new Error("revoked grant can still execute");
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
      stubBaseUrl: stub.url,
      documentedControlBaseUrl: DEFAULT_DEVICE_CONTROL_BASE_URL,
      documentedStubBaseUrl: DEFAULT_STUB_BASE_URL,
      documentedOpenBotBaseUrl: DEFAULT_OPENBOT_BASE_URL,
      listedBefore: Array.isArray(before.body.devices) ? before.body.devices.length : -1,
      deviceId,
      bindingId,
      authorizationRef,
      sameBindingOnHumanA: true,
      reboundDigitalHumanId: typeof reboundHuman === "string" ? reboundHuman : "",
      sameBindingOnHumanB: true,
      humanAClearedAfterRebind: !listedBinding(humanAAfter, deviceId),
      revoked: isRecord(revoked.body.device) && revoked.body.device.binding == null,
      personalClearedAfterRevoke: listedBinding(personalRevoked, deviceId) == null,
      humanBClearedAfterRevoke: listedBinding(humanBRevoked, deviceId) == null,
      grantStatusAfterRevoke:
        typeof revokedGrant.json.status === "string" ? revokedGrant.json.status : "",
      oldAuthCannotExecute,
      capabilityRejectedAfterRevoke: rejected.status !== 200,
      adminHealthOk: true,
      restartedListed,
      callsDuringRestart,
      grayRelease: healthBody.grayRelease,
      realDeviceDelivery: healthBody.realDeviceDelivery,
      voicePhoto,
      trace,
      bindGrant: bind.grant,
    };
  } finally {
    await platform.close();
    await stub.close();
  }
}

type JointStub = {
  url: string;
  fetchImpl: typeof fetch;
  close: () => Promise<void>;
};

async function startJointStub(trace: string[]): Promise<JointStub> {
  const service = new DeviceDhService({
    config: jointStubConfig(),
    approvalToken: "harness-approval",
  });
  const fixtureDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../device-digital-human/examples/fixtures",
  );
  const server = await listenDeviceDh({ service, fixtureDir, port: 0 });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    noteStub(trace, init?.method ?? "GET", new URL(url, server.url).pathname);
    return fetch(input, init);
  };
  return { url: server.url, fetchImpl, close: server.close };
}

function jointStubConfig(): StubConfig {
  return {
    clients: [
      {
        clientId: CONSENT_USER,
        secret: CONSENT_SECRET,
        role: "consent",
        allowedDigitalHumanIds: [HUMAN_A, HUMAN_B],
        scopes: ["chat", "camera.capture", "media.read"],
      },
      {
        clientId: SERVICE_USER,
        secret: SERVICE_SECRET,
        role: "service",
        redirectUris: [REDIRECT_URI],
      },
    ],
    digitalHumans: [
      {
        digitalHumanId: HUMAN_A,
        displayName: "数字人 A",
        status: "active",
        userSubject: "user-a",
        tenantId: "tenant-1",
      },
      {
        digitalHumanId: HUMAN_B,
        displayName: "数字人 B",
        status: "active",
        userSubject: "user-a",
        tenantId: "tenant-1",
      },
    ],
  };
}

function noteControl(trace: string[], method: string, pathname: string): void {
  if (method === "GET" && pathname.endsWith("/health")) {
    trace.push("control:health");
    return;
  }
  if (method === "GET" && pathname.endsWith("/capabilities")) {
    trace.push("control:capabilities");
    return;
  }
  if (method === "POST" && pathname.endsWith("/pair-challenges")) {
    trace.push("control:pair");
    return;
  }
  if (method === "POST" && /\/pair-challenges\/[^/]+\/redeem$/.test(pathname)) {
    trace.push("control:redeem");
    return;
  }
  if (method === "POST" && /\/devices\/[^/]+\/bind$/.test(pathname)) {
    trace.push("control:bind");
    return;
  }
  if (method === "GET" && /\/devices\/[^/]+\/bind$/.test(pathname)) {
    trace.push("control:bind-get");
    return;
  }
  if (method === "POST" && /\/devices\/[^/]+\/revoke$/.test(pathname)) {
    trace.push("control:revoke");
  }
}

function noteStub(trace: string[], method: string, pathname: string): void {
  if (pathname.endsWith("/consent/authorization-codes")) {
    trace.push("stub:consent");
    return;
  }
  if (pathname.endsWith("/grants/exchange")) {
    trace.push("stub:exchange");
    return;
  }
  if (pathname.endsWith("/rebind")) {
    trace.push("stub:rebind");
    return;
  }
  if (pathname.endsWith("/revoke")) {
    trace.push("stub:revoke");
    return;
  }
  if (method === "GET" && /\/grants\/[^/]+$/.test(pathname)) {
    trace.push("stub:grant-get");
    return;
  }
  if (pathname.endsWith("/conversations")) {
    trace.push("stub:conversations");
  }
}

async function listDevices(
  service: DevicePlatformService,
  user: TrustedActor,
  path: string,
): Promise<Record<string, unknown>> {
  const response = await handleDevicePlatformRequest(service, { method: "GET", path }, user);
  if (response.status !== 200) {
    throw new Error(`list failed: ${path} ${response.status}`);
  }
  assertNoForbiddenUserKeys(response.body);
  return response.body;
}

function listedBinding(
  body: Record<string, unknown>,
  deviceId: string,
): Record<string, unknown> | null {
  if (!Array.isArray(body.devices)) {
    return null;
  }
  for (const item of body.devices) {
    if (!isRecord(item) || item.deviceId !== deviceId) {
      continue;
    }
    return isRecord(item.binding) ? item.binding : null;
  }
  return null;
}

async function authorize(
  service: DevicePlatformService,
  user: TrustedActor,
  authorizationRef: string,
  grantCredential: string,
) {
  return handleDevicePlatformRequest(
    service,
    {
      method: "POST",
      path: "/api/device-platform/v1/capability/authorize",
      headers: {
        authorization: basicHeader(SERVICE_USER, SERVICE_SECRET),
        "x-openbot-grant-credential": grantCredential,
      },
      body: { authorizationRef },
    },
    user,
  );
}

async function readStubGrant(
  stub: JointStub,
  authorizationRef: string,
  grantCredential: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await stub.fetchImpl(
    `${stub.url}/api/integrations/v1/grants/${encodeURIComponent(authorizationRef)}`,
    {
      headers: {
        authorization: basicHeader(SERVICE_USER, SERVICE_SECRET),
        "x-openbot-grant-credential": grantCredential,
      },
    },
  );
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
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
  const binding = readBinding(body);
  if (typeof binding.authorizationRef !== "string") {
    throw new Error("add response has no authorizationRef");
  }
  return binding.authorizationRef;
}

function readBindingId(body: Record<string, unknown>): string {
  const binding = readBinding(body);
  if (typeof binding.bindingId !== "string") {
    throw new Error("add response has no bindingId");
  }
  return binding.bindingId;
}

function readBinding(body: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(body.device) || !isRecord(body.device.binding)) {
    throw new Error("add response has no binding");
  }
  return body.device.binding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

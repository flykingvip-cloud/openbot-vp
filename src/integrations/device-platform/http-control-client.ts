import { DEVICE_PLATFORM_API_PREFIX, DevicePlatformError } from "./types.js";

/**
 * HTTP client for the frozen device-platform control API.
 *
 * Host boundary: `serviceBaseUrl` is the device-platform origin configured by a
 * platform admin. Paths below are always requested on that origin under
 * `/api/device-platform/v1`. The same prefix on the OpenBot host is the admin
 * management API and is a different process. This client never calls
 * `/api/integrations/v1` and never sends `pairChallenge` or `pairingCode` there.
 *
 * Contract: openbot-device-sdk contracts/device-platform/device-control.openapi.yaml.
 * Historical draft freeze 4ac6f282 (PR flykingvip-cloud/openbot-device-sdk#12).
 * Agent A main tip 9af0e59 has no field, path, or error-code changes versus docs
 * merge 69cfb924. CONTROL_FREEZE_SHA stays TBD until the v1-frozen PR lands.
 * Field names in this client stay frozen.
 */

export const DEVICE_CONTROL_PAIRING_FIELDS = ["pairChallenge", "pairingCode"] as const;

const PAIR_CHALLENGE_ID = /^pch_[A-Za-z0-9_-]{8,80}$/;
const DEVICE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const PAIRING_CODE = /^[0-9]{6}$/;

export type DeviceControlFetch = typeof fetch;

export type DeviceControlHealth = {
  ok: true;
  service: "device-control";
  apiPrefix: typeof DEVICE_PLATFORM_API_PREFIX;
  maturity: "agent-b-freeze-draft";
  grayRelease: false;
  realDeviceDelivery: false;
  firmwareUrl: null;
  executable: false;
  flash: false;
  massFlash: false;
};

export type DeviceControlCapabilities = {
  apiPrefix: typeof DEVICE_PLATFORM_API_PREFIX;
  audience: "openbot-service-client";
  auth: "serviceBasic";
  browserIdentity: false;
  routes: string[];
  openBot: {
    prefix: "/api/integrations/v1";
    consent: "pkce-s256";
    grantExchange: "POST /grants/exchange";
    pairFieldsAccepted: false;
  };
  ota: {
    flash: false;
    massFlash: false;
    firmwareUrl: null;
  };
};

export type DeviceControlPairChallenge = {
  pairChallenge: string;
  deviceId: string;
  pairingCode: string;
  expiresAtMs: number;
  status: "pending";
};

export type DeviceControlPairOwnership = {
  pairChallenge: string;
  deviceId: string;
  servicePrincipal: string;
  status: "redeemed";
  ownership: "verified";
};

export type DeviceControlDevice = {
  deviceId: string;
  servicePrincipal: string;
  ownership: "pending" | "verified";
  bindStatus: "unbound" | "bound" | "revoked";
  revoked: boolean;
  pairChallenge?: string;
  authorizationRef?: string;
  bindingVersion?: number;
  digitalHumanId?: string;
  assistant?: Record<string, unknown>;
  source?: "openbot-grant";
  clearedTokens?: number;
};

export class DeviceControlHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "DeviceControlHttpError";
    this.code = code;
    this.status = status;
  }
}

export type HttpDevicePlatformControlOptions = {
  serviceBaseUrl: string;
  serviceUser: string;
  servicePassword: string;
  fetchImpl?: DeviceControlFetch;
  timeoutMs?: number;
};

/**
 * Join the admin-configured device-platform origin with a frozen control path.
 * A base URL that already ends in the control prefix is not doubled.
 * Any other path on the base URL is ignored: control paths are host-absolute.
 */
export function deviceControlUrl(serviceBaseUrl: string, suffix: string): string {
  if (!suffix.startsWith("/") || suffix.startsWith("//")) {
    throw new DeviceControlHttpError("VALIDATION", 0, "Device control path is invalid");
  }
  if (suffix.startsWith("/api/integrations/")) {
    throw new DeviceControlHttpError(
      "VALIDATION",
      0,
      "Device control client must not call OpenBot integrations",
    );
  }
  const url = new URL(serviceBaseUrl);
  return `${url.origin}${DEVICE_PLATFORM_API_PREFIX}${suffix}`;
}

export function assertBodyHasNoPairingFields(body: Record<string, unknown>): void {
  for (const field of DEVICE_CONTROL_PAIRING_FIELDS) {
    if (body[field] !== undefined) {
      throw new DevicePlatformError(
        "VALIDATION",
        "pairChallenge and pairingCode are not accepted on OpenBot APIs",
      );
    }
  }
}

export class HttpDevicePlatformControl {
  private readonly serviceBaseUrl: string;
  private readonly serviceUser: string;
  private readonly servicePassword: string;
  private readonly fetchImpl: DeviceControlFetch;
  private readonly timeoutMs: number;

  constructor(options: HttpDevicePlatformControlOptions) {
    this.serviceBaseUrl = options.serviceBaseUrl;
    this.serviceUser = options.serviceUser;
    this.servicePassword = options.servicePassword;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async getHealth(): Promise<DeviceControlHealth> {
    const body = await this.request("/health", { method: "GET", expect: 200 });
    return parseHealth(body);
  }

  async getCapabilities(): Promise<DeviceControlCapabilities> {
    const body = await this.request("/capabilities", { method: "GET", expect: 200 });
    return parseCapabilities(body);
  }

  async createPairChallenge(deviceId: string): Promise<DeviceControlPairChallenge> {
    assertDeviceId(deviceId);
    const body = await this.request("/pair-challenges", {
      method: "POST",
      expect: 201,
      json: { deviceId },
    });
    return parsePairChallenge(body);
  }

  async redeemPairChallenge(input: {
    pairChallenge: string;
    deviceId: string;
    pairingCode: string;
  }): Promise<DeviceControlPairOwnership> {
    if (!PAIR_CHALLENGE_ID.test(input.pairChallenge)) {
      throw new DeviceControlHttpError("VALIDATION", 0, "pairChallenge is invalid");
    }
    assertDeviceId(input.deviceId);
    if (!PAIRING_CODE.test(input.pairingCode)) {
      throw new DeviceControlHttpError("VALIDATION", 0, "pairingCode is invalid");
    }
    const body = await this.request(
      `/pair-challenges/${encodeURIComponent(input.pairChallenge)}/redeem`,
      {
        method: "POST",
        expect: 200,
        json: { deviceId: input.deviceId, pairingCode: input.pairingCode },
      },
    );
    return parseOwnership(body);
  }

  async listDevices(): Promise<DeviceControlDevice[]> {
    const body = await this.request("/devices", { method: "GET", expect: 200 });
    if (!isRecord(body) || !Array.isArray(body.devices)) {
      throw new DeviceControlHttpError("CONTRACT", 200, "Device list is not compatible");
    }
    return body.devices.map((item) => parseDevice(item));
  }

  async getBind(deviceId: string): Promise<DeviceControlDevice> {
    assertDeviceId(deviceId);
    const body = await this.request(`/devices/${encodeURIComponent(deviceId)}/bind`, {
      method: "GET",
      expect: 200,
    });
    return parseDevice(body);
  }

  /**
   * Apply a bind that OpenBot already exchanged.
   * `authorizationRef` is copied from the grant. This client does not mint one.
   */
  async applyBind(input: {
    deviceId: string;
    authorizationRef: string;
    grantCredential: string;
    bindingVersion?: number;
    digitalHumanId?: string;
  }): Promise<DeviceControlDevice> {
    return this.postBind("/bind", input);
  }

  async syncBind(input: {
    deviceId: string;
    authorizationRef: string;
    grantCredential: string;
    bindingVersion?: number;
    digitalHumanId?: string;
  }): Promise<DeviceControlDevice> {
    return this.postBind("/bind/sync", input);
  }

  /** Local stop on the device platform. Does not call OpenBot revoke. */
  async stopLocal(deviceId: string): Promise<DeviceControlDevice> {
    return this.postLocalStop(deviceId, "/stop");
  }

  /** Same local stop as `/stop`. Does not call OpenBot revoke. */
  async revokeLocal(deviceId: string): Promise<DeviceControlDevice> {
    return this.postLocalStop(deviceId, "/revoke");
  }

  private async postBind(
    suffix: "/bind" | "/bind/sync",
    input: {
      deviceId: string;
      authorizationRef: string;
      grantCredential: string;
      bindingVersion?: number;
      digitalHumanId?: string;
    },
  ): Promise<DeviceControlDevice> {
    assertDeviceId(input.deviceId);
    const authorizationRef = input.authorizationRef.trim();
    const grantCredential = input.grantCredential.trim();
    if (!authorizationRef || !grantCredential) {
      throw new DeviceControlHttpError("VALIDATION", 0, "OpenBot grant is required");
    }
    const json: Record<string, unknown> = { authorizationRef };
    if (input.bindingVersion !== undefined) {
      json.bindingVersion = input.bindingVersion;
    }
    if (input.digitalHumanId !== undefined) {
      json.digitalHumanId = input.digitalHumanId;
    }
    assertBodyHasNoPairingFields(json);
    const body = await this.request(`/devices/${encodeURIComponent(input.deviceId)}${suffix}`, {
      method: "POST",
      expect: 200,
      json,
      grantCredential,
    });
    return parseDevice(body);
  }

  private async postLocalStop(
    deviceId: string,
    suffix: "/stop" | "/revoke",
  ): Promise<DeviceControlDevice> {
    assertDeviceId(deviceId);
    const body = await this.request(`/devices/${encodeURIComponent(deviceId)}${suffix}`, {
      method: "POST",
      expect: 200,
      json: {},
    });
    return parseStopResult(body);
  }

  private async request(
    suffix: string,
    init: {
      method: string;
      expect: number;
      json?: Record<string, unknown>;
      grantCredential?: string;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: basicHeader(this.serviceUser, this.servicePassword),
    };
    if (init.json) {
      headers["content-type"] = "application/json";
    }
    if (init.grantCredential) {
      headers["X-OpenBot-Grant-Credential"] = init.grantCredential;
    }
    let response: Response;
    try {
      response = await this.fetchImpl(deviceControlUrl(this.serviceBaseUrl, suffix), {
        method: init.method,
        headers,
        body: init.json ? JSON.stringify(init.json) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw mapTransportError(error);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new DeviceControlHttpError("REDIRECT", response.status, "Redirects are not followed");
    }
    const payload = await readJson(response);
    if (response.status !== init.expect) {
      throw new DeviceControlHttpError(
        errorCode(payload, response.status),
        response.status,
        "Device platform request failed",
      );
    }
    return payload;
  }
}

function basicHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

function mapTransportError(error: unknown): DeviceControlHttpError {
  if (error instanceof DeviceControlHttpError) {
    return error;
  }
  const name = error instanceof Error ? error.name : "";
  const message = transportMessage(error);
  if (name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message)) {
    return new DeviceControlHttpError("TIMEOUT", 0, "Device platform check timed out");
  }
  if (/redirect/i.test(message)) {
    return new DeviceControlHttpError("REDIRECT", 0, "Redirects are not followed");
  }
  return new DeviceControlHttpError("HTTP_FAILED", 0, "Device platform request failed");
}

function transportMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" ");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function errorCode(payload: unknown, status: number): string {
  if (
    isRecord(payload) &&
    typeof payload.error === "string" &&
    /^[a-z0-9_]{1,40}$/.test(payload.error)
  ) {
    return payload.error;
  }
  if (status === 401) {
    return "unauthorized";
  }
  return "http_failed";
}

function parseHealth(body: unknown): DeviceControlHealth {
  if (
    !isRecord(body) ||
    body.ok !== true ||
    body.service !== "device-control" ||
    body.apiPrefix !== DEVICE_PLATFORM_API_PREFIX ||
    body.maturity !== "agent-b-freeze-draft" ||
    body.grayRelease !== false ||
    body.realDeviceDelivery !== false ||
    body.firmwareUrl !== null ||
    body.executable !== false ||
    body.flash !== false ||
    body.massFlash !== false
  ) {
    throw new DeviceControlHttpError("CONTRACT", 200, "Device platform health is not compatible");
  }
  return body as DeviceControlHealth;
}

function parseCapabilities(body: unknown): DeviceControlCapabilities {
  if (!isRecord(body) || !isRecord(body.openBot) || !isRecord(body.ota)) {
    throw new DeviceControlHttpError(
      "CONTRACT",
      200,
      "Device platform capabilities are not compatible",
    );
  }
  const openBot = body.openBot;
  if (
    body.apiPrefix !== DEVICE_PLATFORM_API_PREFIX ||
    body.audience !== "openbot-service-client" ||
    body.auth !== "serviceBasic" ||
    body.browserIdentity !== false ||
    !Array.isArray(body.routes) ||
    body.routes.some((route) => typeof route !== "string") ||
    openBot.prefix !== "/api/integrations/v1" ||
    openBot.consent !== "pkce-s256" ||
    openBot.grantExchange !== "POST /grants/exchange" ||
    openBot.pairFieldsAccepted !== false ||
    body.ota.flash !== false ||
    body.ota.massFlash !== false ||
    body.ota.firmwareUrl !== null
  ) {
    throw new DeviceControlHttpError(
      "CONTRACT",
      200,
      "Device platform capabilities are not compatible",
    );
  }
  return body as DeviceControlCapabilities;
}

function parsePairChallenge(body: unknown): DeviceControlPairChallenge {
  if (
    !isRecord(body) ||
    typeof body.pairChallenge !== "string" ||
    typeof body.deviceId !== "string" ||
    typeof body.pairingCode !== "string" ||
    typeof body.expiresAtMs !== "number" ||
    body.status !== "pending"
  ) {
    throw new DeviceControlHttpError("CONTRACT", 201, "Pair challenge is not compatible");
  }
  return body as DeviceControlPairChallenge;
}

function parseOwnership(body: unknown): DeviceControlPairOwnership {
  if (
    !isRecord(body) ||
    typeof body.pairChallenge !== "string" ||
    typeof body.deviceId !== "string" ||
    typeof body.servicePrincipal !== "string" ||
    body.status !== "redeemed" ||
    body.ownership !== "verified" ||
    body.pairingCode !== undefined
  ) {
    throw new DeviceControlHttpError("CONTRACT", 200, "Pair ownership is not compatible");
  }
  return body as DeviceControlPairOwnership;
}

function parseDevice(body: unknown): DeviceControlDevice {
  if (
    !isRecord(body) ||
    typeof body.deviceId !== "string" ||
    typeof body.servicePrincipal !== "string" ||
    (body.ownership !== "pending" && body.ownership !== "verified") ||
    (body.bindStatus !== "unbound" &&
      body.bindStatus !== "bound" &&
      body.bindStatus !== "revoked") ||
    typeof body.revoked !== "boolean" ||
    body.pairingCode !== undefined
  ) {
    throw new DeviceControlHttpError("CONTRACT", 200, "Device record is not compatible");
  }
  return body as DeviceControlDevice;
}

function parseStopResult(body: unknown): DeviceControlDevice {
  const device = parseDevice(body);
  if (!isRecord(body) || typeof body.clearedTokens !== "number" || body.clearedTokens < 0) {
    throw new DeviceControlHttpError("CONTRACT", 200, "Stop result is not compatible");
  }
  return device;
}

function assertDeviceId(deviceId: string): void {
  if (!DEVICE_ID.test(deviceId)) {
    throw new DeviceControlHttpError("VALIDATION", 0, "deviceId is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

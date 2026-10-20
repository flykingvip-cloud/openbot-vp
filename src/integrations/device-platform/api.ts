import { assertBodyHasNoPairingFields } from "./http-control-client.js";
import { rejectIdentityOverrides, type TrustedActor } from "./identity.js";
import type { DevicePlatformService, SubmitOperationInput } from "./service.js";
import {
  DEVICE_PLATFORM_API_PREFIX,
  DEVICE_PLATFORM_ERROR_HTTP,
  DevicePlatformError,
} from "./types.js";

export type DevicePlatformHttpRequest = {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
};

export type DevicePlatformHttpResponse = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Handler for the management API.
 * The gateway mounts admin connector routes and the signed-in member device
 * routes. The loopback integrations stub stays a separate test process.
 */
export async function handleDevicePlatformRequest(
  service: DevicePlatformService,
  request: DevicePlatformHttpRequest,
  actorOverride?: TrustedActor,
): Promise<DevicePlatformHttpResponse> {
  try {
    return await route(service, request, actorOverride);
  } catch (error) {
    if (error instanceof DevicePlatformError) {
      return {
        status: DEVICE_PLATFORM_ERROR_HTTP[error.code],
        body: { ok: false, error: { code: error.code, message: error.message } },
      };
    }
    return {
      status: 500,
      body: { ok: false, error: { code: "INTERNAL", message: "Device platform request failed" } },
    };
  }
}

async function route(
  service: DevicePlatformService,
  request: DevicePlatformHttpRequest,
  actorOverride?: TrustedActor,
): Promise<DevicePlatformHttpResponse> {
  const method = request.method.toUpperCase();
  const path = request.path.split("?")[0] ?? request.path;
  const headers = lowerHeaders(request.headers);
  const actor = actorOverride ?? service.sessionActor(headers["x-openbot-session"]);
  const raw = isRecord(request.body) ? request.body : undefined;

  if (method === "GET" && path === `${DEVICE_PLATFORM_API_PREFIX}/me/devices`) {
    return ok({ devices: service.listPersonalSettingsDevices(actor) });
  }

  if (method === "GET" && path === `${DEVICE_PLATFORM_API_PREFIX}/me/platforms`) {
    return ok({ platforms: service.listPersonalPlatforms(actor) });
  }

  if (method === "GET" && path === `${DEVICE_PLATFORM_API_PREFIX}/me/digital-humans`) {
    return ok({ digitalHumans: service.listPersonalDigitalHumans(actor) });
  }

  const humanDevices = path.match(
    /^\/api\/device-platform\/v1\/me\/digital-humans\/([^/]+)\/devices$/,
  );
  if (method === "GET" && humanDevices?.[1]) {
    return ok({
      devices: service.listDigitalHumanDevices(actor, decodeURIComponent(humanDevices[1])),
    });
  }

  const oneDevice = path.match(/^\/api\/device-platform\/v1\/me\/devices\/([^/]+)$/);
  if (method === "GET" && oneDevice?.[1]) {
    return ok({ device: service.getDevice(actor, decodeURIComponent(oneDevice[1])) });
  }

  if (method === "POST" && path === `${DEVICE_PLATFORM_API_PREFIX}/me/operations`) {
    const result = await service.submitOperation(actor, operationInput(raw), raw);
    return ok(result, result.operation.inflight ? 202 : 200);
  }

  const retry = path.match(/^\/api\/device-platform\/v1\/me\/operations\/([^/]+)\/retry$/);
  if (method === "POST" && retry?.[1]) {
    const result = await service.retryOperation(actor, decodeURIComponent(retry[1]));
    return ok(result);
  }

  if (method === "GET" && path === `${DEVICE_PLATFORM_API_PREFIX}/admin/connections`) {
    return ok({ connections: service.listConnections(actor) });
  }

  const connection = path.match(/^\/api\/device-platform\/v1\/admin\/connections\/([^/]+)$/);
  if (connection?.[1] && method === "GET") {
    return ok({ connection: service.getConnection(actor, decodeURIComponent(connection[1])) });
  }
  const credential = path.match(
    /^\/api\/device-platform\/v1\/admin\/connections\/([^/]+)\/credential$/,
  );
  if (credential?.[1] && method === "PUT") {
    return ok({
      connection: service.setConnectionCredential(
        actor,
        decodeURIComponent(credential[1]),
        {
          clientSecret: readString(raw, "clientSecret"),
          rotate: raw?.rotate === true,
        },
        raw,
      ),
    });
  }

  const probe = path.match(/^\/api\/device-platform\/v1\/admin\/connections\/([^/]+)\/test$/);
  if (probe?.[1] && method === "POST") {
    const result = await service.testConnection(actor, decodeURIComponent(probe[1]));
    return ok(result);
  }

  if (connection?.[1] && method === "PUT") {
    return ok({
      connection: service.upsertConnection(
        actor,
        decodeURIComponent(connection[1]),
        {
          displayName: readString(raw, "displayName"),
          environment: readString(raw, "environment"),
          serviceBaseUrl: readString(raw, "serviceBaseUrl"),
          contractVersion: readString(raw, "contractVersion"),
          credentialRef: readString(raw, "credentialRef"),
          clientIdentity: readString(raw, "clientIdentity"),
          registrationNotes: readString(raw, "registrationNotes"),
          callbackAllowlist: readStringArray(raw, "callbackAllowlist"),
          serviceClientIds: readStringArray(raw, "serviceClientIds"),
          enabled: typeof raw?.enabled === "boolean" ? raw.enabled : undefined,
        },
        raw,
      ),
    });
  }

  if (method === "POST" && path === `${DEVICE_PLATFORM_API_PREFIX}/capability/authorize`) {
    if (raw) {
      rejectCapabilityBody(raw);
    }
    const basic = readBasic(headers.authorization);
    const result = service.authorizeCapability(actor, {
      serviceClientId: basic?.id ?? "",
      serviceSecret: basic?.secret ?? "",
      authorizationRef: readString(raw, "authorizationRef") ?? "",
      grantCredential: headers["x-openbot-grant-credential"] ?? "",
    });
    return ok(result);
  }

  return {
    status: 404,
    body: { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } },
  };
}

const SECRET_FIELDS = [
  "clientSecret",
  "serviceSecret",
  "devicePrivateKey",
  "vendorKey",
  "rawDiagnostics",
  "secret",
  "authorizationCredential",
];

function rejectCapabilityBody(body: Record<string, unknown>): void {
  rejectIdentityOverrides(body);
  assertBodyHasNoPairingFields(body);
  for (const field of SECRET_FIELDS) {
    if (body[field] !== undefined) {
      throw new DevicePlatformError("SECRET_REJECTED", "Secrets are not accepted on this API");
    }
  }
  for (const key of Object.keys(body)) {
    if (key !== "authorizationRef") {
      throw new DevicePlatformError("VALIDATION", "Capability authorization body is invalid");
    }
  }
}

function operationInput(raw: Record<string, unknown> | undefined): SubmitOperationInput {
  const pairing = isRecord(raw?.pairing) ? raw.pairing : undefined;
  return {
    operationId: readString(raw, "operationId") ?? "",
    kind: readString(raw, "kind") as SubmitOperationInput["kind"],
    platformId: readString(raw, "platformId"),
    externalDeviceId: readString(raw, "externalDeviceId"),
    deviceId: readString(raw, "deviceId"),
    digitalHumanId: readString(raw, "digitalHumanId"),
    scopes: readStringArray(raw, "scopes"),
    displayName: readString(raw, "displayName"),
    pairing: pairing
      ? { challenge: readString(pairing, "challenge"), proof: readString(pairing, "proof") }
      : undefined,
  };
}

function ok(data: Record<string, unknown>, status = 200): DevicePlatformHttpResponse {
  return { status, body: { ok: true, ...data } };
}

function lowerHeaders(
  headers: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    next[key.toLowerCase()] = value;
  }
  return next;
}

function readBasic(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith("Basic ")) {
    return null;
  }
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const index = decoded.indexOf(":");
  if (index <= 0) {
    return null;
  }
  return { id: decoded.slice(0, index), secret: decoded.slice(index + 1) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(body: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = body?.[key];
  return typeof value === "string" ? value : undefined;
}

function readStringArray(
  body: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = body?.[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value as string[];
}

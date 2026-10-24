/**
 * Gateway mount for integrations grant mint + media upload-tickets.
 *
 * Co-locates the grant/media surface on the same in-process DeviceDhService used by
 * Claw4 firmware HTTP when OPENBOT_CLAW4_FIRMWARE_INPROCESS=1 (or when a
 * service is injected via setClaw4FirmwareService). Joint can mint grants and
 * issue media upload-tickets on local gateway 18789 without a temporary ops
 * seed and without talking to a separate 8787 process.
 *
 * Owns only:
 *   POST /api/integrations/v1/consent/authorization-codes
 *   POST /api/integrations/v1/grants/exchange
 *   GET  /api/integrations/v1/grants/{authorizationRef}
 *   POST /api/integrations/v1/grants/{authorizationRef}/revoke
 *     (credential optional — revoke-by-ref for hash-only recovery)
 *   POST /api/integrations/v1/media/upload-tickets
 *   PUT  /api/integrations/v1/media/uploads/{ticket}
 *
 * Does not mount the rest of /api/integrations/v1 (turns, SSE, rebind, …).
 * Stub 8787 remains a valid full joint path. Does not change frozen
 * device-platform OpenAPI, flip grayRelease, or PROMOTE anything.
 *
 * Fail-closed:
 *   - Path not grant/media surface → return false (production unchanged).
 *   - INPROCESS/inject unbound → return false (do not claim the path).
 *   - INPROCESS enabled but bind failed → 503 UNAVAILABLE.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  claw4FirmwareEnvBindWarning,
  isClaw4FirmwareInProcessEnabled,
  resolveClaw4FirmwareService,
} from "./claw4-firmware-bind.js";
import { authInvalid, DeviceDhError } from "./errors.js";
import { handleDeviceDhGrantMint, handleDeviceDhMedia } from "./http.js";
import type { DeviceDhService } from "./service.js";
import { API_PREFIX, API_VERSION, PROTOCOL_VERSION } from "./types.js";
import { randomId } from "./util.js";

export type IntegrationsGrantHttpOptions = {
  /** In-process integrations service (tests / co-located inject). */
  service?: DeviceDhService;
};

function headerString(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function assertNoUntrustedIdentity(req: IncomingMessage): void {
  const authorization = headerString(req, "authorization");
  if (authorization && !authorization.startsWith("Basic ")) {
    throw authInvalid();
  }
  if (req.headers.cookie || req.headers["x-forwarded-user"] || req.headers["x-openbot-user"]) {
    throw authInvalid();
  }
}

function isIntegrationsSurfacePath(pathname: string): boolean {
  if (!pathname.startsWith(API_PREFIX)) {
    return false;
  }
  const relative = pathname.slice(API_PREFIX.length) || "/";
  if (relative === "/consent/authorization-codes") {
    return true;
  }
  if (relative === "/grants/exchange") {
    return true;
  }
  if (/^\/grants\/[^/]+\/revoke$/.test(relative)) {
    return true;
  }
  if (relative === "/media/upload-tickets") {
    return true;
  }
  if (/^\/media\/uploads\/[^/]+$/.test(relative)) {
    return true;
  }
  return /^\/grants\/[^/]+$/.test(relative);
}

function sendDeviceJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  traceId: string,
  headers?: Record<string, string>,
): void {
  const payload = JSON.stringify({
    apiVersion: API_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    traceId,
    timestamp: new Date().toISOString(),
    ...body,
  });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendBackendUnavailable(res: ServerResponse, traceId: string): void {
  const bindHint = claw4FirmwareEnvBindWarning();
  sendDeviceJson(
    res,
    503,
    {
      error: {
        code: "UNAVAILABLE",
        message: bindHint
          ? `In-process bind failed: ${bindHint}`
          : "Integrations grant surface needs DeviceDhService (setClaw4FirmwareService or OPENBOT_CLAW4_FIRMWARE_INPROCESS=1 with OPENBOT_DEVICE_DH_STUB_CONFIG). Adjacent stub on 8787 remains valid. grayRelease stays false.",
        retryable: true,
      },
    },
    traceId,
  );
}

/**
 * Handle grant-mint and media upload-ticket routes on the gateway.
 * Returns true when this handler owned the request.
 */
export async function handleIntegrationsGrantHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: IntegrationsGrantHttpOptions = {},
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (!isIntegrationsSurfacePath(pathname)) {
    return false;
  }

  const traceId = headerString(req, "x-trace-id") ?? `trace_${randomId(8)}`;
  const service = resolveClaw4FirmwareService(opts);
  if (!service) {
    // Opt-in only: without inject / INPROCESS, leave the path unclaimed so
    // production gateway behavior is unchanged. When INPROCESS is on but bind
    // failed, fail closed with 503 so ops sees the misconfig.
    if (isClaw4FirmwareInProcessEnabled() || claw4FirmwareEnvBindWarning()) {
      sendBackendUnavailable(res, traceId);
      return true;
    }
    return false;
  }

  const relative = pathname.slice(API_PREFIX.length) || "/";
  try {
    assertNoUntrustedIdentity(req);
    if (await handleDeviceDhMedia(service, req, res, relative, traceId)) {
      return true;
    }
    const owned = await handleDeviceDhGrantMint(service, req, res, relative, traceId);
    if (!owned) {
      // Path matched isIntegrationsSurfacePath but surface declined (e.g. POST on
      // /grants/{id} without /revoke — rebind stays on the full stub). Do not claim.
      return false;
    }
    return true;
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return true;
    }
    const deviceError =
      error instanceof DeviceDhError ? error : new DeviceDhError("INTERNAL", "Internal error");
    sendDeviceJson(
      res,
      deviceError.httpStatus,
      {
        error: {
          code: deviceError.code,
          message: deviceError.message,
          retryable: deviceError.retryable,
        },
      },
      traceId,
      deviceError.headers,
    );
    return true;
  }
}

// Re-export bind hooks so callers can inject without reaching into claw4-http.
export {
  setClaw4FirmwareService,
  setClaw4FirmwareServiceForTests,
  resolveClaw4FirmwareService,
} from "./claw4-firmware-bind.js";

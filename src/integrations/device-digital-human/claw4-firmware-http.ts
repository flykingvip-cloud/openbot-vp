/**
 * Gateway-adjacent mount for Claw4 firmware HTTP compat (Scheme B1).
 * Lives under device-digital-human; wired from gateway/server-http.ts.
 *
 * Owns:
 *   POST /api/v1/upload
 *   GET  /api/v1/conversation/{id}/messages
 *   POST /api/v1/record/upload  (reserved stub; same success shape)
 *
 * Maps onto device-digital-human conversations/turns. Does not reverse-proxy
 * arbitrary `/api/integrations/v1` onto the public gateway, and does not change
 * frozen `/api/device-platform/v1` OpenAPI field names. Grant mint for the same
 * in-process store is a sibling mount (integrations-grant-http.ts).
 *
 * Backend: inject via setClaw4FirmwareService, or opt-in env in-process bind
 * (OPENBOT_CLAW4_FIRMWARE_INPROCESS=1 + OPENBOT_DEVICE_DH_STUB_CONFIG). See
 * claw4-firmware-bind.ts and docs/.../claw4-firmware-http-compat.md.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, sendMethodNotAllowed } from "../../gateway/http-common.js";
import { claw4FirmwareEnvBindWarning, resolveClaw4FirmwareService } from "./claw4-firmware-bind.js";
import {
  CLAW4_FIRMWARE_API_PREFIX,
  CLAW4_RECORD_UPLOAD_PATH,
  CLAW4_UPLOAD_PATH,
  CLAW4_WAV_LIMIT,
  authenticateClaw4Grant,
  claw4Error,
  claw4Success,
  handleClaw4ListMessages,
  handleClaw4Upload,
  type Claw4AuthHeaders,
} from "./claw4-firmware-compat.js";
import { DeviceDhError } from "./errors.js";
import type { DeviceDhService } from "./service.js";

export type Claw4FirmwareHttpOptions = {
  /** In-process integrations service (tests / co-located stub / ops inject). */
  service?: DeviceDhService;
};

export {
  setClaw4FirmwareService,
  setClaw4FirmwareServiceForTests,
  resolveClaw4FirmwareService,
} from "./claw4-firmware-bind.js";

function headerString(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function authHeaders(req: IncomingMessage): Claw4AuthHeaders {
  return {
    authorization: headerString(req, "authorization"),
    grantCredential: headerString(req, "x-openbot-grant-credential"),
    deviceId: headerString(req, "x-device-id"),
    transcriptText: headerString(req, "x-transcript-text"),
  };
}

async function readLimited(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Request body is too large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function matchConversationMessages(pathname: string): string | undefined {
  const match = /^\/api\/v1\/conversation\/([^/]+)\/messages$/.exec(pathname);
  if (!match) {
    return undefined;
  }
  return decodeURIComponent(match[1] ?? "");
}

function sendClaw4Error(res: ServerResponse, error: unknown): void {
  const deviceError =
    error instanceof DeviceDhError ? error : new DeviceDhError("INTERNAL", "Internal error");
  sendJson(res, deviceError.httpStatus, claw4Error(deviceError));
}

function sendBackendUnavailable(res: ServerResponse): void {
  const bindHint = claw4FirmwareEnvBindWarning();
  sendJson(res, 503, {
    code: 503,
    message: "Claw4 firmware compat backend is not configured",
    error: {
      code: "UNAVAILABLE",
      message: bindHint
        ? `In-process bind failed: ${bindHint}`
        : "Inject DeviceDhService (setClaw4FirmwareService) or set OPENBOT_CLAW4_FIRMWARE_INPROCESS=1 with OPENBOT_DEVICE_DH_STUB_CONFIG. Adjacent stub on 8787 remains valid. grayRelease stays false.",
      retryable: true,
    },
  });
}

/**
 * Handle Claw4 firmware routes. Returns true when this handler owned the request.
 */
export async function handleClaw4FirmwareHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Claw4FirmwareHttpOptions = {},
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const isUpload = pathname === CLAW4_UPLOAD_PATH;
  const isRecordUpload = pathname === CLAW4_RECORD_UPLOAD_PATH;
  const conversationId = matchConversationMessages(pathname);
  if (!isUpload && !isRecordUpload && conversationId === undefined) {
    if (pathname.startsWith(`${CLAW4_FIRMWARE_API_PREFIX}/`)) {
      // Other /api/v1/* paths are not owned by this compat layer.
      return false;
    }
    return false;
  }

  const service = resolveClaw4FirmwareService(opts);
  if (!service) {
    sendBackendUnavailable(res);
    return true;
  }

  const method = req.method ?? "GET";
  try {
    if (isRecordUpload) {
      if (method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return true;
      }
      // Reserved stub: same success envelope; body semantics later (B3).
      authenticateClaw4Grant(service, authHeaders(req));
      // Drain body so clients can POST without hanging.
      await readLimited(req, CLAW4_WAV_LIMIT);
      sendJson(
        res,
        200,
        claw4Success({
          text: "",
          conversationId: url.searchParams.get("conversationId")?.trim() || "",
          reserved: true,
          todo: "POST /api/v1/record/upload body semantics reserved for a later slice",
        }),
      );
      return true;
    }

    if (isUpload) {
      if (method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return true;
      }
      const wavBytes = await readLimited(req, CLAW4_WAV_LIMIT);
      const result = await handleClaw4Upload(service, {
        headers: authHeaders(req),
        contentType: headerString(req, "content-type"),
        wavBytes,
        // Documented: optional conversationId is the query parameter.
        conversationId: url.searchParams.get("conversationId") ?? undefined,
        transcriptQuery: url.searchParams.get("transcript") ?? undefined,
      });
      sendJson(res, 200, claw4Success(result));
      return true;
    }

    if (conversationId !== undefined) {
      if (method !== "GET") {
        sendMethodNotAllowed(res, "GET");
        return true;
      }
      const listed = handleClaw4ListMessages(service, authHeaders(req), conversationId);
      sendJson(res, 200, claw4Success(listed));
      return true;
    }

    return false;
  } catch (error) {
    sendClaw4Error(res, error);
    return true;
  }
}

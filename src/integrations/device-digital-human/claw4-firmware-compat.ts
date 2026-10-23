/**
 * Claw4 firmware HTTP compat (Scheme B1).
 *
 * Maps firmware routes onto the existing device-digital-human integrations
 * conversation/turn store. Does not create a second conversation store, does
 * not touch frozen `/api/device-platform/v1` field names, and does not
 * implement metalio AsrProvider/TtsProvider.
 *
 * ASR (WAV-only first slice): labeled stub transcript, or pass-through when
 * the caller supplies `X-Transcript-Text`. No FunASR/tenclass hardcoding.
 */

import { DeviceDhError, authInvalid } from "./errors.js";
import type { DeviceDhService } from "./service.js";
import { parseBasic, randomId } from "./util.js";

export const CLAW4_FIRMWARE_API_PREFIX = "/api/v1";
export const CLAW4_UPLOAD_PATH = "/api/v1/upload";
export const CLAW4_RECORD_UPLOAD_PATH = "/api/v1/record/upload";
export const CLAW4_WAV_LIMIT = 2_000_000;
export const CLAW4_ASR_STUB_LABEL = "claw4-asr-stub";

export type Claw4FirmwareMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  turnId?: string;
  runId?: string;
  createdAt: string;
};

export type Claw4UploadResult = {
  text: string;
  conversationId: string;
};

export type Claw4AuthHeaders = {
  authorization?: string;
  grantCredential?: string;
  deviceId?: string;
  /** Optional pass-through transcript (skips stub ASR). */
  transcriptText?: string;
};

/**
 * Resolve ASR text for a WAV body.
 * - If `transcriptText` is non-empty, use it (test/pass-through path).
 * - Otherwise return a clearly labeled stub string (no vendor ASR).
 */
export function resolveClaw4Transcript(
  wavBytes: Buffer,
  transcriptText?: string,
): { text: string; asr: "pass-through" | "stub" } {
  const trimmed = transcriptText?.trim();
  if (trimmed) {
    return { text: trimmed, asr: "pass-through" };
  }
  return {
    text: `[${CLAW4_ASR_STUB_LABEL}] audio/wav bytes=${wavBytes.length}`,
    asr: "stub",
  };
}

export function assertClaw4WavContentType(contentType: string | undefined): void {
  const raw = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (raw === "audio/wav" || raw === "audio/wave" || raw === "audio/x-wav") {
    return;
  }
  throw new DeviceDhError(
    "PARAM_UNSUPPORTED",
    "Content-Type must be audio/wav (camera JPEG/PNG uploads are not accepted on this route)",
  );
}

export function authenticateClaw4Grant(
  service: DeviceDhService,
  headers: Claw4AuthHeaders,
): ReturnType<DeviceDhService["requireGrant"]> {
  const parsed = parseBasic(headers.authorization);
  if (!parsed) {
    throw authInvalid();
  }
  const client = service.authenticate(parsed.clientId, parsed.secret, "service");
  // Revoked grants fail immediately (allowRevoked=false).
  const grant = service.requireGrant(client, headers.grantCredential, false);
  const deviceId = headers.deviceId?.trim();
  if (!deviceId) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "X-Device-Id is required");
  }
  if (deviceId !== grant.deviceId) {
    throw new DeviceDhError("BINDING_MISMATCH", "X-Device-Id does not match the authorization");
  }
  return grant;
}

export async function handleClaw4Upload(
  service: DeviceDhService,
  input: {
    headers: Claw4AuthHeaders;
    contentType?: string;
    wavBytes: Buffer;
    /** Query param conversationId (documented choice for optional conversation). */
    conversationId?: string;
    /**
     * Optional pass-through transcript from query `transcript=` (UTF-8 friendly).
     * Header `X-Transcript-Text` also works for ASCII; query wins when both set.
     */
    transcriptQuery?: string;
  },
): Promise<Claw4UploadResult> {
  assertClaw4WavContentType(input.contentType);
  if (input.wavBytes.length === 0) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "WAV body is required");
  }
  if (input.wavBytes.length > CLAW4_WAV_LIMIT) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "Request body is too large");
  }
  const grant = authenticateClaw4Grant(service, input.headers);
  const { text } = resolveClaw4Transcript(
    input.wavBytes,
    input.transcriptQuery ?? input.headers.transcriptText,
  );

  let conversationId = input.conversationId?.trim();
  if (conversationId) {
    service.getConversation(grant, conversationId);
  } else {
    const created = service.createConversation(grant, { deviceId: grant.deviceId });
    conversationId = String(created.conversationId);
  }

  const turnId = `claw4_${randomId(8)}`;
  const idempotencyKey = `claw4-upload:${conversationId}:${turnId}`;
  await service.submitTurn(
    grant,
    conversationId,
    {
      turnId,
      text,
      input: { type: "text", text },
    },
    idempotencyKey,
  );

  return { text, conversationId };
}

export function handleClaw4ListMessages(
  service: DeviceDhService,
  headers: Claw4AuthHeaders,
  conversationId: string,
): { conversationId: string; messages: Claw4FirmwareMessage[] } {
  const grant = authenticateClaw4Grant(service, headers);
  return service.listConversationMessages(grant, conversationId);
}

export function claw4Success<T extends Record<string, unknown>>(
  data: T,
): {
  code: 0;
  data: T;
} {
  return { code: 0, data };
}

export function claw4Error(error: DeviceDhError): {
  code: number;
  message: string;
  error: { code: string; message: string; retryable: boolean };
} {
  return {
    code: error.httpStatus,
    message: error.message,
    error: { code: error.code, message: error.message, retryable: error.retryable },
  };
}

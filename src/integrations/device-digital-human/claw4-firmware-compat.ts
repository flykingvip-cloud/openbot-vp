/**
 * Claw4 firmware HTTP compat (Scheme B1 + P0 revision).
 *
 * Maps firmware routes onto the existing device-digital-human integrations
 * conversation/turn store. Does not create a second conversation store, does
 * not touch frozen `/api/device-platform/v1` field names, and does not
 * implement metalio AsrProvider/TtsProvider.
 *
 * ASR honesty (P0):
 * - Formal/production (default): never invent `[claw4-asr-stub]` or treat empty
 *   pass-through as real ASR. Prefer Agent A `createAudioBridge` (pin
 *   DEVICE_SDK_AUDIO_BRIDGE_SHA=56859b5…) via
 *   `createAudioBridgeFromVoiceEnv` / `bindClaw4AudioBridgeFromCreateAudioBridge`; abort on
 *   `createAbortHandle().signal`. Non-empty on-device pass-through via
 *   header / body field is allowed; query `transcript=` is deprecated.
 * - Explicit stub/test switch (`OPENBOT_CLAW4_ASR_STUB=1`): labeled stub or
 *   pass-through for joint smoke only.
 *
 * Upload idempotency (P0): client-stable `Idempotency-Key` (or content-addressed
 * fallback). Never use a random turnId as the retry key.
 */

import { ensureClaw4DeviceSdkAudioBridgeBound } from "./claw4-audio-bridge-bind.js";
import { resolveClaw4AudioBridge, type Claw4AudioBridge } from "./claw4-audio-bridge.js";
import { DeviceDhError, authInvalid } from "./errors.js";
import type { DeviceDhService } from "./service.js";
import { parseBasic, sha256Hex } from "./util.js";

export const CLAW4_FIRMWARE_API_PREFIX = "/api/v1";
export const CLAW4_UPLOAD_PATH = "/api/v1/upload";
export const CLAW4_RECORD_UPLOAD_PATH = "/api/v1/record/upload";
export const CLAW4_WAV_LIMIT = 2_000_000;
export const CLAW4_ASR_STUB_LABEL = "claw4-asr-stub";

/** Env switch: allow labeled stub ASR / empty-friendly pass-through (joint smoke). */
export const CLAW4_ASR_STUB_ENV = "OPENBOT_CLAW4_ASR_STUB";

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
  /**
   * Preferred pass-through transcript (on-device ASR). Prefer this over query
   * `transcript=` (access-log leak). Stub/test only when empty + stub switch.
   */
  transcriptText?: string;
};

export type Claw4AsrSource =
  | "bridge"
  | "pass-through-header"
  | "pass-through-body"
  | "pass-through-query-deprecated"
  | "stub";

export function isClaw4AsrStubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CLAW4_ASR_STUB_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "stub";
}

/**
 * Resolve ASR text for a WAV body (async — may call Agent A audio bridge).
 *
 * Precedence for non-empty pass-through: body field → header → deprecated query.
 * Formal mode (stub switch off): requires bridge when no non-empty pass-through;
 * never returns the labeled stub string.
 */
export async function resolveClaw4Transcript(
  wavBytes: Buffer,
  input: {
    transcriptText?: string;
    transcriptBody?: string;
    transcriptQuery?: string;
    bridge?: Claw4AudioBridge;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
): Promise<{ text: string; asr: Claw4AsrSource }> {
  const env = input.env ?? process.env;
  const stubOk = isClaw4AsrStubEnabled(env);

  const body = input.transcriptBody?.trim();
  if (body) {
    return { text: body, asr: "pass-through-body" };
  }
  const header = input.transcriptText?.trim();
  if (header) {
    return { text: header, asr: "pass-through-header" };
  }
  const query = input.transcriptQuery?.trim();
  if (query) {
    // Deprecated: speech in URL query leaks to access logs. Accepted for
    // backward compat only; callers should migrate to header/body.
    return { text: query, asr: "pass-through-query-deprecated" };
  }

  // P1 lazy startup bind (default off). No-op when switch denied or already injected.
  if (!input.bridge) {
    await ensureClaw4DeviceSdkAudioBridgeBound(env);
  }

  const bridge = resolveClaw4AudioBridge({ bridge: input.bridge });
  if (bridge) {
    // Prefer Agent A abort handle.signal (createAudioBridge contract); mirror
    // caller AbortSignal onto the handle when both are present.
    let signal = input.signal;
    if (typeof bridge.createAbortHandle === "function") {
      const handle = bridge.createAbortHandle();
      if (input.signal) {
        if (input.signal.aborted) {
          handle.abort(input.signal.reason);
        } else {
          input.signal.addEventListener(
            "abort",
            () => {
              handle.abort(input.signal?.reason);
            },
            { once: true },
          );
        }
      }
      signal = handle.signal;
    }
    const text = (await bridge.transcribeWav(wavBytes, { signal })).trim();
    if (!text) {
      throw new DeviceDhError(
        "PARAM_UNSUPPORTED",
        "Audio bridge returned an empty transcript (silent ASR is not accepted as real speech)",
      );
    }
    return { text, asr: "bridge" };
  }

  if (stubOk) {
    return {
      text: `[${CLAW4_ASR_STUB_LABEL}] audio/wav bytes=${wavBytes.length}`,
      asr: "stub",
    };
  }

  throw new DeviceDhError(
    "PARAM_UNSUPPORTED",
    `Formal Claw4 upload requires a configured audio bridge (setClaw4AudioBridge / Agent A AudioBridge) or non-empty transcript via X-Transcript-Text / body field. Stub ASR is disabled unless ${CLAW4_ASR_STUB_ENV}=1. Query transcript= is deprecated.`,
  );
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

/**
 * Authenticate Claw4 / firmware grant paths.
 *
 * Restricted to integrations **service** clients (Basic serviceClientId:secret)
 * + Grant-Credential + X-Device-Id matching the grant. Consent clients and
 * unbound credentials fail closed. Firmware MUST NOT burn/embed platform Basic
 * credentials — only the device-platform service caller holds them.
 */
export function authenticateClaw4Grant(
  service: DeviceDhService,
  headers: Claw4AuthHeaders,
): ReturnType<DeviceDhService["requireGrant"]> {
  const parsed = parseBasic(headers.authorization);
  if (!parsed) {
    throw authInvalid();
  }
  // role "service" only — consent Basic is rejected here (restricted callers).
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

/**
 * Build a client-stable upload idempotency key.
 * Prefer the caller Idempotency-Key; otherwise content-address the WAV under
 * the grant + conversation so retries do not mint a new turn.
 */
export function resolveClaw4UploadIdempotencyKey(input: {
  clientIdempotencyKey?: string;
  authorizationRef: string;
  conversationId: string;
  wavBytes: Buffer;
}): { idempotencyKey: string; turnId: string } {
  const clientKey = input.clientIdempotencyKey?.trim();
  const idempotencyKey =
    clientKey && clientKey.length > 0
      ? clientKey
      : `claw4-upload:${input.authorizationRef}:${input.conversationId}:${sha256Hex(input.wavBytes).slice(0, 32)}`;
  // turnId must be stable for the same idempotency key (material includes turnId).
  const turnId = `claw4_${sha256Hex(`turn:${idempotencyKey}`).slice(0, 16)}`;
  return { idempotencyKey, turnId };
}

/** Redact speech-bearing query keys before any access-style logging. */
export function redactClaw4UploadUrlForLog(url: string | URL): string {
  const parsed =
    typeof url === "string" ? new URL(url, "http://localhost") : new URL(url.toString());
  if (parsed.searchParams.has("transcript")) {
    parsed.searchParams.set("transcript", "[redacted]");
  }
  return `${parsed.pathname}${parsed.search}`;
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
     * @deprecated Prefer X-Transcript-Text or body field — query leaks speech to access logs.
     */
    transcriptQuery?: string;
    /** Optional pass-through from multipart/JSON body field `transcript` (when parsed by caller). */
    transcriptBody?: string;
    /** Client-stable Idempotency-Key (header). */
    idempotencyKey?: string;
    bridge?: Claw4AudioBridge;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
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
  const { text } = await resolveClaw4Transcript(input.wavBytes, {
    transcriptText: input.headers.transcriptText,
    transcriptBody: input.transcriptBody,
    transcriptQuery: input.transcriptQuery,
    bridge: input.bridge,
    env: input.env,
    signal: input.signal,
  });

  let conversationId = input.conversationId?.trim();
  if (conversationId) {
    service.getConversation(grant, conversationId);
  } else {
    const created = service.createConversation(grant, { deviceId: grant.deviceId });
    conversationId = String(created.conversationId);
  }

  const { idempotencyKey, turnId } = resolveClaw4UploadIdempotencyKey({
    clientIdempotencyKey: input.idempotencyKey,
    authorizationRef: grant.authorizationRef,
    conversationId,
    wavBytes: input.wavBytes,
  });
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

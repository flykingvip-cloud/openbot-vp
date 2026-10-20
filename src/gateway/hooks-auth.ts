import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "../infra/http-body.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import type { HookMappingResolved } from "./hooks-mapping.js";
import { extractHookToken } from "./hooks.js";

export const DEFAULT_HOOK_HMAC_HEADER = "x-openbot-signature";
const HMAC_SIGNATURE_PREFIX = "sha256=";

export type HookMappingAuth = {
  mappingId: string;
  token?: string;
  hmacSecret?: string;
  hmacHeader: string;
};

function normalizeSubPath(raw: string): string {
  return raw.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Resolve mapping-level credentials for a hook sub-path. Mapping credentials
 * are keyed by `match.path` (validated at config time), so they can be checked
 * before the request body is read. First mapping with credentials for the path
 * wins; mappings without credentials fall back to the global hooks.token.
 */
export function resolveHookMappingAuth(
  mappings: HookMappingResolved[],
  subPath: string,
): HookMappingAuth | null {
  const normalized = normalizeSubPath(subPath);
  if (!normalized) {
    return null;
  }
  for (const mapping of mappings) {
    if (!mapping.token && !mapping.hmacSecret) {
      continue;
    }
    if (mapping.matchPath !== normalized) {
      continue;
    }
    return {
      mappingId: mapping.id,
      token: mapping.token,
      hmacSecret: mapping.hmacSecret,
      hmacHeader: mapping.hmacHeader ?? DEFAULT_HOOK_HMAC_HEADER,
    };
  }
  return null;
}

export function computeHookHmacSignature(secret: string, rawBody: string): string {
  return `${HMAC_SIGNATURE_PREFIX}${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

export type HookMappingAuthResult = { ok: true } | { ok: false; error: string };

/**
 * Header-only phase: verify the per-mapping bearer token (when declared).
 * The global hooks.token is deliberately not accepted for the path (strict
 * override), so a leaked per-endpoint secret never widens beyond its mapping
 * and vice versa.
 */
export function verifyHookMappingToken(
  auth: HookMappingAuth,
  req: Pick<IncomingMessage, "headers">,
): HookMappingAuthResult {
  if (!auth.token) {
    return { ok: true };
  }
  const presented = extractHookToken(req as IncomingMessage);
  if (!safeEqualSecret(presented, auth.token)) {
    return { ok: false, error: "invalid mapping token" };
  }
  return { ok: true };
}

/**
 * Body phase: verify a GitHub-webhook style `sha256=<hex>` HMAC signature of
 * the raw request body (when the mapping declares hmacSecret).
 */
export function verifyHookMappingHmac(
  auth: HookMappingAuth,
  req: Pick<IncomingMessage, "headers">,
  rawBody: string,
): HookMappingAuthResult {
  if (!auth.hmacSecret) {
    return { ok: true };
  }
  const headerValue = req.headers[auth.hmacHeader];
  const signature = typeof headerValue === "string" ? headerValue.trim() : "";
  if (!signature.toLowerCase().startsWith(HMAC_SIGNATURE_PREFIX)) {
    return { ok: false, error: `missing ${HMAC_SIGNATURE_PREFIX}<hex> signature` };
  }
  const expected = computeHookHmacSignature(auth.hmacSecret, rawBody);
  if (!safeEqualSecret(signature.toLowerCase(), expected)) {
    return { ok: false, error: "invalid signature" };
  }
  return { ok: true };
}

/**
 * Bounded raw-body read for the HMAC path. Mirrors readJsonBody's error
 * strings so the HTTP status mapping in server-http stays identical.
 */
export async function readRawHookBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; raw: string } | { ok: false; error: string }> {
  try {
    const raw = await readRequestBodyWithLimit(req, { maxBytes });
    return { ok: true, raw };
  } catch (error) {
    if (isRequestBodyLimitError(error)) {
      if (error.code === "PAYLOAD_TOO_LARGE") {
        return { ok: false, error: "payload too large" };
      }
      if (error.code === "REQUEST_BODY_TIMEOUT") {
        return { ok: false, error: "request body timeout" };
      }
      return { ok: false, error: requestBodyErrorToText("CONNECTION_CLOSED") };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Parse a raw hook body with the same semantics as readJsonBody (empty → {}). */
export function parseHookJsonPayload(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

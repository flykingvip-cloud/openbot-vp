/**
 * Official diagnosis live-write path used by production bootstrap:
 *   chat.send (deliver:false) → chat.inject fallback → sessions.reset only
 *   when inject reports session-not-found, and only for the canary session.
 *
 * Does not enable auto-remediation, external channel delivery, or irreversible
 * deletion. Callers must point `call` at an explicit loopback gateway in tests.
 */
import { callGateway } from "../gateway/call.js";
import type { CallGatewayOptions } from "../gateway/call.js";
import {
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
} from "./production-cutover.js";
import { DiagnosisContractError } from "./types.js";

export type OfficialDiagnosisGatewayCall = (opts: CallGatewayOptions) => Promise<unknown>;

export type OfficialLiveSendInput = {
  sessionKey: string;
  tenantId: string;
  text: string;
  deliveryId?: string;
  route?: string;
};

export type OfficialLiveSendResult = "accepted" | "unavailable" | "unauthorized";

export type OfficialLiveSendTrace = {
  methods: string[];
  resetKeys: string[];
  skippedInjectBecauseAuth: boolean;
};

export function assertDiagnosisCanarySessionKey(sessionKey: string): string {
  const trimmed = sessionKey.trim();
  if (trimmed !== DIAGNOSIS_P24_5_LIVE_SESSION_KEY) {
    throw new DiagnosisContractError(
      "canary_session_mismatch",
      "conversation live chat is limited to the diagnosis canary session key",
      "sessionKey",
    );
  }
  return trimmed;
}

export function isGatewayAuthOrAuthorizationError(error: unknown): boolean {
  const parts: string[] = [];
  if (typeof error === "string") {
    parts.push(error);
  }
  if (error instanceof Error) {
    parts.push(error.name, error.message);
  }
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; error?: unknown };
    if (typeof record.code === "string") {
      parts.push(record.code);
    }
    if (record.error && typeof record.error === "object") {
      const nested = record.error as { code?: unknown; message?: unknown };
      if (typeof nested.code === "string") {
        parts.push(nested.code);
      }
      if (typeof nested.message === "string") {
        parts.push(nested.message);
      }
    }
  }
  const haystack = parts.join("\n");
  return (
    /\bAUTH_UNAUTHORIZED\b/i.test(haystack) ||
    /\bUNAUTHORIZED\b/i.test(haystack) ||
    /\bFORBIDDEN\b/i.test(haystack) ||
    /\b403\b/.test(haystack) ||
    /not authorized/i.test(haystack) ||
    /authorization (?:failed|required|denied|revoked)/i.test(haystack) ||
    /authentication (?:failed|required|denied)/i.test(haystack) ||
    /invalid (?:token|password|credentials|device token)/i.test(haystack) ||
    /missing (?:token|password|credentials)/i.test(haystack) ||
    /token rejected/i.test(haystack) ||
    /gateway url override requires explicit credentials/i.test(haystack) ||
    /insufficient (?:scope|scopes|permission)/i.test(haystack) ||
    /scope denied/i.test(haystack)
  );
}

export function isGatewayTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /gateway timeout after \d+ms/i.test(message) || /\bETIMEDOUT\b/i.test(message);
}

export function isSessionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session not found/i.test(message);
}

export function throwIfGatewayCallRejected(result: unknown): void {
  if (!result || typeof result !== "object") {
    return;
  }
  const record = result as { ok?: unknown; error?: unknown };
  if (record.ok !== false) {
    return;
  }
  if (record.error instanceof Error) {
    throw record.error;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    throw new Error(record.error);
  }
  if (
    record.error &&
    typeof record.error === "object" &&
    "message" in record.error &&
    typeof (record.error as { message?: unknown }).message === "string"
  ) {
    throw new Error((record.error as { message: string }).message);
  }
  throw new Error("gateway call returned ok=false");
}

export async function deliverDiagnosisViaOfficialLiveGateway(
  input: OfficialLiveSendInput,
  options: {
    call?: OfficialDiagnosisGatewayCall;
    timeoutMs?: { send?: number; inject?: number; reset?: number };
    trace?: OfficialLiveSendTrace;
  } = {},
): Promise<OfficialLiveSendResult> {
  if (input.tenantId !== DIAGNOSIS_P24_5_CANARY_TENANT) {
    throw new DiagnosisContractError(
      "canary_tenant_mismatch",
      "conversation live chat is limited to the internal single tenant canary",
      "tenantId",
    );
  }
  const sessionKey = assertDiagnosisCanarySessionKey(
    input.sessionKey?.trim() || DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
  );
  const call = options.call ?? callGateway;
  const trace = options.trace;
  const sendTimeout = options.timeoutMs?.send ?? 15_000;
  const injectTimeout = options.timeoutMs?.inject ?? 10_000;
  const resetTimeout = options.timeoutMs?.reset ?? 10_000;

  const record = (method: string) => {
    trace?.methods.push(method);
  };

  const injectOnce = async () => {
    record("chat.inject");
    throwIfGatewayCallRejected(
      await call({
        method: "chat.inject",
        params: {
          sessionKey,
          message: input.text,
          label: "诊断提醒",
        },
        timeoutMs: injectTimeout,
      }),
    );
  };

  const ensureCanarySession = async () => {
    record("sessions.reset");
    trace?.resetKeys.push(sessionKey);
    throwIfGatewayCallRejected(
      await call({
        method: "sessions.reset",
        params: { key: sessionKey, reason: "new" },
        timeoutMs: resetTimeout,
      }),
    );
  };

  try {
    // Prefer chat.send (P24.5 contract). deliver:false keeps canary off external channels.
    record("chat.send");
    throwIfGatewayCallRejected(
      await call({
        method: "chat.send",
        params: {
          sessionKey,
          message: input.text,
          idempotencyKey: input.deliveryId,
          deliver: false,
        },
        timeoutMs: sendTimeout,
      }),
    );
    return "accepted";
  } catch (sendErr) {
    if (isGatewayAuthOrAuthorizationError(sendErr)) {
      if (trace) {
        trace.skippedInjectBecauseAuth = true;
      }
      return "unauthorized";
    }
    try {
      await injectOnce();
      return "accepted";
    } catch (injectErr) {
      if (isGatewayAuthOrAuthorizationError(injectErr)) {
        if (trace) {
          trace.skippedInjectBecauseAuth = true;
        }
        return "unauthorized";
      }
      if (!isSessionNotFoundError(injectErr)) {
        return "unavailable";
      }
      try {
        await ensureCanarySession();
        await injectOnce();
        return "accepted";
      } catch {
        return "unavailable";
      }
    }
  }
}

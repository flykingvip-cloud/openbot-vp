/**
 * Recipient for one landed correction.
 * The authenticated platform user must already be the subject stored on that
 * version. There is no directory lookup and no fallback session.
 * mappingVerified is not an input: a boolean cannot authorize a recipient.
 */
import {
  buildEmployeeBuiltinStewardSessionKey,
  extractEmployeeStewardUserIdFromSessionKey,
  isGlobalBuiltinStewardSessionKey,
  sanitizeEmployeeStewardIdentity,
} from "../agents/builtin-steward/employee-isolation.js";
import { callerOwnsTaskOutcome } from "./reject-result.js";
import { normalizeTaskOutcomeSubjectRef } from "./subject-ref.js";
import type { TrustedScope } from "./types.js";

export const CORRECTION_NOTICE_FORBIDDEN_RECIPIENTS = [
  "agent:main:main",
  "diagnosis:canary:daibai",
] as const;

const FORBIDDEN = new Set<string>(CORRECTION_NOTICE_FORBIDDEN_RECIPIENTS);

export type CorrectionNoticeRecipient =
  | { ok: true; subjectRef: string; platformUserId: string; sessionKey: string }
  | { ok: false; code: "recipient_unresolved" };

export function isForbiddenCorrectionRecipient(value: string): boolean {
  return FORBIDDEN.has(value.trim());
}

/**
 * Session key for the subject's own steward conversation.
 * A forbidden id, a global main session, or a key that does not round-trip
 * to the sanitized subject is refused. Nothing is rewritten into agent:main:main.
 */
export function resolveCorrectionNoticeSessionKey(platformUserId: string): string | null {
  const id = platformUserId.trim();
  if (!id || isForbiddenCorrectionRecipient(id)) {
    return null;
  }
  const owner = sanitizeEmployeeStewardIdentity(id);
  if (!owner || owner === "main") {
    return null;
  }
  const sessionKey = buildEmployeeBuiltinStewardSessionKey(id);
  if (
    !sessionKey ||
    isForbiddenCorrectionRecipient(sessionKey) ||
    isGlobalBuiltinStewardSessionKey(sessionKey) ||
    !sessionKey.startsWith("agent:main:employee:")
  ) {
    return null;
  }
  const extracted = extractEmployeeStewardUserIdFromSessionKey(sessionKey);
  if (!extracted || extracted !== owner) {
    return null;
  }
  return sessionKey;
}

export function resolveCorrectionNoticeRecipient(input: {
  scope: TrustedScope;
  authenticatedPlatformUserId: string;
  callerTenantId?: string | null;
}): CorrectionNoticeRecipient {
  const stored = input.scope.subjectRef.trim();
  const authenticated = input.authenticatedPlatformUserId.trim();
  if (!stored || !authenticated) {
    return { ok: false, code: "recipient_unresolved" };
  }
  if (isForbiddenCorrectionRecipient(stored) || isForbiddenCorrectionRecipient(authenticated)) {
    return { ok: false, code: "recipient_unresolved" };
  }
  const normalized = normalizeTaskOutcomeSubjectRef(authenticated);
  if (authenticated !== stored && normalized !== stored) {
    return { ok: false, code: "recipient_unresolved" };
  }
  if (
    !callerOwnsTaskOutcome({
      scope: input.scope,
      callerSubjectRef: normalized,
      callerTenantId: input.callerTenantId,
    })
  ) {
    return { ok: false, code: "recipient_unresolved" };
  }
  const sessionKey = resolveCorrectionNoticeSessionKey(stored);
  if (!sessionKey) {
    return { ok: false, code: "recipient_unresolved" };
  }
  return {
    ok: true,
    subjectRef: stored,
    platformUserId: stored,
    sessionKey,
  };
}

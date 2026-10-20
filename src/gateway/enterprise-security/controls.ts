/**
 * Enterprise security controls that have a real effect on platform-auth login.
 * MFA enroll writes the existing TOTP store. Session list/revoke reads and
 * deletes login session rows. Chat `sessions.list` is not used.
 */
import type { MfaEnrollmentResult, MfaSecretRecord } from "../platform-auth/mfa-store.js";
import type { PlatformAuthSessionRecord } from "../platform-auth/store-types.js";
import {
  fingerprintBody,
  idempotencyStorageKey,
  withIdempotency,
  type IdempotencyStore,
} from "./idempotency.js";

export const ENTERPRISE_SECURITY_MFA_ENROLL_METHOD = "enterprise.security.mfa.enroll" as const;
export const ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD =
  "enterprise.security.sessions.list" as const;
export const ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD =
  "enterprise.security.sessions.revoke" as const;

/** Pending enrollment that is not confirmed in this window cannot be activated. */
export const MFA_ENROLLMENT_TTL_MS = 10 * 60 * 1000;

export const SESSION_LIST_DEFAULT_LIMIT = 50;
export const SESSION_LIST_MAX_LIMIT = 200;

export type MfaEnrollReason =
  | "already_enabled"
  | "code_invalid"
  | "enrollment_expired"
  | "idempotency_conflict";

export type MfaEnrollResult = {
  ok: boolean;
  enabled: boolean;
  reason?: MfaEnrollReason;
  otpAuthUrl?: string;
  recoveryCodes?: string[];
};

export type LoginSessionView = {
  sessionId: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type SessionRevokeReason =
  | "current_session_protected"
  | "session_not_found"
  | "idempotency_conflict";

export type SessionRevokeResult = {
  ok: boolean;
  revoked: string[];
  reason?: SessionRevokeReason;
};

type SessionRevokeStored = SessionRevokeResult & {
  persist: boolean;
};

type MfaPorts = {
  enroll: (userId: string, email: string) => Promise<MfaEnrollmentResult>;
  activate: (userId: string, code: string, now?: number) => Promise<boolean>;
  secret: (userId: string) => Promise<MfaSecretRecord | null>;
  revoke: (userId: string) => Promise<void>;
};

function enabledEnrollment(record: MfaSecretRecord | null): boolean {
  return Boolean(record && !record.pending && !record.revokedAt);
}

function pendingExpired(record: MfaSecretRecord, now: number): boolean {
  if (!record.pending || record.revokedAt) {
    return false;
  }
  const createdAt = Date.parse(record.createdAt);
  return !Number.isFinite(createdAt) || now - createdAt > MFA_ENROLLMENT_TTL_MS;
}

export async function enrollEnterpriseMfa(params: {
  tenantId: string;
  userId: string;
  email: string;
  action: "start" | "confirm";
  code?: string;
  idempotencyKey: string;
  now: number;
  idempotency: IdempotencyStore;
  mfa: MfaPorts;
}): Promise<MfaEnrollResult> {
  const fingerprint = fingerprintBody({
    action: params.action,
    code: params.action === "confirm" ? (params.code ?? "") : null,
  });
  const outcome = await withIdempotency({
    store: params.idempotency,
    key: idempotencyStorageKey({
      tenantId: params.tenantId,
      method: ENTERPRISE_SECURITY_MFA_ENROLL_METHOD,
      idempotencyKey: params.idempotencyKey,
    }),
    fingerprint,
    conflict: { ok: false, enabled: false, reason: "idempotency_conflict" },
    produce: async () => {
      const current = await params.mfa.secret(params.userId);
      if (params.action === "start") {
        if (enabledEnrollment(current)) {
          return { ok: false, enabled: true, reason: "already_enabled" };
        }
        const started = await params.mfa.enroll(params.userId, params.email);
        return {
          ok: true,
          enabled: false,
          otpAuthUrl: started.otpAuthUrl,
          recoveryCodes: started.recoveryCodes,
        };
      }
      if (enabledEnrollment(current)) {
        return { ok: false, enabled: true, reason: "already_enabled" };
      }
      if (!current || current.revokedAt || !current.pending) {
        return { ok: false, enabled: false, reason: "code_invalid" };
      }
      if (pendingExpired(current, params.now)) {
        await params.mfa.revoke(params.userId);
        return { ok: false, enabled: false, reason: "enrollment_expired" };
      }
      const activated = await params.mfa.activate(params.userId, params.code ?? "", params.now);
      if (!activated) {
        return { ok: false, enabled: false, reason: "code_invalid" };
      }
      return { ok: true, enabled: true };
    },
  });
  return outcome.value;
}

export function isEnterpriseLoginSession(
  session: PlatformAuthSessionRecord,
  tenantId: string,
): boolean {
  if (session.enterpriseId !== tenantId) {
    return false;
  }
  if (session.domain === "platform") {
    return false;
  }
  if (session.sessionKind === "platform-admin" || session.sessionKind === "platform-super-admin") {
    return false;
  }
  return true;
}

/**
 * `lastSeenAt` prefers `lastActivityAt` (bumped on cookie and gateway RPC
 * reads, at most once a minute). Sessions issued before that clock existed
 * fall back to `updatedAt`.
 */
export function listEnterpriseLoginSessions(params: {
  sessions: Record<string, PlatformAuthSessionRecord>;
  tenantId: string;
  callerSessionId: string | null;
  limit: number;
}): LoginSessionView[] {
  return Object.values(params.sessions)
    .filter((session) => isEnterpriseLoginSession(session, params.tenantId))
    .toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
    )
    .slice(0, params.limit)
    .map((session) => ({
      sessionId: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      lastSeenAt: session.lastActivityAt ?? session.updatedAt,
      current: params.callerSessionId !== null && session.id === params.callerSessionId,
    }));
}

export async function revokeEnterpriseLoginSessions(params: {
  sessions: Record<string, PlatformAuthSessionRecord>;
  tenantId: string;
  callerSessionId: string | null;
  idempotencyKey: string;
  sessionIds?: string[];
  allExceptCurrent?: boolean;
  includeCurrent?: boolean;
  idempotency: IdempotencyStore;
}): Promise<{ body: SessionRevokeResult; persist: boolean }> {
  const fingerprint = fingerprintBody({
    sessionIds: params.sessionIds ?? null,
    allExceptCurrent: params.allExceptCurrent === true,
    includeCurrent: params.includeCurrent === true,
  });
  const outcome = await withIdempotency<SessionRevokeStored>({
    store: params.idempotency,
    key: idempotencyStorageKey({
      tenantId: params.tenantId,
      method: ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD,
      idempotencyKey: params.idempotencyKey,
    }),
    fingerprint,
    conflict: {
      ok: false,
      revoked: [],
      reason: "idempotency_conflict",
      persist: false,
    },
    produce: async () => {
      const tenantSessions = Object.values(params.sessions).filter((session) =>
        isEnterpriseLoginSession(session, params.tenantId),
      );
      const known = new Set(tenantSessions.map((session) => session.id));
      const includeCurrent = params.includeCurrent === true;
      if (!params.callerSessionId) {
        return {
          ok: false,
          revoked: [],
          reason: "current_session_protected" as const,
          persist: false,
        };
      }
      let targets: string[];
      if (params.allExceptCurrent) {
        targets = tenantSessions
          .map((session) => session.id)
          .filter((id) => includeCurrent || id !== params.callerSessionId);
      } else {
        targets = params.sessionIds ?? [];
        if (targets.includes(params.callerSessionId) && !includeCurrent) {
          return {
            ok: false,
            revoked: [],
            reason: "current_session_protected" as const,
            persist: false,
          };
        }
        if (targets.some((id) => !known.has(id))) {
          return {
            ok: false,
            revoked: [],
            reason: "session_not_found" as const,
            persist: false,
          };
        }
      }
      for (const id of targets) {
        delete params.sessions[id];
      }
      return { ok: true, revoked: targets, persist: targets.length > 0 };
    },
  });
  const { persist: _persist, ...body } = outcome.value;
  return { body, persist: outcome.replayed ? false : outcome.value.persist };
}

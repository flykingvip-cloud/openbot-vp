/**
 * Token / activation-code operations for platform auth.
 *
 * Owns issuance, lookup, verification, expiry normalization, and revocation of
 * opaque activation/reset codes, plus session invalidation. Extracted from the
 * platform-auth monolith (decomposition Task 5.9).
 *
 * Behavior is preserved verbatim from the monolith: same hashing (sha256 →
 * base64url), same code formats, same max-attempt limits, same expiry rules.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { safeEqualSecret } from "../../security/secret-equal.js";
import type { ControlUiPlatformPendingCode } from "../control-ui-contract.js";
import type {
  PlatformAuthActivationCode,
  PlatformAuthActivationStatus,
  PlatformAuthActivationType,
  PlatformAuthStore,
} from "./store-types.js";

// Local copy (matches the duplication pattern used by store.ts / memberships.ts
// to keep these leaf modules free of cross-module import cycles).
function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** sha256 → base64url hash of an opaque code (never store the plain code). */
export function hashOpaqueCode(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

/** Human-facing short code, prefixed by activation type. */
export function nextDisplayCode(type: PlatformAuthActivationType): string {
  const prefix =
    type === "enterpriseAdminActivation"
      ? "ADMIN"
      : type === "enterpriseCoAdminInvite"
        ? "COADMIN"
        : type === "employeeActivation"
          ? "EMP"
          : "RESET";
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function buildPendingCode(params: {
  assignmentId?: string;
  code: string;
  email: string;
  enterpriseName?: string;
  enterpriseId?: string;
  activationUrl?: string;
  expiresAt: string;
  kind: ControlUiPlatformPendingCode["kind"];
}): ControlUiPlatformPendingCode {
  return {
    kind: params.kind,
    ...(params.assignmentId ? { assignmentId: params.assignmentId } : {}),
    email: params.email,
    code: params.code,
    expiresAt: params.expiresAt,
    ...(params.enterpriseName ? { enterpriseName: params.enterpriseName } : {}),
    ...(params.enterpriseId ? { enterpriseId: params.enterpriseId } : {}),
    ...(params.activationUrl ? { activationUrl: params.activationUrl } : {}),
  };
}

export function findLatestActiveCode(params: {
  store: PlatformAuthStore;
  provisionId?: string;
  userId?: string;
  email: string;
  codeType: PlatformAuthActivationType;
}): PlatformAuthActivationCode | undefined {
  return Object.values(params.store.activationCodes)
    .filter(
      (activation) =>
        activation.codeType === params.codeType &&
        activation.normalizedEmail === normalizeEmail(params.email) &&
        activation.status === "active" &&
        (!params.provisionId || activation.provisionId === params.provisionId) &&
        (!params.userId || activation.userId === params.userId),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function issueActivationCode(params: {
  store: PlatformAuthStore;
  email: string;
  enterpriseId?: string;
  provisionId?: string;
  userId?: string;
  issuedByUserId?: string;
  codeType: PlatformAuthActivationType;
  expiresAt: string;
  replaces?: PlatformAuthActivationCode | null;
}): { activation: PlatformAuthActivationCode; plainCode: string } {
  const plainCode = randomBytes(18).toString("base64url");
  const nowIso = new Date().toISOString();
  const activation: PlatformAuthActivationCode = {
    id: randomUUID(),
    ...(params.enterpriseId ? { enterpriseId: params.enterpriseId } : {}),
    ...(params.provisionId ? { provisionId: params.provisionId } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    email: params.email,
    normalizedEmail: normalizeEmail(params.email),
    codeHash: hashOpaqueCode(plainCode),
    displayCode: nextDisplayCode(params.codeType),
    codeType: params.codeType,
    status: "active",
    attemptCount: 0,
    maxAttempts: params.codeType === "passwordReset" ? 5 : 8,
    ...(params.issuedByUserId ? { issuedByUserId: params.issuedByUserId } : {}),
    deliveryChannel: "manual",
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: params.expiresAt,
  };
  if (params.replaces) {
    params.replaces.status = "revoked";
    params.replaces.revokedAt = nowIso;
    params.replaces.updatedAt = nowIso;
    params.replaces.replacedByCodeId = activation.id;
    activation.replacesCodeId = params.replaces.id;
  }
  params.store.activationCodes[activation.id] = activation;
  return { activation, plainCode };
}

export function verifyOpaqueCode(code: string, encoded: string): boolean {
  return safeEqualSecret(hashOpaqueCode(code), encoded);
}

export function normalizeActivationStatus(
  activation: PlatformAuthActivationCode,
  now = Date.now(),
): PlatformAuthActivationStatus {
  if (activation.status === "claimed" || activation.status === "revoked") {
    return activation.status;
  }
  const expiresAtMs = Number(new Date(activation.expiresAt));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    return "expired";
  }
  return activation.status;
}

export function pruneExpiredActivationCodes(store: PlatformAuthStore, now = Date.now()): boolean {
  let changed = false;
  for (const activation of Object.values(store.activationCodes)) {
    const nextStatus = normalizeActivationStatus(activation, now);
    if (nextStatus !== activation.status) {
      activation.status = nextStatus;
      activation.updatedAt = new Date(now).toISOString();
      changed = true;
    }
  }
  return changed;
}

export function invalidateUserSessions(store: PlatformAuthStore, userId: string): void {
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    if (session.userId === userId) {
      delete store.sessions[sessionId];
    }
  }
}

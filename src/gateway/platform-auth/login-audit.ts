/**
 * Structured login audit for platform-grade auth.
 *
 * Appends one JSON line per login attempt to CONFIG_DIR/audit/platform-auth-login.jsonl
 * (mode 0o600). Never records password / mfaCode / recovery codes / session tokens.
 * Writes are best-effort: failures log a warning and never block the login response.
 *
 * Spec: platform-admin-login-isolation Task 3.1 (Requirements 6.1, 6.2, 6.5, 6.7).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { SessionDomain } from "./session-domain.js";

export type PlatformLoginOutcome =
  | "success"
  | "invalid_credentials"
  | "mfa_required"
  | "mfa_invalid"
  | "mfa_required_enroll_first"
  | "role_mismatch"
  | "account_suspended"
  | "account_locked"
  | "ip_not_allowed"
  | "redirected"
  | "unexpected_error"
  | "mfa_orphan_detected";

export type PlatformLoginAuditEvent = {
  ts: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
  email: string;
  outcome: PlatformLoginOutcome;
  sessionKind?:
    | "platform-super-admin"
    | "platform-admin"
    | "enterprise-admin"
    | "member"
    | "employee";
  domain?: SessionDomain;
  mfaUsed?: boolean;
  expectedRole?: "super-admin" | "admin" | null;
};

function resolveAuditLogPath(): string {
  return path.join(CONFIG_DIR, "audit", "platform-auth-login.jsonl");
}

/** Generates a request-correlation id (UUID v4) when upstream did not provide one. */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Appends a single audit event. Best-effort: never throws into the caller.
 * Creates the audit directory and file with restrictive permissions on first write.
 */
export async function emitPlatformLoginAuditEvent(event: PlatformLoginAuditEvent): Promise<void> {
  try {
    const filePath = resolveAuditLogPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const line = `${JSON.stringify(event)}\n`;
    await fs.appendFile(filePath, line, { mode: 0o600 });
  } catch (error) {
    // Best-effort: audit failures must not block login.
    console.warn(`[platform-auth] failed to write login audit event: ${String(error)}`);
  }
}

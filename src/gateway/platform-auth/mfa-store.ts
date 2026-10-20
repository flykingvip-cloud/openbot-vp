/**
 * MFA secret store for platform-grade accounts.
 *
 * TOTP secrets + recovery codes live in a file physically separate from the
 * user store, keyed by userId. Secret material is reachable ONLY through this
 * module's API; callers outside get enrollment state via `getMfaEnrollmentState`.
 *
 * Storage: CONFIG_DIR/openbot-platform-auth-mfa.json, mode 0o600.
 * Spec: platform-admin-login-isolation Task 2.2 (Requirements 4.1, 4.2, 4.4).
 */

import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR } from "../../utils.js";
import { emitPlatformLoginAuditEvent } from "./login-audit.js";
import {
  buildOtpAuthUrl,
  generateRecoveryCodes,
  generateTotpSecret,
  recoveryCodeKey,
  verifyTotp,
} from "./mfa-totp.js";

export type MfaSecretRecord = {
  userId: string;
  secret: string;
  algorithm: "SHA1";
  digits: 6;
  periodSeconds: 30;
  pending: boolean;
  recoveryCodes: string[];
  createdAt: string;
  verifiedAt?: string;
  revokedAt?: string;
};

/** Enrollment state exposed to callers — never includes secret/recovery codes. */
export type MfaEnrollmentState = {
  enabled: boolean;
  enrolledAt?: string;
  pending?: boolean;
  secretRevokedAt?: string;
};

export type MfaEnrollmentResult = {
  secret: string;
  otpAuthUrl: string;
  recoveryCodes: string[];
};

type MfaStoreShape = {
  version: number;
  secrets: Record<string, MfaSecretRecord>;
};

const MFA_STORE_VERSION = 1;

function resolveMfaStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-platform-auth-mfa.json");
}

function emptyStore(): MfaStoreShape {
  return { version: MFA_STORE_VERSION, secrets: {} };
}

async function loadMfaStore(): Promise<MfaStoreShape> {
  const loaded = await readJsonFile<unknown>(resolveMfaStorePath());
  if (!loaded || typeof loaded !== "object") {
    return emptyStore();
  }
  const record = loaded as Record<string, unknown>;
  const secrets =
    record.secrets && typeof record.secrets === "object"
      ? (record.secrets as Record<string, MfaSecretRecord>)
      : {};
  return { version: MFA_STORE_VERSION, secrets };
}

async function saveMfaStore(store: MfaStoreShape): Promise<void> {
  await writeJsonAtomic(resolveMfaStorePath(), store, { mode: 0o600, ensureDirMode: 0o700 });
}

// ── Write-lock (per-file serialization, mirrors store.ts idiom) ──────────────

let mfaWriteLock: Promise<void> = Promise.resolve();

async function withMfaWriteLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = mfaWriteLock;
  let release = () => {};
  mfaWriteLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** INTERNAL-ish: returns the full secret record. Do not expose outside the MFA layer. */
export async function getMfaSecret(userId: string): Promise<MfaSecretRecord | null> {
  const store = await loadMfaStore();
  return store.secrets[userId] ?? null;
}

/** Enrollment state for the user view join — never includes secret material. */
export async function getMfaEnrollmentState(userId: string): Promise<MfaEnrollmentState> {
  const record = await getMfaSecret(userId);
  if (!record || record.revokedAt) {
    return {
      enabled: false,
      ...(record?.revokedAt ? { secretRevokedAt: record.revokedAt } : {}),
    };
  }
  return {
    enabled: !record.pending,
    enrolledAt: record.verifiedAt ?? record.createdAt,
    pending: record.pending,
  };
}

/** Starts (or restarts) enrollment: writes a pending secret and returns provisioning material. */
export async function enrollMfa(userId: string, email: string): Promise<MfaEnrollmentResult> {
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  await withMfaWriteLock(async () => {
    const store = await loadMfaStore();
    store.secrets[userId] = {
      userId,
      secret,
      algorithm: "SHA1",
      digits: 6,
      periodSeconds: 30,
      pending: true,
      recoveryCodes,
      createdAt: new Date().toISOString(),
    };
    await saveMfaStore(store);
  });
  return { secret, otpAuthUrl: buildOtpAuthUrl(secret, email), recoveryCodes };
}

/** Verifies the first OTP and marks the pending record active. */
export async function activateMfaEnrollment(
  userId: string,
  code: string,
  now: number = Date.now(),
): Promise<boolean> {
  return withMfaWriteLock(async () => {
    const store = await loadMfaStore();
    const record = store.secrets[userId];
    if (!record || record.revokedAt) {
      return false;
    }
    if (!verifyTotp(record.secret, code, now)) {
      return false;
    }
    record.pending = false;
    record.verifiedAt = new Date(now).toISOString();
    await saveMfaStore(store);
    return true;
  });
}

/** Verifies a TOTP code for an active (non-pending) enrollment. */
export async function verifyMfaCode(
  userId: string,
  code: string,
  now: number = Date.now(),
): Promise<boolean> {
  const record = await getMfaSecret(userId);
  if (!record || record.pending || record.revokedAt) {
    return false;
  }
  return verifyTotp(record.secret, code, now);
}

/** Consumes a single-use recovery code (removed on success). */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  return withMfaWriteLock(async () => {
    const store = await loadMfaStore();
    const record = store.secrets[userId];
    if (!record || record.revokedAt) {
      return false;
    }
    const wanted = recoveryCodeKey(code);
    if (wanted.length !== 8) {
      return false;
    }
    const idx = record.recoveryCodes.findIndex((stored) => recoveryCodeKey(stored) === wanted);
    if (idx === -1) {
      return false;
    }
    record.recoveryCodes.splice(idx, 1);
    await saveMfaStore(store);
    return true;
  });
}

/** Revokes a user's MFA enrollment (forces re-enrollment on next login). */
export async function revokeMfa(userId: string): Promise<void> {
  await withMfaWriteLock(async () => {
    const store = await loadMfaStore();
    const record = store.secrets[userId];
    if (!record) {
      return;
    }
    record.revokedAt = new Date().toISOString();
    record.pending = false;
    await saveMfaStore(store);
  });
}

/** Deletes a user's MFA record entirely (used on user deletion). */
export async function deleteMfa(userId: string): Promise<void> {
  await withMfaWriteLock(async () => {
    const store = await loadMfaStore();
    if (store.secrets[userId]) {
      delete store.secrets[userId];
      await saveMfaStore(store);
    }
  });
}

export type MfaOrphanScanResult = {
  removed: string[];
};

/**
 * Removes MFA records whose userId no longer exists in the user store.
 * Returns the removed userIds so the caller can emit one audit event each.
 */
export async function scanMfaOrphans(validUserIds: Set<string>): Promise<MfaOrphanScanResult> {
  return withMfaWriteLock(async () => {
    const store = await loadMfaStore();
    const removed: string[] = [];
    for (const userId of Object.keys(store.secrets)) {
      if (!validUserIds.has(userId)) {
        delete store.secrets[userId];
        removed.push(userId);
      }
    }
    if (removed.length > 0) {
      await saveMfaStore(store);
    }
    return { removed };
  });
}

/**
 * Startup helper: scans for orphaned MFA records against the live platform-auth
 * store and emits one `mfa_orphan_detected` audit event per removed orphan.
 * Best-effort: never throws into the boot sequence. Returns removed userIds.
 *
 * Call this from the gateway boot sequence after the platform-auth store loads.
 */
export async function scanMfaOrphansAtStartup(validUserIds: Iterable<string>): Promise<string[]> {
  try {
    const { removed } = await scanMfaOrphans(new Set(validUserIds));
    if (removed.length > 0) {
      for (const userId of removed) {
        await emitPlatformLoginAuditEvent({
          ts: new Date().toISOString(),
          requestId: `mfa-orphan-${userId}`,
          email: "",
          outcome: "mfa_orphan_detected",
        });
      }
    }
    return removed;
  } catch (error) {
    console.warn(`[platform-auth] MFA orphan scan failed: ${String(error)}`);
    return [];
  }
}

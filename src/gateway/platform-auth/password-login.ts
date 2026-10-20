import { randomUUID, scryptSync } from "node:crypto";
import { safeEqualSecret } from "../../security/secret-equal.js";
import type { PlatformAuthUser } from "./store-types.js";

export function hashPassword(password: string): string {
  const salt = randomUUID().slice(0, 16);
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, salt, hash] = encoded.split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }
  const actual = scryptSync(password, salt, 64).toString("base64url");
  return safeEqualSecret(actual, hash);
}

export function assertStrongPassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

export function recordFailedLogin(user: PlatformAuthUser, now = Date.now()) {
  user.loginFailedCount += 1;
  user.updatedAt = new Date(now).toISOString();
  if (user.loginFailedCount >= 5) {
    user.lockedUntil = new Date(now + 15 * 60 * 1000).toISOString();
  }
}

export function clearFailedLoginState(user: PlatformAuthUser, nowIso = new Date().toISOString()) {
  user.loginFailedCount = 0;
  delete user.lockedUntil;
  user.lastLoginAt = nowIso;
  user.updatedAt = nowIso;
}

export function isUserLocked(user: PlatformAuthUser, now = Date.now()): boolean {
  if (!user.lockedUntil) {
    return false;
  }
  const lockedUntilMs = Number(new Date(user.lockedUntil));
  return Number.isFinite(lockedUntilMs) && lockedUntilMs > now;
}

/** @deprecated Prefer auth-helpers.createSessionAndReply (sets HttpOnly session cookie). */
export { createSessionAndReply } from "./auth-helpers.js";

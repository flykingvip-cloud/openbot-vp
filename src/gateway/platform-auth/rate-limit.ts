import type { PlatformAuthUser } from "./store-types.js";

const DEFAULT_PASSWORD_LOCK_ATTEMPTS = 5;
const DEFAULT_PASSWORD_LOCK_MS = 15 * 60 * 1000;

export function recordFailedLogin(user: PlatformAuthUser, now = Date.now()) {
  user.loginFailedCount += 1;
  user.updatedAt = new Date(now).toISOString();
  if (user.loginFailedCount >= DEFAULT_PASSWORD_LOCK_ATTEMPTS) {
    user.lockedUntil = new Date(now + DEFAULT_PASSWORD_LOCK_MS).toISOString();
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

import path from "node:path";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

const DEFAULT_PLATFORM_AUTH_COOKIE = "openbot_platform_session";
const DEFAULT_PLATFORM_AUTH_SESSION_TTL_HOURS = 24 * 7;
const DEFAULT_PLATFORM_AUTH_ACTIVATION_TTL_HOURS = 24 * 3;
const DEFAULT_PLATFORM_AUTH_PASSWORD_RESET_TTL_MINUTES = 30;
export const PLATFORM_AUTH_BODY_LIMIT_BYTES = 64 * 1024;

export const DEFAULT_PLATFORM_AUTH_SCOPES = [
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
] as const;

function resolveDefaultPlatformAuthStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-platform-auth.json");
}

export type ResolvedPlatformAuthConfig = {
  enabled: boolean;
  storePath: string;
  sessionTtlHours: number;
  activationTtlHours: number;
  passwordResetTtlMinutes: number;
  cookieName: string;
  cookieDomain?: string;
  requireMfaForPlatformAdmins: boolean;
};

function normalizeCookieDomain(value: string | undefined): string | undefined {
  const domain = value?.trim().toLowerCase().replace(/^\.+/, "");
  if (!domain) {
    return undefined;
  }
  if (
    domain.length > 253 ||
    !domain.includes(".") ||
    !domain.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))
  ) {
    throw new Error("gateway.auth.trustedProxy.platformAuth.cookieDomain must be a DNS domain");
  }
  return domain;
}

export function resolvePlatformAuthConfig(
  trustedProxy: GatewayTrustedProxyConfig | undefined,
): ResolvedPlatformAuthConfig | null {
  const platformAuth = trustedProxy?.platformAuth;
  if (!platformAuth || platformAuth.enabled === false) {
    return null;
  }
  return {
    enabled: true,
    storePath: resolveUserPath(platformAuth.store?.trim() || resolveDefaultPlatformAuthStorePath()),
    sessionTtlHours: Math.max(
      1,
      Math.floor(platformAuth.sessionTtlHours ?? DEFAULT_PLATFORM_AUTH_SESSION_TTL_HOURS),
    ),
    activationTtlHours: Math.max(
      1,
      Math.floor(platformAuth.activationTtlHours ?? DEFAULT_PLATFORM_AUTH_ACTIVATION_TTL_HOURS),
    ),
    passwordResetTtlMinutes: Math.max(
      5,
      Math.floor(
        platformAuth.passwordResetTtlMinutes ?? DEFAULT_PLATFORM_AUTH_PASSWORD_RESET_TTL_MINUTES,
      ),
    ),
    cookieName: platformAuth.cookieName?.trim() || DEFAULT_PLATFORM_AUTH_COOKIE,
    cookieDomain: normalizeCookieDomain(platformAuth.cookieDomain),
    requireMfaForPlatformAdmins: platformAuth.requireMfaForPlatformAdmins !== false,
  };
}

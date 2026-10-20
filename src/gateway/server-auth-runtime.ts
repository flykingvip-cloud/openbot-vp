// Auth-related runtime helpers extracted from server.impl.ts:
//   - createGatewayAuthRateLimiters: per-startup connect/auth rate limiters
//   - logGatewayAuthSurfaceDiagnostics: logs active/inactive secret surfaces
//   - applyGatewayAuthOverridesForStartupPreflight: merges runtime auth
//     overrides into config so secret resolution sees the real auth surface
//
// Keeping these here removes ~50 lines of "tiny startup logic" from the
// gateway composition root and makes them independently testable.

import type { OpenBotConfig } from "../config/config.js";
import {
  GATEWAY_AUTH_SURFACE_PATHS,
  evaluateGatewayAuthSurfaceStates,
} from "../secrets/runtime-gateway-auth-surfaces.js";
import { type AuthRateLimiter, createAuthRateLimiter } from "./auth-rate-limit.js";
import { mergeGatewayAuthConfig, mergeGatewayTailscaleConfig } from "./startup-auth.js";

type AuthRateLimitConfig = Parameters<typeof createAuthRateLimiter>[0];

export type GatewayAuthRateLimiters = {
  rateLimiter: AuthRateLimiter;
  browserRateLimiter: AuthRateLimiter;
};

/**
 * Build the pair of auth rate limiters used by the gateway:
 *  - the default one honors the loopback exemption from config
 *  - the browser-origin one always throttles loopback to harden the
 *    browser-served Control UI auth surface
 */
export function createGatewayAuthRateLimiters(
  rateLimitConfig: AuthRateLimitConfig | undefined,
): GatewayAuthRateLimiters {
  // Always install a limiter. Omitting gateway.auth.rateLimit used to leave
  // rateLimiter undefined, so trusted-proxy Mac reconnect storms never throttled.
  const rateLimiter = createAuthRateLimiter(rateLimitConfig);
  // Browser-origin WS auth attempts always use loopback-non-exempt throttling.
  const browserRateLimiter = createAuthRateLimiter({
    ...rateLimitConfig,
    exemptLoopback: false,
  });
  return { rateLimiter, browserRateLimiter };
}

export type SecretsRuntimeWarning = { code: string; path: string; message: string };

export type SecretsLogger = { info: (msg: string) => void };

/**
 * Emit a structured `[SECRETS_GATEWAY_AUTH_SURFACE]` log line for every
 * gateway auth surface that references a secret, indicating whether it
 * is active and (for inactive ones) why.
 */
export function logGatewayAuthSurfaceDiagnostics(
  prepared: { sourceConfig: OpenBotConfig; warnings: SecretsRuntimeWarning[] },
  logSecrets: SecretsLogger,
): void {
  const states = evaluateGatewayAuthSurfaceStates({
    config: prepared.sourceConfig,
    defaults: prepared.sourceConfig.secrets?.defaults,
    env: process.env,
  });
  const inactiveWarnings = new Map<string, string>();
  for (const warning of prepared.warnings) {
    if (warning.code !== "SECRETS_REF_IGNORED_INACTIVE_SURFACE") {
      continue;
    }
    inactiveWarnings.set(warning.path, warning.message);
  }
  for (const path of GATEWAY_AUTH_SURFACE_PATHS) {
    const state = states[path];
    if (!state.hasSecretRef) {
      continue;
    }
    const stateLabel = state.active ? "active" : "inactive";
    const inactiveDetails =
      !state.active && inactiveWarnings.get(path) ? inactiveWarnings.get(path) : undefined;
    const details = inactiveDetails ?? state.reason;
    logSecrets.info(`[SECRETS_GATEWAY_AUTH_SURFACE] ${path} is ${stateLabel}. ${details}`);
  }
}

export type GatewayAuthOverrides = {
  auth?: import("../config/config.js").GatewayAuthConfig;
  tailscale?: import("../config/config.js").GatewayTailscaleConfig;
};

/**
 * Apply auth/tailscale runtime overrides to a config snapshot before the
 * startup secrets preflight runs. This ensures secret resolution sees the
 * actual auth surface that will be active at runtime, not just what was
 * persisted to the config file.
 */
export function applyGatewayAuthOverridesForStartupPreflight(
  config: OpenBotConfig,
  overrides: GatewayAuthOverrides,
): OpenBotConfig {
  if (!overrides.auth && !overrides.tailscale) {
    return config;
  }
  return {
    ...config,
    gateway: {
      ...config.gateway,
      auth: mergeGatewayAuthConfig(config.gateway?.auth, overrides.auth),
      tailscale: mergeGatewayTailscaleConfig(config.gateway?.tailscale, overrides.tailscale),
    },
  };
}

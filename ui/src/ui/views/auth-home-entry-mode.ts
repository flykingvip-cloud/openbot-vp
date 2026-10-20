import type { ControlUiPlatformAuthMode } from "../../../../src/gateway/control-ui-contract.js";

const RECOVERY_MODES = new Set<ControlUiPlatformAuthMode>(["forgot-password", "password-reset"]);

/**
 * Enterprise and platform login pages have a fixed entry mode. Recovery modes
 * chosen on that page, or restored after the reset API, must still win.
 * Anything else stays on the surface login (or enterprise activation).
 */
export function authHomeModeForControlledLogin(params: {
  isPlatformLogin: boolean;
  platformAuthMode: ControlUiPlatformAuthMode;
}): ControlUiPlatformAuthMode {
  if (RECOVERY_MODES.has(params.platformAuthMode)) {
    return params.platformAuthMode;
  }
  return params.isPlatformLogin ? "platform-admin-login" : "enterprise-activate";
}

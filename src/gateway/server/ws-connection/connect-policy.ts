import { isFirstPartyNativeGatewayClientId } from "../../protocol/client-info.js";
import type { ConnectParams } from "../../protocol/index.js";
import type { GatewayRole } from "../../role-policy.js";
import { roleCanSkipDeviceIdentity } from "../../role-policy.js";

export type ControlUiAuthPolicy = {
  allowInsecureAuthConfigured: boolean;
  dangerouslyDisableDeviceAuth: boolean;
  allowBypass: boolean;
  device: ConnectParams["device"] | null | undefined;
};

export function resolveControlUiAuthPolicy(params: {
  isControlUi: boolean;
  controlUiConfig:
    | {
        allowInsecureAuth?: boolean;
        dangerouslyDisableDeviceAuth?: boolean;
      }
    | undefined;
  deviceRaw: ConnectParams["device"] | null | undefined;
}): ControlUiAuthPolicy {
  const allowInsecureAuthConfigured =
    params.isControlUi && params.controlUiConfig?.allowInsecureAuth === true;
  const dangerouslyDisableDeviceAuth =
    params.isControlUi && params.controlUiConfig?.dangerouslyDisableDeviceAuth === true;
  return {
    allowInsecureAuthConfigured,
    dangerouslyDisableDeviceAuth,
    // `allowInsecureAuth` must not bypass secure-context/device-auth requirements.
    allowBypass: dangerouslyDisableDeviceAuth,
    device: dangerouslyDisableDeviceAuth ? null : params.deviceRaw,
  };
}

export function shouldSkipControlUiPairing(
  policy: ControlUiAuthPolicy,
  sharedAuthOk: boolean,
  /**
   * @deprecated Trusted-proxy no longer skips pairing registration. When a
   * Control UI session presents a device identity we still silent-approve it
   * (see message-handler) so employee "我的设备" can list the browser. The
   * parameter is kept for call-site compatibility and ignored.
   */
  _trustedProxyAuthOk = false,
): boolean {
  void _trustedProxyAuthOk;
  // Only the explicit dangerouslyDisableDeviceAuth bypass skips registration.
  // Trusted-proxy may connect without a device identity, but when a device is
  // present it must still be recorded with an ownerId.
  return policy.allowBypass && sharedAuthOk;
}

export function isTrustedProxyControlUiOperatorAuth(params: {
  isControlUi: boolean;
  role: GatewayRole;
  authMode: string;
  authOk: boolean;
  authMethod: string | undefined;
}): boolean {
  void params.authMode;
  return (
    params.isControlUi &&
    params.role === "operator" &&
    params.authOk &&
    params.authMethod === "trusted-proxy"
  );
}

export function isFirstPartyNativeTrustedProxyAuth(params: {
  clientId: string | undefined;
  authOk: boolean;
  authMethod: string | undefined;
}): boolean {
  return (
    params.authOk &&
    params.authMethod === "trusted-proxy" &&
    isFirstPartyNativeGatewayClientId(params.clientId)
  );
}

/**
 * Silent-approve device pairing for local trusted clients and for employee
 * sessions that already authenticated via platform trusted-proxy (Control UI,
 * webchat, and first-party native apps). Remote unauthenticated clients still
 * require an explicit pairing approval.
 */
export function shouldAllowSilentLocalPairing(params: {
  isLocalClient: boolean;
  hasBrowserOriginHeader: boolean;
  isControlUi: boolean;
  isWebchat: boolean;
  reason: "not-paired" | "role-upgrade" | "scope-upgrade" | "metadata-upgrade";
  /** Platform trusted-proxy Control UI / webchat operator auth. */
  trustedProxyAuthOk?: boolean;
  /** First-party native app + platform trusted-proxy session (operator or node). */
  firstPartyNativeTrustedProxyAuthOk?: boolean;
}): boolean {
  const reasonOk = params.reason === "not-paired" || params.reason === "scope-upgrade";
  if (!reasonOk) {
    return false;
  }
  // Production Control UI / webchat authenticates via trusted-proxy (nginx).
  // Silent-approve so browsers land in paired.json ("我的设备") without a prompt.
  if (params.trustedProxyAuthOk && (params.isControlUi || params.isWebchat)) {
    return true;
  }
  // Employee Android/iOS/macOS apps authenticate the same platform session over
  // WS; without silent approve, remote phones hit "pairing required" after login.
  if (params.firstPartyNativeTrustedProxyAuthOk) {
    return true;
  }
  return (
    params.isLocalClient &&
    (!params.hasBrowserOriginHeader || params.isControlUi || params.isWebchat)
  );
}

export type MissingDeviceIdentityDecision =
  | { kind: "allow" }
  | { kind: "reject-control-ui-insecure-auth" }
  | { kind: "reject-unauthorized" }
  | { kind: "reject-device-required" };

export function evaluateMissingDeviceIdentity(params: {
  hasDeviceIdentity: boolean;
  role: GatewayRole;
  isControlUi: boolean;
  controlUiAuthPolicy: ControlUiAuthPolicy;
  trustedProxyAuthOk?: boolean;
  sharedAuthOk: boolean;
  authOk: boolean;
  hasSharedAuth: boolean;
  isLocalClient: boolean;
}): MissingDeviceIdentityDecision {
  if (params.hasDeviceIdentity) {
    return { kind: "allow" };
  }
  if (params.isControlUi && params.trustedProxyAuthOk) {
    return { kind: "allow" };
  }
  if (params.isControlUi && !params.controlUiAuthPolicy.allowBypass) {
    // Allow localhost Control UI connections when allowInsecureAuth is configured.
    // Localhost has no network interception risk, and browser SubtleCrypto
    // (needed for device identity) is unavailable in insecure HTTP contexts.
    // Remote connections are still rejected to preserve the MitM protection
    // that the security fix (#20684) intended.
    if (!params.controlUiAuthPolicy.allowInsecureAuthConfigured || !params.isLocalClient) {
      return { kind: "reject-control-ui-insecure-auth" };
    }
  }
  if (roleCanSkipDeviceIdentity(params.role, params.sharedAuthOk)) {
    return { kind: "allow" };
  }
  if (!params.authOk && params.hasSharedAuth) {
    return { kind: "reject-unauthorized" };
  }
  return { kind: "reject-device-required" };
}

import { isGatewayCliClient, isWebchatClient } from "../../../utils/message-channel.js";
import type { ResolvedGatewayAuth } from "../../auth.js";
import { isGatewayControlUiClientId } from "../../protocol/client-info.js";

export type AuthProvidedKind = "token" | "device-token" | "password" | "none";

function isBrowserFacingClient(client?: { id?: string | null; mode?: string | null }): boolean {
  return isGatewayControlUiClientId(client?.id) || isWebchatClient(client);
}

function formatTrustedProxyAuthFailureMessage(params: {
  reason?: string;
  isBrowserFacing: boolean;
}): string | undefined {
  const { reason, isBrowserFacing } = params;
  switch (reason) {
    case "trusted_proxy_untrusted_source":
      return isBrowserFacing
        ? "unauthorized: direct gateway access blocked (use platform or enterprise login through the reverse proxy)"
        : "unauthorized: trusted proxy rejected request (source IP is not in gateway.trustedProxies)";
    case "trusted_proxy_user_missing":
      return isBrowserFacing
        ? "unauthorized: platform session missing (sign in through platform or enterprise login, then refresh)"
        : "unauthorized: trusted proxy user header missing";
    case "trusted_proxy_user_not_allowed":
      return "unauthorized: authenticated user is not allowed by gateway.auth.trustedProxy.allowUsers";
    case "trusted_proxy_invalid_role":
      return "unauthorized: trusted proxy role header is invalid";
    case "trusted_proxy_config_missing":
      return "unauthorized: trusted proxy auth is not configured on gateway (set gateway.auth.trustedProxy)";
    case "trusted_proxy_no_proxies_configured":
      return "unauthorized: trusted proxy auth requires gateway.trustedProxies";
    case "trusted_proxy_no_request":
      return "unauthorized: trusted proxy auth requires an HTTP request context";
    default:
      if (reason?.startsWith("trusted_proxy_missing_header_")) {
        const header = reason.slice("trusted_proxy_missing_header_".length);
        return isBrowserFacing
          ? `unauthorized: reverse proxy session incomplete (missing ${header}; sign in again through platform login)`
          : `unauthorized: trusted proxy required header missing (${header})`;
      }
      return undefined;
  }
}

export function formatGatewayAuthFailureMessage(params: {
  authMode: ResolvedGatewayAuth["mode"];
  authProvided: AuthProvidedKind;
  reason?: string;
  client?: { id?: string | null; mode?: string | null };
}): string {
  const { authMode, authProvided, reason, client } = params;
  const isCli = isGatewayCliClient(client);
  const isBrowserFacing = isBrowserFacingClient(client);
  const trustedProxyMessage =
    authMode === "trusted-proxy"
      ? formatTrustedProxyAuthFailureMessage({ reason, isBrowserFacing })
      : undefined;
  if (trustedProxyMessage) {
    return trustedProxyMessage;
  }
  const uiHint = "open the dashboard URL and paste the token in Control UI settings";
  const tokenHint = isCli
    ? "set gateway.remote.token to match gateway.auth.token"
    : isBrowserFacing
      ? uiHint
      : "provide gateway auth token";
  const passwordHint = isCli
    ? "set gateway.remote.password to match gateway.auth.password"
    : isBrowserFacing
      ? "enter the password in Control UI settings"
      : "provide gateway auth password";
  switch (reason) {
    case "token_missing":
      return `unauthorized: gateway token missing (${tokenHint})`;
    case "token_mismatch":
      return `unauthorized: gateway token mismatch (${tokenHint})`;
    case "token_missing_config":
      return "unauthorized: gateway token not configured on gateway (set gateway.auth.token)";
    case "password_missing":
      return `unauthorized: gateway password missing (${passwordHint})`;
    case "password_mismatch":
      return `unauthorized: gateway password mismatch (${passwordHint})`;
    case "password_missing_config":
      return "unauthorized: gateway password not configured on gateway (set gateway.auth.password)";
    case "tailscale_user_missing":
      return "unauthorized: tailscale identity missing (use Tailscale Serve auth or gateway token/password)";
    case "tailscale_proxy_missing":
      return "unauthorized: tailscale proxy headers missing (use Tailscale Serve or gateway token/password)";
    case "tailscale_whois_failed":
      return "unauthorized: tailscale identity check failed (use Tailscale Serve auth or gateway token/password)";
    case "tailscale_user_mismatch":
      return "unauthorized: tailscale identity mismatch (use Tailscale Serve auth or gateway token/password)";
    case "rate_limited":
      return "unauthorized: too many failed authentication attempts (retry later)";
    case "device_token_mismatch":
      return "unauthorized: device token mismatch (rotate/reissue device token)";
    default:
      break;
  }

  if (authMode === "trusted-proxy" && authProvided === "none") {
    return isBrowserFacing
      ? "unauthorized: platform session missing (sign in through platform or enterprise login, then refresh)"
      : "unauthorized: trusted proxy session missing";
  }
  if (authMode === "token" && authProvided === "none") {
    return `unauthorized: gateway token missing (${tokenHint})`;
  }
  if (authMode === "token" && authProvided === "device-token") {
    return "unauthorized: device token rejected (pair/repair this device, or provide gateway token)";
  }
  if (authMode === "password" && authProvided === "none") {
    return `unauthorized: gateway password missing (${passwordHint})`;
  }
  return "unauthorized";
}

import type { ControlUiAuthMode } from "../../../src/gateway/control-ui-contract.js";

const GATEWAY_TOKEN_AUTH_PATTERNS = [
  "gateway token missing",
  "gateway token mismatch",
  "gateway password missing",
  "gateway password mismatch",
  "control ui settings",
] as const;

const TRUSTED_PROXY_AUTH_PATTERNS = [
  "trusted proxy",
  "platform session",
  "reverse-proxy login",
  "proxy session",
  "trusted_proxy",
] as const;

const GENERIC_AUTH_PATTERNS = [
  "unauthorized",
  "authentication failed",
  "auth_rate_limited",
  "rate_limited",
  "pairing required",
] as const;

export function isGatewayAuthIssue(error: string | null | undefined): boolean {
  const message = error?.trim().toLowerCase() ?? "";
  if (!message) {
    return false;
  }
  if (GATEWAY_TOKEN_AUTH_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }
  if (TRUSTED_PROXY_AUTH_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }
  return GENERIC_AUTH_PATTERNS.some((pattern) => message.includes(pattern));
}

export function isTrustedProxyBrowserAuthMode(
  authMode: ControlUiAuthMode | null | undefined,
): boolean {
  return authMode === "trusted-proxy";
}

export function resolveGatewayAuthRecoveryHint(params: {
  authMode?: ControlUiAuthMode | null;
  hasPlatformSession?: boolean;
}): string {
  if (isTrustedProxyBrowserAuthMode(params.authMode)) {
    return params.hasPlatformSession
      ? "当前 Gateway 会话已失效，请刷新页面或重新登录平台/企业账户后重试。"
      : "当前 Gateway 需要平台或反向代理登录；请先完成平台/企业登录，再返回此页面。";
  }
  return "当前 Gateway 认证未完成；在 Control UI 设置中补充网关 token 或 password 后重新连接，即可恢复数据加载。";
}

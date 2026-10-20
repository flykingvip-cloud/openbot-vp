import type {
  ControlUiPlatformAuthState,
  ControlUiTrustedProxySession,
} from "../../../../../src/gateway/control-ui-contract.js";
import type { GatewayHelloOk } from "../../gateway.ts";

type PlatformAuthSessionSource = {
  hello?: GatewayHelloOk | null;
  platformAuthState?: ControlUiPlatformAuthState | null;
  bootstrapAuthSession?: ControlUiTrustedProxySession | null;
};

export function resolveActivePlatformAuthSession(
  state: PlatformAuthSessionSource,
): ControlUiTrustedProxySession | null {
  if (state.platformAuthState?.session) {
    return state.platformAuthState.session;
  }
  if (state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user?.trim()) {
    return {
      provider: "trusted-proxy",
      user: state.hello.auth.user,
      displayName: state.hello.auth.displayName,
      tenantId: state.hello.auth.tenantId,
      role: state.hello.auth.role,
      scopes: state.hello.auth.scopes,
    };
  }
  return state.bootstrapAuthSession ?? null;
}

export function isPlatformAdminSessionKind(
  sessionKind: ControlUiPlatformAuthState["sessionKind"] | null | undefined,
): boolean {
  return sessionKind === "platform-admin" || sessionKind === "platform-super-admin";
}

export function isPlatformAdminAuthenticated(state: PlatformAuthSessionSource): boolean {
  if (state.platformAuthState?.enabled !== true) {
    return false;
  }
  if (!isPlatformAdminSessionKind(state.platformAuthState.sessionKind)) {
    return false;
  }
  return Boolean(resolveActivePlatformAuthSession(state));
}

export function isEnterpriseAdminSessionKind(
  sessionKind: ControlUiPlatformAuthState["sessionKind"] | null | undefined,
): boolean {
  return sessionKind === "enterprise-admin";
}

export function isEnterpriseAdminAuthenticated(state: PlatformAuthSessionSource): boolean {
  if (state.platformAuthState?.enabled !== true) {
    return false;
  }
  if (!isEnterpriseAdminSessionKind(state.platformAuthState.sessionKind)) {
    return false;
  }
  return Boolean(resolveActivePlatformAuthSession(state));
}

export function shouldShowPlatformLoginEntry(state: PlatformAuthSessionSource): boolean {
  if (state.platformAuthState?.enabled !== true) {
    return false;
  }
  return !isPlatformAdminAuthenticated(state);
}

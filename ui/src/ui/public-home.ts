import type {
  ControlUiPlatformAuthState,
  ControlUiTrustedProxySession,
} from "../../../src/gateway/control-ui-contract.js";
import { normalizePath, pathForTab } from "./navigation.ts";
import {
  resolvePortFromSubdomain,
  type SubdomainResolution,
} from "./routing/subdomain-resolver.ts";

function clonePublicHomepageState(
  state: ControlUiPlatformAuthState | null,
): ControlUiPlatformAuthState {
  return {
    enabled: true,
    hasUsers: state?.hasUsers ?? false,
    ...(typeof state?.hasPlatformAdmins === "boolean"
      ? { hasPlatformAdmins: state.hasPlatformAdmins }
      : {}),
    ...(typeof state?.allowRegistration === "boolean"
      ? { allowRegistration: state.allowRegistration }
      : {}),
    ...(typeof state?.requiresInvite === "boolean" ? { requiresInvite: state.requiresInvite } : {}),
    ...(typeof state?.requiresPlatformBootstrap === "boolean"
      ? { requiresPlatformBootstrap: state.requiresPlatformBootstrap }
      : {}),
    ...(state?.availableModes ? { availableModes: state.availableModes } : {}),
    ...(state?.pendingActivation ? { pendingActivation: state.pendingActivation } : {}),
    ...(state?.pendingPasswordReset ? { pendingPasswordReset: state.pendingPasswordReset } : {}),
  };
}

export function resolvePublicHomepageState(params: {
  platformAuthState: ControlUiPlatformAuthState | null;
  activePlatformSession: ControlUiTrustedProxySession | null;
  useBootstrapAuth: boolean;
  forcePublicHomepage: boolean;
  basePath?: string;
  pageUrl?: string;
}): ControlUiPlatformAuthState | null {
  if (shouldUsePublicHomepageForCurrentLocation(params.basePath ?? "", params.pageUrl)) {
    return clonePublicHomepageState(params.platformAuthState);
  }
  if (!params.forcePublicHomepage) {
    if (params.activePlatformSession) {
      return null;
    }
    if (params.useBootstrapAuth && params.platformAuthState?.enabled) {
      return params.platformAuthState;
    }
    return null;
  }
  return clonePublicHomepageState(params.platformAuthState);
}

/**
 * Operator console: a live gateway connection (shared token/password) is not a
 * platform registration session. Do not replace that chat with the public
 * 团队工作台 login wall, or work-progress phases never mount.
 * Logout and the public marketing host still show the homepage.
 */
export function resolveControlUiHomepageState(
  params: Parameters<typeof resolvePublicHomepageState>[0] & {
    gatewayConnected: boolean;
  },
): ControlUiPlatformAuthState | null {
  const homepage = resolvePublicHomepageState(params);
  if (!homepage || !params.gatewayConnected || params.forcePublicHomepage) {
    return homepage;
  }
  if (params.activePlatformSession) {
    return homepage;
  }
  if (shouldUsePublicHomepageForCurrentLocation(params.basePath ?? "", params.pageUrl)) {
    return homepage;
  }
  return null;
}

function isOpenBotPublicHost(host: string): boolean {
  const resolution = resolvePortFromSubdomain(host);
  return resolution.isPublicHome;
}

/** Employee registration and sign-in live on the public site, never on biz or admin. */
export const CANONICAL_EMPLOYEE_PUBLIC_HOME_URL = "https://www.openbot.love/";

/**
 * On biz.openbot.love and admin.openbot.love, 「首页」 must leave the console
 * host. Painting the employee auth-home there posts an employee login at the
 * enterprise or platform host.
 */
export function consoleHostEmployeeHomeUrl(host: string): string | null {
  const port = resolvePortFromSubdomain(host).port;
  if (port === "enterprise" || port === "platform") {
    return CANONICAL_EMPLOYEE_PUBLIC_HOME_URL;
  }
  return null;
}

export function resolveEmployeePublicHomeHref(host: string, basePath = ""): string {
  return consoleHostEmployeeHomeUrl(host) ?? pathForTab("me", basePath);
}

/**
 * 解析当前域名的子域信息。供外部模块（如 app 初始化）使用以确定是否应锁定特定 port。
 * 返回 null 时表示不锁定（走 path-based 路由）。
 */
export function resolveSubdomainContext(pageUrl?: string): SubdomainResolution {
  const rawUrl = pageUrl ?? (typeof window !== "undefined" ? window.location.href : undefined);
  if (!rawUrl) {
    return { port: null, isPublicHome: false, isOpenBotDomain: false };
  }
  try {
    const url = new URL(rawUrl);
    return resolvePortFromSubdomain(url.host);
  } catch {
    return { port: null, isPublicHome: false, isOpenBotDomain: false };
  }
}

export function shouldUsePublicHomepageForCurrentLocation(
  basePath: string,
  pageUrl?: string,
): boolean {
  const rawUrl = pageUrl ?? (typeof window !== "undefined" ? window.location.href : undefined);
  if (!rawUrl) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    if (!isOpenBotPublicHost(url.host)) {
      return false;
    }
    if (normalizePath(url.pathname) !== normalizePath(pathForTab("me", basePath))) {
      return false;
    }
    return !url.searchParams.get("session")?.trim();
  } catch {
    return false;
  }
}

export function replaceLocationWithPublicHomepage(basePath: string) {
  if (typeof window === "undefined") {
    return;
  }
  const employeeHome = consoleHostEmployeeHomeUrl(window.location.host);
  if (employeeHome) {
    window.location.assign(employeeHome);
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = pathForTab("me", basePath);
  url.search = "";
  url.hash = "";
  window.history.replaceState({}, "", url.toString());
}

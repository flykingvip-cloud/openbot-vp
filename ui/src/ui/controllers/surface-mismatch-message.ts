import { i18n } from "../../i18n/index.ts";
import {
  CANONICAL_LOGIN_URL,
  SURFACE_MISMATCH_COPY,
  type LoginSurfaceName,
} from "../../i18n/surface-mismatch-copy.ts";

export type SurfaceMismatchDetails = {
  requestSurface?: LoginSurfaceName;
  targetSurface?: LoginSurfaceName;
};

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);
}

function copyFor(locale: string) {
  return locale.toLowerCase().startsWith("zh")
    ? SURFACE_MISMATCH_COPY["zh-CN"]
    : SURFACE_MISMATCH_COPY.en;
}

/**
 * Names the public portal for the login that was attempted.
 * An employee target always points at www, including the biz logout card
 * that posts sessionDomain "employee" to an enterprise host.
 */
export function formatSurfaceMismatchLoginMessage(
  details?: SurfaceMismatchDetails,
  locale: string = i18n.getLocale(),
): string {
  const copy = copyFor(locale);
  const target = details?.targetSurface;
  if (!target) {
    return fill(copy.unknown, {
      employeeUrl: CANONICAL_LOGIN_URL.employee,
      enterpriseUrl: CANONICAL_LOGIN_URL.enterprise,
      platformUrl: CANONICAL_LOGIN_URL.platform,
    });
  }
  const params = {
    attempt: copy.attempt[target],
    nextPortal: copy.next[target],
    url: CANONICAL_LOGIN_URL[target],
    currentPortal: details?.requestSurface ? copy.current[details.requestSurface] : "",
  };
  if (details?.requestSurface) {
    return fill(copy.withCurrent, params);
  }
  return fill(copy.withoutCurrent, params);
}

const LOGIN_PATHS = new Set(["/", "/enterprise/login", "/platform/login"]);

/** Only link the three public OpenBot login portals. */
export function isSafeOpenBotLoginHref(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    if (host !== "openbot.love" && !host.endsWith(".openbot.love")) {
      return false;
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return LOGIN_PATHS.has(path);
  } catch {
    return false;
  }
}

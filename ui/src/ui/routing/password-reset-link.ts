import { resolvePortFromSubdomain } from "./subdomain-resolver.ts";

export const PASSWORD_RESET_LOGIN_PATH = {
  employee: "/",
  enterprise: "/enterprise/login",
  platform: "/platform/login",
} as const;

export type PasswordResetSurface = keyof typeof PASSWORD_RESET_LOGIN_PATH;

export type PasswordResetLocation = {
  pathname: string;
  search: string;
  hash: string;
  surface: PasswordResetSurface;
};

function stripBasePath(pathname: string, basePath = ""): string {
  const base = basePath.replace(/\/+$/, "");
  const path = pathname || "/";
  if (!base) {
    return path;
  }
  if (path === base) {
    return "/";
  }
  if (path.startsWith(`${base}/`)) {
    return path.slice(base.length) || "/";
  }
  return path;
}

function joinBasePath(basePath: string, path: string): string {
  const base = basePath.replace(/\/+$/, "");
  if (!base) {
    return path;
  }
  if (path === "/") {
    return base;
  }
  return `${base}${path}`;
}

function searchParams(search: string): URLSearchParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

export function readPasswordResetAuthMode(search: string): string {
  const params = searchParams(search);
  return params.get("authMode")?.trim() || params.get("mode")?.trim() || "";
}

function readSurfaceToken(value: string | null): PasswordResetSurface | null {
  if (value === "employee" || value === "enterprise" || value === "platform") {
    return value;
  }
  return null;
}

export function surfaceFromPasswordResetHost(
  host: string | undefined,
): PasswordResetSurface | null {
  if (!host?.trim()) {
    return null;
  }
  const resolution = resolvePortFromSubdomain(host);
  if (resolution.port === "enterprise" || resolution.port === "platform") {
    return resolution.port;
  }
  if (resolution.port === "employee" || resolution.isPublicHome) {
    return "employee";
  }
  return null;
}

function surfaceFromLoginPath(path: string): PasswordResetSurface | null {
  if (path === "/enterprise/login") {
    return "enterprise";
  }
  if (path === "/platform/login") {
    return "platform";
  }
  if (path === "/") {
    return "employee";
  }
  return null;
}

/**
 * Mail used to point at `/auth?mode=password-reset`. That path is not a page.
 * Rewrite it (and a `mode=` alias) onto the employee, enterprise, or platform
 * login route with `authMode=password-reset`.
 */
export function canonicalPasswordResetLocation(params: {
  pathname: string;
  search: string;
  host?: string;
  basePath?: string;
}): PasswordResetLocation | null {
  const basePath = params.basePath ?? "";
  const path = stripBasePath(params.pathname, basePath);
  const paramsIn = searchParams(params.search);
  const authMode = readPasswordResetAuthMode(params.search);
  const isLegacyAuthPath = path === "/auth";
  if (!isLegacyAuthPath && authMode !== "password-reset") {
    return null;
  }
  if (isLegacyAuthPath && authMode && authMode !== "password-reset") {
    return null;
  }
  const surface =
    readSurfaceToken(paramsIn.get("surface")) ??
    (isLegacyAuthPath
      ? (surfaceFromPasswordResetHost(params.host) ?? "employee")
      : (surfaceFromLoginPath(path) ?? surfaceFromPasswordResetHost(params.host) ?? "employee"));
  const pathname = joinBasePath(basePath, PASSWORD_RESET_LOGIN_PATH[surface]);
  const code = paramsIn.get("code")?.trim() ?? "";
  const next = new URLSearchParams();
  next.set("authMode", "password-reset");
  if (code) {
    next.set("code", code);
  }
  next.set("surface", surface);
  for (const key of ["email", "name"]) {
    const value = paramsIn.get(key)?.trim();
    if (value) {
      next.set(key, value);
    }
  }
  const search = `?${next.toString()}`;
  const already =
    path === PASSWORD_RESET_LOGIN_PATH[surface] &&
    paramsIn.get("authMode") === "password-reset" &&
    !paramsIn.get("mode") &&
    (paramsIn.get("surface") ?? "") === surface &&
    (paramsIn.get("code")?.trim() ?? "") === code;
  if (already) {
    return null;
  }
  return { pathname, search, hash: "#auth", surface };
}

export function passwordResetLoginTab(
  loginPath: string,
  surface: string | null | undefined,
): "me" | "enterpriseLogin" | "platformLogin" {
  if (surface === "platform" || loginPath === "/platform/login") {
    return "platformLogin";
  }
  if (surface === "enterprise" || loginPath === "/enterprise/login") {
    return "enterpriseLogin";
  }
  return "me";
}

export function passwordResetLoginMode(
  tab: "me" | "enterpriseLogin" | "platformLogin",
): "login" | "platform-admin-login" {
  return tab === "platformLogin" ? "platform-admin-login" : "login";
}

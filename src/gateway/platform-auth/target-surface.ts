/**
 * One target-surface contract for employee, enterprise, and platform login.
 *
 * Entry selects the target. Account roles only decide whether that target is
 * allowed. The highest role must not rewrite the target. One issued session
 * stays bound to one target, and HTTP and WebSocket both read that binding.
 */

import type { IncomingMessage } from "node:http";
import { listEligibleMembershipsForUser, listMembershipsByUserId } from "./memberships.js";
import type { PlatformAuthMembership, PlatformAuthStore } from "./store-types.js";

export const TARGET_SURFACES = ["employee", "enterprise", "platform"] as const;
export type TargetSurface = (typeof TARGET_SURFACES)[number];

export type RequestSurfaceResolution =
  | { kind: "authoritative"; surface: TargetSurface }
  | { kind: "ambiguous"; localDefault: TargetSurface | null };

export type LoginTarget = {
  surface: TargetSurface;
  /** Set only when the caller explicitly asked for a platform role. */
  expectedPlatformRole: "super-admin" | "admin" | null;
  /** False when the body omitted every target signal. That defaults to employee, never platform. */
  explicit: boolean;
};

export type LoginTargetResolution =
  | { ok: true; target: LoginTarget }
  | { ok: false; status: number; code: string; error: string };

export const LOGIN_PATH_BY_SURFACE = {
  employee: "/",
  enterprise: "/enterprise/login",
  platform: "/platform/login",
} as const;

const SURFACE_TOKEN: Record<string, TargetSurface> = {
  employee: "employee",
  member: "employee",
  enterprise: "enterprise",
  "enterprise-admin": "enterprise",
  platform: "platform",
  "platform-admin": "platform",
  "platform-super-admin": "platform",
  admin: "platform",
  "super-admin": "platform",
};

function headerValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed || null;
}

export function hostnameOf(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function collectUrlHostnames(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => hostnameOf(part))
    .filter((value): value is string => Boolean(value));
}

function pathnameFrom(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("/")) {
    return raw;
  }
  try {
    const parsed = raw.includes("://") ? new URL(raw) : new URL(raw, "http://localhost");
    return parsed.pathname || null;
  } catch {
    return null;
  }
}

function localPathSurface(pathname: string | null | undefined): TargetSurface | null {
  const path = pathnameFrom(pathname)?.toLowerCase();
  if (!path) {
    return null;
  }
  if (path === "/enterprise" || path.startsWith("/enterprise/")) {
    return "enterprise";
  }
  if (path === "/platform" || path.startsWith("/platform/")) {
    return "platform";
  }
  return null;
}

/**
 * Production login hosts. Employee public home (login and register) is the
 * apex and www. Enterprise login is biz. Platform login, the only entry that
 * requires an authenticator code, is admin.
 */
const CANONICAL_EMPLOYEE_HOSTS = new Set(["openbot.love", "www.openbot.love"]);
const CANONICAL_ENTERPRISE_HOSTS = new Set(["biz.openbot.love"]);
const CANONICAL_PLATFORM_HOSTS = new Set(["admin.openbot.love"]);

/**
 * gw.openbot.love is a compatibility alias of the employee site. It is never
 * the platform console. Callers that build links rewrite it to www.
 */
export function isGatewayCompatHost(hostname: string | null | undefined): boolean {
  return hostname?.toLowerCase() === "gw.openbot.love";
}

function surfaceFromKnownHostname(
  hostname: string,
  env: NodeJS.ProcessEnv,
): TargetSurface | "gateway-compat" | null {
  if (isGatewayCompatHost(hostname)) {
    return "gateway-compat";
  }
  const employeeHosts = [
    ...collectUrlHostnames(env.OPENBOT_PUBLIC_EMPLOYEE_BASE_URL),
    ...collectUrlHostnames(env.OPENCLAW_PUBLIC_EMPLOYEE_BASE_URL),
    ...collectUrlHostnames(env.OPENBOT_PUBLIC_HOME_BASE_URL),
    ...collectUrlHostnames(env.OPENCLAW_PUBLIC_HOME_BASE_URL),
  ];
  const enterpriseHosts = [
    ...collectUrlHostnames(env.OPENBOT_PUBLIC_ENTERPRISE_BASE_URL),
    ...collectUrlHostnames(env.OPENCLAW_PUBLIC_ENTERPRISE_BASE_URL),
  ];
  const platformHosts = [
    ...collectUrlHostnames(env.OPENBOT_PUBLIC_PLATFORM_BASE_URL),
    ...collectUrlHostnames(env.OPENCLAW_PUBLIC_PLATFORM_BASE_URL),
  ];
  if (
    CANONICAL_EMPLOYEE_HOSTS.has(hostname) ||
    employeeHosts.includes(hostname) ||
    hostname.startsWith("www.")
  ) {
    return "employee";
  }
  if (
    CANONICAL_ENTERPRISE_HOSTS.has(hostname) ||
    enterpriseHosts.includes(hostname) ||
    hostname.startsWith("biz.")
  ) {
    return "enterprise";
  }
  if (
    CANONICAL_PLATFORM_HOSTS.has(hostname) ||
    platformHosts.includes(hostname) ||
    hostname.startsWith("admin.")
  ) {
    return "platform";
  }
  return null;
}

export type SurfaceRequestHint = {
  origin?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  pathname?: string | null;
  referer?: string | null;
};

export function hintFromIncomingMessage(req: IncomingMessage): SurfaceRequestHint {
  return {
    origin: headerValue(req.headers.origin),
    host: headerValue(req.headers.host),
    forwardedHost: headerValue(req.headers["x-forwarded-host"]),
    referer: headerValue(req.headers.referer),
  };
}

/**
 * Authoritative when the host (or an explicit local path) names one product
 * surface. A local API call with no page path stays ambiguous so a single
 * cookie can still be read; several cookies then fall back to the employee
 * default instead of guessing the highest role.
 */
export function resolveRequestSessionSurface(
  hint: SurfaceRequestHint,
  env: NodeJS.ProcessEnv = process.env,
): RequestSurfaceResolution {
  const hostname =
    hostnameOf(hint.origin) ?? hostnameOf(hint.forwardedHost) ?? hostnameOf(hint.host);
  const pathSurface =
    localPathSurface(hint.pathname) ?? localPathSurface(pathnameFrom(hint.referer));
  if (!hostname) {
    return pathSurface
      ? { kind: "authoritative", surface: pathSurface }
      : { kind: "ambiguous", localDefault: null };
  }
  if (isLocalHostname(hostname)) {
    return pathSurface
      ? { kind: "authoritative", surface: pathSurface }
      : { kind: "ambiguous", localDefault: "employee" };
  }
  const known = surfaceFromKnownHostname(hostname, env);
  if (known === "gateway-compat") {
    return { kind: "authoritative", surface: "employee" };
  }
  if (known) {
    if (pathSurface && pathSurface !== known) {
      // The public host wins. A /platform path on www is not a platform login.
      return { kind: "authoritative", surface: known };
    }
    return { kind: "authoritative", surface: known };
  }
  return pathSurface
    ? { kind: "authoritative", surface: pathSurface }
    : { kind: "ambiguous", localDefault: null };
}

function tokenSurface(value: unknown): TargetSurface | null {
  if (typeof value !== "string") {
    return null;
  }
  return SURFACE_TOKEN[value.trim()] ?? null;
}

function readPlatformRole(value: unknown): "super-admin" | "admin" | null {
  return value === "super-admin" || value === "admin" ? value : null;
}

/**
 * Collapse sessionDomain, loginIntent, expectedSessionKind, and
 * expectedPlatformRole into one target. Disagreeing signals are refused.
 * An empty body is the employee entry, not an implicit platform session.
 */
export function resolveLoginTarget(body: {
  sessionDomain?: unknown;
  loginIntent?: unknown;
  expectedSessionKind?: unknown;
  expectedPlatformRole?: unknown;
  adminInviteCode?: unknown;
}): LoginTargetResolution {
  const surfaces = new Set<TargetSurface>();
  const add = (surface: TargetSurface | null) => {
    if (surface) {
      surfaces.add(surface);
    }
  };
  add(tokenSurface(body.sessionDomain));
  add(tokenSurface(body.loginIntent));
  add(tokenSurface(body.expectedSessionKind));
  const expectedPlatformRole = readPlatformRole(body.expectedPlatformRole);
  if (expectedPlatformRole) {
    surfaces.add("platform");
  }
  const invite = typeof body.adminInviteCode === "string" && body.adminInviteCode.trim().length > 0;
  if (invite) {
    surfaces.add("enterprise");
  }
  if (surfaces.size > 1) {
    return {
      ok: false,
      status: 400,
      code: "PLATFORM_AUTH_TARGET_CONFLICT",
      error: "Login target signals do not agree.",
    };
  }
  if (surfaces.size === 0) {
    return {
      ok: true,
      target: { surface: "employee", expectedPlatformRole: null, explicit: false },
    };
  }
  const surface = [...surfaces][0];
  if (expectedPlatformRole && surface !== "platform") {
    return {
      ok: false,
      status: 400,
      code: "PLATFORM_AUTH_TARGET_CONFLICT",
      error: "Login target signals do not agree.",
    };
  }
  return {
    ok: true,
    target: {
      surface,
      expectedPlatformRole: surface === "platform" ? expectedPlatformRole : null,
      explicit: true,
    },
  };
}

export function assertTargetMatchesRequest(
  hint: SurfaceRequestHint,
  surface: TargetSurface,
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
      requestSurface: TargetSurface;
      targetSurface: TargetSurface;
    } {
  const resolution = resolveRequestSessionSurface(hint, env);
  if (resolution.kind === "ambiguous") {
    return { ok: true };
  }
  if (resolution.surface !== surface) {
    return {
      ok: false,
      status: 403,
      code: "PLATFORM_AUTH_SURFACE_MISMATCH",
      error: "This login entry does not match the requested surface.",
      requestSurface: resolution.surface,
      targetSurface: surface,
    };
  }
  return { ok: true };
}

export type MembershipChoice = {
  membershipId: string;
  enterpriseId: string;
  enterpriseName: string;
  role: PlatformAuthMembership["membershipRole"];
};

export type MembershipSelectionResult =
  | { ok: true; membership: PlatformAuthMembership }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
      membershipChoices?: MembershipChoice[];
    };

/**
 * Employee binds a member membership only. Enterprise binds an enterprise-admin
 * membership only. Several eligible tenants require an explicit choice.
 */
export function selectSurfaceMembership(params: {
  store: PlatformAuthStore;
  userId: string;
  surface: "employee" | "enterprise";
  membershipId?: string;
  enterpriseId?: string;
}): MembershipSelectionResult {
  const requiredRole = params.surface === "enterprise" ? "enterprise-admin" : "member";
  const intent = params.surface === "enterprise" ? "enterprise-admin" : "employee";
  const membershipId = params.membershipId?.trim() || undefined;
  const enterpriseId = params.enterpriseId?.trim() || undefined;
  const anyMembership = listMembershipsByUserId(params.store, params.userId).length > 0;
  if (membershipId) {
    const candidates = listEligibleMembershipsForUser({
      store: params.store,
      userId: params.userId,
      intent,
      requiredRole,
    });
    const match = candidates.find(
      (membership) =>
        membership.id === membershipId &&
        (!enterpriseId || membership.enterpriseId === enterpriseId),
    );
    if (!match) {
      return {
        ok: false,
        status: 403,
        code: "PLATFORM_AUTH_ROLE_MISMATCH",
        error:
          params.surface === "enterprise"
            ? "This account is not an enterprise administrator for the requested tenant."
            : "This account has no employee membership for the requested tenant.",
      };
    }
    return { ok: true, membership: match };
  }
  let candidates = listEligibleMembershipsForUser({
    store: params.store,
    userId: params.userId,
    intent,
    requiredRole,
  });
  if (enterpriseId) {
    candidates = candidates.filter((membership) => membership.enterpriseId === enterpriseId);
  }
  if (candidates.length === 1) {
    return { ok: true, membership: candidates[0] };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      status: 409,
      code: "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED",
      error: "Choose an enterprise to continue.",
      membershipChoices: membershipChoicesFor(params.store, candidates),
    };
  }
  if (!anyMembership) {
    return {
      ok: false,
      status: 409,
      code: "PLATFORM_AUTH_NO_ENTERPRISE_MEMBERSHIP",
      error: "This account has no enterprise membership.",
    };
  }
  return {
    ok: false,
    status: 403,
    code: "PLATFORM_AUTH_SURFACE_INELIGIBLE",
    error:
      params.surface === "enterprise"
        ? "This account is not an enterprise administrator."
        : "This account cannot enter the employee surface.",
  };
}

/**
 * Classifies the employee position gate. `ok` is the only result that may
 * issue a session. `missing` means the ledger lists positions and this
 * account has none. `ledger-absent` means the ledger is empty or not in this
 * store, so the position cannot be verified — callers must refuse, not treat
 * an empty ledger as "no positions required".
 */
export function evaluateEmployeePosition(params: {
  tenantSeatCount: number;
  hasCurrentSeat: boolean;
}): "ok" | "ledger-absent" | "missing" {
  if (params.tenantSeatCount <= 0) {
    return "ledger-absent";
  }
  return params.hasCurrentSeat ? "ok" : "missing";
}

export function employeePositionLoginBlock(
  gate: "ok" | "ledger-absent" | "missing",
): { status: number; code: string; error: string } | null {
  if (gate === "ok") {
    return null;
  }
  if (gate === "missing") {
    return {
      status: 409,
      code: "PLATFORM_AUTH_POSITION_REQUIRED",
      error: "This employee account has no valid position.",
    };
  }
  return {
    status: 409,
    code: "PLATFORM_AUTH_POSITION_UNVERIFIED",
    error: "Employee position could not be verified.",
  };
}

export function membershipChoicesFor(
  store: PlatformAuthStore,
  memberships: readonly PlatformAuthMembership[],
): MembershipChoice[] {
  return memberships.map((membership) => ({
    membershipId: membership.id,
    enterpriseId: membership.enterpriseId,
    enterpriseName:
      store.enterprises[membership.enterpriseId]?.name?.trim() || membership.enterpriseId,
    role: membership.membershipRole,
  }));
}

export function surfaceCookieName(baseName: string, surface: TargetSurface): string {
  return `${baseName}__${surface}`;
}

export function selectSurfaceSessionCookie<
  T extends { cookieName: string; domain: TargetSurface | null },
>(params: {
  baseName: string;
  candidates: readonly T[];
  resolution: RequestSurfaceResolution;
}): T | null {
  const usable = params.candidates.filter((candidate) => candidate.domain);
  const matchSurface = (surface: TargetSurface): T | null => {
    const named = surfaceCookieName(params.baseName, surface);
    return (
      usable.find((candidate) => candidate.cookieName === named && candidate.domain === surface) ??
      usable.find(
        (candidate) => candidate.cookieName === params.baseName && candidate.domain === surface,
      ) ??
      null
    );
  };
  if (params.resolution.kind === "authoritative") {
    return matchSurface(params.resolution.surface);
  }
  if (usable.length === 1) {
    return usable[0] ?? null;
  }
  if (params.resolution.localDefault) {
    return matchSurface(params.resolution.localDefault);
  }
  return null;
}

const CANONICAL_SURFACE_ORIGIN: Record<TargetSurface, string> = {
  employee: "https://www.openbot.love",
  enterprise: "https://biz.openbot.love",
  platform: "https://admin.openbot.love",
};

function configuredSurfaceOrigin(surface: TargetSurface, env: NodeJS.ProcessEnv): string | null {
  const keys =
    surface === "employee"
      ? ["OPENBOT_PUBLIC_EMPLOYEE_BASE_URL", "OPENCLAW_PUBLIC_EMPLOYEE_BASE_URL"]
      : surface === "enterprise"
        ? ["OPENBOT_PUBLIC_ENTERPRISE_BASE_URL", "OPENCLAW_PUBLIC_ENTERPRISE_BASE_URL"]
        : ["OPENBOT_PUBLIC_PLATFORM_BASE_URL", "OPENCLAW_PUBLIC_PLATFORM_BASE_URL"];
  for (const key of keys) {
    const raw = env[key]?.trim();
    if (!raw) {
      continue;
    }
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // Ignore malformed configured origins.
    }
  }
  return null;
}

/** Public login URL for the surface the client asked to enter. */
export function loginUrlForSurface(
  surface: TargetSurface,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const origin = configuredSurfaceOrigin(surface, env) ?? CANONICAL_SURFACE_ORIGIN[surface];
  return new URL(LOGIN_PATH_BY_SURFACE[surface], origin).toString();
}

function originForHostname(hostname: string, proto: string): string | null {
  if (isGatewayCompatHost(hostname)) {
    return null;
  }
  if (isLocalHostname(hostname)) {
    return null;
  }
  if (
    hostname === "openbot.love" ||
    hostname === "www.openbot.love" ||
    hostname === "biz.openbot.love" ||
    hostname === "admin.openbot.love"
  ) {
    return `https://${hostname}`;
  }
  if (proto === "https:" || proto === "http:") {
    return `${proto}//${hostname}`;
  }
  return null;
}

export type PasswordResetLink = {
  href: string;
  surface: TargetSurface | null;
  loginPath: (typeof LOGIN_PATH_BY_SURFACE)[TargetSurface];
};

/**
 * Recovery links keep the validated surface. gw is rewritten to www. A public
 * base URL is used only when its surface agrees with the request, or when the
 * request host is a local/ambiguous caller and the configured base is itself a
 * known surface. The link never carries an arbitrary return URL.
 */
export function buildPasswordResetLink(params: {
  hint: SurfaceRequestHint;
  code: string;
  env?: NodeJS.ProcessEnv;
  proto?: string;
}): PasswordResetLink {
  const env = params.env ?? process.env;
  const resolution = resolveRequestSessionSurface(params.hint, env);
  const requestSurface = resolution.kind === "authoritative" ? resolution.surface : null;
  const publicBaseRaw =
    env.OPENBOT_PUBLIC_APP_BASE_URL?.trim() ||
    env.OPENBOT_PUBLIC_WEB_BASE_URL?.trim() ||
    env.OPENBOT_PUBLIC_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_APP_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_WEB_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_BASE_URL?.trim() ||
    "";
  let publicSurface: TargetSurface | null = null;
  let publicOrigin: string | null = null;
  if (publicBaseRaw) {
    try {
      const parsed = new URL(publicBaseRaw);
      const hostSurface = surfaceFromKnownHostname(parsed.hostname.toLowerCase(), env);
      if (hostSurface && hostSurface !== "gateway-compat") {
        publicSurface = hostSurface;
        publicOrigin = parsed.origin;
      } else if (hostSurface === "gateway-compat") {
        publicSurface = "employee";
        publicOrigin =
          configuredSurfaceOrigin("employee", env) ?? CANONICAL_SURFACE_ORIGIN.employee;
      }
    } catch {
      publicOrigin = null;
    }
  }
  const ambiguousDefault = resolution.kind === "ambiguous" ? resolution.localDefault : null;
  const surface = requestSurface ?? publicSurface ?? ambiguousDefault;
  const loginPath = LOGIN_PATH_BY_SURFACE[surface ?? "employee"];
  const hostname =
    hostnameOf(params.hint.origin) ??
    hostnameOf(params.hint.forwardedHost) ??
    hostnameOf(params.hint.host);
  const requestOrigin =
    hostname && !isGatewayCompatHost(hostname)
      ? originForHostname(hostname, params.proto === "http:" ? "http:" : "https:")
      : null;
  let origin = CANONICAL_SURFACE_ORIGIN[surface ?? "employee"];
  if (
    requestSurface &&
    requestOrigin &&
    surfaceFromKnownHostname(hostname!, env) === requestSurface
  ) {
    origin = requestOrigin;
  } else if (requestSurface) {
    origin =
      configuredSurfaceOrigin(requestSurface, env) ?? CANONICAL_SURFACE_ORIGIN[requestSurface];
  } else if (
    publicOrigin &&
    publicSurface &&
    (!requestSurface || publicSurface === requestSurface)
  ) {
    origin = publicOrigin;
  } else if (hostname && isLocalHostname(hostname)) {
    const hostHeader = params.hint.host?.trim() || params.hint.forwardedHost?.trim() || hostname;
    origin = `http://${hostHeader}`;
  }
  if (isGatewayCompatHost(hostnameOf(origin))) {
    origin = configuredSurfaceOrigin("employee", env) ?? CANONICAL_SURFACE_ORIGIN.employee;
  }
  const url = new URL(loginPath, origin);
  // The Control UI reads authMode on the surface login route. /auth is not a
  // page, and mode= is ignored except as a legacy alias the client still accepts.
  url.searchParams.set("authMode", "password-reset");
  url.searchParams.set("code", params.code);
  if (surface) {
    url.searchParams.set("surface", surface);
  }
  url.hash = "auth";
  return { href: url.toString(), surface, loginPath };
}

export function passwordResetReturn(params: {
  hint: SurfaceRequestHint;
  env?: NodeJS.ProcessEnv;
}): {
  returnSurface: TargetSurface | null;
  loginPath: (typeof LOGIN_PATH_BY_SURFACE)[TargetSurface];
} {
  const resolution = resolveRequestSessionSurface(params.hint, params.env);
  if (resolution.kind === "authoritative") {
    return {
      returnSurface: resolution.surface,
      loginPath: LOGIN_PATH_BY_SURFACE[resolution.surface],
    };
  }
  return {
    returnSurface: resolution.localDefault,
    loginPath: LOGIN_PATH_BY_SURFACE[resolution.localDefault ?? "employee"],
  };
}

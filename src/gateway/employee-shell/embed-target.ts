/**
 * Tri-Platform Employee Shell — server-side embed redirect-target validation.
 *
 * The `/native/bootstrap` endpoint (design doc §5.4.1) redirects to a `target`
 * that is EXTERNAL, attacker-controllable input. The front-end contract already
 * validates it (`ui/.../embed-routes.ts#isSafeEmbedTarget`), but the server MUST
 * re-validate independently — never trust the client. This is a deliberate,
 * standalone re-implementation (the packages don't share code) so an open-redirect
 * / session-hijack cannot slip through if the front-end guard is bypassed.
 *
 * A safe embed target is a site-internal path `/embed/employee/<surface>` for a
 * known surface, with no scheme, protocol-relative prefix, control chars,
 * backslashes, or dot-segments. Native bootstrap also accepts the site homepage
 * (`/` or `/?query`) so the macOS cloud shell can load the same document as the
 * browser (basePath="") instead of a chrome-less embed route.
 */

/** Employee surfaces that may be embedded (must match the front-end contract). */
export const EMPLOYEE_EMBED_SURFACES = [
  "overview",
  "workspace",
  "knowledge",
  "growth",
  "me",
] as const;

export type EmployeeEmbedSurface = (typeof EMPLOYEE_EMBED_SURFACES)[number];

export const EMPLOYEE_EMBED_ROUTE_PREFIX = "/embed/employee";
export const DEFAULT_EMPLOYEE_EMBED_TARGET = `${EMPLOYEE_EMBED_ROUTE_PREFIX}/overview`;

const SURFACE_SET: ReadonlySet<string> = new Set(EMPLOYEE_EMBED_SURFACES);

function pathnameOf(rawPath: string): string {
  let end = rawPath.length;
  const queryIndex = rawPath.indexOf("?");
  if (queryIndex !== -1) {
    end = Math.min(end, queryIndex);
  }
  const hashIndex = rawPath.indexOf("#");
  if (hashIndex !== -1) {
    end = Math.min(end, hashIndex);
  }
  return rawPath.slice(0, end);
}

/** Parse a site-internal path into a known embed surface, or null. */
export function parseEmployeeEmbedTargetSurface(rawPath: string): EmployeeEmbedSurface | null {
  if (typeof rawPath !== "string") {
    return null;
  }
  const pathname = pathnameOf(rawPath.trim());
  const withoutTrailingSlash =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const prefix = `${EMPLOYEE_EMBED_ROUTE_PREFIX}/`;
  if (!withoutTrailingSlash.startsWith(prefix)) {
    return null;
  }
  const surface = withoutTrailingSlash.slice(prefix.length);
  if (surface.length === 0 || surface.includes("/")) {
    return null;
  }
  return SURFACE_SET.has(surface) ? (surface as EmployeeEmbedSurface) : null;
}

function passesTargetSafetySyntax(target: string): boolean {
  for (let i = 0; i < target.length; i += 1) {
    const code = target.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || target[i] === "\\") {
      return false;
    }
  }
  if (!target.startsWith("/") || target.startsWith("//")) {
    return false;
  }
  if (target.includes("://") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return false;
  }
  if (target.includes("..")) {
    return false;
  }
  return true;
}

/**
 * Is `target` a safe, site-internal employee embed path? Operates on the RAW
 * string (never URL-resolved), so a hostile origin can never sneak through.
 */
export function isSafeEmbedTarget(target: unknown): target is string {
  if (typeof target !== "string" || target.length === 0) {
    return false;
  }
  if (!passesTargetSafetySyntax(target)) {
    return false;
  }
  return parseEmployeeEmbedTargetSurface(target) !== null;
}

/**
 * Is `target` the site homepage (`/` or `/?query`)? Same open-redirect guards as
 * embed paths; used by `/native/bootstrap` so macOS can land on the LIVE web
 * document instead of `/embed/employee/...`.
 */
export function isSafeHomepageTarget(target: unknown): target is string {
  if (typeof target !== "string" || target.length === 0) {
    return false;
  }
  if (!passesTargetSafetySyntax(target)) {
    return false;
  }
  return pathnameOf(target.trim()) === "/";
}

/** Safe `/native/bootstrap` redirect: employee embed surface OR site homepage. */
export function isSafeNativeBootstrapTarget(target: unknown): target is string {
  return isSafeHomepageTarget(target) || isSafeEmbedTarget(target);
}

/** Coerce any target to a safe embed path, falling back to the default surface. */
export function safeEmbedTargetOrDefault(target: unknown): string {
  return isSafeEmbedTarget(target) ? target : DEFAULT_EMPLOYEE_EMBED_TARGET;
}

/** Coerce a bootstrap redirect target, falling back to the default embed surface. */
export function safeNativeBootstrapTargetOrDefault(target: unknown): string {
  return isSafeNativeBootstrapTarget(target) ? target : DEFAULT_EMPLOYEE_EMBED_TARGET;
}

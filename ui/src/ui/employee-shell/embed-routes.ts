/**
 * Tri-Platform Employee Shell — embed route contract (Phase 1).
 *
 * These are the canonical, chrome-less web routes that a native Employee Shell
 * WebView (macOS / iOS / Android) navigates to in order to reuse the Web-first
 * employee workbench. Keeping the route grammar + parsing in one strictly-typed
 * module lets the Web SPA, the native shells, and the server-side
 * `/native/bootstrap` endpoint all agree on the exact same contract.
 *
 * Security note: the `target` carried by `/native/bootstrap` is EXTERNAL input.
 * It is validated here as a site-internal, allowlisted relative path to prevent
 * open-redirect / session-hijack (see the design doc §5.4.1). The server MUST
 * re-validate — this front-end guard is defense-in-depth, not the only gate.
 */

/**
 * Canonical employee-shell surfaces that may be embedded as web routes.
 *
 * `overview` / `workspace` / `growth` are the Phase 1 must-haves; `knowledge`
 * and `me` are declared here so the contract is stable when Phase 2 wires them.
 * Chat/assistant reuse these surfaces (`overview` / `workspace` + `?session=`)
 * so web and app share one Control UI conversation store on www.openbot.love.
 */
export const EMPLOYEE_EMBED_SURFACES = [
  "overview",
  "workspace",
  "knowledge",
  "growth",
  "me",
] as const;

export type EmployeeEmbedSurface = (typeof EMPLOYEE_EMBED_SURFACES)[number];

/** Route prefix for all employee embed surfaces. */
export const EMPLOYEE_EMBED_ROUTE_PREFIX = "/embed/employee";

/** Default surface used when a target is missing or fails validation. */
export const DEFAULT_EMPLOYEE_EMBED_SURFACE: EmployeeEmbedSurface = "overview";

/** Route the native shell opens first; the server exchanges the token for a session. */
export const NATIVE_BOOTSTRAP_PATH = "/native/bootstrap";

/** Result of parsing a `/native/bootstrap` path. */
export type NativeBootstrapParams = {
  /** One-time, short-TTL bootstrap token (opaque to the client). */
  token: string;
  /** Validated, site-internal embed path the WebView should land on. */
  target: string;
  /** The surface resolved from `target`. */
  surface: EmployeeEmbedSurface;
  /** True when the incoming target was unsafe and was replaced by the default. */
  targetWasRejected: boolean;
};

const SURFACE_SET: ReadonlySet<string> = new Set(EMPLOYEE_EMBED_SURFACES);

/** Type guard: is `value` a known embed surface? */
export function isEmployeeEmbedSurface(value: unknown): value is EmployeeEmbedSurface {
  return typeof value === "string" && SURFACE_SET.has(value);
}

/** Build the canonical embed path for a surface (e.g. `/embed/employee/overview`). */
export function buildEmployeeEmbedPath(surface: EmployeeEmbedSurface): string {
  return `${EMPLOYEE_EMBED_ROUTE_PREFIX}/${surface}`;
}

/** The default embed path (`/embed/employee/overview`). */
export function defaultEmployeeEmbedPath(): string {
  return buildEmployeeEmbedPath(DEFAULT_EMPLOYEE_EMBED_SURFACE);
}

/**
 * Split a raw path into its pathname (dropping query/hash) without resolving it
 * against any origin. Intentionally string-only so `//host` / `scheme:` inputs
 * are never URL-resolved to a cross-origin location.
 */
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

/**
 * Parse a site-internal path into an employee embed surface, or `null` when it
 * is not a well-formed employee embed route. Tolerates a single trailing slash,
 * query string, and hash. Does NOT accept absolute URLs.
 */
export function parseEmployeeEmbedPath(rawPath: string): EmployeeEmbedSurface | null {
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
  // Reject nested segments (e.g. `overview/extra`) and path traversal.
  if (surface.length === 0 || surface.includes("/")) {
    return null;
  }
  return isEmployeeEmbedSurface(surface) ? surface : null;
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
 * Is `target` a safe, site-internal employee embed path?
 *
 * Rejects: non-strings, control chars / backslashes, protocol-relative (`//x`),
 * scheme-carrying (`javascript:`, `data:`, `http(s):`), path traversal, and any
 * path that does not resolve to a known embed surface. Operates on the RAW
 * string (never URL-resolved) so a hostile origin can never sneak through.
 */
export function isSafeEmbedTarget(target: unknown): target is string {
  if (typeof target !== "string" || target.length === 0) {
    return false;
  }
  if (!passesTargetSafetySyntax(target)) {
    return false;
  }
  return parseEmployeeEmbedPath(target) !== null;
}

/** Site homepage (`/` or `/?query`) with the same open-redirect guards as embed paths. */
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

/** Coerce any target into a safe embed path, falling back to the default surface. */
export function safeEmbedTargetOrDefault(target: unknown): string {
  return isSafeEmbedTarget(target) ? target : defaultEmployeeEmbedPath();
}

/** Coerce a bootstrap redirect target, falling back to the default embed surface. */
export function safeNativeBootstrapTargetOrDefault(target: unknown): string {
  return isSafeNativeBootstrapTarget(target) ? target : defaultEmployeeEmbedPath();
}

function isNonEmptyToken(token: unknown): token is string {
  if (typeof token !== "string" || token.trim().length === 0) {
    return false;
  }
  for (let i = 0; i < token.length; i += 1) {
    const code = token.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * Build the `/native/bootstrap` path the native shell opens. An unsafe `target`
 * is silently downgraded to the default embed path (never passed through raw).
 *
 * @throws TypeError when `token` is empty / non-string / contains control chars.
 */
export function buildNativeBootstrapPath(input: { token: string; target?: string }): string {
  if (!isNonEmptyToken(input.token)) {
    throw new TypeError(
      "buildNativeBootstrapPath: token must be a non-empty control-char-free string",
    );
  }
  const target = safeNativeBootstrapTargetOrDefault(input.target);
  const params = new URLSearchParams({ token: input.token, target });
  return `${NATIVE_BOOTSTRAP_PATH}?${params.toString()}`;
}

/**
 * Parse a `/native/bootstrap` path. Returns `null` when the path is not a
 * bootstrap route or is missing a usable token. An unsafe `target` is replaced
 * by the default surface and flagged via `targetWasRejected`.
 */
export function parseNativeBootstrapPath(rawPath: string): NativeBootstrapParams | null {
  if (typeof rawPath !== "string") {
    return null;
  }
  // Resolve only to read pathname/search of OUR OWN route; a placeholder base is
  // safe because we never expose the resolved origin.
  let url: URL;
  try {
    url = new URL(rawPath, "https://bootstrap.invalid");
  } catch {
    return null;
  }
  if (url.pathname !== NATIVE_BOOTSTRAP_PATH) {
    return null;
  }
  const token = url.searchParams.get("token");
  if (!isNonEmptyToken(token)) {
    return null;
  }
  const rawTarget = url.searchParams.get("target");
  const targetIsSafe = isSafeNativeBootstrapTarget(rawTarget);
  const target = targetIsSafe ? rawTarget : defaultEmployeeEmbedPath();
  const surface = parseEmployeeEmbedPath(target) ?? DEFAULT_EMPLOYEE_EMBED_SURFACE;
  return {
    token,
    target,
    surface,
    targetWasRejected: !targetIsSafe,
  };
}

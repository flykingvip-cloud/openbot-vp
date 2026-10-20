/**
 * Tri-Platform Employee Shell — embed render decision (Phase 1).
 *
 * A single, pure place that answers "should the shell render chrome-less, and
 * for which surface?". The eventual wiring (in app-render / app-lifecycle) calls
 * this to decide whether to hide the workbench sidebar/topbar chrome and which
 * employee surface to focus, instead of scattering `/embed/employee/*` checks
 * across the render pipeline.
 *
 * Kept dependency-free (only the embed-route grammar) so it is trivially
 * testable and reusable by the native shells' web view bootstrap.
 */

import { parseEmployeeEmbedPath, type EmployeeEmbedSurface } from "./embed-routes.ts";

export type EmbedRenderContext = {
  /** True when the current path is a canonical `/embed/employee/*` route. */
  isEmbedRoute: boolean;
  /** The resolved employee surface when on an embed route, else `null`. */
  surface: EmployeeEmbedSurface | null;
  /** True when the shell should render without app chrome (sidebar/topbar). */
  chromeless: boolean;
};

const NON_EMBED: EmbedRenderContext = {
  isEmbedRoute: false,
  surface: null,
  chromeless: false,
};

/**
 * Resolve the embed render context from a path (pathname only; query/hash are
 * tolerated by the underlying parser). Chrome-less rendering is driven purely by
 * being on a canonical embed route so behavior is deterministic and unambiguous.
 */
export function resolveEmbedRenderContext(pathname: string): EmbedRenderContext {
  const surface = parseEmployeeEmbedPath(pathname);
  if (surface === null) {
    return NON_EMBED;
  }
  return { isEmbedRoute: true, surface, chromeless: true };
}

/** Resolve the embed render context from the current browser location. */
export function resolveEmbedRenderContextFromLocation(): EmbedRenderContext {
  if (typeof window === "undefined") {
    return NON_EMBED;
  }
  return resolveEmbedRenderContext(window.location.pathname);
}

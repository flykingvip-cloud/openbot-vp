/**
 * Local Control UI (127.0.0.1) hosts employee / enterprise / platform on one
 * origin. Gateway projects sessionDomain from pagePath; when the SPA crosses
 * surfaces without a full reload it must reconnect so connect.pagePath updates.
 */

export type LocalControlUiSurface = "employee" | "enterprise" | "platform";

export function resolveLocalControlUiSurfaceFromPathname(
  pathname: string | null | undefined,
): LocalControlUiSurface {
  const raw = pathname?.trim() || "/";
  const path = raw.startsWith("/") ? raw.toLowerCase() : `/${raw.toLowerCase()}`;
  if (path === "/enterprise" || path.startsWith("/enterprise/")) {
    return "enterprise";
  }
  if (path === "/platform" || path.startsWith("/platform/")) {
    return "platform";
  }
  return "employee";
}

export function localControlUiSurfaceChanged(
  previousPathname: string | null | undefined,
  nextPathname: string | null | undefined,
): boolean {
  return (
    resolveLocalControlUiSurfaceFromPathname(previousPathname) !==
    resolveLocalControlUiSurfaceFromPathname(nextPathname)
  );
}

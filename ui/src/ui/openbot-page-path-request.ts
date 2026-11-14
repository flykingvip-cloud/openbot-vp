/** Page path for local cookie selection when the request URL is an API route. */
export const OPENBOT_PAGE_PATH_HEADER = "x-openbot-page-path";

/** Current page path for local session-cookie selection on auth/bootstrap reads. */
export function currentPagePathForSessionRequest(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const pathname = window.location?.pathname;
  return typeof pathname === "string" && pathname.trim() ? pathname : null;
}

export function pagePathRequestHeaders(
  base: Record<string, string> = { Accept: "application/json" },
): Record<string, string> {
  const headers: Record<string, string> = { ...base };
  const pagePath = currentPagePathForSessionRequest();
  if (pagePath) {
    headers[OPENBOT_PAGE_PATH_HEADER] = pagePath;
  }
  return headers;
}

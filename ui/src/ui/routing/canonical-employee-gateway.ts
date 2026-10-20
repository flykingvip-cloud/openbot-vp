/**
 * Employee cloud entry is https://www.openbot.love/.
 * `gw.openbot.love` remains a compatibility alias and must not be a second
 * conversation store.
 */

export const CANONICAL_EMPLOYEE_CLOUD_ORIGIN = "https://www.openbot.love";
const LEGACY_EMPLOYEE_CLOUD_HOST = "gw.openbot.love";
const CANONICAL_EMPLOYEE_CLOUD_HOST = "www.openbot.love";

export function canonicalizeEmployeeCloudGatewayUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() === LEGACY_EMPLOYEE_CLOUD_HOST) {
      parsed.hostname = CANONICAL_EMPLOYEE_CLOUD_HOST;
      const next = parsed.toString();
      if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
        return next.replace(/\/$/, "");
      }
      return next;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function canonicalizeEmployeeCloudGatewayHost(host: string): string {
  const hostname = host.trim().toLowerCase().split(":")[0] ?? "";
  return hostname === LEGACY_EMPLOYEE_CLOUD_HOST ? CANONICAL_EMPLOYEE_CLOUD_HOST : host;
}

import type { DataSourceHealthStatus } from "../../capability/enterprise-data-capability/types.ts";

const VALID_HEALTH_STATUS = new Set<DataSourceHealthStatus>([
  "normal",
  "sync_delayed",
  "token_expiring",
  "error",
  "disconnected",
]);

/**
 * Asset rows use connected/disconnected; the overview health panel uses five states.
 * `connected` is healthy (`normal`), not an error.
 */
export function normalizeDataSourceHealthStatus(status: string): DataSourceHealthStatus {
  const key = status.trim().toLowerCase();
  if (key === "connected" || key === "active" || key === "ok" || key === "healthy") {
    return "normal";
  }
  if (key === "offline") {
    return "disconnected";
  }
  if (VALID_HEALTH_STATUS.has(key as DataSourceHealthStatus)) {
    return key as DataSourceHealthStatus;
  }
  return "error";
}

export function isDataSourceHealthyStatus(status: string | null | undefined): boolean {
  const key = status?.trim().toLowerCase() ?? "";
  return (
    key === "normal" || key === "connected" || key === "active" || key === "ok" || key === "healthy"
  );
}

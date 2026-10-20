export type SeatsGovernanceDrilldownFocus = "seat" | "usage" | "total";

const HASH_PREFIX = "governance";

export function normalizeCostBudgetBasePath(basePath: string): string {
  if (!basePath || basePath === "/") {
    return "";
  }
  return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}

export function parseSeatsGovernanceDrilldownFromHash(
  hash: string,
): SeatsGovernanceDrilldownFocus | null {
  const normalized = hash.replace(/^#/, "").trim();
  if (!normalized.startsWith(HASH_PREFIX)) {
    return null;
  }
  if (normalized === HASH_PREFIX || normalized === `${HASH_PREFIX}-total`) {
    return "total";
  }
  if (normalized === `${HASH_PREFIX}-seat`) {
    return "seat";
  }
  if (normalized === `${HASH_PREFIX}-usage`) {
    return "usage";
  }
  return null;
}

export function buildSeatsGovernanceDrilldownHref(
  basePath: string,
  tenantId: string,
  focus: SeatsGovernanceDrilldownFocus,
): string {
  const base = normalizeCostBudgetBasePath(basePath);
  const fragment =
    focus === "total"
      ? `${HASH_PREFIX}-total`
      : focus === "seat"
        ? `${HASH_PREFIX}-seat`
        : `${HASH_PREFIX}-usage`;
  return `${base}/enterprise/${encodeURIComponent(tenantId)}/usage/seats#${fragment}`;
}

export function hashForSeatsGovernanceDrilldown(focus: SeatsGovernanceDrilldownFocus): string {
  return focus === "total" ? `#${HASH_PREFIX}-total` : `#${HASH_PREFIX}-${focus}`;
}

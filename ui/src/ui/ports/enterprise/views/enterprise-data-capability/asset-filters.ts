/**
 * 数据资产列表筛选（纯函数）。
 */

export type AssetStatusFilter = "all" | "connected" | "error" | "disconnected" | "other";

export type AssetListFilters = {
  query: string;
  status: AssetStatusFilter;
  category: string; // "" = all
};

export function createDefaultAssetFilters(): AssetListFilters {
  return { query: "", status: "all", category: "" };
}

export function matchesAssetFilters<
  T extends {
    displayName: string;
    sourceKey: string;
    category: string;
    status: string;
    connectorId: string;
  },
>(source: T, filters: AssetListFilters, connectorLabelById?: ReadonlyMap<string, string>): boolean {
  const q = filters.query.trim().toLowerCase();
  if (q) {
    const label = connectorLabelById?.get(source.connectorId)?.toLowerCase() ?? "";
    const hay =
      `${source.displayName} ${source.sourceKey} ${source.category} ${label}`.toLowerCase();
    if (!hay.includes(q)) {
      return false;
    }
  }
  if (filters.category && source.category !== filters.category) {
    return false;
  }
  if (filters.status !== "all") {
    if (filters.status === "other") {
      if (
        source.status === "connected" ||
        source.status === "error" ||
        source.status === "disconnected"
      ) {
        return false;
      }
    } else if (source.status !== filters.status) {
      return false;
    }
  }
  return true;
}

export function filterAssetSources<
  T extends {
    displayName: string;
    sourceKey: string;
    category: string;
    status: string;
    connectorId: string;
  },
>(
  sources: readonly T[],
  filters: AssetListFilters,
  connectorLabelById?: ReadonlyMap<string, string>,
): T[] {
  return sources.filter((source) => matchesAssetFilters(source, filters, connectorLabelById));
}

export function uniqueAssetCategories(sources: ReadonlyArray<{ category: string }>): string[] {
  return [...new Set(sources.map((source) => source.category).filter(Boolean))].toSorted();
}

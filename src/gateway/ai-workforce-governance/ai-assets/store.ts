/**
 * AI Assets Store
 * Storage layer for AI asset management (bots and groups).
 */

import type {
  AiAsset,
  AiAssetStatus,
  AssetListFilters,
  AssetListItem,
  AssetSortConfig,
  PaginationInput,
  PaginationState,
  RiskLevel,
} from "../shared/types.ts";
import { generateAssetId, matchesSearch, normalizeSearchQuery } from "../shared/utils.ts";

// ============================================================================
// In-Memory Store (Production should use database)
// ============================================================================

const assetsStore = new Map<string, AiAsset>();

// ============================================================================
// CRUD Operations
// ============================================================================

export async function createAsset(
  params: Omit<AiAsset, "id" | "createdAt" | "updatedAt">,
): Promise<AiAsset> {
  const now = new Date().toISOString();
  const asset: AiAsset = {
    ...params,
    id: generateAssetId(params.type),
    createdAt: now,
    updatedAt: now,
  };
  assetsStore.set(asset.id, asset);
  return asset;
}

export async function getAssetById(id: string): Promise<AiAsset | null> {
  return assetsStore.get(id) ?? null;
}

export async function updateAsset(
  id: string,
  updates: Partial<Omit<AiAsset, "id" | "createdAt" | "updatedAt">>,
): Promise<AiAsset | null> {
  const asset = assetsStore.get(id);
  if (!asset) {
    return null;
  }
  const updated: AiAsset = {
    ...asset,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  assetsStore.set(id, updated);
  return updated;
}

export async function deleteAsset(id: string): Promise<boolean> {
  return assetsStore.delete(id);
}

// ============================================================================
// List & Filter Operations
// ============================================================================

export interface ListAssetsResult {
  items: AiAsset[];
  pagination: PaginationState;
}

export async function listAssets(
  filters: AssetListFilters,
  pagination: PaginationInput,
  sort: AssetSortConfig,
): Promise<ListAssetsResult> {
  let items = Array.from(assetsStore.values());

  // Apply filters
  if (filters.type) {
    items = items.filter((a) => a.type === filters.type);
  }

  if (filters.status) {
    items = items.filter((a) => a.status === filters.status);
  }

  if (filters.owner) {
    items = items.filter((a) => a.ownerUserId === filters.owner);
  }

  if (filters.position) {
    items = items.filter((a) => a.positionId === filters.position);
  }

  if (filters.search) {
    const query = normalizeSearchQuery(filters.search);
    items = items.filter((a) => matchesSearch(a.name, query));
  }

  // Apply sorting
  items.sort((a, b) => {
    let comparison = 0;
    switch (sort.field) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "created":
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      default:
        comparison = a.name.localeCompare(b.name);
    }
    return sort.direction === "desc" ? -comparison : comparison;
  });

  // Apply pagination
  const total = items.length;
  const totalPages = Math.ceil(total / pagination.pageSize);
  const offset = (pagination.page - 1) * pagination.pageSize;
  const paginatedItems = items.slice(offset, offset + pagination.pageSize);

  return {
    items: paginatedItems,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages,
    },
  };
}

// ============================================================================
// Bulk Operations
// ============================================================================

export async function listAllAssetIds(): Promise<string[]> {
  return Array.from(assetsStore.keys());
}

export async function getAssetsByIds(ids: string[]): Promise<AiAsset[]> {
  return ids.map((id) => assetsStore.get(id)).filter((a): a is AiAsset => a !== undefined);
}

export async function countAssetsByStatus(): Promise<Record<AiAssetStatus, number>> {
  const counts: Record<AiAssetStatus, number> = {
    active: 0,
    paused: 0,
    error: 0,
  };
  for (const asset of assetsStore.values()) {
    counts[asset.status]++;
  }
  return counts;
}

// ============================================================================
// Governance Actions
// ============================================================================

export async function pauseAsset(id: string, reason?: string): Promise<AiAsset | null> {
  const asset = await updateAsset(id, { status: "paused" });
  if (asset) {
    // Log governance action
    console.log(`[Governance] Asset ${id} paused. Reason: ${reason ?? "Not specified"}`);
  }
  return asset;
}

export async function resumeAsset(id: string): Promise<AiAsset | null> {
  return updateAsset(id, { status: "active" });
}

export async function markAssetError(id: string, _errorCode: string): Promise<AiAsset | null> {
  return updateAsset(id, { status: "error" });
}

// ============================================================================
// Asset List Item Projection
// ============================================================================

export interface AssetWithMetrics extends AiAsset {
  metrics: {
    taskCount: number;
    successRate: number;
    avgLatencyMs: number;
    totalCost: number;
  };
  riskLevel: RiskLevel;
  activeAnomalyCount: number;
}

export async function getAssetListItems(
  filters: AssetListFilters,
  pagination: PaginationInput,
  sort: AssetSortConfig,
  metricsLookup: Map<
    string,
    { taskCount: number; successRate: number; avgLatencyMs: number; totalCost: number }
  >,
  anomalyLookup: Map<string, number>,
  riskLookup: Map<string, RiskLevel>,
): Promise<{ items: AssetListItem[]; pagination: PaginationState }> {
  const result = await listAssets(filters, pagination, sort);

  const items: AssetListItem[] = result.items.map((asset) => {
    const metrics = metricsLookup.get(asset.id) ?? {
      taskCount: 0,
      successRate: 0,
      avgLatencyMs: 0,
      totalCost: 0,
    };

    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      status: asset.status,
      position: asset.positionId,
      owner: asset.ownerUserId,
      metrics,
      riskLevel: riskLookup.get(asset.id) ?? "low",
      activeAnomalyCount: anomalyLookup.get(asset.id) ?? 0,
    };
  });

  // Post-sort by metrics if needed
  if (sort.field === "cost" || sort.field === "task" || sort.field === "success_rate") {
    items.sort((a, b) => {
      let comparison = 0;
      switch (sort.field) {
        case "cost":
          comparison = a.metrics.totalCost - b.metrics.totalCost;
          break;
        case "task":
          comparison = a.metrics.taskCount - b.metrics.taskCount;
          break;
        case "success_rate":
          comparison = a.metrics.successRate - b.metrics.successRate;
          break;
      }
      return sort.direction === "desc" ? -comparison : comparison;
    });
  }

  return { items, pagination: result.pagination };
}

// ============================================================================
// Store Management
// ============================================================================

export function clearAssetsStore(): void {
  assetsStore.clear();
}

export function seedAssetsForTesting(assets: AiAsset[]): void {
  for (const asset of assets) {
    assetsStore.set(asset.id, asset);
  }
}

export function getStoreSize(): number {
  return assetsStore.size;
}

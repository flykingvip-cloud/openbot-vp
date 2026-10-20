/**
 * Governance Store - Zustand
 * State management for AI Workforce Governance UI.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type {
  AssetFilters,
  AssetListItem,
  AssetSortConfig,
  Anomaly,
  AnomalyFilters,
  AssetDetail,
  DashboardStats,
  GovernanceActionResult,
  GovernanceUIState,
  PaginationState,
  GovernanceActionType,
} from "../types/index.ts";

// ============================================================================
// Initial State
// ============================================================================

const initialPagination: PaginationState = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
};

const initialAssetSort: AssetSortConfig = {
  field: "name",
  direction: "asc",
};

const initialState: Omit<
  GovernanceUIState,
  | "fetchAssets"
  | "fetchAnomalies"
  | "fetchAssetDetail"
  | "executeAction"
  | "fetchDashboardStats"
  | "setAssetFilters"
  | "setAssetSort"
  | "setAnomalyFilters"
  | "selectAsset"
  | "clearSelectedAsset"
  | "openDetailDrawer"
  | "closeDetailDrawer"
  | "openOwnerPanel"
  | "closeOwnerPanel"
  | "setPage"
  | "setPageSize"
> = {
  assets: [],
  assetFilters: {},
  assetPagination: initialPagination,
  assetSort: initialAssetSort,
  isLoadingAssets: false,
  assetError: null,

  anomalies: [],
  anomalyFilters: { status: "pending" },
  isLoadingAnomalies: false,
  anomalyError: null,

  selectedAssetId: null,
  assetDetail: null,
  isLoadingDetail: false,
  detailError: null,

  dashboardStats: null,
  isLoadingStats: false,

  isExecutingAction: false,
  lastActionResult: null,

  isDetailDrawerOpen: false,
  isOwnerPanelOpen: false,
  selectedOwnerId: null,
};

// ============================================================================
// Store Interface
// ============================================================================

export interface GovernanceStore extends GovernanceUIState {
  // Actions
  fetchAssets: () => Promise<void>;
  fetchAnomalies: () => Promise<void>;
  fetchAssetDetail: (assetId: string) => Promise<void>;
  executeAction: (assetId: string, action: GovernanceActionType, reason?: string) => Promise<void>;
  fetchDashboardStats: () => Promise<void>;

  // UI Actions
  setAssetFilters: (filters: AssetFilters) => void;
  setAssetSort: (sort: AssetSortConfig) => void;
  setAnomalyFilters: (filters: AnomalyFilters) => void;
  selectAsset: (assetId: string) => void;
  clearSelectedAsset: () => void;
  openDetailDrawer: (assetId: string) => void;
  closeDetailDrawer: () => void;
  openOwnerPanel: (ownerId: string) => void;
  closeOwnerPanel: () => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: 10 | 20 | 50) => void;
}

// ============================================================================
// Mock Data (for development)
// ============================================================================

const mockAssets: AssetListItem[] = [
  {
    id: "bot_001",
    name: "Customer Support Bot",
    type: "bot",
    status: "active",
    position: "Support Team",
    owner: "Alice Johnson",
    metrics: {
      taskCount: 1250,
      successRate: 0.98,
      avgLatency: 850,
      totalCost: 32.5,
    },
    riskLevel: "low",
    activeAnomalyCount: 0,
  },
  {
    id: "bot_002",
    name: "Sales Assistant",
    type: "bot",
    status: "active",
    position: "Sales Team",
    owner: "Bob Smith",
    metrics: {
      taskCount: 890,
      successRate: 0.92,
      avgLatency: 1200,
      totalCost: 28.3,
    },
    riskLevel: "medium",
    activeAnomalyCount: 1,
  },
  {
    id: "group_001",
    name: "Marketing Collaboration Group",
    type: "group",
    status: "active",
    position: "Marketing",
    owner: "Carol White",
    metrics: {
      taskCount: 450,
      successRate: 0.95,
      avgLatency: 1500,
      totalCost: 15.2,
    },
    riskLevel: "low",
    activeAnomalyCount: 0,
  },
  {
    id: "bot_003",
    name: "Data Processing Bot",
    type: "bot",
    status: "paused",
    position: "Engineering",
    owner: "David Lee",
    metrics: {
      taskCount: 2100,
      successRate: 0.65,
      avgLatency: 3200,
      totalCost: 45.8,
    },
    riskLevel: "high",
    activeAnomalyCount: 3,
  },
];

const mockAnomalies: Anomaly[] = [
  {
    id: "anomaly_001",
    assetId: "bot_002",
    assetName: "Sales Assistant",
    assetType: "bot",
    type: "cost_spike",
    severity: "medium",
    description: "Cost increased by 35% compared to yesterday",
    detectedAt: "2026-05-30T08:30:00Z",
    status: "pending",
  },
  {
    id: "anomaly_002",
    assetId: "bot_003",
    assetName: "Data Processing Bot",
    assetType: "bot",
    type: "high_failure",
    severity: "high",
    description: "Failure rate is 35% (35/100 tasks)",
    detectedAt: "2026-05-30T09:15:00Z",
    status: "pending",
  },
  {
    id: "anomaly_003",
    assetId: "bot_003",
    assetName: "Data Processing Bot",
    assetType: "bot",
    type: "high_latency",
    severity: "high",
    description: "Average latency is 3200ms, exceeding threshold",
    detectedAt: "2026-05-30T10:00:00Z",
    status: "pending",
  },
];

const mockDashboardStats: DashboardStats = {
  summary: {
    totalAssets: 42,
    activeAssets: 38,
    pausedAssets: 3,
    errorAssets: 1,
  },
  metrics: {
    totalTasksToday: 4560,
    totalCostToday: 125.8,
    avgSuccessRate: 0.94,
    totalAnomalies: 5,
    pendingAnomalies: 3,
  },
  riskDistribution: {
    low: 35,
    medium: 5,
    high: 2,
  },
  recentAnomalies: mockAnomalies.slice(0, 3),
};

// ============================================================================
// Store Creation
// ============================================================================

export const useGovernanceStore = create<GovernanceStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ----------------------------------------------------------------------
      // Data Fetching
      // ----------------------------------------------------------------------

      fetchAssets: async () => {
        set({ isLoadingAssets: true, assetError: null });

        try {
          // Simulate API call
          await new Promise((resolve) => setTimeout(resolve, 200));

          const { assetFilters, assetPagination, assetSort } = get();

          // Filter mock data
          let filtered = [...mockAssets];

          if (assetFilters.type) {
            filtered = filtered.filter((a) => a.type === assetFilters.type);
          }

          if (assetFilters.status) {
            filtered = filtered.filter((a) => a.status === assetFilters.status);
          }

          if (assetFilters.riskLevel) {
            filtered = filtered.filter((a) => a.riskLevel === assetFilters.riskLevel);
          }

          if (assetFilters.search) {
            const query = assetFilters.search.toLowerCase();
            filtered = filtered.filter(
              (a) =>
                a.name.toLowerCase().includes(query) ||
                (a.position?.toLowerCase().includes(query) ?? false) ||
                (a.owner?.toLowerCase().includes(query) ?? false),
            );
          }

          // Sort
          filtered.sort((a, b) => {
            let comparison = 0;
            switch (assetSort.field) {
              case "name":
                comparison = a.name.localeCompare(b.name);
                break;
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
            return assetSort.direction === "desc" ? -comparison : comparison;
          });

          // Paginate
          const total = filtered.length;
          const totalPages = Math.ceil(total / assetPagination.pageSize);
          const offset = (assetPagination.page - 1) * assetPagination.pageSize;
          const paginatedAssets = filtered.slice(offset, offset + assetPagination.pageSize);

          set({
            assets: paginatedAssets,
            assetPagination: {
              ...assetPagination,
              total,
              totalPages,
            },
            isLoadingAssets: false,
          });
        } catch (error) {
          set({
            assetError: error instanceof Error ? error.message : "Failed to fetch assets",
            isLoadingAssets: false,
          });
        }
      },

      fetchAnomalies: async () => {
        set({ isLoadingAnomalies: true, anomalyError: null });

        try {
          await new Promise((resolve) => setTimeout(resolve, 150));

          const { anomalyFilters } = get();
          let filtered = [...mockAnomalies];

          if (anomalyFilters.severity) {
            filtered = filtered.filter((a) => a.severity === anomalyFilters.severity);
          }

          if (anomalyFilters.status) {
            filtered = filtered.filter((a) => a.status === anomalyFilters.status);
          }

          if (anomalyFilters.assetId) {
            filtered = filtered.filter((a) => a.assetId === anomalyFilters.assetId);
          }

          if (anomalyFilters.type) {
            filtered = filtered.filter((a) => a.type === anomalyFilters.type);
          }

          set({
            anomalies: filtered,
            isLoadingAnomalies: false,
          });
        } catch (error) {
          set({
            anomalyError: error instanceof Error ? error.message : "Failed to fetch anomalies",
            isLoadingAnomalies: false,
          });
        }
      },

      fetchAssetDetail: async (assetId: string) => {
        set({ isLoadingDetail: true, detailError: null });

        try {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const asset = mockAssets.find((a) => a.id === assetId);
          if (!asset) {
            throw new Error("Asset not found");
          }

          // Mock detail data
          const detail: AssetDetail = {
            asset: {
              ...asset,
              position: asset.position ? { id: "pos_001", title: asset.position } : null,
              owner: asset.owner
                ? {
                    id: "user_001",
                    name: asset.owner,
                    email: `${asset.owner.toLowerCase().replace(/\s+/g, ".")}@company.com`,
                  }
                : null,
              runtime: { id: asset.id.replace("_", "_rt_"), status: asset.status },
              createdAt: "2026-01-15T10:00:00Z",
              updatedAt: "2026-05-30T08:00:00Z",
            },
            metrics: {
              ...asset.metrics,
              avgCostPerTask: asset.metrics.totalCost / (asset.metrics.taskCount || 1),
              errorCount: asset.activeAnomalyCount * 2,
            },
            dailyMetrics: [
              {
                date: "2026-05-28",
                taskCount: 400,
                successRate: 0.96,
                avgLatencyMs: 900,
                totalCost: 10.5,
                costGrowthRate: 0.05,
              },
              {
                date: "2026-05-29",
                taskCount: 420,
                successRate: 0.95,
                avgLatencyMs: 920,
                totalCost: 11.2,
                costGrowthRate: 0.07,
              },
              {
                date: "2026-05-30",
                taskCount: 430,
                successRate: 0.92,
                avgLatencyMs: 1200,
                totalCost: 12.8,
                costGrowthRate: 0.14,
              },
            ],
            recentRuns: [
              {
                id: "run_001",
                taskId: "task_1234",
                startTime: "2026-05-30T10:00:00Z",
                endTime: "2026-05-30T10:00:05Z",
                durationMs: 5000,
                status: "success",
                errorCode: null,
                tokensInput: 150,
                tokensOutput: 80,
                cost: 0.02,
              },
              {
                id: "run_002",
                taskId: "task_1235",
                startTime: "2026-05-30T10:05:00Z",
                endTime: "2026-05-30T10:05:03Z",
                durationMs: 3000,
                status: "success",
                errorCode: null,
                tokensInput: 120,
                tokensOutput: 60,
                cost: 0.015,
              },
            ],
            activeAnomalies: mockAnomalies
              .filter((a) => a.assetId === assetId && a.status === "pending")
              .map((a) => ({
                id: a.id,
                type: a.type,
                severity: a.severity,
                description: a.description,
                detectedAt: a.detectedAt,
                status: a.status,
              })),
            riskLevel: asset.riskLevel,
            riskFactors: asset.riskLevel === "high" ? ["high failure rate", "cost spike"] : [],
          };

          set({
            assetDetail: detail,
            isLoadingDetail: false,
          });
        } catch (error) {
          set({
            detailError: error instanceof Error ? error.message : "Failed to fetch asset detail",
            isLoadingDetail: false,
          });
        }
      },

      executeAction: async (assetId: string, action: GovernanceActionType, reason?: string) => {
        set({ isExecutingAction: true });

        try {
          await new Promise((resolve) => setTimeout(resolve, 500));

          const result: GovernanceActionResult = {
            success: true,
            action,
            appliedAt: new Date().toISOString(),
            message: `Asset ${assetId} ${action}d successfully${reason ? `: ${reason}` : ""}`,
          };

          set({
            isExecutingAction: false,
            lastActionResult: result,
          });

          // Refresh asset list
          await get().fetchAssets();
        } catch (error) {
          set({
            isExecutingAction: false,
            lastActionResult: {
              success: false,
              action,
              appliedAt: new Date().toISOString(),
              message: error instanceof Error ? error.message : "Action failed",
            },
          });
        }
      },

      fetchDashboardStats: async () => {
        set({ isLoadingStats: true });

        try {
          await new Promise((resolve) => setTimeout(resolve, 150));

          set({
            dashboardStats: mockDashboardStats,
            isLoadingStats: false,
          });
        } catch {
          set({ isLoadingStats: false });
        }
      },

      // ----------------------------------------------------------------------
      // UI Actions
      // ----------------------------------------------------------------------

      setAssetFilters: (filters: AssetFilters) => {
        set({
          assetFilters: filters,
          assetPagination: { ...initialPagination },
        });
        void get().fetchAssets();
      },

      setAssetSort: (sort: AssetSortConfig) => {
        set({ assetSort: sort });
        void get().fetchAssets();
      },

      setAnomalyFilters: (filters: AnomalyFilters) => {
        set({ anomalyFilters: filters });
        void get().fetchAnomalies();
      },

      selectAsset: (assetId: string) => {
        set({ selectedAssetId: assetId });
      },

      clearSelectedAsset: () => {
        set({ selectedAssetId: null, assetDetail: null });
      },

      openDetailDrawer: (assetId: string) => {
        set({
          selectedAssetId: assetId,
          isDetailDrawerOpen: true,
        });
        void get().fetchAssetDetail(assetId);
      },

      closeDetailDrawer: () => {
        set({
          isDetailDrawerOpen: false,
          assetDetail: null,
          selectedAssetId: null,
        });
      },

      openOwnerPanel: (ownerId: string) => {
        set({
          selectedOwnerId: ownerId,
          isOwnerPanelOpen: true,
        });
      },

      closeOwnerPanel: () => {
        set({
          isOwnerPanelOpen: false,
          selectedOwnerId: null,
        });
      },

      setPage: (page: number) => {
        const { assetPagination } = get();
        set({
          assetPagination: {
            ...assetPagination,
            page: Math.max(1, Math.min(page, assetPagination.totalPages || 1)),
          },
        });
        void get().fetchAssets();
      },

      setPageSize: (pageSize: 10 | 20 | 50) => {
        set({
          assetPagination: {
            ...initialPagination,
            pageSize,
          },
        });
        void get().fetchAssets();
      },
    }),
    {
      name: "governance-store",
    },
  ),
);

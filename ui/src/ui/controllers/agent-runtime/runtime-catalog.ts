/**
 * Agent Runtime Center — Runtime Catalog Controller。
 *
 * 状态管理：纯函数 mutation + 可变 state 对象 + async 数据加载方法
 * （与 enterprise-asset-library / employee-capability 控制器风格对齐）。
 *
 * 行为要点：
 * - 任何会改变结果集语义的状态变更（filters / search）只更新 state；
 *   调用方负责在变更后调用 `loadCatalog` 进行一次网络请求，便于多次 mutation
 *   合并发起。
 * - 加载失败时保留 `agents` 与 `bindings` 列表，避免错误抹除已显示的视图。
 * - `selectedAgentId` 控制详情面板的当前选中项；为 null 表示无展开行。
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7
 */

import type {
  AgentRuntimeGateway,
  GetAgentResponse,
  ListAgentsResponse,
  ListBindingsResponse,
} from "../../capability/agent-runtime/index.ts";
import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeHealth,
  RuntimeLifecycle,
} from "../../capability/runtime-canonical/index.ts";

export type RuntimeCatalogState = {
  gateway: AgentRuntimeGateway | null;
  loading: boolean;
  error: string | null;
  agents: RuntimeAgent[];
  bindings: RuntimeCapabilityBinding[];
  filters: {
    lifecycle: RuntimeLifecycle | null;
    health: RuntimeHealth | null;
    tenantId: string | null;
    searchQuery: string;
  };
  /** 当前展开的 Agent 详情；为 null 表示无展开行。 */
  selectedAgentId: string | null;
  /** 与 `selectedAgentId` 配对的详情数据缓存。 */
  selectedDetail: GetAgentResponse | null;
  selectedDetailLoading: boolean;
};

export function createInitialRuntimeCatalogState(): RuntimeCatalogState {
  return {
    gateway: null,
    loading: false,
    error: null,
    agents: [],
    bindings: [],
    filters: { lifecycle: null, health: null, tenantId: null, searchQuery: "" },
    selectedAgentId: null,
    selectedDetail: null,
    selectedDetailLoading: false,
  };
}

/** 加载 Agent 列表 + 全量绑定。绑定用于派生 KPI 与 Bindings 标签页。 */
export async function loadCatalog(state: RuntimeCatalogState): Promise<void> {
  if (state.gateway === null) {
    state.error = "尚未连接到 Gateway";
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const [agentsResp, bindingsResp]: [ListAgentsResponse, ListBindingsResponse] =
      await Promise.all([
        state.gateway.listAgents({
          lifecycle: state.filters.lifecycle,
          health: state.filters.health,
          tenantId: state.filters.tenantId,
          searchQuery: state.filters.searchQuery,
        }),
        state.gateway.listBindings({
          runtimeAgentId: null,
          capabilityId: null,
          bindingType: null,
          bindingState: null,
          health: null,
        }),
      ]);
    state.agents = agentsResp.agents;
    state.bindings = bindingsResp.bindings;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载 Runtime Catalog 失败";
  } finally {
    state.loading = false;
  }
}

/** 切换筛选项；不立即触发请求，由调用方决定何时 `loadCatalog`。 */
export function updateLifecycleFilter(
  state: RuntimeCatalogState,
  value: RuntimeLifecycle | null,
): void {
  state.filters.lifecycle = value;
}

export function updateHealthFilter(state: RuntimeCatalogState, value: RuntimeHealth | null): void {
  state.filters.health = value;
}

export function updateTenantFilter(state: RuntimeCatalogState, value: string | null): void {
  state.filters.tenantId = value;
}

export function updateSearchQuery(state: RuntimeCatalogState, query: string): void {
  state.filters.searchQuery = query;
}

/** 重置筛选器：恢复初始空状态。 */
export function resetCatalogFilters(state: RuntimeCatalogState): void {
  state.filters = { lifecycle: null, health: null, tenantId: null, searchQuery: "" };
}

/** 选中 / 展开某个 Agent 行；同时拉取详情。 */
export async function selectAgent(
  state: RuntimeCatalogState,
  runtimeAgentId: string | null,
): Promise<void> {
  state.selectedAgentId = runtimeAgentId;
  if (runtimeAgentId === null) {
    state.selectedDetail = null;
    return;
  }
  if (state.gateway === null) {
    return;
  }
  state.selectedDetailLoading = true;
  try {
    state.selectedDetail = await state.gateway.getAgent({ runtimeAgentId });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载 Agent 详情失败";
    state.selectedDetail = null;
  } finally {
    state.selectedDetailLoading = false;
  }
}

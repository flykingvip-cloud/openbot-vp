/**
 * Agent Runtime Center — Capability Bindings Controller。
 *
 * 实现 Task 16（State / Priority / Strategy 编辑）与 Task 17（详情视图）。
 *
 * 操作策略：
 * - 修改 BindingState（active ↔ disabled）：调用 `agent-runtime.update-binding-state`，
 *   服务端成功后立即用响应中的最新 binding 替换本地缓存。
 * - 修改 RoutingPriority：先做参数 sanity check（数值有限、非负），再 RPC。
 * - 修改 LoadStrategy：RPC 后替换缓存。
 * - 详情视图：通过 `agent-runtime.get-binding` 同时拉取 agent / capability 名称。
 * - 操作日志：每次成功的 mutation 在 `auditLog` 数组前部追加一条记录，便于
 *   UI 顶部"最近操作"展示，最多保留 50 条以避免无限增长。
 */

import type {
  AgentRuntimeGateway,
  GetBindingResponse,
} from "../../capability/agent-runtime/index.ts";
import type {
  BindingState,
  BindingType,
  LoadStrategy,
  RuntimeCapabilityBinding,
  RuntimeHealth,
} from "../../capability/runtime-canonical/index.ts";

export type BindingAuditEntry = {
  id: string;
  bindingId: string;
  /** 业务无关的 Runtime 操作类型描述（运维语言）。 */
  action: "state-change" | "priority-change" | "strategy-change" | "delete" | "create";
  /** 操作前的简洁快照；用于撤销提示与审计回溯。 */
  before: string;
  /** 操作后的简洁快照。 */
  after: string;
  timestamp: number;
};

const AUDIT_LOG_LIMIT = 50;

export type CapabilityBindingsState = {
  gateway: AgentRuntimeGateway | null;
  loading: boolean;
  error: string | null;
  bindings: RuntimeCapabilityBinding[];
  filters: {
    runtimeAgentId: string | null;
    capabilityId: string | null;
    bindingType: BindingType | null;
    bindingState: BindingState | null;
    health: RuntimeHealth | null;
  };
  /** 当前进行中操作的 bindingId，避免双击导致重复请求。 */
  busyBindingId: string | null;
  /** 详情面板：选中 binding + 关联名称（同时缓存）。 */
  selectedDetail: GetBindingResponse | null;
  selectedDetailLoading: boolean;
  /** 最近操作日志（最多 AUDIT_LOG_LIMIT 条）。 */
  auditLog: BindingAuditEntry[];
};

export function createInitialBindingsState(): CapabilityBindingsState {
  return {
    gateway: null,
    loading: false,
    error: null,
    bindings: [],
    filters: {
      runtimeAgentId: null,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    },
    busyBindingId: null,
    selectedDetail: null,
    selectedDetailLoading: false,
    auditLog: [],
  };
}

export async function loadBindings(state: CapabilityBindingsState): Promise<void> {
  if (state.gateway === null) {
    state.error = "尚未连接到 Gateway";
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const resp = await state.gateway.listBindings(state.filters);
    state.bindings = resp.bindings;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载 Bindings 失败";
  } finally {
    state.loading = false;
  }
}

export function updateBindingsFilter<K extends keyof CapabilityBindingsState["filters"]>(
  state: CapabilityBindingsState,
  key: K,
  value: CapabilityBindingsState["filters"][K],
): void {
  state.filters[key] = value;
}

export function resetBindingsFilters(state: CapabilityBindingsState): void {
  state.filters = {
    runtimeAgentId: null,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Mutations（Task 16）
// ─────────────────────────────────────────────────────────────────────────

function makeAuditId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushAudit(state: CapabilityBindingsState, entry: BindingAuditEntry): void {
  state.auditLog = [entry, ...state.auditLog].slice(0, AUDIT_LOG_LIMIT);
}

function replaceBindingInCache(
  state: CapabilityBindingsState,
  next: RuntimeCapabilityBinding,
): void {
  const idx = state.bindings.findIndex((b) => b.bindingId === next.bindingId);
  if (idx >= 0) {
    state.bindings = [...state.bindings.slice(0, idx), next, ...state.bindings.slice(idx + 1)];
  } else {
    state.bindings = [...state.bindings, next];
  }
  if (state.selectedDetail?.binding.bindingId === next.bindingId) {
    state.selectedDetail = { ...state.selectedDetail, binding: next };
  }
}

/** 切换 BindingState（典型 active ↔ disabled）。 */
export async function changeBindingState(
  state: CapabilityBindingsState,
  bindingId: string,
  nextState: BindingState,
): Promise<void> {
  if (state.gateway === null || state.busyBindingId === bindingId) {
    return;
  }
  const before = state.bindings.find((b) => b.bindingId === bindingId);
  if (!before) {
    return;
  }
  state.busyBindingId = bindingId;
  state.error = null;
  try {
    const resp = await state.gateway.updateBindingState({ bindingId, bindingState: nextState });
    replaceBindingInCache(state, resp.binding);
    pushAudit(state, {
      id: makeAuditId(),
      bindingId,
      action: "state-change",
      before: `state=${before.bindingState}`,
      after: `state=${resp.binding.bindingState}`,
      timestamp: Date.now(),
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "切换 Binding 状态失败";
  } finally {
    state.busyBindingId = null;
  }
}

/** 修改路由优先级。 */
export async function changeBindingPriority(
  state: CapabilityBindingsState,
  bindingId: string,
  routingPriority: number,
): Promise<void> {
  if (state.gateway === null || state.busyBindingId === bindingId) {
    return;
  }
  if (!Number.isFinite(routingPriority) || routingPriority < 0) {
    state.error = "RoutingPriority 必须是非负有限数";
    return;
  }
  const before = state.bindings.find((b) => b.bindingId === bindingId);
  if (!before) {
    return;
  }
  state.busyBindingId = bindingId;
  state.error = null;
  try {
    const resp = await state.gateway.updateBindingPriority({ bindingId, routingPriority });
    replaceBindingInCache(state, resp.binding);
    pushAudit(state, {
      id: makeAuditId(),
      bindingId,
      action: "priority-change",
      before: `priority=${before.routingPriority}`,
      after: `priority=${resp.binding.routingPriority}`,
      timestamp: Date.now(),
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "修改优先级失败";
  } finally {
    state.busyBindingId = null;
  }
}

/** 修改加载策略。 */
export async function changeBindingStrategy(
  state: CapabilityBindingsState,
  bindingId: string,
  loadStrategy: LoadStrategy,
): Promise<void> {
  if (state.gateway === null || state.busyBindingId === bindingId) {
    return;
  }
  const before = state.bindings.find((b) => b.bindingId === bindingId);
  if (!before) {
    return;
  }
  state.busyBindingId = bindingId;
  state.error = null;
  try {
    const resp = await state.gateway.updateBindingStrategy({ bindingId, loadStrategy });
    replaceBindingInCache(state, resp.binding);
    pushAudit(state, {
      id: makeAuditId(),
      bindingId,
      action: "strategy-change",
      before: `strategy=${before.loadStrategy}`,
      after: `strategy=${resp.binding.loadStrategy}`,
      timestamp: Date.now(),
    });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "修改加载策略失败";
  } finally {
    state.busyBindingId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Detail（Task 17）
// ─────────────────────────────────────────────────────────────────────────

export async function selectBindingDetail(
  state: CapabilityBindingsState,
  bindingId: string | null,
): Promise<void> {
  if (bindingId === null) {
    state.selectedDetail = null;
    return;
  }
  if (state.gateway === null) {
    return;
  }
  state.selectedDetailLoading = true;
  try {
    state.selectedDetail = await state.gateway.getBinding({ bindingId });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载 Binding 详情失败";
    state.selectedDetail = null;
  } finally {
    state.selectedDetailLoading = false;
  }
}

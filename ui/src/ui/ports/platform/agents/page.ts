/**
 * Platform Agent Runtime Center — 主页面渲染入口。
 *
 * 该页面是平台运行时层（Platform Runtime Layer）的运维总台，与企业端（业务
 * 治理）、员工端（个人体验）三层严格分离：本页面仅服务平台运维角色，使用
 * Runtime 术语（Agent Runtime / Capability Binding / Runtime Health 等），
 * **禁止**出现业务字段（贡献绩效、企业价值、复用价值评分）或员工语言
 * （我的能力、机器人会做什么）。
 *
 * 5 标签页结构（详见 design.md）：
 *   1. Runtime Catalog        — Agent Runtime 实例目录
 *   2. Capability Bindings    — 运行时能力绑定矩阵
 *   3. Runtime Health         — 健康状态全景
 *   4. Deployment Lifecycle   — 部署生命周期治理
 *   5. Governance & Policy    — 7 类运行时治理问题
 *
 * 数据来源：
 * - 默认从 readModel.agentDirectory + presenceCount 派生 RuntimeAgent 占位数据
 *   （未接通真实遥测前的退化路径）。
 * - 待 agent-runtime gateway 接通后，将由全局 readModel 携带 runtimeAgents /
 *   runtimeBindings / runtimeKpi 等字段直接填充。
 */

import { html, nothing } from "lit";
import { detectGovernanceIssues } from "../../../capability/runtime-canonical/governance-detector.ts";
import {
  type BindingState,
  type BindingType,
  type LoadStrategy,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
  type RuntimeGovernanceIssue,
  type RuntimeGovernanceIssueCategory,
  type RuntimeHealth,
  type RuntimeLifecycle,
  type RuntimeTelemetry,
} from "../../../capability/runtime-canonical/index.ts";
import { isTerminalLifecycle } from "../../../capability/runtime-canonical/lifecycle-state-machine.ts";
import { renderIcon, type IconName } from "../../../icons.ts";
import { normalizeAppHistoryHref } from "../../../request-app-rerender.ts";
import { isPlatformShellPending, renderPlatformSummaryPending } from "../shared/summary-pending.ts";
import { requestPlatformSurfaceRerender, type PlatformSurfaceProps } from "../shared/surface.ts";
import {
  batchSetStateBody,
  batchSetStrategyBody,
  batchUpgradeBody,
  BINDING_UPGRADE_EMPTY_CATALOG,
  describeBindingBatch,
  requestBindingBatch,
  requestCapabilityVersionCatalog,
  upgradeVersionChoices,
  type CapabilityVersionCatalogEntry,
} from "./binding-batch.ts";
import {
  canMutateRuntimeBindings,
  demoteBindingMutation,
  disableBindingMutation,
  enableBindingMutation,
  promoteBindingMutation,
  requestBindingRowMutation,
  strategyBindingMutation,
  type BindingRowMutation,
} from "./binding-row-mutations.ts";
import { renderTelemetryMiniChart } from "./components/TelemetryMiniChart.ts";
import {
  describeGovernanceFix,
  GOVERNANCE_FIX_METHOD,
  LOW_SUCCESS_FIX_DEFER_REASON,
  requestGovernanceFix,
} from "./governance-fix.ts";
import {
  CONFLICT_LABELS,
  formatFallbackMode,
  formatPerCapabilityQps,
  formatPerTenantDailyCap,
  loadStrategyLabel,
  requestRuntimePolicyGet,
  requestRuntimePolicyUpdate,
  RUNTIME_POLICY_RATE_UNIT_COPY,
  UNCONFIGURED_RUNTIME_POLICY,
  type RuntimePolicyConflict,
  type RuntimePolicyDocument,
  type RuntimePolicyFallbackMode,
} from "./runtime-policy.ts";

// ─────────────────────────────────────────────────────────────────────────
// 标签页定义与 Hash 路由
// ─────────────────────────────────────────────────────────────────────────

type AgentRuntimeTab = "catalog" | "bindings" | "policy" | "health" | "lifecycle";
type SortDirection = "asc" | "desc";
type RuntimeSortState<Key extends string> = { field: Key; direction: SortDirection };
type RuntimeCatalogSortKey =
  | "agent"
  | "lifecycle"
  | "health"
  | "bindings"
  | "tenants"
  | "sessions"
  | "resources"
  | "lastActive";
type RuntimeBindingSortKey =
  | "agent"
  | "capability"
  | "type"
  | "state"
  | "health"
  | "strategy"
  | "priority"
  | "calls7d"
  | "successRate"
  | "avgLatency";
type BindingViewMode = "byAgent" | "byCapability";

const AGENT_RUNTIME_TABS: ReadonlyArray<{ id: AgentRuntimeTab; label: string; sub: string }> = [
  { id: "catalog", label: "运行目录", sub: "机器人实例、版本与活跃状态" },
  { id: "bindings", label: "能力绑定", sub: "装载来源、策略与调用质量" },
  { id: "policy", label: "策略中心", sub: "加载、冲突、降级与限流策略" },
  { id: "health", label: "健康状态", sub: "成功率与延迟趋势、异常能力" },
  { id: "lifecycle", label: "生命周期", sub: "部署、排空、暂停与归档" },
];

const RUNTIME_HASH_PREFIX = "#agent-runtime:";
const RUNTIME_CATALOG_SORT_KEYS: ReadonlySet<RuntimeCatalogSortKey> = new Set([
  "agent",
  "lifecycle",
  "health",
  "bindings",
  "tenants",
  "sessions",
  "resources",
  "lastActive",
]);

const DEFAULT_CATALOG_SORT: RuntimeSortState<RuntimeCatalogSortKey> = {
  field: "lastActive",
  direction: "desc",
};

const CATALOG_SORT_DEFAULT_DIRECTIONS: Record<RuntimeCatalogSortKey, SortDirection> = {
  agent: "asc",
  lifecycle: "desc",
  health: "desc",
  bindings: "desc",
  tenants: "desc",
  sessions: "desc",
  resources: "desc",
  lastActive: "desc",
};

let activeTab: AgentRuntimeTab = "catalog";

// Module-level state for the bindings dual-view (按代理 / 按能力).
// Filter / search / view-mode are local to this in-memory page state — they
// persist across re-renders but reset when the page module is reloaded.
let bindingViewMode: BindingViewMode = "byAgent";
let bindingSearchQuery = "";
let bindingFilterSourceType: BindingType | "all" = "all";
let bindingFilterState: BindingState | "all" = "all";
let bindingFilterHealth: RuntimeHealth | "all" = "all";
let bindingFilterStrategy: LoadStrategy | "all" = "all";
let bindingFilterTenant: string = "all";
// Groups default to expanded; track only the explicitly collapsed ones.
const collapsedBindingGroups = new Set<string>();
const selectedBindingIds = new Set<string>();
// Bindings whose detail strip is expanded inline.
const expandedBindingDetailIds = new Set<string>();

type BindingMutationHost = {
  scopes: readonly string[] | null;
  connected: boolean;
  request: (<T>(method: string, params: unknown) => Promise<T>) | null;
  refresh: () => unknown;
};

let bindingMutationHost: BindingMutationHost = {
  scopes: null,
  connected: false,
  request: null,
  refresh: () => undefined,
};
let bindingMutationBusyId: string | null = null;
let bindingMutationNotice: string | null = null;
let bindingBulkStrategy: LoadStrategy | "" = "";
let bindingUpgradeVersion = "";
let capabilityVersionCatalog: CapabilityVersionCatalogEntry[] = [];
let capabilityVersionLoadState: "idle" | "loading" | "ready" | "error" = "idle";
let capabilityVersionLoadError: string | null = null;
let policyDocument: RuntimePolicyDocument | null = null;
let policyLoadState: "idle" | "loading" | "ready" | "error" = "idle";
let policyLoadError: string | null = null;
let policyEditing = false;
let policyDraft: RuntimePolicyDocument | null = null;
let policyNotice: string | null = null;
let policyBusy = false;
let governanceFixNotice: string | null = null;
let governanceFixBusy = false;

export function resetPlatformAgentsBindingUiForTest(): void {
  bindingViewMode = "byAgent";
  bindingSearchQuery = "";
  bindingFilterSourceType = "all";
  bindingFilterState = "all";
  bindingFilterHealth = "all";
  bindingFilterStrategy = "all";
  bindingFilterTenant = "all";
  collapsedBindingGroups.clear();
  selectedBindingIds.clear();
  expandedBindingDetailIds.clear();
  bindingMutationBusyId = null;
  bindingMutationNotice = null;
  bindingBulkStrategy = "";
  bindingUpgradeVersion = "";
  capabilityVersionCatalog = [];
  capabilityVersionLoadState = "idle";
  capabilityVersionLoadError = null;
  policyDocument = null;
  policyLoadState = "idle";
  policyLoadError = null;
  policyEditing = false;
  policyDraft = null;
  policyNotice = null;
  policyBusy = false;
  governanceFixNotice = null;
  governanceFixBusy = false;
  bindingMutationHost = {
    scopes: null,
    connected: false,
    request: null,
    refresh: () => undefined,
  };
}

function bindingMutationGate() {
  return canMutateRuntimeBindings({
    scopes: bindingMutationHost.scopes,
    clientConnected: bindingMutationHost.connected && bindingMutationHost.request !== null,
  });
}

function mutationButtonState(eligible: boolean, ineligibleTitle: string, readyTitle: string) {
  if (bindingMutationBusyId) {
    return { disabled: true, title: "绑定变更正在提交" };
  }
  const gate = bindingMutationGate();
  if (!gate.allowed) {
    return { disabled: true, title: gate.reason };
  }
  if (!eligible) {
    return { disabled: true, title: ineligibleTitle };
  }
  return { disabled: false, title: readyTitle };
}

async function commitBindingRowMutation(mutation: BindingRowMutation): Promise<void> {
  const gate = bindingMutationGate();
  if (!gate.allowed || bindingMutationBusyId) {
    bindingMutationNotice = bindingMutationBusyId ? "绑定变更正在提交" : gate.reason;
    requestRerender();
    return;
  }
  if (typeof window === "undefined" || !window.confirm(mutation.confirm)) {
    requestRerender();
    return;
  }
  const request = bindingMutationHost.request;
  if (!request) {
    bindingMutationNotice = "网关未连接，绑定变更不可执行";
    requestRerender();
    return;
  }
  bindingMutationBusyId = mutation.bindingId;
  bindingMutationNotice = null;
  requestRerender();
  const result = await requestBindingRowMutation(request, mutation);
  if (!result.ok) {
    bindingMutationBusyId = null;
    bindingMutationNotice = result.error;
    requestRerender();
    return;
  }
  try {
    await bindingMutationHost.refresh();
    bindingMutationNotice = `网关已接受绑定 ${mutation.bindingId} 的变更。`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "重新加载失败";
    bindingMutationNotice = `网关已接受绑定 ${mutation.bindingId} 的变更，但重新加载失败：${message}`;
  } finally {
    bindingMutationBusyId = null;
    requestRerender();
  }
}

function maybeLoadCapabilityVersions(): void {
  if (capabilityVersionLoadState !== "idle") {
    return;
  }
  const request = bindingMutationHost.request;
  if (!bindingMutationHost.connected || !request) {
    return;
  }
  capabilityVersionLoadState = "loading";
  void requestCapabilityVersionCatalog(request).then((result) => {
    if (!result.ok) {
      capabilityVersionLoadState = "error";
      capabilityVersionLoadError = result.error;
      capabilityVersionCatalog = [];
    } else {
      capabilityVersionLoadState = "ready";
      capabilityVersionLoadError = null;
      capabilityVersionCatalog = result.entries;
    }
    requestRerender();
  });
}

async function commitBindingBatch(
  kind: "active" | "disabled" | "strategy" | "upgrade",
): Promise<void> {
  const gate = bindingMutationGate();
  const bindingIds = [...selectedBindingIds];
  if (!gate.allowed || bindingMutationBusyId || bindingIds.length === 0) {
    bindingMutationNotice = bindingMutationBusyId
      ? "绑定变更正在提交"
      : gate.reason || "请先选择绑定";
    requestRerender();
    return;
  }
  const planned =
    kind === "strategy"
      ? bindingBulkStrategy
        ? batchSetStrategyBody(bindingIds, bindingBulkStrategy)
        : null
      : kind === "upgrade"
        ? bindingUpgradeVersion
          ? batchUpgradeBody(bindingIds, bindingUpgradeVersion)
          : null
        : batchSetStateBody(bindingIds, kind);
  if (!planned) {
    bindingMutationNotice =
      kind === "upgrade" ? "请选择目录中的目标版本" : "请选择要批量设置的加载策略";
    requestRerender();
    return;
  }
  const confirmText = `确认对 ${bindingIds.length} 条绑定调用 ${planned.method}？部分失败会在 applied / rejected 中返回，不会逐条调用单条 RPC。`;
  if (typeof window === "undefined" || !window.confirm(confirmText)) {
    requestRerender();
    return;
  }
  const request = bindingMutationHost.request;
  if (!request) {
    bindingMutationNotice = "网关未连接，绑定变更不可执行";
    requestRerender();
    return;
  }
  bindingMutationBusyId = "batch";
  bindingMutationNotice = null;
  requestRerender();
  const result = await requestBindingBatch({
    request,
    method: planned.method,
    bindingIds,
    expect: planned.expect,
    body: planned.body,
  });
  bindingMutationBusyId = null;
  if (!result.ok) {
    bindingMutationNotice = result.error;
    requestRerender();
    return;
  }
  bindingMutationNotice = describeBindingBatch(result);
  if (result.applied.length > 0) {
    try {
      await bindingMutationHost.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "重新加载失败";
      bindingMutationNotice = `${describeBindingBatch(result)}重新加载失败：${message}`;
    }
  }
  requestRerender();
}

async function commitGovernanceFix(
  category: "capability-conflict" | "zombie-binding",
): Promise<void> {
  const gate = bindingMutationGate();
  if (!gate.allowed || governanceFixBusy) {
    governanceFixNotice = governanceFixBusy ? "一键修复正在提交" : gate.reason;
    requestRerender();
    return;
  }
  const confirmText = `确认调用 ${GOVERNANCE_FIX_METHOD} 修复「${category}」？dryRun 为 false。网关决定修哪些绑定，不会逐条调用 update-binding-state。`;
  if (typeof window === "undefined" || !window.confirm(confirmText)) {
    requestRerender();
    return;
  }
  const request = bindingMutationHost.request;
  if (!request) {
    governanceFixNotice = "网关未连接，一键修复不可执行";
    requestRerender();
    return;
  }
  governanceFixBusy = true;
  governanceFixNotice = null;
  requestRerender();
  const result = await requestGovernanceFix(request, { category, dryRun: false });
  governanceFixBusy = false;
  if (!result.ok) {
    governanceFixNotice = result.error;
    requestRerender();
    return;
  }
  governanceFixNotice = describeGovernanceFix(result);
  if (result.applied.length > 0) {
    try {
      await bindingMutationHost.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "重新加载失败";
      governanceFixNotice = `${describeGovernanceFix(result)}重新加载失败：${message}`;
    }
  }
  requestRerender();
}

function ensurePolicyDraft(): RuntimePolicyDocument {
  const source = policyDraft ?? policyDocument ?? UNCONFIGURED_RUNTIME_POLICY;
  return {
    loadDefaults: source.loadDefaults
      ? {
          default: source.loadDefaults.default,
          byCapabilityKind: { ...source.loadDefaults.byCapabilityKind },
        }
      : { default: null, byCapabilityKind: {} },
    conflict: source.conflict,
    fallback: { mode: source.fallback.mode },
    rateLimit: source.rateLimit
      ? {
          perCapabilityQps: source.rateLimit.perCapabilityQps,
          perTenantDailyCap: source.rateLimit.perTenantDailyCap,
        }
      : { perCapabilityQps: null, perTenantDailyCap: null },
  };
}

function maybeLoadRuntimePolicy(): void {
  if (policyLoadState !== "idle" || policyBusy) {
    return;
  }
  const request = bindingMutationHost.request;
  if (!bindingMutationHost.connected || !request) {
    return;
  }
  policyLoadState = "loading";
  void requestRuntimePolicyGet(request).then((result) => {
    if (!result.ok) {
      policyLoadState = "error";
      policyLoadError = result.error;
      policyDocument = null;
    } else {
      policyLoadState = "ready";
      policyLoadError = null;
      policyDocument = result.policy;
    }
    requestRerender();
  });
}

async function commitRuntimePolicy(): Promise<void> {
  const gate = bindingMutationGate();
  if (!gate.allowed || policyBusy || !policyDraft) {
    policyNotice = policyBusy ? "策略正在保存" : gate.reason;
    requestRerender();
    return;
  }
  const draftForCheck = ensurePolicyDraft();
  const dailyCap = draftForCheck.rateLimit?.perTenantDailyCap;
  const qps = draftForCheck.rateLimit?.perCapabilityQps;
  if (qps !== null && qps !== undefined && (!Number.isFinite(qps) || qps < 0)) {
    policyNotice = "每能力 QPS 必须是非负的每秒请求数";
    requestRerender();
    return;
  }
  if (
    dailyCap !== null &&
    dailyCap !== undefined &&
    (!Number.isInteger(dailyCap) || dailyCap < 0)
  ) {
    policyNotice = "每租户每日上限必须是非负整数，单位是每个租户每天的请求数";
    requestRerender();
    return;
  }
  if (
    typeof window === "undefined" ||
    !window.confirm(
      "确认保存运行时策略？将调用 agent-runtime.policy.update。QPS 单位是每个能力的每秒请求数，每日上限单位是每个租户的每天请求数。fallback.mode 是全局规则。空字段保持未配置。",
    )
  ) {
    requestRerender();
    return;
  }
  const request = bindingMutationHost.request;
  if (!request) {
    policyNotice = "网关未连接，策略保存不可执行";
    requestRerender();
    return;
  }
  const draft = ensurePolicyDraft();
  const payload: RuntimePolicyDocument = {
    loadDefaults:
      draft.loadDefaults &&
      (draft.loadDefaults.default !== null ||
        Object.keys(draft.loadDefaults.byCapabilityKind).length > 0)
        ? draft.loadDefaults
        : null,
    conflict: draft.conflict,
    fallback: { mode: draft.fallback.mode },
    rateLimit:
      draft.rateLimit &&
      (draft.rateLimit.perCapabilityQps !== null || draft.rateLimit.perTenantDailyCap !== null)
        ? draft.rateLimit
        : null,
  };
  policyBusy = true;
  policyNotice = null;
  requestRerender();
  const result = await requestRuntimePolicyUpdate(request, payload);
  policyBusy = false;
  if (!result.ok) {
    policyNotice = result.error;
    requestRerender();
    return;
  }
  policyDocument = result.policy;
  policyDraft = null;
  policyEditing = false;
  policyLoadState = "ready";
  policyNotice = "策略已按网关返回的文档保存。";
  requestRerender();
}

function isSortDirection(value: string | null): value is SortDirection {
  return value === "asc" || value === "desc";
}

function isRuntimeCatalogSortKey(value: string | null): value is RuntimeCatalogSortKey {
  return value != null && RUNTIME_CATALOG_SORT_KEYS.has(value as RuntimeCatalogSortKey);
}

function parseRuntimeHash(): {
  tab: AgentRuntimeTab;
  sortField: string | null;
  sortDirection: SortDirection | null;
} {
  if (typeof window === "undefined") {
    return { tab: "catalog", sortField: null, sortDirection: null };
  }
  const raw = window.location.hash.trim();
  if (!raw.startsWith(RUNTIME_HASH_PREFIX)) {
    return { tab: "catalog", sortField: null, sortDirection: null };
  }
  const value = raw.slice(RUNTIME_HASH_PREFIX.length);
  const queryStart = value.indexOf("?");
  const tabValue = queryStart >= 0 ? value.slice(0, queryStart) : value;
  const query = queryStart >= 0 ? value.slice(queryStart + 1) : "";
  const tab = AGENT_RUNTIME_TABS.some((t) => t.id === tabValue)
    ? (tabValue as AgentRuntimeTab)
    : "catalog";
  const params = new URLSearchParams(query);
  const direction = params.get("dir");
  return {
    tab,
    sortField: params.get("sort"),
    sortDirection: isSortDirection(direction) ? direction : null,
  };
}

function resolveActiveTab(): AgentRuntimeTab {
  return parseRuntimeHash().tab;
}

function resolveCatalogSort(): RuntimeSortState<RuntimeCatalogSortKey> {
  const parsed = parseRuntimeHash();
  if (isRuntimeCatalogSortKey(parsed.sortField) && parsed.sortDirection) {
    return { field: parsed.sortField, direction: parsed.sortDirection };
  }
  return DEFAULT_CATALOG_SORT;
}

function requestRerender(): void {
  requestPlatformSurfaceRerender();
}

function replaceRuntimeHash(
  tab: AgentRuntimeTab,
  sort?: RuntimeSortState<RuntimeCatalogSortKey | RuntimeBindingSortKey>,
): void {
  if (typeof window === "undefined") {
    return;
  }
  activeTab = tab;
  const { pathname, search } = window.location;
  const sortQuery = sort ? `?sort=${encodeURIComponent(sort.field)}&dir=${sort.direction}` : "";
  // 同页 hash 不能派发合成 popstate，否则 onPopState → refreshActiveTab → loadOverview。
  window.history.replaceState(
    {},
    "",
    normalizeAppHistoryHref(`${pathname}${search}${RUNTIME_HASH_PREFIX}${tab}${sortQuery}`),
  );
  requestRerender();
}

function activateTab(tab: AgentRuntimeTab): void {
  replaceRuntimeHash(tab);
}

function updateCatalogSort(field: RuntimeCatalogSortKey): void {
  const current = resolveCatalogSort();
  replaceRuntimeHash("catalog", {
    field,
    direction:
      current.field === field
        ? current.direction === "asc"
          ? "desc"
          : "asc"
        : CATALOG_SORT_DEFAULT_DIRECTIONS[field],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 标签页 / Tone 标签映射
// ─────────────────────────────────────────────────────────────────────────

const LIFECYCLE_LABELS: Record<RuntimeLifecycle, string> = {
  deployed: "已部署",
  draining: "排空中",
  suspended: "已暂停",
  deprecated: "即将下线",
  archived: "已归档",
};

const LIFECYCLE_TONES: Record<RuntimeLifecycle, "ok" | "warn" | "danger" | "neutral"> = {
  deployed: "ok",
  draining: "warn",
  suspended: "neutral",
  deprecated: "warn",
  archived: "neutral",
};

const HEALTH_LABELS: Record<RuntimeHealth, string> = {
  healthy: "健康",
  degraded: "性能下降",
  unhealthy: "异常",
  unavailable: "不可用",
};

const HEALTH_TONES: Record<RuntimeHealth, "ok" | "warn" | "danger" | "neutral"> = {
  healthy: "ok",
  degraded: "warn",
  unhealthy: "danger",
  unavailable: "neutral",
};

const BINDING_STATE_LABELS: Record<BindingState, string> = {
  active: "启用",
  warming: "预热中",
  degraded: "性能下降",
  disabled: "停用",
};

const BINDING_STATE_TONES: Record<BindingState, "ok" | "warn" | "danger" | "neutral"> = {
  active: "ok",
  warming: "warn",
  degraded: "warn",
  disabled: "neutral",
};

const BINDING_TYPE_LABELS: Record<BindingType, string> = {
  "tenant-installed": "租户安装",
  "platform-default": "平台默认",
  "dynamic-runtime": "动态运行",
  fallback: "降级备选",
};

const LOAD_STRATEGY_LABELS: Record<LoadStrategy, string> = {
  eager: "预加载",
  lazy: "延迟加载",
  "on-demand": "按需加载",
};

const ISSUE_CATEGORY_LABELS: Record<RuntimeGovernanceIssueCategory, string> = {
  "zombie-binding": "僵尸绑定",
  "resource-overcommit": "资源超配",
  "capability-conflict": "能力冲突",
  "sandbox-violation": "沙箱违规",
  "version-drift": "版本漂移",
  "fallback-chain-broken": "降级链路异常",
  "orphaned-agent": "孤立机器人",
};

const ISSUE_SEVERITY_LABELS: Record<RuntimeGovernanceIssue["severity"], string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
};

const ISSUE_SEVERITY_TONES: Record<
  RuntimeGovernanceIssue["severity"],
  "danger" | "warn" | "neutral"
> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "neutral",
};

const LIFECYCLE_SORT_RANK: Record<RuntimeLifecycle, number> = {
  deployed: 1,
  archived: 2,
  suspended: 3,
  draining: 4,
  deprecated: 5,
};

const HEALTH_SORT_RANK: Record<RuntimeHealth, number> = {
  healthy: 1,
  degraded: 2,
  unhealthy: 3,
  unavailable: 4,
};

const NUMBER_COLLATOR = new Intl.Collator("zh-Hans-CN", {
  numeric: true,
  sensitivity: "base",
});

const CAPABILITY_NAME_OVERRIDES: Record<string, string> = {
  xurl: "Xurl",
};

function fallbackRobotNameFromRuntimeId(runtimeAgentId: string): string {
  const trimmed = runtimeAgentId.trim();
  const withoutPrefix = trimmed.replace(/^rt[-_:]/i, "");
  const withoutSuffix = withoutPrefix.replace(/[-_:][0-9a-f]{6,}$/i, "");
  return withoutSuffix || trimmed;
}

function resolveRobotDisplayName(agent: RuntimeAgent): string {
  const cleaned = agent.name
    .trim()
    .replace(/\s+(Runtime|Agent)$/i, "")
    .replace(/\s*(运行实例|代理)$/i, "")
    .trim();
  const candidate =
    cleaned && !/^rt[-_:]/i.test(cleaned)
      ? cleaned
      : fallbackRobotNameFromRuntimeId(agent.runtimeAgentId);
  return candidate || agent.runtimeAgentId;
}

function extractCapabilityKey(capabilityId: string): string {
  const trimmed = capabilityId.trim();
  const urnMatch = trimmed.match(/^urn:openclaw:[^:]+:([^@]+)(?:@.+)?$/i);
  const withoutNamespace = (urnMatch?.[1] ?? trimmed)
    .replace(/^capability[.:/-]/i, "")
    .replace(/^skill[.:/-]/i, "")
    .replace(/^openclaw[.:/-]/i, "");
  const withoutVersion = withoutNamespace.replace(/@[^@]+$/u, "");
  const segments = withoutVersion.split(/[/:]/u).filter(Boolean);
  return segments.at(-1) ?? withoutVersion;
}

function humanizeRuntimeName(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) {
    return value;
  }
  return normalized.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function resolveCapabilityDisplayName(capabilityId: string): string {
  const key = extractCapabilityKey(capabilityId);
  return CAPABILITY_NAME_OVERRIDES[key] ?? humanizeRuntimeName(key);
}

// ─────────────────────────────────────────────────────────────────────────
// 占位数据派生：从 readModel.agentDirectory 派生 RuntimeAgent
// ─────────────────────────────────────────────────────────────────────────

/**
 * 当 readModel 尚未携带真实 runtime 数据时，从现有 agentDirectory + presenceCount
 * 派生最低限度的 RuntimeAgent 占位列表。这是接通真实遥测前的退化路径，保证页面
 * 可立即呈现合理的运维视图。
 */
function deriveAgentsFromReadModel(props: PlatformSurfaceProps): RuntimeAgent[] {
  if (props.readModel.runtimeAgents && props.readModel.runtimeAgents.length > 0) {
    return props.readModel.runtimeAgents;
  }
  const agents = props.readModel.agentDirectory ?? [];
  const presenceOnline = props.readModel.presenceCount > 0;
  const tenantIds = props.readModel.knownTenantIds ?? [];
  return agents.map<RuntimeAgent>((a) => ({
    runtimeAgentId: a.agentId,
    name: a.label,
    runtimeVersion: props.readModel.currentVersion ?? "unknown",
    lifecycle: a.isDefault ? "deployed" : "deployed",
    health: presenceOnline ? "healthy" : "unavailable",
    tenantCoverage: tenantIds,
    boundCapabilityCount: 0,
    activeSessionCount: presenceOnline ? props.readModel.sessionsCount : 0,
    resourceUsage: {
      cpuPercent: 0,
      memoryPercent: 0,
      tokenBudgetUsedPercent: 0,
    },
    deployedAt: 0,
    lastActiveAt: presenceOnline ? Date.now() : 0,
  }));
}

function deriveBindingsFromReadModel(props: PlatformSurfaceProps): RuntimeCapabilityBinding[] {
  return props.readModel.runtimeBindings ?? [];
}

/**
 * 从 readModel 中提取 tenantId → 显示名映射。优先使用 enterpriseDirectory（带正式
 * 企业名称），回退到 tenantDirectory（仅 ID 派生），最差也不会比 tenantId 更差。
 * 平台分析视角的"覆盖企业 / 各企业内深度"一律走这个映射。
 */
function buildTenantLabelMap(props: PlatformSurfaceProps): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of props.readModel.tenantDirectory ?? []) {
    if (entry.tenantId && entry.label) {
      map.set(entry.tenantId, entry.label);
    }
  }
  for (const entry of props.readModel.enterpriseDirectory ?? []) {
    if (entry.tenantId && entry.label) {
      map.set(entry.tenantId, entry.label);
    }
  }
  return map;
}

const TENANT_UNKNOWN_KEY = "__tenant_unknown__";
const TENANT_UNKNOWN_LABEL = "未关联租户";

// ─────────────────────────────────────────────────────────────────────────
// 表头排序：点击当前视图的表头可在升序 / 降序之间切换
// ─────────────────────────────────────────────────────────────────────────

function compareText(left: string, right: string): number {
  return NUMBER_COLLATOR.compare(left, right);
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function compareWithFallback(delta: number, fallback: number): number {
  return delta === 0 ? fallback : delta;
}

function applySortDirection(delta: number, direction: SortDirection): number {
  return direction === "asc" ? delta : -delta;
}

function resourcePressure(agent: RuntimeAgent): number {
  return Math.max(
    agent.resourceUsage.cpuPercent,
    agent.resourceUsage.memoryPercent,
    agent.resourceUsage.tokenBudgetUsedPercent,
  );
}

function compareRuntimeAgents(
  left: RuntimeAgent,
  right: RuntimeAgent,
  field: RuntimeCatalogSortKey,
  bindingCountByAgent: Map<string, number>,
): number {
  const leftRobotName = resolveRobotDisplayName(left);
  const rightRobotName = resolveRobotDisplayName(right);
  const fallback = compareText(leftRobotName, rightRobotName);
  switch (field) {
    case "agent":
      return (
        compareText(leftRobotName, rightRobotName) ||
        compareText(left.runtimeAgentId, right.runtimeAgentId)
      );
    case "lifecycle":
      return compareWithFallback(
        compareNumber(LIFECYCLE_SORT_RANK[left.lifecycle], LIFECYCLE_SORT_RANK[right.lifecycle]),
        fallback,
      );
    case "health":
      return compareWithFallback(
        compareNumber(HEALTH_SORT_RANK[left.health], HEALTH_SORT_RANK[right.health]),
        fallback,
      );
    case "bindings":
      return compareWithFallback(
        compareNumber(
          bindingCountByAgent.get(left.runtimeAgentId) ?? 0,
          bindingCountByAgent.get(right.runtimeAgentId) ?? 0,
        ),
        fallback,
      );
    case "tenants":
      return compareWithFallback(
        compareNumber(left.tenantCoverage.length, right.tenantCoverage.length),
        fallback,
      );
    case "sessions":
      return compareWithFallback(
        compareNumber(left.activeSessionCount, right.activeSessionCount),
        fallback,
      );
    case "resources":
      return compareWithFallback(
        compareNumber(resourcePressure(left), resourcePressure(right)),
        fallback,
      );
    case "lastActive":
      return compareWithFallback(compareNumber(left.lastActiveAt, right.lastActiveAt), fallback);
  }
}

function sortRuntimeAgents(
  agents: RuntimeAgent[],
  bindingCountByAgent: Map<string, number>,
  sort: RuntimeSortState<RuntimeCatalogSortKey>,
): RuntimeAgent[] {
  return [...agents].toSorted((left, right) =>
    applySortDirection(
      compareRuntimeAgents(left, right, sort.field, bindingCountByAgent),
      sort.direction,
    ),
  );
}

function renderSortableHeader<Key extends string>(params: {
  label: string;
  field: Key;
  sort: RuntimeSortState<Key>;
  onSort: (field: Key) => void;
}) {
  const active = params.sort.field === params.field;
  const nextDirection = active && params.sort.direction === "asc" ? "降序" : "升序";
  return html`
    <button
      type="button"
      class="platform-capabilities__sortable-header ${active ? "is-active" : ""}"
      aria-label=${`${params.label}，点击按${nextDirection}排列`}
      @click=${() => params.onSort(params.field)}
    >
      <span>${params.label}</span>
      <span class="platform-capabilities__sort-indicator" aria-hidden="true">
        ${active ? (params.sort.direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  `;
}

function ariaSort<Key extends string>(
  sort: RuntimeSortState<Key>,
  field: Key,
): "ascending" | "descending" | "none" {
  if (sort.field !== field) {
    return "none";
  }
  return sort.direction === "asc" ? "ascending" : "descending";
}

// ─────────────────────────────────────────────────────────────────────────
// KPI 卡片（Task 14）
// ─────────────────────────────────────────────────────────────────────────

function computeKpi(
  agents: RuntimeAgent[],
  bindings: RuntimeCapabilityBinding[],
  runtimeKpi: PlatformSurfaceProps["readModel"]["runtimeKpi"],
) {
  if (runtimeKpi) {
    return {
      agentTotal: runtimeKpi.agentCountTotal,
      lifecycleCounts: runtimeKpi.agentCountByLifecycle,
      bindingTotal: runtimeKpi.bindingCountTotal,
      avgBindingsPerAgent: runtimeKpi.avgBindingsPerAgent,
      healthyRate: runtimeKpi.healthyAgentRatio,
      tenantTotal: runtimeKpi.tenantCoverageTotal,
      sessionTotal: runtimeKpi.activeSessionCount,
      stateCounts: runtimeKpi.bindingCountByState,
    };
  }
  const lifecycleCounts: Record<RuntimeLifecycle, number> = {
    deployed: 0,
    draining: 0,
    suspended: 0,
    deprecated: 0,
    archived: 0,
  };
  for (const a of agents) {
    lifecycleCounts[a.lifecycle] += 1;
  }

  const tenantSet = new Set<string>();
  for (const a of agents) {
    for (const t of a.tenantCoverage) {
      tenantSet.add(t);
    }
  }

  const sessionTotal = agents.reduce((s, a) => s + a.activeSessionCount, 0);
  const healthyCount = agents.filter((a) => a.health === "healthy").length;
  const healthyRate = agents.length === 0 ? 0 : healthyCount / agents.length;

  const stateCounts: Record<BindingState, number> = {
    active: 0,
    warming: 0,
    degraded: 0,
    disabled: 0,
  };
  for (const b of bindings) {
    stateCounts[b.bindingState] += 1;
  }

  const avgBindingsPerAgent =
    agents.length === 0 ? 0 : Math.round((bindings.length / agents.length) * 10) / 10;

  return {
    agentTotal: agents.length,
    lifecycleCounts,
    bindingTotal: bindings.length,
    avgBindingsPerAgent,
    healthyRate,
    tenantTotal: tenantSet.size,
    sessionTotal,
    stateCounts,
  };
}

function renderKpiCards(kpi: ReturnType<typeof computeKpi>) {
  const cards: Array<{
    label: string;
    value: string;
    meta: string;
    icon: IconName;
    tone: "ok" | "warn" | "danger" | "neutral";
  }> = [
    {
      label: "代理总数",
      value: String(kpi.agentTotal),
      meta: `已部署 ${kpi.lifecycleCounts.deployed} · 排空 ${kpi.lifecycleCounts.draining} · 即将下线 ${kpi.lifecycleCounts.deprecated}`,
      icon: "brain",
      tone: "neutral",
    },
    {
      label: "能力装载总数",
      value: String(kpi.bindingTotal),
      meta:
        kpi.bindingTotal > 0
          ? `启用 ${kpi.stateCounts.active} · 预热 ${kpi.stateCounts.warming} · 停用 ${kpi.stateCounts.disabled}`
          : "尚无运行时绑定",
      icon: "puzzle",
      tone: kpi.bindingTotal > 0 ? "ok" : "neutral",
    },
    {
      label: "平均每代理能力",
      value: kpi.agentTotal > 0 ? kpi.avgBindingsPerAgent.toFixed(1) : "—",
      meta: kpi.agentTotal > 0 ? `跨 ${kpi.tenantTotal} 个租户` : "暂无代理可计算",
      icon: "activity",
      tone: kpi.bindingTotal > 0 ? "ok" : "neutral",
    },
    {
      label: "健康率",
      value: kpi.agentTotal > 0 ? `${Math.round(kpi.healthyRate * 100)}%` : "—",
      meta:
        kpi.agentTotal === 0
          ? "等待运行时数据"
          : kpi.healthyRate >= 0.9
            ? "全部代理处于健康状态"
            : kpi.healthyRate >= 0.6
              ? "存在性能下降或异常代理"
              : "需要优先处理健康异常",
      icon: "shieldCheck",
      tone:
        kpi.agentTotal === 0
          ? "neutral"
          : kpi.healthyRate >= 0.9
            ? "ok"
            : kpi.healthyRate >= 0.6
              ? "warn"
              : "danger",
    },
    {
      label: "活跃会话",
      value: String(kpi.sessionTotal),
      meta: kpi.sessionTotal > 0 ? "当前存在活跃会话" : "暂无活跃会话",
      icon: "activity",
      tone: kpi.sessionTotal > 0 ? "ok" : "neutral",
    },
  ];

  return html`
    <section class="platform-capabilities__summary" aria-label="资产管理总览指标">
      ${cards.map(
        (card) => html`
          <article class="platform-capabilities__summary-card is-${card.tone}">
            <span class="platform-capabilities__summary-icon is-${card.tone}">
              ${renderIcon(card.icon, "platform-capabilities__summary-icon-svg")}
            </span>
            <div class="platform-capabilities__summary-body">
              <div class="platform-capabilities__summary-label">${card.label}</div>
              <div class="platform-capabilities__summary-value is-${card.tone}">${card.value}</div>
              <div class="platform-capabilities__summary-meta">${card.meta}</div>
            </div>
          </article>
        `,
      )}
    </section>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 标签栏
// ─────────────────────────────────────────────────────────────────────────

function renderTabBar() {
  return html`
    <div
      class="platform-module-tabs platform-module-tabs--inline"
      role="tablist"
      aria-label="资产管理子模块"
    >
      ${AGENT_RUNTIME_TABS.map(
        (tab) => html`
          <button
            type="button"
            class="platform-module-tab ${activeTab === tab.id ? "is-active" : ""}"
            role="tab"
            aria-selected=${String(activeTab === tab.id)}
            @click=${() => activateTab(tab.id)}
            title=${tab.sub}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 标签页 1：Runtime Catalog（Task 13）
// ─────────────────────────────────────────────────────────────────────────

function renderRuntimeCatalogTab(agents: RuntimeAgent[], bindings: RuntimeCapabilityBinding[]) {
  if (agents.length === 0) {
    return html`
      <div class="platform-capabilities__empty">
        ${renderIcon("brain", "platform-capabilities__empty-icon")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">暂无机器人运行实例</div>
          <div class="platform-capabilities__empty-sub">
            从机器人资产注册与能力绑定流程创建第一条机器人运行实例。
          </div>
        </div>
      </div>
    `;
  }

  const bindingCountByAgent = new Map<string, number>();
  for (const b of bindings) {
    bindingCountByAgent.set(b.runtimeAgentId, (bindingCountByAgent.get(b.runtimeAgentId) ?? 0) + 1);
  }
  const sort = resolveCatalogSort();
  const sortedAgents = sortRuntimeAgents(agents, bindingCountByAgent, sort);

  return html`
    <div class="platform-capabilities__distribution">
      <table class="platform-capabilities__distribution-table">
        <colgroup>
          <col style="width: 22%" />
          <col style="width: 11%" />
          <col style="width: 10%" />
          <col style="width: 10%" />
          <col style="width: 11%" />
          <col style="width: 11%" />
          <col style="width: 11%" />
          <col style="width: 14%" />
        </colgroup>
        <thead>
          <tr>
            <th aria-sort=${ariaSort(sort, "agent")}>
              ${renderSortableHeader({
                label: "租户实例 / 运行版本",
                field: "agent",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
            <th aria-sort=${ariaSort(sort, "lifecycle")}>
              ${renderSortableHeader({
                label: "生命周期",
                field: "lifecycle",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
            <th aria-sort=${ariaSort(sort, "health")}>
              ${renderSortableHeader({
                label: "健康状态",
                field: "health",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
            <th aria-sort=${ariaSort(sort, "bindings")}>
              ${renderSortableHeader({
                label: "绑定数",
                field: "bindings",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
            <th aria-sort=${ariaSort(sort, "tenants")}>
              ${renderSortableHeader({
                label: "租户覆盖",
                field: "tenants",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
            <th aria-sort=${ariaSort(sort, "sessions")}>
              ${renderSortableHeader({
                label: "活跃会话",
                field: "sessions",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
            <th aria-sort=${ariaSort(sort, "resources")}>
              ${renderSortableHeader({
                label: "资源使用",
                field: "resources",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
            <th aria-sort=${ariaSort(sort, "lastActive")}>
              ${renderSortableHeader({
                label: "最近活跃",
                field: "lastActive",
                sort,
                onSort: updateCatalogSort,
              })}
            </th>
          </tr>
        </thead>
        <tbody>
          ${sortedAgents.map((a) => renderRuntimeCatalogRow(a, bindingCountByAgent.get(a.runtimeAgentId) ?? 0))}
        </tbody>
      </table>
    </div>
  `;
}

function renderRuntimeCatalogRow(agent: RuntimeAgent, boundCount: number) {
  const robotName = resolveRobotDisplayName(agent);
  const avatar = robotName.slice(0, 1).toUpperCase();
  const cpu = Math.round(agent.resourceUsage.cpuPercent);
  const mem = Math.round(agent.resourceUsage.memoryPercent);
  const lastActive =
    agent.lastActiveAt === 0 ? "无活跃记录" : formatRelativeTime(Date.now() - agent.lastActiveAt);
  // The catalog row represents a single RuntimeAgent which today is provisioned
  // 1:1 with a tenant (label === tenant). We show the cleaned tenant name on
  // the top line, and stack `运行版本 vX.Y.Z · rt-...` underneath so operators
  // never have to guess whether the entry is a real robot or a tenant slug.
  const tenantsSummary =
    agent.tenantCoverage.length === 0
      ? "未关联租户"
      : agent.tenantCoverage.length === 1
        ? agent.tenantCoverage[0]
        : `${agent.tenantCoverage[0]} 等 ${agent.tenantCoverage.length} 个租户`;
  return html`
    <tr>
      <td>
        <div class="platform-capabilities__distribution-tenant">
          <span class="platform-capabilities__distribution-avatar">${avatar}</span>
          <div class="platform-capabilities__distribution-tenant-copy">
            <div class="platform-capabilities__distribution-tenant-name">${robotName}</div>
            <div class="platform-capabilities__distribution-tenant-id">
              运行版本 v${agent.runtimeVersion} · ${agent.runtimeAgentId}
            </div>
            <div class="platform-capabilities__distribution-tenant-id">租户：${tenantsSummary}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="platform-capabilities__chip is-${LIFECYCLE_TONES[agent.lifecycle]}">
          ${LIFECYCLE_LABELS[agent.lifecycle]}
        </span>
      </td>
      <td>
        <span class="platform-capabilities__chip is-${HEALTH_TONES[agent.health]}">
          ${HEALTH_LABELS[agent.health]}
        </span>
      </td>
      <td>${boundCount} 条</td>
      <td>${agent.tenantCoverage.length} 个</td>
      <td>${agent.activeSessionCount}</td>
      <td>处理器 ${cpu}% · 内存 ${mem}%</td>
      <td>${lastActive}</td>
    </tr>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 标签页 2：Capability Bindings — 双视角（按代理 / 按能力）
// ─────────────────────────────────────────────────────────────────────────

/** 应用搜索 + 多筛选条件，得到候选绑定集合。 */
function filterBindings(
  bindings: RuntimeCapabilityBinding[],
  agents: RuntimeAgent[],
): RuntimeCapabilityBinding[] {
  const search = bindingSearchQuery.trim().toLowerCase();
  const agentNameById = new Map<string, string>();
  for (const a of agents) {
    agentNameById.set(a.runtimeAgentId, resolveRobotDisplayName(a));
  }
  const agentTenantsById = new Map<string, string[]>();
  for (const a of agents) {
    agentTenantsById.set(a.runtimeAgentId, a.tenantCoverage);
  }
  return bindings.filter((b) => {
    if (bindingFilterSourceType !== "all" && b.bindingType !== bindingFilterSourceType) {
      return false;
    }
    if (bindingFilterState !== "all" && b.bindingState !== bindingFilterState) {
      return false;
    }
    if (bindingFilterHealth !== "all" && b.healthStatus !== bindingFilterHealth) {
      return false;
    }
    if (bindingFilterStrategy !== "all" && b.loadStrategy !== bindingFilterStrategy) {
      return false;
    }
    if (bindingFilterTenant !== "all") {
      const tenants = agentTenantsById.get(b.runtimeAgentId) ?? [];
      if (!tenants.includes(bindingFilterTenant)) {
        return false;
      }
    }
    if (search) {
      const capability = resolveCapabilityDisplayName(b.capabilityId).toLowerCase();
      const agentName = (agentNameById.get(b.runtimeAgentId) ?? b.runtimeAgentId).toLowerCase();
      if (
        !capability.includes(search) &&
        !agentName.includes(search) &&
        !b.capabilityId.toLowerCase().includes(search) &&
        !b.runtimeAgentId.toLowerCase().includes(search)
      ) {
        return false;
      }
    }
    return true;
  });
}

function setBindingViewMode(mode: BindingViewMode): void {
  if (bindingViewMode === mode) {
    return;
  }
  bindingViewMode = mode;
  collapsedBindingGroups.clear();
  requestRerender();
}

function toggleBindingGroup(key: string): void {
  if (collapsedBindingGroups.has(key)) {
    collapsedBindingGroups.delete(key);
  } else {
    collapsedBindingGroups.add(key);
  }
  requestRerender();
}

function toggleBindingSelection(bindingId: string, selected: boolean): void {
  if (selected) {
    selectedBindingIds.add(bindingId);
  } else {
    selectedBindingIds.delete(bindingId);
  }
  requestRerender();
}

function clearBindingSelection(): void {
  if (selectedBindingIds.size === 0) {
    return;
  }
  selectedBindingIds.clear();
  requestRerender();
}

function toggleBindingDetail(bindingId: string): void {
  if (expandedBindingDetailIds.has(bindingId)) {
    expandedBindingDetailIds.delete(bindingId);
  } else {
    expandedBindingDetailIds.add(bindingId);
  }
  requestRerender();
}

function renderBindingsControlBar(agents: RuntimeAgent[], bindings: RuntimeCapabilityBinding[]) {
  maybeLoadCapabilityVersions();
  const upgradeChoices = upgradeVersionChoices({
    entries: capabilityVersionCatalog,
    bindings,
  });
  const upgradeBlockedTitle =
    capabilityVersionLoadState === "loading"
      ? "正在读取版本目录"
      : capabilityVersionLoadState === "error"
        ? (capabilityVersionLoadError ?? "版本目录读取失败")
        : BINDING_UPGRADE_EMPTY_CATALOG;
  const upgradeCatalog = mutationButtonState(
    capabilityVersionLoadState === "ready" && upgradeChoices.length > 0,
    upgradeBlockedTitle,
    "从版本目录选择目标版本",
  );
  const tenantSet = new Set<string>();
  for (const a of agents) {
    for (const t of a.tenantCoverage) {
      tenantSet.add(t);
    }
  }
  const tenantOptions = Array.from(tenantSet).toSorted((a, b) => a.localeCompare(b));

  const selectedCount = selectedBindingIds.size;
  const bulkStateButton = mutationButtonState(
    true,
    "",
    "调用 agent-runtime.binding.batch-set-state，一次请求，部分失败见 applied / rejected",
  );

  const sourceOptions: ReadonlyArray<{ value: BindingType | "all"; label: string }> = [
    { value: "all", label: "全部来源" },
    { value: "platform-default", label: "平台默认" },
    { value: "tenant-installed", label: "企业安装" },
    { value: "dynamic-runtime", label: "动态运行" },
    { value: "fallback", label: "降级备选" },
  ];
  const stateOptions: ReadonlyArray<{ value: BindingState | "all"; label: string }> = [
    { value: "all", label: "全部状态" },
    { value: "active", label: "启用" },
    { value: "warming", label: "预热中" },
    { value: "degraded", label: "性能下降" },
    { value: "disabled", label: "停用" },
  ];
  const healthOptions: ReadonlyArray<{ value: RuntimeHealth | "all"; label: string }> = [
    { value: "all", label: "全部健康" },
    { value: "healthy", label: "健康" },
    { value: "degraded", label: "性能下降" },
    { value: "unhealthy", label: "异常" },
    { value: "unavailable", label: "不可用" },
  ];
  const strategyOptions: ReadonlyArray<{ value: LoadStrategy | "all"; label: string }> = [
    { value: "all", label: "全部策略" },
    { value: "eager", label: "预加载" },
    { value: "lazy", label: "延迟加载" },
    { value: "on-demand", label: "按需加载" },
  ];

  const total = bindings.length;
  const filteredCount = filterBindings(bindings, agents).length;
  const filterSummary =
    filteredCount === total ? `共 ${total} 条绑定` : `命中 ${filteredCount} / ${total} 条绑定`;

  return html`
    <div class="platform-agents-controls" role="group" aria-label="能力绑定控制条">
      <div class="platform-agents-controls__top">
        <div class="platform-agents-controls__view-switch" role="tablist" aria-label="视图切换">
          <button
            type="button"
            role="tab"
            aria-selected=${String(bindingViewMode === "byAgent")}
            class="platform-agents-controls__view-btn ${bindingViewMode === "byAgent" ? "is-active" : ""}"
            @click=${() => setBindingViewMode("byAgent")}
          >
            按代理查看
          </button>
          <button
            type="button"
            role="tab"
            aria-selected=${String(bindingViewMode === "byCapability")}
            class="platform-agents-controls__view-btn ${bindingViewMode === "byCapability" ? "is-active" : ""}"
            @click=${() => setBindingViewMode("byCapability")}
          >
            按能力查看
          </button>
        </div>
        <div class="platform-agents-controls__top-right">
          <div
            class="platform-agents-controls__bulk-inline ${selectedCount > 0 ? "is-active" : ""}"
            role="group"
            aria-label="批量操作"
          >
            <span class="platform-agents-controls__bulk-label">
              ${selectedCount > 0 ? `已选择 ${selectedCount} 条` : "选中行后可批量操作"}
            </span>
            <button
              type="button"
              class="btn btn--small"
              data-testid="binding-bulk-enable"
              ?disabled=${bulkStateButton.disabled || selectedCount === 0}
              title=${selectedCount === 0 ? "请先选择绑定" : bulkStateButton.title}
              @click=${() => void commitBindingBatch("active")}
            >
              启用
            </button>
            <button
              type="button"
              class="btn btn--small"
              data-testid="binding-bulk-disable"
              ?disabled=${bulkStateButton.disabled || selectedCount === 0}
              title=${selectedCount === 0 ? "请先选择绑定" : bulkStateButton.title}
              @click=${() => void commitBindingBatch("disabled")}
            >
              停用
            </button>
            <label>
              批量策略
              <select
                data-testid="binding-bulk-strategy-value"
                .value=${bindingBulkStrategy}
                ?disabled=${bulkStateButton.disabled}
                @change=${(event: Event) => {
                  bindingBulkStrategy = (event.target as HTMLSelectElement).value as
                    | LoadStrategy
                    | "";
                  requestRerender();
                }}
              >
                <option value="">未选择</option>
                <option value="eager">预加载</option>
                <option value="lazy">延迟加载</option>
                <option value="on-demand">按需加载</option>
              </select>
            </label>
            <button
              type="button"
              class="btn btn--small"
              data-testid="binding-bulk-strategy"
              ?disabled=${bulkStateButton.disabled || selectedCount === 0 || !bindingBulkStrategy}
              title=${
                !bindingBulkStrategy
                  ? "请选择加载策略后再调用 agent-runtime.binding.batch-set-strategy"
                  : "调用 agent-runtime.binding.batch-set-strategy，一次请求，部分失败见 applied / rejected"
              }
              @click=${() => void commitBindingBatch("strategy")}
            >
              调整策略
            </button>
            <label>
              目标版本
              <select
                data-testid="binding-bulk-upgrade-version"
                .value=${bindingUpgradeVersion}
                ?disabled=${upgradeCatalog.disabled}
                title=${upgradeCatalog.title}
                @change=${(event: Event) => {
                  bindingUpgradeVersion = (event.target as HTMLSelectElement).value;
                  requestRerender();
                }}
              >
                <option value="">未选择</option>
                ${upgradeChoices.map(
                  (choice) => html`<option value=${choice.version}>${choice.label}</option>`,
                )}
              </select>
            </label>
            <button
              type="button"
              class="btn btn--small"
              data-testid="binding-bulk-upgrade"
              ?disabled=${upgradeCatalog.disabled || selectedCount === 0 || !bindingUpgradeVersion}
              title=${
                selectedCount === 0
                  ? "请先选择绑定"
                  : !bindingUpgradeVersion
                    ? "请选择目录中的目标版本后再调用 agent-runtime.binding.upgrade"
                    : "调用 agent-runtime.binding.upgrade，一次请求，未知或不兼容的版本在 rejected 中返回"
              }
              @click=${() => void commitBindingBatch("upgrade")}
            >
              升级版本
            </button>
            ${
              selectedCount > 0
                ? html`<button
                    type="button"
                    class="btn btn--small btn--ghost"
                    @click=${clearBindingSelection}
                  >
                    清空
                  </button>`
                : nothing
            }
          </div>
          <div class="platform-agents-controls__summary">${filterSummary}</div>
        </div>
      </div>

      <div class="platform-agents-controls__row">
        <label class="platform-agents-controls__search">
          <span class="platform-agents-controls__search-icon" aria-hidden="true">
            ${renderIcon("search", "platform-agents-controls__search-icon-svg")}
          </span>
          <input
            type="search"
            placeholder="搜索能力 / 代理 / 来源 / 人"
            .value=${bindingSearchQuery}
            @input=${(e: Event) => {
              bindingSearchQuery = (e.target as HTMLInputElement).value;
              requestRerender();
            }}
          />
        </label>

        ${renderBindingsFilterSelect("来源", sourceOptions, bindingFilterSourceType, (v) => {
          bindingFilterSourceType = v;
          requestRerender();
        })}
        ${renderBindingsFilterSelect("状态", stateOptions, bindingFilterState, (v) => {
          bindingFilterState = v;
          requestRerender();
        })}
        ${renderBindingsFilterSelect("健康", healthOptions, bindingFilterHealth, (v) => {
          bindingFilterHealth = v;
          requestRerender();
        })}
        ${renderBindingsFilterSelect("策略", strategyOptions, bindingFilterStrategy, (v) => {
          bindingFilterStrategy = v;
          requestRerender();
        })}
        ${renderBindingsFilterSelect(
          "租户",
          [
            { value: "all", label: "全部租户" } as { value: string; label: string },
            ...tenantOptions.map((t) => ({ value: t, label: t })),
          ],
          bindingFilterTenant,
          (v) => {
            bindingFilterTenant = v;
            requestRerender();
          },
        )}
      </div>
    </div>
  `;
}

function renderBindingsFilterSelect<T extends string>(
  label: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
  onChange: (next: T) => void,
) {
  return html`
    <label class="platform-agents-controls__select">
      <span class="platform-agents-controls__select-label">${label}</span>
      <select @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value as T)}>
        ${options.map(
          (opt) => html`
            <option value=${opt.value} ?selected=${opt.value === value}>${opt.label}</option>
          `,
        )}
      </select>
    </label>
  `;
}

type BindingGroup<T> = {
  key: string;
  primary: T;
  bindings: RuntimeCapabilityBinding[];
};

function groupBindingsByAgent(
  bindings: RuntimeCapabilityBinding[],
  agents: RuntimeAgent[],
): BindingGroup<RuntimeAgent>[] {
  const map = new Map<string, BindingGroup<RuntimeAgent>>();
  const agentById = new Map(agents.map((a) => [a.runtimeAgentId, a] as const));
  for (const b of bindings) {
    const agent = agentById.get(b.runtimeAgentId);
    if (!agent) {
      continue;
    }
    let group = map.get(agent.runtimeAgentId);
    if (!group) {
      group = { key: agent.runtimeAgentId, primary: agent, bindings: [] };
      map.set(agent.runtimeAgentId, group);
    }
    group.bindings.push(b);
  }
  return Array.from(map.values()).toSorted((a, b) =>
    compareText(resolveRobotDisplayName(a.primary), resolveRobotDisplayName(b.primary)),
  );
}

function groupBindingsByCapability(
  bindings: RuntimeCapabilityBinding[],
): BindingGroup<{ capabilityId: string; capabilityName: string }>[] {
  const map = new Map<string, BindingGroup<{ capabilityId: string; capabilityName: string }>>();
  for (const b of bindings) {
    let group = map.get(b.capabilityId);
    if (!group) {
      group = {
        key: b.capabilityId,
        primary: {
          capabilityId: b.capabilityId,
          capabilityName: resolveCapabilityDisplayName(b.capabilityId),
        },
        bindings: [],
      };
      map.set(b.capabilityId, group);
    }
    group.bindings.push(b);
  }
  return Array.from(map.values()).toSorted((a, b) =>
    compareText(a.primary.capabilityName, b.primary.capabilityName),
  );
}

function renderCapabilityBindingsTab(
  agents: RuntimeAgent[],
  bindings: RuntimeCapabilityBinding[],
  tenantLabelById: Map<string, string>,
) {
  const filtered = filterBindings(bindings, agents);

  if (bindings.length === 0) {
    return html`
      <div class="platform-capabilities__empty">
        ${renderIcon("puzzle", "platform-capabilities__empty-icon")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">暂无能力绑定</div>
          <div class="platform-capabilities__empty-sub">
            通过企业端安装能力，或由平台接口为机器人创建第一条运行时绑定。
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="platform-agents-bindings">
      ${
        bindingMutationNotice
          ? html`<p class="muted" role="status" data-testid="binding-mutation-notice">
              ${bindingMutationNotice}
            </p>`
          : nothing
      }
      ${renderBindingsControlBar(agents, bindings)}
      ${
        filtered.length === 0
          ? html`
              <div class="platform-capabilities__empty platform-capabilities__empty--inline">
                ${renderIcon("filter", "platform-capabilities__empty-icon")}
                <div class="platform-capabilities__empty-copy">
                  <div class="platform-capabilities__empty-title">没有命中的绑定</div>
                  <div class="platform-capabilities__empty-sub">尝试调整筛选条件或清空搜索框。</div>
                </div>
              </div>
            `
          : bindingViewMode === "byAgent"
            ? renderBindingsByAgent(agents, filtered)
            : renderBindingsByCapability(agents, filtered, tenantLabelById)
      }
    </div>
  `;
}

function renderBindingsByAgent(
  agents: RuntimeAgent[],
  filteredBindings: RuntimeCapabilityBinding[],
) {
  const groups = groupBindingsByAgent(filteredBindings, agents);
  const agentById = new Map(agents.map((a) => [a.runtimeAgentId, a] as const));
  return html`
    <div class="platform-agents-bindings__groups">
      ${groups.map((group) => renderAgentBindingGroup(group, agentById))}
    </div>
  `;
}

function renderAgentBindingGroup(
  group: BindingGroup<RuntimeAgent>,
  agentById: Map<string, RuntimeAgent>,
) {
  const collapsed = collapsedBindingGroups.has(group.key);
  const expanded = !collapsed;
  const agent = group.primary;
  const robotName = resolveRobotDisplayName(agent);
  const healthyCount = group.bindings.filter((b) => b.healthStatus === "healthy").length;
  const healthyPercent =
    group.bindings.length === 0 ? 0 : Math.round((healthyCount / group.bindings.length) * 100);
  return html`
    <section class="platform-agents-bindings__group">
      <header
        class="platform-agents-bindings__group-header"
        @click=${() => toggleBindingGroup(group.key)}
        role="button"
        aria-expanded=${String(expanded)}
        tabindex="0"
      >
        <span class="platform-agents-bindings__group-toggle" aria-hidden="true"
          >${expanded ? "▼" : "▶"}</span
        >
        <span class="platform-agents-bindings__group-avatar"
          >${robotName.slice(0, 1).toUpperCase()}</span
        >
        <div class="platform-agents-bindings__group-copy">
          <div class="platform-agents-bindings__group-title">${robotName}</div>
          <div class="platform-agents-bindings__group-sub">
            运行版本 v${agent.runtimeVersion} · ${agent.runtimeAgentId}
          </div>
        </div>
        <div class="platform-agents-bindings__group-stats">
          <span>覆盖租户：<strong>${agent.tenantCoverage.length}</strong></span>
          <span>能力数：<strong>${group.bindings.length}</strong></span>
          <span>健康率：<strong>${healthyPercent}%</strong></span>
          <span class="platform-capabilities__chip is-${HEALTH_TONES[agent.health]}">
            ${HEALTH_LABELS[agent.health]}
          </span>
        </div>
      </header>
      ${
        expanded
          ? html`
              <div class="platform-agents-bindings__group-body">
                ${renderBindingsTable(group.bindings, /* showAgentColumn */ false, agentById)}
              </div>
            `
          : nothing
      }
    </section>
  `;
}

function renderBindingsByCapability(
  agents: RuntimeAgent[],
  filteredBindings: RuntimeCapabilityBinding[],
  tenantLabelById: Map<string, string>,
) {
  const groups = groupBindingsByCapability(filteredBindings);
  const agentById = new Map(agents.map((a) => [a.runtimeAgentId, a] as const));
  return html`
    <div class="platform-agents-bindings__groups">
      ${groups.map((group) => renderCapabilityBindingGroup(group, agentById, tenantLabelById))}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 平台分析视角的"租户聚合桶"
//
// 平台管理员在「按能力查看」视角下关心的真正问题：
//   - 这能力被多少个企业（租户）装载？
//   - 每个企业内多少个机器人装了？
//   - 各企业 7 日调用量、加权成功率、加权延迟分别是多少？
//   - 是否有企业出错频繁？
//
// 因此我们把"能力 → binding 列表"按 binding 所属 RuntimeAgent 的 tenantCoverage
// 第一项分组，得到"能力 → 租户 → binding 列表"两层结构。tenantCoverage 为空的
// binding 落到 `__tenant_unknown__` 桶里以保证全集不丢。
// ─────────────────────────────────────────────────────────────────────────

type CapabilityTenantBucket = {
  tenantId: string;
  tenantLabel: string;
  bindings: RuntimeCapabilityBinding[];
  agentSet: Set<string>;
  calls7d: number;
  errors7d: number;
  weightedSuccessRate: number;
  weightedAvgLatencyMs: number;
  unhealthyCount: number;
  degradedCount: number;
  stateCounts: Record<BindingState, number>;
};

function groupCapabilityByTenant(
  bindings: RuntimeCapabilityBinding[],
  agentById: Map<string, RuntimeAgent>,
  tenantLabelById: Map<string, string>,
): CapabilityTenantBucket[] {
  const buckets = new Map<string, CapabilityTenantBucket>();
  function ensureBucket(tenantId: string): CapabilityTenantBucket {
    let bucket = buckets.get(tenantId);
    if (bucket) {
      return bucket;
    }
    const label =
      tenantId === TENANT_UNKNOWN_KEY
        ? TENANT_UNKNOWN_LABEL
        : (tenantLabelById.get(tenantId) ?? tenantId);
    bucket = {
      tenantId,
      tenantLabel: label,
      bindings: [],
      agentSet: new Set(),
      calls7d: 0,
      errors7d: 0,
      weightedSuccessRate: 0,
      weightedAvgLatencyMs: 0,
      unhealthyCount: 0,
      degradedCount: 0,
      stateCounts: { active: 0, warming: 0, degraded: 0, disabled: 0 },
    };
    buckets.set(tenantId, bucket);
    return bucket;
  }

  for (const b of bindings) {
    const agent = agentById.get(b.runtimeAgentId);
    const tenantIds =
      agent && agent.tenantCoverage.length > 0 ? agent.tenantCoverage : [TENANT_UNKNOWN_KEY];
    // RuntimeAgent 的 tenantCoverage 可能跨多租户。每个租户都计入一次（这是平台
    // 真实的"覆盖企业"语义；同一 binding 在多租户下分别计算调用量是可接受的，
    // 因为我们展示的是"该企业能调用到多少次"而不是"全平台累计 N 次"）。
    for (const tenantId of tenantIds) {
      const bucket = ensureBucket(tenantId);
      bucket.bindings.push(b);
      bucket.agentSet.add(b.runtimeAgentId);
      bucket.calls7d += b.invocationMetrics.calls7d;
      bucket.errors7d += b.invocationMetrics.errorCount7d;
      if (b.healthStatus === "unhealthy") {
        bucket.unhealthyCount += 1;
      }
      if (b.healthStatus === "degraded") {
        bucket.degradedCount += 1;
      }
      bucket.stateCounts[b.bindingState] += 1;
    }
  }

  // 第二轮：用 calls7d 加权计算各 bucket 的 successRate / avgLatencyMs。
  for (const bucket of buckets.values()) {
    let successWeighted = 0;
    let latencyWeighted = 0;
    let totalCalls = 0;
    for (const b of bucket.bindings) {
      const w = Math.max(0, b.invocationMetrics.calls7d);
      successWeighted += b.invocationMetrics.successRate7d * w;
      latencyWeighted += b.invocationMetrics.avgLatencyMs * w;
      totalCalls += w;
    }
    bucket.weightedSuccessRate = totalCalls > 0 ? successWeighted / totalCalls : 1;
    bucket.weightedAvgLatencyMs = totalCalls > 0 ? latencyWeighted / totalCalls : 0;
  }

  // 排序：调用量降序为首选；调用量并列时按机器人装载数降序；都并列再按名称。
  return Array.from(buckets.values()).toSorted((left, right) => {
    if (right.calls7d !== left.calls7d) {
      return right.calls7d - left.calls7d;
    }
    if (right.agentSet.size !== left.agentSet.size) {
      return right.agentSet.size - left.agentSet.size;
    }
    return compareText(left.tenantLabel, right.tenantLabel);
  });
}

function renderCapabilityBindingGroup(
  group: BindingGroup<{ capabilityId: string; capabilityName: string }>,
  agentById: Map<string, RuntimeAgent>,
  tenantLabelById: Map<string, string>,
) {
  const collapsed = collapsedBindingGroups.has(group.key);
  const expanded = !collapsed;
  const totalCalls = group.bindings.reduce((sum, b) => sum + b.invocationMetrics.calls7d, 0);
  const agentSet = new Set(group.bindings.map((b) => b.runtimeAgentId));
  const tenantBuckets = groupCapabilityByTenant(group.bindings, agentById, tenantLabelById);
  const tenantCount = tenantBuckets.filter((b) => b.tenantId !== TENANT_UNKNOWN_KEY).length;
  // 平台分析口径：加权成功率（按调用量）。比简单平均更能反映企业内真实体验。
  let totalErrors = 0;
  let weightedSuccess = 0;
  let weightedLatency = 0;
  for (const b of group.bindings) {
    const w = Math.max(0, b.invocationMetrics.calls7d);
    weightedSuccess += b.invocationMetrics.successRate7d * w;
    weightedLatency += b.invocationMetrics.avgLatencyMs * w;
    totalErrors += b.invocationMetrics.errorCount7d;
  }
  const platformSuccessRate =
    totalCalls > 0
      ? weightedSuccess / totalCalls
      : group.bindings.filter((b) => b.healthStatus === "healthy").length / group.bindings.length;
  const platformLatency = totalCalls > 0 ? weightedLatency / totalCalls : 0;
  const tenantsAtRisk = tenantBuckets.filter(
    (b) => b.tenantId !== TENANT_UNKNOWN_KEY && (b.unhealthyCount > 0 || b.degradedCount > 0),
  ).length;

  return html`
    <section class="platform-agents-bindings__group">
      <header
        class="platform-agents-bindings__group-header"
        @click=${() => toggleBindingGroup(group.key)}
        role="button"
        aria-expanded=${String(expanded)}
        tabindex="0"
      >
        <span class="platform-agents-bindings__group-toggle" aria-hidden="true"
          >${expanded ? "▼" : "▶"}</span
        >
        <span class="platform-agents-bindings__group-avatar is-capability">
          ${renderIcon("puzzle", "platform-agents-bindings__group-avatar-svg")}
        </span>
        <div class="platform-agents-bindings__group-copy">
          <div class="platform-agents-bindings__group-title">${group.primary.capabilityName}</div>
          <div class="platform-agents-bindings__group-sub">${group.primary.capabilityId}</div>
        </div>
        <div class="platform-agents-bindings__group-stats">
          <span>覆盖企业：<strong>${tenantCount}</strong></span>
          <span>装载机器人：<strong>${agentSet.size}</strong></span>
          <span>7 日调用：<strong>${totalCalls.toLocaleString()}</strong></span>
          <span>加权成功率：<strong>${(platformSuccessRate * 100).toFixed(1)}%</strong></span>
          <span>加权延迟：<strong>${Math.round(platformLatency)}ms</strong></span>
          <span>7 日错误：<strong>${totalErrors.toLocaleString()}</strong></span>
          ${
            tenantsAtRisk > 0
              ? html`<span class="platform-capabilities__chip is-warn"
                  >${tenantsAtRisk} 家企业有异常</span
                >`
              : nothing
          }
        </div>
      </header>
      ${
        expanded
          ? html`
              <div class="platform-agents-bindings__group-body">
                ${
                  tenantBuckets.length === 0
                    ? html`
                        <div class="platform-capabilities__empty platform-capabilities__empty--inline">
                          <div class="platform-capabilities__empty-copy">
                            <div class="platform-capabilities__empty-title">没有可统计的租户</div>
                            <div class="platform-capabilities__empty-sub">该能力当前未被任何已知租户装载。</div>
                          </div>
                        </div>
                      `
                    : html`
                        <div class="platform-agents-tenant-bucket-list">
                          ${tenantBuckets.map((bucket) =>
                            renderCapabilityTenantBucket(group.key, bucket, totalCalls, agentById),
                          )}
                        </div>
                      `
                }
              </div>
            `
          : nothing
      }
    </section>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 单个租户桶：默认折叠，展开后显示该租户内 agent 的明细表
//
// 折叠状态用 `${capabilityKey}::${tenantId}` 作 collapsed key，与外层能力卡片的折叠状态独立。
// ─────────────────────────────────────────────────────────────────────────

function renderCapabilityTenantBucket(
  capabilityKey: string,
  bucket: CapabilityTenantBucket,
  capabilityTotalCalls: number,
  agentById: Map<string, RuntimeAgent>,
) {
  const bucketKey = `${capabilityKey}::tenant::${bucket.tenantId}`;
  const collapsed = collapsedBindingGroups.has(bucketKey);
  const expanded = !collapsed;
  const successPercent = (bucket.weightedSuccessRate * 100).toFixed(1);
  const sharePercent =
    capabilityTotalCalls > 0 ? Math.round((bucket.calls7d / capabilityTotalCalls) * 1000) / 10 : 0;

  // 风险标签：unhealthy 优先于 degraded；都没有时不展示。
  const riskBadge =
    bucket.unhealthyCount > 0
      ? html`<span class="platform-capabilities__chip is-danger"
          >${bucket.unhealthyCount} 个机器人异常</span
        >`
      : bucket.degradedCount > 0
        ? html`<span class="platform-capabilities__chip is-warn"
            >${bucket.degradedCount} 个性能下降</span
          >`
        : nothing;

  return html`
    <section class="platform-agents-tenant-bucket ${expanded ? "is-expanded" : ""}">
      <header
        class="platform-agents-tenant-bucket__header"
        @click=${() => toggleBindingGroup(bucketKey)}
        role="button"
        aria-expanded=${String(expanded)}
        tabindex="0"
      >
        <span class="platform-agents-tenant-bucket__toggle" aria-hidden="true"
          >${expanded ? "▼" : "▶"}</span
        >
        <span class="platform-agents-tenant-bucket__avatar">
          ${renderIcon("building", "platform-agents-tenant-bucket__avatar-svg")}
        </span>
        <div class="platform-agents-tenant-bucket__copy">
          <div class="platform-agents-tenant-bucket__title">${bucket.tenantLabel}</div>
          <div class="platform-agents-tenant-bucket__sub">${bucket.tenantId}</div>
        </div>
        <div class="platform-agents-tenant-bucket__stats">
          <span>装载机器人：<strong>${bucket.agentSet.size}</strong></span>
          <span
            >7
            日调用：<strong>${bucket.calls7d.toLocaleString()}</strong>${
              sharePercent > 0
                ? html` <span class="platform-agents-tenant-bucket__share"
                    >(${sharePercent.toFixed(1)}% 占比)</span
                  >`
                : nothing
            }</span
          >
          <span>成功率：<strong>${successPercent}%</strong></span>
          <span>延迟：<strong>${Math.round(bucket.weightedAvgLatencyMs)}ms</strong></span>
          <span>错误：<strong>${bucket.errors7d.toLocaleString()}</strong></span>
          ${riskBadge}
        </div>
      </header>
      ${
        expanded
          ? html`
              <div class="platform-agents-tenant-bucket__body">
                ${renderBindingsTable(bucket.bindings, /* showAgentColumn */ true, agentById)}
              </div>
            `
          : nothing
      }
    </section>
  `;
}

function renderBindingsTable(
  bindings: RuntimeCapabilityBinding[],
  showAgentColumn: boolean,
  agentById?: Map<string, RuntimeAgent>,
) {
  const colSpan = 11; // checkbox + (agent | capability) + 8 data columns + action
  return html`
    <div class="platform-capabilities__distribution">
      <table class="platform-capabilities__distribution-table platform-agents-bindings__table">
        <thead>
          <tr>
            <th class="platform-agents-bindings__cell-checkbox" aria-label="选择"></th>
            ${
              showAgentColumn
                ? html`
                    <th>机器人</th>
                  `
                : html`
                    <th>能力名称</th>
                  `
            }
            <th>来源</th>
            <th>状态</th>
            <th>健康</th>
            <th>策略</th>
            <th>优先级</th>
            <th>调用</th>
            <th>成功率</th>
            <th>延迟</th>
            <th class="platform-agents-bindings__cell-action">操作</th>
          </tr>
        </thead>
        <tbody>
          ${bindings.map((b) => renderBindingDataRow(b, showAgentColumn, colSpan, agentById))}
        </tbody>
      </table>
    </div>
  `;
}

function renderBindingDataRow(
  b: RuntimeCapabilityBinding,
  showAgentColumn: boolean,
  colSpan: number,
  agentById?: Map<string, RuntimeAgent>,
) {
  const successPercent = (b.invocationMetrics.successRate7d * 100).toFixed(1);
  const latency = `${Math.round(b.invocationMetrics.avgLatencyMs)}ms`;
  const capabilityName = resolveCapabilityDisplayName(b.capabilityId);
  const checked = selectedBindingIds.has(b.bindingId);
  // Robot identity:
  //   - top line:   real display name from `agent.name` (e.g. "Aegis", "UPBEYOND")
  //                 falling back to a runtime-id-derived stub when the agent record is missing
  //   - sub line:   the encoded `runtimeAgentId` (e.g. "rt-aegis-99491024") so operators can copy it
  // The user's screenshot review pointed out that single-line "aegis" reads ambiguous between
  // "real robot name" and "tenant slug". Two-line stack disambiguates without losing either.
  const agent = agentById?.get(b.runtimeAgentId) ?? null;
  const robotLabel = agent
    ? resolveRobotDisplayName(agent)
    : fallbackRobotNameFromRuntimeId(b.runtimeAgentId);
  const detailExpanded = expandedBindingDetailIds.has(b.bindingId);

  // Derive per-row eligibility for inline actions. We never silently swallow
  // intent — disabled buttons show a tooltip explaining why they cannot fire.
  const canEnable = b.bindingState !== "active";
  const canDisable = b.bindingState !== "disabled";
  const isPrimary = b.routingPriority >= 100;
  const canPromote = b.bindingState === "active" && !isPrimary;
  const enableButton = mutationButtonState(
    canEnable,
    "已处于启用状态",
    "调用 agent-runtime.update-binding-state 启用这一条绑定",
  );
  const disableButton = mutationButtonState(
    canDisable,
    "已处于停用状态",
    "调用 agent-runtime.update-binding-state 停用这一条绑定",
  );
  const promoteButton = mutationButtonState(
    canPromote,
    isPrimary ? "已是主能力（routingPriority ≥ 100）" : "仅启用中的绑定可设为主能力",
    "调用 agent-runtime.update-binding-priority 将 routingPriority 设为 100",
  );

  const primaryCell = showAgentColumn
    ? html`
        <td>
          <button
            type="button"
            class="platform-agents-bindings__detail-toggle"
            aria-expanded=${String(detailExpanded)}
            aria-label=${`查看 ${capabilityName}（${robotLabel}）的详情`}
            @click=${() => toggleBindingDetail(b.bindingId)}
          >
            <span class="platform-agents-bindings__detail-caret" aria-hidden="true"
              >${detailExpanded ? "▼" : "▶"}</span
            >
            <span class="platform-capabilities__distribution-tenant-name">${robotLabel}</span>
          </button>
          <div class="platform-capabilities__distribution-tenant-id">${b.runtimeAgentId}</div>
        </td>
      `
    : html`
        <td>
          <button
            type="button"
            class="platform-agents-bindings__detail-toggle"
            aria-expanded=${String(detailExpanded)}
            aria-label=${`查看 ${capabilityName}（${robotLabel}）的详情`}
            @click=${() => toggleBindingDetail(b.bindingId)}
          >
            <span class="platform-agents-bindings__detail-caret" aria-hidden="true"
              >${detailExpanded ? "▼" : "▶"}</span
            >
            <span class="platform-capabilities__distribution-tenant-name">${capabilityName}</span>
          </button>
          <div class="platform-capabilities__distribution-tenant-id">v${b.capabilityVersion}</div>
        </td>
      `;

  return html`
    <tr
      class="platform-agents-bindings__data-row ${checked ? "is-selected" : ""} ${detailExpanded ? "is-expanded" : ""}"
    >
      <td class="platform-agents-bindings__cell-checkbox">
        <input
          type="checkbox"
          aria-label="选择该绑定"
          data-testid="binding-row-select"
          data-binding-id=${b.bindingId}
          .checked=${checked}
          @change=${(e: Event) => toggleBindingSelection(b.bindingId, (e.target as HTMLInputElement).checked)}
        />
      </td>
      ${primaryCell}
      <td>
        <span class="platform-capabilities__chip">${BINDING_TYPE_LABELS[b.bindingType]}</span>
      </td>
      <td>
        <span class="platform-capabilities__chip is-${BINDING_STATE_TONES[b.bindingState]}">
          ${BINDING_STATE_LABELS[b.bindingState]}
        </span>
      </td>
      <td>
        <span class="platform-capabilities__chip is-${HEALTH_TONES[b.healthStatus]}">
          ${HEALTH_LABELS[b.healthStatus]}
        </span>
      </td>
      <td>${LOAD_STRATEGY_LABELS[b.loadStrategy]}</td>
      <td>
        ${b.routingPriority}${
          isPrimary
            ? html`
                <span class="platform-agents-bindings__primary-tag" title="主能力">主</span>
              `
            : nothing
        }
      </td>
      <td>${b.invocationMetrics.calls7d.toLocaleString()}</td>
      <td>${successPercent}%</td>
      <td>${latency}</td>
      <td class="platform-agents-bindings__cell-action">
        <div
          class="platform-agents-bindings__row-actions"
          role="group"
          aria-label="行内操作"
          data-testid="binding-row-actions"
          data-binding-id=${b.bindingId}
        >
          <button
            type="button"
            class="btn btn--small btn--ghost"
            data-testid="binding-row-enable"
            ?disabled=${enableButton.disabled}
            title=${enableButton.title}
            aria-label=${enableButton.title}
            @click=${() => void commitBindingRowMutation(enableBindingMutation(b))}
          >
            启用
          </button>
          <button
            type="button"
            class="btn btn--small btn--ghost"
            data-testid="binding-row-disable"
            ?disabled=${disableButton.disabled}
            title=${disableButton.title}
            aria-label=${disableButton.title}
            @click=${() => void commitBindingRowMutation(disableBindingMutation(b))}
          >
            停用
          </button>
          <button
            type="button"
            class="btn btn--small btn--ghost"
            data-testid="binding-row-promote"
            ?disabled=${promoteButton.disabled}
            title=${promoteButton.title}
            aria-label=${promoteButton.title}
            @click=${() => void commitBindingRowMutation(promoteBindingMutation(b))}
          >
            设主能力
          </button>
        </div>
      </td>
    </tr>
    ${
      detailExpanded
        ? html`
            <tr class="platform-agents-bindings__detail-row">
              <td colspan=${colSpan}>${renderBindingDetailCard(b, capabilityName, robotLabel)}</td>
            </tr>
          `
        : nothing
    }
  `;
}

/**
 * 行内能力详情卡。结构对齐线框：
 *   能力详情：<name>
 *   - 来源：<企业安装/平台默认/...>
 *   - 版本：v1.2.0
 *   - 安装时间：2026-03-01
 *   - 📊 运行指标：成功率 / 平均延迟 / 7 日调用 / P95 延迟 / 7 日错误
 *   - ⚠ 风险（占位，等冲突检测器接通后填充真实数据）
 *   - 🎛 控制：[设为主能力] [降级为备选] [停用]
 */
function renderBindingDetailCard(
  b: RuntimeCapabilityBinding,
  capabilityName: string,
  robotLabel: string,
) {
  const successPercent = (b.invocationMetrics.successRate7d * 100).toFixed(1);
  const installedAt = b.createdAt > 0 ? new Date(b.createdAt).toISOString().slice(0, 10) : "未知";
  const updatedAgo =
    b.updatedAt > 0 ? formatRelativeTime(Math.max(0, Date.now() - b.updatedAt)) : "—";
  const isPrimary = b.routingPriority >= 100;
  const canDisable = b.bindingState !== "disabled";
  const canPromote = b.bindingState === "active" && !isPrimary;
  const canDemote = isPrimary;
  const promoteButton = mutationButtonState(
    canPromote,
    "当前绑定不能设为主能力",
    "调用 agent-runtime.update-binding-priority 将 routingPriority 设为 100",
  );
  const demoteButton = mutationButtonState(
    canDemote,
    "已不是主能力。降级只写 routingPriority=50，不会修改 bindingType",
    "调用 agent-runtime.update-binding-priority 将 routingPriority 设为 50",
  );
  const disableButton = mutationButtonState(
    canDisable,
    "已处于停用状态",
    "调用 agent-runtime.update-binding-state 停用这一条绑定",
  );
  const strategyButton = mutationButtonState(
    true,
    "",
    "调用 agent-runtime.update-binding-strategy 修改这一条绑定的加载策略",
  );

  return html`
    <article class="platform-agents-binding-detail" aria-label=${`能力详情：${capabilityName}`}>
      <header class="platform-agents-binding-detail__header">
        <div>
          <div class="platform-agents-binding-detail__title">能力详情：${capabilityName}</div>
          <div class="platform-agents-binding-detail__sub">
            机器人 ${robotLabel} · 绑定 ${b.bindingId}
          </div>
        </div>
        <button
          type="button"
          class="btn btn--ghost btn--small"
          @click=${() => toggleBindingDetail(b.bindingId)}
          aria-label="收起详情"
        >
          收起
        </button>
      </header>

      <div class="platform-agents-binding-detail__grid">
        <section>
          <h4 class="platform-agents-binding-detail__section-title">基本信息</h4>
          <dl class="platform-agents-binding-detail__list">
            <div>
              <dt>来源</dt>
              <dd>${BINDING_TYPE_LABELS[b.bindingType]}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>v${b.capabilityVersion}</dd>
            </div>
            <div>
              <dt>能力 ID</dt>
              <dd class="platform-agents-binding-detail__mono">${b.capabilityId}</dd>
            </div>
            <div>
              <dt>安装时间</dt>
              <dd>${installedAt}</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>${updatedAgo}</dd>
            </div>
            <div>
              <dt>沙箱策略</dt>
              <dd>${b.policy.sandbox} · 资源 ${b.policy.resourceQuota}</dd>
            </div>
            <div>
              <dt>热重载</dt>
              <dd>${b.policy.hotReloadable ? "已开启" : "已关闭"}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h4 class="platform-agents-binding-detail__section-title">📊 运行指标（7 日）</h4>
          <dl class="platform-agents-binding-detail__list">
            <div>
              <dt>调用次数</dt>
              <dd>${b.invocationMetrics.calls7d.toLocaleString()}</dd>
            </div>
            <div>
              <dt>成功率</dt>
              <dd>${successPercent}%</dd>
            </div>
            <div>
              <dt>错误次数</dt>
              <dd>${b.invocationMetrics.errorCount7d.toLocaleString()}</dd>
            </div>
            <div>
              <dt>平均延迟</dt>
              <dd>${Math.round(b.invocationMetrics.avgLatencyMs)}ms</dd>
            </div>
            <div>
              <dt>P95 延迟</dt>
              <dd>${Math.round(b.invocationMetrics.p95LatencyMs)}ms</dd>
            </div>
            <div>
              <dt>Token 消耗</dt>
              <dd>${b.invocationMetrics.tokenConsumption7d.toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h4 class="platform-agents-binding-detail__section-title">⚠ 风险信号</h4>
          <ul class="platform-agents-binding-detail__signal-list">
            ${
              b.invocationMetrics.successRate7d < 0.9
                ? html`<li class="is-warn">成功率低于 90%（${successPercent}%）</li>`
                : nothing
            }
            ${
              b.invocationMetrics.avgLatencyMs > 1000
                ? html`<li class="is-warn">
                    平均延迟超 1s（${Math.round(b.invocationMetrics.avgLatencyMs)}ms）
                  </li>`
                : nothing
            }
            ${
              b.bindingState === "degraded"
                ? html`
                    <li class="is-warn">绑定处于性能下降状态</li>
                  `
                : nothing
            }
            ${
              b.healthStatus === "unhealthy"
                ? html`
                    <li class="is-danger">绑定健康异常，建议立即排查</li>
                  `
                : nothing
            }
            ${
              b.invocationMetrics.successRate7d >= 0.9 &&
              b.invocationMetrics.avgLatencyMs <= 1000 &&
              b.bindingState !== "degraded" &&
              b.healthStatus !== "unhealthy"
                ? html`
                    <li class="is-ok">未检测到风险信号</li>
                  `
                : nothing
            }
          </ul>
          <div class="platform-agents-binding-detail__footnote">
            同类能力冲突检测会在 capability-conflict detector 上线后并入此处。
          </div>
        </section>
      </div>

      <footer class="platform-agents-binding-detail__footer">
        <span class="platform-agents-binding-detail__footer-label">🎛 控制</span>
        <div
          class="platform-agents-binding-detail__footer-actions"
          data-testid="binding-detail-actions"
          data-binding-id=${b.bindingId}
        >
          <button
            type="button"
            class="btn btn--small"
            data-testid="binding-detail-promote"
            ?disabled=${promoteButton.disabled}
            title=${promoteButton.title}
            @click=${() => void commitBindingRowMutation(promoteBindingMutation(b))}
          >
            设为主能力
          </button>
          <button
            type="button"
            class="btn btn--small btn--ghost"
            data-testid="binding-detail-demote"
            ?disabled=${demoteButton.disabled}
            title=${demoteButton.title}
            @click=${() => void commitBindingRowMutation(demoteBindingMutation(b))}
          >
            降级为备选
          </button>
          <button
            type="button"
            class="btn btn--small btn--ghost"
            data-testid="binding-detail-disable"
            ?disabled=${disableButton.disabled}
            title=${disableButton.title}
            @click=${() => void commitBindingRowMutation(disableBindingMutation(b))}
          >
            停用
          </button>
          <label>
            加载策略
            <select
              data-testid="binding-strategy"
              .value=${b.loadStrategy}
              ?disabled=${strategyButton.disabled}
              title=${strategyButton.title}
              @change=${(event: Event) => {
                const next = (event.target as HTMLSelectElement).value as LoadStrategy;
                if (next === b.loadStrategy) {
                  return;
                }
                void commitBindingRowMutation(strategyBindingMutation(b, next));
              }}
            >
              <option value="eager">预加载</option>
              <option value="lazy">延迟加载</option>
              <option value="on-demand">按需加载</option>
            </select>
          </label>
        </div>
      </footer>
    </article>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 标签页 3：策略中心（Policy Center）
// 当前策略全部为只读展示。后端策略 API 接通后，将切换到带表单 + 保存按钮的
// 编辑视图；当前点击交互的按钮统一弹出"接口未接通"提示，避免误以为已生效。
// ─────────────────────────────────────────────────────────────────────────

function renderPolicyCenterTab(agents: RuntimeAgent[], bindings: RuntimeCapabilityBinding[]) {
  maybeLoadRuntimePolicy();
  const stateCounts = bindings.reduce<Record<BindingState, number>>(
    (acc, b) => {
      acc[b.bindingState] += 1;
      return acc;
    },
    { active: 0, warming: 0, degraded: 0, disabled: 0 },
  );
  const strategyCounts = bindings.reduce<Record<LoadStrategy, number>>(
    (acc, b) => {
      acc[b.loadStrategy] += 1;
      return acc;
    },
    { eager: 0, lazy: 0, "on-demand": 0 },
  );
  const tenantCount = new Set(agents.flatMap((a) => a.tenantCoverage)).size;
  const policy = policyEditing ? policyDraft : policyDocument;
  const kinds = Object.entries(policy?.loadDefaults?.byCapabilityKind ?? {});
  const editGate = mutationButtonState(
    policyLoadState === "ready",
    policyLoadError || "策略源尚未读取完成",
    "编辑 agent-runtime.policy",
  );
  const rateTitle = `${RUNTIME_POLICY_RATE_UNIT_COPY.perCapabilityQps} ${RUNTIME_POLICY_RATE_UNIT_COPY.perTenantDailyCap} 鉴权限流不是这张卡片的数据源。`;
  return html`
    <div class="platform-agents-policy">
      ${
        policyNotice
          ? html`<p class="muted" role="status" data-testid="policy-notice">${policyNotice}</p>`
          : nothing
      }
      ${
        policyLoadError
          ? html`<p class="muted" role="status" data-testid="policy-load-error">${policyLoadError}</p>`
          : nothing
      }
      ${renderPolicyCard({
        title: "能力加载策略",
        body: html`
          <dl class="platform-agents-policy__list">
            <div class="platform-agents-policy__row">
              <dt>默认策略</dt>
              <dd data-testid="policy-default-value">${loadStrategyLabel(policy?.loadDefaults?.default)}</dd>
            </div>
            ${
              kinds.length === 0
                ? html`
                    <div class="platform-agents-policy__row">
                      <dt>类型策略</dt>
                      <dd>未接入</dd>
                    </div>
                  `
                : kinds.map(
                    ([kind, strategy]) => html`
                      <div class="platform-agents-policy__row">
                        <dt>类型策略：${kind}</dt>
                        <dd>${loadStrategyLabel(strategy)}</dd>
                      </div>
                    `,
                  )
            }
          </dl>
          ${
            policyEditing
              ? html`<label>
                  默认策略
                  <select
                    data-testid="policy-default-strategy"
                    .value=${policyDraft?.loadDefaults?.default ?? ""}
                    @change=${(event: Event) => {
                      const draft = ensurePolicyDraft();
                      const value = (event.target as HTMLSelectElement).value;
                      draft.loadDefaults = {
                        default: value ? (value as LoadStrategy) : null,
                        byCapabilityKind: draft.loadDefaults?.byCapabilityKind ?? {},
                      };
                      policyDraft = draft;
                      requestRerender();
                    }}
                  >
                    <option value="">未配置</option>
                    <option value="eager">预加载</option>
                    <option value="lazy">延迟加载</option>
                    <option value="on-demand">按需加载</option>
                  </select>
                </label>`
              : nothing
          }
          <div class="platform-agents-policy__meta">
            当前已生效：预加载 ${strategyCounts.eager} · 延迟 ${strategyCounts.lazy} · 按需
            ${strategyCounts["on-demand"]}
          </div>
        `,
      })}
      ${renderPolicyCard({
        title: "冲突治理策略",
        body: html`
          <fieldset class="platform-agents-policy__radios" ?disabled=${!policyEditing}>
            <p class="muted">
              ${policy?.conflict ? CONFLICT_LABELS[policy.conflict] : "未接入。下面的选项不是当前策略。"}
            </p>
            ${(["highest-success", "priority", "manual"] as const).map(
              (value) => html`
                <label>
                  <input
                    type="radio"
                    name="conflict-policy"
                    data-testid=${`policy-conflict-${value}`}
                    .checked=${policy?.conflict === value}
                    ?disabled=${!policyEditing}
                    @change=${() => {
                      const draft = ensurePolicyDraft();
                      draft.conflict = value as RuntimePolicyConflict;
                      policyDraft = draft;
                      requestRerender();
                    }}
                  />
                  ${CONFLICT_LABELS[value]}
                </label>
              `,
            )}
          </fieldset>
        `,
      })}
      ${renderPolicyCard({
        title: "Fallback 策略",
        body: html`
          <dl class="platform-agents-policy__list">
            <div class="platform-agents-policy__row">
              <dt>主能力失败后</dt>
              <dd data-testid="policy-fallback-value">${formatFallbackMode(policy?.fallback.mode)}</dd>
            </div>
            <div class="platform-agents-policy__row">
              <dt>降级备选绑定</dt>
              <dd data-testid="policy-fallback-binding-note">
                ${bindings.filter((b) => b.bindingType === "fallback").length} 条绑定类型为降级备选。fallbackBindingId
                写在单条绑定上，不是这里的 fallback.mode。
              </dd>
            </div>
          </dl>
          <p class="muted">${RUNTIME_POLICY_RATE_UNIT_COPY.fallback}</p>
          ${
            policyEditing
              ? html`<label>
                  Fallback
                  <select
                    data-testid="policy-fallback-mode"
                    .value=${policyDraft?.fallback.mode ?? ""}
                    @change=${(event: Event) => {
                      const draft = ensurePolicyDraft();
                      const value = (event.target as HTMLSelectElement).value;
                      draft.fallback = {
                        mode: value ? (value as RuntimePolicyFallbackMode) : null,
                      };
                      policyDraft = draft;
                      requestRerender();
                    }}
                  >
                    <option value="">未配置</option>
                    <option value="auto-standby">自动切换备用</option>
                    <option value="none">不自动切换</option>
                  </select>
                </label>`
              : nothing
          }
        `,
      })}
      ${renderPolicyCard({
        title: "限流策略",
        body: html`
          <dl class="platform-agents-policy__list">
            <div class="platform-agents-policy__row">
              <dt>每能力 QPS</dt>
              <dd data-testid="policy-qps" title=${rateTitle}>
                ${formatPerCapabilityQps(policy?.rateLimit?.perCapabilityQps)}
              </dd>
            </div>
            <div class="platform-agents-policy__row">
              <dt>每租户每日上限</dt>
              <dd data-testid="policy-daily-cap" title=${rateTitle}>
                ${formatPerTenantDailyCap(policy?.rateLimit?.perTenantDailyCap)}
              </dd>
            </div>
            <div class="platform-agents-policy__row">
              <dt>当前覆盖租户</dt>
              <dd>${tenantCount}</dd>
            </div>
          </dl>
          <p class="muted" data-testid="policy-rate-units">
            ${RUNTIME_POLICY_RATE_UNIT_COPY.perCapabilityQps}
            ${RUNTIME_POLICY_RATE_UNIT_COPY.perTenantDailyCap}
          </p>
          ${
            policyEditing
              ? html`<div>
                  <label>
                    每能力 QPS（${"次/秒"}）
                    <input
                      data-testid="policy-qps-input"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="未配置"
                      .value=${
                        policyDraft?.rateLimit?.perCapabilityQps === null ||
                        policyDraft?.rateLimit?.perCapabilityQps === undefined
                          ? ""
                          : String(policyDraft.rateLimit.perCapabilityQps)
                      }
                      @input=${(event: Event) => {
                        const draft = ensurePolicyDraft();
                        const raw = (event.target as HTMLInputElement).value.trim();
                        draft.rateLimit = {
                          perCapabilityQps: raw === "" ? null : Number(raw),
                          perTenantDailyCap: draft.rateLimit?.perTenantDailyCap ?? null,
                        };
                        policyDraft = draft;
                      }}
                    />
                  </label>
                  <label>
                    每租户每日上限（次/天）
                    <input
                      data-testid="policy-daily-input"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="未配置"
                      .value=${
                        policyDraft?.rateLimit?.perTenantDailyCap === null ||
                        policyDraft?.rateLimit?.perTenantDailyCap === undefined
                          ? ""
                          : String(policyDraft.rateLimit.perTenantDailyCap)
                      }
                      @input=${(event: Event) => {
                        const draft = ensurePolicyDraft();
                        const raw = (event.target as HTMLInputElement).value.trim();
                        draft.rateLimit = {
                          perCapabilityQps: draft.rateLimit?.perCapabilityQps ?? null,
                          perTenantDailyCap: raw === "" ? null : Number(raw),
                        };
                        policyDraft = draft;
                      }}
                    />
                  </label>
                </div>`
              : nothing
          }
        `,
      })}

      <div class="platform-agents-policy__footer">
        <span class="muted">
          策略来自 agent-runtime.policy.get / update。QPS 是每个能力的每秒请求数，每日上限是每个租户的每天请求数。fallback.mode
          是全局规则；fallbackBindingId 留在绑定上。
        </span>
        ${
          policyEditing
            ? html`<button
                type="button"
                class="btn btn--small"
                data-testid="policy-save"
                ?disabled=${policyBusy}
                @click=${() => void commitRuntimePolicy()}
              >
                保存策略
              </button>`
            : html`<button
                type="button"
                class="btn btn--small"
                data-testid="policy-edit"
                ?disabled=${editGate.disabled}
                title=${editGate.title}
                @click=${() => {
                  policyDraft = ensurePolicyDraft();
                  policyEditing = true;
                  requestRerender();
                }}
              >
                编辑策略
              </button>`
        }
      </div>

      ${renderPolicyGovernanceSummary(agents, bindings, stateCounts)}
    </div>
  `;
}

function renderPolicyCard(params: { title: string; body: unknown }) {
  return html`
    <section class="card platform-agents-policy__card">
      <div class="card-title">${params.title}</div>
      <div class="platform-agents-policy__card-body">${params.body}</div>
    </section>
  `;
}

function renderPolicyGovernanceSummary(
  agents: RuntimeAgent[],
  bindings: RuntimeCapabilityBinding[],
  stateCounts: Record<BindingState, number>,
) {
  const issues = detectGovernanceIssues(agents, bindings, undefined, Date.now());
  const issuesByCategory = new Map<RuntimeGovernanceIssueCategory, number>();
  for (const issue of issues) {
    issuesByCategory.set(issue.category, (issuesByCategory.get(issue.category) ?? 0) + 1);
  }
  const conflicts = issuesByCategory.get("capability-conflict") ?? 0;
  const zombies = issuesByCategory.get("zombie-binding") ?? 0;
  const lowSuccess = bindings.filter((b) => b.invocationMetrics.successRate7d < 0.9).length;
  const fixButton = mutationButtonState(
    true,
    "",
    `调用 ${GOVERNANCE_FIX_METHOD}，确认后执行，不会逐条调用 update-binding-state`,
  );

  return html`
    <section class="card platform-agents-policy__card platform-agents-policy__card--issues">
      <div class="card-title">治理问题</div>
      <ul class="platform-agents-policy__issue-list">
        <li>
          <span class="platform-capabilities__chip is-warn"
            >${renderIcon("alertTriangle", "platform-agents-policy__issue-icon")}</span
          >
          冲突能力：<strong>${conflicts}</strong> 个
          <button
            type="button"
            class="btn btn--ghost btn--small"
            data-testid="governance-fix-capability-conflict"
            ?disabled=${fixButton.disabled || governanceFixBusy}
            title=${fixButton.title}
            @click=${() => void commitGovernanceFix("capability-conflict")}
          >
            一键修复
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            @click=${() => activateTab("health")}
          >
            查看详情
          </button>
        </li>
        <li>
          <span class="platform-capabilities__chip is-warn"
            >${renderIcon("alertTriangle", "platform-agents-policy__issue-icon")}</span
          >
          僵尸能力（30 天未调用）：<strong>${zombies}</strong> 个
          <button
            type="button"
            class="btn btn--ghost btn--small"
            data-testid="governance-fix-zombie-binding"
            ?disabled=${fixButton.disabled || governanceFixBusy}
            title=${fixButton.title}
            @click=${() => void commitGovernanceFix("zombie-binding")}
          >
            一键修复
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            @click=${() => activateTab("health")}
          >
            查看详情
          </button>
        </li>
        <li>
          <span class="platform-capabilities__chip is-warn"
            >${renderIcon("alertTriangle", "platform-agents-policy__issue-icon")}</span
          >
          低成功率能力（&lt; 90%）：<strong>${lowSuccess}</strong> 个
          <button
            type="button"
            class="btn btn--ghost btn--small"
            data-testid="governance-fix-low-success"
            disabled
            title=${LOW_SUCCESS_FIX_DEFER_REASON}
          >
            一键修复
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            @click=${() => activateTab("health")}
          >
            查看详情
          </button>
        </li>
        <li>
          <span class="platform-capabilities__chip is-neutral">·</span>
          停用绑定：<strong>${stateCounts.disabled}</strong> 条
        </li>
      </ul>
      ${
        governanceFixNotice
          ? html`<p class="muted" role="status" data-testid="governance-fix-notice">
              ${governanceFixNotice}
            </p>`
          : nothing
      }
      <div class="muted stat-note">
        一键修复调用 ${GOVERNANCE_FIX_METHOD}。僵尸绑定会停用，缺失的降级目标会清空。冲突和版本漂移没有安全的版本目标，会记在
        skipped。不会逐条调用 update-binding-state。
      </div>
    </section>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 标签页 4：Runtime Health（Task 19）
// ─────────────────────────────────────────────────────────────────────────

function renderRuntimeHealthTab(
  agents: RuntimeAgent[],
  bindings: RuntimeCapabilityBinding[],
  telemetry: RuntimeTelemetry[],
) {
  const groups: Record<
    RuntimeHealth,
    { agents: RuntimeAgent[]; bindings: RuntimeCapabilityBinding[] }
  > = {
    healthy: { agents: [], bindings: [] },
    degraded: { agents: [], bindings: [] },
    unhealthy: { agents: [], bindings: [] },
    unavailable: { agents: [], bindings: [] },
  };
  for (const a of agents) {
    groups[a.health].agents.push(a);
  }
  for (const b of bindings) {
    groups[b.healthStatus].bindings.push(b);
  }

  const allHealthy =
    groups.degraded.agents.length === 0 &&
    groups.unhealthy.agents.length === 0 &&
    groups.unavailable.agents.length === 0 &&
    groups.degraded.bindings.length === 0 &&
    groups.unhealthy.bindings.length === 0 &&
    groups.unavailable.bindings.length === 0;

  const trendStub = renderHealthTrend(bindings, telemetry);
  const governanceIssues = renderRuntimeHealthGovernance(agents, bindings);

  if (allHealthy) {
    return html`
      ${trendStub}
      <div class="platform-capabilities__empty is-ok">
        ${renderIcon("checkCircle", "platform-capabilities__empty-icon is-ok")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">健康状态良好</div>
          <div class="platform-capabilities__empty-sub">
            全部机器人运行实例与能力绑定均处于健康状态。
          </div>
        </div>
      </div>
      ${governanceIssues}
    `;
  }

  const renderGroup = (
    severity: "critical" | "warning" | "info",
    label: string,
    items: Array<{ kind: "agent" | "binding"; entry: RuntimeAgent | RuntimeCapabilityBinding }>,
  ) => {
    if (items.length === 0) {
      return nothing;
    }
    return html`
      <section class="platform-capabilities__health-group is-${severity}">
        <header class="platform-capabilities__health-group-header">
          ${renderIcon(
            severity === "critical"
              ? "alertTriangle"
              : severity === "warning"
                ? "alertCircle"
                : "info",
            "platform-capabilities__health-group-icon",
          )}
          <span class="platform-capabilities__health-group-label">${label}</span>
          <span class="platform-capabilities__health-group-count">${items.length}</span>
        </header>
        <div class="platform-capabilities__health-group-items">
          ${items.map((item) => renderHealthItem(item.kind, item.entry))}
        </div>
      </section>
    `;
  };

  // 不可用 → 严重；异常 → 高；性能下降 → 中
  const critical: Array<{
    kind: "agent" | "binding";
    entry: RuntimeAgent | RuntimeCapabilityBinding;
  }> = [
    ...groups.unavailable.agents.map((entry) => ({ kind: "agent" as const, entry })),
    ...groups.unavailable.bindings.map((entry) => ({ kind: "binding" as const, entry })),
  ];
  const warning: Array<{
    kind: "agent" | "binding";
    entry: RuntimeAgent | RuntimeCapabilityBinding;
  }> = [
    ...groups.unhealthy.agents.map((entry) => ({ kind: "agent" as const, entry })),
    ...groups.unhealthy.bindings.map((entry) => ({ kind: "binding" as const, entry })),
  ];
  const info: Array<{ kind: "agent" | "binding"; entry: RuntimeAgent | RuntimeCapabilityBinding }> =
    [
      ...groups.degraded.agents.map((entry) => ({ kind: "agent" as const, entry })),
      ...groups.degraded.bindings.map((entry) => ({ kind: "binding" as const, entry })),
    ];

  return html`
    ${trendStub}
    <div class="platform-capabilities__health-list">
      ${renderGroup("critical", "不可用", critical)} ${renderGroup("warning", "异常", warning)}
      ${renderGroup("info", "性能下降", info)}
    </div>
    ${governanceIssues}
  `;
}

/**
 * 健康状态页顶部趋势区。当 telemetry 时序样本可用时调用 TelemetryMiniChart
 * 渲染真实的成功率 / 延迟 mini-sparkline；样本为空时退化为 KPI 数字 + 显式
 * 提示，避免在 UI 上谎称有时间序列。两种渲染都基于真实数据。
 */
function renderHealthTrend(bindings: RuntimeCapabilityBinding[], telemetry: RuntimeTelemetry[]) {
  if (bindings.length === 0) {
    return nothing;
  }
  const totalCalls = bindings.reduce((sum, b) => sum + b.invocationMetrics.calls7d, 0);
  const avgSuccess =
    bindings.reduce((sum, b) => sum + b.invocationMetrics.successRate7d, 0) /
    Math.max(1, bindings.length);
  const avgLatency =
    bindings.reduce((sum, b) => sum + b.invocationMetrics.avgLatencyMs, 0) /
    Math.max(1, bindings.length);
  const hasSamples = telemetry.length >= 2;
  return html`
    <section class="platform-agents-health-trend">
      <article class="platform-agents-health-trend__card">
        <div class="platform-agents-health-trend__title">📉 能力成功率趋势</div>
        <div class="platform-agents-health-trend__value">${(avgSuccess * 100).toFixed(1)}%</div>
        <div class="platform-agents-health-trend__chart">
          ${
            hasSamples
              ? renderTelemetryMiniChart({
                  samples: telemetry,
                  metric: "error-rate",
                  width: 260,
                  height: 56,
                })
              : html`
                  <div class="platform-agents-health-trend__chart-empty">
                    暂无时序样本（需要 ≥ 2 条 telemetry 采样）
                  </div>
                `
          }
        </div>
        <div class="platform-agents-health-trend__sub">
          ${totalCalls.toLocaleString()} 次调用聚合（7 日窗口）
        </div>
      </article>
      <article class="platform-agents-health-trend__card">
        <div class="platform-agents-health-trend__title">📉 延迟趋势</div>
        <div class="platform-agents-health-trend__value">${Math.round(avgLatency)}ms</div>
        <div class="platform-agents-health-trend__chart">
          ${
            hasSamples
              ? renderTelemetryMiniChart({
                  samples: telemetry,
                  metric: "avg-latency",
                  width: 260,
                  height: 56,
                })
              : html`
                  <div class="platform-agents-health-trend__chart-empty">暂无时序样本</div>
                `
          }
        </div>
        <div class="platform-agents-health-trend__sub">
          来自 ${telemetry.length} 条 telemetry 采样
        </div>
      </article>
    </section>
  `;
}

function renderRuntimeHealthGovernance(
  agents: RuntimeAgent[],
  bindings: RuntimeCapabilityBinding[],
) {
  const issues = detectGovernanceIssues(agents, bindings, undefined, Date.now());
  if (issues.length === 0) {
    return nothing;
  }
  const groupBySeverity: Record<RuntimeGovernanceIssue["severity"], RuntimeGovernanceIssue[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const issue of issues) {
    groupBySeverity[issue.severity].push(issue);
  }

  const renderSeverityGroup = (
    severity: RuntimeGovernanceIssue["severity"],
    label: string,
    visual: "critical" | "warning" | "info",
  ) => {
    const list = groupBySeverity[severity];
    if (list.length === 0) {
      return nothing;
    }
    return html`
      <section class="platform-capabilities__health-group is-${visual}">
        <header class="platform-capabilities__health-group-header">
          ${renderIcon(
            visual === "critical" ? "alertTriangle" : visual === "warning" ? "alertCircle" : "info",
            "platform-capabilities__health-group-icon",
          )}
          <span class="platform-capabilities__health-group-label">异常能力 · ${label}</span>
          <span class="platform-capabilities__health-group-count">${list.length}</span>
        </header>
        <div class="platform-capabilities__health-group-items">
          ${list.map((issue) => renderGovernanceIssueCard(issue))}
        </div>
      </section>
    `;
  };

  return html`
    <div class="platform-capabilities__health-list card-follow">
      ${renderSeverityGroup("critical", "严重", "critical")}
      ${renderSeverityGroup("high", "高", "critical")}
      ${renderSeverityGroup("medium", "中", "warning")} ${renderSeverityGroup("low", "低", "info")}
    </div>
  `;
}

function renderHealthItem(
  kind: "agent" | "binding",
  entry: RuntimeAgent | RuntimeCapabilityBinding,
) {
  if (kind === "agent") {
    const a = entry as RuntimeAgent;
    const robotName = resolveRobotDisplayName(a);
    return html`
      <article
        class="platform-capabilities__health-item is-${HEALTH_TONES[a.health] === "ok" ? "info" : HEALTH_TONES[a.health]}"
      >
        <span
          class="platform-capabilities__health-item-icon is-${HEALTH_TONES[a.health] === "ok" ? "info" : HEALTH_TONES[a.health]}"
        >
          ${renderIcon("brain", "platform-capabilities__health-item-icon-svg")}
        </span>
        <div class="platform-capabilities__health-item-body">
          <div class="platform-capabilities__health-item-row">
            <div class="platform-capabilities__health-item-title">${robotName}</div>
            <span class="platform-capabilities__health-item-category"
              >机器人 · ${LIFECYCLE_LABELS[a.lifecycle]}</span
            >
          </div>
          <div class="platform-capabilities__health-item-sub">
            处理器 ${Math.round(a.resourceUsage.cpuPercent)}% · 内存
            ${Math.round(a.resourceUsage.memoryPercent)}% · 活跃会话 ${a.activeSessionCount}
          </div>
          <div class="platform-capabilities__health-item-meta">
            最近活跃：${a.lastActiveAt === 0 ? "无记录" : formatRelativeTime(Date.now() - a.lastActiveAt)}
          </div>
        </div>
      </article>
    `;
  }
  const b = entry as RuntimeCapabilityBinding;
  const successPercent = (b.invocationMetrics.successRate7d * 100).toFixed(1);
  const capabilityName = resolveCapabilityDisplayName(b.capabilityId);
  return html`
    <article
      class="platform-capabilities__health-item is-${HEALTH_TONES[b.healthStatus] === "ok" ? "info" : HEALTH_TONES[b.healthStatus]}"
    >
      <span
        class="platform-capabilities__health-item-icon is-${HEALTH_TONES[b.healthStatus] === "ok" ? "info" : HEALTH_TONES[b.healthStatus]}"
      >
        ${renderIcon("puzzle", "platform-capabilities__health-item-icon-svg")}
      </span>
      <div class="platform-capabilities__health-item-body">
        <div class="platform-capabilities__health-item-row">
          <div class="platform-capabilities__health-item-title">
            ${capabilityName} · v${b.capabilityVersion}
          </div>
          <span class="platform-capabilities__health-item-category"
            >绑定 · ${BINDING_STATE_LABELS[b.bindingState]}</span
          >
        </div>
        <div class="platform-capabilities__health-item-sub">
          7 日调用 ${b.invocationMetrics.calls7d.toLocaleString()} · 成功率 ${successPercent}% · P95
          延迟 ${Math.round(b.invocationMetrics.p95LatencyMs)}ms
        </div>
        <div class="platform-capabilities__health-item-meta">
          机器人运行实例：${fallbackRobotNameFromRuntimeId(b.runtimeAgentId)}
        </div>
      </div>
    </article>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 标签页 4：Deployment Lifecycle（Task 22）
// ─────────────────────────────────────────────────────────────────────────

function renderDeploymentLifecycleTab(agents: RuntimeAgent[]) {
  if (agents.length === 0) {
    return html`
      <div class="platform-capabilities__empty">
        ${renderIcon("server", "platform-capabilities__empty-icon")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">暂无机器人运行实例</div>
        </div>
      </div>
    `;
  }
  const groups: Record<RuntimeLifecycle, RuntimeAgent[]> = {
    deployed: [],
    draining: [],
    suspended: [],
    deprecated: [],
    archived: [],
  };
  for (const a of agents) {
    groups[a.lifecycle].push(a);
  }

  const renderLifecycleSection = (lifecycle: RuntimeLifecycle) => {
    const list = groups[lifecycle];
    return html`
      <section class="card">
        <div class="row row--split">
          <div>
            <div class="card-title">${LIFECYCLE_LABELS[lifecycle]} (${list.length})</div>
            ${
              isTerminalLifecycle(lifecycle)
                ? html`
                    <div class="card-sub">终态：不再支持状态转换</div>
                  `
                : nothing
            }
          </div>
        </div>
        ${
          list.length === 0
            ? html`
                <div class="muted card-follow--sm">该状态下暂无机器人运行实例</div>
              `
            : html`
                <div class="list card-follow--sm">
                  ${list.map((a) => {
                    const robotName = resolveRobotDisplayName(a);
                    return html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${robotName}</div>
                          <div class="list-sub">
                            运行版本 v${a.runtimeVersion} · 绑定 ${a.boundCapabilityCount} 条 ·
                            活跃会话 ${a.activeSessionCount}
                          </div>
                        </div>
                        <div class="list-meta">
                          <span class="platform-capabilities__chip is-${HEALTH_TONES[a.health]}">
                            ${HEALTH_LABELS[a.health]}
                          </span>
                        </div>
                      </div>
                    `;
                  })}
                </div>
              `
        }
      </section>
    `;
  };

  return html`
    <div class="platform-capabilities__body stack">
      ${(["deployed", "draining", "suspended", "deprecated", "archived"] as RuntimeLifecycle[]).map(renderLifecycleSection)}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 治理问题卡片：被「策略中心」摘要 + 「健康状态」详情两处复用
// （独立的 Governance Tab 已经合并进健康/策略两个标签页）
// ─────────────────────────────────────────────────────────────────────────

function renderGovernanceIssueCard(issue: RuntimeGovernanceIssue) {
  const tone = ISSUE_SEVERITY_TONES[issue.severity];
  return html`
    <article
      class="platform-capabilities__health-item is-${tone === "danger" ? "critical" : tone === "warn" ? "warning" : "info"}"
    >
      <span
        class="platform-capabilities__health-item-icon is-${tone === "danger" ? "critical" : tone === "warn" ? "warning" : "info"}"
      >
        ${renderIcon("alertCircle", "platform-capabilities__health-item-icon-svg")}
      </span>
      <div class="platform-capabilities__health-item-body">
        <div class="platform-capabilities__health-item-row">
          <div class="platform-capabilities__health-item-title">
            ${localizeRuntimeIssueText(issue.description)}
          </div>
          <span class="platform-capabilities__health-item-category">
            ${ISSUE_CATEGORY_LABELS[issue.category]} · ${ISSUE_SEVERITY_LABELS[issue.severity]}
          </span>
        </div>
        <div class="platform-capabilities__health-item-sub">
          ${localizeRuntimeIssueText(issue.impact)}
        </div>
        <div class="platform-capabilities__health-item-meta">
          建议：${localizeRuntimeIssueText(issue.suggestedAction)}
        </div>
      </div>
    </article>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────────────────

// One-shot guard so we only auto-trigger the load once per page-module lifetime.
// `loadOverview` is normally fired by `refreshActiveTab` after WS connect, but
// when the user lands directly on `/platform/agents` the SPA route apply may
// run before the connection completes, and the on-connect re-trigger may not
// fire in some session shapes — leaving runtimeAgents/runtimeBindings empty.
// This guard kicks an explicit fetch on the first render where data is empty.
let runtimeOverviewAutoLoadTriggered = false;
let runtimeOverviewWasLoading = false;
let runtimeOverviewLoadFinished = false;

function trackRuntimeOverviewLoad(loading: boolean) {
  if (loading) {
    runtimeOverviewWasLoading = true;
    return;
  }
  if (runtimeOverviewWasLoading) {
    runtimeOverviewLoadFinished = true;
    runtimeOverviewWasLoading = false;
  }
}

function runtimeSummaryPending(props: PlatformSurfaceProps): boolean {
  const loading = props.readModel.runtimeOverviewLoading === true;
  trackRuntimeOverviewLoad(loading);
  if (isPlatformShellPending(props.readModel) || loading) {
    return true;
  }
  const runtimeRowsLoaded =
    (props.readModel.runtimeAgents?.length ?? 0) > 0 ||
    (props.readModel.runtimeBindings?.length ?? 0) > 0;
  if (runtimeRowsLoaded || props.readModel.runtimeOverviewError) {
    return false;
  }
  return !runtimeOverviewLoadFinished;
}
let runtimeOverviewAutoLoadTimer: number | null = null;

function maybeAutoTriggerRuntimeOverview(props: PlatformSurfaceProps): void {
  if (runtimeOverviewAutoLoadTriggered) {
    return;
  }
  if (typeof window === "undefined") {
    return;
  }
  // If a load is already in flight, don't double-fire — let it resolve.
  if (props.readModel.runtimeOverviewLoading === true) {
    return;
  }
  const hasData =
    (props.readModel.runtimeAgents?.length ?? 0) > 0 ||
    (props.readModel.runtimeBindings?.length ?? 0) > 0;
  if (hasData) {
    runtimeOverviewAutoLoadTriggered = true;
    return;
  }
  // If a previous load failed, don't auto-retry — leave the explicit button
  // for the user to click; otherwise we'll hammer the gateway in a render loop.
  if (props.readModel.runtimeOverviewError) {
    runtimeOverviewAutoLoadTriggered = true;
    return;
  }
  // Defer the call so it doesn't fire during the lit-html render pass.
  if (runtimeOverviewAutoLoadTimer !== null) {
    return;
  }
  runtimeOverviewAutoLoadTimer = window.setTimeout(() => {
    runtimeOverviewAutoLoadTimer = null;
    runtimeOverviewAutoLoadTriggered = true;
    void props.actions.platformAgents.onRefresh();
  }, 0);
}

export function renderPlatformAgentsSurface(props: PlatformSurfaceProps) {
  activeTab = resolveActiveTab();
  const client = props.client ?? null;
  bindingMutationHost = {
    scopes: props.scopes ?? null,
    connected: Boolean(client?.connected),
    request: client ? (method, params) => client.request(method, params) : null,
    refresh: () => props.actions.platformAgents.onRefresh(),
  };
  maybeAutoTriggerRuntimeOverview(props);
  const agents = deriveAgentsFromReadModel(props);
  const bindings = deriveBindingsFromReadModel(props);
  const telemetry = props.readModel.runtimeTelemetry ?? [];
  const kpi = computeKpi(agents, bindings, props.readModel.runtimeKpi);

  let body;
  switch (activeTab) {
    case "catalog":
      body = renderRuntimeCatalogTab(agents, bindings);
      break;
    case "bindings":
      body = renderCapabilityBindingsTab(agents, bindings, buildTenantLabelMap(props));
      break;
    case "policy":
      body = renderPolicyCenterTab(agents, bindings);
      break;
    case "health":
      body = renderRuntimeHealthTab(agents, bindings, telemetry);
      break;
    case "lifecycle":
      body = renderDeploymentLifecycleTab(agents);
      break;
  }

  const runtimeLoading = props.readModel.runtimeOverviewLoading === true;
  const runtimeError = props.readModel.runtimeOverviewError ?? null;
  const kpiPending = runtimeSummaryPending(props);

  // 仅在加载/错误时展示一条 slim 状态条；正常态完全隐藏，避免与 KPI 卡片冗余。
  const statusBanner =
    runtimeLoading || runtimeError
      ? html`
          <div
            class="platform-agents-toolbar ${runtimeError ? "is-error" : "is-loading"}"
            role="status"
            aria-label="资产管理数据状态"
          >
            <span class="platform-agents-toolbar__hint">
              ${runtimeLoading ? "正在拉取运行时数据…" : `数据加载失败：${runtimeError}`}
            </span>
            <button
              type="button"
              class="btn btn--small"
              ?disabled=${runtimeLoading}
              @click=${() => void props.actions.platformAgents.onRefresh()}
              title="重新拉取 agent-runtime.list-agents / list-bindings / get-runtime-kpi"
            >
              ${runtimeLoading ? "加载中…" : "重新加载数据"}
            </button>
          </div>
        `
      : nothing;

  return html`
    <section class="platform-capabilities">
      ${kpiPending ? renderPlatformSummaryPending("资产管理") : renderKpiCards(kpi)}
      <div class="card">${renderTabBar()}</div>
      ${statusBanner}
      ${kpiPending ? nothing : html`<div class="platform-capabilities__body">${body}</div>`}
    </section>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// 工具：相对时间格式化（运维语言）
// ─────────────────────────────────────────────────────────────────────────

function formatRelativeTime(deltaMs: number): string {
  if (deltaMs < 0) {
    return "刚刚";
  }
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) {
    return `${sec} 秒前`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min} 分钟前`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr} 小时前`;
  }
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return `${day} 天前`;
  }
  const month = Math.floor(day / 30);
  if (month < 12) {
    return `${month} 个月前`;
  }
  const year = Math.floor(day / 365);
  return `${year} 年前`;
}

function localizeRuntimeIssueText(text: string): string {
  return text
    .replace(/\bAgent\b/g, "机器人运行实例")
    .replace(/代理实例/g, "机器人运行实例")
    .replace(/Agent 实例/g, "机器人运行实例")
    .replace(/\bCapability\b/g, "能力")
    .replace(/\bBinding\b/g, "绑定")
    .replace(/\bbinding\b/g, "绑定")
    .replace(/\bfallbackBindingId\b/g, "降级绑定字段");
}

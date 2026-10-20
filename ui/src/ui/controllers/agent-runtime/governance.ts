/**
 * Agent Runtime Center — Governance & Policy Controller。
 *
 * 实现 Task 24 的 acknowledge 流程与 Task 25 的治理策略配置（zombie / orphan /
 * overcommit 阈值）持久化。
 *
 * 设计要点：
 * - 列表筛选支持 `severity` / `category` / `includeAcknowledged`，与 Gateway
 *   端点形状一致；筛选只更新 state，由调用方决定何时 `loadIssues`。
 * - acknowledge 操作要求 reviewerId（运维登录 ID）；服务端响应中含 issue 的
 *   最新状态（acknowledgedBy / acknowledgedAt 已写入），客户端用响应替换缓存。
 * - 治理配置：Partial<GovernanceDetectorConfig>，UI 只编辑变更字段，未指定
 *   字段保留服务端现值。
 */

import type {
  AgentRuntimeGateway,
  ListGovernanceIssuesResponse,
} from "../../capability/agent-runtime/index.ts";
import type {
  GovernanceDetectorConfig,
  RuntimeGovernanceIssue,
  RuntimeGovernanceIssueCategory,
  RuntimeGovernanceIssueSeverity,
} from "../../capability/runtime-canonical/index.ts";

export type GovernanceState = {
  gateway: AgentRuntimeGateway | null;
  loading: boolean;
  error: string | null;
  issues: RuntimeGovernanceIssue[];
  filters: {
    category: RuntimeGovernanceIssueCategory | null;
    severity: RuntimeGovernanceIssueSeverity | null;
    includeAcknowledged: boolean;
  };
  /** 当前进行 acknowledge 的 issue id，避免双击重复请求。 */
  busyIssueId: string | null;
  /** 当前持久化的治理策略配置；首次 loadConfig 后非 null。 */
  config: GovernanceDetectorConfig | null;
  configSaving: boolean;
  configError: string | null;
};

export function createInitialGovernanceState(): GovernanceState {
  return {
    gateway: null,
    loading: false,
    error: null,
    issues: [],
    filters: { category: null, severity: null, includeAcknowledged: false },
    busyIssueId: null,
    config: null,
    configSaving: false,
    configError: null,
  };
}

export async function loadIssues(state: GovernanceState): Promise<void> {
  if (state.gateway === null) {
    state.error = "尚未连接到 Gateway";
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const resp: ListGovernanceIssuesResponse = await state.gateway.listGovernanceIssues({
      category: state.filters.category,
      severity: state.filters.severity,
      includeAcknowledged: state.filters.includeAcknowledged,
    });
    state.issues = resp.issues;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载治理问题失败";
  } finally {
    state.loading = false;
  }
}

export function updateGovernanceFilter<K extends keyof GovernanceState["filters"]>(
  state: GovernanceState,
  key: K,
  value: GovernanceState["filters"][K],
): void {
  state.filters[key] = value;
}

export function resetGovernanceFilters(state: GovernanceState): void {
  state.filters = { category: null, severity: null, includeAcknowledged: false };
}

/**
 * Acknowledge 一条治理问题。
 *
 * 成功后用响应中的最新 issue 替换缓存（包含 acknowledgedBy / acknowledgedAt）。
 * 若 includeAcknowledged === false，acknowledged 后该 issue 在下一次 list 调用
 * 中将被服务端过滤掉，UI 自然不再展示。
 */
export async function acknowledge(
  state: GovernanceState,
  issueId: string,
  reviewerId: string,
  note: string | null,
): Promise<void> {
  if (state.gateway === null || state.busyIssueId === issueId) {
    return;
  }
  state.busyIssueId = issueId;
  state.error = null;
  try {
    const resp = await state.gateway.acknowledgeIssue({ issueId, reviewerId, note });
    const idx = state.issues.findIndex((i) => i.id === issueId);
    if (idx >= 0) {
      state.issues = [...state.issues.slice(0, idx), resp.issue, ...state.issues.slice(idx + 1)];
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Acknowledge 失败";
  } finally {
    state.busyIssueId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Task 25：治理策略配置
// ─────────────────────────────────────────────────────────────────────────

export async function loadGovernanceConfig(state: GovernanceState): Promise<void> {
  if (state.gateway === null) {
    state.configError = "尚未连接到 Gateway";
    return;
  }
  state.configError = null;
  try {
    const resp = await state.gateway.getGovernanceConfig({});
    state.config = resp.config;
  } catch (error) {
    state.configError = error instanceof Error ? error.message : "加载治理配置失败";
  }
}

/**
 * 保存治理策略配置（部分字段更新）。
 *
 * 使用前需先 `loadGovernanceConfig` 获取当前值；UI 仅编辑变更字段，
 * 服务端会与现值合并保留未指定字段。
 */
export async function saveGovernanceConfig(
  state: GovernanceState,
  patch: Partial<GovernanceDetectorConfig>,
): Promise<void> {
  if (state.gateway === null) {
    state.configError = "尚未连接到 Gateway";
    return;
  }
  // 入口校验：所有数值阈值需为非负有限数
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "number" && (!Number.isFinite(v) || v < 0)) {
      state.configError = `字段 ${k} 必须是非负有限数`;
      return;
    }
  }
  state.configSaving = true;
  state.configError = null;
  try {
    const resp = await state.gateway.updateGovernanceConfig({ config: patch });
    state.config = resp.config;
  } catch (error) {
    state.configError = error instanceof Error ? error.message : "保存治理配置失败";
  } finally {
    state.configSaving = false;
  }
}

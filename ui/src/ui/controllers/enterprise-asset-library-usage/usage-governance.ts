/**
 * Usage Governance Controller — 「使用治理」子页的状态管理。
 *
 * 落实需求：Requirements 7.1–7.10
 */

import type { EnterpriseUsageGateway } from "../../capability/enterprise-asset-library-usage/gateway-client.ts";
import type {
  GovernanceConfig,
  GovernanceIssue,
} from "../../capability/runtime-projection/types.ts";
import { DEFAULT_GOVERNANCE_CONFIG } from "../../capability/runtime-projection/types.ts";
import { describeLoadError, loadWithRetry } from "./load-with-retry.ts";

// ─────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────

export type GovernanceTab = "低效能力" | "未使用能力" | "冲突能力";

export type UsageGovernanceState = {
  loading: boolean;
  error: string | null;
  activeTab: GovernanceTab;
  config: GovernanceConfig;
  lowEfficiency: GovernanceIssue[];
  zombie: GovernanceIssue[];
  conflict: GovernanceIssue[];
  /** 会话内 acknowledge 集合（仅内存，不持久化，Requirement 7.8） */
  acknowledgedIssues: Set<string>;
  pendingAction: { issue: GovernanceIssue; type: "uninstall" | "transfer" } | null;
};

const DEFAULT_STATE: UsageGovernanceState = {
  loading: false,
  error: null,
  activeTab: "低效能力",
  config: { ...DEFAULT_GOVERNANCE_CONFIG },
  lowEfficiency: [],
  zombie: [],
  conflict: [],
  acknowledgedIssues: new Set(),
  pendingAction: null,
};

// ─────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────

export type UsageGovernanceController = ReturnType<typeof createUsageGovernanceController>;

export function createUsageGovernanceController(
  gateway: EnterpriseUsageGateway,
  onChange: (state: UsageGovernanceState) => void,
) {
  let state: UsageGovernanceState = { ...DEFAULT_STATE, acknowledgedIssues: new Set() };

  function setState(partial: Partial<UsageGovernanceState>): void {
    state = { ...state, ...partial };
    onChange(state);
  }

  function getState(): UsageGovernanceState {
    return state;
  }

  async function load(): Promise<void> {
    setState({ loading: true, error: null });

    try {
      const response = await loadWithRetry(
        () => gateway.detectGovernance({ config: state.config }),
        { label: "detectGovernance" },
      );
      if (!response) {
        return;
      }

      setState({
        loading: false,
        lowEfficiency: response.lowEfficiency,
        zombie: response.zombie,
        conflict: response.conflict,
      });
    } catch (err) {
      setState({ loading: false, error: describeLoadError(err) });
    }
  }

  function changeTab(tab: GovernanceTab): void {
    setState({ activeTab: tab });
  }

  async function updateConfig(partial: Partial<GovernanceConfig>): Promise<void> {
    try {
      const response = await gateway.updateGovernanceConfig({ config: partial });
      setState({ config: response.config });
      // 阈值更新后立即重新计算（Requirement 7.6）
      void load();
    } catch {
      setState({ error: "阈值更新失败，请重试" });
    }
  }

  function acknowledge(issueId: string): void {
    const newSet = new Set(state.acknowledgedIssues);
    newSet.add(issueId);
    setState({ acknowledgedIssues: newSet });
  }

  function getVisibleIssues(tab: GovernanceTab): GovernanceIssue[] {
    let issues: GovernanceIssue[];
    switch (tab) {
      case "低效能力":
        issues = state.lowEfficiency;
        break;
      case "未使用能力":
        issues = state.zombie;
        break;
      case "冲突能力":
        issues = state.conflict;
        break;
    }
    return issues.filter((i) => !state.acknowledgedIssues.has(i.issueId));
  }

  function executeSuggestion(issue: GovernanceIssue): void {
    switch (issue.suggestion) {
      case "卸载":
        setState({ pendingAction: { issue, type: "uninstall" } });
        break;
      case "重新整理能力":
        // 跳转至能力详情页（由视图层处理导航）
        break;
      case "转移到其他机器人":
        setState({ pendingAction: { issue, type: "transfer" } });
        break;
    }
  }

  function cancelAction(): void {
    setState({ pendingAction: null });
  }

  return {
    getState,
    load,
    changeTab,
    updateConfig,
    acknowledge,
    getVisibleIssues,
    executeSuggestion,
    cancelAction,
  };
}

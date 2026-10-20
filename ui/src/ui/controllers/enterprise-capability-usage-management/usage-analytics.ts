/**
 * Usage Analytics Controller — 「使用效果分析」子页的状态管理。
 *
 * 落实需求：Requirements 6.1–6.10
 */

import type {
  AnalyticsKpis,
  AnalyticsTopCapability,
  AnalyticsTrendSeries,
  AnalyticsWindow,
} from "../../capability/enterprise-capability-usage-management/endpoints.ts";
import type { EnterpriseUsageGateway } from "../../capability/enterprise-capability-usage-management/gateway-client.ts";

// ─────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────

export type UsageAnalyticsState = {
  loading: boolean;
  error: string | null;
  window: AnalyticsWindow;
  kpis: AnalyticsKpis | null;
  trendExecutions: AnalyticsTrendSeries | null;
  trendCapabilityReuse: AnalyticsTrendSeries | null;
  topCapabilities: AnalyticsTopCapability[];
};

const DEFAULT_STATE: UsageAnalyticsState = {
  loading: false,
  error: null,
  window: 30,
  kpis: null,
  trendExecutions: null,
  trendCapabilityReuse: null,
  topCapabilities: [],
};

// ─────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────

export type UsageAnalyticsController = ReturnType<typeof createUsageAnalyticsController>;

export function createUsageAnalyticsController(
  gateway: EnterpriseUsageGateway,
  onChange: (state: UsageAnalyticsState) => void,
) {
  let state: UsageAnalyticsState = { ...DEFAULT_STATE };

  function setState(partial: Partial<UsageAnalyticsState>): void {
    state = { ...state, ...partial };
    onChange(state);
  }

  function getState(): UsageAnalyticsState {
    return state;
  }

  async function load(): Promise<void> {
    setState({ loading: true, error: null });

    try {
      const response = await Promise.race([
        gateway.getAnalytics({ window: state.window }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 10000)),
      ]);

      setState({
        loading: false,
        kpis: response.kpis,
        trendExecutions: response.trendExecutions,
        trendCapabilityReuse: response.trendCapabilityReuse,
        topCapabilities: response.topCapabilities,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message === "TIMEOUT"
          ? "数据加载超时，请重试"
          : "加载失败，请重试";
      setState({ loading: false, error: message });
    }
  }

  function changeWindow(window: AnalyticsWindow): void {
    setState({ window });
    void load();
  }

  return {
    getState,
    load,
    changeWindow,
  };
}

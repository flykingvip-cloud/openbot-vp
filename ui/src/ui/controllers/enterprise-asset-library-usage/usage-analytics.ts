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
} from "../../capability/enterprise-asset-library-usage/endpoints.ts";
import type { EnterpriseUsageGateway } from "../../capability/enterprise-asset-library-usage/gateway-client.ts";
import { describeLoadError, loadWithRetry } from "./load-with-retry.ts";

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
      const response = await loadWithRetry(() => gateway.getAnalytics({ window: state.window }), {
        label: "getAnalytics",
      });
      if (!response) {
        return;
      }

      setState({
        loading: false,
        kpis: response.kpis,
        trendExecutions: response.trendExecutions,
        trendCapabilityReuse: response.trendCapabilityReuse,
        topCapabilities: response.topCapabilities,
      });
    } catch (err) {
      setState({ loading: false, error: describeLoadError(err) });
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

import type { SeatsDataSource } from "../../cost-budget/cost-budget-seats-workspace.ts";
import {
  getCostBudgetSeatBootstrapGuide,
  setCostBudgetSeatBootstrapGuide,
} from "../../cost-budget/cost-budget-seats-workspace.ts";
import {
  ensureSeatsDashboard,
  getSeatsStoreState,
  reloadSeatsPositionAttribution,
  reloadSeatsStore,
  setSeatsStorePositionAttribution,
} from "../stores/seats-store.ts";
import { hasActiveSubscription } from "../stores/subscription-store.ts";

export function createV2SeatsDataSource(): SeatsDataSource {
  return {
    getSnapshot() {
      const store = getSeatsStoreState();
      return {
        loading: store.loading,
        allocation: store.allocation,
        seats: store.seats,
        analytics: store.analytics,
        attribution: store.attribution,
        positionAttribution: store.positionAttribution,
        dashboard: store.dashboard,
        hasActiveSubscription: hasActiveSubscription(),
      };
    },
    getBootstrapGuide() {
      return getCostBudgetSeatBootstrapGuide();
    },
    setBootstrapGuide(value) {
      setCostBudgetSeatBootstrapGuide(value);
    },
    setPositionAttribution(value) {
      setSeatsStorePositionAttribution(value);
    },
    async reload(client) {
      await reloadSeatsStore(client);
    },
    async ensureDashboard(client) {
      await ensureSeatsDashboard(client);
    },
    async reloadPositionAttribution(client, startTime, endTime, options) {
      await reloadSeatsPositionAttribution(client, startTime, endTime, options);
    },
  };
}

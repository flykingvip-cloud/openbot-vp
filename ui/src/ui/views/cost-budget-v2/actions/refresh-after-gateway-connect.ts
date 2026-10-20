import type { GatewayBrowserClient } from "../../../gateway.ts";
import { isCostBudgetGatewayReady } from "../stores/gateway-ready.ts";
import {
  invalidateOperationsStoreLoad,
  reloadOperationsStore,
} from "../stores/operations-store.ts";
import { invalidateSeatsStoreLoad, reloadSeatsStore } from "../stores/seats-store.ts";
import { invalidateSettingsStoreLoad, reloadSettingsStore } from "../stores/settings-store.ts";
import {
  invalidateSubscriptionStoreLoad,
  reloadSubscriptionStore,
} from "../stores/subscription-store.ts";

let reconnectTimer: ReturnType<typeof setTimeout> | number | null = null;

function cancelReconnectTimer(): void {
  if (reconnectTimer !== null && typeof window !== "undefined") {
    clearTimeout(reconnectTimer);
  }
  reconnectTimer = null;
}

/** Gateway hello / reconnect 后刷新成本与预算 v2 各 store（避免首屏竞态锁死）。 */
export function refreshCostBudgetV2AfterGatewayConnect(client: GatewayBrowserClient | null): void {
  if (!isCostBudgetGatewayReady(client)) {
    return;
  }
  cancelReconnectTimer();
  invalidateSubscriptionStoreLoad();
  invalidateOperationsStoreLoad();
  invalidateSettingsStoreLoad();
  invalidateSeatsStoreLoad();

  const run = () => {
    void reloadSubscriptionStore(client);
    void reloadOperationsStore(client);
    void reloadSettingsStore(client);
    void reloadSeatsStore(client);
  };

  if (typeof window !== "undefined") {
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      run();
    }, 350);
  } else {
    run();
  }
}

export function __resetCostBudgetV2GatewayReconnectForTest(): void {
  cancelReconnectTimer();
}

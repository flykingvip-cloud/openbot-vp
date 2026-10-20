import { createCostBudgetGateway } from "../../../capability/cost-budget-billing/gateway-client.ts";
import type {
  CommercialOrderDetail,
  SubscriptionGetResponse,
} from "../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  GATEWAY_LOAD_RETRY_DELAYS_MS,
  isTransientGatewayError,
} from "../../../ports/platform/pricing/gateway-load-retry.ts";
import type { BillingCycle } from "../../../ports/platform/pricing/pricing-cycle.ts";
import { isCostBudgetGatewayReady } from "./gateway-ready.ts";
import { normalizeTenantId } from "./store-load-scope.ts";

export type SubscriptionLoadStatus = "idle" | "loading" | "success" | "partial" | "error";

export type SubscriptionStoreState = {
  status: SubscriptionLoadStatus;
  loading: boolean;
  loadAttempted: boolean;
  error: string | null;
  /** subscriptions.get failure message (independent of orders). */
  subscriptionError: string | null;
  /** commercial orders list failure (does not block plan catalog). */
  ordersError: string | null;
  data: SubscriptionGetResponse | null;
  commercialOrders: CommercialOrderDetail[];
  comparisonCycle: BillingCycle;
  actionBusy: boolean;
  actionNotice: string | null;
  actionError: string | null;
  contactSalesPlanId: string | null;
  contactSalesSubmitted: boolean;
  pendingOrderId: string | null;
};

const state: SubscriptionStoreState = {
  status: "idle",
  loading: false,
  loadAttempted: false,
  error: null,
  subscriptionError: null,
  ordersError: null,
  data: null,
  commercialOrders: [],
  comparisonCycle: "monthly",
  actionBusy: false,
  actionNotice: null,
  actionError: null,
  contactSalesPlanId: null,
  contactSalesSubmitted: false,
  pendingOrderId: null,
};

let lastClient: GatewayBrowserClient | null = null;
let lastTenantId: string | null = null;
let settledClient: GatewayBrowserClient | null = null;
let settledTenantId: string | null = null;
let loadInFlight: Promise<void> | null = null;
let loadGeneration = 0;
let transientAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loadWatchdog: ReturnType<typeof setTimeout> | null = null;
let rerenderFn: (() => void) | undefined;

const LOAD_WATCHDOG_MS = 45_000;

function notify(): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => rerenderFn?.());
  } else {
    rerenderFn?.();
  }
}

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function clearWatchdog(): void {
  if (loadWatchdog !== null) {
    clearTimeout(loadWatchdog);
    loadWatchdog = null;
  }
}

function settle(
  status: SubscriptionLoadStatus,
  client: GatewayBrowserClient,
  tenantId: string,
): void {
  clearWatchdog();
  clearRetryTimer();
  state.status = status;
  state.loading = false;
  state.loadAttempted = true;
  settledClient = client;
  settledTenantId = tenantId;
  lastClient = client;
  lastTenantId = tenantId;
  transientAttempt = 0;
}

function scheduleTransientRetry(
  client: GatewayBrowserClient,
  tenantId: string,
  generation: number,
): void {
  const delay =
    GATEWAY_LOAD_RETRY_DELAYS_MS[
      Math.min(transientAttempt - 1, GATEWAY_LOAD_RETRY_DELAYS_MS.length - 1)
    ] ?? 5000;
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (generation !== loadGeneration) {
      return;
    }
    if (!isCostBudgetGatewayReady(client)) {
      state.subscriptionError = "网关未连接，请检查网络后点击重新加载";
      state.error = state.subscriptionError;
      settle("error", client, tenantId);
      notify();
      return;
    }
    void reloadSubscriptionStore(client, { fromRetry: true, tenantId });
  }, delay);
}

export function getSubscriptionStoreState(): Readonly<SubscriptionStoreState> {
  return state;
}

export function hasActiveSubscription(): boolean {
  return Boolean(state.data?.subscription);
}

export function setSubscriptionComparisonCycle(cycle: BillingCycle): void {
  state.comparisonCycle = cycle;
  notify();
}

export function setSubscriptionActionNotice(notice: string | null): void {
  state.actionNotice = notice;
  notify();
}

export function setSubscriptionActionError(error: string | null): void {
  state.actionError = error;
  notify();
}

export function setSubscriptionActionBusy(busy: boolean): void {
  state.actionBusy = busy;
  notify();
}

export function openContactSales(planId: string): void {
  state.contactSalesPlanId = planId;
  state.contactSalesSubmitted = false;
  notify();
}

export function closeContactSales(): void {
  state.contactSalesPlanId = null;
  state.contactSalesSubmitted = false;
  notify();
}

export function markContactSalesSubmitted(): void {
  state.contactSalesSubmitted = true;
  notify();
}

export function setPendingOrderId(orderId: string | null): void {
  state.pendingOrderId = orderId;
  notify();
}

export async function reloadSubscriptionStore(
  client: GatewayBrowserClient,
  options?: { fromRetry?: boolean; tenantId?: string },
): Promise<void> {
  if (loadInFlight) {
    return loadInFlight;
  }
  if (!options?.fromRetry) {
    clearRetryTimer();
    transientAttempt = 0;
  }

  const tenantId = normalizeTenantId(options?.tenantId ?? lastTenantId);
  lastClient = client;
  lastTenantId = tenantId;

  const generation = ++loadGeneration;
  let resolveInFlight!: () => void;
  loadInFlight = new Promise<void>((resolve) => {
    resolveInFlight = resolve;
  });

  state.status = "loading";
  state.loading = true;
  if (!options?.fromRetry) {
    state.error = null;
  }
  clearWatchdog();
  loadWatchdog = setTimeout(() => {
    if (generation !== loadGeneration) {
      return;
    }
    if (state.status === "loading" && loadInFlight) {
      state.subscriptionError = "加载超时，请点击重新加载";
      state.error = state.subscriptionError;
      settle("error", client, tenantId);
      loadInFlight = null;
      notify();
    }
  }, LOAD_WATCHDOG_MS);
  notify();

  const run = async () => {
    try {
      const gw = createCostBudgetGateway(client);
      const [subRes, ordersRes] = await Promise.allSettled([
        gw.getSubscription(),
        gw.listCommercialOrders(),
      ]);

      if (generation !== loadGeneration) {
        return;
      }

      if (subRes.status === "fulfilled") {
        state.data = subRes.value;
        state.subscriptionError = null;
      } else {
        state.data = null;
        const reason = subRes.reason;
        if (
          isTransientGatewayError(reason) &&
          transientAttempt < GATEWAY_LOAD_RETRY_DELAYS_MS.length
        ) {
          transientAttempt += 1;
          state.loading = true;
          state.status = "loading";
          state.error = null;
          scheduleTransientRetry(client, tenantId, generation);
          return;
        }
        state.subscriptionError =
          reason instanceof Error ? reason.message : String(reason ?? "订阅加载失败");
      }

      if (ordersRes.status === "fulfilled") {
        state.commercialOrders = ordersRes.value.orders ?? [];
        state.ordersError = null;
      } else {
        state.commercialOrders = [];
        const reason = ordersRes.reason;
        state.ordersError =
          reason instanceof Error ? reason.message : String(reason ?? "订单列表加载失败");
      }

      if (state.data) {
        state.error = state.ordersError
          ? `订单列表未加载：${state.ordersError}。套餐信息仍可查看。`
          : null;
        settle(state.ordersError ? "partial" : "success", client, tenantId);
        return;
      }

      state.error = state.subscriptionError
        ? `无法加载订阅：${state.subscriptionError}`
        : "加载失败";
      settle("error", client, tenantId);
    } catch (err) {
      if (generation !== loadGeneration) {
        return;
      }
      if (isTransientGatewayError(err) && transientAttempt < GATEWAY_LOAD_RETRY_DELAYS_MS.length) {
        transientAttempt += 1;
        state.loading = true;
        state.status = "loading";
        state.error = null;
        scheduleTransientRetry(client, tenantId, generation);
        return;
      }
      state.error = err instanceof Error ? err.message : "加载失败";
      state.subscriptionError = state.error;
      settle("error", client, tenantId);
    } finally {
      if (generation === loadGeneration) {
        loadInFlight = null;
      }
      resolveInFlight();
      notify();
    }
  };

  void run();
  return loadInFlight;
}

export function ensureSubscriptionStore(
  client: GatewayBrowserClient | null,
  rerender: () => void,
  options?: { force?: boolean; tenantId?: string },
): void {
  rerenderFn = rerender;
  if (!client) {
    lastClient = null;
    lastTenantId = null;
    return;
  }
  if (!isCostBudgetGatewayReady(client)) {
    return;
  }
  const tenantId = normalizeTenantId(options?.tenantId ?? lastTenantId);
  if (loadInFlight || retryTimer !== null) {
    if (lastClient === client && normalizeTenantId(lastTenantId) === tenantId) {
      return;
    }
    loadGeneration += 1;
    loadInFlight = null;
    clearRetryTimer();
    clearWatchdog();
  }
  if (
    !options?.force &&
    settledClient === client &&
    normalizeTenantId(settledTenantId) === tenantId
  ) {
    return;
  }
  if (
    !options?.force &&
    lastClient === client &&
    normalizeTenantId(lastTenantId) === tenantId &&
    state.status === "loading"
  ) {
    return;
  }
  if (lastClient !== client || normalizeTenantId(lastTenantId) !== tenantId) {
    state.data = null;
    state.commercialOrders = [];
    state.error = null;
    state.subscriptionError = null;
    state.ordersError = null;
    state.status = "idle";
    settledClient = null;
    settledTenantId = null;
    loadGeneration += 1;
    loadInFlight = null;
    clearRetryTimer();
    clearWatchdog();
  }
  lastClient = client;
  lastTenantId = tenantId;
  if (options?.force) {
    settledClient = null;
    settledTenantId = null;
    transientAttempt = 0;
    clearRetryTimer();
  }
  void reloadSubscriptionStore(client, { tenantId });
}

export function invalidateSubscriptionStoreLoad(): void {
  settledClient = null;
  settledTenantId = null;
  transientAttempt = 0;
  clearRetryTimer();
  clearWatchdog();
  // Bump generation AND drop the in-flight promise so a new reload can start.
  // Stale requests must not leave loadInFlight pinned after generation advances.
  loadGeneration += 1;
  loadInFlight = null;
}

export function __resetSubscriptionStoreForTest(): void {
  clearRetryTimer();
  clearWatchdog();
  state.status = "idle";
  state.loading = false;
  state.loadAttempted = false;
  state.error = null;
  state.subscriptionError = null;
  state.ordersError = null;
  state.data = null;
  state.commercialOrders = [];
  state.comparisonCycle = "monthly";
  state.actionBusy = false;
  state.actionNotice = null;
  state.actionError = null;
  state.contactSalesPlanId = null;
  state.contactSalesSubmitted = false;
  state.pendingOrderId = null;
  lastClient = null;
  lastTenantId = null;
  settledClient = null;
  settledTenantId = null;
  loadInFlight = null;
  loadGeneration = 0;
  transientAttempt = 0;
  rerenderFn = undefined;
}

export function __seedSubscriptionStoreForTest(partial: Partial<SubscriptionStoreState>): void {
  Object.assign(state, partial);
  state.loadAttempted = true;
  state.loading = false;
  if (!partial.status) {
    state.status = state.error ? "error" : state.data ? "success" : "error";
  }
  settledClient = lastClient;
}

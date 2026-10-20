import { createCostBudgetGateway } from "../../../capability/cost-budget-billing/gateway-client.ts";
import type {
  AnalyticsResponse,
  BudgetGetResponse,
  ConsumptionForecast,
  DashboardResponse,
  ResourcesSummaryResponse,
} from "../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  GATEWAY_LOAD_RETRY_DELAYS_MS,
  isTransientGatewayError,
} from "../../../ports/platform/pricing/gateway-load-retry.ts";
import { isCostBudgetGatewayReady } from "./gateway-ready.ts";
import { normalizeTenantId } from "./store-load-scope.ts";

export type SettingsLoadStatus = "idle" | "loading" | "success" | "partial" | "error";

export type SettingsStoreState = {
  status: SettingsLoadStatus;
  loading: boolean;
  loadAttempted: boolean;
  loadPartialFailure: boolean;
  error: string | null;
  budgetError: string | null;
  resourcesError: string | null;
  analyticsError: string | null;
  dashboardError: string | null;
  forecastError: string | null;
  budget: BudgetGetResponse | null;
  resources: ResourcesSummaryResponse | null;
  analytics: AnalyticsResponse | null;
  forecast: ConsumptionForecast | null;
  dashboard: DashboardResponse | null;
};

const state: SettingsStoreState = {
  status: "idle",
  loading: false,
  loadAttempted: false,
  loadPartialFailure: false,
  error: null,
  budgetError: null,
  resourcesError: null,
  analyticsError: null,
  dashboardError: null,
  forecastError: null,
  budget: null,
  resources: null,
  analytics: null,
  forecast: null,
  dashboard: null,
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

function settle(status: SettingsLoadStatus, client: GatewayBrowserClient, tenantId: string): void {
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

function captureResult<T>(
  result: PromiseSettledResult<T>,
  setValue: (v: T | null) => void,
  setError: (msg: string | null) => void,
): T | null {
  if (result.status === "fulfilled") {
    setValue(result.value);
    setError(null);
    return result.value;
  }
  setValue(null);
  const reason = result.reason;
  setError(reason instanceof Error ? reason.message : String(reason ?? "加载失败"));
  return null;
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
      state.error = "网关未连接，请检查网络后点击重新加载";
      settle("error", client, tenantId);
      notify();
      return;
    }
    void reloadSettingsStore(client, { fromRetry: true, tenantId });
  }, delay);
}

export function getSettingsStoreState(): Readonly<SettingsStoreState> {
  return state;
}

export async function reloadSettingsStore(
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
      state.error = "加载超时，请点击重新加载";
      settle("error", client, tenantId);
      loadInFlight = null;
      notify();
    }
  }, LOAD_WATCHDOG_MS);
  notify();

  const run = async () => {
    try {
      const gw = createCostBudgetGateway(client);
      // Phase 1: budget + resources unlock the default settings panels quickly.
      const [budgetRes, resourcesRes] = await Promise.allSettled([
        gw.getBudget(),
        gw.resourcesSummary(),
      ]);

      if (generation !== loadGeneration) {
        return;
      }

      const budget = captureResult(
        budgetRes,
        (v) => {
          state.budget = v;
        },
        (e) => {
          state.budgetError = e;
        },
      );
      const resources = captureResult(
        resourcesRes,
        (v) => {
          state.resources = v;
        },
        (e) => {
          state.resourcesError = e;
        },
      );

      if (budget != null || resources != null) {
        state.loading = false;
        state.loadAttempted = true;
        state.error = null;
        notify();
      }

      // Phase 2: dashboard (embeds forecast) + analytics — no duplicate forecast RPC.
      const [analyticsRes, dashboardRes] = await Promise.allSettled([
        gw.analytics({}),
        gw.dashboard(),
      ]);

      if (generation !== loadGeneration) {
        return;
      }

      captureResult(
        analyticsRes,
        (v) => {
          state.analytics = v;
        },
        (e) => {
          state.analyticsError = e;
        },
      );
      const dashboard = captureResult(
        dashboardRes,
        (v) => {
          state.dashboard = v;
        },
        (e) => {
          state.dashboardError = e;
        },
      );
      state.forecast = dashboard?.consumptionForecast ?? null;
      state.forecastError = dashboard ? null : (state.dashboardError ?? state.forecastError);

      const anyOk =
        budget != null ||
        resources != null ||
        state.analytics != null ||
        dashboard != null ||
        state.forecast != null;
      state.loadPartialFailure =
        Boolean(state.budgetError || state.resourcesError || state.dashboardError) && anyOk;

      if (!anyOk) {
        const reasons = [budgetRes, resourcesRes, dashboardRes]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => r.reason);
        const allTransient = reasons.length > 0 && reasons.every((r) => isTransientGatewayError(r));
        if (allTransient && transientAttempt < GATEWAY_LOAD_RETRY_DELAYS_MS.length) {
          transientAttempt += 1;
          state.loading = true;
          state.status = "loading";
          state.error = null;
          scheduleTransientRetry(client, tenantId, generation);
          return;
        }
        const parts = [
          state.budgetError ? `预算：${state.budgetError}` : null,
          state.resourcesError ? `资源：${state.resourcesError}` : null,
          state.dashboardError ? `概览：${state.dashboardError}` : null,
        ].filter(Boolean);
        state.error =
          parts.length > 0
            ? `加载失败（${parts.join("；")}）。请检查网络与权限后重试。`
            : "加载失败，请重试";
        settle("error", client, tenantId);
        return;
      }

      if (state.loadPartialFailure) {
        const parts = [
          state.budgetError ? "预算" : null,
          state.resourcesError ? "资源" : null,
          state.dashboardError ? "概览" : null,
        ].filter(Boolean);
        state.error =
          parts.length > 0 ? `部分数据未加载：${parts.join("、")}。其余模块仍可使用。` : null;
        settle("partial", client, tenantId);
        return;
      }

      state.error = null;
      settle("success", client, tenantId);
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
      state.error = err instanceof Error ? err.message : "加载失败，请重试";
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

export function ensureSettingsStore(
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
    state.budget = null;
    state.resources = null;
    state.analytics = null;
    state.forecast = null;
    state.dashboard = null;
    state.error = null;
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
  void reloadSettingsStore(client, { tenantId });
}

export function invalidateSettingsStoreLoad(): void {
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

export function __resetSettingsStoreForTest(): void {
  clearRetryTimer();
  clearWatchdog();
  state.status = "idle";
  state.loading = false;
  state.loadAttempted = false;
  state.loadPartialFailure = false;
  state.error = null;
  state.budgetError = null;
  state.resourcesError = null;
  state.analyticsError = null;
  state.dashboardError = null;
  state.forecastError = null;
  state.budget = null;
  state.resources = null;
  state.analytics = null;
  state.forecast = null;
  state.dashboard = null;
  lastClient = null;
  lastTenantId = null;
  settledClient = null;
  settledTenantId = null;
  loadInFlight = null;
  loadGeneration = 0;
  transientAttempt = 0;
  rerenderFn = undefined;
}

export function __seedSettingsStoreForTest(
  partial: Partial<SettingsStoreState>,
  client?: GatewayBrowserClient | null,
  tenantId?: string | null,
): void {
  Object.assign(state, partial);
  state.loadAttempted = true;
  state.loading = false;
  if (!partial.status) {
    state.status = state.error
      ? "error"
      : state.loadPartialFailure
        ? "partial"
        : state.budget || state.resources
          ? "success"
          : "error";
  }
  if (client !== undefined) {
    lastClient = client;
    settledClient = client;
    settledTenantId = tenantId ?? null;
  } else {
    settledClient = lastClient;
  }
}

import { createCostBudgetGateway } from "../../../capability/cost-budget-billing/gateway-client.ts";
import type {
  AllocationOverviewResponse,
  BudgetGetResponse,
  ConsumptionForecast,
  DashboardResponse,
  ResourcesSummaryResponse,
  SeatListResponse,
  TenantCreditsCycle,
} from "../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  GATEWAY_LOAD_RETRY_DELAYS_MS,
  isTransientGatewayError,
} from "../../../ports/platform/pricing/gateway-load-retry.ts";
import { isCostBudgetGatewayReady } from "./gateway-ready.ts";
import { normalizeTenantId } from "./store-load-scope.ts";

/** Explicit load lifecycle — never use a bare `loaded` boolean to re-drive ensure(). */
export type OperationsLoadStatus = "idle" | "loading" | "success" | "partial" | "error";

export type OperationsLoadOptions = {
  fromRetry?: boolean;
  /** Enterprise scope — required for multi-tenant isolation on a shared gateway client. */
  tenantId?: string;
};

export type OperationsEnsureOptions = {
  force?: boolean;
  tenantId?: string;
};

export type OperationsStoreState = {
  status: OperationsLoadStatus;
  /** @deprecated Prefer `status`; kept for existing call sites. */
  loading: boolean;
  /** @deprecated Prefer `status !== "idle"`. */
  loadAttempted: boolean;
  /** True when at least one core RPC failed but another succeeded. */
  loadPartialFailure: boolean;
  /** Aggregated message for empty / total-failure UI. */
  error: string | null;
  /** Per-RPC errors (never swallowed into a single null). */
  dashboardError: string | null;
  allocationError: string | null;
  seatsError: string | null;
  budgetError: string | null;
  resourcesError: string | null;
  creditsError: string | null;
  forecastError: string | null;
  dashboard: DashboardResponse | null;
  allocation: AllocationOverviewResponse | null;
  seats: SeatListResponse | null;
  budget: BudgetGetResponse | null;
  resources: ResourcesSummaryResponse | null;
  creditCycles: TenantCreditsCycle[] | null;
  forecast: ConsumptionForecast | null;
};

const state: OperationsStoreState = {
  status: "idle",
  loading: false,
  loadAttempted: false,
  loadPartialFailure: false,
  error: null,
  dashboardError: null,
  allocationError: null,
  seatsError: null,
  budgetError: null,
  resourcesError: null,
  creditsError: null,
  forecastError: null,
  dashboard: null,
  allocation: null,
  seats: null,
  budget: null,
  resources: null,
  creditCycles: null,
  forecast: null,
};

let lastClient: GatewayBrowserClient | null = null;
let lastTenantId: string | null = null;
/** Client for which we already finished a load attempt (success | partial | error). */
let settledClient: GatewayBrowserClient | null = null;
let settledTenantId: string | null = null;
let loadInFlight: Promise<void> | null = null;
/** Bumps on each reload / invalidate so late RPC results cannot overwrite a newer scope. */
let loadGeneration = 0;
let transientAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loadWatchdog: ReturnType<typeof setTimeout> | null = null;
let rerenderFn: (() => void) | undefined;

const LOAD_WATCHDOG_MS = 45_000;

function clearPayloadData(): void {
  state.dashboard = null;
  state.allocation = null;
  state.seats = null;
  state.budget = null;
  state.resources = null;
  state.creditCycles = null;
  state.forecast = null;
  state.error = null;
  state.dashboardError = null;
  state.allocationError = null;
  state.seatsError = null;
  state.budgetError = null;
  state.resourcesError = null;
  state.creditsError = null;
  state.forecastError = null;
  state.loadPartialFailure = false;
  state.status = "idle";
}

function scopeChanged(client: GatewayBrowserClient, tenantId: string): boolean {
  return lastClient !== client || normalizeTenantId(lastTenantId) !== tenantId;
}

function notify(): void {
  // Defer so ensure() never re-enters mid-render.
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
  status: OperationsLoadStatus,
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
    void reloadOperationsStore(client, { fromRetry: true, tenantId });
  }, delay);
}

export function getOperationsStoreState(): Readonly<OperationsStoreState> {
  return state;
}

export async function reloadOperationsStore(
  client: GatewayBrowserClient,
  options?: OperationsLoadOptions,
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
  // Reserve the in-flight slot BEFORE notify to prevent concurrent reloads.
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
      state.dashboardError = state.dashboardError ?? "超时";
      settle("error", client, tenantId);
      loadInFlight = null;
      notify();
    }
  }, LOAD_WATCHDOG_MS);
  notify();

  const run = async () => {
    const gw = createCostBudgetGateway(client);
    try {
      // Phase 1: dashboard first — overview UI can paint without waiting on the rest.
      const [dashboardRes] = await Promise.allSettled([gw.dashboard()]);
      if (generation !== loadGeneration) {
        return;
      }

      const dashboard = captureResult(
        dashboardRes,
        (v) => {
          state.dashboard = v;
        },
        (e) => {
          state.dashboardError = e;
        },
      );
      // Forecast is embedded in billing.dashboard; do not fan out a duplicate heavy RPC.
      state.forecast = dashboard?.consumptionForecast ?? null;
      state.forecastError = dashboard ? null : (state.dashboardError ?? state.forecastError);

      if (dashboard != null) {
        state.loading = false;
        state.loadAttempted = true;
        state.error = null;
        notify();
      }

      // Phase 2: supplemental panels (allocation / seats / budget / resources / credits).
      const [allocationRes, seatsRes, budgetRes, resourcesRes, creditCyclesRes] =
        await Promise.allSettled([
          gw.allocationOverview(),
          gw.listSeats(),
          gw.getBudget(),
          gw.resourcesSummary(),
          gw.listCreditsCycles(24).then((r) => r.cycles),
        ]);

      if (generation !== loadGeneration) {
        return;
      }

      const allocation = captureResult(
        allocationRes,
        (v) => {
          state.allocation = v;
        },
        (e) => {
          state.allocationError = e;
        },
      );
      captureResult(
        seatsRes,
        (v) => {
          state.seats = v;
        },
        (e) => {
          state.seatsError = e;
        },
      );
      captureResult(
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
      captureResult(
        creditCyclesRes,
        (v) => {
          state.creditCycles = v;
        },
        (e) => {
          state.creditsError = e;
        },
      );

      const coreOk = dashboard != null || allocation != null || resources != null;
      const anyOk =
        coreOk ||
        state.seats != null ||
        state.budget != null ||
        state.creditCycles != null ||
        state.forecast != null;
      state.loadPartialFailure =
        Boolean(state.dashboardError || state.allocationError || state.resourcesError) && anyOk;

      if (!anyOk) {
        const reasons = [dashboardRes, allocationRes, resourcesRes]
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
          state.dashboardError ? `概览：${state.dashboardError}` : null,
          state.allocationError ? `分配：${state.allocationError}` : null,
          state.resourcesError ? `资源：${state.resourcesError}` : null,
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
          state.dashboardError ? "运营概览" : null,
          state.allocationError ? "资源分配" : null,
          state.resourcesError ? "资源汇总" : null,
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

/**
 * Idempotent ensure: only starts a load when idle/unsettled for this client.
 * Terminal error/partial/success never auto-retries on re-render.
 */
export function ensureOperationsStore(
  client: GatewayBrowserClient | null,
  rerender: () => void,
  options?: OperationsEnsureOptions,
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
    if (!scopeChanged(client, tenantId)) {
      // Same scope already loading — wait for it.
      return;
    }
    // Tenant/client changed while a request is in flight: abandon it.
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
    lastTenantId === tenantId &&
    state.status === "loading"
  ) {
    return;
  }
  if (scopeChanged(client, tenantId)) {
    clearPayloadData();
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
  void reloadOperationsStore(client, { tenantId });
}

/** Allow reconnect / manual retry to fetch again. */
export function invalidateOperationsStoreLoad(): void {
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

export function __resetOperationsStoreForTest(): void {
  clearRetryTimer();
  clearWatchdog();
  state.status = "idle";
  state.loading = false;
  state.loadAttempted = false;
  state.loadPartialFailure = false;
  state.error = null;
  state.dashboardError = null;
  state.allocationError = null;
  state.seatsError = null;
  state.budgetError = null;
  state.resourcesError = null;
  state.creditsError = null;
  state.forecastError = null;
  state.dashboard = null;
  state.allocation = null;
  state.seats = null;
  state.budget = null;
  state.resources = null;
  state.creditCycles = null;
  state.forecast = null;
  lastClient = null;
  lastTenantId = null;
  settledClient = null;
  settledTenantId = null;
  loadInFlight = null;
  loadGeneration = 0;
  transientAttempt = 0;
  rerenderFn = undefined;
}

export function __seedOperationsStoreForTest(
  partial: Partial<OperationsStoreState>,
  scope?: { client?: GatewayBrowserClient | null; tenantId?: string },
): void {
  Object.assign(state, partial);
  state.loadAttempted = true;
  state.loading = false;
  if (state.status === "idle" || !("status" in partial) || partial.status == null) {
    state.status = state.error
      ? "error"
      : state.loadPartialFailure
        ? "partial"
        : state.dashboard
          ? "success"
          : "error";
  }
  if (scope?.client !== undefined) {
    lastClient = scope.client;
    settledClient = scope.client;
  } else {
    settledClient = lastClient;
  }
  if (scope?.tenantId !== undefined) {
    lastTenantId = normalizeTenantId(scope.tenantId);
    settledTenantId = lastTenantId;
  } else {
    settledTenantId = lastTenantId;
  }
}

import { createCostBudgetGateway } from "../../../capability/cost-budget-billing/gateway-client.ts";
import type {
  AllocationOverviewResponse,
  AnalyticsResponse,
  DashboardResponse,
  PositionAttributionResponse,
  SeatAttributionResponse,
  SeatListResponse,
} from "../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  GATEWAY_LOAD_RETRY_DELAYS_MS,
  isTransientGatewayError,
} from "../../../ports/platform/pricing/gateway-load-retry.ts";
import { isCostBudgetGatewayReady } from "./gateway-ready.ts";
import { normalizeTenantId } from "./store-load-scope.ts";

export type SeatsLoadStatus = "idle" | "loading" | "success" | "partial" | "error";

export type SeatsStoreState = {
  status: SeatsLoadStatus;
  loading: boolean;
  loadAttempted: boolean;
  loadPartialFailure: boolean;
  error: string | null;
  allocationError: string | null;
  seatsError: string | null;
  analyticsError: string | null;
  attributionError: string | null;
  allocation: AllocationOverviewResponse | null;
  seats: SeatListResponse | null;
  analytics: AnalyticsResponse | null;
  attribution: SeatAttributionResponse | null;
  positionAttribution: PositionAttributionResponse | null;
  dashboard: DashboardResponse | null;
};

const state: SeatsStoreState = {
  status: "idle",
  loading: false,
  loadAttempted: false,
  loadPartialFailure: false,
  error: null,
  allocationError: null,
  seatsError: null,
  analyticsError: null,
  attributionError: null,
  allocation: null,
  seats: null,
  analytics: null,
  attribution: null,
  positionAttribution: null,
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

function settle(status: SeatsLoadStatus, client: GatewayBrowserClient, tenantId: string): void {
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
    void reloadSeatsStore(client, { fromRetry: true, tenantId });
  }, delay);
}

export function getSeatsStoreState(): Readonly<SeatsStoreState> {
  return state;
}

export function setSeatsStorePositionAttribution(value: PositionAttributionResponse | null): void {
  state.positionAttribution = value;
  notify();
}

export async function ensureSeatsDashboard(client: GatewayBrowserClient): Promise<void> {
  if (state.dashboard) {
    return;
  }
  const gw = createCostBudgetGateway(client);
  try {
    state.dashboard = await gw.dashboard();
  } catch {
    state.dashboard = null;
  }
  notify();
}

export async function reloadSeatsPositionAttribution(
  client: GatewayBrowserClient,
  startTime: string,
  endTime: string,
  options?: { fetchDashboardIfNeeded?: boolean },
): Promise<PositionAttributionResponse> {
  const gw = createCostBudgetGateway(client);
  if (options?.fetchDashboardIfNeeded && !state.dashboard) {
    try {
      state.dashboard = await gw.dashboard();
    } catch {
      state.dashboard = null;
    }
    notify();
  }
  const result = await gw.attributionByPosition({ startTime, endTime });
  state.positionAttribution = result;
  notify();
  return result;
}

export async function reloadSeatsStore(
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
      const [allocationRes, seatsRes, analyticsRes, attributionRes] = await Promise.allSettled([
        gw.allocationOverview(),
        gw.listSeats(),
        gw.analytics({}),
        gw.attributionBySeat({}),
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
      const seats = captureResult(
        seatsRes,
        (v) => {
          state.seats = v;
        },
        (e) => {
          state.seatsError = e;
        },
      );
      captureResult(
        analyticsRes,
        (v) => {
          state.analytics = v;
        },
        (e) => {
          state.analyticsError = e;
        },
      );
      captureResult(
        attributionRes,
        (v) => {
          state.attribution = v;
        },
        (e) => {
          state.attributionError = e;
        },
      );

      const anyOk =
        allocation != null || seats != null || state.analytics != null || state.attribution != null;
      state.loadPartialFailure = Boolean(state.allocationError || state.seatsError) && anyOk;

      if (!anyOk) {
        const reasons = [allocationRes, seatsRes]
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
          state.allocationError ? `分配：${state.allocationError}` : null,
          state.seatsError ? `席位：${state.seatsError}` : null,
        ].filter(Boolean);
        state.error =
          parts.length > 0
            ? `加载失败（${parts.join("；")}）。请检查网络与权限后重试。`
            : "席位数据加载失败，请重试";
        settle("error", client, tenantId);
        return;
      }

      if (state.loadPartialFailure) {
        const parts = [
          state.allocationError ? "资源分配" : null,
          state.seatsError ? "席位列表" : null,
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

export function ensureSeatsStore(
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
    state.allocation = null;
    state.seats = null;
    state.analytics = null;
    state.attribution = null;
    state.positionAttribution = null;
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
  void reloadSeatsStore(client, { tenantId });
}

export function invalidateSeatsStoreLoad(): void {
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

export function __resetSeatsStoreForTest(): void {
  clearRetryTimer();
  clearWatchdog();
  state.status = "idle";
  state.loading = false;
  state.loadAttempted = false;
  state.loadPartialFailure = false;
  state.error = null;
  state.allocationError = null;
  state.seatsError = null;
  state.analyticsError = null;
  state.attributionError = null;
  state.allocation = null;
  state.seats = null;
  state.analytics = null;
  state.attribution = null;
  state.positionAttribution = null;
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

export function __seedSeatsStoreForTest(
  partial: Partial<SeatsStoreState>,
  client?: GatewayBrowserClient | null,
): void {
  Object.assign(state, partial);
  state.loadAttempted = true;
  state.loading = false;
  if (!partial.status) {
    state.status = state.error
      ? "error"
      : state.loadPartialFailure
        ? "partial"
        : state.allocation || state.seats
          ? "success"
          : "error";
  }
  if (client !== undefined) {
    lastClient = client;
    settledClient = client;
  } else {
    settledClient = lastClient;
  }
}

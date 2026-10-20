import { afterEach, describe, expect, it, vi } from "vitest";
import { COST_BUDGET_ENDPOINTS } from "../../../capability/cost-budget-billing/endpoints.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  __resetOperationsStoreForTest,
  ensureOperationsStore,
  getOperationsStoreState,
  invalidateOperationsStoreLoad,
  reloadOperationsStore,
} from "./operations-store.ts";

function connectedClient(request: ReturnType<typeof vi.fn>): GatewayBrowserClient {
  return {
    get connected() {
      return true;
    },
    request,
  } as unknown as GatewayBrowserClient;
}

afterEach(() => {
  __resetOperationsStoreForTest();
});

describe("operations-store load lifecycle", () => {
  it("does not start load before WebSocket is open", () => {
    const request = vi.fn();
    const client = {
      get connected() {
        return false;
      },
      request,
    } as unknown as GatewayBrowserClient;

    ensureOperationsStore(client, () => {});
    expect(getOperationsStoreState().status).toBe("idle");
    expect(request).not.toHaveBeenCalled();
  });

  it("when all core RPCs fail, settles in error and ensure does not re-request", async () => {
    const request = vi.fn(async (method: string) => {
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);

    let renders = 0;
    const rerender = () => {
      renders += 1;
      // Simulate shell re-ensure on every notify (the prior infinite-loop pattern).
      if (renders < 50) {
        ensureOperationsStore(client, rerender);
      }
    };

    ensureOperationsStore(client, rerender);
    await vi.waitFor(() => {
      expect(getOperationsStoreState().status).toBe("error");
    });

    const callsAfterFirst = request.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(6);
    expect(getOperationsStoreState().error).toMatch(/加载失败/);
    expect(getOperationsStoreState().dashboardError).toContain("billing.dashboard");

    const afterRenders = request.mock.calls.length;
    ensureOperationsStore(client, () => {});
    ensureOperationsStore(client, () => {});
    expect(request.mock.calls.length).toBe(afterRenders);

    await reloadOperationsStore(client);
    expect(request.mock.calls.length).toBeGreaterThan(afterRenders);
  });

  it("paints overview as soon as dashboard resolves without waiting for supplements", async () => {
    let releaseSeats!: () => void;
    const seatsGate = new Promise<void>((resolve) => {
      releaseSeats = resolve;
    });
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.dashboard) {
        return { subscribed: true, consumptionForecast: { projectedSpendCents: 1 } };
      }
      if (method === COST_BUDGET_ENDPOINTS.seatList) {
        await seatsGate;
        return { seats: [] };
      }
      if (
        method === COST_BUDGET_ENDPOINTS.allocationOverview ||
        method === COST_BUDGET_ENDPOINTS.budgetGet ||
        method === COST_BUDGET_ENDPOINTS.resourcesSummary ||
        method === COST_BUDGET_ENDPOINTS.listCreditsCycles
      ) {
        return method === COST_BUDGET_ENDPOINTS.listCreditsCycles ? { cycles: [] } : {};
      }
      throw new Error(`unexpected ${method}`);
    });
    const client = connectedClient(request);
    const p = reloadOperationsStore(client, { tenantId: "t1" });
    await vi.waitFor(() => {
      const s = getOperationsStoreState();
      expect(s.dashboard).toBeTruthy();
      expect(s.loading).toBe(false);
      expect(s.forecast).toEqual({ projectedSpendCents: 1 });
    });
    // Must not have called the duplicate forecast RPC.
    expect(
      request.mock.calls.some((c) => c[0] === COST_BUDGET_ENDPOINTS.consumptionForecastGet),
    ).toBe(false);
    releaseSeats();
    await p;
    await vi.waitFor(() => {
      expect(["partial", "success"]).toContain(getOperationsStoreState().status);
    });
  });

  it("partial success: dashboard ok + others fail still settles without loop", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.dashboard) {
        return { subscribed: true, consumptionForecast: null };
      }
      if (method === COST_BUDGET_ENDPOINTS.consumptionForecastGet) {
        return { subscribed: true, forecast: null };
      }
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);

    ensureOperationsStore(client, () => {});
    await vi.waitFor(() => {
      const s = getOperationsStoreState().status;
      expect(s === "partial" || s === "success").toBe(true);
    });
    expect(getOperationsStoreState().dashboard).toBeTruthy();
    const n = request.mock.calls.length;
    ensureOperationsStore(client, () => {});
    ensureOperationsStore(client, () => {});
    expect(request.mock.calls.length).toBe(n);
  });

  it("invalidate allows reconnect recovery load", async () => {
    const request = vi.fn(async () => {
      throw new Error("down");
    });
    const client = connectedClient(request);

    ensureOperationsStore(client, () => {});
    await vi.waitFor(() => expect(getOperationsStoreState().status).toBe("error"));
    const first = request.mock.calls.length;

    ensureOperationsStore(client, () => {});
    expect(request.mock.calls.length).toBe(first);

    invalidateOperationsStoreLoad();
    ensureOperationsStore(client, () => {});
    await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(first));
  });

  it("client switch resets prior data and does not keep stale status", async () => {
    const requestA = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.dashboard) {
        return { subscribed: true, tenantTag: "A", consumptionForecast: null };
      }
      if (method === COST_BUDGET_ENDPOINTS.consumptionForecastGet) {
        return { subscribed: true, forecast: null };
      }
      throw new Error(`${method} failed`);
    });
    const clientA = connectedClient(requestA);
    ensureOperationsStore(clientA, () => {}, { tenantId: "tenant-a" });
    await vi.waitFor(() => expect(getOperationsStoreState().dashboard).toBeTruthy());

    const requestB = vi.fn(async () => {
      throw new Error("tenant B down");
    });
    const clientB = connectedClient(requestB);
    ensureOperationsStore(clientB, () => {}, { tenantId: "tenant-b" });
    await vi.waitFor(() => expect(getOperationsStoreState().status).toBe("error"));
    // Data from A must not remain as success after B load failure without isolation —
    // ensure clears prior payloads when client changes.
    expect(getOperationsStoreState().dashboard).toBeNull();
  });

  it("invalidate during in-flight load allows a new reload after stale response", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.dashboard) {
        call += 1;
        if (call === 1) {
          await firstGate;
          return { subscribed: true, wave: 1, consumptionForecast: null };
        }
        return { subscribed: true, wave: 2, consumptionForecast: null };
      }
      if (method === COST_BUDGET_ENDPOINTS.consumptionForecastGet) {
        return { subscribed: true, forecast: null };
      }
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);

    const p1 = reloadOperationsStore(client, { tenantId: "t1" });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    // Reconnect while first load is still hanging.
    invalidateOperationsStoreLoad();
    const p2 = reloadOperationsStore(client, { tenantId: "t1" });
    // Stale first response returns after invalidate.
    releaseFirst();
    await Promise.allSettled([p1, p2]);
    await vi.waitFor(() => {
      expect(getOperationsStoreState().status).toBe("partial");
      expect((getOperationsStoreState().dashboard as { wave?: number } | null)?.wave).toBe(2);
    });
    // Third reload must not be stuck on a dead in-flight promise.
    const before = request.mock.calls.length;
    await reloadOperationsStore(client, { tenantId: "t1" });
    expect(request.mock.calls.length).toBeGreaterThan(before);
  });

  it("same client switching tenant clears data and ignores late prior response", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.dashboard) {
        // First tenant hangs until released.
        if (
          request.mock.calls.filter((c) => c[0] === COST_BUDGET_ENDPOINTS.dashboard).length === 1
        ) {
          await gateA;
          return { subscribed: true, tenant: "old", consumptionForecast: null };
        }
        return { subscribed: true, tenant: "new", consumptionForecast: null };
      }
      if (method === COST_BUDGET_ENDPOINTS.consumptionForecastGet) {
        return { subscribed: true, forecast: null };
      }
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);

    const pOld = reloadOperationsStore(client, { tenantId: "tenant-old" });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    // Switch enterprise on the same websocket client.
    ensureOperationsStore(client, () => {}, { tenantId: "tenant-new" });
    await vi.waitFor(() => {
      const s = getOperationsStoreState().status;
      expect(["loading", "partial", "success", "error"]).toContain(s);
    });
    // Late old response must not win.
    releaseA();
    await Promise.allSettled([pOld]);
    await vi.waitFor(() => {
      expect((getOperationsStoreState().dashboard as { tenant?: string } | null)?.tenant).toBe(
        "new",
      );
    });
  });
});

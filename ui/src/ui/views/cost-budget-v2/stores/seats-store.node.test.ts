import { afterEach, describe, expect, it, vi } from "vitest";
import { COST_BUDGET_ENDPOINTS } from "../../../capability/cost-budget-billing/endpoints.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  __resetSeatsStoreForTest,
  ensureSeatsStore,
  getSeatsStoreState,
  invalidateSeatsStoreLoad,
  reloadSeatsStore,
} from "./seats-store.ts";

function connectedClient(request: ReturnType<typeof vi.fn>): GatewayBrowserClient {
  return {
    get connected() {
      return true;
    },
    request,
  } as unknown as GatewayBrowserClient;
}

afterEach(() => {
  __resetSeatsStoreForTest();
});

describe("seats-store", () => {
  it("does not load when gateway is disconnected", () => {
    const request = vi.fn();
    const client = {
      get connected() {
        return false;
      },
      request,
    } as unknown as GatewayBrowserClient;
    ensureSeatsStore(client, () => {}, { tenantId: "t1" });
    expect(getSeatsStoreState().status).toBe("idle");
    expect(request).not.toHaveBeenCalled();
  });

  it("settles error without infinite ensure loop", async () => {
    const request = vi.fn(async () => {
      throw new Error("seats down");
    });
    const client = connectedClient(request);
    let n = 0;
    const rerender = () => {
      n += 1;
      if (n < 40) {
        ensureSeatsStore(client, rerender, { tenantId: "t1" });
      }
    };
    ensureSeatsStore(client, rerender, { tenantId: "t1" });
    await vi.waitFor(() => expect(getSeatsStoreState().status).toBe("error"));
    const calls = request.mock.calls.length;
    ensureSeatsStore(client, () => {}, { tenantId: "t1" });
    expect(request.mock.calls.length).toBe(calls);
  });

  it("invalidate mid-flight unlocks subsequent reloads", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wave = 0;
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.allocationOverview) {
        wave += 1;
        if (wave === 1) {
          await gate;
          return { seats: [], ceiling: {} };
        }
        return { seats: [{ id: "s1" }], ceiling: {} };
      }
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);
    const p1 = reloadSeatsStore(client, { tenantId: "t1" });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    invalidateSeatsStoreLoad();
    const p2 = reloadSeatsStore(client, { tenantId: "t1" });
    release();
    await Promise.allSettled([p1, p2]);
    const before = request.mock.calls.length;
    await reloadSeatsStore(client, { tenantId: "t1" });
    expect(request.mock.calls.length).toBeGreaterThan(before);
  });

  it("tenant switch on same client reloads scope", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.allocationOverview) {
        return { seats: [{ id: "ok" }], ceiling: {} };
      }
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);
    ensureSeatsStore(client, () => {}, { tenantId: "a" });
    await vi.waitFor(() => expect(getSeatsStoreState().allocation).toBeTruthy());
    const first = request.mock.calls.length;
    ensureSeatsStore(client, () => {}, { tenantId: "b" });
    await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(first));
  });
});

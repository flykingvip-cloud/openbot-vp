import { afterEach, describe, expect, it, vi } from "vitest";
import { COST_BUDGET_ENDPOINTS } from "../../../capability/cost-budget-billing/endpoints.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  __resetSubscriptionStoreForTest,
  ensureSubscriptionStore,
  getSubscriptionStoreState,
  invalidateSubscriptionStoreLoad,
} from "./subscription-store.ts";

function connectedClient(request: ReturnType<typeof vi.fn>): GatewayBrowserClient {
  return {
    get connected() {
      return true;
    },
    request,
  } as unknown as GatewayBrowserClient;
}

afterEach(() => {
  __resetSubscriptionStoreForTest();
});

describe("subscription-store load lifecycle", () => {
  it("settles error after subscriptions.get fails and does not re-request on ensure", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.subscriptionGet) {
        throw new Error("subscriptions.get denied");
      }
      if (method === COST_BUDGET_ENDPOINTS.commercialOrdersList) {
        return { orders: [] };
      }
      throw new Error(method);
    });
    const client = connectedClient(request);

    let n = 0;
    const rerender = () => {
      n += 1;
      if (n < 40) {
        ensureSubscriptionStore(client, rerender);
      }
    };

    ensureSubscriptionStore(client, rerender);
    await vi.waitFor(() => expect(getSubscriptionStoreState().status).toBe("error"));
    expect(getSubscriptionStoreState().subscriptionError).toMatch(/denied|失败/);
    const calls = request.mock.calls.length;
    ensureSubscriptionStore(client, () => {});
    ensureSubscriptionStore(client, () => {});
    expect(request.mock.calls.length).toBe(calls);
  });

  it("keeps catalog usable when only orders fail (partial)", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.subscriptionGet) {
        return {
          subscription: null,
          pricingCatalog: { plans: [], compareRows: [], faq: [], billingHint: "" },
        };
      }
      if (method === COST_BUDGET_ENDPOINTS.commercialOrdersList) {
        throw new Error("orders down");
      }
      throw new Error(method);
    });
    const client = connectedClient(request);
    ensureSubscriptionStore(client, () => {});
    await vi.waitFor(() => expect(getSubscriptionStoreState().status).toBe("partial"));
    expect(getSubscriptionStoreState().data?.pricingCatalog).toBeTruthy();
    expect(getSubscriptionStoreState().ordersError).toMatch(/orders/);
  });

  it("reconnect invalidate allows retry", async () => {
    const request = vi.fn(async () => {
      throw new Error("down");
    });
    const client = connectedClient(request);
    ensureSubscriptionStore(client, () => {});
    await vi.waitFor(() => expect(getSubscriptionStoreState().status).toBe("error"));
    const first = request.mock.calls.length;
    invalidateSubscriptionStoreLoad();
    ensureSubscriptionStore(client, () => {});
    await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(first));
  });
});

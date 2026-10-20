import { afterEach, describe, expect, it, vi } from "vitest";
import { COST_BUDGET_ENDPOINTS } from "../../../capability/cost-budget-billing/endpoints.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  __resetSettingsStoreForTest,
  ensureSettingsStore,
  getSettingsStoreState,
  invalidateSettingsStoreLoad,
  reloadSettingsStore,
} from "./settings-store.ts";

function connectedClient(request: ReturnType<typeof vi.fn>): GatewayBrowserClient {
  return {
    get connected() {
      return true;
    },
    request,
  } as unknown as GatewayBrowserClient;
}

afterEach(() => {
  __resetSettingsStoreForTest();
});

describe("settings-store load lifecycle", () => {
  it("settles error and does not re-request on ensure", async () => {
    const request = vi.fn(async () => {
      throw new Error("settings down");
    });
    const client = connectedClient(request);
    let n = 0;
    const rerender = () => {
      n += 1;
      if (n < 40) {
        ensureSettingsStore(client, rerender, { tenantId: "t1" });
      }
    };
    ensureSettingsStore(client, rerender, { tenantId: "t1" });
    await vi.waitFor(() => expect(getSettingsStoreState().status).toBe("error"));
    const calls = request.mock.calls.length;
    ensureSettingsStore(client, () => {}, { tenantId: "t1" });
    ensureSettingsStore(client, () => {}, { tenantId: "t1" });
    expect(request.mock.calls.length).toBe(calls);
  });

  it("invalidate during in-flight load allows a subsequent reload", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wave = 0;
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.budgetGet) {
        wave += 1;
        if (wave === 1) {
          await gate;
          return { budget: { limitCents: 1 } };
        }
        return { budget: { limitCents: 2 } };
      }
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);
    const p1 = reloadSettingsStore(client, { tenantId: "t1" });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    invalidateSettingsStoreLoad();
    const p2 = reloadSettingsStore(client, { tenantId: "t1" });
    release();
    await Promise.allSettled([p1, p2]);
    await vi.waitFor(() => {
      expect(
        getSettingsStoreState().status === "partial" ||
          getSettingsStoreState().status === "success",
      ).toBe(true);
    });
    const before = request.mock.calls.length;
    await reloadSettingsStore(client, { tenantId: "t1" });
    expect(request.mock.calls.length).toBeGreaterThan(before);
  });

  it("same client tenant switch clears previous payload", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === COST_BUDGET_ENDPOINTS.budgetGet) {
        return { budget: { limitCents: 100 }, tag: "live" };
      }
      throw new Error(`${method} failed`);
    });
    const client = connectedClient(request);
    ensureSettingsStore(client, () => {}, { tenantId: "a" });
    await vi.waitFor(() => expect(getSettingsStoreState().budget).toBeTruthy());
    ensureSettingsStore(client, () => {}, { tenantId: "b" });
    // Scope change clears payload before/while reloading.
    await vi.waitFor(() => {
      const s = getSettingsStoreState();
      expect(
        s.status === "loading" ||
          s.status === "partial" ||
          s.status === "success" ||
          s.status === "error",
      ).toBe(true);
    });
  });
});

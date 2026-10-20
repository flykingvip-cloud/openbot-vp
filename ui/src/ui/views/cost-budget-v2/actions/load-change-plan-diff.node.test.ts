import { describe, expect, it, vi } from "vitest";
import { __resetSubscriptionStoreForTest } from "../stores/subscription-store.ts";
import { loadChangePlanServerDiff } from "./load-change-plan-diff.ts";

describe("loadChangePlanServerDiff", () => {
  it("returns error when subscription context is missing", async () => {
    __resetSubscriptionStoreForTest();
    const client = {
      request: vi.fn(),
    };
    const result = await loadChangePlanServerDiff(client as never, "plan-pro");
    expect(result.error).toBe("无法加载套餐对比");
    expect(client.request).not.toHaveBeenCalled();
  });
});

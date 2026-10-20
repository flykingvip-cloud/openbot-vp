// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(tmpdir(), `openbot-ent-proj-event-${Date.now()}`);

// 把所有 store 落盘重定向到临时目录（CONFIG_DIR）。
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { billingEventBus } = await import("../billing/event-bus.js");
const { createSubscription } = await import("../billing/subscriptions-store.js");
const { upsertPlanVersionModelBinding } = await import("./plan-version-model-binding-store.js");
const { getEnterpriseModelEntitlement } = await import("./enterprise-model-entitlement-store.js");
const { ensureEntitlementProjectionConsumerRegistered } =
  await import("./entitlement-projection.js");

beforeEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  billingEventBus.__clearHandlersForTest();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("entitlement projection consumer (task 9 event wiring)", () => {
  it("refreshes entitlement when subscription.changed is published", async () => {
    await upsertPlanVersionModelBinding({
      planVersionId: "pv-1",
      allowedModelIds: ["api-proxy-gpt/gpt-5.2"],
    });
    await createSubscription({ enterpriseId: "t-evt", planId: "p", planVersionId: "pv-1" });

    ensureEntitlementProjectionConsumerRegistered();

    await billingEventBus.publish({
      type: "subscription.changed",
      enterpriseId: "t-evt",
      subscriptionId: "sub-1",
      toStatus: "active",
      planVersionId: "pv-1",
      occurredAt: new Date().toISOString(),
    });

    const persisted = await getEnterpriseModelEntitlement("t-evt");
    expect(persisted?.allowedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);
  });
});

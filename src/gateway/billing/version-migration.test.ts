// @vitest-environment node
// Feature: cost-budget-billing
// Task 40: 版本生命周期一次性迁移测试（R27.1 / R27.2 / R27.5）

import { describe, expect, it } from "vitest";
import type { Plan, PlanVersion, Subscription } from "./types.js";
import {
  bindSubscriptionVersions,
  migrateVersionLifecycle,
  normalizePlanVersionStatuses,
  type PlansStoreShape,
  type SubscriptionsStoreShape,
} from "./version-migration.js";

function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    name: "Growth",
    billingCycle: "monthly",
    basePriceCents: 0,
    currentVersionId: "pv-2",
    seatQuota: {},
    botQuota: 10,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function version(over: Partial<PlanVersion> & { id: string }): PlanVersion {
  return {
    planId: "plan-1",
    version: 1,
    status: "draft",
    snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 10, pricing: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUserId: "admin",
    ...over,
  } as PlanVersion;
}

function sub(over: Partial<Subscription> & { id: string }): Subscription {
  return {
    enterpriseId: "ent-1",
    planId: "plan-1",
    planVersionId: "",
    startTime: "2026-02-01T00:00:00.000Z",
    endTime: null,
    status: "active",
    createdAt: "2026-02-01T00:00:00.000Z",
    ...over,
  } as Subscription;
}

describe("normalizePlanVersionStatuses (R27.1)", () => {
  it("currentVersionId 置 active，其余 deprecated；已有 status 不触碰", () => {
    const store: PlansStoreShape = {
      plans: { "plan-1": plan({ currentVersionId: "pv-2" }) },
      planVersions: [
        version({ id: "pv-1", version: 1, status: undefined as never }),
        version({ id: "pv-2", version: 2, status: undefined as never }),
        version({ id: "pv-3", version: 3, status: "draft" }), // 已有 status：保持
      ],
    };
    const res = normalizePlanVersionStatuses(store);
    expect(res.changed).toBe(true);
    expect(res.count).toBe(2);
    expect(store.planVersions.find((v) => v.id === "pv-1")?.status).toBe("deprecated");
    expect(store.planVersions.find((v) => v.id === "pv-2")?.status).toBe("active");
    expect(store.planVersions.find((v) => v.id === "pv-3")?.status).toBe("draft");
  });

  it("无缺失 status 时不变更", () => {
    const store: PlansStoreShape = {
      plans: { "plan-1": plan() },
      planVersions: [version({ id: "pv-1", status: "active" })],
    };
    expect(normalizePlanVersionStatuses(store).changed).toBe(false);
  });
});

describe("bindSubscriptionVersions (R27.2 / R27.5)", () => {
  const plansStore: PlansStoreShape = {
    plans: { "plan-1": plan({ currentVersionId: "pv-2" }) },
    planVersions: [
      version({
        id: "pv-1",
        version: 1,
        status: "deprecated",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      version({ id: "pv-2", version: 2, status: "active", createdAt: "2026-03-01T00:00:00.000Z" }),
    ],
  };

  it("按创建时点解析版本（订阅早于 v2 → 绑 v1）", () => {
    const subStore: SubscriptionsStoreShape = {
      subscriptions: {
        "sub-1": sub({ id: "sub-1", planVersionId: "", createdAt: "2026-02-01T00:00:00.000Z" }),
      },
    };
    const res = bindSubscriptionVersions(subStore, plansStore);
    expect(res.changed).toBe(true);
    expect(subStore.subscriptions["sub-1"].planVersionId).toBe("pv-1");
    expect(subStore.subscriptions["sub-1"].migratedBinding).toBeUndefined();
    expect(res.report.boundSubscriptions).toBe(1);
    expect(res.report.migratedBindings).toBe(0);
  });

  it("无法判定创建时点（早于任何版本）→ 绑 active + migratedBinding", () => {
    const subStore: SubscriptionsStoreShape = {
      subscriptions: {
        "sub-2": sub({ id: "sub-2", planVersionId: "", createdAt: "2025-12-01T00:00:00.000Z" }),
      },
    };
    const res = bindSubscriptionVersions(subStore, plansStore);
    expect(subStore.subscriptions["sub-2"].planVersionId).toBe("pv-2");
    expect(subStore.subscriptions["sub-2"].migratedBinding).toBe(true);
    expect(res.report.migratedBindings).toBe(1);
  });

  it("已锁定 planVersionId 的订阅不被改写（R27.5 历史不变量）", () => {
    const subStore: SubscriptionsStoreShape = {
      subscriptions: {
        "sub-3": sub({ id: "sub-3", planVersionId: "pv-1", createdAt: "2026-04-01T00:00:00.000Z" }),
      },
    };
    const res = bindSubscriptionVersions(subStore, plansStore);
    expect(subStore.subscriptions["sub-3"].planVersionId).toBe("pv-1"); // 不变
    expect(res.changed).toBe(false);
  });

  it("plan 无任何版本 → unresolvable，不改动", () => {
    const emptyPlans: PlansStoreShape = {
      plans: { "plan-x": plan({ id: "plan-x" }) },
      planVersions: [],
    };
    const subStore: SubscriptionsStoreShape = {
      subscriptions: {
        "sub-4": sub({ id: "sub-4", planId: "plan-x", planVersionId: "" }),
      },
    };
    const res = bindSubscriptionVersions(subStore, emptyPlans);
    expect(res.report.unresolvable).toBe(1);
    expect(subStore.subscriptions["sub-4"].planVersionId).toBe("");
  });
});

describe("migrateVersionLifecycle 综合报告", () => {
  it("归一化 + 补绑一并执行并汇总", () => {
    const plansStore: PlansStoreShape = {
      plans: { "plan-1": plan({ currentVersionId: "pv-2" }) },
      planVersions: [
        version({
          id: "pv-1",
          version: 1,
          status: undefined as never,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
        version({
          id: "pv-2",
          version: 2,
          status: undefined as never,
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
    };
    const subStore: SubscriptionsStoreShape = {
      subscriptions: {
        "sub-1": sub({ id: "sub-1", planVersionId: "", createdAt: "2026-02-01T00:00:00.000Z" }),
        "sub-2": sub({ id: "sub-2", planVersionId: "pv-2", createdAt: "2026-04-01T00:00:00.000Z" }),
      },
    };
    const report = migrateVersionLifecycle(plansStore, subStore);
    expect(report.normalizedVersions).toBe(2);
    expect(report.boundSubscriptions).toBe(1); // sub-1 only
    expect(subStore.subscriptions["sub-1"].planVersionId).toBe("pv-1");
    expect(subStore.subscriptions["sub-2"].planVersionId).toBe("pv-2"); // untouched
  });
});

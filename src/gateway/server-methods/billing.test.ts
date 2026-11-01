// @vitest-environment node
// Feature: cost-budget-billing
// Task 20: Gateway billing handler 单元测试

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-billing-handlers-${Date.now()}`);

// 重定向所有 billing store 落盘到临时目录。
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

// 固定企业作用域（enterprise-admin，持有 usage:budget）。
vi.mock("../billing/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../billing/scope.js")>();
  return {
    ...actual,
    resolveBillingScope: vi.fn(async () => ({
      enterpriseId: "ent-test",
      user: { id: "user-1" },
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set([actual.USAGE_BUDGET_PERMISSION]),
    })),
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    models: {
      providers: {
        "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }] },
        ollama: { models: [{ id: "llama3.2" }] },
      },
    },
  }),
}));

const { platformPlansHandlers, platformPricingHandlers } = await import("./platform-plans.js");
const { subscriptionsHandlers } = await import("./subscriptions.js");
const { seatsHandlers } = await import("./seats.js");
const { budgetHandlers } = await import("./budget.js");
const { usageIngestHandlers } = await import("./usage-ingest.js");
const { resourcesHandlers } = await import("./resources.js");
const { costControlHandlers } = await import("./cost-control.js");
const { billingHandlers } = await import("./billing.js");
const { billingEventBus } = await import("../billing/event-bus.js");
const { resolveBillingScope } = await import("../billing/scope.js");
const { getPlanVersionModelBinding, upsertPlanVersionModelBinding } =
  await import("../model-entitlement/plan-version-model-binding-store.js");
const { upsertPlanEntitlementSnapshot } =
  await import("../package-entitlement/plan-version-entitlement-store.js");

const allHandlers = {
  ...platformPlansHandlers,
  ...platformPricingHandlers,
  ...subscriptionsHandlers,
  ...seatsHandlers,
  ...budgetHandlers,
  ...usageIngestHandlers,
  ...resourcesHandlers,
  ...costControlHandlers,
  ...billingHandlers,
};

type HandlerError = { code?: string; message?: string };

// 测试用版本/账单/diff 形态：仅声明断言访问到的字段，避免 explicit any。
type VersionLike = { id: string; version: number; status: string };
type BillLike = {
  planVersionId: string;
  usageCostCents: number;
  extraCostCents?: number;
  totalCostCents?: number;
  cycleStart?: string;
};
type DiffEntryLike = {
  type: string;
  key: string;
  change: string;
  oldPriceCents?: number;
  newPriceCents?: number;
};

// 泛型 invoke：调用方按各 handler 的返回结构传入 payload 类型，默认宽松索引类型。
async function invoke<P = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: P; error: HandlerError }> {
  const handler = allHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: { ok: boolean; payload: P; error: HandlerError } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as P, error: (error ?? {}) as HandlerError };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(() => {
  vi.stubEnv("OPENBOT_COMMERCE_LEGACY_BYPASS", "1");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function createPlanFixture(): Promise<string> {
  const res = await invoke("platform-plans.create", {
    name: "Growth",
    billingCycle: "monthly",
    basePriceCents: 0,
    seatQuota: { viewer: 2, creator: 2 },
    botQuota: 3,
    pricing: [
      { type: "extra", key: "seat:viewer", priceCents: 1000 },
      { type: "extra", key: "seat:creator", priceCents: 3000 },
      { type: "extra", key: "ai_token", priceCents: 2 },
      { type: "usage", key: "ai_token", priceCents: 2 },
    ],
  });
  expect(res.ok).toBe(true);
  const planId = res.payload.planId as string;
  const planVersionId = (res.payload as { plan: { currentVersionId: string } }).plan
    .currentVersionId;
  await upsertPlanEntitlementSnapshot({
    planVersionId,
    monthlyPriceCents: 0,
    monthlyCredits: 10_000,
    maxSeats: { viewer: 2, creator: 2 },
    maxBots: 3,
  });
  return planId;
}

async function setBindingForVersion(
  planVersionId: string,
  allowedModelIds: string[] = ["api-proxy-deepseek/deepseek-chat"],
): Promise<void> {
  await upsertPlanVersionModelBinding({ planVersionId, allowedModelIds });
}

describe("platform-plans", () => {
  it("create + list", async () => {
    const planId = await createPlanFixture();
    expect(planId).toBeTruthy();
    const list = await invoke("platform-plans.list");
    expect(list.ok).toBe(true);
    expect(list.payload.plans).toHaveLength(1);
  });

  it("拒绝负数 basePrice", async () => {
    const res = await invoke("platform-plans.create", {
      name: "Bad",
      billingCycle: "monthly",
      basePriceCents: -1,
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_REQUEST");
  });

  it("缺少 name 被拒", async () => {
    const res = await invoke("platform-plans.create", {
      billingCycle: "monthly",
      basePriceCents: 0,
    });
    expect(res.ok).toBe(false);
  });

  it("update 追加版本", async () => {
    const planId = await createPlanFixture();
    const res = await invoke("platform-plans.update", { planId, basePriceCents: 500 });
    expect(res.ok).toBe(true);
    expect(res.payload.planVersionId).toBeTruthy();
  });

  it("pricing.set 负价被拒", async () => {
    const planId = await createPlanFixture();
    const res = await invoke("platform-pricing.set", {
      planId,
      type: "usage",
      key: "x",
      priceCents: -5,
    });
    expect(res.ok).toBe(false);
  });
});

describe("subscriptions", () => {
  it("subscribe 成功并锁定版本", async () => {
    const planId = await createPlanFixture();
    const res = await invoke("subscriptions.subscribe", { planId });
    expect(res.ok).toBe(true);
    const subscription = res.payload?.subscription as { planVersionId?: string } | undefined;
    expect(subscription?.planVersionId).toBeTruthy();
  });

  it("未知 plan 被拒", async () => {
    const res = await invoke("subscriptions.subscribe", { planId: "nope" });
    expect(res.ok).toBe(false);
  });

  it("重复订阅被拒", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    const dup = await invoke("subscriptions.subscribe", { planId });
    expect(dup.ok).toBe(false);
  });
});

describe("seats", () => {
  it("assign + list", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    const res = await invoke("seats.assign", { userId: "u1", role: "viewer", botQuota: 1 });
    expect(res.ok).toBe(true);
    const list = await invoke("seats.list");
    expect(list.payload.seats).toHaveLength(1);
  });

  it("超角色配额被拒", async () => {
    const planId = await createPlanFixture(); // viewer quota=2
    await invoke("subscriptions.subscribe", { planId });
    await invoke("seats.assign", { userId: "u1", role: "viewer" });
    await invoke("seats.assign", { userId: "u2", role: "viewer" });
    const third = await invoke("seats.assign", { userId: "u3", role: "viewer" });
    expect(third.ok).toBe(false);
  });

  it("set-role 切换角色", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    const seat = await invoke<{ seat: { id: string } }>("seats.assign", {
      userId: "u1",
      role: "viewer",
    });
    const res = await invoke<{ seat: { currentRole: string } }>("seats.set-role", {
      seatId: seat.payload.seat.id,
      role: "creator",
    });
    expect(res.ok).toBe(true);
    expect(res.payload.seat.currentRole).toBe("creator");
  });
});

describe("budget", () => {
  it("set + get（默认阈值 0.8）", async () => {
    const res = await invoke<{ budget: { alertThreshold: number } }>("budget.set", {
      monthlyLimitCents: 100000,
    });
    expect(res.ok).toBe(true);
    expect(res.payload.budget.alertThreshold).toBe(0.8);
    const get = await invoke<{ budget: { monthlyLimitCents: number } }>("budget.get");
    expect(get.payload.budget.monthlyLimitCents).toBe(100000);
  });

  it("负 limit 被拒", async () => {
    const res = await invoke("budget.set", { monthlyLimitCents: -1 });
    expect(res.ok).toBe(false);
  });

  it("阈值越界被拒", async () => {
    const res = await invoke("budget.set", { monthlyLimitCents: 100, alertThreshold: 1.5 });
    expect(res.ok).toBe(false);
  });

  it("无 usage:budget 权限被拒", async () => {
    vi.mocked(resolveBillingScope).mockResolvedValueOnce({
      enterpriseId: "ent-test",
      user: null,
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    const res = await invoke("budget.set", { monthlyLimitCents: 100 });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("usage:budget");
  });
});

describe("usage-ingest 幂等", () => {
  it("同 eventId 第二次 deduped", async () => {
    const first = await invoke("usage-ingest.report", {
      eventId: "e1",
      key: "ai_token",
      quantity: 100,
    });
    expect(first.payload).toEqual({ recorded: true, deduped: false });
    const second = await invoke("usage-ingest.report", {
      eventId: "e1",
      key: "ai_token",
      quantity: 100,
    });
    expect(second.payload).toEqual({ recorded: false, deduped: true });
  });

  it("负 quantity 被拒", async () => {
    const res = await invoke("usage-ingest.report", {
      eventId: "e2",
      key: "ai_token",
      quantity: -1,
    });
    expect(res.ok).toBe(false);
  });

  it("agentId 自动解析 orgSeatId 并写入用量记录", async () => {
    const { saveEnterpriseSeatAssetsStore } = await import("../enterprise-seat-assets-store.js");
    const seatStorePath = path.join(tmpDir, "openbot-enterprise-seat-assets.json");
    await saveEnterpriseSeatAssetsStore(seatStorePath, {
      version: 4,
      seats: {
        "seat-auto": {
          seatId: "seat-auto",
          tenantId: "ent-test",
          title: "测试岗位",
          status: "occupied",
          defaultSpaceIds: [],
          defaultAgentAssetIds: ["agent-auto"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      bindings: {},
      accessPolicies: {},
      assetBindings: {},
      credentialBindings: {},
      handovers: {},
      offers: {},
      auditEvents: {},
      enterpriseIdentities: {},
      identityUsagePolicies: {},
      dataSourceIdentityBindings: {},
      employeeIdentityEnrollments: {},
    });

    const res = await invoke("usage-ingest.report", {
      eventId: "e-auto-tag",
      key: "ai_token",
      quantity: 42,
      agentId: "agent-auto",
    });
    expect(res.ok).toBe(true);
    expect(res.payload).toEqual({ recorded: true, deduped: false });

    const { listUsageRecords } = await import("../billing/usage-records-store.js");
    const records = await listUsageRecords("ent-test");
    const tagged = records.find((r) => r.eventId === "e-auto-tag");
    expect(tagged?.agentId).toBe("agent-auto");
    expect(tagged?.orgSeatId).toBe("seat-auto");
  });

  it("backfill-usage-attribution 补齐历史记录标签", async () => {
    const { saveEnterpriseSeatAssetsStore } = await import("../enterprise-seat-assets-store.js");
    const seatStorePath = path.join(tmpDir, "openbot-enterprise-seat-assets.json");
    await saveEnterpriseSeatAssetsStore(seatStorePath, {
      version: 4,
      seats: {
        "seat-bf": {
          seatId: "seat-bf",
          tenantId: "ent-test",
          title: "回填岗位",
          status: "occupied",
          defaultSpaceIds: [],
          defaultAgentAssetIds: ["agent-bf"],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      bindings: {},
      accessPolicies: {},
      assetBindings: {},
      credentialBindings: {},
      handovers: {},
      offers: {},
      auditEvents: {},
      enterpriseIdentities: {},
      identityUsagePolicies: {},
      dataSourceIdentityBindings: {},
      employeeIdentityEnrollments: {},
    });

    const runId = "historical-run-1";
    await invoke("usage-ingest.report", {
      eventId: `credit:${runId}`,
      key: "ai_credits",
      quantity: 3,
      userId: "user-1",
    });

    const { backfillUsageAttribution } = await import("../billing/usage-attribution-backfill.js");
    const runIndex = new Map([[runId, { agentId: "agent-bf" }]]);
    const dry = await backfillUsageAttribution({
      enterpriseId: "ent-test",
      dryRun: true,
      runIndex,
      seatAssetsPath: seatStorePath,
    });
    expect(dry.updated).toBe(1);

    const applied = await backfillUsageAttribution({
      enterpriseId: "ent-test",
      runIndex,
      seatAssetsPath: seatStorePath,
    });
    expect(applied.updated).toBe(1);

    const { listUsageRecords } = await import("../billing/usage-records-store.js");
    const row = (await listUsageRecords("ent-test")).find((r) => r.eventId === `credit:${runId}`);
    expect(row?.agentId).toBe("agent-bf");
    expect(row?.orgSeatId).toBe("seat-bf");
  });
});

describe("billing.attribution-by-position", () => {
  async function createPlanWithAiAuthPricing(): Promise<{ planId: string; planVersionId: string }> {
    const res = await invoke("platform-plans.create", {
      name: "AI Auth Plan",
      billingCycle: "monthly",
      basePriceCents: 0,
      seatQuota: { viewer: 2, creator: 2 },
      botQuota: 3,
      pricing: [
        { type: "extra", key: "seat:viewer", priceCents: 1000 },
        { type: "extra", key: "profile:pro", priceCents: 4000 },
        { type: "extra", key: "ai_token", priceCents: 2 },
        { type: "usage", key: "ai_token", priceCents: 2 },
      ],
    });
    expect(res.ok).toBe(true);
    const planId = res.payload.planId as string;
    const planVersionId = (res.payload as { plan: { currentVersionId: string } }).plan
      .currentVersionId;
    await upsertPlanEntitlementSnapshot({
      planVersionId,
      monthlyPriceCents: 0,
      monthlyCredits: 10_000,
      maxSeats: { viewer: 2, creator: 2 },
      maxBots: 3,
      aiProfileQuota: { basic: 0, pro: 0, elite: 0 },
    });
    return { planId, planVersionId };
  }

  it("AI 授权超额 settle 后岗位归因总额与 Bill 一致", async () => {
    const { planId } = await createPlanWithAiAuthPricing();
    await invoke("subscriptions.subscribe", { planId });
    await invoke("seats.assign", {
      userId: "alice@example.com",
      role: "viewer",
      botQuota: 1,
      entitlementProfileId: "pro_ai",
    });
    await invoke("seats.assign", {
      userId: "bob@example.com",
      role: "viewer",
      botQuota: 1,
      entitlementProfileId: "pro_ai",
    });
    const settle = await invoke<{ bill: BillLike }>("billing.settle", {
      now: "2026-12-01T00:00:00.000Z",
    });
    expect(settle.ok).toBe(true);
    expect(settle.payload.bill.extraCostCents).toBeGreaterThan(0);

    const seatAttr = await invoke<{
      summary: { totalCostCents: number; extraCostCents: number };
    }>("billing.attribution-by-seat", {});
    const posAttr = await invoke<{
      summary: { totalCostCents: number; extraCostCents: number };
      rows: Array<{ orgSeatId: string; extraCostCents: number }>;
    }>("billing.attribution-by-position", {});

    expect(seatAttr.ok).toBe(true);
    expect(posAttr.ok).toBe(true);
    expect(seatAttr.payload.summary.totalCostCents).toBe(settle.payload.bill.totalCostCents);
    expect(posAttr.payload.summary.totalCostCents).toBe(settle.payload.bill.totalCostCents);
    expect(posAttr.payload.summary.extraCostCents).toBe(settle.payload.bill.extraCostCents);
    const unallocated = posAttr.payload.rows.find((row) => row.orgSeatId === "_unallocated");
    expect(unallocated?.extraCostCents ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("无组织岗位时回退为账单席位行", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    await invoke("seats.assign", { userId: "alice@example.com", role: "viewer", botQuota: 1 });
    const res = await invoke<{
      subscribed: boolean;
      rows: Array<{ orgSeatId: string; memberUserId: string | null; billingRole: string | null }>;
    }>("billing.attribution-by-position", {});
    expect(res.ok).toBe(true);
    expect(res.payload.subscribed).toBe(true);
    expect(res.payload.rows.length).toBeGreaterThanOrEqual(1);
    const row = res.payload.rows.find((entry) => entry.memberUserId === "alice@example.com");
    expect(row?.orgSeatId.startsWith("billing:")).toBe(true);
    expect(row?.billingRole).toBe("viewer");
  });
});

describe("platform-pricing 版本生命周期（Task 35）", () => {
  it("create-version 产生 draft 版本（不影响 active）", async () => {
    const planId = await createPlanFixture();
    const res = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    expect(res.ok).toBe(true);
    expect(res.payload.version.status).toBe("draft");
    // 当前 active 版本仍为创建时的 v1。
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    expect(list.ok).toBe(true);
    const active = list.payload.versions.filter((v) => v.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(1);
  });

  it("create-version 自动继承当前 active 版本的模型绑定", async () => {
    const planId = await createPlanFixture();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = list.payload.versions.find((v) => v.status === "active");
    await upsertPlanVersionModelBinding({
      planVersionId: active!.id,
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    expect(draft.ok).toBe(true);
    const inherited = await getPlanVersionModelBinding(draft.payload.version.id);
    expect(inherited?.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("delete-version 删除 draft 版本成功（active 与 current 保留）", async () => {
    const planId = await createPlanFixture();
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    await upsertPlanVersionModelBinding({
      planVersionId: draft.payload.version.id,
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const del = await invoke<{ deletedVersionId: string }>("platform-pricing.delete-version", {
      planId,
      versionId: draft.payload.version.id,
    });
    expect(del.ok).toBe(true);
    expect(del.payload.deletedVersionId).toBe(draft.payload.version.id);
    expect(await getPlanVersionModelBinding(draft.payload.version.id)).toBeNull();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    expect(list.payload.versions).toHaveLength(1);
    expect(list.payload.versions[0].status).toBe("active");
  });

  it("delete-version 拒绝删除 active 版本", async () => {
    const planId = await createPlanFixture();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = list.payload.versions.find((v) => v.status === "active");
    const del = await invoke("platform-pricing.delete-version", {
      planId,
      versionId: active?.id,
    });
    expect(del.ok).toBe(false);
  });

  it("delete-version 拒绝删除被订阅引用的版本", async () => {
    const planId = await createPlanFixture();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const v1 = list.payload.versions[0].id;
    await setBindingForVersion(v1);
    // 企业订阅锁定 v1
    await invoke("subscriptions.subscribe", { planId, planVersionId: v1 });
    // 激活 v2 → v1 变 deprecated
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 9 }],
    });
    await invoke("platform-pricing.activate", {
      planId,
      versionId: draft.payload.version.id,
      requestId: "act-del-guard",
    });
    // v1 已 deprecated 但被订阅引用 → 删除被拒
    const del = await invoke("platform-pricing.delete-version", { planId, versionId: v1 });
    expect(del.ok).toBe(false);
  });

  it("activate 切换单一 active（原 active 降级 deprecated）", async () => {
    const planId = await createPlanFixture();
    const listBefore = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const activeBefore = listBefore.payload.versions.find((v) => v.status === "active");
    await setBindingForVersion(activeBefore!.id);
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    const versionId = draft.payload.version.id;
    const act = await invoke<{ planVersion: VersionLike }>("platform-pricing.activate", {
      planId,
      versionId,
      requestId: "req-act-1",
    });
    expect(act.ok).toBe(true);
    expect(act.payload.planVersion.status).toBe("active");
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = list.payload.versions.filter((v) => v.status === "active");
    const deprecated = list.payload.versions.filter((v) => v.status === "deprecated");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(versionId);
    expect(deprecated).toHaveLength(1); // 原 v1
  });

  it("activate 拒绝未配置模型绑定的版本", async () => {
    const planId = await createPlanFixture();
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    expect(await getPlanVersionModelBinding(draft.payload.version.id)).toBeNull();
    const res = await invoke("platform-pricing.activate", {
      planId,
      versionId: draft.payload.version.id,
      requestId: "req-no-binding",
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("尚未配置可用模型绑定");
  });

  it("activate 拒绝包含目录外模型的版本绑定", async () => {
    const planId = await createPlanFixture();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = list.payload.versions.find((v) => v.status === "active");
    await upsertPlanVersionModelBinding({
      planVersionId: active!.id,
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    await upsertPlanVersionModelBinding({
      planVersionId: draft.payload.version.id,
      allowedModelIds: ["legacy/removed"],
    });
    const res = await invoke("platform-pricing.activate", {
      planId,
      versionId: draft.payload.version.id,
      requestId: "req-invalid-binding",
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("目录外模型");
  });

  it("相同 requestId 重复激活幂等（不重复降级）", async () => {
    const planId = await createPlanFixture();
    const listBefore = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const activeBefore = listBefore.payload.versions.find((v) => v.status === "active");
    await setBindingForVersion(activeBefore!.id);
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    const versionId = draft.payload.version.id;
    const first = await invoke("platform-pricing.activate", {
      planId,
      versionId,
      requestId: "req-idem",
    });
    expect(first.ok).toBe(true);
    const second = await invoke("platform-pricing.activate", {
      planId,
      versionId,
      requestId: "req-idem",
    });
    expect(second.ok).toBe(true);
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = list.payload.versions.filter((v) => v.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(versionId);
  });

  it("draft 版本不可订阅", async () => {
    const planId = await createPlanFixture();
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    const res = await invoke("subscriptions.subscribe", {
      planVersionId: draft.payload.version.id,
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("draft");
  });

  it("deprecated 版本不可订阅", async () => {
    const planId = await createPlanFixture();
    const listBefore = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const activeBefore = listBefore.payload.versions.find((v) => v.status === "active");
    await setBindingForVersion(activeBefore!.id);
    // 新建 draft 并激活 → 原 v1 变 deprecated。
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
    });
    await invoke("platform-pricing.activate", {
      planId,
      versionId: draft.payload.version.id,
      requestId: "req-dep",
    });
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const deprecated = list.payload.versions.find((v) => v.status === "deprecated");
    const res = await invoke("subscriptions.subscribe", {
      planVersionId: deprecated?.id,
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("deprecated");
  });

  it("subscribe(planVersionId) 标准路径锁定 active 版本", async () => {
    const planId = await createPlanFixture();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = list.payload.versions.find((v) => v.status === "active");
    const res = await invoke<{
      subscription: { planVersionId: string; resolvedFromPlanId?: boolean };
    }>("subscriptions.subscribe", { planVersionId: active?.id });
    expect(res.ok).toBe(true);
    expect(res.payload.subscription.planVersionId).toBe(active?.id);
    expect(res.payload.subscription.resolvedFromPlanId).toBeFalsy();
  });

  it("subscribe(planId) UI 路径标记 resolvedFromPlanId", async () => {
    const planId = await createPlanFixture();
    const res = await invoke<{ subscription: { resolvedFromPlanId?: boolean } }>(
      "subscriptions.subscribe",
      { planId },
    );
    expect(res.ok).toBe(true);
    expect(res.payload.subscription.resolvedFromPlanId).toBe(true);
  });

  it("非法流转：激活非 draft（active）被拒", async () => {
    const planId = await createPlanFixture();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = list.payload.versions.find((v) => v.status === "active");
    const res = await invoke("platform-pricing.activate", {
      planId,
      versionId: active?.id,
      requestId: "req-bad",
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_REQUEST");
  });

  it("diff 正确反映定价变化", async () => {
    const planId = await createPlanFixture();
    const list = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const fromVersionId = list.payload.versions[0].id;
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [
        { type: "extra", key: "seat:viewer", priceCents: 1000 }, // unchanged
        { type: "extra", key: "seat:creator", priceCents: 5000 }, // changed 3000→5000
        { type: "extra", key: "storage", priceCents: 100 }, // added
        { type: "extra", key: "ai_token", priceCents: 2 },
        { type: "usage", key: "ai_token", priceCents: 2 },
      ],
    });
    const diff = await invoke<{ diff: { entries: DiffEntryLike[] } }>("platform-pricing.diff", {
      fromVersionId,
      toVersionId: draft.payload.version.id,
    });
    expect(diff.ok).toBe(true);
    const entries = diff.payload.diff.entries;
    const byKey = (t: string, k: string) => entries.find((e) => e.type === t && e.key === k);
    expect(byKey("extra", "seat:viewer")?.change).toBe("unchanged");
    expect(byKey("extra", "seat:creator")?.change).toBe("changed");
    expect(byKey("extra", "storage")?.change).toBe("added");
    expect(byKey("usage", "ai_token")?.change).toBe("unchanged");
  });
});

describe("dashboard + settle + 闸口", () => {
  it("无订阅 dashboard 空态", async () => {
    const res = await invoke("billing.dashboard");
    expect(res.ok).toBe(true);
    expect(res.payload.subscribed).toBe(false);
    expect(res.payload.accruedCents).toBe(0);
    expect(res.payload.commercialGovernanceStatus).toBe("normal");
    expect(res.payload.overAllocation).toBeNull();
    expect(res.payload.consumptionForecast).toBeDefined();
    expect(res.payload.creditsReconciliation).toBeDefined();
    expect(res.payload.stale).toBe(false);
    expect(JSON.stringify(res.payload)).not.toContain("providerCostCents");
    expect(JSON.stringify(res.payload)).not.toContain("marginCents");
  });

  it("returns a payload marked stale when replay is truncated instead of waiting forever", async () => {
    const spy = vi.spyOn(billingEventBus, "replayPending").mockResolvedValue({
      replayed: 0,
      truncated: true,
      timedOutEvents: 1,
    });
    try {
      const res = await invoke<{ stale: boolean; subscribed: boolean }>("billing.dashboard");
      expect(res.ok).toBe(true);
      expect(res.payload.subscribed).toBe(false);
      expect(res.payload.stale).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns a real error well under the UI watchdog when dashboard work does not finish", async () => {
    vi.stubEnv("OPENBOT_BILLING_DASHBOARD_DEADLINE_MS", "60");
    let releaseReplay: (() => void) | undefined;
    const spy = vi.spyOn(billingEventBus, "replayPending").mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseReplay = () => resolve({ replayed: 0, truncated: false, timedOutEvents: 0 });
        }),
    );
    try {
      const started = Date.now();
      const res = await invoke("billing.dashboard");
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(res.ok).toBe(false);
      expect(res.error.message).toMatch(/timed out after 60ms/);
    } finally {
      releaseReplay?.();
      // Let the in-flight handler finish against the temp store before cleanup.
      await new Promise((resolve) => setTimeout(resolve, 300));
      spy.mockRestore();
      delete process.env.OPENBOT_BILLING_DASHBOARD_DEADLINE_MS;
    }
  });

  it("订阅 + 用量后 dashboard 反映成本，settle 生成 final 账单", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    await invoke("seats.assign", { userId: "u1", role: "viewer" });
    await invoke("usage-ingest.report", { eventId: "e1", key: "ai_token", quantity: 1000 });
    const dash = await invoke("billing.dashboard");
    expect(dash.payload.subscribed).toBe(true);
    // ai_token：套餐内免费，超额进 extra（1000 * 2）
    expect(dash.payload.usageCostCents).toBe(0);
    expect(dash.payload.extraCostCents).toBe(2000);
    const settle = await invoke<{ snapshot: { snapshotType: string } }>("billing.settle", {
      now: "2026-12-01T00:00:00.000Z",
    });
    expect(settle.ok).toBe(true);
    expect(settle.payload.snapshot.snapshotType).toBe("final");
    const bills = await invoke<{ bills: BillLike[] }>("billing.list-bills");
    expect(bills.payload.bills).toHaveLength(1);
  });

  it("attribution-by-seat 返回按席位归因的本周期成本", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    const assign = await invoke<{ seat: { id: string } }>("seats.assign", {
      userId: "u1",
      role: "viewer",
    });
    expect(assign.ok).toBe(true);
    await invoke("usage-ingest.report", {
      eventId: "attr-e1",
      userId: "u1",
      key: "ai_token",
      quantity: 500,
    });
    const res = await invoke<{
      subscribed: boolean;
      rows: Array<{ billingSeatId: string; totalCostCents: number; usageCostCents: number }>;
      summary: { totalCostCents: number };
    }>("billing.attribution-by-seat", {});
    expect(res.ok).toBe(true);
    expect(res.payload.subscribed).toBe(true);
    expect(res.payload.rows).toHaveLength(1);
    expect(res.payload.rows[0]?.billingSeatId).toBe(assign.payload.seat.id);
    expect(res.payload.rows[0]?.usageCostCents).toBe(1000);
    // 套餐内席位免费：总额 = 用量超额应付
    expect(res.payload.rows[0]?.totalCostCents).toBe(1000);
    expect(res.payload.summary.totalCostCents).toBe(res.payload.rows[0]?.totalCostCents);
  });

  it("预算超限 + 启用 limitBotCreation → create-bot 被拒（执行前）", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    await invoke("seats.assign", { userId: "u1", role: "creator" });
    // 产生超额用量成本，触发预算闸口
    await invoke("usage-ingest.report", {
      eventId: "budget-e1",
      userId: "u1",
      key: "ai_token",
      quantity: 1000,
    });
    await invoke("budget.set", { monthlyLimitCents: 1, controls: { limitBotCreation: true } });
    const res = await invoke("resources.create-bot", { ownerUserId: "u1" });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("预算");
  });

  it("cost-control.check 反映放行/拒绝", async () => {
    const planId = await createPlanFixture();
    await invoke("subscriptions.subscribe", { planId });
    // 未设预算 → 放行
    const ok = await invoke("cost-control.check", { action: "ai" });
    expect(ok.payload.allowed).toBe(true);
  });
});

describe("端到端：平台版本切换不污染历史账单（Task B 联调）", () => {
  it("订阅锁定 v1 → 平台建 v2 调价并激活 → 既有订阅仍按 v1 计费且历史账单不变", async () => {
    // 1) 平台建套餐（v1：viewer=1000, ai_token=2），首版本 active
    const planId = await createPlanFixture();
    const v1List = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const v1 = v1List.payload.versions.find((v) => v.status === "active");
    expect(v1?.version).toBe(1);
    await setBindingForVersion(v1!.id);

    // 2) 企业订阅（UI 路径 planId → 解析 active v1，锁定）
    const sub = await invoke<{ subscription: { planVersionId: string } }>(
      "subscriptions.subscribe",
      { planId },
    );
    expect(sub.ok).toBe(true);
    expect(sub.payload.subscription.planVersionId).toBe(v1?.id);

    // 3) 产生用量并结算 → 生成 v1 final 账单
    await invoke("seats.assign", { userId: "u1", role: "viewer" });
    await invoke("usage-ingest.report", { eventId: "e1", key: "ai_token", quantity: 1000 });
    const settle1 = await invoke("billing.settle", { now: "2026-12-01T00:00:00.000Z" });
    expect(settle1.ok).toBe(true);
    const billsBefore = await invoke<{ bills: BillLike[] }>("billing.list-bills");
    const v1Bill = billsBefore.payload.bills.find((b) => b.planVersionId === v1?.id);
    expect(v1Bill).toBeTruthy();
    expect(v1Bill?.usageCostCents).toBe(0);
    expect(v1Bill?.extraCostCents).toBe(2000); // 1000 * extra/ai_token=2（v1 价）
    const v1BillSnapshot = JSON.stringify(v1Bill);

    // 4) 平台建 v2（涨价：extra/ai_token=5）并激活
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [
        { type: "extra", key: "seat:viewer", priceCents: 1000 },
        { type: "extra", key: "seat:creator", priceCents: 3000 },
        { type: "extra", key: "ai_token", priceCents: 5 },
        { type: "usage", key: "ai_token", priceCents: 5 },
      ],
    });
    expect(draft.payload.version.status).toBe("draft");
    const act = await invoke("platform-pricing.activate", {
      planId,
      versionId: draft.payload.version.id,
      requestId: "e2e-activate-v2",
    });
    expect(act.ok).toBe(true);

    // 5) 验证：单一 active 已切到 v2，v1 已 deprecated
    const afterList = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const active = afterList.payload.versions.filter((v) => v.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(draft.payload.version.id);
    expect(afterList.payload.versions.find((v) => v.id === v1?.id)?.status).toBe("deprecated");

    // 6) 关键不变量：既有订阅仍绑 v1（不随 active 漂移）
    const subAfter = await invoke<{
      subscription: { planVersionId: string };
      planVersion: { version: number };
    }>("subscriptions.get");
    expect(subAfter.payload.subscription.planVersionId).toBe(v1?.id);
    expect(subAfter.payload.planVersion.version).toBe(1);

    // 7) 关键不变量：v1 历史账单逐字节不变（R27.5）
    const billsAfter = await invoke<{ bills: BillLike[] }>("billing.list-bills");
    const v1BillAfter = billsAfter.payload.bills.find((b) => b.planVersionId === v1?.id);
    expect(JSON.stringify(v1BillAfter)).toBe(v1BillSnapshot);

    // 8) 二次结算：同账期幂等返回 v1 final；或推进下一空账期。历史 v1 账单金额不变。
    const settle2 = await invoke<{ bill: BillLike; deduped?: boolean }>("billing.settle", {
      now: "2026-12-01T00:00:00.000Z",
      cycleStart: v1Bill?.cycleStart,
    });
    expect(settle2.ok).toBe(true);
    expect(settle2.payload.bill.planVersionId).toBe(v1?.id);
    if (settle2.payload.deduped) {
      expect(settle2.payload.bill.extraCostCents).toBe(2000);
    }
    const billsFinal = await invoke<{ bills: BillLike[] }>("billing.list-bills");
    const locked = billsFinal.payload.bills.find((b) => b.planVersionId === v1?.id);
    expect(locked?.extraCostCents).toBe(2000);
  });

  it("diff 反映 v1→v2 调价（后端计算）", async () => {
    const planId = await createPlanFixture();
    const v1List = await invoke<{ versions: VersionLike[] }>("platform-pricing.list-versions", {
      planId,
    });
    const v1 = v1List.payload.versions.find((v) => v.status === "active");
    const draft = await invoke<{ version: VersionLike }>("platform-pricing.create-version", {
      planId,
      pricing: [
        { type: "seat", key: "viewer", priceCents: 1000 },
        { type: "seat", key: "creator", priceCents: 3000 },
        { type: "usage", key: "ai_token", priceCents: 5 },
      ],
    });
    const diff = await invoke<{ diff: { entries: DiffEntryLike[] } }>("platform-pricing.diff", {
      fromVersionId: v1?.id,
      toVersionId: draft.payload.version.id,
    });
    expect(diff.ok).toBe(true);
    const aiToken = diff.payload.diff.entries.find(
      (e) => e.type === "usage" && e.key === "ai_token",
    );
    expect(aiToken?.change).toBe("changed");
    expect(aiToken?.oldPriceCents).toBe(2);
    expect(aiToken?.newPriceCents).toBe(5);
  });
});

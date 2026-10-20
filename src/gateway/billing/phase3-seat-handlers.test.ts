// @vitest-environment node
/**
 * Phase 3：真实 Gateway seatsHandlers 验收
 * - PlanVersion 锁定配额（非 Plan 当前版本）
 * - 并发 assign / set-role / reactivate 不破角色配额
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-p3-seat-handlers-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("./scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scope.js")>();
  return {
    ...actual,
    resolveBillingScope: vi.fn(async () => ({
      enterpriseId: "ent-p3",
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
      },
    },
  }),
}));

const { platformPlansHandlers, platformPricingHandlers } =
  await import("../server-methods/platform-plans.js");
const { subscriptionsHandlers } = await import("../server-methods/subscriptions.js");
const { seatsHandlers } = await import("../server-methods/seats.js");
const { upsertPlanEntitlementSnapshot } =
  await import("../package-entitlement/plan-version-entitlement-store.js");
const { getActiveSubscription } = await import("./subscriptions-store.js");
const { getPlanVersion } = await import("./plans-store.js");
const { countSeatsByRole, listSeatIntervals, listSeats } = await import("./seats-store.js");
const { upsertPlanVersionModelBinding } =
  await import("../model-entitlement/plan-version-model-binding-store.js");

const allHandlers = {
  ...platformPlansHandlers,
  ...platformPricingHandlers,
  ...subscriptionsHandlers,
  ...seatsHandlers,
};

type HandlerError = { code?: string; message?: string };

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

async function createPlanWithSeatQuota(seatQuota: {
  viewer?: number;
  creator?: number;
  admin?: number;
}): Promise<{ planId: string; planVersionId: string }> {
  const res = await invoke<{ planId: string; plan: { currentVersionId: string } }>(
    "platform-plans.create",
    {
      name: "P3-Seats",
      billingCycle: "monthly",
      basePriceCents: 0,
      seatQuota,
      botQuota: 5,
      pricing: [
        { type: "seat", key: "viewer", priceCents: 100 },
        { type: "seat", key: "creator", priceCents: 200 },
        { type: "seat", key: "admin", priceCents: 300 },
      ],
    },
  );
  expect(res.ok).toBe(true);
  const planId = res.payload.planId;
  const planVersionId = res.payload.plan.currentVersionId;
  await upsertPlanEntitlementSnapshot({
    planVersionId,
    monthlyPriceCents: 0,
    monthlyCredits: 1000,
    maxSeats: seatQuota,
    maxBots: 5,
  });
  await upsertPlanVersionModelBinding({
    planVersionId,
    allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
  });
  return { planId, planVersionId };
}

describe("Phase 3 handlers: PlanVersion lock", () => {
  it("assign quota uses locked subscription planVersion not live plan version", async () => {
    const { planId, planVersionId: v1Id } = await createPlanWithSeatQuota({
      viewer: 1,
      creator: 0,
      admin: 0,
    });
    const subRes = await invoke("subscriptions.subscribe", { planId });
    expect(subRes.ok).toBe(true);

    // 建 v2：viewer 配额放大到 100 并激活 —— 既有订阅仍锁 v1
    const draft = await invoke<{ version: { id: string } }>("platform-pricing.create-version", {
      planId,
      seatQuota: { viewer: 100, creator: 10, admin: 10 },
      pricing: [
        { type: "seat", key: "viewer", priceCents: 100 },
        { type: "seat", key: "creator", priceCents: 200 },
        { type: "seat", key: "admin", priceCents: 300 },
      ],
    });
    expect(draft.ok).toBe(true);
    await upsertPlanVersionModelBinding({
      planVersionId: draft.payload.version.id,
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const act = await invoke("platform-pricing.activate", {
      planId,
      versionId: draft.payload.version.id,
      requestId: `act-${draft.payload.version.id}`,
    });
    expect(act.ok).toBe(true);

    const sub = await getActiveSubscription("ent-p3");
    expect(sub?.planVersionId).toBe(v1Id);
    const locked = await getPlanVersion(v1Id);
    const live = await getPlanVersion(draft.payload.version.id);
    expect(locked!.snapshot.seatQuota.viewer).toBe(1);
    expect(live!.snapshot.seatQuota.viewer).toBe(100);

    const a1 = await invoke("seats.assign", {
      userId: "alice@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    expect(a1.ok).toBe(true);
    expect((a1.payload as { seat: { planVersionId?: string } }).seat.planVersionId).toBe(v1Id);

    const a2 = await invoke("seats.assign", {
      userId: "bob@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    expect(a2.ok).toBe(false);
    expect(a2.error.message ?? "").toMatch(/配额|quota|上限/i);

    // 若误用 live 版本则 a2 会成功
    const counts = await countSeatsByRole("ent-p3");
    expect(counts.viewer).toBe(1);
  });
});

describe("Phase 3 handlers: concurrent quota", () => {
  it("concurrent seats.assign different users quota=1 → only one ok", async () => {
    const { planId } = await createPlanWithSeatQuota({ viewer: 1 });
    await invoke("subscriptions.subscribe", { planId });

    const results = await Promise.all(
      ["u1@ex.com", "u2@ex.com", "u3@ex.com"].map((userId) =>
        invoke("seats.assign", { userId, role: "viewer", applyModelGrant: false }),
      ),
    );
    const ok = results.filter((r) => r.ok);
    const fail = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(2);
    expect(await countSeatsByRole("ent-p3")).toEqual({ viewer: 1 });
  });

  it("concurrent set-role to creator with quota=1 → only one ok", async () => {
    const { planId } = await createPlanWithSeatQuota({ viewer: 5, creator: 1 });
    await invoke("subscriptions.subscribe", { planId });
    const a = await invoke<{ seat: { id: string } }>("seats.assign", {
      userId: "a@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    const b = await invoke<{ seat: { id: string } }>("seats.assign", {
      userId: "b@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    expect(a.ok && b.ok).toBe(true);

    const results = await Promise.all([
      invoke("seats.set-role", {
        seatId: a.payload.seat.id,
        role: "creator",
        applyModelGrant: false,
      }),
      invoke("seats.set-role", {
        seatId: b.payload.seat.id,
        role: "creator",
        applyModelGrant: false,
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(await countSeatsByRole("ent-p3")).toEqual({ viewer: 1, creator: 1 });
  });
});

describe("Phase 3 handlers: concurrent reactivate + history", () => {
  it("concurrent reactivate viewer quota=1 → only one ok", async () => {
    const { planId } = await createPlanWithSeatQuota({ viewer: 2 });
    await invoke("subscriptions.subscribe", { planId });
    const a = await invoke<{ seat: { id: string } }>("seats.assign", {
      userId: "a@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    const b = await invoke<{ seat: { id: string } }>("seats.assign", {
      userId: "b@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    expect(a.ok && b.ok).toBe(true);
    await invoke("seats.deactivate", { seatId: a.payload.seat.id });
    await invoke("seats.deactivate", { seatId: b.payload.seat.id });

    // 将「有效配额」压到 1：再建一个 active viewer 占满 1，然后只剩 1 空位？
    // 更直接：订阅 v1 viewer=2，deactivate 两个后并发 reactivate 都该成功。
    // 要测并发只成功一个：先 activate 一个后再...
    // 方案：createPlan viewer:1，无法建两个。
    // 改用 store 层已测 concurrent reactivate；handler 层：
    // 建 plan viewer:1，assign u1，deactivate，再 concurrent assign u2 + reactivate u1
    // 上面已覆盖 assign。此处：viewer:1 plan，assign+deactivate，再 concurrent 两次 reactivate
    // （幂等第二次 active 直接返回）——不够。
    // 用 viewer:1：只能一个 seat。两个不同 inactive 需要 quota>=2 创建。
    // 创建后通过 platform 无法降配额。store 层已测。
    // Handler：deactivate 后只 reactivate 一个 + concurrent assign 争同一空位
    const c = await invoke("seats.assign", {
      userId: "c@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    // viewer quota 2: c 占 1，还剩 1 给 a 或 b 的 reactivate
    expect(c.ok).toBe(true);

    const results = await Promise.all([
      invoke("seats.reactivate", { seatId: a.payload.seat.id }),
      invoke("seats.reactivate", { seatId: b.payload.seat.id }),
    ]);
    const ok = results.filter((r) => r.ok);
    const fail = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect(await countSeatsByRole("ent-p3")).toEqual({ viewer: 2 });
  });

  it("handler lifecycle keeps history start < end and no overlap", async () => {
    const { planId } = await createPlanWithSeatQuota({ viewer: 2, creator: 2, admin: 2 });
    await invoke("subscriptions.subscribe", { planId });
    const a = await invoke<{ seat: { id: string } }>("seats.assign", {
      userId: "hist@ex.com",
      role: "viewer",
      applyModelGrant: false,
    });
    expect(a.ok).toBe(true);
    const seatId = a.payload.seat.id;
    await invoke("seats.set-role", { seatId, role: "creator", applyModelGrant: false });
    await invoke("seats.deactivate", { seatId });
    await invoke("seats.reactivate", { seatId });
    await invoke("seats.remove", { seatId });

    const intervals = await listSeatIntervals("ent-p3");
    const forSeat = intervals.filter((iv) => iv.seatId === seatId);
    for (const iv of forSeat) {
      if (iv.endTime != null) {
        expect(Date.parse(iv.endTime)).toBeGreaterThan(Date.parse(iv.startTime));
      }
    }
    // 半开不重叠
    const sorted = forSeat
      .map((iv) => ({
        s: Date.parse(iv.startTime),
        e: iv.endTime == null ? Number.POSITIVE_INFINITY : Date.parse(iv.endTime),
      }))
      .toSorted((x, y) => x.s - y.s);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        expect(sorted[i].s < sorted[j].e && sorted[j].s < sorted[i].e).toBe(false);
      }
    }
    const removed = (await listSeats("ent-p3")).find((s) => s.id === seatId);
    expect(removed?.status).toBe("removed");
  });
});

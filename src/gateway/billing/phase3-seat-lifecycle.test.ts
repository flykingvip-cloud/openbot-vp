// @vitest-environment node
/**
 * Phase 3：席位生命周期 — active/inactive/removed、唯一 active、planVersion 锁定。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.ts";
import {
  activatePlanVersion,
  createPlan,
  createPlanVersion,
  __resetPlansForTest,
} from "./plans-store.ts";
import {
  assertClosedIntervalEndAfterStart,
  assertSeatHistoryInvariants,
  assignSeat,
  countSeatsByRole,
  deactivateSeat,
  DuplicateActiveSeatError,
  findBillingSeatByUserId,
  latestClosedEndTime,
  listSeatIntervals,
  listSeats,
  reactivateSeat,
  removeSeat,
  resolveSeatStatus,
  SeatLifecycleError,
  SeatRoleQuotaExceededError,
  setSeatRole,
  __resetSeatsForTest,
} from "./seats-store.ts";
import {
  createSubscription,
  setSubscriptionCommercialContract,
  __resetSubscriptionsForTest,
} from "./subscriptions-store.ts";

let tmp: string;
let seatsPath: string;
let plansPath: string;
let subsPath: string;
let entPath: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ob-p3-seat-"));
  seatsPath = path.join(tmp, "seats.json");
  plansPath = path.join(tmp, "plans.json");
  subsPath = path.join(tmp, "subs.json");
  entPath = path.join(tmp, "ent.json");
  await __resetSeatsForTest(seatsPath);
  await __resetPlansForTest(plansPath);
  await __resetSubscriptionsForTest(subsPath);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("Phase 3 seat lifecycle", () => {
  it("assign creates active seat with open history interval", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-1",
        userId: "alice@ex.com",
        role: "viewer",
        botQuota: 1,
        planVersionId: "pv-lock",
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
      seatsPath,
    );
    expect(resolveSeatStatus(seat)).toBe("active");
    expect(seat.planVersionId).toBe("pv-lock");
    const intervals = await listSeatIntervals("ent-1", seatsPath);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].endTime).toBeNull();
    expect(intervals[0].seatId).toBe(seat.id);
  });

  it("enforces unique active seat per (enterpriseId, normalizedUserId)", async () => {
    await assignSeat(
      { enterpriseId: "ent-1", userId: "Alice@ex.com", role: "viewer", botQuota: 0 },
      seatsPath,
    );
    await expect(
      assignSeat(
        { enterpriseId: "ent-1", userId: "alice@ex.com", role: "creator", botQuota: 0 },
        seatsPath,
      ),
    ).rejects.toBeInstanceOf(DuplicateActiveSeatError);
  });

  it("deactivate closes open interval and drops from active counts", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-1",
        userId: "u1",
        role: "viewer",
        botQuota: 0,
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
      seatsPath,
    );
    expect(await countSeatsByRole("ent-1", seatsPath)).toEqual({ viewer: 1 });

    const result = await deactivateSeat("ent-1", seat.id, seatsPath, "2026-01-15T00:00:00.000Z");
    expect(result!.seat.status).toBe("inactive");
    expect(result!.closed?.endTime).toBe("2026-01-15T00:00:00.000Z");
    expect(await countSeatsByRole("ent-1", seatsPath)).toEqual({});
    expect(await findBillingSeatByUserId("ent-1", "u1", seatsPath)).toBeNull();

    const intervals = await listSeatIntervals("ent-1", seatsPath);
    expect(intervals.every((iv) => iv.endTime !== null)).toBe(true);
  });

  it("reactivate reopens interval and restores unique active", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-1",
        userId: "u1",
        role: "creator",
        botQuota: 2,
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
      seatsPath,
    );
    await deactivateSeat("ent-1", seat.id, seatsPath, "2026-01-10T00:00:00.000Z");

    const re = await reactivateSeat("ent-1", seat.id, seatsPath, "2026-01-20T00:00:00.000Z");
    expect(re!.seat.status).toBe("active");
    expect(re!.opened.startTime).toBe("2026-01-20T00:00:00.000Z");
    expect(re!.opened.endTime).toBeNull();
    expect(re!.opened.role).toBe("creator");
    expect(await countSeatsByRole("ent-1", seatsPath)).toEqual({ creator: 1 });
    expect((await findBillingSeatByUserId("ent-1", "u1", seatsPath))?.id).toBe(seat.id);
  });

  it("remove is terminal; reactivate refused; re-assign allowed", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-1",
        userId: "u1",
        role: "admin",
        botQuota: 0,
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
      seatsPath,
    );
    await removeSeat("ent-1", seat.id, seatsPath, "2026-02-01T00:00:00.000Z");
    const listed = await listSeats("ent-1", seatsPath, { status: "removed" });
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("removed");

    await expect(reactivateSeat("ent-1", seat.id, seatsPath)).rejects.toBeInstanceOf(
      SeatLifecycleError,
    );

    // 重新 assign 新席位（旧 removed 不占 active）
    const seat2 = await assignSeat(
      { enterpriseId: "ent-1", userId: "u1", role: "viewer", botQuota: 0 },
      seatsPath,
    );
    expect(seat2.id).not.toBe(seat.id);
    expect(resolveSeatStatus(seat2)).toBe("active");
  });

  it("setSeatRole only on active; closes and opens intervals", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-1",
        userId: "u1",
        role: "viewer",
        botQuota: 0,
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
      seatsPath,
    );
    const changed = await setSeatRole(
      "ent-1",
      seat.id,
      "creator",
      seatsPath,
      "2026-01-05T00:00:00.000Z",
    );
    expect(changed!.seat.currentRole).toBe("creator");
    expect(changed!.closed.endTime).toBe("2026-01-05T00:00:00.000Z");
    expect(changed!.opened.endTime).toBeNull();

    await deactivateSeat("ent-1", seat.id, seatsPath);
    await expect(setSeatRole("ent-1", seat.id, "admin", seatsPath)).rejects.toBeInstanceOf(
      SeatLifecycleError,
    );
  });

  it("reactivate blocked when another active seat exists for same user", async () => {
    const s1 = await assignSeat(
      { enterpriseId: "ent-1", userId: "u1", role: "viewer", botQuota: 0 },
      seatsPath,
    );
    await deactivateSeat("ent-1", s1.id, seatsPath);
    // 用户 inactive 后可再 assign 新 active
    await assignSeat(
      { enterpriseId: "ent-1", userId: "u1", role: "creator", botQuota: 0 },
      seatsPath,
    );
    await expect(reactivateSeat("ent-1", s1.id, seatsPath)).rejects.toBeInstanceOf(
      DuplicateActiveSeatError,
    );
  });

  it("quota checks use locked subscription planVersionId not latest plan version", async () => {
    const plan = await createPlan(
      {
        name: "SeatLock",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: { viewer: 1, creator: 0, admin: 0 },
        botQuota: 1,
        pricing: [{ type: "seat", key: "viewer", priceCents: 100 }],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const v1Id = plan.currentVersionId;
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: v1Id,
        monthlyPriceCents: 1000,
        monthlyCredits: 0,
        maxBots: 1,
        maxSeats: { viewer: 1 },
      },
      entPath,
      { plans: plansPath, subscriptions: subsPath },
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-lock",
        planId: plan.id,
        planVersionId: v1Id,
        startTime: "2026-01-01T00:00:00.000Z",
      },
      subsPath,
    );
    await setSubscriptionCommercialContract(
      "ent-lock",
      sub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2027-01-01T00:00:00.000Z",
      },
      subsPath,
    );

    // 订阅锁定 v1（viewer 配额 1）后，Plan 升到 v2（viewer 配额 100）不得放开配额
    const v2 = await createPlanVersion(
      {
        planId: plan.id,
        seatQuota: { viewer: 100, creator: 10, admin: 10 },
        pricing: [{ type: "seat", key: "viewer", priceCents: 100 }],
        createdByUserId: "admin",
      },
      plansPath,
    );
    await activatePlanVersion(
      {
        planId: plan.id,
        versionId: v2!.id,
        requestId: `act-${v2!.id}`,
        changedByUserId: "admin",
      },
      plansPath,
    );

    // 模拟 handler：配额来自 sub.planVersionId = v1
    const { getPlanVersion } = await import("./plans-store.ts");
    const locked = await getPlanVersion(sub.planVersionId, plansPath);
    const live = await getPlanVersion(v2!.id, plansPath);
    expect(locked!.snapshot.seatQuota.viewer).toBe(1);
    expect(live!.snapshot.seatQuota.viewer).toBe(100);

    await assignSeat(
      {
        enterpriseId: "ent-lock",
        userId: "u1",
        role: "viewer",
        botQuota: 0,
        planVersionId: sub.planVersionId,
        roleQuota: locked!.snapshot.seatQuota.viewer,
      },
      seatsPath,
    );
    const counts = await countSeatsByRole("ent-lock", seatsPath);
    const quota = locked!.snapshot.seatQuota.viewer!;
    expect((counts.viewer ?? 0) >= quota).toBe(true);
    // 第二席：按锁定 v1 应拒绝（即使 live v2 配额 100）
    await expect(
      assignSeat(
        {
          enterpriseId: "ent-lock",
          userId: "u2",
          role: "viewer",
          botQuota: 0,
          planVersionId: sub.planVersionId,
          roleQuota: locked!.snapshot.seatQuota.viewer,
        },
        seatsPath,
      ),
    ).rejects.toBeInstanceOf(SeatRoleQuotaExceededError);
    expect(live!.snapshot.seatQuota.viewer).toBe(100);
  });
});

describe("Phase 3 concurrent role quota (atomic under lock)", () => {
  it("concurrent assign different users with quota=1 → only one succeeds", async () => {
    const results = await Promise.allSettled(
      ["u-a", "u-b", "u-c"].map((userId) =>
        assignSeat(
          {
            enterpriseId: "ent-race",
            userId,
            role: "viewer",
            botQuota: 0,
            roleQuota: 1,
          },
          seatsPath,
        ),
      ),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(SeatRoleQuotaExceededError);
    }
    expect(await countSeatsByRole("ent-race", seatsPath)).toEqual({ viewer: 1 });
  });

  it("concurrent set-role to scarce role with quota=1 → only one succeeds", async () => {
    const s1 = await assignSeat(
      { enterpriseId: "ent-race", userId: "a", role: "viewer", botQuota: 0, roleQuota: 10 },
      seatsPath,
    );
    const s2 = await assignSeat(
      { enterpriseId: "ent-race", userId: "b", role: "viewer", botQuota: 0, roleQuota: 10 },
      seatsPath,
    );
    const results = await Promise.allSettled([
      setSeatRole("ent-race", s1.id, "creator", seatsPath, { roleQuota: 1 }),
      setSeatRole("ent-race", s2.id, "creator", seatsPath, { roleQuota: 1 }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect(fail[0].reason).toBeInstanceOf(SeatRoleQuotaExceededError);
    expect(await countSeatsByRole("ent-race", seatsPath)).toEqual({ viewer: 1, creator: 1 });
  });

  it("concurrent reactivate with quota=1 → only one succeeds", async () => {
    const s1 = await assignSeat(
      { enterpriseId: "ent-race", userId: "a", role: "admin", botQuota: 0, roleQuota: 10 },
      seatsPath,
    );
    const s2 = await assignSeat(
      { enterpriseId: "ent-race", userId: "b", role: "admin", botQuota: 0, roleQuota: 10 },
      seatsPath,
    );
    await deactivateSeat("ent-race", s1.id, seatsPath);
    await deactivateSeat("ent-race", s2.id, seatsPath);
    expect(await countSeatsByRole("ent-race", seatsPath)).toEqual({});

    const results = await Promise.allSettled([
      reactivateSeat("ent-race", s1.id, seatsPath, { roleQuota: 1 }),
      reactivateSeat("ent-race", s2.id, seatsPath, { roleQuota: 1 }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect(fail[0].reason).toBeInstanceOf(SeatRoleQuotaExceededError);
    expect(await countSeatsByRole("ent-race", seatsPath)).toEqual({ admin: 1 });
  });
});

describe("Phase 3 history: reject out-of-order effectiveAt (no clamp)", () => {
  it("assertClosedIntervalEndAfterStart rejects end <= start", () => {
    const start = "2026-01-01T00:00:00.000Z";
    expect(() => assertClosedIntervalEndAfterStart(start, start, "deactivate")).toThrow(
      SeatLifecycleError,
    );
    expect(() =>
      assertClosedIntervalEndAfterStart(start, "2025-12-31T00:00:00.000Z", "set-role"),
    ).toThrow(SeatLifecycleError);
    expect(() =>
      assertClosedIntervalEndAfterStart(start, "2026-01-02T00:00:00.000Z", "deactivate"),
    ).not.toThrow();
  });

  it("deactivate.effectiveAt <= open.startTime is rejected", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-hist",
        userId: "u1",
        role: "viewer",
        botQuota: 0,
        effectiveAt: "2026-01-10T00:00:00.000Z",
      },
      seatsPath,
    );
    await expect(
      deactivateSeat("ent-hist", seat.id, seatsPath, "2026-01-10T00:00:00.000Z"),
    ).rejects.toBeInstanceOf(SeatLifecycleError);
    await expect(
      deactivateSeat("ent-hist", seat.id, seatsPath, "2026-01-09T00:00:00.000Z"),
    ).rejects.toBeInstanceOf(SeatLifecycleError);
    // 合法：严格晚于 open.start
    const ok = await deactivateSeat("ent-hist", seat.id, seatsPath, "2026-01-11T00:00:00.000Z");
    expect(ok!.seat.status).toBe("inactive");
    expect(ok!.closed!.endTime).toBe("2026-01-11T00:00:00.000Z");
    // 幂等：再次 deactivate 允许
    const again = await deactivateSeat("ent-hist", seat.id, seatsPath, "2026-01-01T00:00:00.000Z");
    expect(again!.seat.status).toBe("inactive");
    expect(again!.closed).toBeNull();
  });

  it("set-role.effectiveAt <= open.startTime is rejected", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-hist",
        userId: "u2",
        role: "viewer",
        botQuota: 0,
        effectiveAt: "2026-02-01T00:00:00.000Z",
      },
      seatsPath,
    );
    await expect(
      setSeatRole("ent-hist", seat.id, "creator", seatsPath, {
        effectiveAt: "2026-02-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(SeatLifecycleError);
    await expect(
      setSeatRole("ent-hist", seat.id, "creator", seatsPath, {
        effectiveAt: "2026-01-15T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(SeatLifecycleError);
    const ok = await setSeatRole("ent-hist", seat.id, "creator", seatsPath, {
      effectiveAt: "2026-02-15T00:00:00.000Z",
    });
    expect(ok!.opened.startTime).toBe("2026-02-15T00:00:00.000Z");
    expect(ok!.closed.endTime).toBe("2026-02-15T00:00:00.000Z");
    expect(Date.parse(ok!.closed.endTime!)).toBeGreaterThan(Date.parse(ok!.closed.startTime));
  });

  it("reactivate.effectiveAt < latestClosed.endTime is rejected; equal allowed", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-hist",
        userId: "u3",
        role: "viewer",
        botQuota: 0,
        effectiveAt: "2026-03-01T00:00:00.000Z",
      },
      seatsPath,
    );
    await deactivateSeat("ent-hist", seat.id, seatsPath, "2026-03-10T00:00:00.000Z");
    const intervals = await listSeatIntervals("ent-hist", seatsPath);
    const latestEnd = latestClosedEndTime(intervals, seat.id);
    expect(latestEnd).toBe("2026-03-10T00:00:00.000Z");

    await expect(
      reactivateSeat("ent-hist", seat.id, seatsPath, {
        effectiveAt: "2026-03-09T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(SeatLifecycleError);

    // equal boundary：半开衔接合法
    const okEq = await reactivateSeat("ent-hist", seat.id, seatsPath, {
      effectiveAt: "2026-03-10T00:00:00.000Z",
    });
    expect(okEq!.opened.startTime).toBe("2026-03-10T00:00:00.000Z");
    // 幂等：已 active 再 reactivate 允许（忽略更早时间）
    const again = await reactivateSeat("ent-hist", seat.id, seatsPath, {
      effectiveAt: "2026-01-01T00:00:00.000Z",
    });
    expect(again!.opened.endTime).toBeNull();

    await deactivateSeat("ent-hist", seat.id, seatsPath, "2026-03-20T00:00:00.000Z");
    const okLater = await reactivateSeat("ent-hist", seat.id, seatsPath, {
      effectiveAt: "2026-03-21T00:00:00.000Z",
    });
    expect(okLater!.opened.startTime).toBe("2026-03-21T00:00:00.000Z");

    const forSeat = (await listSeatIntervals("ent-hist", seatsPath)).filter(
      (iv) => iv.seatId === seat.id,
    );
    for (const iv of forSeat) {
      if (iv.endTime != null) {
        expect(Date.parse(iv.endTime)).toBeGreaterThan(Date.parse(iv.startTime));
      }
    }
    assertSeatHistoryInvariants(forSeat, seat.id);
  });

  it("monotonic lifecycle keeps startTime < endTime and no overlap", async () => {
    const seat = await assignSeat(
      {
        enterpriseId: "ent-hist",
        userId: "u4",
        role: "viewer",
        botQuota: 0,
        effectiveAt: "2026-04-01T00:00:00.000Z",
      },
      seatsPath,
    );
    await setSeatRole("ent-hist", seat.id, "creator", seatsPath, {
      effectiveAt: "2026-04-05T00:00:00.000Z",
    });
    await setSeatRole("ent-hist", seat.id, "admin", seatsPath, {
      effectiveAt: "2026-04-10T00:00:00.000Z",
    });
    await deactivateSeat("ent-hist", seat.id, seatsPath, "2026-04-15T00:00:00.000Z");
    await reactivateSeat("ent-hist", seat.id, seatsPath, {
      effectiveAt: "2026-04-15T00:00:00.000Z",
    });
    await removeSeat("ent-hist", seat.id, seatsPath, "2026-04-20T00:00:00.000Z");

    const forSeat = (await listSeatIntervals("ent-hist", seatsPath)).filter(
      (iv) => iv.seatId === seat.id,
    );
    expect(forSeat.length).toBeGreaterThanOrEqual(3);
    for (const iv of forSeat) {
      if (iv.endTime != null) {
        expect(Date.parse(iv.endTime)).toBeGreaterThan(Date.parse(iv.startTime));
      }
    }
    assertSeatHistoryInvariants(forSeat, seat.id);
  });
});

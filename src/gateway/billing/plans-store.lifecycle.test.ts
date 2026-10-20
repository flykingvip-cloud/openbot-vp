// @vitest-environment node
// Feature: cost-budget-billing
// Task 32.1: plans-store 版本生命周期（快照不可变 + 幂等激活 + 单一 active）
// Property 16, Property 17

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activatePlanVersion,
  createPlan,
  createPlanVersion,
  deprecatePlanVersion,
  getCurrentPlanVersion,
  listPlanVersions,
  listPlanVersionStatusEvents,
} from "./plans-store.ts";

let storePath: string;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-plans-lifecycle-"));
  storePath = path.join(dir, "plans.json");
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function seedPlan() {
  return createPlan(
    {
      name: "Growth",
      billingCycle: "monthly",
      basePriceCents: 0,
      seatQuota: { viewer: 10 },
      botQuota: 5,
      pricing: [{ type: "seat", key: "viewer", priceCents: 1000 }],
      createdByUserId: "admin",
    },
    storePath,
  );
}

describe("plans-store lifecycle", () => {
  it("createPlan 首版本为 active", async () => {
    const plan = await seedPlan();
    const versions = await listPlanVersions(plan.id, storePath);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.status).toBe("active");
    expect(versions[0]?.version).toBe(1);
  });

  it("createPlanVersion 产生 draft（不影响 active / currentVersionId）", async () => {
    const plan = await seedPlan();
    const draft = await createPlanVersion(
      {
        planId: plan.id,
        pricing: [{ type: "seat", key: "viewer", priceCents: 2000 }],
        createdByUserId: "admin",
      },
      storePath,
    );
    expect(draft?.status).toBe("draft");
    expect(draft?.version).toBe(2);
    const active = await getCurrentPlanVersion(plan.id, storePath);
    expect(active?.version).toBe(1); // 仍是 v1
  });

  it("activate 切换：原 active→deprecated，目标→active，单一 active", async () => {
    const plan = await seedPlan();
    const draft = await createPlanVersion(
      {
        planId: plan.id,
        pricing: [{ type: "seat", key: "viewer", priceCents: 2000 }],
        createdByUserId: "admin",
      },
      storePath,
    );
    await activatePlanVersion(
      { planId: plan.id, versionId: draft!.id, requestId: "req-1", changedByUserId: "admin" },
      storePath,
    );
    const versions = await listPlanVersions(plan.id, storePath);
    expect(versions.filter((v) => v.status === "active")).toHaveLength(1);
    expect(versions.find((v) => v.id === draft!.id)?.status).toBe("active");
    expect(versions.find((v) => v.version === 1)?.status).toBe("deprecated");
    const active = await getCurrentPlanVersion(plan.id, storePath);
    expect(active?.id).toBe(draft!.id);
  });

  it("相同 requestId 重复激活幂等（不重复降级、不产生多 active）", async () => {
    const plan = await seedPlan();
    const draft = await createPlanVersion(
      {
        planId: plan.id,
        pricing: [{ type: "seat", key: "viewer", priceCents: 2000 }],
        createdByUserId: "admin",
      },
      storePath,
    );
    await activatePlanVersion(
      { planId: plan.id, versionId: draft!.id, requestId: "req-1", changedByUserId: "admin" },
      storePath,
    );
    // 第二次同 requestId
    await activatePlanVersion(
      { planId: plan.id, versionId: draft!.id, requestId: "req-1", changedByUserId: "admin" },
      storePath,
    );
    const versions = await listPlanVersions(plan.id, storePath);
    expect(versions.filter((v) => v.status === "active")).toHaveLength(1);
    // 审计事件：仅首次的两条流转（v1→deprecated, draft→active），无重复
    const events = await listPlanVersionStatusEvents(plan.id, storePath);
    const req1Events = events.filter((e) => e.requestId === "req-1");
    expect(req1Events).toHaveLength(2);
  });

  it("状态流转产生完整字段 append-only 审计事件", async () => {
    const plan = await seedPlan();
    const draft = await createPlanVersion(
      {
        planId: plan.id,
        pricing: [{ type: "seat", key: "viewer", priceCents: 2000 }],
        createdByUserId: "admin",
      },
      storePath,
    );
    await activatePlanVersion(
      { planId: plan.id, versionId: draft!.id, requestId: "req-1", changedByUserId: "ops@x.com" },
      storePath,
    );
    const events = await listPlanVersionStatusEvents(plan.id, storePath);
    const activateEvent = events.find((e) => e.versionId === draft!.id && e.toStatus === "active");
    expect(activateEvent).toBeTruthy();
    expect(activateEvent?.fromStatus).toBe("draft");
    expect(activateEvent?.changedByUserId).toBe("ops@x.com");
    expect(activateEvent?.requestId).toBe("req-1");
    expect(activateEvent?.occurredAt).toBeTruthy();
  });

  it("deprecate active 版本 → 终态", async () => {
    const plan = await seedPlan();
    const versions = await listPlanVersions(plan.id, storePath);
    const v1 = versions[0];
    const res = await deprecatePlanVersion(
      { planId: plan.id, versionId: v1.id, changedByUserId: "admin" },
      storePath,
    );
    expect(res?.planVersion.status).toBe("deprecated");
  });

  it("激活非 draft（如已 active）版本被拒（非法流转）", async () => {
    const plan = await seedPlan();
    const v1 = (await listPlanVersions(plan.id, storePath))[0];
    await expect(
      activatePlanVersion(
        { planId: plan.id, versionId: v1.id, requestId: "req-x", changedByUserId: "admin" },
        storePath,
      ),
    ).rejects.toThrow();
  });

  it("已激活版本的 pricing 不再变化（快照不可变）", async () => {
    const plan = await seedPlan();
    const v1 = (await listPlanVersions(plan.id, storePath))[0];
    const originalPrice = v1.snapshot.pricing[0]?.priceCents;
    // 通过 createPlanVersion 创建新草稿改价，不影响 v1
    await createPlanVersion(
      {
        planId: plan.id,
        pricing: [{ type: "seat", key: "viewer", priceCents: 9999 }],
        createdByUserId: "admin",
      },
      storePath,
    );
    const v1After = (await listPlanVersions(plan.id, storePath)).find((v) => v.id === v1.id);
    expect(v1After?.snapshot.pricing[0]?.priceCents).toBe(originalPrice);
  });
});

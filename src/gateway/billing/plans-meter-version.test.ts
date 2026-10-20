// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPlan,
  createPlanVersion,
  getPlanVersion,
  updatePlan,
  __resetPlansForTest,
} from "./plans-store.ts";

let tmpDir: string;
let plansPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-meters-ver-"));
  plansPath = path.join(tmpDir, "plans.json");
  await __resetPlansForTest(plansPath);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("PlanVersion meters on pricing update", () => {
  it("createPlan freezes meters; createPlanVersion rebuilds for new pricing keys", async () => {
    const plan = await createPlan(
      {
        name: "P",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: { viewer: 1 },
        botQuota: 1,
        pricing: [{ type: "extra", key: "ai_credits", priceCents: 2 }],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const v1 = await getPlanVersion(plan.currentVersionId, plansPath);
    expect(v1?.snapshot.meters?.some((m) => m.key === "ai_credits")).toBe(true);

    const v2 = await createPlanVersion(
      {
        planId: plan.id,
        pricing: [
          { type: "extra", key: "ai_credits", priceCents: 3 },
          { type: "usage", key: "workflow_run", priceCents: 50 },
        ],
        createdByUserId: "admin",
      },
      plansPath,
    );
    expect(v2).not.toBeNull();
    const keys = (v2!.snapshot.meters ?? []).map((m) => m.key).toSorted();
    expect(keys).toEqual(["ai_credits", "workflow_run"]);
    // policy preserved for ai_credits
    expect(
      v2!.snapshot.meters!.find((m) => m.key === "ai_credits")!.chargeIncludedAtUsagePrice,
    ).toBe(false);
  });

  it("updatePlan with new pricing rebuilds meters instead of blind copy", async () => {
    const plan = await createPlan(
      {
        name: "P2",
        billingCycle: "monthly",
        basePriceCents: 2000,
        seatQuota: {},
        botQuota: 1,
        pricing: [
          { type: "extra", key: "ai_credits", priceCents: 1 },
          { type: "usage", key: "to_remove", priceCents: 9 },
        ],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const result = await updatePlan(
      {
        planId: plan.id,
        pricing: [
          { type: "extra", key: "ai_credits", priceCents: 1 },
          { type: "usage", key: "added_meter", priceCents: 4 },
        ],
        createdByUserId: "admin",
      },
      plansPath,
    );
    expect(result).not.toBeNull();
    const keys = (result!.version.snapshot.meters ?? []).map((m) => m.key).toSorted();
    expect(keys).toContain("added_meter");
    expect(keys).not.toContain("to_remove");
    expect(keys).toContain("ai_credits");
  });
});

describe("explicit MeterDefinition on create / version isolation", () => {
  it("createPlan saves explicit meters", async () => {
    const plan = await createPlan(
      {
        name: "Explicit",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 1,
        pricing: [
          { type: "usage", key: "workflow_run", priceCents: 50 },
          { type: "extra", key: "workflow_run", priceCents: 80 },
        ],
        meters: [
          {
            key: "workflow_run",
            unit: "count",
            includedQuota: 100,
            chargeIncludedAtUsagePrice: true,
            allowOverage: true,
            aggregate: "sum",
            rounding: "integer",
          },
        ],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const v1 = await getPlanVersion(plan.currentVersionId, plansPath);
    expect(v1?.snapshot.meters).toHaveLength(1);
    expect(v1!.snapshot.meters![0].key).toBe("workflow_run");
    expect(v1!.snapshot.meters![0].includedQuota).toBe(100);
    expect(v1!.snapshot.meters![0].chargeIncludedAtUsagePrice).toBe(true);
  });

  it("new version meter change does not mutate old version snapshot", async () => {
    const plan = await createPlan(
      {
        name: "Lock",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 1,
        pricing: [
          { type: "usage", key: "workflow_run", priceCents: 50 },
          { type: "extra", key: "workflow_run", priceCents: 80 },
        ],
        meters: [
          {
            key: "workflow_run",
            unit: "count",
            includedQuota: 100,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const v1Id = plan.currentVersionId;
    const v1Before = await getPlanVersion(v1Id, plansPath);

    const v2 = await createPlanVersion(
      {
        planId: plan.id,
        pricing: [
          { type: "usage", key: "workflow_run", priceCents: 50 },
          { type: "extra", key: "workflow_run", priceCents: 80 },
        ],
        meters: [
          {
            key: "workflow_run",
            unit: "count",
            includedQuota: 999,
            chargeIncludedAtUsagePrice: true,
            allowOverage: true,
          },
        ],
        createdByUserId: "admin",
      },
      plansPath,
    );
    expect(v2).not.toBeNull();
    const v1After = await getPlanVersion(v1Id, plansPath);
    expect(v1After!.snapshot.meters![0].includedQuota).toBe(
      v1Before!.snapshot.meters![0].includedQuota,
    );
    expect(v1After!.snapshot.meters![0].chargeIncludedAtUsagePrice).toBe(false);
    expect(v2!.snapshot.meters![0].includedQuota).toBe(999);
    expect(v2!.snapshot.meters![0].chargeIncludedAtUsagePrice).toBe(true);
  });

  it("rejects create when chargeIncluded lacks usage price", async () => {
    await expect(
      createPlan(
        {
          name: "Bad",
          billingCycle: "monthly",
          basePriceCents: 1000,
          seatQuota: {},
          botQuota: 1,
          pricing: [{ type: "extra", key: "x", priceCents: 1 }],
          meters: [
            {
              key: "x",
              unit: "count",
              chargeIncludedAtUsagePrice: true,
              allowOverage: true,
            },
          ],
          createdByUserId: "admin",
        },
        plansPath,
      ),
    ).rejects.toThrow(/usage\/x/);
  });
});

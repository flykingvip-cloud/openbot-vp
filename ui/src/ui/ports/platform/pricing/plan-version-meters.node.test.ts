import { describe, expect, it } from "vitest";
import type { PlanVersion } from "../../../capability/cost-budget-billing/index.ts";
import {
  buildVersionMeterRows,
  draftMetersToPayload,
  meterSemanticsLabel,
} from "./plan-version-actions.ts";

function version(partial: Partial<PlanVersion["snapshot"]>): PlanVersion {
  return {
    id: "pv-1",
    planId: "plan-1",
    version: 1,
    status: "draft",
    snapshot: {
      basePriceCents: 1000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      ...partial,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUserId: "admin",
  };
}

describe("draftMetersToPayload / UI MeterDefinition", () => {
  it("submits full MeterDefinition fields", () => {
    const payload = draftMetersToPayload([
      {
        key: "ai_token",
        unit: "token",
        includedQuota: "500",
        includedMode: "usage_priced",
        overageMode: "block",
      },
      {
        key: "ai_credits",
        unit: "credit",
        includedQuota: "",
        includedMode: "free",
        overageMode: "paid",
      },
    ]);
    expect(payload).toEqual([
      {
        key: "ai_token",
        unit: "token",
        includedQuota: 500,
        chargeIncludedAtUsagePrice: true,
        allowOverage: false,
        aggregate: "sum",
        rounding: "integer",
      },
      {
        key: "ai_credits",
        unit: "credit",
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        aggregate: "sum",
        rounding: "integer",
      },
    ]);
  });

  it("labels free / usage / block / paid overage distinctly", () => {
    expect(meterSemanticsLabel({ includedMode: "free", overageMode: "block" })).toContain(
      "套餐内免费",
    );
    expect(meterSemanticsLabel({ includedMode: "usage_priced", overageMode: "paid" })).toContain(
      "套餐内按量收费",
    );
    expect(meterSemanticsLabel({ includedMode: "free", overageMode: "block" })).toContain(
      "禁止超额",
    );
    expect(meterSemanticsLabel({ includedMode: "free", overageMode: "paid" })).toContain(
      "允许付费超额",
    );
  });

  it("builds rows from frozen snapshot meters", () => {
    const rows = buildVersionMeterRows(
      version({
        meters: [
          {
            key: "workflow_run",
            unit: "count",
            includedQuota: 10,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
      }),
    );
    expect(rows[0].key).toBe("workflow_run");
    expect(rows[0].includedMode).toBe("free");
    expect(rows[0].overageMode).toBe("paid");
    expect(rows[0].includedQuota).toBe("10");
  });
});

// @vitest-environment node

import { nothing } from "lit";
import { describe, expect, it } from "vitest";
import { renderCreditsReconciliationAlert } from "./credits-reconciliation-alert.ts";

function templateToString(tpl: unknown): string {
  const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
  if (!t.strings) {
    return JSON.stringify(tpl);
  }
  let out = "";
  for (let i = 0; i < t.strings.length; i += 1) {
    out += t.strings[i] ?? "";
    if (i < (t.values?.length ?? 0)) {
      const v = t.values?.[i];
      out +=
        typeof v === "object" && v !== null
          ? templateToString(v)
          : String(v as string | number | boolean | bigint | null | undefined);
    }
  }
  return out;
}

describe("renderCreditsReconciliationAlert", () => {
  it("returns nothing when aligned", () => {
    const result = renderCreditsReconciliationAlert({
      reconciliation: {
        enterpriseId: "ent-1",
        cycleStart: "2026-06-01T00:00:00.000Z",
        cycleEnd: "2026-07-01T00:00:00.000Z",
        bucketGranted: 100,
        bucketConsumed: 10,
        bucketRemaining: 90,
        ledgerCreditsCharged: 10,
        ledgerCreditsV1: 10,
        ledgerCreditsV2: 0,
        aligned: true,
        driftCredits: 0,
        details: [],
      },
    });
    expect(result).toBe(nothing);
  });

  it("renders drift card with KPI grid and issues", () => {
    const html = renderCreditsReconciliationAlert({
      reconciliation: {
        enterpriseId: "ent-1",
        cycleStart: "2026-06-01T00:00:00.000Z",
        cycleEnd: "2026-07-01T00:00:00.000Z",
        bucketGranted: 0,
        bucketConsumed: 0,
        bucketRemaining: 0,
        ledgerCreditsCharged: 112,
        ledgerCreditsV1: 112,
        ledgerCreditsV2: 0,
        legacyBalance: {
          enterpriseId: "ent-1",
          cycleStart: "2026-06-01T00:00:00.000Z",
          monthlyCredits: 1_000_000,
          creditsConsumed: 112,
          creditsRemaining: 999_888,
        },
        aligned: false,
        driftCredits: -112,
        details: [
          "legacy monthlyCredits (1000000) != bucket granted (0)",
          "bucket consumed (0) != ledger charged (112)",
        ],
      },
      testId: "cost-budget-settings-reconciliation-drift",
    });
    const rendered = templateToString(html);
    expect(rendered).toContain("cost-budget-v2-reconciliation-alert");
    expect(rendered).toContain("cost-budget-settings-reconciliation-drift");
    expect(rendered).toContain("enterprise-kpi-grid");
  });
});

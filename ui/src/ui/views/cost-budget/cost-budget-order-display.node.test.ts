import { describe, expect, it } from "vitest";
import { i18n } from "../../../i18n/index.ts";
import {
  commercialOrderKindLabel,
  commercialOrderStatusTone,
  formatCommercialOrderNo,
  formatCommercialOrderNoMasked,
  resolveCommercialOrderPlanName,
  resolvePlanTierTag,
  summarizeCommercialOrders,
} from "./cost-budget-order-display.ts";

describe("cost-budget-order-display", () => {
  it("formats order numbers as OB-YYYYMMDD-XXXX", () => {
    expect(
      formatCommercialOrderNo(
        "ord-60169444-32ea-4094-9119-7bd1332822c1",
        "2026-06-22T04:59:54.000Z",
      ),
    ).toBe("OB-20260622-6016");
    expect(formatCommercialOrderNo("ord-short")).toBe("OB-00000000-SHOR");
  });

  it("masks order numbers for table display", () => {
    const masked = formatCommercialOrderNoMasked(
      "ord-60169444-32ea-4094-9119-7bd1332822c1",
      "2026-06-22T04:59:54.000Z",
    );
    expect(masked.prefix).toBe("OB-·····");
    expect(masked.suffix).toBe("6016");
    expect(masked.full).toBe("OB-20260622-6016");
  });

  it("summarizes paid order totals", () => {
    expect(
      summarizeCommercialOrders([
        { status: "paid", amountCents: 100 },
        { status: "paid", amountCents: 200 },
        { status: "canceled", amountCents: 999 },
      ]),
    ).toEqual({ count: 3, paidCount: 2, pendingCount: 0, totalCents: 300 });
  });

  it("maps plan names to tier tags", () => {
    expect(resolvePlanTierTag("旗舰版")).toBe("PRO");
    expect(resolvePlanTierTag("专业版")).toBe("BUSINESS");
    expect(resolvePlanTierTag("基础版")).toBe("BASIC");
  });

  it("maps order status to badge tones", () => {
    expect(commercialOrderStatusTone("paid")).toBe("success");
    expect(commercialOrderStatusTone("pending_payment")).toBe("warning");
    expect(commercialOrderStatusTone("canceled")).toBe("neutral");
  });

  it("localizes known order kinds", async () => {
    await i18n.setLocale("zh-CN");
    expect(commercialOrderKindLabel("subscribe")).toBe("套餐订阅");
    expect(commercialOrderKindLabel("change_plan")).toBe("更换套餐");
  });

  it("resolves plan name from line items", () => {
    expect(
      resolveCommercialOrderPlanName({
        kind: "change_plan",
        lineItems: [{ label: "剩余周期应付 · 旗舰版 · v:pv-1", amountCents: 100 }],
      }),
    ).toBe("旗舰版");
    expect(
      resolveCommercialOrderPlanName({
        kind: "subscribe",
        lineItems: [{ label: "专业版 · monthly · v:pv-2", amountCents: 9900 }],
      }),
    ).toBe("专业版");
    expect(
      resolveCommercialOrderPlanName({
        kind: "renew",
        lineItems: [{ label: "旗舰版 · monthly · v:pv-3 · 续费", amountCents: 0 }],
      }),
    ).toBe("旗舰版");
  });

  it("falls back to raw kind when i18n key is missing", () => {
    expect(commercialOrderKindLabel("custom_kind")).toBe("custom_kind");
  });
});

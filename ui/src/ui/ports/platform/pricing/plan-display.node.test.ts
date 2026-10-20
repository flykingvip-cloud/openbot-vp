import { describe, expect, it } from "vitest";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import { plansForDisplay, summarizePlansForDisplay } from "./plan-display.ts";

function plan(partial: Partial<Plan> & Pick<Plan, "id" | "name">): Plan {
  return {
    billingCycle: "monthly",
    basePriceCents: 0,
    seatQuota: {},
    botQuota: 1,
    status: "active",
    currentVersionId: "pv-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("plansForDisplay", () => {
  it("同档位中英文并存时优先展示英文标准名", () => {
    const visible = plansForDisplay([
      plan({
        id: "p-cn",
        name: "入门版",
        basePriceCents: 9_900,
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
      plan({
        id: "p-en",
        name: "Starter",
        basePriceCents: 4_900,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    expect(visible.map((entry) => entry.name)).toEqual(["Starter"]);
  });

  it("四档齐全时折叠历史中文与归档套餐", () => {
    const { visible, hiddenCount } = summarizePlansForDisplay([
      plan({ id: "s1", name: "入门版" }),
      plan({ id: "s2", name: "Starter" }),
      plan({ id: "pro-cn", name: "专业版" }),
      plan({ id: "pro-en", name: "Professional" }),
      plan({ id: "biz", name: "Business" }),
      plan({ id: "flag", name: "旗舰版" }),
      plan({ id: "ent", name: "Enterprise" }),
      plan({ id: "junk", name: "A", status: "archived" }),
    ]);
    expect(visible.map((entry) => entry.name)).toEqual([
      "Starter",
      "Professional",
      "Business",
      "Enterprise",
    ]);
    expect(hiddenCount).toBe(4);
  });

  it("五档齐全时 Trial 排在最前并按 canonical 顺序展示", () => {
    const { visible } = summarizePlansForDisplay([
      plan({ id: "ent", name: "Enterprise" }),
      plan({ id: "biz", name: "Business" }),
      plan({ id: "trial", name: "Trial" }),
      plan({ id: "pro", name: "Professional" }),
      plan({ id: "starter", name: "Starter" }),
    ]);
    expect(visible.map((entry) => entry.name)).toEqual([
      "Trial",
      "Starter",
      "Professional",
      "Business",
      "Enterprise",
    ]);
  });

  it("历史中文别名归并到对应档（商业版/卓越版/基本版）", () => {
    const { visible, hiddenCount } = summarizePlansForDisplay([
      plan({ id: "s-cn", name: "基本版" }),
      plan({ id: "s-en", name: "Starter" }),
      plan({ id: "b-legacy", name: "旗舰版" }),
      plan({ id: "b-en", name: "Business" }),
      plan({ id: "e-legacy", name: "卓越版" }),
      plan({ id: "e-en", name: "Enterprise" }),
    ]);
    expect(visible.map((entry) => entry.name)).toEqual(["Starter", "Business", "Enterprise"]);
    expect(hiddenCount).toBe(3);
  });

  it("当前中文命名（试用版/基础版/专业版/旗舰版/卓越版）按 canonical 顺序展示", () => {
    const { visible } = summarizePlansForDisplay([
      plan({ id: "ent", name: "卓越版" }),
      plan({ id: "biz", name: "旗舰版" }),
      plan({ id: "starter", name: "基础版" }),
      plan({ id: "trial", name: "试用版" }),
      plan({ id: "pro", name: "专业版" }),
    ]);
    expect(visible.map((entry) => entry.name)).toEqual([
      "试用版",
      "基础版",
      "专业版",
      "旗舰版",
      "卓越版",
    ]);
  });

  it("保留未映射的 active 自定义套餐", () => {
    const visible = plansForDisplay([plan({ id: "growth", name: "Growth" })]);
    expect(visible.map((entry) => entry.name)).toEqual(["Growth"]);
  });
});

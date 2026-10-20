import { describe, expect, it } from "vitest";
import { buildCronDataBindingCatalog } from "./data-binding-diagnostics.js";
import { hasRepairableDataBindingIssues, repairCronDataBindings } from "./data-binding-repair.js";
import type { CronDataBindingRef } from "./personal-task-meta.js";

const catalog = buildCronDataBindingCatalog({
  capabilityIds: ["crm.customers"],
  personalObjectIds: ["doc-1"],
  enterpriseObjectIds: ["obj:enterprise:policy-1"],
});

describe("data-binding-repair", () => {
  it("removes stale capability bindings and orphan markers", () => {
    const bindings: CronDataBindingRef[] = [
      {
        bindingId: "cap-stale",
        kind: "capability",
        resourceId: "missing.cap",
        label: "失效能力",
      },
    ];
    const result = repairCronDataBindings({
      intentText: "分析 {{bind:cap-stale}} 和 {{bind:orphan}}",
      dataBindings: bindings,
      catalog,
    });
    expect(result.dataBindings).toHaveLength(0);
    expect(result.intentText).not.toContain("{{bind:");
    expect(result.fixes.some((item) => item.includes("失效"))).toBe(true);
    expect(result.fixes.some((item) => item.includes("未绑定"))).toBe(true);
  });

  it("dedupes duplicate resources and inserts missing markers", () => {
    const bindings: CronDataBindingRef[] = [
      {
        bindingId: "runtime-today",
        kind: "runtime_date",
        resourceId: "today",
        label: "今天日期",
      },
      {
        bindingId: "runtime-today-dup",
        kind: "runtime_date",
        resourceId: "today",
        label: "今天日期",
      },
    ];
    const result = repairCronDataBindings({
      intentText: "生成日报",
      dataBindings: bindings,
      catalog,
    });
    expect(result.dataBindings).toHaveLength(1);
    expect(result.intentText).toContain("{{bind:runtime-today}}");
    expect(result.fixes.some((item) => item.includes("合并重复"))).toBe(true);
    expect(result.fixes.some((item) => item.includes("引用"))).toBe(true);
  });

  it("reports repairable issues via hasRepairableDataBindingIssues", () => {
    expect(
      hasRepairableDataBindingIssues({
        intentText: "x {{bind:missing}}",
        dataBindings: [],
        catalog,
      }),
    ).toBe(true);
    expect(
      hasRepairableDataBindingIssues({
        intentText: "plain text",
        dataBindings: [],
        catalog,
      }),
    ).toBe(false);
  });
});

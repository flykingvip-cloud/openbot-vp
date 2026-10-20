import { describe, expect, it } from "vitest";
import { buildCronDataBindingCatalog } from "./data-binding-diagnostics.js";
import {
  formatBindingIntegrityLabel,
  scoreCronDataBindingIntegrity,
} from "./data-binding-score.js";
import type { CronDataBindingRef } from "./personal-task-meta.js";

const catalog = buildCronDataBindingCatalog({
  capabilityIds: ["crm.customers"],
  personalObjectIds: ["doc-1"],
  enterpriseObjectIds: [],
});

describe("data-binding-score", () => {
  it("scores perfect bindings as grade A", () => {
    const bindings: CronDataBindingRef[] = [
      {
        bindingId: "runtime-today",
        kind: "runtime_date",
        resourceId: "today",
        label: "今天日期",
      },
    ];
    const score = scoreCronDataBindingIntegrity({
      intentText: "汇总 {{bind:runtime-today}} 数据",
      dataBindings: bindings,
      catalog,
    });
    expect(score.grade).toBe("A");
    expect(score.score).toBeGreaterThanOrEqual(90);
    expect(score.issues).toHaveLength(0);
    expect(formatBindingIntegrityLabel(score)).toBe("绑定 A · 100分");
  });

  it("penalizes orphan markers and stale bindings", () => {
    const bindings: CronDataBindingRef[] = [
      {
        bindingId: "cap-stale",
        kind: "capability",
        resourceId: "missing.cap",
        label: "失效能力",
      },
    ];
    const score = scoreCronDataBindingIntegrity({
      intentText: "分析 {{bind:orphan}} {{bind:cap-stale}}",
      dataBindings: bindings,
      catalog,
    });
    expect(score.score).toBeLessThan(75);
    expect(score.issues.length).toBeGreaterThan(0);
    expect(score.summary).toContain("待处理");
  });

  it("returns empty label when no bindings", () => {
    const score = scoreCronDataBindingIntegrity({
      intentText: "plain",
      dataBindings: [],
      catalog,
    });
    expect(formatBindingIntegrityLabel(score)).toBe("");
    expect(score.summary).toBe("未绑定数据源");
  });
});

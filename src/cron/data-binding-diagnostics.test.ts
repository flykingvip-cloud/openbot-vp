import { describe, expect, it } from "vitest";
import { buildCronDataBindingCatalog, lintCronDataBindings } from "./data-binding-diagnostics.js";
import type { CronDataBindingRef } from "./personal-task-meta.js";

describe("data-binding-diagnostics", () => {
  const baseBinding: CronDataBindingRef = {
    bindingId: "cap-1",
    kind: "capability",
    resourceId: "crm.customers",
    label: "客户列表",
    accessState: "granted",
  };

  it("flags orphan markers in intent text", () => {
    const issues = lintCronDataBindings({
      intentText: "分析 {{bind:missing-id}}",
      dataBindings: [baseBinding],
    });
    expect(issues.some((item) => item.code === "orphan_marker")).toBe(true);
  });

  it("flags unused bindings not referenced in intent", () => {
    const issues = lintCronDataBindings({
      intentText: "分析客户",
      dataBindings: [baseBinding],
    });
    expect(issues.some((item) => item.code === "unused_binding")).toBe(true);
  });

  it("flags duplicate resource bindings", () => {
    const issues = lintCronDataBindings({
      intentText: "{{bind:a}} {{bind:b}}",
      dataBindings: [
        { ...baseBinding, bindingId: "a" },
        { ...baseBinding, bindingId: "b", label: "客户列表副本" },
      ],
    });
    expect(issues.some((item) => item.code === "duplicate_resource")).toBe(true);
  });

  it("flags stale capability and enterprise knowledge against catalog", () => {
    const catalog = buildCronDataBindingCatalog({
      capabilityIds: [],
      personalObjectIds: [],
      enterpriseObjectIds: ["obj:enterprise:policy-1"],
    });
    const issues = lintCronDataBindings({
      intentText: "{{bind:cap-1}} {{bind:know-1}}",
      dataBindings: [
        baseBinding,
        {
          bindingId: "know-1",
          kind: "knowledge",
          resourceId: "obj:missing",
          label: "缺失知识",
          knowledgeScope: "enterprise",
        },
      ],
      catalog,
    });
    expect(issues.some((item) => item.code === "stale_capability")).toBe(true);
    expect(issues.some((item) => item.code === "stale_knowledge")).toBe(true);
  });
});

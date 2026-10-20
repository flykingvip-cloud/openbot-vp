import { describe, expect, it } from "vitest";
import {
  buildCronDataBindingsPromptSection,
  expandCronDataBindingMarkers,
  extractRequestedCapabilityIds,
  extractRequestedKnowledgeSourceHints,
  normalizeCronDataBindings,
  parsePersonalTaskMetaFromDescription,
} from "./personal-task-meta.js";

describe("personal-task-meta", () => {
  it("normalizes data bindings from partial meta", () => {
    const bindings = normalizeCronDataBindings([
      {
        bindingId: "cap-1",
        kind: "capability",
        resourceId: "crm.customers",
        label: "客户列表",
        accessState: "granted",
      },
      { bindingId: "", kind: "capability", resourceId: "x", label: "bad" },
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.resourceId).toBe("crm.customers");
  });

  it("parses dataBindings from description meta comment", () => {
    const meta = encodeURIComponent(
      JSON.stringify({
        intentText: "汇总客户",
        dataBindings: [
          {
            bindingId: "cap-1",
            kind: "capability",
            resourceId: "crm.customers",
            label: "客户列表",
            accessState: "granted",
          },
        ],
      }),
    );
    const description = `日报任务\n<!--openbot-task-meta:${meta}-->`;
    const parsed = parsePersonalTaskMetaFromDescription(description);
    expect(parsed.intentText).toBe("汇总客户");
    expect(parsed.goal).toBe("");
    expect(parsed.acceptanceRules).toEqual([]);
    expect(parsed.dataBindings).toHaveLength(1);
    expect(extractRequestedCapabilityIds(parsed.dataBindings)).toEqual(["crm.customers"]);
  });

  it("builds data dependency prompt section", () => {
    const section = buildCronDataBindingsPromptSection([
      {
        bindingId: "runtime-today",
        kind: "runtime_date",
        resourceId: "today",
        label: "今天日期",
      },
    ]);
    expect(section).toContain("## 数据依赖");
    expect(section).toContain("今天日期");
  });

  it("expands binding markers in intent text", () => {
    const expanded = expandCronDataBindingMarkers("分析 {{bind:cap-1}} 数据", [
      {
        bindingId: "cap-1",
        kind: "capability",
        resourceId: "crm.customers",
        label: "客户列表",
      },
    ]);
    expect(expanded).toContain("【客户列表】");
  });

  it("parses goal and acceptanceRules from description meta", () => {
    const meta = encodeURIComponent(
      JSON.stringify({
        goal: "Q2 竞品价格巡检",
        acceptanceRules: ["已拉取竞品价格", "已计算内部价差"],
      }),
    );
    const parsed = parsePersonalTaskMetaFromDescription(`任务\n<!--openbot-task-meta:${meta}-->`);
    expect(parsed.goal).toBe("Q2 竞品价格巡检");
    expect(parsed.acceptanceRules).toEqual(["已拉取竞品价格", "已计算内部价差"]);
  });

  it("extracts knowledge source hints by scope", () => {
    const hints = extractRequestedKnowledgeSourceHints([
      {
        bindingId: "k1",
        kind: "knowledge",
        resourceId: "obj:personal:1",
        label: "个人文档",
        knowledgeScope: "personal",
      },
      {
        bindingId: "k2",
        kind: "knowledge",
        resourceId: "obj:enterprise:1",
        label: "企业制度",
        knowledgeScope: "enterprise",
      },
    ]);
    expect(hints).toEqual(["personal", "enterprise"]);
  });
});

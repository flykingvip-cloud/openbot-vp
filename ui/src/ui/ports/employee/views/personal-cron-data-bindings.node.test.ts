import { describe, expect, it } from "vitest";
import {
  buildDataBindingPickerItems,
  canAutoRepairWizardDataBindings,
  createDataBindingFromPickerItem,
  diagnoseWizardDataBindings,
  formatRepairNotice,
  formatTemplateIntegrityBadge,
  formatTemplateBindingPreview,
  insertDataBindingIntoIntent,
  issueSupportsKnowledgeNavigation,
  migrateWizardLegacyBindings,
  repairWizardDataBindings,
  resolveIssueKnowledgeNavigation,
  scoreTemplateDataBindings,
  upsertDataBinding,
} from "./personal-cron-data-bindings.ts";

describe("personal-cron-data-bindings", () => {
  it("builds picker items from capabilities and personal knowledge", () => {
    const items = buildDataBindingPickerItems({
      dataCapabilities: [
        {
          id: "crm.customers",
          title: "客户列表",
          summary: "CRM 客户主数据",
          sourceSystems: ["crm"],
          scenarios: ["销售分析"],
          visibleAgents: ["*"],
          accessState: "granted",
        },
      ],
      personalKnowledge: [
        {
          id: "doc-1",
          title: "产品手册",
          source: "personal",
          kind: "document",
          summary: "内部产品说明",
          tags: [],
          updatedAt: Date.now(),
        },
      ],
      enterpriseKnowledge: [
        {
          id: "obj:enterprise:policy-1",
          title: "销售制度",
          source: "enterprise",
          kind: "policy",
          summary: "销售流程规范",
          tags: [],
          updatedAt: Date.now(),
        },
      ],
      enterpriseRestrictedKnowledge: [
        {
          id: "obj:enterprise:hr",
          title: "HR 手册",
          source: "enterprise",
          kind: "policy",
          summary: "受限",
          tags: [],
          updatedAt: Date.now(),
        },
      ],
    });
    expect(items.some((item) => item.label === "今天日期")).toBe(true);
    expect(
      items.some((item) => item.label === "销售制度" && item.knowledgeScope === "enterprise"),
    ).toBe(true);
    expect(items.find((item) => item.label === "HR 手册")?.disabled).toBe(true);
  });

  it("diagnoses orphan markers and stale bindings", () => {
    const issues = diagnoseWizardDataBindings({
      intentText: "引用 {{bind:orphan}}",
      dataBindings: [],
      dataCapabilities: [],
      personalKnowledge: [],
      enterpriseKnowledge: [],
    });
    expect(issues.some((item) => item.code === "orphan_marker")).toBe(true);
  });

  it("formats template binding preview", () => {
    const preview = formatTemplateBindingPreview({
      id: "t1",
      scope: "builtin",
      name: "日报",
      summary: "s",
      category: "ops",
      intentText: "x",
      goal: "g",
      acceptanceRules: [],
      schedulePreset: "daily",
      dailyTime: "09:00",
      suggestedAgents: [],
      dataBindings: [
        {
          bindingId: "runtime-today",
          kind: "runtime_date",
          resourceId: "today",
          label: "今天日期",
        },
      ],
    });
    expect(preview).toContain("今天日期");
  });

  it("inserts binding marker and upserts meta bindings", () => {
    const binding = createDataBindingFromPickerItem({
      bindingId: "runtime-today",
      kind: "runtime_date",
      resourceId: "today",
      label: "今天日期",
      subtitle: "内置",
    });
    const intent = insertDataBindingIntoIntent({ intentText: "生成日报", binding });
    expect(intent).toContain("{{bind:runtime-today}}");
    const bindings = upsertDataBinding([], binding);
    expect(bindings).toHaveLength(1);
  });

  it("migrates legacy wizard tokens via shared migration helper", () => {
    const result = migrateWizardLegacyBindings({
      intentText: "汇总 {{today}} 数据",
      dataBindings: [],
      dataCapabilities: [],
    });
    expect(result.migratedTokens).toEqual(["{{today}}"]);
    expect(result.intentText).toContain("{{bind:runtime-today}}");
  });

  it("repairs wizard bindings and formats notice", () => {
    const result = repairWizardDataBindings({
      intentText: "分析 {{bind:orphan}}",
      dataBindings: [],
      dataCapabilities: [],
      personalKnowledge: [],
      enterpriseKnowledge: [],
    });
    expect(result.intentText).not.toContain("{{bind:orphan}}");
    expect(formatRepairNotice(result)).toContain("未绑定");
  });

  it("scores template binding integrity", () => {
    const badge = formatTemplateIntegrityBadge(
      scoreTemplateDataBindings({
        template: {
          id: "t1",
          scope: "builtin",
          name: "日报",
          summary: "s",
          category: "ops",
          intentText: "汇总 {{bind:runtime-today}}",
          goal: "g",
          acceptanceRules: [],
          schedulePreset: "daily",
          dailyTime: "09:00",
          suggestedAgents: [],
          dataBindings: [
            {
              bindingId: "runtime-today",
              kind: "runtime_date",
              resourceId: "today",
              label: "今天日期",
            },
          ],
        },
        dataCapabilities: [],
        personalKnowledge: [],
        enterpriseKnowledge: [],
      }),
    );
    expect(badge).toContain("绑定 A");
  });

  it("resolves knowledge navigation for stale capability issues", () => {
    const bindings = [
      {
        bindingId: "cap-1",
        kind: "capability" as const,
        resourceId: "missing.cap",
        label: "失效 CRM",
      },
    ];
    const issue = {
      level: "warning" as const,
      code: "stale_capability" as const,
      message: "不可用",
      bindingId: "cap-1",
    };
    expect(issueSupportsKnowledgeNavigation(issue)).toBe(true);
    const nav = resolveIssueKnowledgeNavigation({
      issue,
      bindings,
      dataCapabilities: [
        {
          id: "missing.cap",
          title: "失效 CRM",
          summary: "",
          sourceSystems: [],
          scenarios: [],
          visibleAgents: ["*"],
          accessState: "requestable",
        },
      ],
      enterpriseRestrictedKnowledge: [],
    });
    expect(nav?.action).toBe("request_access");
  });

  it("detects auto-repairable wizard issues", () => {
    expect(
      canAutoRepairWizardDataBindings({
        intentText: "{{bind:orphan}}",
        dataBindings: [],
        dataCapabilities: [],
        personalKnowledge: [],
        enterpriseKnowledge: [],
      }),
    ).toBe(true);
  });
});

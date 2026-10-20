import type { CronDataBindingRef } from "../../../../../../src/cron/personal-task-meta.ts";
import type { PersonalCronTaskMeta } from "./personal-cron-task-meta.ts";

export type PersonalCronTaskTemplate = {
  id: string;
  scope: "builtin" | "personal" | "team";
  name: string;
  summary: string;
  category: PersonalCronTaskMeta["category"];
  intentText: string;
  goal: string;
  acceptanceRules: string[];
  schedulePreset: PersonalCronTaskMeta["schedulePreset"];
  dailyTime: string;
  weeklyDay?: string;
  monthlyDay?: string;
  suggestedAgents: string[];
  suggestedGroups?: string[];
  priority?: PersonalCronTaskMeta["priority"];
  dataBindings?: CronDataBindingRef[];
};

export const BUILTIN_PERSONAL_CRON_TEMPLATES: PersonalCronTaskTemplate[] = [
  {
    id: "ops-daily-report",
    scope: "builtin",
    name: "每日运营日报",
    summary: "汇总昨日核心指标，生成日报并通知管理层",
    category: "ops",
    intentText:
      "收集昨日运营数据（GMV、新增用户、留存率、转化率），整理成结构化日报，突出异常波动与建议动作。",
    goal: "生成一份完整的运营日报并通知管理层",
    acceptanceRules: [
      "数据完整、指标计算正确",
      "必须生成 Markdown 或 PDF 报告",
      "包含 GMV、新增用户、留存率",
    ],
    schedulePreset: "daily",
    dailyTime: "09:00",
    suggestedAgents: ["运营机器人"],
    priority: "normal",
  },
  {
    id: "sales-competitor-scan",
    scope: "builtin",
    name: "竞品价格巡检",
    summary: "监控竞争对手官网价格变化并输出对比分析",
    category: "sales",
    intentText:
      "访问竞争对手官网与公开报价页，记录价格变化，与上周数据对比，输出简要分析报告（{{bind:runtime-today}}）。",
    goal: "输出竞品价格变化分析报告",
    acceptanceRules: ["覆盖主要竞品", "包含价格变化摘要", "必须生成分析报告"],
    schedulePreset: "weekly",
    dailyTime: "10:00",
    weeklyDay: "1",
    suggestedAgents: ["销售机器人A"],
    priority: "normal",
    dataBindings: [
      {
        bindingId: "runtime-today",
        kind: "runtime_date",
        resourceId: "today",
        label: "今天日期",
      },
    ],
  },
  {
    id: "support-ticket-digest",
    scope: "builtin",
    name: "客服工单日报",
    summary: "汇总未关闭工单与 SLA 风险",
    category: "support",
    intentText: "汇总今日新增与未关闭工单，按优先级分类，标注 SLA 即将超时项，给出处理建议。",
    goal: "生成客服工单日报并标注风险项",
    acceptanceRules: ["工单分类准确", "包含 SLA 风险清单", "输出可直接发送的摘要"],
    schedulePreset: "daily",
    dailyTime: "18:00",
    suggestedAgents: ["客服机器人C"],
    priority: "high",
  },
  {
    id: "analytics-weekly",
    scope: "builtin",
    name: "每周数据分析",
    summary: "周度业务数据分析与趋势解读",
    category: "analytics",
    intentText:
      "基于 {{sales_data}} 生成本周数据分析：趋势、同比环比、异常点与下周关注项，附图表说明。",
    goal: "生成可汇报的 weekly 数据分析报告",
    acceptanceRules: ["数据来源可追溯", "包含趋势与异常解读", "字数不少于 800 字"],
    schedulePreset: "weekly",
    dailyTime: "09:30",
    weeklyDay: "5",
    suggestedAgents: ["运营机器人"],
    priority: "normal",
  },
  {
    id: "patrol-system-health",
    scope: "builtin",
    name: "系统健康巡检",
    summary: "检查关键服务与网关状态",
    category: "patrol",
    intentText: "巡检 Gateway、核心 Channel 与最近失败任务，汇总异常与恢复建议。",
    goal: "输出系统健康巡检结果",
    acceptanceRules: ["巡检项全覆盖", "异常项有优先级", "结果包含时间戳"],
    schedulePreset: "daily",
    dailyTime: "08:00",
    suggestedAgents: ["运营机器人"],
    priority: "high",
  },
];

export function findPersonalCronTemplate(id: string): PersonalCronTaskTemplate | undefined {
  return BUILTIN_PERSONAL_CRON_TEMPLATES.find((item) => item.id === id);
}

export {
  findAnyPersonalCronTemplate,
  loadPersonalCronTemplates,
} from "./personal-cron-template-store.ts";

export function applyTemplateToWizardMeta(
  template: PersonalCronTaskTemplate,
  meta: PersonalCronTaskMeta,
): PersonalCronTaskMeta {
  return {
    ...meta,
    category: template.category,
    priority: template.priority ?? meta.priority,
    goal: template.goal,
    acceptanceRules: [...template.acceptanceRules],
    schedulePreset: template.schedulePreset,
    dailyTime: template.dailyTime,
    weeklyDay: template.weeklyDay ?? meta.weeklyDay,
    monthlyDay: template.monthlyDay ?? meta.monthlyDay,
    selectedAgents: [...template.suggestedAgents],
    selectedGroups: [...(template.suggestedGroups ?? [])],
    executionMode: "single",
    dataBindings: [...(template.dataBindings ?? [])],
  };
}

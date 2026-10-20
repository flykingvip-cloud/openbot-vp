import type { CronDataBindingRef } from "../../../../../../src/cron/personal-task-meta.ts";
import { normalizeCronDataBindings } from "../../../../../../src/cron/personal-task-meta.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { PersonalCronTaskMeta } from "./personal-cron-task-meta.ts";
import type { PersonalCronTaskTemplate } from "./personal-cron-task-templates.ts";

type TeamCronTaskTemplateRecord = {
  id: string;
  name: string;
  summary?: string;
  category?: string;
  intentText?: string;
  goal?: string;
  acceptanceRules?: string[];
  schedulePreset?: PersonalCronTaskMeta["schedulePreset"];
  dailyTime?: string;
  weeklyDay?: string;
  monthlyDay?: string;
  suggestedAgents?: string[];
  suggestedGroups?: string[];
  priority?: PersonalCronTaskMeta["priority"];
  dataBindings?: CronDataBindingRef[];
};

function mapTeamRecord(record: TeamCronTaskTemplateRecord): PersonalCronTaskTemplate {
  return {
    id: record.id,
    scope: "team",
    name: record.name,
    summary: record.summary ?? "",
    category: (record.category as PersonalCronTaskMeta["category"]) ?? "other",
    intentText: record.intentText ?? "",
    goal: record.goal ?? "",
    acceptanceRules: record.acceptanceRules ?? [],
    schedulePreset: record.schedulePreset ?? "daily",
    dailyTime: record.dailyTime ?? "09:00",
    weeklyDay: record.weeklyDay,
    monthlyDay: record.monthlyDay,
    suggestedAgents: record.suggestedAgents ?? [],
    suggestedGroups: record.suggestedGroups ?? [],
    priority: record.priority,
    dataBindings: normalizeCronDataBindings(record.dataBindings),
  };
}

export async function loadTeamCronTemplates(
  client: GatewayBrowserClient,
): Promise<PersonalCronTaskTemplate[]> {
  try {
    const result = await client.request<{ templates?: TeamCronTaskTemplateRecord[] }>(
      "cron.taskTemplates.list",
      {},
    );
    return (result.templates ?? []).map(mapTeamRecord);
  } catch {
    return [];
  }
}

export async function saveTeamCronTemplate(
  client: GatewayBrowserClient,
  template: PersonalCronTaskTemplate,
): Promise<boolean> {
  try {
    await client.request("cron.taskTemplates.save", {
      template: {
        id: template.id,
        name: template.name,
        summary: template.summary,
        category: template.category,
        intentText: template.intentText,
        goal: template.goal,
        acceptanceRules: template.acceptanceRules,
        schedulePreset: template.schedulePreset,
        dailyTime: template.dailyTime,
        weeklyDay: template.weeklyDay,
        monthlyDay: template.monthlyDay,
        suggestedAgents: template.suggestedAgents,
        suggestedGroups: template.suggestedGroups ?? [],
        priority: template.priority,
        dataBindings: template.dataBindings ?? [],
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteTeamCronTemplate(
  client: GatewayBrowserClient,
  templateId: string,
): Promise<boolean> {
  try {
    const result = await client.request<{ deleted?: boolean }>("cron.taskTemplates.delete", {
      id: templateId,
    });
    return Boolean(result.deleted);
  } catch {
    return false;
  }
}

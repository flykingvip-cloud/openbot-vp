import type { CronFormState } from "../../../ui-types.ts";
import { inferDescriptionFromIntent } from "./personal-cron-task-compiler.ts";
import type { PersonalCronTaskMeta } from "./personal-cron-task-meta.ts";
import {
  BUILTIN_PERSONAL_CRON_TEMPLATES,
  type PersonalCronTaskTemplate,
} from "./personal-cron-task-templates.ts";

const STORAGE_KEY = "openbot.personal-cron.templates.v1";
const MAX_PERSONAL_TEMPLATES = 24;

function isValidTemplate(entry: unknown): entry is PersonalCronTaskTemplate {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const item = entry as PersonalCronTaskTemplate;
  return (
    item.scope === "personal" &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.intentText === "string"
  );
}

export function loadPersonalCronTemplates(): PersonalCronTaskTemplate[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidTemplate);
  } catch {
    return [];
  }
}

export function savePersonalCronTemplate(template: PersonalCronTaskTemplate): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const existing = loadPersonalCronTemplates().filter((item) => item.id !== template.id);
  const withoutDuplicateIntent = existing.filter(
    (item) =>
      !(
        item.name.trim() === template.name.trim() &&
        item.intentText.trim() === template.intentText.trim()
      ),
  );
  const next = [{ ...template, scope: "personal" as const }, ...withoutDuplicateIntent].slice(
    0,
    MAX_PERSONAL_TEMPLATES,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function deletePersonalCronTemplate(templateId: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const next = loadPersonalCronTemplates().filter((item) => item.id !== templateId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function listAllPersonalCronTemplates(): PersonalCronTaskTemplate[] {
  return [...BUILTIN_PERSONAL_CRON_TEMPLATES, ...loadPersonalCronTemplates()];
}

export function findAnyPersonalCronTemplate(id: string): PersonalCronTaskTemplate | undefined {
  return listAllPersonalCronTemplates().find((item) => item.id === id);
}

export function buildTemplateFromWizard(params: {
  form: CronFormState;
  meta: PersonalCronTaskMeta;
  userIntent: string;
  visibleDescription: string;
  existingId?: string | null;
}): PersonalCronTaskTemplate {
  const name = params.form.name.trim() || "未命名任务";
  const summary =
    params.visibleDescription.trim() || inferDescriptionFromIntent(params.userIntent) || name;
  return {
    id: params.existingId ?? `personal-${Date.now()}`,
    scope: "personal",
    name,
    summary,
    category: params.meta.category,
    intentText: params.userIntent.trim(),
    goal: params.meta.goal.trim(),
    acceptanceRules: params.meta.acceptanceRules.map((rule) => rule.trim()).filter(Boolean),
    schedulePreset: params.meta.schedulePreset,
    dailyTime: params.meta.dailyTime,
    weeklyDay: params.meta.weeklyDay,
    monthlyDay: params.meta.monthlyDay,
    suggestedAgents: [...params.meta.selectedAgents],
    suggestedGroups: [...params.meta.selectedGroups],
    priority: params.meta.priority,
    dataBindings: [...params.meta.dataBindings],
  };
}

import type { CronDataBindingRef } from "../../../../../../src/cron/personal-task-meta.ts";
import { normalizeCronDataBindings } from "../../../../../../src/cron/personal-task-meta.ts";
import type { CronJob } from "../../../types.ts";
import type { CronFormState } from "../../../ui-types.ts";
import {
  resolvePersonalCronCategory,
  type PersonalCronCategoryFilter,
} from "./personal-cron-center.helpers.ts";

export type { CronDataBindingRef };

const META_PREFIX = "\n<!--openbot-task-meta:";
const META_SUFFIX = "-->";

export type PersonalCronPriority = "low" | "normal" | "high";

export type PersonalCronExecutionMode = "single" | "multi" | "workflow";

export type PersonalCronSchedulePreset = "once" | "daily" | "weekly" | "monthly" | "custom";

export type PersonalCronNotifySettings = {
  inApp: boolean;
  wecom: boolean;
  email: boolean;
  dingtalk: boolean;
  webhook: boolean;
  failImmediate: boolean;
};

export type PersonalCronTaskMeta = {
  category:
    | PersonalCronCategoryFilter
    | "ops"
    | "sales"
    | "support"
    | "dev"
    | "content"
    | "patrol"
    | "other";
  priority: PersonalCronPriority;
  /** 用户原始自然语言意图，与编译后的 payload.message 分离存储 */
  intentText: string;
  goal: string;
  acceptanceRules: string[];
  executionMode: PersonalCronExecutionMode;
  selectedAgents: string[];
  selectedGroups: string[];
  notify: PersonalCronNotifySettings;
  schedulePreset: PersonalCronSchedulePreset;
  dailyTime: string;
  weeklyDay: string;
  monthlyDay: string;
  creatorLabel: string;
  /** 结构化数据源绑定，写入 description meta 并在运行时解析 */
  dataBindings: CronDataBindingRef[];
};

export const DEFAULT_PERSONAL_CRON_NOTIFY: PersonalCronNotifySettings = {
  inApp: true,
  wecom: false,
  email: false,
  dingtalk: false,
  webhook: false,
  failImmediate: true,
};

export const DEFAULT_PERSONAL_CRON_TASK_META: PersonalCronTaskMeta = {
  category: "ops",
  priority: "normal",
  intentText: "",
  goal: "",
  acceptanceRules: [],
  executionMode: "single",
  selectedAgents: [],
  selectedGroups: [],
  notify: { ...DEFAULT_PERSONAL_CRON_NOTIFY },
  schedulePreset: "daily",
  dailyTime: "09:00",
  weeklyDay: "1",
  monthlyDay: "1",
  creatorLabel: "我",
  dataBindings: [],
};

export const PERSONAL_CRON_CATEGORY_OPTIONS: Array<{
  value: PersonalCronTaskMeta["category"];
  label: string;
}> = [
  { value: "ops", label: "运营" },
  { value: "sales", label: "销售" },
  { value: "support", label: "客服" },
  { value: "dev", label: "研发" },
  { value: "analytics", label: "数据分析" },
  { value: "content", label: "内容生产" },
  { value: "patrol", label: "巡检" },
  { value: "other", label: "其他" },
];

export const PERSONAL_CRON_GROUP_OPTIONS = ["市场组", "运营组", "研发组"];

export function categoryLabel(category: PersonalCronTaskMeta["category"]): string {
  return PERSONAL_CRON_CATEGORY_OPTIONS.find((item) => item.value === category)?.label ?? "其他";
}

export function priorityLabel(priority: PersonalCronPriority): string {
  if (priority === "high") {
    return "高";
  }
  if (priority === "low") {
    return "低";
  }
  return "普通";
}

export function parsePersonalCronTaskMeta(rawDescription?: string | null): {
  visibleDescription: string;
  meta: PersonalCronTaskMeta;
} {
  const base = { ...DEFAULT_PERSONAL_CRON_TASK_META, notify: { ...DEFAULT_PERSONAL_CRON_NOTIFY } };
  const raw = (rawDescription ?? "").trim();
  if (!raw) {
    return { visibleDescription: "", meta: base };
  }
  const start = raw.lastIndexOf(META_PREFIX);
  if (start < 0) {
    return { visibleDescription: raw, meta: base };
  }
  const end = raw.indexOf(META_SUFFIX, start);
  if (end < 0) {
    return { visibleDescription: raw.slice(0, start).trim(), meta: base };
  }
  const encoded = raw.slice(start + META_PREFIX.length, end).trim();
  const visibleDescription = raw.slice(0, start).trim();
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as Partial<PersonalCronTaskMeta>;
    return {
      visibleDescription,
      meta: {
        ...base,
        ...parsed,
        notify: { ...base.notify, ...parsed.notify },
        acceptanceRules: Array.isArray(parsed.acceptanceRules) ? parsed.acceptanceRules : [],
        selectedAgents: Array.isArray(parsed.selectedAgents) ? parsed.selectedAgents : [],
        selectedGroups: Array.isArray(parsed.selectedGroups) ? parsed.selectedGroups : [],
        dataBindings: normalizeCronDataBindings(parsed.dataBindings),
      },
    };
  } catch {
    return { visibleDescription, meta: base };
  }
}

export function serializePersonalCronTaskMeta(
  visibleDescription: string,
  meta: PersonalCronTaskMeta,
): string {
  const payload = encodeURIComponent(JSON.stringify(meta));
  const body = visibleDescription.trim();
  return body
    ? `${body}${META_PREFIX}${payload}${META_SUFFIX}`
    : `${META_PREFIX}${payload}${META_SUFFIX}`;
}

export function resolvePersonalCronTaskMeta(job: CronJob): PersonalCronTaskMeta {
  const parsed = parsePersonalCronTaskMeta(job.description);
  if (parsed.meta.goal || parsed.meta.acceptanceRules.length > 0) {
    return parsed.meta;
  }
  return {
    ...parsed.meta,
    category: resolvePersonalCronCategory(job),
  };
}

export function resolvePersonalCronVisibleDescription(job: CronJob): string {
  const fromMeta = parsePersonalCronTaskMeta(job.description).visibleDescription;
  if (fromMeta) {
    return fromMeta;
  }
  if (job.payload.kind === "agentTurn") {
    return job.payload.message?.trim() ?? "";
  }
  return job.payload.text?.trim() ?? "";
}

export function cronExprFromPreset(meta: PersonalCronTaskMeta): string {
  const [hour, minute] = meta.dailyTime.split(":").map((part) => Number(part));
  const h = Number.isFinite(hour) ? hour : 9;
  const m = Number.isFinite(minute) ? minute : 0;
  if (meta.schedulePreset === "daily") {
    return `${m} ${h} * * *`;
  }
  if (meta.schedulePreset === "weekly") {
    return `${m} ${h} * * ${meta.weeklyDay || "1"}`;
  }
  if (meta.schedulePreset === "monthly") {
    return `${m} ${h} ${meta.monthlyDay || "1"} * *`;
  }
  return `${m} ${h} * * *`;
}

export function buildPersonalCronDeliveryFields(
  meta: PersonalCronTaskMeta,
): Pick<CronFormState, "deliveryMode" | "deliverySurfaces" | "deliveryChannel" | "deliveryTo"> {
  const surfaces: Array<"workbench-agent-main" | "workbench-collab-group"> = [];
  if (meta.notify.inApp) {
    surfaces.push("workbench-agent-main");
  }
  if (meta.selectedGroups.length > 0) {
    surfaces.push("workbench-collab-group");
  }

  let deliveryMode: CronFormState["deliveryMode"] = "none";
  if (meta.notify.webhook) {
    deliveryMode = "webhook";
  } else if (meta.notify.wecom || meta.notify.email || meta.notify.dingtalk) {
    deliveryMode = "announce";
  }

  return {
    deliveryMode,
    deliverySurfaces: surfaces,
    deliveryChannel: meta.notify.wecom ? "wecom" : meta.notify.dingtalk ? "dingtalk" : "last",
    deliveryTo: "",
  };
}

export function applyMetaToCronForm(
  form: CronFormState,
  meta: PersonalCronTaskMeta,
  visibleDescription: string,
): Partial<CronFormState> {
  const patch: Partial<CronFormState> = {
    description: serializePersonalCronTaskMeta(visibleDescription, meta),
    payloadKind: "agentTurn",
    sessionTarget: "isolated",
    failureAlertMode: meta.notify.failImmediate ? "inherit" : "disabled",
    ...buildPersonalCronDeliveryFields(meta),
    deleteAfterRun: meta.schedulePreset === "once" ? form.deleteAfterRun : false,
  };
  const primaryGroup = meta.selectedGroups[0]?.trim();
  if (primaryGroup) {
    patch.sessionKey = primaryGroup;
  } else {
    patch.sessionKey = "";
  }
  const primaryAgent = meta.selectedAgents[0] ?? form.agentId;
  if (primaryAgent) {
    patch.agentId = primaryAgent;
  } else if (primaryGroup) {
    patch.agentId = "";
  }
  if (meta.schedulePreset === "once") {
    patch.scheduleKind = "at";
    patch.scheduleAt = form.scheduleAt || defaultLocalDateTime(meta.dailyTime);
  } else if (meta.schedulePreset === "custom") {
    patch.scheduleKind = "cron";
  } else {
    patch.scheduleKind = "cron";
    patch.cronExpr = cronExprFromPreset(meta);
  }
  return patch;
}

function defaultLocalDateTime(time: string): string {
  const [hour, minute] = time.split(":").map((part) => Number(part));
  const now = new Date();
  now.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function inferSchedulePresetFromForm(form: CronFormState): PersonalCronSchedulePreset {
  if (form.scheduleKind === "at") {
    return "once";
  }
  if (form.scheduleKind === "every") {
    return "daily";
  }
  const expr = form.cronExpr.trim();
  if (expr === "0 9 * * *" || /^\d+ 9 \* \* \*$/.test(expr)) {
    return "daily";
  }
  if (/^\d+ \d+ \* \* \d+$/.test(expr)) {
    return "weekly";
  }
  if (/^\d+ \d+ \d+ \* \*$/.test(expr)) {
    return "monthly";
  }
  return "custom";
}

export { parseCompiledPrompt as parseCompiledPromptFromPayload } from "./personal-cron-task-compiler.ts";

import { isCronDeliveryOnlyFailure as isSharedCronDeliveryOnlyFailure } from "../../../../../../src/cron/delivery-only-failure.ts";
import type { CronJob } from "../../../types.ts";
import {
  parsePersonalCronTaskMeta,
  resolvePersonalCronTaskMeta,
  type PersonalCronTaskMeta,
} from "./personal-cron-task-meta.ts";

/** UI-only: running marker older than this is shown as interrupted (backend clears at 2h). */
export const PERSONAL_CRON_STALE_RUNNING_MS = 15 * 60 * 1000;

/** Agent produced output but external channel delivery failed (legacy announce+last jobs). */
export function isCronDeliveryOnlyFailure(params: {
  status?: string;
  error?: string;
  summary?: string;
}): boolean {
  return isSharedCronDeliveryOnlyFailure(params);
}

export type CronDeliverySurfaceUi = "workbench-agent-main" | "workbench-collab-group";

export type PersonalCronResultChatTarget = {
  sessionKey: string;
  label: string;
  surface: CronDeliverySurfaceUi;
};

export type PersonalCronDisplayStatus =
  | "pending"
  | "running"
  | "interrupted"
  | "completed"
  | "failed"
  | "paused"
  | "normal";

export type PersonalCronStatusFilter =
  | "all"
  | "pending"
  | "running"
  | "completed"
  | "paused"
  | "failed";

export type PersonalCronTargetFilter = "all" | "agent" | "group";

export type PersonalCronCategoryFilter =
  | "all"
  | "analytics"
  | "sales"
  | "support"
  | "marketing"
  | "ops"
  | "dev"
  | "content"
  | "patrol"
  | "other"
  | "custom";

const CATEGORY_RULES: Array<{ id: PersonalCronCategoryFilter; keywords: string[] }> = [
  { id: "analytics", keywords: ["分析", "报表", "数据", "监控", "日报", "周报"] },
  { id: "sales", keywords: ["销售", "回访", "客户", "竞品"] },
  { id: "support", keywords: ["客服", "工单", "支持"] },
  { id: "marketing", keywords: ["市场", "营销", "推广"] },
  { id: "ops", keywords: ["运营", "经营", "库存"] },
];

function isCronDeliverySurfaceUi(value: string): value is CronDeliverySurfaceUi {
  return value === "workbench-agent-main" || value === "workbench-collab-group";
}

export function resolvePersonalCronDeliverySurfaces(job: CronJob): CronDeliverySurfaceUi[] {
  const explicit = job.delivery?.surfaces?.filter(
    (entry): entry is CronDeliverySurfaceUi =>
      typeof entry === "string" && isCronDeliverySurfaceUi(entry.trim()),
  );
  if (explicit && explicit.length > 0) {
    return [...new Set(explicit)];
  }

  const meta = resolvePersonalCronTaskMeta(job);
  const surfaces: CronDeliverySurfaceUi[] = [];
  if (meta.notify.inApp) {
    surfaces.push("workbench-agent-main");
  }
  if (meta.selectedGroups.length > 0 || job.sessionKey?.includes(":")) {
    surfaces.push("workbench-collab-group");
  }
  if (surfaces.length === 0 && job.sessionTarget === "isolated" && job.agentId?.trim()) {
    return ["workbench-agent-main"];
  }
  return surfaces;
}

export function resolvePersonalCronResultChatTargets(params: {
  job: CronJob;
  agents?: Array<{ id: string; label: string }>;
  groups?: Array<{ sessionKey: string; label: string }>;
}): PersonalCronResultChatTarget[] {
  const meta = resolvePersonalCronTaskMeta(params.job);
  const surfaces = resolvePersonalCronDeliverySurfaces(params.job);
  const seen = new Set<string>();
  const targets: PersonalCronResultChatTarget[] = [];

  for (const surface of surfaces) {
    if (surface === "workbench-agent-main") {
      const agentId = params.job.agentId?.trim() || meta.selectedAgents[0]?.trim() || "";
      if (!agentId) {
        continue;
      }
      const sessionKey = `agent:${agentId}:main`;
      if (seen.has(sessionKey)) {
        continue;
      }
      seen.add(sessionKey);
      const label = params.agents?.find((entry) => entry.id === agentId)?.label ?? agentId;
      targets.push({ sessionKey, label, surface });
      continue;
    }

    const sessionKey = params.job.sessionKey?.trim() || meta.selectedGroups[0]?.trim() || "";
    if (!sessionKey.includes(":") || seen.has(sessionKey)) {
      continue;
    }
    seen.add(sessionKey);
    const label =
      params.groups?.find((entry) => entry.sessionKey === sessionKey)?.label ?? "协作组";
    targets.push({ sessionKey, label, surface });
  }

  return targets;
}

export function resolvePersonalCronDisplayStatus(
  job: CronJob,
  nowMs = Date.now(),
): PersonalCronDisplayStatus {
  const state = job.state ?? {};
  if (state.runningAtMs) {
    if (nowMs - state.runningAtMs > PERSONAL_CRON_STALE_RUNNING_MS) {
      return "interrupted";
    }
    return "running";
  }
  if (!job.enabled) {
    if (state.lastStatus === "error") {
      return "failed";
    }
    if (state.lastStatus === "ok" && job.deleteAfterRun) {
      return "completed";
    }
    return "paused";
  }
  if (state.lastStatus === "error") {
    return "failed";
  }
  if (state.nextRunAtMs) {
    return "pending";
  }
  if (state.lastStatus === "ok") {
    return "normal";
  }
  return "pending";
}

export function matchesPersonalCronStatusFilter(
  job: CronJob,
  filter: PersonalCronStatusFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  const status = resolvePersonalCronDisplayStatus(job);
  if (filter === "failed") {
    return status === "failed" || status === "interrupted";
  }
  return status === filter;
}

const STORED_CATEGORY_IDS = new Set<PersonalCronCategoryFilter>([
  "analytics",
  "sales",
  "support",
  "marketing",
  "ops",
  "dev",
  "content",
  "patrol",
  "other",
  "custom",
]);

export function resolvePersonalCronCategory(job: CronJob): PersonalCronCategoryFilter {
  const stored = parsePersonalCronTaskMeta(job.description).meta.category;
  if (stored && STORED_CATEGORY_IDS.has(stored)) {
    return stored;
  }
  const haystack =
    `${job.name} ${parsePersonalCronTaskMeta(job.description).visibleDescription}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return rule.id;
    }
  }
  return "custom";
}

export function matchesPersonalCronCategoryFilter(
  job: CronJob,
  filter: PersonalCronCategoryFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  return resolvePersonalCronCategory(job) === filter;
}

export function resolvePersonalCronExecutionTarget(
  job: CronJob,
  lookup?: {
    agents?: Array<{ id: string; label: string }>;
    groups?: Array<{ sessionKey: string; label: string }>;
  },
): {
  kind: "agent" | "group" | "personal";
  label: string;
} {
  const agentId = job.agentId?.trim();
  if (agentId) {
    const label = lookup?.agents?.find((entry) => entry.id === agentId)?.label ?? agentId;
    return { kind: "agent", label };
  }
  const sessionKey = job.sessionKey?.trim();
  if (sessionKey) {
    const label =
      lookup?.groups?.find((entry) => entry.sessionKey === sessionKey)?.label ?? "协作组";
    return { kind: "group", label };
  }
  return { kind: "personal", label: "个人助理" };
}

export function formatPersonalCronExecutionLabel(params: {
  job: CronJob;
  meta: PersonalCronTaskMeta;
  agents?: Array<{ id: string; label: string }>;
  groups?: Array<{ sessionKey: string; label: string }>;
}): string {
  const target = resolvePersonalCronExecutionTarget(params.job, {
    agents: params.agents,
    groups: params.groups,
  });
  const resolveAgent = (id: string) => params.agents?.find((entry) => entry.id === id)?.label ?? id;
  const resolveGroup = (sessionKey: string) =>
    params.groups?.find((entry) => entry.sessionKey === sessionKey)?.label ?? sessionKey;

  if (params.meta.executionMode === "workflow") {
    return "工作流";
  }
  if (params.meta.executionMode === "multi") {
    const labels = params.meta.selectedAgents.map(resolveAgent).filter(Boolean);
    return labels.length > 0 ? labels.join("、") : target.label;
  }
  if (params.meta.selectedGroups.length > 0) {
    return resolveGroup(params.meta.selectedGroups[0]);
  }
  return target.label;
}

export function matchesPersonalCronTargetFilter(
  job: CronJob,
  filter: PersonalCronTargetFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  const target = resolvePersonalCronExecutionTarget(job);
  return filter === "agent" ? target.kind === "agent" : target.kind === "group";
}

export function resolvePersonalCronDescription(job: CronJob): string {
  const explicit = job.description?.trim();
  if (explicit) {
    return explicit;
  }
  if (job.payload.kind === "agentTurn") {
    return job.payload.message?.trim() ?? "";
  }
  if (job.payload.kind === "systemEvent") {
    return job.payload.text?.trim() ?? "";
  }
  return "";
}

export function formatPersonalCronScheduleLabel(job: CronJob): string {
  const schedule = job.schedule;
  if (schedule.kind === "every") {
    const ms = schedule.everyMs;
    if (ms % 86_400_000 === 0) {
      const days = ms / 86_400_000;
      return days === 1 ? "每天" : `每 ${days} 天`;
    }
    if (ms % 3_600_000 === 0) {
      const hours = ms / 3_600_000;
      return hours === 1 ? "每小时" : `每 ${hours} 小时`;
    }
    if (ms % 60_000 === 0) {
      const minutes = ms / 60_000;
      return minutes === 1 ? "每分钟" : `每 ${minutes} 分钟`;
    }
  }
  if (schedule.kind === "at") {
    const atMs = Date.parse(schedule.at);
    if (Number.isFinite(atMs)) {
      return `单次 ${formatPersonalCronDateTime(atMs)}`;
    }
    return `单次 ${schedule.at}`;
  }
  if (schedule.kind !== "cron") {
    return "自定义计划";
  }
  const expr = schedule.expr.trim();
  const common: Record<string, string> = {
    "0 9 * * *": "每天 09:00",
    "0 9 * * 1": "每周一 09:00",
    "0 9 1 * *": "每月 1 日 09:00",
    "0 * * * *": "每小时",
  };
  return common[expr] ?? expr;
}

export function formatPersonalCronDateTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return "—";
  }
}

export function formatPersonalCronCreatedAt(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) {
    return "—";
  }
  return formatPersonalCronDateTime(ms);
}

export function formatPersonalCronCreatedAtCompact(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) {
    return "—";
  }
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return "—";
  }
}

export function formatPersonalCronNextRunLabel(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) {
    return "—";
  }
  const now = new Date();
  const target = new Date(ms);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const dayDiff = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86_400_000);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(target);
  if (dayDiff === 0) {
    return `下次执行：今天 ${time}`;
  }
  if (dayDiff === 1) {
    return `下次执行：明天 ${time}`;
  }
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(target);
    return `下次执行：${weekday} ${time}`;
  }
  const date = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(
    target,
  );
  return `下次执行：${date} ${time}`;
}

export function summarizePersonalCronStats(jobs: CronJob[]) {
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    const status = resolvePersonalCronDisplayStatus(job);
    if (status === "pending" || status === "normal") {
      pending += 1;
    } else if (status === "running") {
      running += 1;
    } else if (status === "completed") {
      completed += 1;
    } else if (status === "failed" || status === "interrupted") {
      failed += 1;
    }
  }
  return {
    total: jobs.length,
    pending,
    running,
    completed,
    failed,
  };
}

export const PERSONAL_CRON_STATUS_LABELS: Record<PersonalCronDisplayStatus, string> = {
  pending: "待执行",
  running: "执行中",
  interrupted: "可能中断",
  completed: "已完成",
  failed: "执行失败",
  paused: "已暂停",
  normal: "正常运行",
};

/** Place a row-action menu in the viewport so overflow:hidden ancestors cannot clip it. */
export function placeAnchoredMenuPanel(params: {
  trigger: { top: number; right: number; bottom: number };
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
  pad?: number;
}): { top: number; left: number } {
  const gap = params.gap ?? 6;
  const pad = params.pad ?? 8;
  const width = Math.max(1, params.panel.width);
  const height = Math.max(1, params.panel.height);
  const maxLeft = Math.max(pad, params.viewport.width - width - pad);
  const left = Math.min(Math.max(params.trigger.right - width, pad), maxLeft);
  const below = params.trigger.bottom + gap;
  const fitsBelow = below + height <= params.viewport.height - pad;
  const unclampedTop = fitsBelow ? below : params.trigger.top - height - gap;
  const maxTop = Math.max(pad, params.viewport.height - height - pad);
  return {
    top: Math.min(Math.max(unclampedTop, pad), maxTop),
    left,
  };
}

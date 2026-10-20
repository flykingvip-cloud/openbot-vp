import {
  EVOLUTION_EMPTY_NARRATION_TEMPLATES,
  EVOLUTION_PERCEPTION_COPY,
  EVOLUTION_PERCEPTION_INTENTS,
  type EvolutionPerceptionIntentId,
} from "./copy.ts";
import {
  evolutionItemId,
  isSystemEvolutionDomain,
  type EvolutionAutomaticAction,
  type EvolutionAutonomyBudget,
  type EvolutionPerceptionNarrationView,
  type EvolutionPerceptionPanels,
  type EvolutionPerceptionQueryView,
  type EvolutionPerceptionWindow,
  type EvolutionTimelineItem,
} from "./types.ts";

export function evolutionResultLabel(result: string): string {
  switch (result) {
    case "verified_effective":
      return "已验证有效";
    case "observing":
      return "观察中";
    case "ineffective":
      return "无效";
    case "rolled_back":
      return "已回滚";
    case "pending":
      return "待决定";
    case "unspecified":
      return "未指定";
    default:
      return looksTechnicalToken(result) ? "未指定" : result;
  }
}

export function evolutionExecutionModeLabel(mode: string): string {
  switch (mode) {
    case "automatic":
      return "自动";
    case "user_confirmed":
      return "用户确认";
    case "admin_approved":
      return "管理员批准";
    case "platform_release":
      return "平台发布";
    case "unknown":
      return "未知";
    default:
      return looksTechnicalToken(mode) ? "未知" : mode;
  }
}

export function evolutionSummaryLabel(summary: string): string {
  return summary === "unavailable" ? EVOLUTION_PERCEPTION_COPY.unavailableSummary : summary;
}

export function evolutionBudgetLines(budget: EvolutionAutonomyBudget): string[] {
  const surface = evolutionSurfaceLabel(budget.surfaceId);
  if (budget.kind === "unavailable") {
    return [`${EVOLUTION_PERCEPTION_COPY.budgetUnavailablePrefix}（${surface}）`];
  }
  return [
    `对象 ${surface}`,
    `模式 ${budget.mode}`,
    `预算 ${budget.usedApplications}/${budget.maxApplications}，剩余 ${budget.remainingApplications}`,
    `到期 ${budget.expiresAt ?? EVOLUTION_PERCEPTION_COPY.missing}`,
    `紧急开关 ${
      budget.killSwitch === undefined
        ? EVOLUTION_PERCEPTION_COPY.missing
        : budget.killSwitch
          ? "开启"
          : "关闭"
    }`,
  ];
}

const EVOLUTION_SURFACE_LABELS: Record<string, string> = {
  "agent.working-dna": "工作风格",
  "knowledge.experience-capsule": "经验胶囊",
  "knowledge.managed-memory": "托管记忆",
  "capability.skill-spec": "技能规格",
  "capability.skill-installation": "技能安装",
  "organization.task-routing": "任务路由",
  "organization.team-composition": "团队组成",
  "system.diagnosis-contract": "诊断契约",
  "system.runtime-binding-governance": "运行绑定治理",
};

const EVOLUTION_BUCKET_LABELS: Record<string, string> = {
  automatic: "自动",
  user_approved: "已批准",
  pending: "待决定",
  observing: "观察中",
  rolled_back: "已回滚",
};

const TECHNICAL_TOKEN = /^[a-z][a-z0-9_.-]*$/i;
const FACT_ID_TOKEN = /\b(?:led|evt|prop|app|ver)(?::[^\s（）(),，。]+|[^\s（）(),，。]*)/gi;
const UUID_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function looksTechnicalToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return false;
  }
  return TECHNICAL_TOKEN.test(trimmed) || trimmed.includes(":") || trimmed.includes(".");
}

export function evolutionSurfaceLabel(surfaceId: string): string {
  const trimmed = surfaceId.trim();
  if (!trimmed) {
    return "未命名对象";
  }
  const known = EVOLUTION_SURFACE_LABELS[trimmed];
  if (known) {
    return known;
  }
  const leaf = trimmed.includes(".") ? (trimmed.split(".").pop() ?? trimmed) : trimmed;
  if (!leaf) {
    return "未命名对象";
  }
  if (looksTechnicalToken(leaf)) {
    const mapped = leaf
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => {
        switch (part) {
          case "skill":
            return "技能";
          case "installation":
            return "安装";
          case "spec":
            return "规格";
          case "working":
            return "工作";
          case "dna":
            return "风格";
          default:
            return part;
        }
      })
      .join("");
    return mapped || "未命名对象";
  }
  return leaf;
}

export function evolutionReasonStatusLabel(status: string): string {
  switch (status) {
    case "specified":
      return "已说明";
    case "unspecified":
      return "未说明";
    default:
      return looksTechnicalToken(status) ? "未说明" : status;
  }
}

export function evolutionImpactLabel(label: string): string {
  switch (label) {
    case "本人":
    case "企业":
    case "平台":
      return label;
    case "unspecified":
      return "未指定";
    default:
      return looksTechnicalToken(label) ? "未指定" : label;
  }
}

export function evolutionBucketLabel(bucket: string): string {
  return EVOLUTION_BUCKET_LABELS[bucket] ?? (looksTechnicalToken(bucket) ? "其他" : bucket);
}

export function evolutionItemTitle(item: EvolutionTimelineItem): string {
  const display = item.changeObject.domainDisplayName.trim();
  if (display && !looksTechnicalToken(display) && display !== "unspecified") {
    return display;
  }
  return evolutionSurfaceLabel(item.changeObject.surfaceId);
}

/** Strip ledger/proposal ids and English enums from employee-facing narration. */
export function humanizeEvolutionNarrationLine(line: string): string {
  let out = line.trim();
  if (!out) {
    return out;
  }
  out = out
    .replace(/\bunspecified\b/gi, "未指定")
    .replace(/\bverified_effective\b/gi, "已验证有效")
    .replace(/\bobserving\b/gi, "观察中")
    .replace(/\bineffective\b/gi, "无效")
    .replace(/\brolled_back\b/gi, "已回滚")
    .replace(/\bpending\b/gi, "待决定")
    .replace(/\bspecified\b/gi, "已说明");
  out = out.replace(FACT_ID_TOKEN, " ").replace(UUID_TOKEN, " ");
  out = out.replace(/可追溯变化/g, "变化");
  out = out.replace(/\s{2,}/g, " ");
  out = out.replace(/\s+（/g, "（").replace(/（\s+/g, "（");
  out = out.replace(/\s+）/g, "）").replace(/，\s*）/g, "）");
  out = out.replace(/，\s*，/g, "，").replace(/变化\s+（/g, "变化（");
  out = out.replace(/\s+([。．])/g, "$1").trim();
  return out;
}

export function humanizeEvolutionNarration(
  narration: EvolutionPerceptionNarrationView,
): EvolutionPerceptionNarrationView {
  const map = (lines: string[]) =>
    lines
      .map((line) => humanizeEvolutionNarrationLine(line))
      .filter((line) => line.length > 0 && !isEvolutionEmptyNarrationTemplate(line));
  return {
    learned: map(narration.learned),
    platform: map(narration.platform),
    other: map(narration.other),
  };
}

export function evolutionFactRowLines(
  item: EvolutionTimelineItem,
): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [
    { label: "对象", value: evolutionSurfaceLabel(item.changeObject.surfaceId) },
    { label: "前后", value: evolutionSummaryLabel(item.beforeAfter.summary) },
    { label: "原因", value: evolutionReasonStatusLabel(item.reason.status) },
    { label: "执行", value: evolutionExecutionModeLabel(item.executionMode) },
    { label: "影响", value: evolutionImpactLabel(item.impactScope.label) },
    { label: "可逆", value: item.reversible ? "是" : "否" },
  ];
  if (item.bucket) {
    lines.push({ label: "分类", value: evolutionBucketLabel(item.bucket) });
  }
  return lines.filter((line) => !isEvolutionPlaceholderValue(line.value));
}

/** Hollow labels that do not tell the user what changed. */
const EVOLUTION_PLACEHOLDER_VALUES = new Set([
  "未指定",
  "未说明",
  "未知",
  "未提供",
  "前后版本不可用",
  "未命名对象",
  "unavailable",
  "unspecified",
  "unknown",
]);

export function isEvolutionPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || EVOLUTION_PLACEHOLDER_VALUES.has(trimmed);
}

export type EvolutionFactSignal = "none" | "sparse" | "story";

export type EvolutionFactPresentation = {
  signal: EvolutionFactSignal;
  title: string;
  story: string;
};

/**
 * One change story. Placeholder metadata (未指定 / 不可用 / 未知 / 未提供)
 * is left out. `none` has no object, before/after, execution, or impact.
 * `sparse` names a subject but not how it changed. `story` can lead the hero.
 */
export function presentEvolutionFact(item: EvolutionTimelineItem): EvolutionFactPresentation {
  const objectLabel = evolutionSurfaceLabel(item.changeObject.surfaceId);
  const beforeLabel = evolutionSummaryLabel(item.beforeAfter.summary);
  const executionLabel = evolutionExecutionModeLabel(item.executionMode);
  const impactLabel = evolutionImpactLabel(item.impactScope.label);
  const objectOk = !isEvolutionPlaceholderValue(objectLabel);
  const beforeOk =
    item.beforeAfter.summary.trim() !== "unavailable" && !isEvolutionPlaceholderValue(beforeLabel);
  const executionOk =
    item.executionMode.trim() !== "unknown" && !isEvolutionPlaceholderValue(executionLabel);
  const impactOk =
    item.impactScope.label.trim() !== "unspecified" && !isEvolutionPlaceholderValue(impactLabel);
  const meaningful = [objectOk, beforeOk, executionOk, impactOk].filter(Boolean).length;
  const signal: EvolutionFactSignal =
    meaningful === 0 ? "none" : beforeOk || executionOk ? "story" : "sparse";
  const parts: string[] = [];
  if (objectOk) {
    parts.push(objectLabel);
  }
  if (beforeOk) {
    parts.push(beforeLabel);
  }
  if (executionOk) {
    parts.push(executionLabel);
  }
  if (impactOk) {
    parts.push(`影响${impactLabel}`);
  }
  const reason = evolutionReasonStatusLabel(item.reason.status);
  if (!isEvolutionPlaceholderValue(reason)) {
    parts.push(reason);
  }
  const result = evolutionResultLabel(item.result);
  if (!isEvolutionPlaceholderValue(result)) {
    parts.push(result);
  }
  if (signal !== "none") {
    parts.push(item.reversible ? "可逆" : "不可逆");
  }
  return {
    signal,
    title: evolutionItemTitle(item),
    story: parts.join(" · "),
  };
}

export type EvolutionProjectionGroup = {
  id: "learned" | "timeline" | "digest" | "pending" | "automatic" | "observation" | "rollback";
  title: string;
  items: EvolutionTimelineItem[];
  actions: EvolutionAutomaticAction[];
};

function evolutionProjectionItemKey(item: EvolutionTimelineItem): string {
  const id = evolutionItemId(item);
  if (id) {
    return id;
  }
  const presentation = presentEvolutionFact(item);
  return `${presentation.title}|${presentation.story}`;
}

/**
 * More-projections sections with placeholder-only rows removed and the same
 * fact shown once. Empty sections are omitted so they do not repeat 「暂无可投影的记录」.
 */
export function visibleEvolutionProjectionGroups(
  panels: EvolutionPerceptionPanels,
): EvolutionProjectionGroup[] {
  const seen = new Set<string>();
  const take = (items: EvolutionTimelineItem[]): EvolutionTimelineItem[] => {
    const kept: EvolutionTimelineItem[] = [];
    for (const item of items) {
      if (presentEvolutionFact(item).signal === "none") {
        continue;
      }
      const key = evolutionProjectionItemKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      kept.push(item);
    }
    return kept;
  };
  const groups: EvolutionProjectionGroup[] = [];
  const pushItems = (
    id: EvolutionProjectionGroup["id"],
    title: string,
    items: EvolutionTimelineItem[],
  ) => {
    const visible = take(items);
    if (visible.length === 0) {
      return;
    }
    groups.push({ id, title, items: visible, actions: [] });
  };
  pushItems("learned", EVOLUTION_PERCEPTION_COPY.learnedPanelTitle, panels.learned);
  pushItems("timeline", EVOLUTION_PERCEPTION_COPY.timelineTitle, panels.timeline);
  pushItems("digest", EVOLUTION_PERCEPTION_COPY.digestTitle, panels.digest);
  pushItems("pending", EVOLUTION_PERCEPTION_COPY.pendingTitle, panels.pending);
  const actions: EvolutionAutomaticAction[] = [];
  for (const action of panels.automatic) {
    if (presentEvolutionFact(action.item).signal === "none") {
      continue;
    }
    const key = evolutionProjectionItemKey(action.item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    actions.push(action);
  }
  if (actions.length > 0) {
    groups.push({
      id: "automatic",
      title: EVOLUTION_PERCEPTION_COPY.automaticTitle,
      items: actions.map((action) => action.item),
      actions,
    });
  }
  pushItems("observation", EVOLUTION_PERCEPTION_COPY.observationTitle, panels.observation);
  pushItems("rollback", EVOLUTION_PERCEPTION_COPY.rollbackTitle, panels.rollback);
  return groups;
}

export function visibleProjectionPanelCount(panels: EvolutionPerceptionPanels): number {
  return visibleEvolutionProjectionGroups(panels).reduce(
    (total, group) =>
      total + (group.actions.length > 0 ? group.actions.length : group.items.length),
    0,
  );
}

/**
 * Short lines for filters that are no longer chips.
 * A line appears only when a projection already has a meaningful fact that
 * the current answer does not show. No counts, and placeholder-only rows stay out.
 */
export function evolutionFoldedNotes(
  panels: EvolutionPerceptionPanels,
  shownItems: readonly EvolutionTimelineItem[],
): string[] {
  const shown = new Set(shownItems.map((item) => evolutionProjectionItemKey(item)));
  const notes: string[] = [];
  const push = (items: readonly EvolutionTimelineItem[], label: string) => {
    const extra: EvolutionTimelineItem[] = [];
    for (const item of items) {
      if (presentEvolutionFact(item).signal === "none") {
        continue;
      }
      const key = evolutionProjectionItemKey(item);
      if (shown.has(key)) {
        continue;
      }
      shown.add(key);
      extra.push(item);
    }
    if (extra.length === 0) {
      return;
    }
    if (extra.length === 1) {
      const story = presentEvolutionFact(extra[0]).story;
      notes.push(story ? `${label}：${story}。` : `${label}。`);
      return;
    }
    notes.push(`${label}。`);
  };
  push(
    panels.automatic.map((action) => action.item),
    EVOLUTION_PERCEPTION_COPY.foldedAutomatic,
  );
  push(
    panels.timeline.filter((item) => item.bucket === "user_approved"),
    EVOLUTION_PERCEPTION_COPY.foldedApproved,
  );
  push(panels.observation, EVOLUTION_PERCEPTION_COPY.foldedObserving);
  push(panels.rollback, EVOLUTION_PERCEPTION_COPY.foldedRolledBack);
  push(
    [...panels.timeline, ...panels.learned].filter((item) => isSystemEvolutionDomain(item)),
    EVOLUTION_PERCEPTION_COPY.foldedPlatform,
  );
  return notes;
}

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

function calendarDate(value: string): { year: string; month: string; day: string } | null {
  const match = ISO_CALENDAR_DATE.exec(value.trim());
  if (!match) {
    return null;
  }
  return { year: match[1] ?? "", month: match[2] ?? "", day: match[3] ?? "" };
}

/** Full window instants for title / accessible name. Not shown as the visible label. */
export function evolutionPerceptionWindowPrecision(window: EvolutionPerceptionWindow): string {
  return `${window.from} – ${window.to}`;
}

/**
 * Short calendar range from the ISO date prefix.
 * Same year collapses the end year (`2026-09-18 – 09-25`).
 * The prefix is used as written so the label does not shift with the viewer timezone.
 */
export function formatEvolutionPerceptionWindowLabel(window: EvolutionPerceptionWindow): string {
  const from = calendarDate(window.from);
  const to = calendarDate(window.to);
  if (!from || !to) {
    return evolutionPerceptionWindowPrecision(window);
  }
  const start = `${from.year}-${from.month}-${from.day}`;
  const end = from.year === to.year ? `${to.month}-${to.day}` : `${to.year}-${to.month}-${to.day}`;
  return `${start} – ${end}`;
}

export type EvolutionPerceptionUiStatus =
  | "loading"
  | "success_empty"
  | "success_data"
  | "error"
  | "offline"
  | "denied"
  | "untrusted";

export type EvolutionIntentCountValue = number | "loading" | "unavailable";

const EMPTY_TEMPLATE_SET = new Set<string>(
  EVOLUTION_EMPTY_NARRATION_TEMPLATES.map((line) => line.trim()),
);

export function isEvolutionEmptyNarrationTemplate(sentence: string): boolean {
  return EMPTY_TEMPLATE_SET.has(sentence.trim());
}

export function stripEvolutionEmptyNarration(
  narration: EvolutionPerceptionNarrationView,
): EvolutionPerceptionNarrationView {
  return {
    learned: narration.learned.filter((line) => !isEvolutionEmptyNarrationTemplate(line)),
    platform: narration.platform.filter((line) => !isEvolutionEmptyNarrationTemplate(line)),
    other: narration.other.filter((line) => !isEvolutionEmptyNarrationTemplate(line)),
  };
}

function shortWindowPart(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    return value.trim();
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function shortWindowEnd(from: string, to: string): string {
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(from.trim());
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(to.trim());
  if (!fromMatch || !toMatch) {
    return shortWindowPart(to);
  }
  if (fromMatch[1] === toMatch[1]) {
    return `${toMatch[2]}-${toMatch[3]}`;
  }
  return `${toMatch[1]}-${toMatch[2]}-${toMatch[3]}`;
}

export function formatEvolutionSuccessEmptyCopy(window: EvolutionPerceptionWindow): string {
  const from = shortWindowPart(window.from);
  const to = shortWindowEnd(window.from, window.to);
  return EVOLUTION_PERCEPTION_COPY.successEmptyLead.replace("{from}", from).replace("{to}", to);
}

/** Whole days covered by the query window. Null when the instants cannot be read. */
export function evolutionWindowDaySpan(window: EvolutionPerceptionWindow): number | null {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return null;
  }
  const days = Math.round((to - from) / 86_400_000);
  return days >= 1 ? days : null;
}

export function formatEvolutionSuccessEmptyHint(window: EvolutionPerceptionWindow): string {
  const days = evolutionWindowDaySpan(window);
  if (days == null) {
    return EVOLUTION_PERCEPTION_COPY.successEmptyHint;
  }
  return EVOLUTION_PERCEPTION_COPY.successEmptySpanHint.replace("{days}", String(days));
}

/**
 * Last-change time is not on the perception payload. Say so, and point at
 * 相对上周 when that chip already has rows.
 */
export function formatEvolutionEmptyLastChangeCopy(relativeCount: number | null): string {
  if (relativeCount != null && relativeCount > 0) {
    return EVOLUTION_PERCEPTION_COPY.successEmptyRelativeNext.replace(
      "{count}",
      String(relativeCount),
    );
  }
  return EVOLUTION_PERCEPTION_COPY.successEmptyLastChangeUnknown;
}

/** Clock time as written on the query window. UTC only when the source instant is Z. */
export function formatEvolutionQueryAsOf(value: string): string | null {
  const trimmed = value.trim();
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?/.exec(
      trimmed,
    );
  if (!match?.[1]) {
    return null;
  }
  if (!match[2] || !match[3]) {
    return match[1];
  }
  const zoneToken = match[4] ?? "";
  const zone = zoneToken.toUpperCase() === "Z" ? " UTC" : zoneToken ? ` ${zoneToken}` : "";
  return `${match[1]} ${match[2]}:${match[3]}${zone}`;
}

export function formatEvolutionFreshnessCopy(window: EvolutionPerceptionWindow): string {
  const asOf = formatEvolutionQueryAsOf(window.to);
  if (!asOf) {
    return EVOLUTION_PERCEPTION_COPY.freshnessManual;
  }
  return EVOLUTION_PERCEPTION_COPY.freshnessHint.replace("{asOf}", asOf);
}

export function evolutionRelativeWeekIsNext(
  counts: Record<EvolutionPerceptionIntentId, EvolutionIntentCountValue>,
): boolean {
  return (
    counts.learned_this_week === 0 &&
    typeof counts.diff_from_last_week === "number" &&
    counts.diff_from_last_week > 0
  );
}

export function answerHasVisibleEvolutionContent(answer: EvolutionPerceptionQueryView): boolean {
  const narration = stripEvolutionEmptyNarration(answer.narration);
  return (
    answer.items.length > 0 ||
    answer.platformItems.length > 0 ||
    narration.learned.length > 0 ||
    narration.platform.length > 0 ||
    narration.other.length > 0
  );
}

export function resolveEvolutionPerceptionUiStatus(input: {
  loading: boolean;
  connected: boolean;
  phaseStatus: "offline" | "denied" | "untrusted" | "failed" | "loaded";
  answer: EvolutionPerceptionQueryView | null;
  answerError: string | null;
}): EvolutionPerceptionUiStatus {
  if (!input.connected || input.phaseStatus === "offline") {
    return input.loading ? "loading" : "offline";
  }
  if (input.phaseStatus === "denied") {
    return "denied";
  }
  if (input.phaseStatus === "untrusted") {
    return "untrusted";
  }
  if (input.loading && !input.answer && !input.answerError && input.phaseStatus !== "failed") {
    return "loading";
  }
  if (input.phaseStatus === "failed" || input.answerError) {
    return "error";
  }
  if (input.answer) {
    return answerHasVisibleEvolutionContent(input.answer) ? "success_data" : "success_empty";
  }
  if (input.phaseStatus === "loaded") {
    return "success_empty";
  }
  return input.loading ? "loading" : "success_empty";
}

export function deriveEvolutionIntentCounts(input: {
  panels: EvolutionPerceptionPanels | null;
  answer: EvolutionPerceptionQueryView | null;
  selectedIntent: string;
  uiStatus: EvolutionPerceptionUiStatus;
}): Record<EvolutionPerceptionIntentId, EvolutionIntentCountValue> {
  const base: Record<EvolutionPerceptionIntentId, EvolutionIntentCountValue> = {
    learned_this_week: 0,
    diff_from_last_week: 0,
  };

  if (input.uiStatus === "error" || input.uiStatus === "denied" || input.uiStatus === "untrusted") {
    for (const intent of EVOLUTION_PERCEPTION_INTENTS) {
      base[intent.id] = "unavailable";
    }
    return base;
  }

  if (input.uiStatus === "loading" && !input.panels) {
    for (const intent of EVOLUTION_PERCEPTION_INTENTS) {
      base[intent.id] = "loading";
    }
    return base;
  }

  const panels = input.panels;
  if (panels) {
    base.learned_this_week = panels.learned.filter(
      (item) => item.result === "verified_effective",
    ).length;
    base.diff_from_last_week = panels.timeline.length;
  }

  if (input.answer && input.answer.intent === input.selectedIntent) {
    const selected = input.selectedIntent as EvolutionPerceptionIntentId;
    if (selected in base) {
      base[selected] = input.answer.items.length;
    }
  }

  if (input.uiStatus === "loading" && !input.answer) {
    const selected = input.selectedIntent as EvolutionPerceptionIntentId;
    if (selected in base) {
      base[selected] = "loading";
    }
  }

  return base;
}

export function formatEvolutionIntentCount(value: EvolutionIntentCountValue): string {
  if (value === "loading") {
    return EVOLUTION_PERCEPTION_COPY.countLoading;
  }
  if (value === "unavailable") {
    return EVOLUTION_PERCEPTION_COPY.countUnavailable;
  }
  return String(value);
}

export function evolutionIntentCountTitle(label: string, value: EvolutionIntentCountValue): string {
  if (value === "loading") {
    return `${label}，加载中`;
  }
  if (value === "unavailable") {
    return `${label}，暂无法获取数量`;
  }
  return `${label}，${value} 条`;
}

export function moreProjectionsSummaryLabel(
  panels: EvolutionPerceptionPanels | null,
  uiStatus: EvolutionPerceptionUiStatus,
): string {
  if (uiStatus === "error") {
    return EVOLUTION_PERCEPTION_COPY.moreProjectionsUnavailable;
  }
  if (!panels) {
    return EVOLUTION_PERCEPTION_COPY.moreProjections;
  }
  return `${EVOLUTION_PERCEPTION_COPY.moreProjections}（${visibleProjectionPanelCount(panels)}）`;
}

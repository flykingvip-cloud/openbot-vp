/** Built-in AOR task types aligned with `packages/aor-core` registry (UI-safe mirror). */

export type AorTaskTypeOption = {
  value: string;
  labelZh: string;
  labelEn: string;
  defaultEvaluatorMode: "content" | "workspace";
};

export const AOR_TASK_TYPE_CATALOG: readonly AorTaskTypeOption[] = [
  {
    value: "coding.review",
    labelZh: "代码审查",
    labelEn: "Code review",
    defaultEvaluatorMode: "content",
  },
  {
    value: "summarization",
    labelZh: "文本摘要",
    labelEn: "Summarization",
    defaultEvaluatorMode: "content",
  },
  {
    value: "coding.refactor",
    labelZh: "代码重构",
    labelEn: "Code refactor",
    defaultEvaluatorMode: "content",
  },
  {
    value: "coding.security",
    labelZh: "安全审查",
    labelEn: "Security review",
    defaultEvaluatorMode: "content",
  },
  {
    value: "research.summary",
    labelZh: "调研摘要",
    labelEn: "Research summary",
    defaultEvaluatorMode: "content",
  },
  {
    value: "lobster.pipeline",
    labelZh: "Lobster 流水线",
    labelEn: "Lobster pipeline",
    defaultEvaluatorMode: "workspace",
  },
  {
    value: "plugin.tool",
    labelZh: "插件工具调用",
    labelEn: "Plugin tool",
    defaultEvaluatorMode: "workspace",
  },
  {
    value: "ops.deploy",
    labelZh: "部署运维",
    labelEn: "Ops deploy",
    defaultEvaluatorMode: "workspace",
  },
] as const;

export const AOR_EVALUATOR_MODES = ["content", "workspace"] as const;

export type AorEvaluatorMode = (typeof AOR_EVALUATOR_MODES)[number];

const catalogById = new Map(AOR_TASK_TYPE_CATALOG.map((entry) => [entry.value, entry]));

export function resolveAorTaskTypeDefaultEvaluator(taskTypeId: string): AorEvaluatorMode {
  return catalogById.get(taskTypeId)?.defaultEvaluatorMode ?? "content";
}

export function buildAorTaskTypeSelectOptions(
  locale: string,
  currentValue?: string,
): Array<{ value: string; label: string }> {
  const useZh = locale.startsWith("zh");
  const options = AOR_TASK_TYPE_CATALOG.map((entry) => ({
    value: entry.value,
    label: useZh ? `${entry.labelZh} · ${entry.value}` : `${entry.labelEn} · ${entry.value}`,
  }));
  const trimmed = currentValue?.trim();
  if (trimmed && !catalogById.has(trimmed)) {
    options.unshift({
      value: trimmed,
      label: useZh ? `${trimmed}（当前）` : `${trimmed} (current)`,
    });
  }
  return options;
}

import type { CronDataBindingIssue } from "./data-binding-diagnostics.js";
import { lintCronDataBindings, type CronDataBindingCatalog } from "./data-binding-diagnostics.js";
import type { CronDataBindingRef } from "./personal-task-meta.js";
import { normalizeCronDataBindings } from "./personal-task-meta.js";

export type CronDataBindingIntegrityGrade = "A" | "B" | "C" | "D" | "F";

export type CronDataBindingIntegrityScore = {
  score: number;
  grade: CronDataBindingIntegrityGrade;
  summary: string;
  referencedCount: number;
  bindingCount: number;
  issues: CronDataBindingIssue[];
};

function gradeFromScore(score: number): CronDataBindingIntegrityGrade {
  if (score >= 90) {
    return "A";
  }
  if (score >= 75) {
    return "B";
  }
  if (score >= 60) {
    return "C";
  }
  if (score >= 40) {
    return "D";
  }
  return "F";
}

function penaltyForIssue(issue: CronDataBindingIssue): number {
  if (issue.code === "orphan_marker") {
    return 25;
  }
  if (issue.code === "stale_capability" || issue.code === "stale_knowledge") {
    return 20;
  }
  if (issue.code === "duplicate_resource") {
    return 15;
  }
  if (issue.code === "unused_binding") {
    return 10;
  }
  if (issue.code === "restricted_knowledge") {
    return 12;
  }
  return 8;
}

export function scoreCronDataBindingIntegrity(params: {
  intentText: string;
  dataBindings?: CronDataBindingRef[];
  catalog?: CronDataBindingCatalog;
}): CronDataBindingIntegrityScore {
  const bindings = normalizeCronDataBindings(params.dataBindings);
  const issues = lintCronDataBindings({
    intentText: params.intentText,
    dataBindings: bindings,
    catalog: params.catalog,
  });
  let score = 100;
  for (const issue of issues) {
    score -= penaltyForIssue(issue);
  }
  if (bindings.length === 0 && params.intentText.includes("{{bind:")) {
    score -= 30;
  }
  score = Math.max(0, Math.min(100, score));

  const referencedCount = bindings.filter((binding) =>
    params.intentText.includes(`{{bind:${binding.bindingId}}}`),
  ).length;

  const grade = gradeFromScore(score);
  const summary =
    bindings.length === 0
      ? "未绑定数据源"
      : issues.length === 0
        ? `${bindings.length} 项绑定完整可用`
        : `${referencedCount}/${bindings.length} 项已引用，${issues.length} 项待处理`;

  return {
    score,
    grade,
    summary,
    referencedCount,
    bindingCount: bindings.length,
    issues,
  };
}

export function formatBindingIntegrityLabel(score: CronDataBindingIntegrityScore): string {
  if (score.bindingCount === 0) {
    return "";
  }
  return `绑定 ${score.grade} · ${score.score}分`;
}

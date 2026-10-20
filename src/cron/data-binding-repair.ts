import type { CronDataBindingCatalog } from "./data-binding-diagnostics.js";
import { lintCronDataBindings } from "./data-binding-diagnostics.js";
import type { CronDataBindingRef } from "./personal-task-meta.js";
import {
  cronDataBindingMarker,
  extractBindingMarkersFromIntent,
  normalizeCronDataBindings,
} from "./personal-task-meta.js";

export type CronDataBindingRepairResult = {
  intentText: string;
  dataBindings: CronDataBindingRef[];
  fixes: string[];
};

function removeMarkerFromIntent(intentText: string, bindingId: string): string {
  const marker = cronDataBindingMarker(bindingId);
  return intentText
    .split(marker)
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function appendMarkerToIntent(intentText: string, bindingId: string): string {
  const marker = cronDataBindingMarker(bindingId);
  if (intentText.includes(marker)) {
    return intentText;
  }
  const trimmed = intentText.trim();
  return trimmed ? `${trimmed} ${marker}` : marker;
}

export function repairCronDataBindings(params: {
  intentText: string;
  dataBindings?: CronDataBindingRef[];
  catalog?: CronDataBindingCatalog;
}): CronDataBindingRepairResult {
  const fixes: string[] = [];
  let intentText = params.intentText;
  let dataBindings = normalizeCronDataBindings(params.dataBindings);

  if (params.catalog) {
    const before = dataBindings.length;
    dataBindings = dataBindings.filter((binding) => {
      if (binding.kind === "capability" && !params.catalog!.capabilityIds.has(binding.resourceId)) {
        intentText = removeMarkerFromIntent(intentText, binding.bindingId);
        fixes.push(`已移除失效的企业数据能力「${binding.label}」`);
        return false;
      }
      if (binding.kind === "knowledge") {
        const scope = binding.knowledgeScope ?? "personal";
        const exists =
          scope === "enterprise"
            ? params.catalog!.enterpriseObjectIds.has(binding.resourceId)
            : params.catalog!.personalObjectIds.has(binding.resourceId);
        if (!exists) {
          intentText = removeMarkerFromIntent(intentText, binding.bindingId);
          fixes.push(
            `已移除失效的${scope === "enterprise" ? "企业" : "个人"}知识「${binding.label}」`,
          );
          return false;
        }
      }
      return true;
    });
    if (dataBindings.length < before && fixes.length === 0) {
      fixes.push("已清理失效数据源绑定");
    }
  }

  const deduped: CronDataBindingRef[] = [];
  const seenResources = new Set<string>();
  for (const binding of dataBindings) {
    const key = `${binding.kind}:${binding.resourceId}`;
    if (seenResources.has(key)) {
      intentText = removeMarkerFromIntent(intentText, binding.bindingId);
      fixes.push(`已合并重复绑定「${binding.label}」`);
      continue;
    }
    seenResources.add(key);
    deduped.push(binding);
  }
  dataBindings = deduped;

  const bindingById = new Map(dataBindings.map((item) => [item.bindingId, item]));
  for (const marker of extractBindingMarkersFromIntent(intentText)) {
    if (!bindingById.has(marker)) {
      intentText = removeMarkerFromIntent(intentText, marker);
      fixes.push(`已移除未绑定的占位符 {{bind:${marker}}}`);
    }
  }

  for (const binding of dataBindings) {
    const marker = cronDataBindingMarker(binding.bindingId);
    if (!intentText.includes(marker)) {
      intentText = appendMarkerToIntent(intentText, binding.bindingId);
      fixes.push(`已在任务意图中引用「${binding.label}」`);
    }
  }

  const remainingIssues = lintCronDataBindings({
    intentText,
    dataBindings,
    catalog: params.catalog,
  }).filter((issue) => issue.level === "error");
  if (remainingIssues.length > 0) {
    fixes.push(`仍有 ${remainingIssues.length} 项需手动处理`);
  }

  return {
    intentText: intentText.trim(),
    dataBindings,
    fixes: [...new Set(fixes)],
  };
}

export function hasRepairableDataBindingIssues(params: {
  intentText: string;
  dataBindings?: CronDataBindingRef[];
  catalog?: CronDataBindingCatalog;
}): boolean {
  return lintCronDataBindings(params).length > 0;
}

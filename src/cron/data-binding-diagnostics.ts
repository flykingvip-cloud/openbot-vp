import type { CronDataBindingRef } from "./personal-task-meta.js";
import {
  extractBindingMarkersFromIntent,
  normalizeCronDataBindings,
} from "./personal-task-meta.js";

export type CronDataBindingCatalog = {
  capabilityIds: Set<string>;
  personalObjectIds: Set<string>;
  enterpriseObjectIds: Set<string>;
};

export type CronDataBindingIssueLevel = "error" | "warning" | "info";

export type CronDataBindingIssue = {
  level: CronDataBindingIssueLevel;
  code:
    | "orphan_marker"
    | "unused_binding"
    | "duplicate_resource"
    | "stale_capability"
    | "stale_knowledge"
    | "restricted_knowledge";
  message: string;
  bindingId?: string;
  marker?: string;
};

export function lintCronDataBindings(params: {
  intentText: string;
  dataBindings?: CronDataBindingRef[];
  catalog?: CronDataBindingCatalog;
}): CronDataBindingIssue[] {
  const bindings = normalizeCronDataBindings(params.dataBindings);
  const issues: CronDataBindingIssue[] = [];
  const markers = extractBindingMarkersFromIntent(params.intentText);
  const bindingById = new Map(bindings.map((item) => [item.bindingId, item]));
  const resourceKeys = new Map<string, string>();

  for (const marker of markers) {
    if (!bindingById.has(marker)) {
      issues.push({
        level: "error",
        code: "orphan_marker",
        marker,
        message: `意图中的 {{bind:${marker}}} 未找到对应数据源绑定`,
      });
    }
  }

  for (const binding of bindings) {
    const marker = `{{bind:${binding.bindingId}}}`;
    if (!params.intentText.includes(marker)) {
      issues.push({
        level: "warning",
        code: "unused_binding",
        bindingId: binding.bindingId,
        message: `已绑定「${binding.label}」但未在任务意图中引用`,
      });
    }

    const resourceKey = `${binding.kind}:${binding.resourceId}`;
    const previous = resourceKeys.get(resourceKey);
    if (previous && previous !== binding.bindingId) {
      issues.push({
        level: "warning",
        code: "duplicate_resource",
        bindingId: binding.bindingId,
        message: `「${binding.label}」与另一绑定引用相同数据源（${binding.resourceId}）`,
      });
    } else {
      resourceKeys.set(resourceKey, binding.bindingId);
    }

    if (!params.catalog) {
      continue;
    }
    if (binding.kind === "capability" && !params.catalog.capabilityIds.has(binding.resourceId)) {
      issues.push({
        level: "warning",
        code: "stale_capability",
        bindingId: binding.bindingId,
        message: `企业数据能力「${binding.label}」当前不可用，请重新绑定`,
      });
    }
    if (binding.kind === "knowledge") {
      const scope = binding.knowledgeScope ?? "personal";
      const exists =
        scope === "enterprise"
          ? params.catalog.enterpriseObjectIds.has(binding.resourceId)
          : params.catalog.personalObjectIds.has(binding.resourceId);
      if (!exists) {
        issues.push({
          level: "warning",
          code: "stale_knowledge",
          bindingId: binding.bindingId,
          message: `${scope === "enterprise" ? "企业" : "个人"}知识「${binding.label}」当前不可用，请重新绑定`,
        });
      }
    }
  }

  return issues;
}

export function buildCronDataBindingCatalog(params: {
  capabilityIds?: string[];
  personalObjectIds?: string[];
  enterpriseObjectIds?: string[];
}): CronDataBindingCatalog {
  return {
    capabilityIds: new Set(params.capabilityIds ?? []),
    personalObjectIds: new Set(params.personalObjectIds ?? []),
    enterpriseObjectIds: new Set(params.enterpriseObjectIds ?? []),
  };
}

import {
  buildCronDataBindingCatalog,
  lintCronDataBindings,
  type CronDataBindingIssue,
} from "../../../../../../src/cron/data-binding-diagnostics.ts";
import {
  hasRepairableDataBindingIssues,
  repairCronDataBindings,
  type CronDataBindingRepairResult,
} from "../../../../../../src/cron/data-binding-repair.ts";
import {
  formatBindingIntegrityLabel,
  scoreCronDataBindingIntegrity,
  type CronDataBindingIntegrityScore,
} from "../../../../../../src/cron/data-binding-score.ts";
import {
  findLegacyPromptTokens,
  migrateLegacyPromptBindings,
  type LegacyPromptMigrationResult,
} from "../../../../../../src/cron/legacy-prompt-bindings.ts";
import type { CronDataBindingRef } from "../../../../../../src/cron/personal-task-meta.ts";
import {
  cronDataBindingMarker,
  normalizeCronDataBindings,
} from "../../../../../../src/cron/personal-task-meta.ts";
import type {
  DataCapabilityDescriptor,
  KnowledgeObject,
} from "../../../capability/knowledge-universe/types.ts";
import type { PersonalCronTaskTemplate } from "./personal-cron-task-templates.ts";

export type CronDataBindingPickerItem = {
  bindingId: string;
  kind: CronDataBindingRef["kind"];
  resourceId: string;
  label: string;
  subtitle: string;
  accessState?: CronDataBindingRef["accessState"];
  knowledgeScope?: CronDataBindingRef["knowledgeScope"];
  disabled?: boolean;
  disabledReason?: string;
};

export type { CronDataBindingIssue, CronDataBindingIntegrityScore, CronDataBindingRepairResult };

export function buildWizardDataBindingCatalog(params: {
  dataCapabilities: DataCapabilityDescriptor[];
  personalKnowledge: KnowledgeObject[];
  enterpriseKnowledge?: KnowledgeObject[];
}): ReturnType<typeof buildCronDataBindingCatalog> {
  return buildCronDataBindingCatalog({
    capabilityIds: params.dataCapabilities.map((item) => item.id),
    personalObjectIds: params.personalKnowledge.map((item) => item.id),
    enterpriseObjectIds: (params.enterpriseKnowledge ?? []).map((item) => item.id),
  });
}

export function formatLegacyMigrationNotice(result: LegacyPromptMigrationResult): string | null {
  if (result.migratedTokens.length === 0 && result.unresolvedTokens.length === 0) {
    return null;
  }
  const parts: string[] = [];
  if (result.migratedTokens.length > 0) {
    parts.push(`已迁移 ${result.migratedTokens.length} 个旧版占位符`);
  }
  if (result.unresolvedTokens.length > 0) {
    parts.push(`${result.unresolvedTokens.join("、")} 需手动绑定数据源`);
  }
  return parts.join("；");
}

export function migrateWizardLegacyBindings(params: {
  intentText: string;
  dataBindings: CronDataBindingRef[];
  dataCapabilities: DataCapabilityDescriptor[];
}): LegacyPromptMigrationResult {
  return migrateLegacyPromptBindings({
    intentText: params.intentText,
    dataBindings: params.dataBindings,
    capabilities: params.dataCapabilities.map((capability) => ({
      id: capability.id,
      title: capability.title,
      summary: capability.summary,
      scenarios: capability.scenarios,
      accessState: capability.accessState === "pending" ? "requestable" : capability.accessState,
    })),
  });
}

export function listLegacyPromptTokens(intentText: string): string[] {
  return findLegacyPromptTokens(intentText);
}

function knowledgePickerItem(params: {
  object: KnowledgeObject;
  knowledgeScope: CronDataBindingRef["knowledgeScope"];
  disabled?: boolean;
  disabledReason?: string;
}): CronDataBindingPickerItem {
  const scope = params.knowledgeScope ?? "personal";
  const prefix = scope === "enterprise" ? "know-ent" : "know";
  return {
    bindingId: `${prefix}-${params.object.id}`,
    kind: "knowledge",
    resourceId: params.object.id,
    label: params.object.title,
    subtitle: params.object.summary || params.object.kind,
    knowledgeScope: scope,
    disabled: params.disabled,
    disabledReason: params.disabledReason,
  };
}

export function buildDataBindingPickerItems(params: {
  dataCapabilities: DataCapabilityDescriptor[];
  personalKnowledge: KnowledgeObject[];
  enterpriseKnowledge?: KnowledgeObject[];
  enterpriseRestrictedKnowledge?: KnowledgeObject[];
}): CronDataBindingPickerItem[] {
  const items: CronDataBindingPickerItem[] = [
    {
      bindingId: "runtime-today",
      kind: "runtime_date",
      resourceId: "today",
      label: "今天日期",
      subtitle: "任务执行当天日期，无需额外授权",
    },
  ];

  for (const capability of params.dataCapabilities) {
    const disabled = capability.accessState !== "granted";
    items.push({
      bindingId: `cap-${capability.id}`,
      kind: "capability",
      resourceId: capability.id,
      label: capability.title,
      subtitle:
        capability.summary || capability.scenarios.slice(0, 2).join(" · ") || "企业数据能力",
      accessState: capability.accessState === "pending" ? "requestable" : capability.accessState,
      disabled,
      disabledReason: disabled ? "需先申请或开通该数据能力" : undefined,
    });
  }

  for (const object of params.personalKnowledge.slice(0, 24)) {
    items.push(knowledgePickerItem({ object, knowledgeScope: "personal" }));
  }

  for (const object of (params.enterpriseKnowledge ?? []).slice(0, 24)) {
    items.push(knowledgePickerItem({ object, knowledgeScope: "enterprise" }));
  }

  for (const object of (params.enterpriseRestrictedKnowledge ?? []).slice(0, 8)) {
    items.push(
      knowledgePickerItem({
        object,
        knowledgeScope: "enterprise",
        disabled: true,
        disabledReason: "需申请访问权限",
      }),
    );
  }

  return items;
}

export function createDataBindingFromPickerItem(
  item: CronDataBindingPickerItem,
): CronDataBindingRef {
  return {
    bindingId: item.bindingId,
    kind: item.kind,
    resourceId: item.resourceId,
    label: item.label,
    ...(item.accessState ? { accessState: item.accessState } : {}),
    ...(item.knowledgeScope ? { knowledgeScope: item.knowledgeScope } : {}),
  };
}

export function upsertDataBinding(
  bindings: CronDataBindingRef[],
  binding: CronDataBindingRef,
): CronDataBindingRef[] {
  const normalized = normalizeCronDataBindings(bindings);
  const without = normalized.filter((item) => item.bindingId !== binding.bindingId);
  return [...without, binding];
}

export function insertDataBindingIntoIntent(params: {
  intentText: string;
  binding: CronDataBindingRef;
}): string {
  const marker = cronDataBindingMarker(params.binding.bindingId);
  const trimmed = params.intentText.trim();
  if (!trimmed) {
    return marker;
  }
  if (trimmed.includes(marker)) {
    return params.intentText;
  }
  return `${params.intentText}${params.intentText.endsWith(" ") ? "" : " "}${marker}`;
}

export function formatDataBindingInsertNotice(binding: CronDataBindingRef): string {
  if (binding.kind === "runtime_date") {
    return `已插入「${binding.label}」`;
  }
  if (binding.kind === "capability") {
    return `已绑定企业数据能力「${binding.label}」`;
  }
  if (binding.knowledgeScope === "enterprise") {
    return `已引用企业知识「${binding.label}」`;
  }
  return `已引用个人知识「${binding.label}」`;
}

export function listActiveDataBindings(
  metaBindings: CronDataBindingRef[] | undefined,
): CronDataBindingRef[] {
  return normalizeCronDataBindings(metaBindings);
}

export function diagnoseWizardDataBindings(params: {
  intentText: string;
  dataBindings: CronDataBindingRef[];
  dataCapabilities: DataCapabilityDescriptor[];
  personalKnowledge: KnowledgeObject[];
  enterpriseKnowledge?: KnowledgeObject[];
}): CronDataBindingIssue[] {
  return lintCronDataBindings({
    intentText: params.intentText,
    dataBindings: params.dataBindings,
    catalog: buildWizardDataBindingCatalog(params),
  });
}

export function scoreWizardDataBindings(params: {
  intentText: string;
  dataBindings: CronDataBindingRef[];
  dataCapabilities: DataCapabilityDescriptor[];
  personalKnowledge: KnowledgeObject[];
  enterpriseKnowledge?: KnowledgeObject[];
}): CronDataBindingIntegrityScore {
  return scoreCronDataBindingIntegrity({
    intentText: params.intentText,
    dataBindings: params.dataBindings,
    catalog: buildWizardDataBindingCatalog(params),
  });
}

export function scoreTemplateDataBindings(params: {
  template: PersonalCronTaskTemplate;
  dataCapabilities?: DataCapabilityDescriptor[];
  personalKnowledge?: KnowledgeObject[];
  enterpriseKnowledge?: KnowledgeObject[];
}): CronDataBindingIntegrityScore {
  return scoreCronDataBindingIntegrity({
    intentText: params.template.intentText,
    dataBindings: params.template.dataBindings,
    catalog: buildWizardDataBindingCatalog({
      dataCapabilities: params.dataCapabilities ?? [],
      personalKnowledge: params.personalKnowledge ?? [],
      enterpriseKnowledge: params.enterpriseKnowledge ?? [],
    }),
  });
}

export function canAutoRepairWizardDataBindings(params: {
  intentText: string;
  dataBindings: CronDataBindingRef[];
  dataCapabilities: DataCapabilityDescriptor[];
  personalKnowledge: KnowledgeObject[];
  enterpriseKnowledge?: KnowledgeObject[];
}): boolean {
  return hasRepairableDataBindingIssues({
    intentText: params.intentText,
    dataBindings: params.dataBindings,
    catalog: buildWizardDataBindingCatalog(params),
  });
}

export function repairWizardDataBindings(params: {
  intentText: string;
  dataBindings: CronDataBindingRef[];
  dataCapabilities: DataCapabilityDescriptor[];
  personalKnowledge: KnowledgeObject[];
  enterpriseKnowledge?: KnowledgeObject[];
}): CronDataBindingRepairResult {
  return repairCronDataBindings({
    intentText: params.intentText,
    dataBindings: params.dataBindings,
    catalog: buildWizardDataBindingCatalog(params),
  });
}

export function formatRepairNotice(result: CronDataBindingRepairResult): string | null {
  if (result.fixes.length === 0) {
    return null;
  }
  return result.fixes.join("；");
}

export function resolveIssueKnowledgeNavigation(params: {
  issue: CronDataBindingIssue;
  bindings: CronDataBindingRef[];
  dataCapabilities: DataCapabilityDescriptor[];
  enterpriseRestrictedKnowledge: KnowledgeObject[];
}): {
  kind: "capability" | "knowledge";
  resourceId: string;
  label: string;
  action: "view" | "request_access";
  projectionId?: string;
} | null {
  const binding = params.bindings.find((item) => item.bindingId === params.issue.bindingId);
  if (!binding) {
    if (params.issue.code === "orphan_marker") {
      return null;
    }
    return null;
  }
  if (binding.kind === "capability") {
    const capability = params.dataCapabilities.find((item) => item.id === binding.resourceId);
    return {
      kind: "capability",
      resourceId: binding.resourceId,
      label: binding.label,
      action: capability?.accessState === "requestable" ? "request_access" : "view",
    };
  }
  if (binding.kind === "knowledge") {
    const restricted = params.enterpriseRestrictedKnowledge.find(
      (item) => item.id === binding.resourceId,
    );
    return {
      kind: "knowledge",
      resourceId: binding.resourceId,
      label: binding.label,
      action: restricted ? "request_access" : "view",
      projectionId: restricted?.projectionId,
    };
  }
  return null;
}

export function issueSupportsKnowledgeNavigation(issue: CronDataBindingIssue): boolean {
  return (
    issue.code === "stale_capability" ||
    issue.code === "stale_knowledge" ||
    issue.code === "restricted_knowledge"
  );
}

export function summarizeTemplateDataBindings(
  template: PersonalCronTaskTemplate,
): CronDataBindingRef[] {
  return normalizeCronDataBindings(template.dataBindings);
}

export function formatTemplateBindingPreview(template: PersonalCronTaskTemplate): string | null {
  const bindings = summarizeTemplateDataBindings(template);
  if (bindings.length === 0) {
    return null;
  }
  const labels = bindings.map((item) => item.label).slice(0, 3);
  const suffix = bindings.length > 3 ? ` 等 ${bindings.length} 项` : "";
  return `数据源：${labels.join(" · ")}${suffix}`;
}

export function formatTemplateIntegrityBadge(score: CronDataBindingIntegrityScore): string | null {
  return formatBindingIntegrityLabel(score) || null;
}

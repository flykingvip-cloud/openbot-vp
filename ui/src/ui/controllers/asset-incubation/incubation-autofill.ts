import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  fetchAutofillResult,
  normalizeAutofillSuggestion,
  startAutofill,
  type SkillAutofillSuggestion,
  type SkillAutofillState,
} from "../skill-autofill.ts";
import type { QuickSaveSkillFormData } from "../skill-lifecycle.ts";

export function createIncubationAutofillState(
  client: GatewayBrowserClient | null,
  connected: boolean,
): SkillAutofillState {
  return {
    client,
    connected,
    jobsBySkillId: {},
  };
}

export function buildAutofillHintText(suggestion: SkillAutofillSuggestion | null): string | null {
  if (!suggestion) {
    return null;
  }
  const parts: string[] = [];
  if (suggestion.category) {
    parts.push(`分类：${suggestion.category}`);
  }
  if (suggestion.tags?.length) {
    parts.push(`标签：${suggestion.tags.slice(0, 4).join("、")}`);
  }
  if (suggestion.inputDescription) {
    parts.push(`输入：${suggestion.inputDescription.slice(0, 60)}`);
  }
  if (suggestion.outputDescription) {
    parts.push(`输出：${suggestion.outputDescription.slice(0, 60)}`);
  }
  if (suggestion.summaryRefinement) {
    parts.push(`摘要优化：${suggestion.summaryRefinement.slice(0, 80)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function applyAutofillHintsToForm(
  form: QuickSaveSkillFormData,
  suggestion: SkillAutofillSuggestion | null,
): QuickSaveSkillFormData {
  if (!suggestion) {
    return form;
  }
  const next = { ...form };
  if (!next.summary.trim() && suggestion.summaryRefinement?.trim()) {
    next.summary = suggestion.summaryRefinement.trim().slice(0, 180);
  }
  if (next.assetType === "capability" && suggestion.category?.includes("流程")) {
    next.assetType = "workflow";
  }
  return next;
}

/** Technical diagnostics that should not remain as the employee-facing summary. */
export function looksLikeTechnicalDiagnosticSummary(summary: string | null | undefined): boolean {
  const text = summary?.trim() ?? "";
  if (!text) {
    return false;
  }
  return /ASSET\.md|skill-template|skill_[a-z0-9]+|logicalId|索引失败|未能把正文/i.test(text);
}

export const FOLDED_TECHNICAL_SUMMARY_HINT =
  "系统诊断信息已折叠。请到「定义」页用智能补齐或手工填写一句话说明。";

/** Employee-facing summary: fold ASSET.md / index diagnostics into a short hint. */
export function presentEmployeeFacingSummary(summary: string | null | undefined): string {
  const text = summary?.trim() ?? "";
  if (!text) {
    return "暂无一句话说明";
  }
  if (looksLikeTechnicalDiagnosticSummary(text)) {
    return FOLDED_TECHNICAL_SUMMARY_HINT;
  }
  return text;
}

/**
 * Map autofill suggestions onto capability draft fields for the definition workbench.
 * Empty / placeholder / technical-diagnostic fields are filled; non-empty user copy is kept
 * unless the summary looks like a system diagnostic.
 */
export function applyAutofillSuggestionToCapabilityPatch(
  capability: {
    summary?: string;
    category?: string;
    tags?: string[];
    inputDescription?: string;
    outputDescription?: string;
    usageExamples?: string[];
  },
  suggestion: SkillAutofillSuggestion | null,
): {
  summary?: string;
  category?: string;
  tags?: string[];
  inputDescription?: string;
  outputDescription?: string;
  usageExamples?: string[];
} {
  if (!suggestion) {
    return {};
  }
  const patch: {
    summary?: string;
    category?: string;
    tags?: string[];
    inputDescription?: string;
    outputDescription?: string;
    usageExamples?: string[];
  } = {};
  const summary = capability.summary?.trim() ?? "";
  if (
    suggestion.summaryRefinement?.trim() &&
    (!summary || looksLikeTechnicalDiagnosticSummary(summary))
  ) {
    patch.summary = suggestion.summaryRefinement.trim().slice(0, 280);
  }
  if (suggestion.category?.trim() && !capability.category?.trim()) {
    patch.category = suggestion.category.trim();
  }
  if (suggestion.tags?.length && !capability.tags?.length) {
    patch.tags = suggestion.tags.slice(0, 8);
  }
  if (suggestion.inputDescription?.trim() && !capability.inputDescription?.trim()) {
    patch.inputDescription = suggestion.inputDescription.trim();
  }
  if (suggestion.outputDescription?.trim() && !capability.outputDescription?.trim()) {
    patch.outputDescription = suggestion.outputDescription.trim();
  }
  if (suggestion.usageExamples?.length && !capability.usageExamples?.length) {
    patch.usageExamples = suggestion.usageExamples.slice(0, 6);
  }
  return patch;
}

export async function runIncubationAutofill(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  skillId: string;
}): Promise<SkillAutofillSuggestion | null> {
  if (!params.client || !params.connected || !params.skillId.trim()) {
    return null;
  }
  const state = createIncubationAutofillState(params.client, params.connected);
  const jobId = await startAutofill(state, params.skillId);
  if (!jobId) {
    return null;
  }
  const job = await fetchAutofillResult(state, params.skillId);
  if (!job || job.status !== "succeeded") {
    return null;
  }
  return normalizeAutofillSuggestion(job.suggestion);
}

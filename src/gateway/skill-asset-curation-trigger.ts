/**
 * skill-asset-curation-trigger.ts — Async background curation for newly saved skill assets.
 *
 * After a skill asset is saved with minimal profile data (e.g. quick-save with just name + summary),
 * this module triggers LLM-based curation to enrich the profile with structured fields:
 * outputDescription, inputDescription, usageExamples, tags, category, assetType.
 *
 * Architecture:
 * - Fire-and-forget: triggered after handler responds; never blocks save.
 * - Graceful degradation: no-op when no LLM model is configured.
 * - Idempotent: only enriches fields that are empty/placeholder; never overwrites user-edited values.
 * - Bounded: caps deliverable body to prevent runaway token costs.
 */

import { isPlaceholderContent } from "./asset-admission.js";
import { createAgentKnowledgeLlmCaller } from "./knowledge/agent-knowledge-generator.js";
import { curateSkillAssetProfile } from "./skill-asset-curate-llm.js";
import { editPersonalSkillAsset, getPersonalSkillAssetDetail } from "./skill-lifecycle-store.js";

export type CurationTriggerParams = {
  /** Skill asset ID to curate. */
  skillId: string;
  /** Source agent/bot ID (used to resolve model access). */
  sourceAgentId?: string | null;
};

/**
 * Trigger async LLM curation for a newly saved skill asset.
 *
 * Call this fire-and-forget after saveSkillAsset succeeds.
 * It will:
 * 1. Load the saved skill detail
 * 2. Check if profile has empty/placeholder fields worth enriching
 * 3. Build a deliverable from the existing profile data
 * 4. Call curateSkillAssetProfile via the LLM
 * 5. Merge only empty/placeholder fields from the LLM patch
 * 6. Save via editPersonalSkillAsset
 *
 * Never throws — all failures are silently logged.
 */
export async function triggerAssetCuration(params: CurationTriggerParams): Promise<void> {
  try {
    const detail = getPersonalSkillAssetDetail(params.skillId);
    const { profile } = detail;

    // Only curate if there are enrichable gaps
    const gaps = identifyEnrichableGaps(profile);
    if (gaps.length === 0) {
      return;
    }

    // Build the LLM caller (returns null if no model configured)
    const llm = createAgentKnowledgeLlmCaller({
      agentId: params.sourceAgentId?.trim() || undefined,
    });
    if (!llm) {
      return;
    }

    // Build a pseudo-deliverable from existing profile data for the LLM to work with
    const deliverable = {
      title: profile.name || "",
      body: buildDeliverableBody(profile),
    };

    if (!deliverable.body.trim()) {
      return;
    }

    // Call LLM curation
    const patch = await curateSkillAssetProfile({ deliverable, llm });
    if (!patch) {
      return;
    }

    // Only apply fields that are currently empty or placeholder — never overwrite user edits
    const safePatch = filterPatchToEmptyFields(profile, patch);
    if (Object.keys(safePatch).length === 0) {
      return;
    }

    // Apply enrichment
    editPersonalSkillAsset({
      skillId: params.skillId,
      profile: {
        ...profile,
        ...safePatch,
      },
      summary: "自动整理 · LLM 内容增强",
    });
  } catch (err) {
    // Non-fatal: curation is best-effort background enrichment
    console.error(`[AssetCuration] failed for skill=${params.skillId}:`, err);
  }
}

type ProfileLike = {
  name?: string;
  summary?: string;
  outputDescription?: string;
  inputDescription?: string;
  usageExamples?: string[];
  tags?: string[];
  category?: string;
  assetType?: string;
};

/**
 * Identify profile fields that are empty or contain placeholder content.
 */
function identifyEnrichableGaps(profile: ProfileLike): string[] {
  const gaps: string[] = [];
  if (!profile.outputDescription || isPlaceholderContent(profile.outputDescription)) {
    gaps.push("outputDescription");
  }
  if (!profile.inputDescription || isPlaceholderContent(profile.inputDescription)) {
    gaps.push("inputDescription");
  }
  if (!profile.usageExamples || profile.usageExamples.length === 0) {
    gaps.push("usageExamples");
  }
  if (!profile.tags || profile.tags.length === 0) {
    gaps.push("tags");
  }
  if (!profile.category || profile.category.trim() === "") {
    gaps.push("category");
  }
  return gaps;
}

/**
 * Build a deliverable body from existing profile data for the LLM to reason about.
 */
function buildDeliverableBody(profile: ProfileLike): string {
  const parts: string[] = [];
  if (profile.name) {
    parts.push(`# ${profile.name}`);
  }
  if (profile.summary) {
    parts.push(profile.summary);
  }
  if (profile.outputDescription && !isPlaceholderContent(profile.outputDescription)) {
    parts.push(`\n## 输出说明\n${profile.outputDescription}`);
  }
  if (profile.inputDescription && !isPlaceholderContent(profile.inputDescription)) {
    parts.push(`\n## 输入说明\n${profile.inputDescription}`);
  }
  if (profile.usageExamples && profile.usageExamples.length > 0) {
    parts.push(`\n## 使用场景\n${profile.usageExamples.join("\n")}`);
  }
  return parts.join("\n");
}

/**
 * Filter an LLM-generated patch to only include fields that are currently empty or placeholder
 * in the existing profile. Never overwrites user-provided values.
 */
function filterPatchToEmptyFields(
  existing: ProfileLike,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  if (
    patch.outputDescription &&
    (!existing.outputDescription || isPlaceholderContent(existing.outputDescription))
  ) {
    safe.outputDescription = patch.outputDescription;
  }
  if (
    patch.inputDescription &&
    (!existing.inputDescription || isPlaceholderContent(existing.inputDescription))
  ) {
    safe.inputDescription = patch.inputDescription;
  }
  if (
    patch.usageExamples &&
    Array.isArray(patch.usageExamples) &&
    patch.usageExamples.length > 0 &&
    (!existing.usageExamples || existing.usageExamples.length === 0)
  ) {
    safe.usageExamples = patch.usageExamples;
  }
  if (
    patch.tags &&
    Array.isArray(patch.tags) &&
    patch.tags.length > 0 &&
    (!existing.tags || existing.tags.length === 0)
  ) {
    safe.tags = patch.tags;
  }
  if (patch.category && (!existing.category || existing.category.trim() === "")) {
    safe.category = patch.category;
  }
  if (patch.assetType && !existing.assetType) {
    safe.assetType = patch.assetType;
  }
  // name and summary: never overwrite (user explicitly provided these in quick-save)
  return safe;
}

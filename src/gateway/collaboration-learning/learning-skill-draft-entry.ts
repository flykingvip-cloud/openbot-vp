/**
 * P1-D production entry: make the human gate after learning skill curation reachable.
 *
 * Lifecycle (unchanged):
 *   outcome_verified → candidate cluster → draft (curateLearningSkillDrafts)
 *   → finalize (this entry / personal-skills.finalize-draft) → private
 *   → robot-skills.install → SkillExecutionBinding materialise → real tool path
 *   → robot-skills.remove / toggle off → no longer used
 *
 * Does NOT auto-approve or auto-install. Drafts without ownerUserId stay invisible
 * here (same fail-closed ACL as personal-skills).
 */

import { LEARNING_SKILL_LINEAGE_PREFIX } from "../../auto-reply/reply/learning-skill-curation.js";
import {
  finalizeDraftSkill,
  getPersonalSkillAssetDetail,
  listPersonalSkillAssets,
  SkillAssetStoreError,
  type EmployeeSkillDetail,
  type EmployeeSkillSummary,
} from "../skill-lifecycle-store.js";

function normalizeOwner(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return null;
  }
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

function uniqueOwners(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const n = normalizeOwner(value);
    if (!n || seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function isLearningCuratedSkillLineage(sourceLineageId: string | null | undefined): boolean {
  const lineage = sourceLineageId?.trim() ?? "";
  return lineage.startsWith(LEARNING_SKILL_LINEAGE_PREFIX);
}

/**
 * List draft skills curated from learning assets and owned by the caller.
 * Reachable human gate: UI/RPC can show pending drafts awaiting finalize.
 */
export function listLearningCuratedSkillDrafts(
  ownerIds: string | string[],
): EmployeeSkillSummary[] {
  const aliases = new Set(uniqueOwners(Array.isArray(ownerIds) ? ownerIds : [ownerIds]));
  if (aliases.size === 0) {
    return [];
  }
  return listPersonalSkillAssets()
    .filter((skill) => skill.lifecycle === "draft")
    .filter((skill) => isLearningCuratedSkillLineage(skill.sourceLineageId))
    .filter((skill) => {
      const owner = normalizeOwner(skill.ownerUserId);
      return Boolean(owner && aliases.has(owner));
    });
}

export type FinalizeLearningSkillDraftParams = {
  skillId: string;
  /** Authenticated owner aliases (platform id / email). */
  ownerIds: string[];
};

export type FinalizeLearningSkillDraftResult = {
  skill: EmployeeSkillDetail;
  /** Status after finalize — always private on success. */
  nextLifecycle: "private";
  /**
   * Install remains a separate human/RPC step (`robot-skills.install`).
   * This entry never auto-installs.
   */
  nextStep: "robot-skills.install";
};

/**
 * Human-gated draft → private for a learning-curated skill.
 * Ownership required; does not install or publish.
 */
export function finalizeLearningCuratedSkillDraft(
  params: FinalizeLearningSkillDraftParams,
): FinalizeLearningSkillDraftResult {
  const skillId = params.skillId.trim();
  const aliases = new Set(uniqueOwners(params.ownerIds));
  if (!skillId) {
    throw new SkillAssetStoreError("skillId is required");
  }
  if (aliases.size === 0) {
    throw new SkillAssetStoreError("authenticated user required for personal asset access");
  }
  const detail = getPersonalSkillAssetDetail(skillId);
  if (!isLearningCuratedSkillLineage(detail.sourceLineageId)) {
    throw new SkillAssetStoreError("skill is not a learning-curated draft");
  }
  const assetOwner = normalizeOwner(detail.ownerUserId);
  if (!assetOwner || !aliases.has(assetOwner)) {
    throw new SkillAssetStoreError("personal asset is not accessible to this user");
  }
  if (detail.lifecycle !== "draft") {
    throw new SkillAssetStoreError(`skill ${skillId} is not in draft state`);
  }
  const skill = finalizeDraftSkill(skillId);
  return {
    skill,
    nextLifecycle: "private",
    nextStep: "robot-skills.install",
  };
}

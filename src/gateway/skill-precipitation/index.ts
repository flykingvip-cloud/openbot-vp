/**
 * Skill precipitation pipeline — trajectory → candidate → draft recipe.
 *
 * Reuses skill-lifecycle-store.saveSkillAsset (draft, autoInstallEnabled=false).
 * Does not enable OPENBOT_SKILL_AUTO_EVOLUTION or auto-approve/publish/install.
 */

export {
  PRECIPITATION_EMPLOYEE_HINT,
  type PrecipitationCompleteness,
  type PrecipitationDetectResult,
  type PrecipitationPersistResult,
  type SkillPrecipitationCandidate,
  type SkillPrecipitationStep,
  type TaskTrajectorySummary,
} from "./types.js";
export { detectPrecipitationCandidate, PRECIPITATION_MIN_PERSIST_CONFIDENCE } from "./detect.js";
export { collectEphemeralTokens, stripEphemeralFromText } from "./ephemeral.js";
export { extractSkillDraftFromCandidate, type ExtractedSkillDraft } from "./extract.js";
export { findExistingPrecipitationSkill, precipitationSignature } from "./dedupe.js";
export {
  persistPrecipitationCandidate,
  persistPrecipitationDraft,
  type PersistPrecipitationParams,
} from "./persist.js";
export { trajectoryFromCapabilityGapPayload } from "./from-gap-payload.js";

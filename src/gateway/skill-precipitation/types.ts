/**
 * Skill precipitation candidate contract — single decision surface for
 * "task trajectory → reusable recipe draft".
 *
 * Fail-closed: evidence refs required; low confidence must not claim "learned".
 * Does not open auto-approve / auto-publish / OPENBOT_SKILL_AUTO_EVOLUTION.
 */

export type PrecipitationCompleteness = "full" | "partial" | "insufficient";

export type SkillPrecipitationStep = {
  order: number;
  /** Decontextualized instruction (no tip SHA / one-off paths). */
  instruction: string;
  /** Optional tool name(s) used on this step. */
  tools?: string[];
};

export type SkillPrecipitationCandidate = {
  whenToUse: string;
  redLines: string[];
  steps: SkillPrecipitationStep[];
  acceptance: string[];
  failureModes: string[];
  /** Values that belong in parameters / routingHints, not fixed body text. */
  ephemeralParams: string[];
  confidence: number;
  sourceEvidenceRefs: string[];
  /** Ordered tool-chain signature for dedupe. */
  toolChain: string[];
  completeness: PrecipitationCompleteness;
  /** Human-readable reason when completeness is partial/insufficient. */
  completenessReason?: string;
  suggestedName?: string;
};

/** Trajectory summary fed into detect + extract. */
export type TaskTrajectorySummary = {
  /** Stable "when to use" / routing signal. */
  whenToUse?: string | null;
  /** Suggested display name. */
  nameHint?: string | null;
  /** Ordered step instructions (may still contain ephemeral tokens). */
  steps?: Array<string | { instruction: string; tools?: string[] }> | null;
  /** Explicit red lines / gates. */
  redLines?: string[] | null;
  /** Acceptance checks. */
  acceptance?: string[] | null;
  /** Known failure modes. */
  failureModes?: string[] | null;
  /** Tools observed in order (duplicates collapsed later). */
  toolsUsed?: string[] | null;
  /** User corrections that improved the run. */
  userCorrections?: string[] | null;
  /** Whether the multi-step run succeeded. */
  succeeded?: boolean | null;
  /** Evidence ids (ledger / run / proposal / marker). Required to persist a claim. */
  sourceEvidenceRefs?: string[] | null;
  /** Free-form detail (gap reason, lesson text) used when steps are sparse. */
  detail?: string | null;
  /** Optional parameter names already known to be ephemeral. */
  knownEphemeralParams?: string[] | null;
};

export type PrecipitationDetectResult =
  | { kind: "candidate"; candidate: SkillPrecipitationCandidate }
  | { kind: "skip"; reason: string; confidence: number };

export type PrecipitationPersistResult =
  | {
      kind: "created";
      skillId: string;
      candidate: SkillPrecipitationCandidate;
      signature: string;
    }
  | {
      kind: "reused";
      skillId: string;
      candidate: SkillPrecipitationCandidate;
      signature: string;
    }
  | { kind: "skipped"; reason: string; confidence: number };

/** Employee-facing copy (whitelist language; no engineer blacklist terms). */
export const PRECIPITATION_EMPLOYEE_HINT = "检测到可复用的能力，是否整理保存？";

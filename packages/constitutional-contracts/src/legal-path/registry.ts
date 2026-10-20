/**
 * Phase D P8b Knife1 — declared legal constitutional Path registry.
 *
 * Scope: `phase_d_p8b_knife1_select_only`.
 * Exactly one versioned legal trajectory. Selection may be authorized when
 * the independent default-off flag is on. Execution is not authorized here.
 *
 * Painted aliases (sessionKey, Lobster, AOR, Fabric, dormant orchestration,
 * workflow words, PathKind, ExecutionPlan, receipts) are not Paths and must
 * never appear in this registry.
 */

export const PHASE_D_P8B_KNIFE1_SCOPE = "phase_d_p8b_knife1_select_only" as const;

/**
 * First declared legal constitutional Path id (versioned).
 * Not a sessionKey, workflow name, Lobster/AOR/Fabric graph, or receipt.
 */
export const CONSTITUTIONAL_DECLARED_PATH_V1 = "constitutional.declared.v1" as const;

export type DeclaredLegalPathId = typeof CONSTITUTIONAL_DECLARED_PATH_V1;

export type LegalPathRecord = {
  id: DeclaredLegalPathId;
  version: 1;
  /** Written definition: explicit selection onto a pre-named legal trajectory. */
  definition: string;
  /** Knife1 allows selection when the select flag is on. */
  selectionAuthorized: true;
  /** Knife1 forbids execution side effects. */
  executionAuthorized: false;
};

/**
 * Legal Path set for P8b Knife1: length ≥ 1, versioned, nameable.
 * P8a keeps its own empty `LEGAL_CONSTITUTIONAL_PATHS` for report-only.
 */
export const DECLARED_LEGAL_PATHS = [
  {
    id: CONSTITUTIONAL_DECLARED_PATH_V1,
    version: 1,
    definition:
      "Explicitly selected constitutional legal trajectory (ADR-1 Path). " +
      "Knife1 authorizes selection only; execution side effects stay unauthorized.",
    selectionAuthorized: true,
    executionAuthorized: false,
  },
] as const satisfies readonly LegalPathRecord[];

export const DECLARED_LEGAL_PATH_IDS = [
  CONSTITUTIONAL_DECLARED_PATH_V1,
] as const satisfies readonly DeclaredLegalPathId[];

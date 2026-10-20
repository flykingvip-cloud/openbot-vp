/**
 * Phase D P8b Knife1 — default-off legal Path selection (no execution).
 *
 * Scope: `phase_d_p8b_knife1_select_only`.
 * When the independent select flag is off (or no opt-in), behavior matches
 * P8a: effective legal set empty, selectedPath null, executed false.
 * When on, a candidate that matches the declared registry may be selected.
 * executed stays false; sideEffects stay empty. No hot-path wiring.
 */

import {
  CONSTITUTIONAL_DECLARED_PATH_V1,
  DECLARED_LEGAL_PATH_IDS,
  DECLARED_LEGAL_PATHS,
  PHASE_D_P8B_KNIFE1_SCOPE,
  type DeclaredLegalPathId,
  type LegalPathRecord,
} from "./registry.js";

export {
  CONSTITUTIONAL_DECLARED_PATH_V1,
  DECLARED_LEGAL_PATH_IDS,
  DECLARED_LEGAL_PATHS,
  PHASE_D_P8B_KNIFE1_SCOPE,
  type DeclaredLegalPathId,
  type LegalPathRecord,
} from "./registry.js";

/**
 * Independent rollback / select switch. Unset keeps selection off (P8a face).
 * Turning it on does not execute, enforce, live-invoke, or open Fabric.
 * This module never reads the variable from `process.env` by itself.
 */
export const LEGAL_PATH_SELECT_ENV = "OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT";

const SELECT_TRUTHY = new Set(["1", "true", "yes", "on"]);
const NO_SIDE_EFFECTS = Object.freeze([]) as readonly [];

export type LegalPathSelectionInput = {
  /**
   * Candidate constitutional Path id.
   * Only a declared legal id can be selected when the flag is on.
   */
  candidatePath?: string | null;
  /** Named process space. Not a Path. */
  workflowRef?: string | null;
  /** Routing identity. Not a Path. */
  sessionKey?: string | null;
  /** Lobster flow word. Not a Path. */
  lobsterRef?: string | null;
  /** AOR graph word. Not a Path. */
  aorGraphRef?: string | null;
  /** Fabric graph word. Not a Path. */
  fabricGraphRef?: string | null;
  /** Dormant orchestration word. Not a Path. */
  orchestrationRef?: string | null;
};

export type LegalPathSelectOptions = {
  /**
   * Explicit opt-in for selection. Default false.
   * Does not authorize execution.
   */
  select?: boolean;
  /**
   * Caller-supplied env snapshot. This function does not read `process.env`.
   * `LEGAL_PATH_SELECT_ENV` truthy enables selection only.
   */
  env?: Readonly<Record<string, string | undefined>>;
};

export type LegalPathSelectResult = {
  schemaVersion: 1;
  scope: typeof PHASE_D_P8B_KNIFE1_SCOPE;
  mode: "inert" | "select_only";
  /** True only when selection naming/selection was opted into. */
  invoked: boolean;
  /** True when the independent flag (or select: true) is on. */
  selectEnabled: boolean;
  /**
   * Effective legal Path ids under the current flag.
   * Empty when the flag is off (rollback to P8a face).
   */
  effectiveLegalPathIds: readonly DeclaredLegalPathId[];
  /** Non-null only when selectEnabled and candidate matches a declared id. */
  selectedPath: DeclaredLegalPathId | null;
  candidatePresent: boolean;
  candidateAccepted: boolean;
  /** True when selectEnabled and the declared registry is non-empty. */
  legalPathSelectable: boolean;
  /** Always false in Knife1. Execution is a later knife. */
  executed: false;
  sideEffects: readonly [];
  /** Always false. C5 cannot pass on Knife1 alone. */
  c5Pass: false;
  /** Always false. Selection is not permission to tighten. */
  readyToTighten: false;
  /** Always false. P8c is a different slice. */
  shadowCompared: false;
  paintedAliasUsedAsPath: false;
  enforce: false;
  liveInvoke: false;
  fabricDefaultOn: false;
  mutated: false;
  message: string;
};

/** Fixture: painted aliases that must never become a Path. */
export const sampleLegalPathSelectInput = {
  candidatePath: null,
  workflowRef: "lobster",
  sessionKey: "agent:main:main",
  lobsterRef: "lobster-flow",
  aorGraphRef: "aor-graph",
  fabricGraphRef: "fabric-graph",
  orchestrationRef: "dormant-orchestration",
} as const satisfies LegalPathSelectionInput;

export function isLegalPathSelectEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[LEGAL_PATH_SELECT_ENV]?.trim().toLowerCase();
  return raw !== undefined && SELECT_TRUTHY.has(raw);
}

/**
 * Whether `candidate` is a declared legal Path id in the Knife1 registry.
 * Does not consult the select flag; callers must gate with selectEnabled.
 */
export function isDeclaredLegalPath(
  candidate: string | null | undefined,
): candidate is DeclaredLegalPathId {
  if (typeof candidate !== "string") {
    return false;
  }
  const trimmed = candidate.trim();
  return (DECLARED_LEGAL_PATH_IDS as readonly string[]).includes(trimmed);
}

/**
 * Effective legal set: full declared registry when select is on, else empty
 * (second-scale rollback to P8a face without deleting the module).
 */
export function listEffectiveLegalPaths(
  options: LegalPathSelectOptions = {},
): readonly LegalPathRecord[] {
  if (!(options.select === true || isLegalPathSelectEnabled(options.env ?? {}))) {
    return [];
  }
  return DECLARED_LEGAL_PATHS;
}

function hasCandidate(input: LegalPathSelectionInput): boolean {
  return typeof input.candidatePath === "string" && input.candidatePath.trim().length > 0;
}

/** Painted aliases are visible only so they can be discarded. They are not Paths. */
function discardPaintedAliases(input: LegalPathSelectionInput): true {
  void input.workflowRef;
  void input.sessionKey;
  void input.lobsterRef;
  void input.aorGraphRef;
  void input.fabricGraphRef;
  void input.orchestrationRef;
  return true;
}

function assertUnmutated(before: string, input: LegalPathSelectionInput): void {
  if (before !== JSON.stringify(input)) {
    throw new Error("legal-path select mutated its input");
  }
}

function baseResult(
  invoked: boolean,
  selectEnabled: boolean,
  message: string,
): LegalPathSelectResult {
  const effective = selectEnabled ? DECLARED_LEGAL_PATH_IDS : [];
  return {
    schemaVersion: 1,
    scope: PHASE_D_P8B_KNIFE1_SCOPE,
    mode: selectEnabled ? "select_only" : "inert",
    invoked,
    selectEnabled,
    effectiveLegalPathIds: effective,
    selectedPath: null,
    candidatePresent: false,
    candidateAccepted: false,
    legalPathSelectable: selectEnabled && effective.length > 0,
    executed: false,
    sideEffects: NO_SIDE_EFFECTS,
    c5Pass: false,
    readyToTighten: false,
    shadowCompared: false,
    paintedAliasUsedAsPath: false,
    enforce: false,
    liveInvoke: false,
    fabricDefaultOn: false,
    mutated: false,
    message,
  };
}

/**
 * Select a declared legal Path, or stay inert / reject.
 * Does not execute, tighten, compare shadow decisions, or write.
 */
export function selectLegalPath(
  input: LegalPathSelectionInput,
  options: LegalPathSelectOptions = {},
): LegalPathSelectResult {
  const before = JSON.stringify(input);
  const selectEnabled = options.select === true || isLegalPathSelectEnabled(options.env ?? {});

  if (!selectEnabled) {
    discardPaintedAliases(input);
    assertUnmutated(before, input);
    return baseResult(
      false,
      false,
      "legal-path select is default-off; effective legal set is empty (P8a face) and nothing was executed",
    );
  }

  const present = hasCandidate(input);
  const trimmed = present ? input.candidatePath!.trim() : "";
  const accepted = isDeclaredLegalPath(trimmed);
  discardPaintedAliases(input);
  assertUnmutated(before, input);

  if (accepted) {
    return {
      ...baseResult(
        true,
        true,
        "candidate matched declared legal Path; selected without executing",
      ),
      selectedPath: trimmed as DeclaredLegalPathId,
      candidatePresent: true,
      candidateAccepted: true,
    };
  }

  return {
    ...baseResult(
      true,
      true,
      present
        ? "candidate is outside the declared legal Path set; not selected and not executed"
        : "no candidate Path; nothing selected and nothing executed",
    ),
    candidatePresent: present,
    candidateAccepted: false,
  };
}

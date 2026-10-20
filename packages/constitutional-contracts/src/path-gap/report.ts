/**
 * Phase D §9.3 P8a — report-only path-gap naming.
 *
 * Scope: `phase_d_p8a_report_only`.
 * Names `no_valid_path` when no valid constitutional Path is selected.
 * Never selects a Path, never executes, never tightens a Gate.
 *
 * Default-off. Nothing in gateway chat, tool invoke, ACP, or AOR imports
 * this module. The function does not read `process.env`. A caller must pass
 * `report: true` or an explicit env snapshot whose flag is on. Either way
 * the result is a report: `executed` stays false and `sideEffects` stays empty.
 *
 * `path=unset` / `no_valid_path` is a gap name. It is not a success gate for
 * hot-path tightening. P8b, P8c, and Gate tightening are not this slice.
 * Workflow, sessionKey, Lobster, AOR graph, Fabric graph, and dormant
 * orchestration are not a Path.
 */

export const PHASE_D_P8A_SCOPE = "phase_d_p8a_report_only" as const;

export const NO_VALID_PATH = "no_valid_path" as const;

export const PATH_GAP_CODES = [NO_VALID_PATH] as const;

export type PathGapCode = (typeof PATH_GAP_CODES)[number];

/**
 * Optional naming switch. Unset or any other value keeps naming off.
 * Turning it on does not select a Path, enforce, live-invoke, or open Fabric.
 * This module never reads the variable from `process.env` by itself.
 */
export const PATH_GAP_REPORT_ENV = "OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT";

/**
 * Legal constitutional Paths known to P8a.
 * Empty on purpose: P8b (at least one real legal Path that can be selected
 * for execution) is not authorized.
 */
export const LEGAL_CONSTITUTIONAL_PATHS = [] as const;

const REPORT_TRUTHY = new Set(["1", "true", "yes", "on"]);

const NO_SIDE_EFFECTS = Object.freeze([]) as readonly [];

export type PathSelectionInput = {
  /**
   * Candidate constitutional Path id.
   * Null, omitted, or blank means no Path was selected.
   * A non-empty string is still not accepted: P8a has no legal Path to select.
   */
  selectedPath?: string | null;
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

export type PathGapReportOptions = {
  /**
   * Explicit opt-in for gap naming. Default false.
   * Does not authorize execution.
   */
  report?: boolean;
  /**
   * Caller-supplied env snapshot. This function does not read `process.env`.
   * `PATH_GAP_REPORT_ENV` truthy enables naming only. It does not execute.
   */
  env?: Readonly<Record<string, string | undefined>>;
};

export type PathGapReport = {
  schemaVersion: 1;
  scope: typeof PHASE_D_P8A_SCOPE;
  mode: "report_only";
  /** True only when the caller explicitly opted into naming. */
  invoked: boolean;
  gapCode: PathGapCode | null;
  /** Always null. This slice never selects a Path. */
  selectedPath: null;
  candidatePresent: boolean;
  /** Always false. A string is not a legal Path in P8a. */
  candidateAccepted: false;
  /** Always false. C5 cannot pass before P8b. */
  c5Pass: false;
  /** Always false. Naming the gap is not permission to tighten. */
  readyToTighten: false;
  /** Always false. `path=unset` is not a hot-path success gate. */
  pathUnsetIsTighteningGate: false;
  /** Always false. P8b is a different slice. */
  legalPathSelectable: false;
  /** Always false. P8c is a different slice. */
  shadowCompared: false;
  /** Always false. Painted workflow words were not used as a Path. */
  paintedAliasUsedAsPath: false;
  executed: false;
  sideEffects: readonly [];
  enforce: false;
  liveInvoke: false;
  fabricDefaultOn: false;
  mutated: false;
  message: string;
};

/** Fixture: no Path selected, with workflow words that must not be painted as one. */
export const samplePathGapInput = {
  selectedPath: null,
  workflowRef: "lobster",
  sessionKey: "agent:main:main",
  lobsterRef: "lobster-flow",
  aorGraphRef: "aor-graph",
  fabricGraphRef: "fabric-graph",
  orchestrationRef: "dormant-orchestration",
} as const satisfies PathSelectionInput;

export function isPathGapReportEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env[PATH_GAP_REPORT_ENV]?.trim().toLowerCase();
  return raw !== undefined && REPORT_TRUTHY.has(raw);
}

/**
 * Always false. P8a cannot validate a candidate into a selectable legal Path.
 */
export function isValidConstitutionalPath(candidate: string | null | undefined): false {
  const listed = (LEGAL_CONSTITUTIONAL_PATHS as readonly string[]).filter(
    (path) => path === candidate,
  );
  if (listed.length > 0) {
    return false;
  }
  return false;
}

function hasCandidate(input: PathSelectionInput): boolean {
  return typeof input.selectedPath === "string" && input.selectedPath.trim().length > 0;
}

/** Painted aliases are visible only so they can be discarded. They are not Paths. */
function discardPaintedAliases(input: PathSelectionInput): true {
  void input.workflowRef;
  void input.sessionKey;
  void input.lobsterRef;
  void input.aorGraphRef;
  void input.fabricGraphRef;
  void input.orchestrationRef;
  return true;
}

function assertUnmutated(before: string, input: PathSelectionInput): void {
  if (before !== JSON.stringify(input)) {
    throw new Error("path-gap report mutated its input");
  }
}

function baseReport(invoked: boolean, message: string): PathGapReport {
  return {
    schemaVersion: 1,
    scope: PHASE_D_P8A_SCOPE,
    mode: "report_only",
    invoked,
    gapCode: null,
    selectedPath: null,
    candidatePresent: false,
    candidateAccepted: false,
    c5Pass: false,
    readyToTighten: false,
    pathUnsetIsTighteningGate: false,
    legalPathSelectable: false,
    shadowCompared: false,
    paintedAliasUsedAsPath: false,
    executed: false,
    sideEffects: NO_SIDE_EFFECTS,
    enforce: false,
    liveInvoke: false,
    fabricDefaultOn: false,
    mutated: false,
    message,
  };
}

/**
 * Name the path gap, or stay inert.
 * Does not execute, select, tighten, compare shadow decisions, or write.
 */
export function reportPathGap(
  input: PathSelectionInput,
  options: PathGapReportOptions = {},
): PathGapReport {
  const before = JSON.stringify(input);
  const namingEnabled = options.report === true || isPathGapReportEnabled(options.env ?? {});
  if (!namingEnabled) {
    assertUnmutated(before, input);
    return baseReport(
      false,
      "path-gap reporting is default-off; no_valid_path was not named and nothing was executed",
    );
  }

  const present = hasCandidate(input);
  const accepted = isValidConstitutionalPath(present ? input.selectedPath : null);
  discardPaintedAliases(input);
  assertUnmutated(before, input);

  return {
    ...baseReport(
      true,
      present
        ? "candidate is not a valid constitutional Path; named no_valid_path and did not execute"
        : "no constitutional Path is selected; named no_valid_path and did not execute",
    ),
    gapCode: NO_VALID_PATH,
    candidatePresent: present,
    candidateAccepted: accepted,
    paintedAliasUsedAsPath: false,
  };
}

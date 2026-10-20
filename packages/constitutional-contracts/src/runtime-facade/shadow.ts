/**
 * Phase D §9.1 Runtime façade — default-off shadow only.
 *
 * Written scope: `phase_d_runtime_facade_shadow_only`.
 * Path-Gate report bridge (dual opt-in): `phase_d_path_gate_shadow_select_report`
 * / start-order `phase_d_path_gate_shadow_select_report_start_order`.
 * Path-Gate select diagnostics (dual opt-in): `phase_d_path_gate_shadow_select_diagnostics`
 * / start-order `phase_d_path_gate_shadow_select_diagnostics_start_order`.
 * P8c shadow↔legacy compare (SHADOW ∧ COMPARE): `phase_d_p8c_shadow_legacy_compare`
 * / start-order `phase_d_p8c_shadow_legacy_compare_start_order`.
 * Reuses `evaluateShadowConformance`. This is not a fifth execution story
 * and not a cross-domain writer.
 *
 * Inert unless the caller passes `shadow: true` or an env snapshot whose
 * `OPENBOT_CONSTITUTIONAL_SHADOW` is on. This module does not read
 * `process.env`. When off, the evaluator is not called. When on, the result
 * is a report: enforce, live invoke, and Fabric stay false; nothing is
 * written or blocked. `executed` stays false.
 *
 * Path select is a separate dual opt-in (`select: true` or
 * `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` on the same caller snapshot).
 * Only when BOTH shadow and select are on may this façade call
 * `selectLegalPath` and surface a non-null `selectedPath` plus Knife1
 * select diagnostics (`selectEnabled`, `effectiveLegalPathIds`,
 * `candidatePresent`, `candidateAccepted`, `selectMessage`). Select alone
 * (without shadow) does not invoke this façade. Report-only: not Gate
 * tighten, not hot-path wiring, not P8b execute.
 *
 * P8c compare is a separate opt-in (`compare: true` or
 * `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE`). Only when SHADOW ∧ COMPARE ∧
 * both sides supply enough string snapshots may `shadowCompared` be true.
 * `readyToTighten` stays false forever on this knife. Legacy snapshots are
 * strings — not Paths; painted aliases are never elevated.
 */

import {
  evaluateShadowConformance,
  type ShadowConformanceReport,
} from "../evaluator/shadow-report.js";
import { isConstitutionalShadowEnabled } from "../flags.js";
import {
  isLegalPathSelectEnabled,
  selectLegalPath,
  type DeclaredLegalPathId,
} from "../legal-path/select.js";
import {
  projectConstitutionalViewFromSources,
  type ConstitutionalLedgerView,
  type ConstitutionalSourceSnapshot,
} from "../read-model/ledger-view.js";
import {
  compareShadowToLegacy,
  isConstitutionalShadowCompareEnabled,
} from "./compare.js";

export const PHASE_D_RUNTIME_FACADE_SCOPE = "phase_d_runtime_facade_shadow_only" as const;

const NO_SIDE_EFFECTS = Object.freeze([]) as readonly [];
const EMPTY_PATH_IDS = Object.freeze([]) as readonly DeclaredLegalPathId[];

export type RuntimeFacadeShadowInput = {
  /** Already projected view. Ignored when the façade is off. */
  view?: ConstitutionalLedgerView;
  /**
   * Injected source rows. Projected only when the façade is on and `view`
   * is omitted. Ignored when off, including when the rows would not parse.
   */
  sources?: ConstitutionalSourceSnapshot;
};

export type RuntimeFacadeShadowOptions = {
  /** Explicit opt-in. Does not authorize enforce or execution. */
  shadow?: boolean;
  /**
   * Explicit opt-in for Knife1 Path select report bridge.
   * Only effective when shadow is also on. Does not authorize execution.
   */
  select?: boolean;
  /**
   * Explicit opt-in for P8c shadow↔legacy compare report.
   * Only effective when shadow is also on. Does not authorize Gate tighten.
   */
  compare?: boolean;
  /**
   * Caller-supplied env snapshot. This function does not read `process.env`.
   * `OPENBOT_CONSTITUTIONAL_SHADOW` truthy enables the report only.
   * `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` truthy enables select bridge
   * only when shadow is also on.
   * `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` truthy enables compare only
   * when shadow is also on.
   */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Forwarded to the evaluator only when shadow is on.
   * The evaluator records the request and still leaves enforce false.
   */
  enforce?: boolean;
  /**
   * Candidate Path id. When shadow∧select are both on, forwarded to
   * `selectLegalPath` for report-only selection. Otherwise discarded.
   */
  candidatePath?: string | null;
  /** Workflow word. Not a Path. Discarded (never selected as Path). */
  workflowRef?: string | null;
  /**
   * Legacy decision snapshot (string). Not a Path. Used only when COMPARE
   * is on for report-only shadow↔legacy compare.
   */
  legacyDecision?: string | null;
  /**
   * Legacy path-ref snapshot (string). Not a Path — never elevated to
   * selectedPath. Used only when COMPARE is on.
   */
  legacyPathRef?: string | null;
  /**
   * Optional explicit constitutional decision string for compare. When
   * omitted, the façade reuses `selectedPath` text if select bridge produced
   * one. Not a Path elevation of aliases.
   */
  constitutionalDecision?: string | null;
};

export type RuntimeFacadeShadowResult = {
  schemaVersion: 1;
  scope: typeof PHASE_D_RUNTIME_FACADE_SCOPE;
  mode: "inert" | "shadow";
  invoked: boolean;
  report: ShadowConformanceReport | null;
  /**
   * Non-null only when shadow∧select dual opt-in and candidate matches a
   * declared legal Path. Never implies executed or Gate tighten.
   */
  selectedPath: DeclaredLegalPathId | null;
  /**
   * True when a candidate or workflow word was supplied on an invoked call
   * and was not accepted as a selected Path (or select bridge was off).
   */
  candidatePathDiscarded: boolean;
  paintedAliasUsedAsPath: false;
  /**
   * True only when shadow∧select dual opt-in and Knife1 registry is
   * non-empty under the select flag. Not Gate permission.
   */
  legalPathSelectable: boolean;
  /**
   * Knife1 select diagnostics — non-inert only under shadow∧select.
   * When select bridge is off: false / empty / empty-string equivalents.
   */
  selectEnabled: boolean;
  effectiveLegalPathIds: readonly DeclaredLegalPathId[];
  candidatePresent: boolean;
  candidateAccepted: boolean;
  /** Mapped from `LegalPathSelectResult.message` under dual opt-in; else "". */
  selectMessage: string;
  /**
   * True only when SHADOW ∧ COMPARE ∧ both sides supply enough snapshots.
   * Report-only; never Gate tighten.
   */
  shadowCompared: boolean;
  /** Match boolean when compared; null when not compared. */
  compareMatch: boolean | null;
  legacyDecisionPresent: boolean;
  constitutionalDecisionPresent: boolean;
  /** Compare diagnostic message; empty when compare face is fully inert. */
  compareMessage: string;
  /** Always false. Compare / select / execute are not Gate permission. */
  readyToTighten: false;
  /** Always false. This knife is report-only; P8b execute is OUT. */
  executed: false;
  blocked: false;
  wroteLedger: false;
  sideEffects: readonly [];
  enforce: false;
  enforced: false;
  liveInvoke: false;
  fabricDefaultOn: false;
  mutated: false;
};

function shadowOptIn(options: RuntimeFacadeShadowOptions): boolean {
  return options.shadow === true || isConstitutionalShadowEnabled(options.env ?? {});
}

function selectOptIn(options: RuntimeFacadeShadowOptions): boolean {
  return options.select === true || isLegalPathSelectEnabled(options.env ?? {});
}

function compareOptIn(options: RuntimeFacadeShadowOptions): boolean {
  return options.compare === true || isConstitutionalShadowCompareEnabled(options.env ?? {});
}

function hasDiscardedCandidate(options: RuntimeFacadeShadowOptions): boolean {
  const candidate = options.candidatePath?.trim() ?? "";
  const workflow = options.workflowRef?.trim() ?? "";
  return candidate.length > 0 || workflow.length > 0;
}

function inertResult(): RuntimeFacadeShadowResult {
  return {
    schemaVersion: 1,
    scope: PHASE_D_RUNTIME_FACADE_SCOPE,
    mode: "inert",
    invoked: false,
    report: null,
    selectedPath: null,
    candidatePathDiscarded: false,
    paintedAliasUsedAsPath: false,
    legalPathSelectable: false,
    selectEnabled: false,
    effectiveLegalPathIds: EMPTY_PATH_IDS,
    candidatePresent: false,
    candidateAccepted: false,
    selectMessage: "",
    shadowCompared: false,
    compareMatch: null,
    legacyDecisionPresent: false,
    constitutionalDecisionPresent: false,
    compareMessage: "",
    readyToTighten: false,
    executed: false,
    blocked: false,
    wroteLedger: false,
    sideEffects: NO_SIDE_EFFECTS,
    enforce: false,
    enforced: false,
    liveInvoke: false,
    fabricDefaultOn: false,
    mutated: false,
  };
}

function resolveView(input: RuntimeFacadeShadowInput): ConstitutionalLedgerView {
  if (input.view) {
    return input.view;
  }
  return projectConstitutionalViewFromSources(input.sources ?? {});
}

function applyCompare(
  base: RuntimeFacadeShadowResult,
  options: RuntimeFacadeShadowOptions,
  selectedPath: DeclaredLegalPathId | null,
): RuntimeFacadeShadowResult {
  const constitutionalFromSelect = selectedPath ?? null;
  const constitutionalDecision =
    (options.constitutionalDecision?.trim() ?? "").length > 0
      ? options.constitutionalDecision
      : constitutionalFromSelect;

  const compared = compareShadowToLegacy(
    {
      legacyDecision: options.legacyDecision,
      legacyPathRef: options.legacyPathRef,
      constitutionalDecision,
    },
    {
      compare: options.compare,
      env: options.env,
      shadowEnabled: true,
    },
  );

  // When compare is fully off and no legacy/constitutional inputs were
  // supplied, keep the inert empty compareMessage face for backward
  // compatibility with pre-P8c callers.
  const compareWasRequested =
    compareOptIn(options) ||
    (options.legacyDecision?.trim() ?? "").length > 0 ||
    (options.legacyPathRef?.trim() ?? "").length > 0 ||
    (options.constitutionalDecision?.trim() ?? "").length > 0;

  if (!compareWasRequested && !compared.shadowCompared) {
    return base;
  }

  return {
    ...base,
    shadowCompared: compared.shadowCompared,
    compareMatch: compared.compareMatch,
    legacyDecisionPresent: compared.legacyDecisionPresent,
    constitutionalDecisionPresent: compared.constitutionalDecisionPresent,
    compareMessage: compared.compareMessage,
    readyToTighten: false,
  };
}

/**
 * Report-only shadow hook.
 * Does not enforce, block, write a ledger, or live-invoke.
 * Path selection is report-only under dual opt-in (shadow ∧ select);
 * `executed` stays false. Select diagnostics surface only under that
 * same dual opt-in. P8c compare surfaces only under SHADOW ∧ COMPARE
 * with enough snapshots; `readyToTighten` stays false.
 */
export function runRuntimeFacadeShadow(
  input: RuntimeFacadeShadowInput = {},
  options: RuntimeFacadeShadowOptions = {},
): RuntimeFacadeShadowResult {
  if (!shadowOptIn(options)) {
    return inertResult();
  }

  const view = resolveView(input);
  const before = JSON.stringify(view);
  const report = evaluateShadowConformance(view, { enforce: options.enforce });
  if (before !== JSON.stringify(view)) {
    throw new Error("runtime façade mutated its ledger view");
  }

  const bridgeSelect = selectOptIn(options);
  if (!bridgeSelect) {
    const shadowOnly: RuntimeFacadeShadowResult = {
      ...inertResult(),
      mode: "shadow",
      invoked: true,
      report,
      candidatePathDiscarded: hasDiscardedCandidate(options),
      // select diagnostics stay inert/empty when select bridge is off
    };
    return applyCompare(shadowOnly, options, null);
  }

  const selection = selectLegalPath(
    {
      candidatePath: options.candidatePath,
      workflowRef: options.workflowRef,
    },
    { select: true, env: options.env },
  );

  const workflowPresent = (options.workflowRef?.trim() ?? "").length > 0;
  const candidateDiscarded =
    workflowPresent || (selection.candidatePresent && !selection.candidateAccepted);

  const withSelect: RuntimeFacadeShadowResult = {
    ...inertResult(),
    mode: "shadow",
    invoked: true,
    report,
    selectedPath: selection.selectedPath,
    candidatePathDiscarded: candidateDiscarded,
    legalPathSelectable: selection.legalPathSelectable,
    selectEnabled: selection.selectEnabled,
    effectiveLegalPathIds: selection.effectiveLegalPathIds,
    candidatePresent: selection.candidatePresent,
    candidateAccepted: selection.candidateAccepted,
    selectMessage: selection.message,
    // executed remains false from inertResult
  };
  return applyCompare(withSelect, options, selection.selectedPath);
}

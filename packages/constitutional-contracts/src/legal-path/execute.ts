/**
 * Phase D P8b — bounded execute opt-in (package-local stub).
 *
 * Scope: `phase_d_p8b_execute_opt_in`.
 * Start-order: `phase_d_p8b_execute_opt_in_start_order`.
 *
 * Reuses Knife1 `selectLegalPath` for selection. `executed` becomes true only
 * when selection succeeded (non-null selectedPath) AND the independent
 * default-off EXECUTE flag (or explicit `execute: true`) is on.
 * Package-local stub only: no gateway/tenant writes, no hot-path wiring.
 * Does not mutate the registry; registry `executionAuthorized` stays false
 * (Knife1 historical). Execution is gated by this API's EXECUTE flag.
 */

import {
  PHASE_D_P8B_KNIFE1_SCOPE,
  selectLegalPath,
  type DeclaredLegalPathId,
  type LegalPathSelectOptions,
  type LegalPathSelectResult,
  type LegalPathSelectionInput,
} from "./select.js";

/**
 * Independent rollback / execute switch. Unset keeps execution off.
 * Turning it on does not enforce, live-invoke, open Fabric, or tighten Gate.
 * This module never reads the variable from `process.env` by itself.
 */
export const LEGAL_PATH_EXECUTE_ENV = "OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE" as const;

export const PHASE_D_P8B_EXECUTE_OPT_IN_SCOPE = "phase_d_p8b_execute_opt_in" as const;

/** Package-local audit marker when execute stub runs. Never a gateway/tenant write. */
export const PACKAGE_LOCAL_EXECUTE_ALLOWED = "package-local-execute-allowed" as const;

const EXECUTE_TRUTHY = new Set(["1", "true", "yes", "on"]);
const NO_SIDE_EFFECTS = Object.freeze([]) as readonly [];
const EXECUTED_SIDE_EFFECTS = Object.freeze([PACKAGE_LOCAL_EXECUTE_ALLOWED]) as readonly [
  typeof PACKAGE_LOCAL_EXECUTE_ALLOWED,
];

export type LegalPathExecuteOptions = LegalPathSelectOptions & {
  /**
   * Explicit opt-in for package-local execute stub. Default false.
   * Does not authorize Gate tighten, live invoke, Fabric-on, or hot-path.
   */
  execute?: boolean;
};

export type LegalPathExecuteResult = {
  schemaVersion: 1;
  scope: typeof PHASE_D_P8B_EXECUTE_OPT_IN_SCOPE;
  selectScope: typeof PHASE_D_P8B_KNIFE1_SCOPE;
  mode: "inert" | "select_only" | "execute_opt_in";
  /** Selection face from Knife1 (pass-through). */
  select: LegalPathSelectResult;
  /** True when EXECUTE flag (or execute: true) is on. */
  executeEnabled: boolean;
  /**
   * True ONLY when selectedPath is non-null AND executeEnabled.
   * Otherwise always false.
   */
  executed: boolean;
  /**
   * Empty when not executed; otherwise a single package-local audit marker.
   * Never writes gateway/tenant data.
   */
  sideEffects: readonly [] | readonly [typeof PACKAGE_LOCAL_EXECUTE_ALLOWED];
  selectedPath: DeclaredLegalPathId | null;
  /** Always false. Execute opt-in is not C5 pass. */
  c5Pass: false;
  /** Always false. Selection+execute stub is not permission to tighten. */
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

export function isLegalPathExecuteEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[LEGAL_PATH_EXECUTE_ENV]?.trim().toLowerCase();
  return raw !== undefined && EXECUTE_TRUTHY.has(raw);
}

function assertUnmutated(before: string, input: LegalPathSelectionInput): void {
  if (before !== JSON.stringify(input)) {
    throw new Error("legal-path execute mutated its input");
  }
}

/**
 * Package-local execute stub over Knife1 select.
 * Does not execute on hot-path, tighten Gate, write gateway/tenant data,
 * or expand the legal-path registry.
 */
export function executeLegalPath(
  input: LegalPathSelectionInput,
  options: LegalPathExecuteOptions = {},
): LegalPathExecuteResult {
  const before = JSON.stringify(input);
  const selectOptions: LegalPathSelectOptions = {
    select: options.select,
    env: options.env,
  };
  const select = selectLegalPath(input, selectOptions);
  const executeEnabled = options.execute === true || isLegalPathExecuteEnabled(options.env ?? {});
  const selectedPath = select.selectedPath;
  const executed = selectedPath !== null && executeEnabled;
  assertUnmutated(before, input);

  let mode: LegalPathExecuteResult["mode"];
  if (!select.selectEnabled) {
    mode = "inert";
  } else if (!executed) {
    mode = "select_only";
  } else {
    mode = "execute_opt_in";
  }

  let message: string;
  if (!select.selectEnabled) {
    message = "legal-path execute is default-off; select also off — inert; nothing executed";
  } else if (selectedPath === null) {
    message = executeEnabled
      ? "EXECUTE on but no selection; nothing executed"
      : "select enabled but no selection; EXECUTE off — nothing executed";
  } else if (!executeEnabled) {
    message = "candidate selected; EXECUTE default-off — selected without package-local execute";
  } else {
    message =
      "selectedPath non-null and EXECUTE on — package-local execute stub allowed (no gateway/tenant write)";
  }

  return {
    schemaVersion: 1,
    scope: PHASE_D_P8B_EXECUTE_OPT_IN_SCOPE,
    selectScope: PHASE_D_P8B_KNIFE1_SCOPE,
    mode,
    select,
    executeEnabled,
    executed,
    sideEffects: executed ? EXECUTED_SIDE_EFFECTS : NO_SIDE_EFFECTS,
    selectedPath,
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

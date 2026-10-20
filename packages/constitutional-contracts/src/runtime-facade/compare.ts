/**
 * Phase D P8c — bounded shadow↔legacy compare report (package-local).
 *
 * Scope: `phase_d_p8c_shadow_legacy_compare`.
 * Start-order: `phase_d_p8c_shadow_legacy_compare_start_order`.
 *
 * Report-only. `shadowCompared` becomes true only when SHADOW is on AND
 * COMPARE is on AND both sides supply enough string snapshots to compare.
 * Does not tighten Gate, expand `executed`, paint aliases as Path, read
 * `process.env`, or wire gateway/ACP/AOR hot paths. `readyToTighten` is
 * always false.
 */

/**
 * Independent rollback / compare switch. Unset keeps compare off.
 * Turning it on does not enforce, live-invoke, open Fabric, or tighten Gate.
 * This module never reads the variable from `process.env` by itself.
 */
export const SHADOW_COMPARE_ENV = "OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE" as const;

export const PHASE_D_P8C_SHADOW_LEGACY_COMPARE_SCOPE =
  "phase_d_p8c_shadow_legacy_compare" as const;

const COMPARE_TRUTHY = new Set(["1", "true", "yes", "on"]);

export type ShadowLegacyCompareInput = {
  /**
   * Caller-supplied legacy decision snapshot (string). Not a Path.
   * Either this or `legacyPathRef` may establish legacy presence.
   */
  legacyDecision?: string | null;
  /**
   * Caller-supplied legacy path-ref snapshot (string). Not a Path —
   * painted aliases must not be elevated. Used only for report compare.
   */
  legacyPathRef?: string | null;
  /**
   * Constitutional decision string for compare (e.g. selectedPath text or
   * an explicit caller snapshot). Not a Path elevation of aliases.
   */
  constitutionalDecision?: string | null;
};

export type ShadowLegacyCompareOptions = {
  /**
   * Explicit opt-in for shadow↔legacy compare. Default false.
   * Does not authorize Gate tighten, live invoke, Fabric-on, or hot-path.
   */
  compare?: boolean;
  /**
   * Caller-supplied env snapshot. This function does not read `process.env`.
   * `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` truthy enables compare only
   * when shadow is also on (enforced by the caller façade).
   */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Must be true (shadow already opted in) before compare can fire.
   * The compare helper itself does not re-check the shadow env flag.
   */
  shadowEnabled: boolean;
};

export type ShadowLegacyCompareResult = {
  schemaVersion: 1;
  scope: typeof PHASE_D_P8C_SHADOW_LEGACY_COMPARE_SCOPE;
  /** True when SHADOW ∧ COMPARE ∧ both sides present enough to compare. */
  shadowCompared: boolean;
  /** Match boolean when compared; null when not compared / not comparable. */
  compareMatch: boolean | null;
  legacyDecisionPresent: boolean;
  constitutionalDecisionPresent: boolean;
  compareMessage: string;
  /** Always false. Compare report is not Gate permission. */
  readyToTighten: false;
  paintedAliasUsedAsPath: false;
};

export function isConstitutionalShadowCompareEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[SHADOW_COMPARE_ENV]?.trim().toLowerCase();
  return raw !== undefined && COMPARE_TRUTHY.has(raw);
}

function present(value: string | null | undefined): boolean {
  return (value?.trim() ?? "").length > 0;
}

function normalize(value: string | null | undefined): string {
  return (value?.trim() ?? "").toLowerCase();
}

/**
 * Prefer explicit `legacyDecision`; otherwise fall back to `legacyPathRef`.
 * Both remain plain strings — neither is a Path.
 */
function legacySnapshot(input: ShadowLegacyCompareInput): string {
  if (present(input.legacyDecision)) {
    return input.legacyDecision!.trim();
  }
  if (present(input.legacyPathRef)) {
    return input.legacyPathRef!.trim();
  }
  return "";
}

/**
 * Package-local shadow↔legacy compare report.
 * Does not read `process.env`, tighten Gate, execute, or elevate aliases.
 */
export function compareShadowToLegacy(
  input: ShadowLegacyCompareInput,
  options: ShadowLegacyCompareOptions,
): ShadowLegacyCompareResult {
  const compareEnabled =
    options.compare === true || isConstitutionalShadowCompareEnabled(options.env ?? {});
  const legacyDecisionPresent =
    present(input.legacyDecision) || present(input.legacyPathRef);
  const constitutionalDecisionPresent = present(input.constitutionalDecision);
  const base = {
    schemaVersion: 1 as const,
    scope: PHASE_D_P8C_SHADOW_LEGACY_COMPARE_SCOPE,
    legacyDecisionPresent,
    constitutionalDecisionPresent,
    readyToTighten: false as const,
    paintedAliasUsedAsPath: false as const,
  };

  if (!options.shadowEnabled) {
    return {
      ...base,
      shadowCompared: false,
      compareMatch: null,
      compareMessage:
        "shadow off — compare inert; shadowCompared stays false (P8c report-only)",
    };
  }

  if (!compareEnabled) {
    return {
      ...base,
      shadowCompared: false,
      compareMatch: null,
      compareMessage:
        "COMPARE default-off — shadowCompared stays false; readyToTighten stays false",
    };
  }

  if (!legacyDecisionPresent || !constitutionalDecisionPresent) {
    return {
      ...base,
      shadowCompared: false,
      compareMatch: null,
      compareMessage:
        "COMPARE on but insufficient snapshots on one or both sides — shadowCompared stays false",
    };
  }

  const legacy = legacySnapshot(input);
  const constitutional = input.constitutionalDecision!.trim();
  const compareMatch = normalize(legacy) === normalize(constitutional);

  return {
    ...base,
    shadowCompared: true,
    compareMatch,
    compareMessage: compareMatch
      ? "shadow↔legacy compared — match (report-only; not Gate tighten; readyToTighten false)"
      : "shadow↔legacy compared — mismatch (report-only; not Gate tighten; readyToTighten false)",
  };
}

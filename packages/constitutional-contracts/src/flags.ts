/**
 * Phase D §9.1 kill switches.
 *
 * This package is inert unless a caller imports it. Nothing in gateway chat,
 * tool invoke, ACP, or AOR reads these flags. Enforce stays off. The shadow
 * env flag is read only by the runtime façade, and only from a caller-passed
 * snapshot — that module does not read `process.env`.
 */

export const CONSTITUTIONAL_CONTRACTS_PACKAGE = "0.1.0";

/** Written user scope that authorized this bounded first knife. */
export const PHASE_D_FIRST_KNIFE_SCOPE = "phase_d_first_knife_contracts" as const;

/** Observation flag. Unset or any other value keeps the shadow hook off. */
export const CONSTITUTIONAL_SHADOW_ENV = "OPENBOT_CONSTITUTIONAL_SHADOW";

export const CONSTITUTIONAL_CONTRACTS_ENFORCE = false as const;
export const CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE = false as const;
export const CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON = false as const;

/** Terminology frozen in discovery ADRs. Adapters must not collapse these. */
export const NON_EQUIVALENCE = {
  workflowIsNotPath: true,
  receiptIsNotProof: true,
  pluginInstalledIsNotCapabilityAuthorized: true,
} as const;

const SHADOW_TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Default is off. Passing an empty env, or omitting the variable, returns false.
 * A true result does not enable enforce, live invoke, or Fabric.
 */
export function isConstitutionalShadowEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[CONSTITUTIONAL_SHADOW_ENV]?.trim().toLowerCase();
  return raw !== undefined && SHADOW_TRUTHY.has(raw);
}

/**
 * Constitutional runtime shadow gate (Checkpoint C first slice).
 *
 * Pure helpers only. This module never reads the process environment and
 * never receives an environment object: the outer runner hands the parser the
 * one raw flag string once per run and discards it, and attempts only ever see
 * the parsed boolean. It knows no other flag (legal-path select or execute,
 * path-gap report, orchestration, conversation-task, or the Constitutional
 * contracts shadow flag).
 */

/** Truthy tokens after trim + lowercase. Everything else, including unset, is off. */
const TRUTHY_TOKENS: readonly string[] = Object.freeze(["1", "true", "yes", "on"]);

/** Parse one raw flag value. Default off; only `1` / `true` / `yes` / `on` enable. */
export function parseConstitutionalRuntimeShadowFlag(raw: string | undefined): boolean {
  if (typeof raw !== "string") {
    return false;
  }
  return TRUTHY_TOKENS.includes(raw.trim().toLowerCase());
}

/**
 * The one gate check at the call site. Receives `deps.runtimeShadowEnabled`
 * (already parsed by `parseConstitutionalRuntimeShadowFlag`) and nothing else.
 */
export function isConstitutionalRuntimeShadowEnabled(runtimeShadowEnabled: boolean): boolean {
  return runtimeShadowEnabled;
}

/**
 * Exit status for test runner / scheduler child processes.
 *
 * A crash, a signal death (OOM is SIGKILL / SIGABRT), or a missing status is a
 * failure. Callers must not coerce those to 0.
 */

/**
 * @param {number | null | undefined} code
 * @param {string | null | undefined} signal
 * @returns {number}
 */
export function normalizeChildExit(code, signal) {
  if (typeof signal === "string" && signal.length > 0) {
    return 1;
  }
  if (typeof code !== "number" || !Number.isInteger(code)) {
    return 1;
  }
  return code;
}

/**
 * Default vitest shard count. CI splits unit runs so one process does not
 * hold the whole suite (Linux CI has OOM'd near a 4GB heap). An explicit
 * OPENBOT_TEST_SHARDS value greater than 1 wins. Local runs stay unsharded.
 *
 * @param {{ isCI: boolean, override: number | null }} params
 * @returns {number}
 */
export function resolveDefaultShardCount(params) {
  const override = params.override;
  if (typeof override === "number" && Number.isFinite(override) && override > 1) {
    return override;
  }
  return params.isCI ? 4 : 1;
}

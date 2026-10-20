/**
 * Constitutional runtime shadow observation (Checkpoint C first slice).
 *
 * The call site runs this only after `isConstitutionalRuntimeShadowEnabled`
 * returned true, and only after the preflight result and the filtered tool
 * set exist. Fully synchronous and total: projection, the report-only façade
 * and the record build run inside one try. Any throw there (including the
 * clock) is reported once as `observe_error` through `safeRecordError`; a
 * successful record goes through `safeRecord`. Returns void, so no caller can
 * read an observation result, and never mutates its inputs. No deferred work,
 * timers, network, disk or environment access.
 */
import { observePreflightRuntimeFacade } from "./constitutional-runtime-facade.js";
import type { ConstitutionalRuntimeShadowDeps } from "./constitutional-runtime-shadow-deps.js";
import {
  latencyBucket,
  minimizeShadowRecord,
  projectPreflightShadowObservation,
} from "./constitutional-runtime-shadow-projection.js";
import {
  safeRecord,
  safeRecordError,
  type ConstitutionalRuntimeShadowRecord,
} from "./constitutional-runtime-shadow-sink.js";
import type { ExecutionPreflight } from "./types.js";

export function observeConstitutionalRuntimeShadow(
  deps: ConstitutionalRuntimeShadowDeps,
  executionPreflight: ExecutionPreflight,
): void {
  let record: ConstitutionalRuntimeShadowRecord;
  try {
    const startedAt = deps.now();
    const projection = projectPreflightShadowObservation(executionPreflight);
    const result = observePreflightRuntimeFacade({ ...projection, shadow: true });
    record = minimizeShadowRecord(result, latencyBucket(deps.now() - startedAt));
  } catch {
    // Projection, façade, clock or record-build throw: report once and return.
    safeRecordError(deps.sink, "observe_error");
    return;
  }
  // A sink.record throw is swallowed inside safeRecord and never calls recordError.
  safeRecord(deps.sink, record);
}

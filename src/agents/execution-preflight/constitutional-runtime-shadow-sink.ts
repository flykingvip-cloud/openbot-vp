/**
 * Constitutional runtime shadow sink contract (Checkpoint C first slice):
 * the sink, record and error-code types, the production no-op sink, and the
 * only two ways shadow code may call a sink.
 *
 * `safeRecord` / `safeRecordError` each swallow their own throw and report
 * nothing further: a failed `record` never triggers `recordError`, and no
 * failure path falls back to console output, JSONL, OTel, files, the network,
 * receipts, traces or a ledger. Tests and dev tooling inject their own sink
 * explicitly; nothing here is selected by the environment.
 */
import type {
  ConstitutionalRuntimeShadowCapabilityCategory,
  ConstitutionalRuntimeShadowDecisionStage,
  ConstitutionalRuntimeShadowLatencyBucket,
  ConstitutionalRuntimeShadowMode,
  ConstitutionalRuntimeShadowProfileCategory,
  ConstitutionalRuntimeShadowReasonCode,
} from "./constitutional-runtime-shadow-projection.js";

/** The only sink error code in the first slice. */
export type ConstitutionalRuntimeShadowErrorCode = "observe_error";

/**
 * Everything a sink can ever receive besides the error code: closed codes,
 * booleans, the fixed categories and a bounded latency bucket. Built only by
 * `minimizeShadowRecord` in the projection module.
 */
export type ConstitutionalRuntimeShadowRecord = Readonly<{
  mode: ConstitutionalRuntimeShadowMode;
  decisionStage: ConstitutionalRuntimeShadowDecisionStage;
  reasonCode: ConstitutionalRuntimeShadowReasonCode;
  invoked: boolean;
  blocked: boolean;
  executed: boolean;
  wroteReceipt: boolean;
  wroteTrace: boolean;
  flagOn: boolean;
  pathExists: boolean;
  gapExists: boolean;
  profileCategory: ConstitutionalRuntimeShadowProfileCategory;
  capabilityCategory: ConstitutionalRuntimeShadowCapabilityCategory;
  latencyBucket: ConstitutionalRuntimeShadowLatencyBucket;
}>;

export type ConstitutionalRuntimeShadowSink = {
  record(value: ConstitutionalRuntimeShadowRecord): void;
  recordError(code: ConstitutionalRuntimeShadowErrorCode): void;
};

/**
 * Production default: immutable, shared and synchronous. The outer runner
 * reuses this constant; that is not attempt-level or request-level sink
 * creation.
 */
export const NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK: ConstitutionalRuntimeShadowSink =
  Object.freeze({
    record() {},
    recordError() {},
  });

export function safeRecord(
  sink: ConstitutionalRuntimeShadowSink,
  value: ConstitutionalRuntimeShadowRecord,
): void {
  try {
    sink.record(value);
  } catch {
    // Intentionally swallowed. No secondary reporting from this path, and
    // never a recordError call (no recursion).
  }
}

export function safeRecordError(
  sink: ConstitutionalRuntimeShadowSink,
  code: ConstitutionalRuntimeShadowErrorCode,
): void {
  try {
    sink.recordError(code);
  } catch {
    // Intentionally swallowed. Never rethrown into the business path.
  }
}

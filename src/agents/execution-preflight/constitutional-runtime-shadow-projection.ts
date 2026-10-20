/**
 * Whitelist projection and record builder for the Constitutional runtime
 * shadow observation (Checkpoint C first slice).
 *
 * Only fixed enums, fixed reason codes, booleans, the fixed profile and
 * capability categories and a bounded latency bucket may cross into the
 * façade call or a sink. Every output is a new frozen object built from those
 * values; no input value is passed through, and there is no "redact later"
 * path.
 *
 * First slice: the projection reads no preflight field. Every façade input the
 * preflight could feed (receipt or trace rows, an environment snapshot,
 * candidatePath, workflowRef) would carry identifiers, paths or dynamic
 * strings, so the façade call is narrowed to the shadow opt-in plus the fixed
 * values below (data-minimization contract §6, option 2). `profileCategory` is
 * the literal "unspecified": it is never derived from any input, and no
 * Profile A/B value is resolved or synthesized.
 */
import type { PreflightRuntimeFacadeResult } from "./constitutional-runtime-facade.js";
import type { ConstitutionalRuntimeShadowRecord } from "./constitutional-runtime-shadow-sink.js";
import type { ExecutionPreflight } from "./types.js";

/** Closed code enum: façade result mode. */
export const CONSTITUTIONAL_RUNTIME_SHADOW_MODES = Object.freeze(["inert", "shadow"] as const);

/** Closed code enum: the observation is always taken at the preflight decision stage. */
export const CONSTITUTIONAL_RUNTIME_SHADOW_DECISION_STAGES = Object.freeze(["preflight"] as const);

/** Exact closed reason-code set. */
export const CONSTITUTIONAL_RUNTIME_SHADOW_REASON_CODES = Object.freeze([
  "none",
  "flag_off",
  "shadow_inert",
  "observe_error",
  "gate_skipped",
] as const);

/** First slice: exactly one profile category. */
export const CONSTITUTIONAL_RUNTIME_SHADOW_PROFILE_CATEGORIES = Object.freeze([
  "unspecified",
] as const);

/** Closed capability category enum. First slice: one fixed value, never derived from input. */
export const CONSTITUTIONAL_RUNTIME_SHADOW_CAPABILITY_CATEGORIES = Object.freeze([
  "unspecified",
] as const);

/** Bounded latency buckets: no raw millisecond value crosses the boundary. */
export const CONSTITUTIONAL_RUNTIME_SHADOW_LATENCY_BUCKETS = Object.freeze([
  "le_1ms",
  "le_2ms",
  "le_5ms",
  "gt_5ms",
] as const);

export type ConstitutionalRuntimeShadowMode = (typeof CONSTITUTIONAL_RUNTIME_SHADOW_MODES)[number];
export type ConstitutionalRuntimeShadowDecisionStage =
  (typeof CONSTITUTIONAL_RUNTIME_SHADOW_DECISION_STAGES)[number];
export type ConstitutionalRuntimeShadowReasonCode =
  (typeof CONSTITUTIONAL_RUNTIME_SHADOW_REASON_CODES)[number];
export type ConstitutionalRuntimeShadowProfileCategory =
  (typeof CONSTITUTIONAL_RUNTIME_SHADOW_PROFILE_CATEGORIES)[number];
export type ConstitutionalRuntimeShadowCapabilityCategory =
  (typeof CONSTITUTIONAL_RUNTIME_SHADOW_CAPABILITY_CATEGORIES)[number];
export type ConstitutionalRuntimeShadowLatencyBucket =
  (typeof CONSTITUTIONAL_RUNTIME_SHADOW_LATENCY_BUCKETS)[number];

/** Whitelist projection of the preflight; spread into the façade call. */
export type PreflightShadowObservation = Readonly<{
  decisionStage: ConstitutionalRuntimeShadowDecisionStage;
  capabilityCategory: ConstitutionalRuntimeShadowCapabilityCategory;
  profileCategory: ConstitutionalRuntimeShadowProfileCategory;
}>;

/** Exact key allow-lists, asserted by unit tests. */
export const PREFLIGHT_SHADOW_OBSERVATION_KEYS = Object.freeze([
  "decisionStage",
  "capabilityCategory",
  "profileCategory",
] as const satisfies readonly (keyof PreflightShadowObservation)[]);

export const CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS = Object.freeze([
  "mode",
  "decisionStage",
  "reasonCode",
  "invoked",
  "blocked",
  "executed",
  "wroteReceipt",
  "wroteTrace",
  "flagOn",
  "pathExists",
  "gapExists",
  "profileCategory",
  "capabilityCategory",
  "latencyBucket",
] as const satisfies readonly (keyof ConstitutionalRuntimeShadowRecord)[]);

/** Strict boolean read: only the boolean `true` counts, so no other value type crosses. */
function isTrue(value: unknown): boolean {
  return value === true;
}

/**
 * Build the whitelist projection. Reads no preflight field in the first slice
 * (see the module comment); the parameter keeps the designed call shape.
 */
export function projectPreflightShadowObservation(
  _executionPreflight: ExecutionPreflight,
): PreflightShadowObservation {
  return Object.freeze({
    decisionStage: "preflight",
    capabilityCategory: "unspecified",
    profileCategory: "unspecified",
  });
}

/** Map a local elapsed time to a bounded bucket. A non-number (NaN) lands in `gt_5ms`. */
export function latencyBucket(elapsedMs: number): ConstitutionalRuntimeShadowLatencyBucket {
  if (elapsedMs <= 1) {
    return "le_1ms";
  }
  if (elapsedMs <= 2) {
    return "le_2ms";
  }
  if (elapsedMs <= 5) {
    return "le_5ms";
  }
  return "gt_5ms";
}

/**
 * Build the sink record from the façade result: booleans and closed codes
 * only. No string, id, finding text, path or report body from the result is
 * copied.
 */
export function minimizeShadowRecord(
  result: PreflightRuntimeFacadeResult,
  bucket: ConstitutionalRuntimeShadowLatencyBucket,
): ConstitutionalRuntimeShadowRecord {
  const invoked = isTrue(result.invoked);
  const safeBucket: ConstitutionalRuntimeShadowLatencyBucket =
    CONSTITUTIONAL_RUNTIME_SHADOW_LATENCY_BUCKETS.includes(bucket) ? bucket : "gt_5ms";
  return Object.freeze({
    mode: result.mode === "shadow" ? "shadow" : "inert",
    decisionStage: "preflight",
    reasonCode: invoked ? "none" : "shadow_inert",
    invoked,
    blocked: isTrue(result.blocked),
    executed: isTrue(result.executed),
    wroteReceipt: isTrue(result.wroteReceipt),
    wroteTrace: isTrue(result.wroteTrace),
    // A record is only built after the call-site gate was on.
    flagOn: true,
    // Presence only: a selected legal Path id is never copied. Stays false
    // while the select bridge is closed (the façade call never opts in).
    pathExists: typeof result.selectedPath === "string",
    // The first slice runs no path-gap report, so no gap can be named.
    gapExists: false,
    profileCategory: "unspecified",
    capabilityCategory: "unspecified",
    latencyBucket: safeBucket,
  });
}

/**
 * P1-A5 — shared capability-lane switch + policy_lane_divergence sink
 * (Floor Runtime v2.1 §5.5).
 *
 * Every lane sub-PR (④ context → ⑤ presentation → ① participation → ② dispatch → ③ governance) reads its flag
 * `collaboration.lane.<lane>` = legacy | shadow | effective (default unset = legacy)
 * and, in shadow, records `policy_lane_divergence{lane, field, legacyValue,
 * effectiveValue, key}` into this single in-process sink.
 *
 * Extracted from policy-lane-context.ts (P1-A5 ④) when lane ⑤ landed so both lanes
 * share one sink; policy-lane-context.ts re-exports the same symbols.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";

export type PolicyLaneMode = "legacy" | "shadow" | "effective";

/** Lanes that have a live flag today (grows lane by lane in P1-A5). */
export type PolicyLaneId = "context" | "presentation" | "participation" | "dispatch" | "governance";

export type PolicyLaneDivergence = Readonly<{
  lane: PolicyLaneId;
  field: string;
  legacyValue: unknown;
  effectiveValue: unknown;
  /** Optional CollaborationEventKey when the caller has one. */
  key?: CollaborationEventKey | null;
  atMs: number;
}>;

const DIVERGENCE_SINK: PolicyLaneDivergence[] = [];
const DIVERGENCE_SINK_MAX = 256;

/** Plan flag `collab.lane.<lane>` → config `collaboration.lane.<lane>` (default legacy). */
export function resolvePolicyLaneMode(lane: PolicyLaneId, cfg?: OpenBotConfig): PolicyLaneMode {
  const raw = (cfg ?? loadConfig()).collaboration?.lane?.[lane];
  if (raw === "shadow" || raw === "effective" || raw === "legacy") {
    return raw;
  }
  return "legacy";
}

export function recordPolicyLaneDivergence(
  entry: Omit<PolicyLaneDivergence, "atMs"> & { atMs?: number },
): PolicyLaneDivergence {
  const full: PolicyLaneDivergence = Object.freeze({
    lane: entry.lane,
    field: entry.field,
    legacyValue: entry.legacyValue,
    effectiveValue: entry.effectiveValue,
    ...(entry.key !== undefined ? { key: entry.key } : {}),
    atMs: entry.atMs ?? Date.now(),
  });
  DIVERGENCE_SINK.push(full);
  if (DIVERGENCE_SINK.length > DIVERGENCE_SINK_MAX) {
    DIVERGENCE_SINK.splice(0, DIVERGENCE_SINK.length - DIVERGENCE_SINK_MAX);
  }
  return full;
}

export function peekPolicyLaneDivergences(): readonly PolicyLaneDivergence[] {
  return DIVERGENCE_SINK.slice();
}

export function drainPolicyLaneDivergences(): PolicyLaneDivergence[] {
  return DIVERGENCE_SINK.splice(0, DIVERGENCE_SINK.length);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Shadow comparison: legacy mode records nothing; shadow/effective record when the
 * two values differ (JSON equality) and push onto `out` as well as the sink.
 */
export function maybeRecordLaneDivergence(params: {
  lane: PolicyLaneId;
  mode: PolicyLaneMode;
  field: string;
  legacyValue: unknown;
  effectiveValue: unknown;
  key?: CollaborationEventKey | null;
  out: PolicyLaneDivergence[];
}): void {
  if (params.mode === "legacy") {
    return;
  }
  if (sameJson(params.legacyValue, params.effectiveValue)) {
    return;
  }
  params.out.push(
    recordPolicyLaneDivergence({
      lane: params.lane,
      field: params.field,
      legacyValue: params.legacyValue,
      effectiveValue: params.effectiveValue,
      ...(params.key !== undefined ? { key: params.key } : {}),
    }),
  );
}

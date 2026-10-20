/**
 * policy-map.ts — equivalence mapping between the legacy OpenBot audit model
 * and Loom's generic, repo-agnostic landing policies.
 *
 * Used by `loom import` (one-time migration) and by parity tests. See design
 * §3.3 "等价映射". Keeping the mapping in one place guarantees import and the
 * parity checker agree.
 */

import type { LandingPolicy } from "./registry.js";

/** Legacy `worktree-audit.ts` rule disposition. */
export type LegacyDisposition = "MERGE" | "ISOLATE" | "CLEAN";

/**
 * disposition → landingPolicy.
 * - MERGE   → serial    (a coherent stream that lands in order)
 * - ISOLATE → exclusive (must not mix with other streams)
 * - CLEAN   → manual    (generated/baseline; land only in explicit baseline commits)
 *
 * The legacy guardrails group ("D") is special-cased to `parallel` by the
 * importer (it may accompany one primary stream), independent of its MERGE
 * disposition — see GUARDRAILS_GROUP below.
 */
export const DISPOSITION_TO_POLICY: Record<LegacyDisposition, LandingPolicy> = {
  MERGE: "serial",
  ISOLATE: "exclusive",
  CLEAN: "manual",
};

/** Legacy guardrails group id; mapped to `parallel` (may accompany one stream). */
export const GUARDRAILS_GROUP = "D";

/** Map a legacy rule (group + disposition) to a Loom landing policy. */
export function policyForLegacyRule(group: string, disposition: LegacyDisposition): LandingPolicy {
  if (group === GUARDRAILS_GROUP) {
    return "parallel";
  }
  return DISPOSITION_TO_POLICY[disposition];
}

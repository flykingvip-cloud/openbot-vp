/**
 * feedback.ts — execution feedback SIGNALS (R19) — interface + data only.
 *
 * v1 scope: derive *suggestions* from execution records (failure patterns,
 * constraint-tightening proposals). It NEVER auto-applies or auto-mutates any
 * policy or constraint (R19.2) — every signal is a proposal that a human must
 * accept (inherits Loom's suggest→accept rule). Closed-loop auto-learning is
 * deferred to v1.x/v2; this module only proves the data channel exists.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.7b.
 */

import type { FabricExecutionRecord } from "./audit.js";
import type { ExecutionConstraints } from "./contract.js";

/** A human-gated suggestion derived from execution history. */
export interface FeedbackSignal {
  kind: "failure-pattern" | "constraint-tightening";
  /** Human-readable rationale. */
  detail: string;
  /** Evidence: correlation ids of the records that produced this signal. */
  evidence: string[];
  /** For constraint-tightening: the PROPOSED (never applied) constraints. */
  proposedConstraints?: ExecutionConstraints;
  /** Always false in v1: signals are proposals, never auto-applied (R19.2). */
  readonly autoApplied: false;
}

/** Minimum repeated failures on the same tool to raise a failure-pattern signal. */
const FAILURE_PATTERN_THRESHOLD = 3;

/**
 * Derive feedback signals from execution records. Pure read-only analysis:
 * returns proposals only and SHALL NOT mutate any policy/constraint.
 */
export function deriveFeedback(records: readonly FabricExecutionRecord[]): FeedbackSignal[] {
  const signals: FeedbackSignal[] = [];

  // Failure-pattern: a tool that fails repeatedly is a candidate for tightening.
  const failuresByTool = new Map<string, string[]>();
  for (const r of records) {
    if (r.result.status === "failed") {
      const tool = r.what.tool.name;
      const list = failuresByTool.get(tool) ?? [];
      list.push(r.correlationId);
      failuresByTool.set(tool, list);
    }
  }
  for (const [tool, evidence] of failuresByTool) {
    if (evidence.length >= FAILURE_PATTERN_THRESHOLD) {
      signals.push({
        kind: "failure-pattern",
        detail: `tool "${tool}" failed ${evidence.length} times; review/tighten policy`,
        evidence,
        proposedConstraints: { sandboxMode: "strict" },
        autoApplied: false,
      });
    }
  }

  return signals;
}

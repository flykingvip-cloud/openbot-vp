/**
 * decision-trace.ts — Policy Explainability Graph builder (R16).
 *
 * decisionTrace is an ORDERED list of evaluation-stage outcomes that is bound to
 * a PolicyDecision (R21.6), not to ExecutionGraphState. Each entry records which
 * stage was evaluated, whether it "hit", a human-readable detail (never a
 * credential — R16.4), and the effect that stage contributed to the decision.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.7.
 */

import type { DecisionTrace, DecisionTraceEntry } from "./contract.js";

type Stage = DecisionTraceEntry["stage"];
type Effect = DecisionTraceEntry["effect"];

/** Mutable, ordered builder for a PolicyDecision's explainability graph. */
export class DecisionTraceBuilder {
  private readonly entries: DecisionTraceEntry[] = [];

  /** Append a raw entry (already shaped). */
  add(entry: DecisionTraceEntry): this {
    this.entries.push(entry);
    return this;
  }

  /** Append a stage outcome. `effect` defaults to neutral (informational). */
  stage(stage: Stage, hit: boolean, opts: { detail?: string; effect?: Effect } = {}): this {
    this.entries.push({
      stage,
      hit,
      detail: opts.detail,
      effect: opts.effect ?? "neutral",
    });
    return this;
  }

  /** Whether any recorded stage drove a deny. */
  hasDeny(): boolean {
    return this.entries.some((e) => e.effect === "deny");
  }

  /** Whether any recorded stage drove a modify (tightening). */
  hasModify(): boolean {
    return this.entries.some((e) => e.effect === "modify");
  }

  /** Snapshot the ordered trace (copy; builder stays mutable). */
  build(): DecisionTrace {
    return this.entries.map((e) => ({ ...e }));
  }
}

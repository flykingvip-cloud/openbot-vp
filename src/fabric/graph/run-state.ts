/**
 * run-state.ts — ToolExecutionRun state machine (R15, Trace Layer).
 *
 * Records execution-phase transitions for a node. Pure metadata; reuses the
 * Loom lifecycle pattern (explicit transitions, illegal moves rejected). Every
 * transition is observable so it can flow into audit/streaming (R15.5).
 *
 * Phases (R15.1): validated → scheduled → executing → streaming → finalized
 *                                    └────────────→ failed
 * (`compensating` is reserved in the contract for later phases; not reachable in v1.)
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.5.
 */

import type { RunPhase, ToolExecutionRun } from "../contract.js";

/** Allowed phase transitions. `finalized` and `failed` are terminal. */
export const RUN_TRANSITIONS: Record<RunPhase, RunPhase[]> = {
  validated: ["scheduled", "failed"],
  scheduled: ["executing", "failed"],
  executing: ["streaming", "finalized", "failed"],
  streaming: ["finalized", "failed"],
  finalized: [],
  failed: [],
};

export function canTransition(from: RunPhase, to: RunPhase): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export class IllegalRunTransitionError extends Error {
  constructor(
    public readonly from: RunPhase,
    public readonly to: RunPhase,
  ) {
    const allowed = RUN_TRANSITIONS[from];
    const hint = allowed.length > 0 ? allowed.join(", ") : "(terminal — no transitions)";
    super(`Illegal run phase transition ${from} → ${to}. Allowed from ${from}: ${hint}.`);
    this.name = "IllegalRunTransitionError";
  }
}

/** An observable phase-change event (flows into audit/streaming). */
export interface RunTransitionEvent {
  runId: string;
  nodeId: string;
  from: RunPhase;
  to: RunPhase;
}

/**
 * Transition a run to a new phase. Returns the new run plus an observable event,
 * or throws on an illegal move. No-op (same phase) returns no event.
 */
export function transitionRun(
  run: ToolExecutionRun,
  to: RunPhase,
): { run: ToolExecutionRun; event?: RunTransitionEvent } {
  if (run.phase === to) {
    return { run };
  }
  if (!canTransition(run.phase, to)) {
    throw new IllegalRunTransitionError(run.phase, to);
  }
  return {
    run: { ...run, phase: to },
    event: { runId: run.id, nodeId: run.nodeId, from: run.phase, to },
  };
}

/** Whether a phase is terminal (no further transitions). */
export function isTerminal(phase: RunPhase): boolean {
  return RUN_TRANSITIONS[phase].length === 0;
}

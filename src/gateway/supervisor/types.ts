/**
 * supervisor/types.ts — Development Supervisor contracts (M1, Task 1.1).
 *
 * The supervised-task model: goal + explicit acceptance criteria + worker ref +
 * isolated workspace + state machine + bounded budget + iteration trace. Stored
 * in a runtime store (NOT `.loom/registry.yaml`).
 *
 * Design: `.kiro/specs/development-supervisor/design.md`.
 */

import type {
  CredentialPolicy,
  CredentialStatus,
  ExecutionPlacement,
  PlacementFallback,
} from "../../fabric/worker/types.js";

/** State machine (design §State Machine). Terminal: accepted/escalated/budget_exhausted/max_iterations/timed_out/aborted/failed. */
export type SupervisedTaskState =
  | "planned"
  | "dispatched"
  | "executing"
  | "validating"
  | "fixing"
  | "accepted"
  | "escalated"
  | "budget_exhausted"
  | "max_iterations"
  | "timed_out"
  | "aborted"
  | "failed";

const TERMINAL_STATES: ReadonlySet<SupervisedTaskState> = new Set([
  "accepted",
  "escalated",
  "budget_exhausted",
  "max_iterations",
  "timed_out",
  "aborted",
  "failed",
]);

export function isTerminalTaskState(state: SupervisedTaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** One machine-checkable validation step (== ValidationPlan step). */
export interface AcceptanceStep {
  id: string;
  /** Command argv run via Fabric in the task workspace. */
  argv: string[];
  /** required=true: its failure fails the whole report; false = informational. */
  required: boolean;
  /** Pass condition (default: exitCode === 0). */
  expect?: { exitCode?: number };
}

/** Explicit acceptance criteria == the ValidationPlan (captured before dispatch). */
export interface AcceptanceCriteria {
  steps: AcceptanceStep[];
  source: "user" | "template" | "repo-detected";
}

export interface ValidationStepResult {
  id: string;
  argv: string[];
  exitCode: number | null;
  ok: boolean;
  stdoutHash?: string;
  /** Redacted stderr summary. */
  stderrSummary?: string;
  durationMs: number;
  /** Step was denied by Fabric policy (not an execution failure). */
  denied?: boolean;
}

export interface ValidationReport {
  steps: ValidationStepResult[];
  passed: boolean;
  at: string;
}

/** Redacted per-run ExecutionContext snapshot. No credential env or secret material. */
export interface SupervisionExecutionContextSnapshot {
  identity: {
    policy: CredentialPolicy;
    status: CredentialStatus;
    credentialId?: string;
  };
  placement: {
    placement: ExecutionPlacement;
    executor: "gateway" | "node_agent";
    nodeAgentId?: string;
    fallback: PlacementFallback;
  };
  attribution: {
    tenantId?: string;
    userId?: string;
    seatId?: string;
    credentialId?: string;
    workerId: string;
    model?: string;
  };
}

export interface SupervisionIteration {
  index: number;
  /**
   * Authoritative Dispatch/Run ID for this round (P0-3).
   * Written when worker.start returns; UI/audit correlate by it to avoid stale-round mixing.
   */
  runId?: string;
  /** Redacted context used to dispatch this worker round. */
  executionContext?: SupervisionExecutionContextSnapshot;
  /** Redacted worker result summary. */
  workerSummary?: string;
  exitCode?: number;
  usage?: { input?: number; output?: number };
  validation?: ValidationReport;
  startedAt: string;
  endedAt?: string;
}

/** Bounded budget (D-BUDGET). Defaults 5/5/30; tenant-configurable; task can only tighten. */
export interface SupervisorBudget {
  maxIterations: number;
  maxCostUsd: number;
  maxDurationMinutes: number;
}

export const DEFAULT_SUPERVISOR_BUDGET: SupervisorBudget = {
  maxIterations: 5,
  maxCostUsd: 5,
  maxDurationMinutes: 30,
};

export interface SupervisedTask {
  taskId: string;
  goal: string;
  /**
   * Source repository root used for validator `cwd` and for workspace
   * provisioning (worktree add/remove). Persisted so resumeActive can rebuild.
   */
  repoRoot: string;
  tenantId?: string;
  userId?: string;
  /** Bound seat for Node placement / attribution (not interchangeable with userId). */
  seatId?: string;
  agentId?: string;
  /** Worker reference (== cli-backend id + optional model). */
  worker: { backendId: string; model?: string };
  workspace: { id: string; root: string; kind: "worktree" | "directory"; branch?: string };
  acceptance: AcceptanceCriteria;
  state: SupervisedTaskState;
  iterations: SupervisionIteration[];
  budget: SupervisorBudget & {
    spentCostUsd: number;
    startedAtMs?: number;
    /**
     * Tip ledger iteration count (own + child). When set, `nextStop` uses
     * max(this, iterations.length) so a charge outside this loop still stops
     * the next round. Absent ⇒ legacy iterations.length only.
     */
    iterationCount?: number;
  };
  /** Opaque continuity key handed to the Worker (the adapter maps it to a CLI session). */
  continuityKey?: string;
  /**
   * Durable snapshot of the in-process Worker run (runId/workerId). Cleared when the
   * round leaves `executing`. Used by abort/resume after checkpoint persistence.
   */
  activeRun?: { runId: string; workerId: string };
  createdAt: string;
  updatedAt: string;
  /** support-case id when escalated. */
  escalationRef?: string;
  /**
   * Optional DeliveryLane id (Tip A projection pointer).
   * Parallel to SupervisedTaskState — never drives TASK_TRANSITIONS.
   */
  laneId?: string;
  /**
   * Read-only DeliveryLane projection for UI 「交付看板」.
   * Shape mirrors delivery-lane LaneProjection; kept inline to avoid import cycles.
   */
  laneProjection?: {
    laneId: string;
    stage: string;
    tipSha?: string;
    headSha?: string;
    prNumber?: number;
    missingKeys: string[];
    focusSummary?: string;
    acceptSealStrength?: "weak" | "strong";
    acceptSealWeak?: boolean;
  };
}

/**
 * Resolve the effective budget: task may only TIGHTEN the tenant ceiling, never
 * loosen it (D-BUDGET). Missing values fall back to the tenant/default ceiling.
 */
export function resolveEffectiveBudget(
  tenant: SupervisorBudget,
  task?: Partial<SupervisorBudget>,
): SupervisorBudget {
  const tighten = (t: number, k?: number) => (typeof k === "number" ? Math.min(t, k) : t);
  return {
    maxIterations: tighten(tenant.maxIterations, task?.maxIterations),
    maxCostUsd: tighten(tenant.maxCostUsd, task?.maxCostUsd),
    maxDurationMinutes: tighten(tenant.maxDurationMinutes, task?.maxDurationMinutes),
  };
}

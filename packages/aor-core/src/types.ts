/**
 * Core data structures shared across the AOR runtime.
 *
 * These types are deliberately backend-agnostic: nothing here references
 * OpenBot internals. OpenBot (or any other engine) is reached only through
 * the {@link ExecutionBackend} abstraction defined in `backend.ts`.
 */

/** Stable identifier from the TaskType Registry, e.g. `coding.review`. */
export type TaskTypeId = string;

/** Coarse latency preference expressed by the developer. */
export type LatencyClass = "low" | "medium" | "high";

/** A concrete model addressed as `provider/id` inside OpenBot. */
export interface ModelRef {
  provider: string;
  id: string;
}

/** USD pricing per 1M tokens (matches OpenBot `ModelDefinitionConfig.cost`). */
export interface CostBreakdown {
  inputPerMtok: number;
  outputPerMtok: number;
}

/**
 * Selector view of a model. Cost comes from OpenBot config; latency and
 * `taskTypeScores` are seeded then refined by the Evaluator/Feedback loop.
 */
export interface ModelProfile {
  ref: ModelRef;
  cost: CostBreakdown;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  /** 0..1 task-completion quality per task type. */
  taskTypeScores: Record<TaskTypeId, number>;
  /** Defaults to true; set false to exclude (auth/availability). */
  available?: boolean;
}

/** Constraints attached to a task by the developer. */
export interface TaskConstraints {
  /** Hard cap on estimated USD spend for the task. */
  budgetUsd?: number;
  latency?: LatencyClass;
  /** Restrict model selection to these refs. */
  allowedModels?: ModelRef[];
}

/** A developer-described unit of work, before and after parsing. */
export interface Task {
  /** Resolved TaskType; undefined until the parser runs. */
  type?: TaskTypeId;
  goal: string;
  params?: Record<string, unknown>;
  constraints?: TaskConstraints;
}

/** Normalized token + cost usage returned by a backend run. */
export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd?: number;
}

/** A single executable node in an {@link ExecutionPlan}. */
export interface PlannedStep {
  id: string;
  taskType: TaskTypeId;
  skillId: string;
  prompt: string;
  model: ModelRef;
  /** Ordered fallback models; the backend retries through these natively. */
  fallbackModels?: ModelRef[];
}

/** Directed acyclic plan; Stage 1 emits a single node. */
export interface ExecutionPlan {
  taskType: TaskTypeId;
  steps: PlannedStep[];
  edges: Array<{ from: string; to: string }>;
}

/** Output produced by a step. */
export interface StepOutput {
  text: string;
  raw?: unknown;
}

import type { ModelInferenceInput, ModelInferenceResult } from "../../model/index.js";
import { createExecutionScope, type ExecutionInferenceInput } from "./execution-scope.js";

/**
 * Frozen stage order for the unique controlled execution use-case.
 * Scene hosts may supply ports and candidate adapters; they must not invent a
 * parallel prepare/infer/dispose loop or skip stages.
 *
 * Delivery confirmation is intentionally outside this sequence.
 */
export const CONTROLLED_EXECUTION_STAGE_ORDER = [
  "prepare",
  "assert_budget",
  "infer",
  "record_usage",
  "dispose",
  "record_execution_outcome",
] as const;

export type ControlledExecutionStage = (typeof CONTROLLED_EXECUTION_STAGE_ORDER)[number];

type Preparation = { kind: "ready" | "denied" | "unavailable" };

/**
 * Unique controlled execution use-case: owns stage readiness for work-item model runs.
 * Authority adapters (commercial gate, model routing) remain injectable ports.
 * This is not a second executor, scheduler, or configuration script runner.
 */
export function createControlledExecutionUseCase<
  Input extends { signal?: AbortSignal },
  Result extends Preparation,
>(ports: {
  prepare: (input: Input) => Promise<Result>;
  infer: <T>(input: ModelInferenceInput<T>) => Promise<ModelInferenceResult<T>>;
  dispose: () => Promise<void>;
}) {
  const scope = createExecutionScope(ports);
  return {
    /** Canonical stage names for audits and regression expectations. */
    stages: CONTROLLED_EXECUTION_STAGE_ORDER,
    prepare: (input: Input) => scope.prepare(input),
    infer: <T>(input: ExecutionInferenceInput<T>) => scope.infer(input),
    dispose: () => scope.dispose(),
  };
}

export type ControlledExecutionUseCase<
  Input extends { signal?: AbortSignal } = { signal?: AbortSignal },
  Result extends Preparation = Preparation,
> = ReturnType<typeof createControlledExecutionUseCase<Input, Result>>;

/** Scene hosts call this after create*ExecutionLifecycle so they cannot drift
 * from the frozen stage contract without a loud failure. */
export function assertControlledExecutionStages(
  lifecycle: { stages: readonly ControlledExecutionStage[] },
  scene: string,
): void {
  if (lifecycle.stages !== CONTROLLED_EXECUTION_STAGE_ORDER) {
    throw new Error(`${scene} must consume the frozen controlled execution stage order`);
  }
}

import {
  type EvalProbe,
  type Evaluator,
  VerifiableEvaluator,
  nonEmptyOutputProbe,
} from "@openbot/aor-core";
import { type CommandRunner, createCommandProbe, createCoverageProbe } from "./probes.js";

export interface ObjectiveCommandSpec {
  command: string;
  args?: string[];
  weight?: number;
}

export interface ObjectiveCoverageSpec extends ObjectiveCommandSpec {
  /** Regex with one capture group for the percentage. */
  pattern?: RegExp;
}

export interface ObjectiveCodingEvaluatorOptions {
  /** Task type this evaluator scores (default `coding.review`). */
  taskType?: string;
  /** Working directory the commands run in. */
  cwd?: string;
  /** e.g. `pnpm build`. Scores 1 on exit 0. */
  build?: ObjectiveCommandSpec;
  /** e.g. `pnpm test`. Scores 1 on exit 0. */
  test?: ObjectiveCommandSpec;
  /** e.g. `pnpm test:coverage`. Scores coverage% / 100. */
  coverage?: ObjectiveCoverageSpec;
  /** Injectable runner so unit tests / simulations never shell out. */
  runner?: CommandRunner;
  /** Keep the non-empty content probe alongside the objective ones. */
  includeContentProbe?: boolean;
}

/**
 * Objective coding evaluator.
 *
 * Unlike the content-only built-in (non-empty / structured-findings / length),
 * this wires the real build/test/coverage probes so the Feedback loop learns
 * actual task-completion quality for coding tasks. This is the evaluator the
 * Stage 1 plan calls for ("tests pass / coverage / build pass").
 */
export function createObjectiveCodingEvaluator(
  opts: ObjectiveCodingEvaluatorOptions = {},
): Evaluator {
  const taskType = opts.taskType ?? "coding.review";
  const probes: EvalProbe[] = [];

  if (opts.build) {
    probes.push(
      createCommandProbe({
        name: "build",
        command: opts.build.command,
        args: opts.build.args,
        cwd: opts.cwd,
        weight: opts.build.weight ?? 1,
        runner: opts.runner,
      }),
    );
  }
  if (opts.test) {
    probes.push(
      createCommandProbe({
        name: "test",
        command: opts.test.command,
        args: opts.test.args,
        cwd: opts.cwd,
        weight: opts.test.weight ?? 2,
        runner: opts.runner,
      }),
    );
  }
  if (opts.coverage) {
    probes.push(
      createCoverageProbe({
        command: opts.coverage.command,
        args: opts.coverage.args,
        cwd: opts.cwd,
        weight: opts.coverage.weight ?? 1,
        pattern: opts.coverage.pattern,
        runner: opts.runner,
      }),
    );
  }

  if (probes.length === 0 || opts.includeContentProbe) {
    probes.push(nonEmptyOutputProbe);
  }

  return new VerifiableEvaluator(taskType, probes);
}

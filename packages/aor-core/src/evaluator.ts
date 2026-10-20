import type { NormalizedUsage, StepOutput, Task, TaskTypeId } from "./types.js";

/**
 * Evaluator Layer.
 *
 * "Success" for an agent system is *task completion quality*, not API success.
 * Every run is scored so the Feedback loop can update model quality and the
 * Selector improves over time. Stage 1 ships deterministic, content-based
 * probes; Stage 2 adds LLM-as-judge and real build/test probes (the latter
 * live in `@openbot/aor-sdk-node` since they shell out).
 */
export interface EvalInput {
  task: Task;
  output: StepOutput;
  usage: NormalizedUsage;
  latencyMs?: number;
  /** Source text the output should be derived from (e.g. for summarization). */
  referenceInput?: string;
}

export interface EvalResult {
  taskType: TaskTypeId;
  /** 0..1 task-completion quality. */
  score: number;
  signals: Record<string, number | boolean>;
  costUsd?: number;
  latencyMs?: number;
}

export interface Evaluator {
  taskType: TaskTypeId;
  evaluate(input: EvalInput): Promise<EvalResult>;
}

/** A single objective probe contributing to the aggregate score. */
export interface EvalProbe {
  name: string;
  /** Relative weight (>= 0). */
  weight: number;
  /** Returns a 0..1 score. */
  run(input: EvalInput): Promise<number> | number;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/** Aggregates a set of probes into a weighted 0..1 score. */
export class VerifiableEvaluator implements Evaluator {
  constructor(
    public readonly taskType: TaskTypeId,
    private readonly probes: EvalProbe[],
  ) {}

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const signals: Record<string, number | boolean> = {};
    let weighted = 0;
    let totalWeight = 0;
    for (const probe of this.probes) {
      const value = clamp01(await probe.run(input));
      signals[probe.name] = value;
      weighted += value * probe.weight;
      totalWeight += probe.weight;
    }
    const score = totalWeight > 0 ? weighted / totalWeight : 0;
    return {
      taskType: this.taskType,
      score,
      signals,
      costUsd: input.usage.costUsd,
      latencyMs: input.latencyMs,
    };
  }
}

/* ----------------------------- Built-in probes ---------------------------- */

export const nonEmptyOutputProbe: EvalProbe = {
  name: "nonEmptyOutput",
  weight: 1,
  run: (input) => (input.output.text.trim().length > 0 ? 1 : 0),
};

/** Score 1 when output length is at/above a floor, scaling up to it. */
export function minLengthProbe(minChars: number, weight = 1): EvalProbe {
  return {
    name: "minLength",
    weight,
    run: (input) => clamp01(input.output.text.trim().length / Math.max(1, minChars)),
  };
}

/**
 * Reward summaries that compress the source into a target band (default
 * 5%..50% of the source length). Returns neutral 0.5 when no source is given.
 */
export function compressionRatioProbe(opts?: {
  min?: number;
  max?: number;
  weight?: number;
}): EvalProbe {
  const min = opts?.min ?? 0.05;
  const max = opts?.max ?? 0.5;
  const weight = opts?.weight ?? 1;
  return {
    name: "compressionRatio",
    weight,
    run: (input) => {
      const source = input.referenceInput ?? "";
      if (source.trim().length === 0) {
        return 0.5;
      }
      const ratio = input.output.text.trim().length / source.trim().length;
      if (ratio >= min && ratio <= max) {
        return 1;
      }
      if (ratio < min) {
        return clamp01(ratio / min);
      }
      return clamp01(1 - (ratio - max) / (1 - max));
    },
  };
}

/** Detect structured review findings (markdown list items / issue markers). */
export const structuredFindingsProbe: EvalProbe = {
  name: "structuredFindings",
  weight: 1,
  run: (input) => {
    const text = input.output.text;
    const bulletLines = text.split(/\r?\n/).filter((line) => /^\s*([-*]|\d+\.)\s+/.test(line));
    const mentionsConcerns = /\b(issue|bug|risk|suggest|fix|improv|refactor|vuln)/i.test(text);
    const bulletScore = clamp01(bulletLines.length / 3);
    return clamp01(bulletScore * 0.7 + (mentionsConcerns ? 0.3 : 0));
  },
};

/** Stage 1 built-in evaluators keyed by task type. */
export function createBuiltinEvaluators(): Map<TaskTypeId, Evaluator> {
  const map = new Map<TaskTypeId, Evaluator>();
  map.set(
    "coding.review",
    new VerifiableEvaluator("coding.review", [
      nonEmptyOutputProbe,
      structuredFindingsProbe,
      minLengthProbe(120, 0.5),
    ]),
  );
  map.set(
    "summarization",
    new VerifiableEvaluator("summarization", [nonEmptyOutputProbe, compressionRatioProbe()]),
  );
  return map;
}

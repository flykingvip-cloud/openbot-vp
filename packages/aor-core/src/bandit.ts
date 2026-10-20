import type { EvalResult } from "./evaluator.js";
import type { FeedbackStore } from "./feedback.js";
import type { ModelProfile, ModelRef, TaskTypeId } from "./types.js";

function armKey(model: ModelRef, taskType: TaskTypeId): string {
  return `${model.provider.toLowerCase()}/${model.id.toLowerCase()}::${taskType}`;
}

/** Beta distribution arm for Thompson sampling. */
export interface BanditArm {
  alpha: number;
  beta: number;
  trials: number;
}

/** Sample from Beta(alpha, beta) via Gamma ratio (deterministic when rng is fixed). */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const ga = gammaVariate(alpha, rng);
  const gb = gammaVariate(beta, rng);
  const sum = ga + gb;
  return sum > 0 ? ga / sum : alpha / (alpha + beta);
}

function gammaVariate(shape: number, rng: () => number): number {
  if (shape < 1) {
    return gammaVariate(shape + 1, rng) * rng() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normalVariate(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

function normalVariate(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface BanditFeedbackStoreOptions {
  /** Prior successes for unseen arms (default 1). */
  priorAlpha?: number;
  /** Prior failures for unseen arms (default 1). */
  priorBeta?: number;
  rng?: () => number;
}

/** JSON snapshot for disk persistence (see bandit-persistence.ts). */
export interface BanditPersistedState {
  version: 1;
  priorAlpha: number;
  priorBeta: number;
  arms: Record<string, BanditArm>;
}

/**
 * Contextual bandit feedback: treats Evaluator scores as fractional rewards and
 * drives Thompson sampling per (model, taskType) arm.
 */
export class BanditFeedbackStore implements FeedbackStore {
  private readonly arms = new Map<string, BanditArm>();
  private readonly priorAlpha: number;
  private readonly priorBeta: number;
  private readonly rng: () => number;

  constructor(options: BanditFeedbackStoreOptions = {}) {
    this.priorAlpha = options.priorAlpha ?? 1;
    this.priorBeta = options.priorBeta ?? 1;
    this.rng = options.rng ?? Math.random;
  }

  record(model: ModelRef, taskType: TaskTypeId, evaluation: EvalResult): void {
    const k = armKey(model, taskType);
    const arm = this.arms.get(k) ?? {
      alpha: this.priorAlpha,
      beta: this.priorBeta,
      trials: 0,
    };
    const score = Math.max(0, Math.min(1, evaluation.score));
    arm.alpha += score;
    arm.beta += 1 - score;
    arm.trials += 1;
    this.arms.set(k, arm);
  }

  armStats(model: ModelRef, taskType: TaskTypeId): BanditArm | undefined {
    return this.arms.get(armKey(model, taskType));
  }

  quality(model: ModelRef, taskType: TaskTypeId): number | undefined {
    const arm = this.arms.get(armKey(model, taskType));
    if (!arm) {
      return undefined;
    }
    return arm.alpha / (arm.alpha + arm.beta);
  }

  /** Thompson sample for selection (0..1). */
  sampleQuality(model: ModelRef, taskType: TaskTypeId): number {
    const arm = this.arms.get(armKey(model, taskType)) ?? {
      alpha: this.priorAlpha,
      beta: this.priorBeta,
      trials: 0,
    };
    return sampleBeta(arm.alpha, arm.beta, this.rng);
  }

  apply(profiles: ModelProfile[]): ModelProfile[] {
    return profiles.map((profile) => {
      const taskTypeScores = { ...profile.taskTypeScores };
      for (const taskType of Object.keys(taskTypeScores)) {
        taskTypeScores[taskType] = this.sampleQuality(profile.ref, taskType);
      }
      return { ...profile, taskTypeScores };
    });
  }

  /** Learning curve snapshot for observability. */
  learningSnapshot(): Array<{ arm: string; mean: number; trials: number }> {
    return [...this.arms.entries()].map(([arm, stats]) => ({
      arm,
      mean: stats.alpha / (stats.alpha + stats.beta),
      trials: stats.trials,
    }));
  }

  exportPersistedState(): BanditPersistedState {
    const arms: Record<string, BanditArm> = {};
    for (const [k, v] of this.arms.entries()) {
      arms[k] = { ...v };
    }
    return {
      version: 1,
      priorAlpha: this.priorAlpha,
      priorBeta: this.priorBeta,
      arms,
    };
  }

  importPersistedState(state: BanditPersistedState): void {
    if (state.version !== 1) {
      return;
    }
    this.arms.clear();
    for (const [k, arm] of Object.entries(state.arms)) {
      if (
        typeof arm.alpha === "number" &&
        typeof arm.beta === "number" &&
        typeof arm.trials === "number"
      ) {
        this.arms.set(k, { ...arm });
      }
    }
  }
}

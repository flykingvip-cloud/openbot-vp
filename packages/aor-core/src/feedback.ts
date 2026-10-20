import type { EvalResult } from "./evaluator.js";
import type { ModelProfile, ModelRef, TaskTypeId } from "./types.js";

/**
 * Feedback store: turns Evaluator scores into updated per-model quality so the
 * Selector improves over time. Stage 1 uses an exponential moving average;
 * Stage 3 replaces this with a contextual bandit while keeping this interface.
 */
export interface FeedbackStore {
  record(model: ModelRef, taskType: TaskTypeId, evaluation: EvalResult): void;
  /** Current learned quality (0..1), or undefined if no data yet. */
  quality(model: ModelRef, taskType: TaskTypeId): number | undefined;
  /** Apply learned quality onto a set of profiles (returns new array). */
  apply(profiles: ModelProfile[]): ModelProfile[];
}

function key(model: ModelRef, taskType: TaskTypeId): string {
  return `${model.provider.toLowerCase()}/${model.id.toLowerCase()}::${taskType}`;
}

export class EmaFeedbackStore implements FeedbackStore {
  private readonly scores = new Map<string, number>();

  /** @param alpha smoothing factor in (0,1]; higher reacts faster. */
  constructor(private readonly alpha = 0.3) {}

  record(model: ModelRef, taskType: TaskTypeId, evaluation: EvalResult): void {
    const k = key(model, taskType);
    const prev = this.scores.get(k);
    const next =
      prev === undefined ? evaluation.score : prev + this.alpha * (evaluation.score - prev);
    this.scores.set(k, next);
  }

  quality(model: ModelRef, taskType: TaskTypeId): number | undefined {
    return this.scores.get(key(model, taskType));
  }

  apply(profiles: ModelProfile[]): ModelProfile[] {
    return profiles.map((profile) => {
      const taskTypeScores = { ...profile.taskTypeScores };
      for (const taskType of Object.keys(taskTypeScores)) {
        const learned = this.quality(profile.ref, taskType);
        if (learned !== undefined) {
          taskTypeScores[taskType] = learned;
        }
      }
      return { ...profile, taskTypeScores };
    });
  }
}

import type { TaskTypeRegistry } from "./task-types.js";
import type { TaskConstraints, TaskTypeId } from "./types.js";

export interface ParsedTask {
  type: TaskTypeId;
  params: Record<string, unknown>;
  /** 0..1 classification confidence. */
  confidence: number;
}

export interface TaskParser {
  parse(goal: string, constraints?: TaskConstraints): Promise<ParsedTask>;
}

/**
 * Optional async classifier (e.g. an LLM call) the parser can defer to. It
 * receives the goal and the set of candidate task type ids and returns the
 * chosen id, or undefined to fall back to the rule-based path.
 *
 * Stage 1 ships the rule-based path; the LLM classifier is wired in Stage 1.x
 * without changing the {@link TaskParser} contract.
 */
export type LlmClassifier = (
  goal: string,
  candidates: TaskTypeId[],
) => Promise<TaskTypeId | undefined>;

function tokenize(goal: string): string[] {
  return goal
    .toLowerCase()
    .split(/[^a-z0-9.+#]+/)
    .filter((token) => token.length > 0);
}

/**
 * Deterministic keyword-scoring parser. It maps a free-text goal to a TaskType
 * by counting keyword hits per registered type. This keeps Stage 1 testable
 * and offline; the {@link LlmClassifier} hook upgrades understanding later.
 */
export class RuleBasedTaskParser implements TaskParser {
  constructor(
    private readonly registry: TaskTypeRegistry,
    private readonly fallbackType: TaskTypeId,
    private readonly classifier?: LlmClassifier,
  ) {}

  async parse(goal: string, _constraints?: TaskConstraints): Promise<ParsedTask> {
    const tokens = new Set(tokenize(goal));
    const defs = this.registry.list();

    let best: { id: TaskTypeId; hits: number } | undefined;
    let totalHits = 0;
    for (const def of defs) {
      let hits = 0;
      for (const keyword of def.keywords) {
        if (tokens.has(keyword.toLowerCase())) {
          hits += 1;
        }
      }
      totalHits += hits;
      if (hits > 0 && (best === undefined || hits > best.hits)) {
        best = { id: def.id, hits };
      }
    }

    if (this.classifier) {
      const chosen = await this.classifier(
        goal,
        defs.map((d) => d.id),
      );
      if (chosen && this.registry.has(chosen)) {
        return { type: chosen, params: {}, confidence: 0.95 };
      }
    }

    if (!best) {
      return { type: this.fallbackType, params: {}, confidence: 0 };
    }
    const confidence = totalHits > 0 ? Math.min(1, best.hits / totalHits) : 0;
    return { type: best.id, params: {}, confidence };
  }
}

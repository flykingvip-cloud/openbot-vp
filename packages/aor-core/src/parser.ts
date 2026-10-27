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

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

/**
 * Tokenize for keyword scoring. ASCII tokens split on non-alnum; CJK runs are
 * kept as whole tokens so Chinese keywords (e.g. 重构) are not discarded.
 */
function tokenize(goal: string): string[] {
  const lower = goal.toLowerCase();
  const ascii = lower.split(/[^a-z0-9.+#]+/).filter((token) => token.length > 0);
  const cjk = lower.match(/[\u3400-\u9fff]+/g) ?? [];
  return [...ascii, ...cjk];
}

function keywordHits(goalLower: string, tokens: Set<string>, keyword: string): boolean {
  const key = keyword.toLowerCase();
  if (!key) {
    return false;
  }
  if (tokens.has(key)) {
    return true;
  }
  // CJK keywords: substring match (tokenizer may merge adjacent chars).
  if (hasCjk(key) && goalLower.includes(key)) {
    return true;
  }
  return false;
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
    const goalLower = goal.toLowerCase();
    for (const def of defs) {
      let hits = 0;
      for (const keyword of def.keywords) {
        if (keywordHits(goalLower, tokens, keyword)) {
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

import type {
  KnowledgeResolveIntent,
  KnowledgeResolveIntentType,
  KnowledgeSource,
  KnowledgeTaskContext,
} from "../types.js";

type IntentRule = {
  intentType: KnowledgeResolveIntentType;
  patterns: RegExp[];
  sources: KnowledgeSource[];
  signal: string;
};

const INTENT_RULES: IntentRule[] = [
  {
    intentType: "analysis",
    patterns: [
      /分析|为什么|下降|趋势|指标|成交|流失|metric|rate|analyze|decline/i,
      /用友|畅捷通|chanjet|yonyou|仓库|存货|库存|数据产品|往来单位|销货单/i,
    ],
    sources: ["enterprise", "data"],
    signal: "analysis-keywords",
  },
  {
    intentType: "retrospective",
    patterns: [/复盘|总结|回顾|沉淀|retrospective|postmortem|review/i],
    sources: ["personal", "enterprise"],
    signal: "retrospective-keywords",
  },
  {
    intentType: "research",
    patterns: [/研究|调研|了解|查找|research|investigate|explore/i],
    sources: ["enterprise", "personal"],
    signal: "research-keywords",
  },
  {
    intentType: "operations",
    patterns: [/执行|操作|流程|审批|跟进|operate|workflow|process/i],
    sources: ["enterprise", "data"],
    signal: "operations-keywords",
  },
];

const TASK_TYPE_SOURCE_HINTS: Record<string, KnowledgeSource[]> = {
  analysis: ["enterprise", "data"],
  retrospective: ["personal", "enterprise"],
  research: ["enterprise", "personal"],
  operations: ["enterprise", "data"],
  support: ["enterprise", "personal"],
  planning: ["personal", "enterprise"],
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function scoreIntentRule(rule: IntentRule, text: string): { score: number; matched: boolean } {
  let score = 0;
  let matched = false;
  for (const pattern of rule.patterns) {
    if (pattern.test(text)) {
      matched = true;
      score += 1;
    }
  }
  return { score, matched };
}

export function classifyKnowledgeIntent(params: {
  query?: string;
  taskContext: KnowledgeTaskContext;
  sourcePolicyEnabled?: boolean;
}): KnowledgeResolveIntent {
  const text = normalizeText([params.query, params.taskContext.taskType].filter(Boolean).join(" "));
  const signals: string[] = [];
  let bestIntent: KnowledgeResolveIntentType = "general";
  let bestScore = 0;
  // Policy path: general grants no sources. Baseline keeps the three-source default.
  let suggestedSources: KnowledgeSource[] = params.sourcePolicyEnabled
    ? []
    : ["personal", "enterprise", "data"];

  for (const rule of INTENT_RULES) {
    const { score, matched } = scoreIntentRule(rule, text);
    if (!matched) {
      continue;
    }
    signals.push(rule.signal);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule.intentType;
      suggestedSources = rule.sources;
    }
  }

  const taskTypeHint = TASK_TYPE_SOURCE_HINTS[normalizeText(params.taskContext.taskType)];
  if (taskTypeHint) {
    signals.push(`task-type:${params.taskContext.taskType}`);
    if (bestIntent === "general") {
      bestIntent =
        (params.taskContext.taskType as KnowledgeResolveIntentType) in TASK_TYPE_SOURCE_HINTS
          ? (params.taskContext.taskType as KnowledgeResolveIntentType)
          : bestIntent;
      suggestedSources = taskTypeHint;
      bestScore = Math.max(bestScore, 1);
    }
  }

  if (params.taskContext.requestedSourceHints?.length) {
    signals.push("requested-source-hints");
    // Baseline: hints replace suggested sources (may expand). Policy: hints only
    // shrink at selection time and must not grant sources here.
    if (!params.sourcePolicyEnabled) {
      suggestedSources = params.taskContext.requestedSourceHints;
    }
  }

  const confidence = bestIntent === "general" ? 0.45 : Math.min(0.55 + bestScore * 0.15, 0.95);

  return {
    intentType: bestIntent,
    confidence,
    signals,
    suggestedSources,
  };
}

import type { TaskTypeId } from "./types.js";

/**
 * A versioned entry in the Task Taxonomy. Over time this registry becomes a
 * knowledge asset: each TaskType binds default skills, an evaluator, expected
 * output shape, and a cost baseline.
 */
export interface TaskTypeDef {
  id: TaskTypeId;
  description: string;
  /** Skill used when the planner has no better match. */
  defaultSkillId: string;
  /** Keywords used by the rule-based parser to classify free-text goals. */
  keywords: string[];
  /** Rough expected USD cost, for reporting and sanity checks. */
  costBaselineUsd?: number;
}

export class TaskTypeRegistry {
  private readonly defs = new Map<TaskTypeId, TaskTypeDef>();

  register(def: TaskTypeDef): this {
    if (this.defs.has(def.id)) {
      throw new Error(`TaskType already registered: ${def.id}`);
    }
    this.defs.set(def.id, def);
    return this;
  }

  get(id: TaskTypeId): TaskTypeDef | undefined {
    return this.defs.get(id);
  }

  has(id: TaskTypeId): boolean {
    return this.defs.has(id);
  }

  list(): TaskTypeDef[] {
    return [...this.defs.values()];
  }
}

/** Stage 1 built-in task types: coding.review and summarization. */
export const BUILTIN_TASK_TYPES: readonly TaskTypeDef[] = [
  {
    id: "coding.review",
    description: "Review code or a repository and report concrete findings.",
    defaultSkillId: "coding.review",
    keywords: [
      "review",
      "analyze",
      "analyse",
      "code",
      "codebase",
      "repository",
      "repo",
      "refactor",
      "improve",
      "audit",
      "bug",
      "lint",
    ],
    costBaselineUsd: 0.05,
  },
  {
    id: "summarization",
    description: "Summarize or condense text into a shorter form.",
    defaultSkillId: "summarization",
    keywords: [
      "summarize",
      "summarise",
      "summary",
      "tldr",
      "condense",
      "shorten",
      "digest",
      "brief",
      "recap",
    ],
    costBaselineUsd: 0.01,
  },
  {
    id: "lobster.pipeline",
    description: "Run a Lobster deterministic pipeline via the OpenBot lobster plugin tool.",
    defaultSkillId: "lobster.pipeline",
    keywords: ["lobster", "pipeline", "workflow", "approval"],
    costBaselineUsd: 0.02,
  },
  {
    id: "plugin.tool",
    description: "Invoke an OpenBot plugin or core tool by name.",
    defaultSkillId: "plugin.tool",
    keywords: ["tool", "plugin", "invoke", "mcp"],
    costBaselineUsd: 0.01,
  },
  {
    id: "coding.refactor",
    description: "Refactor code for clarity, structure, and maintainability.",
    defaultSkillId: "coding.refactor",
    keywords: ["refactor", "restructure", "cleanup", "extract", "rename", "dedupe"],
    costBaselineUsd: 0.06,
  },
  {
    id: "coding.security",
    description: "Security review: vulnerabilities, secrets, unsafe patterns.",
    defaultSkillId: "coding.security",
    keywords: ["security", "vulnerability", "cve", "xss", "injection", "secrets", "audit"],
    costBaselineUsd: 0.07,
  },
  {
    id: "research.summary",
    description: "Research a topic and produce a structured summary with sources.",
    defaultSkillId: "research.summary",
    keywords: ["research", "investigate", "survey", "literature", "compare", "analysis"],
    costBaselineUsd: 0.04,
  },
  {
    id: "ops.deploy",
    description: "Operational deploy/release checklist and runbook steps.",
    defaultSkillId: "ops.deploy",
    keywords: ["deploy", "release", "rollout", "ops", "production", "canary", "rollback"],
    costBaselineUsd: 0.03,
  },
];

/** Build a registry preloaded with the Stage 1 built-in task types. */
export function createBuiltinTaskTypeRegistry(): TaskTypeRegistry {
  const registry = new TaskTypeRegistry();
  for (const def of BUILTIN_TASK_TYPES) {
    registry.register({ ...def, keywords: [...def.keywords] });
  }
  return registry;
}

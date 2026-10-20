import type { OpenBotConfig } from "../config/config.js";
import type {
  AgentContextBudgetConfig,
  AgentContextBudgetSegmentKey,
} from "../config/types.agent-defaults.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { listAgentEntries } from "./agent-scope.js";

export const DEFAULT_CONTEXT_BUDGET_PRIORITY: AgentContextBudgetSegmentKey[] = [
  "current_task",
  "group_decisions",
  "constraints",
  "session_summary",
  "recent_messages",
  "memory_retrieval",
  "user_profile",
];

export const DEFAULT_CONTEXT_BUDGET: Required<
  Pick<
    AgentContextBudgetConfig,
    "enabled" | "maxTokens" | "priority" | "minRecentMessages" | "maxRecentMessages"
  >
> = {
  enabled: true,
  maxTokens: 8000,
  priority: DEFAULT_CONTEXT_BUDGET_PRIORITY,
  minRecentMessages: 4,
  maxRecentMessages: 40,
};

/** Agent-type presets (v1.1 P0 templates). */
export const CONTEXT_BUDGET_AGENT_PRESETS: Record<string, Partial<AgentContextBudgetConfig>> = {
  "sales-agent": {
    maxTokens: 12000,
    priority: ["current_task", "memory_retrieval", "session_summary", "recent_messages"],
  },
  "coding-agent": {
    maxTokens: 16000,
    priority: ["recent_messages", "constraints", "current_task", "memory_retrieval"],
  },
  "writing-agent": {
    maxTokens: 6000,
    priority: ["session_summary", "constraints", "current_task", "recent_messages"],
  },
};

export type ResolvedContextBudget = {
  enabled: boolean;
  maxChars: number;
  priority: AgentContextBudgetSegmentKey[];
  minRecentMessages: number;
  maxRecentMessages: number;
};

function mergeContextBudget(
  base?: AgentContextBudgetConfig,
  override?: AgentContextBudgetConfig,
): AgentContextBudgetConfig | undefined {
  if (!base && !override) {
    return undefined;
  }
  return { ...base, ...override };
}

export function resolveContextBudget(cfg: OpenBotConfig, agentId: string): ResolvedContextBudget {
  const id = normalizeAgentId(agentId);
  const defaults = cfg.agents?.defaults?.contextBudget;
  const entry = listAgentEntries(cfg).find((item) => normalizeAgentId(item.id) === id);
  const preset = CONTEXT_BUDGET_AGENT_PRESETS[id];
  const merged = mergeContextBudget(mergeContextBudget(defaults, preset), entry?.contextBudget);

  if (!merged) {
    return {
      enabled: false,
      maxChars: DEFAULT_CONTEXT_BUDGET.maxTokens * 4,
      priority: DEFAULT_CONTEXT_BUDGET.priority,
      minRecentMessages: DEFAULT_CONTEXT_BUDGET.minRecentMessages,
      maxRecentMessages: DEFAULT_CONTEXT_BUDGET.maxRecentMessages,
    };
  }

  const enabled = merged.enabled !== false;
  const maxTokens = merged.maxTokens ?? DEFAULT_CONTEXT_BUDGET.maxTokens;
  const priority = merged.priority?.length ? merged.priority : DEFAULT_CONTEXT_BUDGET.priority;
  return {
    enabled,
    maxChars: Math.max(512, Math.floor(maxTokens * 4)),
    priority,
    minRecentMessages: merged.minRecentMessages ?? DEFAULT_CONTEXT_BUDGET.minRecentMessages,
    maxRecentMessages: merged.maxRecentMessages ?? DEFAULT_CONTEXT_BUDGET.maxRecentMessages,
  };
}

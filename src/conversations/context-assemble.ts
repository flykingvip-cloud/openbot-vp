/**
 * Apply Context Budget Planner to AgentMessage history (CL-P2-01 runtime wire).
 * Single integration point for LegacyContextEngine.assemble.
 *
 * Rules:
 * - Never drop the latest user turn (current input).
 * - Prefer dropping oldest history first.
 * - Keep compaction/summary-like messages when budget allows (runtime summary).
 * - Emit structured trace without user content.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  estimateTokensFromText,
  planContextBudget,
  type ContextBudgetPlan,
  type ContextBudgetTrace,
} from "./context-budget.js";

export type AssembleWithBudgetResult = {
  messages: AgentMessage[];
  estimatedTokens: number;
  plan: ContextBudgetPlan;
  trimmed: boolean;
  droppedMessageCount: number;
};

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

/** Rough token estimate without depending on pi-coding-agent in pure unit tests. */
export function estimateMessageTokensRough(message: AgentMessage): number {
  const role = String((message as { role?: string }).role ?? "");
  const base = estimateTokensFromText(messageText(message));
  // Tool payloads tend to be denser / underestimated by char heuristic.
  if (role === "toolResult" || role === "tool") {
    return Math.ceil(base * 1.15);
  }
  return base;
}

export function estimateMessagesTokensRough(messages: AgentMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokensRough(m), 0);
}

function isSummaryLike(message: AgentMessage): boolean {
  const role = String((message as { role?: string }).role ?? "");
  if (role === "compactionSummary" || role === "summary") {
    return true;
  }
  // Some runtimes mark summaries via name/type fields.
  const name = String((message as { name?: string }).name ?? "").toLowerCase();
  return name.includes("compaction") || name.includes("summary");
}

function isSystemLike(message: AgentMessage): boolean {
  const role = String((message as { role?: string }).role ?? "");
  return role === "system" || role === "developer";
}

/**
 * Partition messages into mandatory/system, summary, history, and current user tail.
 */
function partitionMessages(messages: AgentMessage[]): {
  system: AgentMessage[];
  summary: AgentMessage[];
  history: AgentMessage[];
  currentUserTail: AgentMessage[];
} {
  if (messages.length === 0) {
    return { system: [], summary: [], history: [], currentUserTail: [] };
  }

  // Current input = last contiguous user/tool/assistant block starting at last user.
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) {
    // No user message — treat all as history.
    const system = messages.filter(isSystemLike);
    const rest = messages.filter((m) => !isSystemLike(m));
    const summary = rest.filter(isSummaryLike);
    const history = rest.filter((m) => !isSummaryLike(m));
    return { system, summary, history, currentUserTail: [] };
  }

  const currentUserTail = messages.slice(lastUserIndex);
  const prefix = messages.slice(0, lastUserIndex);
  const system = prefix.filter(isSystemLike);
  const nonSystem = prefix.filter((m) => !isSystemLike(m));
  const summary = nonSystem.filter(isSummaryLike);
  const history = nonSystem.filter((m) => !isSummaryLike(m));
  return { system, summary, history, currentUserTail };
}

export type ApplyBudgetOptions = {
  tokenBudget: number;
  /** Tokens already reserved for system prompt outside message array. */
  mandatoryPolicyTokens?: number;
  outputReserveTokens?: number;
  toolProtocolReserveTokens?: number;
  /** Approved shared task context tokens (collaboration). */
  approvedTaskContextTokens?: number;
  /** Retrieved memory tokens (governed). */
  retrievedMemoryTokens?: number;
  /** When false, only compute plan/trace without trimming. */
  enforce?: boolean;
};

/**
 * Plan and optionally trim message history under a model context window.
 */
export function assembleMessagesWithBudget(
  messages: AgentMessage[],
  options: ApplyBudgetOptions,
): AssembleWithBudgetResult {
  const parts = partitionMessages(messages);
  const systemTokens = estimateMessagesTokensRough(parts.system);
  const currentInputTokens = estimateMessagesTokensRough(parts.currentUserTail);
  const summaryTokens = estimateMessagesTokensRough(parts.summary);
  const historyTokens = estimateMessagesTokensRough(parts.history);
  const mandatoryPolicyTokens = (options.mandatoryPolicyTokens ?? 0) + systemTokens;

  const plan = planContextBudget({
    modelContextTokens: options.tokenBudget,
    mandatoryPolicyTokens,
    currentInputTokens,
    approvedTaskContextTokens: options.approvedTaskContextTokens ?? 0,
    recentTurnsTokens: historyTokens,
    runtimeSummaryTokens: summaryTokens,
    retrievedMemoryTokens: options.retrievedMemoryTokens ?? 0,
    outputReserveTokens: options.outputReserveTokens,
    toolProtocolReserveTokens: options.toolProtocolReserveTokens,
  });

  if (options.enforce === false) {
    return {
      messages,
      estimatedTokens: estimateMessagesTokensRough(messages),
      plan,
      trimmed: false,
      droppedMessageCount: 0,
    };
  }

  // Allocate slices for summary + history under remaining after current input.
  let summaryBudget = plan.trace.runtimeSummaryAllocated;
  let historyBudget =
    plan.trace.recentTurnsAllocated +
    plan.slices
      .filter((s) => s.kind === "unused_reserve")
      .reduce((s, x) => s + x.allocatedTokens, 0);

  // Keep as much summary as budget allows (newest summaries first if multiple).
  const keptSummary: AgentMessage[] = [];
  for (let i = parts.summary.length - 1; i >= 0; i--) {
    const msg = parts.summary[i];
    const cost = estimateMessageTokensRough(msg);
    if (cost <= summaryBudget || keptSummary.length === 0) {
      // Always keep at least the newest summary if any exist and cost is finite.
      if (cost <= summaryBudget) {
        keptSummary.unshift(msg);
        summaryBudget -= cost;
      } else if (keptSummary.length === 0 && summaryBudget > 0) {
        // Oversize single summary: keep it and note truncation via plan (cannot split here).
        keptSummary.unshift(msg);
        summaryBudget = 0;
      }
    }
  }

  // Keep newest history messages within historyBudget.
  const keptHistory: AgentMessage[] = [];
  for (let i = parts.history.length - 1; i >= 0; i--) {
    const msg = parts.history[i];
    const cost = estimateMessageTokensRough(msg);
    if (cost <= historyBudget) {
      keptHistory.unshift(msg);
      historyBudget -= cost;
    }
  }

  const next = [...parts.system, ...keptSummary, ...keptHistory, ...parts.currentUserTail];

  const droppedMessageCount = messages.length - next.length;
  return {
    messages: droppedMessageCount > 0 ? next : messages,
    estimatedTokens: estimateMessagesTokensRough(next),
    plan,
    trimmed: droppedMessageCount > 0,
    droppedMessageCount,
  };
}

export function formatBudgetTraceForLog(trace: ContextBudgetTrace): string {
  return [
    `ctx=${trace.modelContextTokens}`,
    `available=${trace.availableInputBudget}`,
    `policy=${trace.mandatoryPolicyTokens}`,
    `input=${trace.currentInputTokens}`,
    `recent=${trace.recentTurnsAllocated}`,
    `summary=${trace.runtimeSummaryAllocated}`,
    `memory=${trace.memoryAllocated}`,
    `overflow=${trace.overflow}`,
    trace.overflowReason ? `reason=${trace.overflowReason}` : null,
    trace.truncatedKinds.length ? `truncated=${trace.truncatedKinds.join(",")}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

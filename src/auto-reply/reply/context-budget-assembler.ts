import { loadContextCandidates } from "../../agents/context-compiler/candidates.js";
import { resolveContextBudget } from "../../agents/resolve-context-budget.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { AgentContextBudgetSegmentKey } from "../../config/types.agent-defaults.js";
import { truncateUtf16Safe } from "../../utils.js";
import { buildContextConstraintsCapsule } from "./context-constraints-capsule.js";
import { buildGroupDecisionCapsule } from "./group-decision-capsule.js";
import {
  buildSessionContinuityPrompt,
  loadLatestSessionContinuityCheckpoint,
  type ArtifactLedgerEntry,
  type MemoryCheckpoint,
  type TaskLedgerEntry,
} from "./session-continuity.js";
import {
  buildTaskSummaryText,
  getTaskContext,
  resolveTaskContextScope,
} from "./task-context-store.js";

export type ActiveContextAssemblyParams = {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  isNewSession: boolean;
};

function estimateChars(segment: string): number {
  const segmenter = new Intl.Segmenter();
  let count = 0;
  for (const _entry of segmenter.segment(segment)) {
    count += 1;
  }
  return count;
}

function appendSegment(segments: string[], remaining: { chars: number }, text: string): void {
  const trimmed = text.trim();
  if (!trimmed || remaining.chars <= 0) {
    return;
  }
  if (estimateChars(trimmed) <= remaining.chars) {
    segments.push(trimmed);
    remaining.chars -= estimateChars(trimmed);
    return;
  }
  segments.push(truncateUtf16Safe(trimmed, remaining.chars));
  remaining.chars = 0;
}

async function loadCurrentTaskSegment(params: ActiveContextAssemblyParams): Promise<string> {
  const scope = resolveTaskContextScope(params);
  const taskFilter = params.sessionEntry?.taskContextId?.trim();
  if (!taskFilter) {
    return "";
  }
  const task = await getTaskContext(scope, taskFilter);
  // Sprint-1: never inject non-active current_task (done/closed/paused).
  if (!task || task.status !== "active") {
    return "";
  }
  return buildTaskSummaryText(task);
}

function loadSessionSummarySegment(checkpoint?: MemoryCheckpoint): string {
  const summary = checkpoint?.summary?.trim();
  if (!summary) {
    return "";
  }
  return `Session summary: ${summary}`;
}

function loadLegacyContinuitySegment(params: ActiveContextAssemblyParams): Promise<string> {
  return buildSessionContinuityPrompt(params);
}

export async function buildActiveContextSystemPrompt(
  params: ActiveContextAssemblyParams,
): Promise<string> {
  const budget = resolveContextBudget(params.cfg, params.agentId);
  if (!budget.enabled) {
    return loadLegacyContinuitySegment(params);
  }

  const scopeInfo = resolveTaskContextScope(params);
  const isGroupScope = scopeInfo.scope === "group";
  if (!params.isNewSession && !isGroupScope) {
    return "";
  }

  const latestCheckpoint = await loadLatestSessionContinuityCheckpoint({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
  });

  const segmentLoaders: Record<AgentContextBudgetSegmentKey, () => Promise<string> | string> = {
    current_task: () => loadCurrentTaskSegment(params),
    group_decisions: async () =>
      buildGroupDecisionCapsule({
        cfg: params.cfg,
        sessionEntry: params.sessionEntry,
      }),
    constraints: async () =>
      buildContextConstraintsCapsule({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
      }),
    session_summary: () => loadSessionSummarySegment(latestCheckpoint),
    // recent_messages is owned by Context Compiler (transformContext / streamFn).
    // Assembler only supplies candidates; it must not inject transcript into system prompt.
    recent_messages: async () => "",
    memory_retrieval: async () => "",
    user_profile: async () => "",
  };

  const remaining = { chars: budget.maxChars };
  const segments: string[] = [
    "Active context (assembled by context budget policy):",
    "Use this as current operating state, not as raw chat history.",
  ];

  for (const key of budget.priority) {
    if (remaining.chars <= 0) {
      break;
    }
    const loader = segmentLoaders[key];
    const chunk = (await loader()).trim();
    if (!chunk) {
      continue;
    }
    appendSegment(segments, remaining, chunk);
  }

  if (segments.length <= 2) {
    return loadLegacyContinuitySegment(params);
  }
  return truncateUtf16Safe(segments.join("\n\n"), budget.maxChars);
}

/** Candidate loader. Context Compiler is the only outbound authority. */
export const assembleContextCandidates = loadContextCandidates;

// Re-export types used by tests
export type { TaskLedgerEntry, ArtifactLedgerEntry };

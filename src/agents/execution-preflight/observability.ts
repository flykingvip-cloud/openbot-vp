/**
 * Execution-discipline P2 observability (shadow-safe).
 *
 * Default OFF via OPENBOT_EXECUTION_DISCIPLINE_OBSERVATION.
 * Never throws into chat / attempt / delivery paths. No remote I/O.
 * Does not record user text, tool args, or secrets.
 */
import { createHash } from "node:crypto";
import { emitAgentEvent } from "../../infra/agent-events.js";

export const EXECUTION_DISCIPLINE_OBSERVATION_FLAG = "OPENBOT_EXECUTION_DISCIPLINE_OBSERVATION";

export type DisciplineObservationMetrics = {
  timeToFirstToolMs?: number;
  confirmPromptsPerTask?: number;
  sameDecisionReconfirmCount?: number;
  skillsPromptChars?: number;
  alwaysSkillReadCount?: number;
  inboundDepth?: "chat" | "retrieve" | "act";
  inboundDepthMode?: string;
  confirmationGatePendingCount?: number;
  confirmationGateRequiredCount?: number;
};

type BridgeClock = {
  now: () => number;
  enabled?: boolean;
};

let clock: BridgeClock = { now: Date.now };

function resolveEnvBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return defaultValue;
}

export function isExecutionDisciplineObservationEnabled(): boolean {
  if (clock.enabled !== undefined) {
    return clock.enabled;
  }
  return resolveEnvBool(EXECUTION_DISCIPLINE_OBSERVATION_FLAG, false);
}

/** Test-only clock / force-enable. */
export function setExecutionDisciplineObservationForTest(params: {
  enabled?: boolean;
  now?: () => number;
}): void {
  clock = {
    now: params.now ?? Date.now,
    ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
  };
}

export function resetExecutionDisciplineObservationForTest(): void {
  clock = { now: Date.now };
  firstToolAt.clear();
  confirmPrompts.clear();
  reconfirmCounts.clear();
}

function hashSessionKey(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 16);
}

const firstToolAt = new Map<string, number>();
const confirmPrompts = new Map<string, number>();
const reconfirmCounts = new Map<string, { lastDecision?: string; count: number }>();

function taskKey(taskId: string): string {
  return taskId.trim() || "unknown";
}

/**
 * Call when a tool of an attempt starts.
 * Returns elapsed ms only on the first tool; later calls return undefined.
 */
export function markFirstToolStarted(params: {
  taskId: string;
  runStartedAtMs: number;
}): number | undefined {
  if (!isExecutionDisciplineObservationEnabled()) {
    return undefined;
  }
  const key = taskKey(params.taskId);
  if (firstToolAt.has(key)) {
    return undefined;
  }
  const ms = Math.max(0, clock.now() - params.runStartedAtMs);
  firstToolAt.set(key, ms);
  return ms;
}

export function readTimeToFirstToolMs(taskId: string): number | undefined {
  return firstToolAt.get(taskKey(taskId));
}

/** Count a user-facing confirmation prompt on a task. */
export function recordConfirmPrompt(params: { taskId: string; decisionKey?: string }): {
  confirmPromptsPerTask: number;
  sameDecisionReconfirmCount: number;
} {
  if (!isExecutionDisciplineObservationEnabled()) {
    return { confirmPromptsPerTask: 0, sameDecisionReconfirmCount: 0 };
  }
  const key = taskKey(params.taskId);
  const prompts = (confirmPrompts.get(key) ?? 0) + 1;
  confirmPrompts.set(key, prompts);
  const decision = params.decisionKey?.trim() || "";
  let reconfirm = 0;
  if (decision) {
    const prev = reconfirmCounts.get(key);
    if (prev && prev.lastDecision === decision) {
      reconfirm = prev.count + 1;
      reconfirmCounts.set(key, { lastDecision: decision, count: reconfirm });
    } else {
      reconfirmCounts.set(key, { lastDecision: decision, count: 0 });
      reconfirm = 0;
    }
  }
  return { confirmPromptsPerTask: prompts, sameDecisionReconfirmCount: reconfirm };
}

/**
 * Emit a structured lifecycle observation. Safe no-op when flag is off.
 * Metric names match the P2 design (snake_case in the event payload).
 */
export function emitExecutionDisciplineObservation(params: {
  runId: string;
  sessionKey?: string;
  taskId?: string;
  metrics: DisciplineObservationMetrics;
}): void {
  if (!isExecutionDisciplineObservationEnabled()) {
    return;
  }
  try {
    const m = params.metrics;
    emitAgentEvent({
      runId: params.runId,
      stream: "lifecycle",
      sessionKey: params.sessionKey,
      data: {
        event: "execution.discipline_observation",
        ...(params.sessionKey ? { sessionKeyHash: hashSessionKey(params.sessionKey) } : {}),
        ...(params.taskId ? { taskIdHash: hashSessionKey(params.taskId) } : {}),
        ...(m.timeToFirstToolMs !== undefined ? { time_to_first_tool: m.timeToFirstToolMs } : {}),
        ...(m.confirmPromptsPerTask !== undefined
          ? { confirm_prompts_per_task: m.confirmPromptsPerTask }
          : {}),
        ...(m.sameDecisionReconfirmCount !== undefined
          ? { same_decision_reconfirm_count: m.sameDecisionReconfirmCount }
          : {}),
        ...(m.skillsPromptChars !== undefined ? { skills_prompt_chars: m.skillsPromptChars } : {}),
        ...(m.alwaysSkillReadCount !== undefined
          ? { always_skill_read_count: m.alwaysSkillReadCount }
          : {}),
        ...(m.inboundDepth ? { inbound_depth: m.inboundDepth } : {}),
        ...(m.inboundDepthMode ? { inbound_depth_mode: m.inboundDepthMode } : {}),
        ...(m.confirmationGatePendingCount !== undefined
          ? { confirmation_gate_pending_count: m.confirmationGatePendingCount }
          : {}),
        ...(m.confirmationGateRequiredCount !== undefined
          ? { confirmation_gate_required_count: m.confirmationGateRequiredCount }
          : {}),
      },
    });
  } catch {
    // Observation must never break chat / attempt.
  }
}

/** Count always-on skills present in a skills prompt (heuristic on official blocks). */
export function countAlwaysSkillsInPrompt(
  skillsPrompt: string,
  alwaysSkillNames: readonly string[],
): number {
  if (!skillsPrompt.trim() || alwaysSkillNames.length === 0) {
    return 0;
  }
  const lower = skillsPrompt.toLowerCase();
  let count = 0;
  for (const name of alwaysSkillNames) {
    const needle = name.trim().toLowerCase();
    if (!needle) {
      continue;
    }
    // Official skill blocks include <name>...</name> inside <skill>.
    if (lower.includes(`<name>${needle}</name>`) || lower.includes(`\n${needle}\n`)) {
      count += 1;
    }
  }
  return count;
}

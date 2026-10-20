/**
 * Server-side structural preview inputs.
 * Reads task-outcome rows, session-index metadata, and skill-invocation
 * events. Never opens a session transcript or copies chat / model text.
 */
import { readFileSync } from "node:fs";
import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import type { EvolutionTaskOutcomeRecord } from "../gateway/agent-growth/evolution-task-outcomes.js";
import type { WorkingStyle } from "../gateway/agent-growth/genome.js";
import { readRobotWorkingStyle } from "../gateway/agent-growth/working-style-store.js";
import { readSkillInvocationEvents } from "../gateway/skill-invocation/event-store.js";
import type { SkillInvocationEvent } from "../gateway/skill-invocation/types.js";
import type {
  TrustedStructuralBaseline,
  TrustedStructuralObservation,
} from "./diagnose-structural-preview.js";
import { isProseDiagnosisEvidenceRef } from "./structural-evolution-candidate.js";

export type StructuralPreviewSessionFact = {
  sessionKey: string;
  sessionId: string;
  updatedAt: number;
};

export type StructuralPreviewSources = {
  hadTaskActivity: boolean;
  structuralObservation?: TrustedStructuralObservation;
  structuralBaseline?: TrustedStructuralBaseline;
  evidenceRefs: string[];
};

export function workingStyleBaselineHash(style: WorkingStyle): string {
  return `style:${style.outputFormat}:${style.reportingCadence}:${style.decisionPreference}:${style.riskPreference}:${style.communicationTone}`;
}

export function deriveStructuralPreviewSources(input: {
  agentId: string;
  tenantId: string;
  windowStartMs: number;
  windowEndMs: number;
  taskOutcomes: readonly EvolutionTaskOutcomeRecord[];
  sessions: readonly StructuralPreviewSessionFact[];
  skillEvents: readonly SkillInvocationEvent[];
  baseline: WorkingStyle | null;
}): StructuralPreviewSources {
  const agentId = input.agentId.trim();
  const tenantId = input.tenantId.trim();
  const tasks = eligibleTasks(input.taskOutcomes, agentId, tenantId, input);
  const hadTaskActivity = tasks.length > 0;
  const baseline = input.baseline;
  if (!hadTaskActivity || !baseline || baseline.reportingCadence !== "on_completion") {
    return { hadTaskActivity, evidenceRefs: [] };
  }
  const task = tasks[tasks.length - 1];
  const runId = task?.runId?.trim() ?? "";
  const session = latestSession(input.sessions, input);
  const skill = matchingSkill(input.skillEvents, agentId, tenantId, runId, task?.taskId, input);
  if (!task || !runId || !session || !skill) {
    return { hadTaskActivity, evidenceRefs: [] };
  }
  const observationRef = `task-outcome:${agentId}:${runId}`;
  const sessionRef = `session:${agentId}:${session.sessionId}`;
  const skillRef = `skill-invocation:${skill.invocationId}`;
  const evidenceRefs = [observationRef, sessionRef, skillRef];
  if (evidenceRefs.some((ref) => !ref.trim() || isProseDiagnosisEvidenceRef(ref))) {
    return { hadTaskActivity, evidenceRefs: [] };
  }
  const structuralObservation: TrustedStructuralObservation = {
    kind: "task_result",
    observationRef,
    proposedChange: { field: "reportingCadence", value: "milestone" },
  };
  return {
    hadTaskActivity: true,
    structuralObservation,
    structuralBaseline: {
      baselineHash: workingStyleBaselineHash(baseline),
      reportingCadence: baseline.reportingCadence,
    },
    evidenceRefs,
  };
}

export async function loadStructuralPreviewSources(input: {
  cfg: OpenBotConfig;
  agentId: string;
  tenantId: string;
  windowStartMs: number;
  windowEndMs: number;
  skillConfigDir: string;
  sessionStorePath?: string;
}): Promise<StructuralPreviewSources> {
  const baseline = await readRobotWorkingStyle(input.cfg, input.agentId);
  return deriveStructuralPreviewSources({
    agentId: input.agentId,
    tenantId: input.tenantId,
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,
    taskOutcomes: readEvolutionTaskOutcomes(input.cfg, input.agentId),
    sessions: readSessionIndex(input.sessionStorePath),
    skillEvents: readSkillInvocationEvents({
      configDir: input.skillConfigDir,
      agentId: input.agentId,
    }),
    baseline,
  });
}

export function readSessionIndex(sessionStorePath?: string): StructuralPreviewSessionFact[] {
  const filePath = sessionStorePath?.trim() ?? "";
  if (!filePath) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const facts: StructuralPreviewSessionFact[] = [];
  for (const [sessionKey, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const row = value as Record<string, unknown>;
    const sessionId = typeof row.sessionId === "string" ? row.sessionId.trim() : "";
    const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : Number.NaN;
    if (!sessionKey.trim() || !sessionId || !Number.isFinite(updatedAt)) {
      continue;
    }
    facts.push({ sessionKey: sessionKey.trim(), sessionId, updatedAt });
  }
  return facts;
}

function eligibleTasks(
  rows: readonly EvolutionTaskOutcomeRecord[],
  agentId: string,
  tenantId: string,
  window: { windowStartMs: number; windowEndMs: number },
): EvolutionTaskOutcomeRecord[] {
  return rows
    .filter((row) => {
      if (row.agentId !== agentId || row.tenantId !== tenantId) {
        return false;
      }
      if (row.observationEligibility !== "eligible" || row.outcome !== "completed") {
        return false;
      }
      if (!row.succeeded || !row.runId?.trim()) {
        return false;
      }
      if (
        row.crossTenantContamination ||
        row.securityViolation ||
        row.suspectedAuthorizationBypass
      ) {
        return false;
      }
      return row.occurredAt >= window.windowStartMs && row.occurredAt <= window.windowEndMs;
    })
    .toSorted((left, right) => left.occurredAt - right.occurredAt);
}

function latestSession(
  sessions: readonly StructuralPreviewSessionFact[],
  window: { windowStartMs: number; windowEndMs: number },
): StructuralPreviewSessionFact | null {
  const rows = sessions.filter(
    (row) => row.updatedAt >= window.windowStartMs && row.updatedAt <= window.windowEndMs,
  );
  return rows.toSorted((left, right) => left.updatedAt - right.updatedAt).at(-1) ?? null;
}

function matchingSkill(
  events: readonly SkillInvocationEvent[],
  agentId: string,
  tenantId: string,
  runId: string,
  taskId: string | undefined,
  window: { windowStartMs: number; windowEndMs: number },
): { invocationId: string } | null {
  const matches = events.filter((event) => {
    if (event.type !== "skill_invocation_completed") {
      return false;
    }
    if (event.agentId !== agentId || event.tenantId !== tenantId || event.outcome !== "success") {
      return false;
    }
    if (event.completedAt < window.windowStartMs || event.completedAt > window.windowEndMs) {
      return false;
    }
    const bound = event.runId === runId || (taskId && event.taskId === taskId);
    return Boolean(bound && event.invocationId.trim());
  });
  const last = matches.at(-1);
  return last ? { invocationId: last.invocationId.trim() } : null;
}

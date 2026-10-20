/**
 * Machine-readable stopWhen codes. Planner writes them; the runner evaluates
 * them against collected Evidence. Completion is never copied from a fixture.
 */
import type { DiagnosisCompletion, DiagnosticEvidence, EvidenceRequirement } from "./types.js";

export const STOP_WHEN = {
  MESSAGE_NOT_RECEIVED: "messageReceived=false",
  AGENT_NOT_STARTED_CONFIRMED: "agentStarted=false && agent_runner.complete",
  SKILL_NOT_TRIGGERED_CONFIRMED: "skill.started=false && agent.completed",
  ATTRIBUTION_UNCERTAIN_PROBABLE:
    "skill.started=true && attributionResolution∉{identity_tool_name}",
  TOOL_TIMEOUT_CONFIRMED: "tool.timeout=true",
  ROUTE_MISSING_INCONCLUSIVE: "agent_runner.incomplete && route_resolution.missing",
} as const;

export type StopWhenCode = (typeof STOP_WHEN)[keyof typeof STOP_WHEN];

export type CollectionFacts = {
  messageReceived: boolean | null;
  agentStarted: boolean | null;
  agentCompleted: boolean | null;
  agentRunnerComplete: boolean;
  skillStarted: boolean | null;
  weakSkillAttribution: boolean;
  toolTimeout: boolean | null;
  routeMissing: boolean;
};

export function collectFacts(
  collected: readonly DiagnosticEvidence[],
  missing: readonly EvidenceRequirement[],
): CollectionFacts {
  const session = collected.filter((evidence) => evidence.source === "session_store");
  const agent = collected.filter((evidence) => evidence.source === "agent_runner");
  const skill = collected.filter((evidence) => evidence.source === "skill_invocation");
  const tool = collected.filter((evidence) => evidence.source === "tool_runtime");
  return {
    messageReceived: boolFrom(session, "messageReceived"),
    agentStarted: boolFrom(agent, "agentStarted"),
    agentCompleted: boolFrom(agent, "agentCompleted"),
    agentRunnerComplete: agent.some((evidence) => evidence.collection.completeness === "complete"),
    skillStarted: boolFrom(skill, "skillStarted"),
    weakSkillAttribution: skill.some((evidence) => {
      const resolution = evidence.collection.attributionResolution;
      return resolution !== "identity_tool_name" && resolution !== "not_applicable";
    }),
    toolTimeout: boolFrom(tool, "timeout"),
    routeMissing:
      missing.some((req) => req.source === "route_resolution") ||
      !collected.some((evidence) => evidence.source === "route_resolution"),
  };
}

export function evaluateStopWhen(
  code: string,
  facts: CollectionFacts,
): DiagnosisCompletion | "BLOCKED" | null {
  switch (code) {
    case STOP_WHEN.MESSAGE_NOT_RECEIVED:
      return facts.messageReceived === false ? "BLOCKED" : null;
    case STOP_WHEN.AGENT_NOT_STARTED_CONFIRMED:
      return facts.agentStarted === false && facts.agentRunnerComplete ? "CONFIRMED" : null;
    case STOP_WHEN.SKILL_NOT_TRIGGERED_CONFIRMED:
      return facts.skillStarted === false && facts.agentCompleted === true ? "CONFIRMED" : null;
    case STOP_WHEN.ATTRIBUTION_UNCERTAIN_PROBABLE:
      return facts.skillStarted === true && facts.weakSkillAttribution ? "PROBABLE" : null;
    case STOP_WHEN.TOOL_TIMEOUT_CONFIRMED:
      return facts.toolTimeout === true ? "CONFIRMED" : null;
    case STOP_WHEN.ROUTE_MISSING_INCONCLUSIVE:
      return !facts.agentRunnerComplete && facts.routeMissing ? "INCONCLUSIVE" : null;
    default:
      return null;
  }
}

/** First matching stopWhen code, or null if this step should continue collecting. */
export function matchStopWhen(input: {
  stopWhen: readonly string[];
  collected: readonly DiagnosticEvidence[];
  missing: readonly EvidenceRequirement[];
}): DiagnosisCompletion | null {
  const facts = collectFacts(input.collected, input.missing);
  for (const code of input.stopWhen) {
    const verdict = evaluateStopWhen(code, facts);
    if (verdict === "BLOCKED") {
      return "BLOCKED";
    }
    if (verdict) {
      return verdict;
    }
  }
  return null;
}

export function deriveCompletion(input: {
  stopWhen: readonly string[];
  collected: readonly DiagnosticEvidence[];
  missing: readonly EvidenceRequirement[];
}): DiagnosisCompletion {
  return matchStopWhen(input) ?? "INCONCLUSIVE";
}

function boolFrom(evidences: readonly DiagnosticEvidence[], field: string): boolean | null {
  for (const evidence of evidences) {
    const value = evidence.summary[field];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

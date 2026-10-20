/**
 * Evidence Planner — QUICK / TARGETED for the vertical slice.
 * FULL appends Phase 2 read-only Diagnosers. They never enter QUICK.
 * INCIDENT is a reserved protocol token (Phase 3); execution must reject it —
 * never silently map to QUICK or TARGETED.
 * Scheduling unit is Diagnoser × Evidence Source × fields, not "run every diagnoser".
 */
import { isPhase1Collectable } from "./catalog.js";
import { isPhase1Diagnoser } from "./diagnosers.js";
import { isPhase2Diagnoser, isPhase2Readable } from "./phase2.js";
import { STOP_WHEN } from "./stop-when.js";
import {
  validateDiagnosisPlan,
  type DiagnosisPlan,
  type DiagnosisPlanStep,
  type DiagnosticRunMode,
  type DiagnosticTargetType,
  type EvidenceRequirement,
  type EvidenceSourceId,
} from "./types.js";

/** Modes the planner may execute today. INCIDENT stays in DiagnosticRunMode as reserved. */
export const SUPPORTED_PLANNER_RUN_MODES = ["QUICK", "TARGETED", "FULL"] as const;
export type SupportedPlannerRunMode = (typeof SUPPORTED_PLANNER_RUN_MODES)[number];

/**
 * Fail-closed gate: INCIDENT (and any future unsupported token) must not fall through
 * to QUICK/TARGETED. Protocol may still validate/persist the token via DIAGNOSTIC_RUN_MODES.
 */
export function assertSupportedPlannerRunMode(mode: DiagnosticRunMode): SupportedPlannerRunMode {
  if (mode === "QUICK" || mode === "TARGETED" || mode === "FULL") {
    return mode;
  }
  throw new Error(
    `DiagnosticRun.mode ${mode} is reserved/unsupported for planner execution until Phase 3; refusing silent QUICK/TARGETED fallback`,
  );
}

export type PlannerInput = {
  runId: string;
  mode: SupportedPlannerRunMode;
  /** Caller designated a tool Target — skip the "tool candidate still live" gate. */
  toolTargetSpecified?: boolean;
  /** Skill already started, or a tool hypothesis is still live. */
  toolCandidateLive?: boolean;
};

function requirement(
  source: EvidenceSourceId,
  targetType: DiagnosticTargetType,
  fields: string[],
  required = true,
): EvidenceRequirement {
  return {
    schemaVersion: 1,
    evidenceType: source === "agent_runtime_health" ? "snapshot" : "event",
    source,
    targetType,
    fields,
    sensitivity: source === "session_store" ? "restricted" : "internal",
    cost: "low",
    required,
  };
}

function step(input: Omit<DiagnosisPlanStep, "schemaVersion">): DiagnosisPlanStep {
  return { schemaVersion: 1, ...input };
}

export function routeResolutionMissingRequirement(): EvidenceRequirement {
  return requirement(
    "route_resolution",
    "session",
    ["matchedBy", "agentId", "accountId", "sessionKeyHash", "redirectedFromAgentId"],
    true,
  );
}

function buildQuickSteps(input: PlannerInput): DiagnosisPlanStep[] {
  const steps: DiagnosisPlanStep[] = [
    step({
      stepId: "step-q1",
      hypothesisIds: [],
      diagnoserId: "trace-interaction",
      evidenceSourceId: "session_store",
      evidenceRequests: [
        requirement("session_store", "session", [
          "messageReceived",
          "retryCount",
          "sessionKeyHash",
        ]),
      ],
      expectedInformationGain: "medium",
      stopWhen: [STOP_WHEN.MESSAGE_NOT_RECEIVED],
    }),
    step({
      stepId: "step-q2",
      hypothesisIds: ["agent_not_started"],
      diagnoserId: "agent-runtime",
      evidenceSourceId: "agent_runner",
      evidenceRequests: [
        requirement("agent_runner", "run", ["agentStarted", "agentCompleted", "errorClass"]),
        requirement("agent_runtime_health", "agent", ["health"], false),
      ],
      expectedInformationGain: "high",
      stopWhen: [STOP_WHEN.AGENT_NOT_STARTED_CONFIRMED],
    }),
    step({
      stepId: "step-q3",
      hypothesisIds: ["skill_not_triggered"],
      diagnoserId: "skill-runtime",
      evidenceSourceId: "skill_invocation",
      evidenceRequests: [
        requirement("skill_invocation", "skill", ["started", "outcome", "attributionResolution"]),
      ],
      expectedInformationGain: "high",
      stopWhen: [STOP_WHEN.SKILL_NOT_TRIGGERED_CONFIRMED, STOP_WHEN.ATTRIBUTION_UNCERTAIN_PROBABLE],
    }),
  ];

  if (input.toolCandidateLive || input.toolTargetSpecified) {
    steps.push(
      step({
        stepId: "step-q4",
        hypothesisIds: ["tool_timeout"],
        diagnoserId: "tool-runtime",
        evidenceSourceId: "tool_runtime",
        evidenceRequests: [
          requirement("tool_runtime", "tool", ["timeout", "errorClass", "latencyMs"]),
        ],
        expectedInformationGain: "high",
        stopWhen: [STOP_WHEN.TOOL_TIMEOUT_CONFIRMED],
      }),
    );
  }

  steps.push(
    step({
      stepId: "step-q5",
      hypothesisIds: ["agent_not_routed", "agent_not_started"],
      evidenceSourceId: "route_resolution",
      evidenceRequests: [routeResolutionMissingRequirement()],
      expectedInformationGain: "high",
      stopWhen: [STOP_WHEN.ROUTE_MISSING_INCONCLUSIVE],
    }),
  );
  return steps;
}

function buildTargetedSteps(input: PlannerInput): DiagnosisPlanStep[] {
  const steps = buildQuickSteps({ ...input, toolCandidateLive: true });
  steps.push(
    step({
      stepId: "step-t1",
      hypothesisIds: [],
      diagnoserId: "trace-interaction",
      evidenceSourceId: "session_store",
      evidenceRequests: [
        requirement("session_store", "session", [
          "messageReceived",
          "retryCount",
          "sessionKeyHash",
        ]),
      ],
      expectedInformationGain: "medium",
      stopWhen: ["widen timeRange to cover same-session retries (scene 4)"],
    }),
    step({
      stepId: "step-t2",
      hypothesisIds: ["skill_attribution_uncertain"],
      diagnoserId: "skill-runtime",
      evidenceSourceId: "skill_invocation",
      evidenceRequests: [
        requirement("skill_invocation", "skill", [
          "started",
          "attributionResolution",
          "selectedSkillId",
        ]),
      ],
      expectedInformationGain: "medium",
      stopWhen: [
        "unique_owner and prompt_named_use stay unconfirmed identity",
        "must not invent route_resolution events",
      ],
    }),
  );
  return steps;
}

function buildFullSteps(input: PlannerInput): DiagnosisPlanStep[] {
  const steps = buildTargetedSteps(input);
  steps.push(
    step({
      stepId: "step-f1",
      hypothesisIds: [],
      diagnoserId: "runtime-health",
      evidenceSourceId: "agent_runtime_health",
      evidenceRequests: [requirement("agent_runtime_health", "agent", ["health"])],
      expectedInformationGain: "low",
      stopWhen: ["phase2 runtime-health snapshot collected"],
    }),
    step({
      stepId: "step-f2",
      hypothesisIds: [],
      diagnoserId: "channel-delivery",
      evidenceSourceId: "channel_health",
      evidenceRequests: [
        {
          schemaVersion: 1,
          evidenceType: "snapshot",
          source: "channel_health",
          targetType: "channel",
          fields: ["healthy", "reason"],
          sensitivity: "internal",
          cost: "low",
          required: true,
        },
      ],
      expectedInformationGain: "low",
      stopWhen: ["phase2 channel-delivery snapshot collected"],
    }),
    step({
      stepId: "step-f3",
      hypothesisIds: [],
      diagnoserId: "doctor-static",
      evidenceSourceId: "doctor_check",
      evidenceRequests: [
        {
          schemaVersion: 1,
          evidenceType: "config_check",
          source: "doctor_check",
          targetType: "gateway",
          fields: ["checkId", "verdict"],
          sensitivity: "restricted",
          cost: "medium",
          required: true,
        },
      ],
      expectedInformationGain: "medium",
      stopWhen: ["phase2 doctor-static checks collected"],
    }),
  );
  return steps;
}

export function buildDiagnosisPlan(input: PlannerInput): DiagnosisPlan {
  const mode = assertSupportedPlannerRunMode(input.mode);
  const steps =
    mode === "QUICK"
      ? buildQuickSteps({ ...input, mode })
      : mode === "FULL"
        ? buildFullSteps({ ...input, mode })
        : mode === "TARGETED"
          ? buildTargetedSteps({ ...input, mode })
          : (() => {
              const _exhaustive: never = mode;
              throw new Error(`unsupported planner mode: ${String(_exhaustive)}`);
            })();
  for (const planStep of steps) {
    if (planStep.diagnoserId) {
      const phase1 = isPhase1Diagnoser(planStep.diagnoserId);
      const phase2 = isPhase2Diagnoser(planStep.diagnoserId);
      if (mode === "QUICK" && !phase1) {
        throw new Error(`planner scheduled a non-slice Diagnoser: ${planStep.diagnoserId}`);
      }
      if (mode === "TARGETED" && !phase1) {
        throw new Error(`planner scheduled a non-slice Diagnoser: ${planStep.diagnoserId}`);
      }
      if (mode === "FULL" && !phase1 && !phase2) {
        throw new Error(`planner scheduled an unknown Diagnoser: ${planStep.diagnoserId}`);
      }
      if (phase2 && mode === "QUICK") {
        throw new Error(`Phase 2 Diagnoser must not enter QUICK: ${planStep.diagnoserId}`);
      }
    }
    for (const request of planStep.evidenceRequests) {
      if (request.source === "route_resolution") {
        continue;
      }
      if (mode === "FULL" && isPhase2Readable(request.source)) {
        continue;
      }
      if (!isPhase1Collectable(request.source) && request.required) {
        throw new Error(`planner required a non-collectable source: ${request.source}`);
      }
    }
  }
  return validateDiagnosisPlan({
    schemaVersion: 1,
    planId: `plan-${mode.toLowerCase()}-${input.runId}`,
    runId: input.runId,
    mode,
    steps,
  });
}

export function planMissingEvidence(plan: DiagnosisPlan): EvidenceRequirement[] {
  return plan.steps.flatMap((planStep) =>
    planStep.evidenceRequests.filter(
      (request) => request.required && !isPhase1Collectable(request.source),
    ),
  );
}

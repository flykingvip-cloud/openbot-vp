/**
 * Orchestration Plane — offline router-sim metrics (P4.5 shadow).
 *
 * CTR samples with `goldQualification === "long_running_candidate"` are
 * detect/qualify gold, **not** route gold. This pipeline does not invent
 * business surfaces from sample text. For each LRC sample it emits fixed
 * capability-ladder *probes* and scores:
 *   - wrong_surface
 *   - skip_ahead
 *   - missed_human_gate
 *
 * Flags: `shadowOrchestrationFlags` (shadow on, dispatch off). Probe-local
 * overrides may set `nodeEnabled` / `browserEnabled` for the ladder case
 * under test; dispatch stays off. No production flag is flipped.
 */

import {
  CONVERSATION_TASK_SAMPLES,
  type ConversationTaskSample,
} from "../conversation-task/dataset.js";
import { requiresAuthorization, type SideEffectClass } from "../conversation-task/types.js";
import { routeStep } from "./surface-router.js";
import {
  shadowOrchestrationFlags,
  type ExecutionSurface,
  type OrchestrationFlags,
  type RouteStepInput,
  type StepIntent,
  type SurfaceDecision,
  type SurfaceDecisionKind,
} from "./types.js";

export const LRC_GOLD_QUALIFICATION = "long_running_candidate" as const;

export type RouterSimProbeId =
  | "web_read_selected"
  | "read_web_skip_ahead"
  | "interact_web_selected"
  | "interact_web_skip_ahead"
  | "zero_nodes_human_gate"
  | "outbound_human_gate"
  | "broadcast_human_gate"
  | "external_write_human_gate"
  | "gold_side_effect_human_gate";

export type RouterSimScoreKind = "wrong_surface" | "skip_ahead" | "missed_human_gate";

export type RouterSimExpectation = {
  kind: SurfaceDecisionKind;
  surface?: ExecutionSurface;
};

export type RouterSimProbe = {
  id: RouterSimProbeId;
  sampleId: string;
  input: RouteStepInput;
  expected: RouterSimExpectation;
};

export type RouterSimProbeResult = {
  probe: RouterSimProbe;
  decision: SurfaceDecision;
  score: RouterSimScoreKind | null;
};

export type RouterSimReport = {
  sampleCount: number;
  probeCount: number;
  wrongSurface: number;
  skipAhead: number;
  missedHumanGate: number;
  results: readonly RouterSimProbeResult[];
  failures: readonly RouterSimProbeResult[];
};

const AUTH_SIDE_EFFECTS = ["outbound_message", "broadcast", "external_write"] as const;

/** Shadow on, dispatch forced off — offline sim only. */
export function offlineRouterFlags(
  overrides: Partial<OrchestrationFlags> = {},
): OrchestrationFlags {
  return {
    ...shadowOrchestrationFlags(overrides),
    shadowEnabled: true,
    dispatchEnabled: false,
  };
}

export function listLongRunningCandidateSamples(
  samples: readonly ConversationTaskSample[] = CONVERSATION_TASK_SAMPLES,
): ConversationTaskSample[] {
  return samples.filter((sample) => sample.goldQualification === LRC_GOLD_QUALIFICATION);
}

export function sideEffectRouteIntent(sideEffect: SideEffectClass): StepIntent | null {
  switch (sideEffect) {
    case "outbound_message":
      return "send_message";
    case "external_write":
      return "write_external";
    case "broadcast":
      return "broadcast";
    case "none":
      return null;
  }
}

function probe(
  id: RouterSimProbeId,
  sampleId: string,
  input: RouteStepInput,
  expected: RouterSimExpectation,
): RouterSimProbe {
  return { id, sampleId, input, expected };
}

/**
 * Ladder probes for one LRC sample. Not derived from sample text.
 */
export function buildSampleRouterSimProbes(sample: ConversationTaskSample): RouterSimProbe[] {
  const probes: RouterSimProbe[] = [
    probe(
      "web_read_selected",
      sample.id,
      { intent: "read_web", flags: offlineRouterFlags() },
      { kind: "selected", surface: "web_read" },
    ),
    probe(
      "read_web_skip_ahead",
      sample.id,
      {
        intent: "read_web",
        requestedSurface: "browser",
        flags: offlineRouterFlags({ browserEnabled: true }),
      },
      { kind: "blocked_policy" },
    ),
    probe(
      "interact_web_selected",
      sample.id,
      {
        intent: "interact_web",
        flags: offlineRouterFlags({ browserEnabled: true }),
      },
      { kind: "selected", surface: "browser" },
    ),
    probe(
      "interact_web_skip_ahead",
      sample.id,
      {
        intent: "interact_web",
        connectedConnectorIds: ["connected"],
        requestedConnectorId: "connected",
        requestedSurface: "browser",
        flags: offlineRouterFlags({ browserEnabled: true }),
      },
      { kind: "blocked_policy" },
    ),
    probe(
      "zero_nodes_human_gate",
      sample.id,
      {
        intent: "read_user_machine",
        flags: offlineRouterFlags({ nodeEnabled: true }),
        nodeInventory: { boundNodeIds: [], unboundCount: 0 },
      },
      { kind: "human_gate" },
    ),
    probe(
      "outbound_human_gate",
      sample.id,
      { intent: "send_message", flags: offlineRouterFlags() },
      { kind: "human_gate", surface: "outbound_message" },
    ),
    probe(
      "broadcast_human_gate",
      sample.id,
      { intent: "broadcast", flags: offlineRouterFlags() },
      { kind: "human_gate", surface: "broadcast" },
    ),
    probe(
      "external_write_human_gate",
      sample.id,
      { intent: "write_external", flags: offlineRouterFlags() },
      { kind: "human_gate", surface: "external_write" },
    ),
  ];

  // Gold side-effect is authorization gold, not an invented business surface.
  if (requiresAuthorization(sample.goldSideEffect)) {
    const intent = sideEffectRouteIntent(sample.goldSideEffect);
    if (intent) {
      probes.push(
        probe(
          "gold_side_effect_human_gate",
          sample.id,
          { intent, flags: offlineRouterFlags() },
          { kind: "human_gate" },
        ),
      );
    }
  }

  return probes;
}

export function buildRouterSimProbes(
  samples: readonly ConversationTaskSample[] = CONVERSATION_TASK_SAMPLES,
): RouterSimProbe[] {
  return listLongRunningCandidateSamples(samples).flatMap(buildSampleRouterSimProbes);
}

export function scoreRouterDecision(
  expected: RouterSimExpectation,
  decision: SurfaceDecision,
): RouterSimScoreKind | null {
  if (expected.kind === "blocked_policy") {
    return decision.kind === "blocked_policy" ? null : "skip_ahead";
  }
  if (expected.kind === "human_gate") {
    if (decision.kind !== "human_gate") {
      return "missed_human_gate";
    }
    if (expected.surface && decision.surface !== expected.surface) {
      return "wrong_surface";
    }
    return null;
  }
  if (expected.kind === "selected") {
    if (decision.kind !== "selected" || decision.surface !== expected.surface) {
      return "wrong_surface";
    }
    return null;
  }
  if (decision.kind !== expected.kind) {
    return "wrong_surface";
  }
  if (expected.surface && decision.surface !== expected.surface) {
    return "wrong_surface";
  }
  return null;
}

export function evaluateRouterSim(
  samples: readonly ConversationTaskSample[] = CONVERSATION_TASK_SAMPLES,
): RouterSimReport {
  const lrc = listLongRunningCandidateSamples(samples);
  const results: RouterSimProbeResult[] = [];
  let wrongSurface = 0;
  let skipAhead = 0;
  let missedHumanGate = 0;

  for (const sample of lrc) {
    for (const next of buildSampleRouterSimProbes(sample)) {
      const decision = routeStep(next.input);
      const score = scoreRouterDecision(next.expected, decision);
      results.push({ probe: next, decision, score });
      if (score === "wrong_surface") {
        wrongSurface += 1;
      } else if (score === "skip_ahead") {
        skipAhead += 1;
      } else if (score === "missed_human_gate") {
        missedHumanGate += 1;
      }
    }
  }

  return {
    sampleCount: lrc.length,
    probeCount: results.length,
    wrongSurface,
    skipAhead,
    missedHumanGate,
    results,
    failures: results.filter((row) => row.score !== null),
  };
}

export function isAuthSideEffect(
  sideEffect: SideEffectClass,
): sideEffect is (typeof AUTH_SIDE_EFFECTS)[number] {
  return (AUTH_SIDE_EFFECTS as readonly string[]).includes(sideEffect);
}

/**
 * Phase 1 Diagnoser registry.
 * diagnose() runs the vertical-slice runner; it does not copy fixture graphs.
 */
import { diagnoseFromContext } from "./diagnose.js";
import {
  validateDiagnoserManifest,
  type Diagnoser,
  type DiagnoserManifest,
  type EvidenceRequirement,
} from "./types.js";

export const PHASE1_DIAGNOSER_IDS = [
  "trace-interaction",
  "agent-runtime",
  "skill-runtime",
  "tool-runtime",
] as const;

export type Phase1DiagnoserId = (typeof PHASE1_DIAGNOSER_IDS)[number];

function req(
  source: EvidenceRequirement["source"],
  targetType: EvidenceRequirement["targetType"],
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

const MANIFESTS: readonly DiagnoserManifest[] = [
  manifest({
    id: "trace-interaction",
    version: "1.0.0",
    targets: ["session"],
    modes: ["QUICK", "TARGETED"],
    evidenceRequirements: [
      req("session_store", "session", ["messageReceived", "retryCount", "sessionKeyHash"]),
    ],
    produces: ["observation", "assessment"],
    cost: { cpu: "low", io: "low", modelCalls: 0 },
    permissions: ["diagnosis:read"],
    mutation: "none",
  }),
  manifest({
    id: "agent-runtime",
    version: "1.0.0",
    targets: ["agent", "run"],
    modes: ["QUICK", "TARGETED"],
    evidenceRequirements: [
      req("agent_runner", "run", ["agentStarted", "agentCompleted", "errorClass"]),
      req("agent_runtime_health", "agent", ["health"], false),
    ],
    produces: ["observation", "assessment", "hypothesis"],
    cost: { cpu: "low", io: "low", modelCalls: 0 },
    permissions: ["diagnosis:read"],
    mutation: "none",
  }),
  manifest({
    id: "skill-runtime",
    version: "1.0.0",
    targets: ["skill", "run"],
    modes: ["QUICK", "TARGETED"],
    evidenceRequirements: [
      req("skill_invocation", "skill", ["started", "outcome", "attributionResolution"]),
    ],
    produces: ["observation", "assessment", "attribution", "hypothesis"],
    cost: { cpu: "low", io: "low", modelCalls: 0 },
    permissions: ["diagnosis:read"],
    mutation: "none",
  }),
  manifest({
    id: "tool-runtime",
    version: "1.0.0",
    targets: ["tool", "run"],
    modes: ["QUICK", "TARGETED"],
    evidenceRequirements: [req("tool_runtime", "tool", ["timeout", "errorClass", "latencyMs"])],
    produces: ["observation", "assessment", "hypothesis"],
    cost: { cpu: "low", io: "low", modelCalls: 0 },
    permissions: ["diagnosis:read"],
    mutation: "none",
  }),
];

function manifest(input: Omit<DiagnoserManifest, "schemaVersion">): DiagnoserManifest {
  return validateDiagnoserManifest({ schemaVersion: 1, ...input }, `diagnoser.${input.id}`);
}

const BY_ID = new Map(MANIFESTS.map((entry) => [entry.id, entry]));

export function listDiagnoserManifests(): readonly DiagnoserManifest[] {
  return MANIFESTS;
}

export function getDiagnoserManifest(id: string): DiagnoserManifest {
  const found = BY_ID.get(id);
  if (!found) {
    throw new Error(`unknown Phase 1 Diagnoser: ${id}`);
  }
  return found;
}

export function isPhase1Diagnoser(id: string): id is Phase1DiagnoserId {
  return (PHASE1_DIAGNOSER_IDS as readonly string[]).includes(id);
}

export function listPhase1Diagnosers(): readonly Diagnoser[] {
  return MANIFESTS.map((manifest) => ({
    manifest,
    diagnose: diagnoseFromContext,
  }));
}

/**
 * Contract (A / #936): Phase 1 Diagnoser ids are registry metadata only.
 * Every Phase 1 Diagnoser shares diagnoseFromContext → diagnose →
 * replayDiagnosticRunGraph. manifest.id is not an independent algorithm.
 */
export function assertPhase1DiagnosersShareUnifiedRunner(): void {
  const shared = diagnoseFromContext;
  for (const row of listPhase1Diagnosers()) {
    if (row.diagnose !== shared) {
      throw new Error(
        `Phase 1 Diagnoser ${row.manifest.id} must use diagnoseFromContext (unified runner); got a divergent diagnose implementation`,
      );
    }
  }
}

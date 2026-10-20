/**
 * Phase 1 Evidence Source catalog.
 * In-process manifests only — no production store access.
 */
import {
  validateEvidenceSourceManifest,
  type EvidenceSourceId,
  type EvidenceSourceManifest,
} from "./types.js";

/** Sources the Session → Agent → Skill → Tool slice may request. */
export const PHASE1_SLICE_SOURCE_IDS = [
  "session_store",
  "agent_runner",
  "skill_invocation",
  "tool_runtime",
  "agent_runtime_health",
  "route_resolution",
  "evolution_governance",
] as const satisfies readonly EvidenceSourceId[];

export type Phase1SliceSourceId = (typeof PHASE1_SLICE_SOURCE_IDS)[number];

const CATALOG: readonly EvidenceSourceManifest[] = [
  manifest({
    id: "session_store",
    authority: "session store / Session JSONL",
    evidenceTypes: ["event", "transcript_ref"],
    targetTypes: ["session"],
    cost: "low",
    sensitivity: "restricted",
    phase1Safe: true,
  }),
  manifest({
    id: "agent_runner",
    authority: "agent runner / Plugin Hooks / diagnostic-events (read-only observation)",
    evidenceTypes: ["event"],
    targetTypes: ["agent", "run"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: true,
  }),
  manifest({
    id: "skill_invocation",
    authority: "src/gateway/skill-invocation/",
    evidenceTypes: ["event"],
    targetTypes: ["skill", "run"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: true,
  }),
  manifest({
    id: "tool_runtime",
    authority: "before/after Tool Hooks / diagnostic-events (read-only observation)",
    evidenceTypes: ["event"],
    targetTypes: ["tool", "run"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: true,
  }),
  manifest({
    id: "agent_runtime_health",
    authority: "src/gateway/agent-runtime-health.ts",
    evidenceTypes: ["snapshot"],
    targetTypes: ["agent"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: true,
  }),
  // Reserved: no durable route decision store exists. Never claim collect-safe.
  manifest({
    id: "route_resolution",
    authority: "src/routing/resolve-route.ts",
    evidenceTypes: ["event"],
    targetTypes: ["session", "agent"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: false,
  }),
  // Verification receipt references only — not a Diagnosis warehouse.
  manifest({
    id: "evolution_governance",
    authority: "Evolution Governance receipts",
    evidenceTypes: ["metric"],
    targetTypes: ["skill", "tool", "agent"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: true,
  }),
  manifest({
    id: "plugin_hook",
    authority: "src/plugins/types.ts Plugin Hooks",
    evidenceTypes: ["event"],
    targetTypes: ["agent", "run", "tool"],
    cost: "medium",
    sensitivity: "restricted",
    phase1Safe: false,
  }),
  manifest({
    id: "diagnostic_events",
    authority: "src/infra/diagnostic-events.ts",
    evidenceTypes: ["event", "metric"],
    targetTypes: ["session", "run"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: false,
  }),
  manifest({
    id: "channel_health",
    authority: "channel health evaluate (read-only)",
    evidenceTypes: ["snapshot"],
    targetTypes: ["channel"],
    cost: "low",
    sensitivity: "internal",
    phase1Safe: false,
  }),
  manifest({
    id: "doctor_check",
    authority: "src/diagnosis/doctor-check-contract.ts",
    evidenceTypes: ["config_check"],
    targetTypes: ["gateway", "host"],
    cost: "medium",
    sensitivity: "restricted",
    phase1Safe: false,
  }),
  manifest({
    id: "otel_reference",
    authority: "extensions/diagnostics-otel",
    evidenceTypes: ["event"],
    targetTypes: ["run"],
    cost: "medium",
    sensitivity: "internal",
    phase1Safe: false,
  }),
];

function manifest(input: Omit<EvidenceSourceManifest, "schemaVersion">): EvidenceSourceManifest {
  return validateEvidenceSourceManifest({ schemaVersion: 1, ...input }, `catalog.${input.id}`);
}

const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

export function listEvidenceSourceManifests(): readonly EvidenceSourceManifest[] {
  return CATALOG;
}

export function getEvidenceSourceManifest(id: EvidenceSourceId): EvidenceSourceManifest {
  const found = BY_ID.get(id);
  if (!found) {
    throw new Error(`unknown Evidence Source: ${id}`);
  }
  return found;
}

export function isPhase1SliceSource(id: EvidenceSourceId): boolean {
  return (PHASE1_SLICE_SOURCE_IDS as readonly string[]).includes(id);
}

/** True only when the slice may collect from a durable-enough, side-effect-free source. */
export function isPhase1Collectable(id: EvidenceSourceId): boolean {
  return isPhase1SliceSource(id) && getEvidenceSourceManifest(id).phase1Safe;
}

export function isRouteResolutionReserved(id: EvidenceSourceId): boolean {
  return id === "route_resolution";
}

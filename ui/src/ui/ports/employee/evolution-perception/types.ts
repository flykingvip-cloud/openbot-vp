/**
 * Read-only evolution perception rows.
 * Field names follow `@openbot/evolution-core` timeline items and the
 * Gateway payloads from `evolution.perception.query` / `.project`.
 * Claim grade: runtime-enabled. Not production-proven.
 */

export type EvolutionFactIds = {
  ledgerEventId: string;
  proposalId?: string;
  applicationId?: string;
  verificationId?: string;
};

export type EvolutionTarget =
  | { domain: "agent"; agentId: string }
  | { domain: "knowledge"; assetId: string }
  | { domain: "capability"; skillId: string }
  | { domain: "organization"; groupId: string }
  | { domain: "system"; componentId: string };

export type EvolutionChangeObject = {
  target: EvolutionTarget;
  surfaceId: string;
  domain: string;
  domainDisplayName: string;
};

export type EvolutionBeforeAfter = {
  versionBefore?: string;
  versionAfter?: string;
  summary: string;
};

export type EvolutionReason = {
  status: string;
  sourceEvidenceRefs: string[];
  sourceMechanismRef?: string;
  caseId?: string;
  findingIds: string[];
};

export type EvolutionEvidence = {
  evidenceRefs: string[];
  reportId?: string;
  verificationId?: string;
};

export type EvolutionImpactScope = {
  confidentialityScope?: string;
  tenantScope?: string;
  label: string;
};

/** One user-visible change. `system` / platform must not enter 「我学会了」. */
export type EvolutionTimelineItem = {
  schemaVersion: number;
  proposalSchema: number;
  legacy: boolean;
  factIds: EvolutionFactIds;
  audience: string;
  changeObject: EvolutionChangeObject;
  beforeAfter: EvolutionBeforeAfter;
  reason: EvolutionReason;
  executionMode: string;
  evidence: EvolutionEvidence;
  result: string;
  bucket?: string;
  impactScope: EvolutionImpactScope;
  reversible: boolean;
  completeness: string;
};

export type EvolutionAutonomyBudget =
  | { kind: "unavailable"; surfaceId: string }
  | {
      kind: "provided";
      surfaceId: string;
      mode: string;
      maxApplications: number;
      usedApplications: number;
      remainingApplications: number;
      expiresAt?: string;
      killSwitch?: boolean;
    };

export type EvolutionAutomaticAction = {
  item: EvolutionTimelineItem;
  budget: EvolutionAutonomyBudget;
};

export type EvolutionPerceptionNarrationView = {
  learned: string[];
  platform: string[];
  other: string[];
};

export const EMPTY_EVOLUTION_NARRATION: EvolutionPerceptionNarrationView = {
  learned: [],
  platform: [],
  other: [],
};

export type EvolutionPerceptionReadState = "ready" | "empty" | "denied" | "untrusted";

export type EvolutionPerceptionQueryView = {
  state: EvolutionPerceptionReadState;
  intent: string;
  items: EvolutionTimelineItem[];
  platformItems: EvolutionTimelineItem[];
  narration: EvolutionPerceptionNarrationView;
  completeness: string;
  unresolvedIntents: string[];
};

export type EvolutionPerceptionPanels = {
  timeline: EvolutionTimelineItem[];
  learned: EvolutionTimelineItem[];
  digest: EvolutionTimelineItem[];
  pending: EvolutionTimelineItem[];
  automatic: EvolutionAutomaticAction[];
  observation: EvolutionTimelineItem[];
  rollback: EvolutionTimelineItem[];
};

export type EvolutionPerceptionPanelsRead =
  | { status: "denied" }
  | { status: "untrusted" }
  | { status: "loaded"; panels: EvolutionPerceptionPanels };

export type EvolutionPerceptionProjectSlice = {
  operation: string;
  state: EvolutionPerceptionReadState;
  items: EvolutionTimelineItem[];
  learnedItems: EvolutionTimelineItem[];
  actions: EvolutionAutomaticAction[];
  observationItems: EvolutionTimelineItem[];
  observationDigitalHuman: EvolutionTimelineItem[];
  observationPlatform: EvolutionTimelineItem[];
};

export type EvolutionProvenanceField = {
  label: string;
  value: string;
};

export type EvolutionFactDetail = {
  audienceLabel: string;
  isPlatform: boolean;
  fields: EvolutionProvenanceField[];
};

export type EvolutionPerceptionWindow = {
  from: string;
  to: string;
};

export function traceableFactIds(factIds: EvolutionFactIds): string[] {
  return [factIds.ledgerEventId, factIds.proposalId, factIds.applicationId, factIds.verificationId]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0);
}

export function evolutionItemId(item: EvolutionTimelineItem): string {
  return traceableFactIds(item.factIds)[0] ?? "";
}

export function isSystemEvolutionDomain(item: EvolutionTimelineItem): boolean {
  return (
    item.audience === "platform" ||
    item.changeObject.domain === "system" ||
    item.changeObject.target.domain === "system"
  );
}

export function evolutionPanelsAreEmpty(panels: EvolutionPerceptionPanels): boolean {
  return (
    panels.timeline.length === 0 &&
    panels.learned.length === 0 &&
    panels.digest.length === 0 &&
    panels.pending.length === 0 &&
    panels.automatic.length === 0 &&
    panels.observation.length === 0 &&
    panels.rollback.length === 0
  );
}

export function narrationEqualsEmpty(narration: EvolutionPerceptionNarrationView): boolean {
  return (
    narration.learned.length === 0 &&
    narration.platform.length === 0 &&
    narration.other.length === 0
  );
}

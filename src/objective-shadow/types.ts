/**
 * Phase 2 Objective Resolver shadow — observation types only.
 * Observation DTO only. definitionEpoch is always 0; nothing is persisted as a Work Unit.
 */

export const OBJECTIVE_SHADOW_SCHEMA = "objective-shadow/v1" as const;

export type ObjectiveSource =
  | "cron"
  | "conversation_task"
  | "legacy_context"
  | "inbound_turn"
  | "collaboration";

export type ShadowIngress =
  | "cron_isolated"
  | "chat"
  | "collaboration_turn"
  | "subagent"
  | "heartbeat"
  | "gateway_agent"
  | "acp";

export type ShadowCandidate = {
  source: ObjectiveSource;
  objectiveId?: string;
  revision?: number;
};

export type ShadowObserveInput = {
  schemaVersion: typeof OBJECTIVE_SHADOW_SCHEMA;
  tenantId: string;
  ingress: ShadowIngress;
  runId: string;
  parentRunId?: string;
  cronOccurrenceId?: string;
  groupId?: string;
  candidates: ShadowCandidate[];
  observedAtMs: number;
  /** Ingress adapter errors (e.g. identified tenant missing). Never fabricated objectives. */
  inputErrors?: string[];
};

export type ResolveStatus =
  | "resolved"
  | "conflict"
  | "allowlist_rejected"
  | "skipped"
  | "out_of_scope";

export type ProposedDisposition = "generated" | "rejected" | "discarded";

export type ProposedWorkUnitDefinition = {
  workUnitId: string;
  objectiveId: string;
  objectiveRevision: number;
  coordinationPolicy: "exclusive" | "shared";
  contributionKind: "execute" | "research" | "review" | "synthesis";
  required: boolean;
  acceptanceIds: string[];
  dependsOnWorkUnitIds: string[];
  coversWorkUnitIds: string[];
  minContributors: number;
  maxContributors: number;
  createdByKind: "runtime" | "participant" | "orchestrator";
  definitionEpoch: 0;
};

export type ShadowMetrics = {
  candidateCount: number;
  allowedCandidateCount: number;
  forbiddenCandidateCount: number;
  sourceConflict: 0 | 1;
  allowlistRejected: 0 | 1;
  allowlistIgnoredForbidden: 0 | 1;
  inheritViolation: 0 | 1;
  proposedGenerated: number;
  proposedRejected: number;
  proposedDiscarded: number;
  forbiddenWriteAttempts: 0 | 1;
};

export type FrozenSnapshot = {
  objectiveId: string;
  revision: number;
  source: ObjectiveSource;
};

export type ShadowObserveRecord = {
  schemaVersion: typeof OBJECTIVE_SHADOW_SCHEMA;
  recordId: string;
  observedAtMs: number;
  correlation: {
    runId: string;
    parentRunId?: string;
    cronOccurrenceId?: string;
    ingress: ShadowIngress;
    tenantHash: string;
    groupHash?: string;
    objectiveId?: string;
    revision?: number;
    source?: ObjectiveSource;
  };
  resolveStatus: ResolveStatus;
  conflictCodes: string[];
  proposed: ProposedWorkUnitDefinition[];
  proposedDisposition: ProposedDisposition;
  rejectOrDiscardCodes: string[];
  metrics: ShadowMetrics;
};

export type ShadowRuntimeResult = {
  enabled: boolean;
  wrote: boolean;
  record?: ShadowObserveRecord;
  reason?: string;
};

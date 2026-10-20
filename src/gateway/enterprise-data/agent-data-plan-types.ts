// Agent Data Planner + Context Broker — shared types.
// Spec: .kiro/specs/agent-data-planner/{requirements,design}.md
//
// A DataPlan is a Metadata-First, authorization-aware fetch plan: given a task intent
// and a resolved seat context, it says WHICH canonical objects to fetch, VIA WHICH
// capability, and WHICH fields — all within the seat's grant scope. It NEVER contains
// business data values; execution is delegated to the existing W5 invoke bridge.

import type { SemanticFieldType, SemanticObjectKind } from "./semantic-object-types.js";
import type {
  ConnectorActionRef,
  DataClassification,
  EnterpriseKnowledgeObjectKind,
  EnterpriseKnowledgeProjectionCategory,
  EnterpriseKnowledgeProjectionLifecycle,
} from "./types.js";

/** Whether the seat is already authorized for the step's capability, or must request it. */
export type DataPlanAccessState = "granted" | "requestable";

/** Whether a semantic object resolved to an executable capability. */
export type DataPlanStepStatus = "resolved" | "unbindable" | "no-capability";

/** Why a step could not be resolved to an executable capability. */
export type DataPlanUnresolvedReason = "no-binding" | "no-capability" | "capability-disabled";

/** One canonical field the plan intends to fetch (describes structure, holds no value). */
export type DataPlanFieldSelection = {
  fieldKey: string;
  displayName: string;
  type: SemanticFieldType;
  /** Present when the field is classified — CONFIDENTIAL implies downstream masking applies. */
  classification?: DataClassification;
  /** For type=reference: the objectKey this field points to. */
  referenceObjectKey?: string;
};

/** One planned fetch — one canonical (semantic) object. */
export type DataPlanStep = {
  objectKey: string;
  objectKind: SemanticObjectKind;
  displayName: string;
  status: DataPlanStepStatus;
  /** Canonical fields to fetch (subject to classificationCeiling). */
  fields: DataPlanFieldSelection[];
  // ── present when status === "resolved" ──
  capabilityId?: string;
  capabilityKey?: string;
  capabilityTitle?: string;
  accessState?: DataPlanAccessState;
  /** The semantic object source binding that resolved the capability. */
  bindingId?: string;
  sourceIds?: string[];
  actionRefs?: ConnectorActionRef[];
  // ── present when status !== "resolved" ──
  reason?: DataPlanUnresolvedReason;
  note?: string;
};

export type DataPlanSummary = {
  totalObjects: number;
  resolved: number;
  granted: number;
  requestable: number;
  unresolved: number;
};

/** The authorized, metadata-first fetch plan produced by the planner. */
export type DataPlan = {
  tenantId: string;
  seatId: string;
  taskHint?: string;
  createdAt: string;
  steps: DataPlanStep[];
  summary: DataPlanSummary;
};

/** Identity slice of a context pack — derived from the trusted seat context. */
export type AgentContextIdentity = {
  tenantId: string;
  seatId: string;
  employeeId?: string;
  roleCode?: string;
  departmentId?: string;
  teamLabel?: string;
  agentId?: string;
};

/** Compact reference to a capability the plan touches. */
export type AgentContextCapabilityRef = {
  capabilityId: string;
  capabilityKey: string;
  title: string;
  accessState: DataPlanAccessState;
  sourceSystems: string[];
};

/** Metadata reference to a knowledge projection relevant to the plan (no payload). */
export type AgentKnowledgeProjectionRef = {
  projectionId: string;
  projectionKey: string;
  displayName: string;
  category: EnterpriseKnowledgeProjectionCategory;
  objectKind: EnterpriseKnowledgeObjectKind;
  lifecycle: EnterpriseKnowledgeProjectionLifecycle;
};

/** The authorized context bundle the Context Broker assembles for one agent turn. */
export type AgentContextPack = {
  identity: AgentContextIdentity;
  dataPlan: DataPlan;
  authorizedCapabilities: AgentContextCapabilityRef[];
  knowledgeProjections: AgentKnowledgeProjectionRef[];
};

/**
 * Structural minimum the planner needs from a seat context. Both
 * TrustedEnterpriseDataExecutionContext and ScopeEvaluationContext satisfy it, so the
 * pure planner stays decoupled from any concrete execution-context type.
 */
export type PlannerSeatContext = {
  tenantId: string;
  seatId: string;
  employeeId?: string;
  teamLabel?: string;
  roleCode?: string;
  departmentId?: string;
  agentId?: string;
};

/** Task intent + optional hints that steer deterministic relevance resolution. */
export type DataPlanRequest = {
  /** Free-text task intent; keyword-matched against object/field names when no explicit hints. */
  task?: string;
  /** Explicit object keys to plan for (highest-priority hint). */
  objectKeys?: string[];
  /** Explicit object kinds to plan for. */
  objectKinds?: SemanticObjectKind[];
  /** Least-privilege cap: exclude fields classified above this level. */
  classificationCeiling?: DataClassification;
  /** Include non-active (draft/deprecated) objects. Default: active only. */
  includeInactive?: boolean;
  /** Cap the number of objects planned (guards prompt/plan bloat). */
  maxObjects?: number;
};

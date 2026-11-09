import { COLLABORATION_POLICY_PROTOCOL_VERSION } from "../../agent-runtime/policy/index.js";
import type { CollaborationModeTemplateId, PolicyClamp } from "../../agent-runtime/policy/index.js";
import type { CollaborationEventKey } from "./collaboration-event-key.js";
/**
 * Collaboration Policy v1.1 — governance source types.
 *
 * The effective-policy model and compiler live in agent-runtime policy.
 * This host keeps the decision record, which still carries an event key and a diagnosis payload.
 *
 * docs/design/collaboration-governance-protocol-v1.1-2026-09-03.md
 */

export {
  COLLABORATION_POLICY_PROTOCOL_VERSION,
  MODE_TEMPLATES,
  OBSERVER_PERMISSIONS,
  SYSTEM_INVARIANTS,
} from "../../agent-runtime/policy/index.js";
export type {
  ActorCapability,
  CollaborationModeTemplateId,
  CollaborationReplyLanguagePreference,
  CollaborationTaskState,
  DecisionMode,
  DeepProvenance,
  DispatchTuning,
  EffectiveCollaborationPolicy,
  EffectiveContextPolicy,
  EffectivePolicyProvenance,
  EffectivePolicyValue,
  FloorBudgets,
  FloorOpenness,
  FloorProtocol,
  FloorTuning,
  GovernanceRole,
  GovernanceTaskPolicy,
  GroupPolicyInput,
  LowSignalStrategy,
  ModeTemplate,
  ObserverPermissionMatrix,
  PolicyClamp,
  PolicyValueSource,
  SystemInvariants,
  TargetRoundState,
  TaskHandoff,
  TaskResponsibility,
} from "../../agent-runtime/policy/index.js";

export type PolicyDecisionParticipant = {
  agentId: string;
  tier: "primary" | "contributor" | "reviewer" | "coordinator" | "wrap";
  reason: string;
};

/** One Cheap Gate verdict for a supplement / edge-target candidate (diagnostics). */
export type SupplementGateEntry = {
  agentId: string;
  decision: "KEEP" | "REVIEW" | "DROP";
  reason: string;
  relevance?: number;
  invited?: boolean;
  edgeKind?: string;
};

/** Why these bots were scheduled. Not the Collaboration Ledger. */
export type PolicyDecisionRecord = {
  roundId: string;
  protocolVersion: typeof COLLABORATION_POLICY_PROTOCOL_VERSION;
  effectivePolicyHash: string;
  mode: CollaborationModeTemplateId;
  policyConstraints: readonly PolicyClamp[];
  participants: PolicyDecisionParticipant[];
  /** Why the supplement window did / did not open after the primary. */
  supplementWindow?: {
    opened: boolean;
    reason: "conclusion" | "invited" | "no_conclusion" | "not_allowed";
  };
  /** Per-candidate Cheap Gate verdicts, including drop reasons. */
  supplementGate?: SupplementGateEntry[];
  /**
   * Optional compatible diagnosis (phase-1 discuss→task). Legacy rounds omit it
   * and must still load. Does not change budget rules.
   */
  supplementDenialDiagnosis?: import("./supplement-denial-diagnosis.js").SupplementDenialDiagnosis;
  /** P0.0b: CollaborationEventKey (only appended; legacy records may omit). */
  key?: CollaborationEventKey;
};

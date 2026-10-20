/**
 * Maps a decision action onto an existing control-plane method name.
 * The mapping does not call that method and does not call an Adapter.
 */
import {
  isEvolutionDecisionAction,
  type EvolutionDecisionAction,
  type EvolutionDecisionEndpoint,
} from "./dto.js";

/**
 * No existing RPC accepts `authorize`. `approve_application` maps to
 * `evolution.applications.approve` (ledger authority only; no promote).
 */
export const EVOLUTION_DECISION_UNAVAILABLE_ACTIONS = ["authorize"] as const;

export const EVOLUTION_DECISION_ENDPOINT_ACTIONS: {
  readonly [Endpoint in EvolutionDecisionEndpoint]: readonly EvolutionDecisionAction[];
} = {
  employee: ["hold", "reject", "rollback", "employee_final_authorization"],
  enterprise: [
    "hold",
    "reject",
    "rollback",
    "start_experiment",
    "approve_application",
    "apply_canary",
    "verify",
    "promote",
    "participate_canary",
  ],
  platform: [
    "hold",
    "reject",
    "rollback",
    "start_experiment",
    "approve_application",
    "apply_canary",
    "verify",
    "promote",
  ],
};

/** Case handling on a redacted cross-tenant escalation. Not a surface mutation. */
export const EVOLUTION_DECISION_CROSS_TENANT_CASE_ACTIONS = ["hold", "reject"] as const;

export function evolutionDecisionEndpointAllows(
  audience: EvolutionDecisionEndpoint,
  action: EvolutionDecisionAction,
): boolean {
  return EVOLUTION_DECISION_ENDPOINT_ACTIONS[audience].includes(action);
}

export type EvolutionDecisionSurfaceOperation =
  | "suggest"
  | "experiment"
  | "hold"
  | "reject"
  | "apply"
  | "verify"
  | "promote"
  | "rollback"
  | "observe";

export type EvolutionDecisionControlPlaneMapping = {
  action: EvolutionDecisionAction;
  surfaceOperation: EvolutionDecisionSurfaceOperation;
  controlPlaneMethod: string;
  gatewayMethod: string;
  callsAdapter: false;
  perceptionWrite: false;
};

const ADAPTER_ACTION_IDS = [
  "working-dna",
  "capsule",
  "skill",
  "skill-installation",
  "organization",
  "runtime-governance",
  "managed-memory",
  "diagnosis-contract",
] as const;

const PERCEPTION_ACTIONS = ["evolution.perception.query", "evolution.perception.project"] as const;

type AvailableEvolutionDecisionAction = Exclude<
  EvolutionDecisionAction,
  (typeof EVOLUTION_DECISION_UNAVAILABLE_ACTIONS)[number]
>;

const MAPPINGS: {
  [Action in AvailableEvolutionDecisionAction]: Omit<
    EvolutionDecisionControlPlaneMapping,
    "action" | "callsAdapter" | "perceptionWrite"
  >;
} = {
  start_experiment: {
    surfaceOperation: "experiment",
    controlPlaneMethod: "EvolutionControlPlane.startExperiment",
    gatewayMethod: "evolution.experiments.create",
  },
  approve_application: {
    surfaceOperation: "apply",
    controlPlaneMethod: "approveApplicationAuthority",
    gatewayMethod: "evolution.applications.approve",
  },
  hold: {
    surfaceOperation: "hold",
    controlPlaneMethod: "EvolutionControlPlane.holdProposal",
    gatewayMethod: "evolution.proposals.transition",
  },
  reject: {
    surfaceOperation: "reject",
    controlPlaneMethod: "EvolutionControlPlane.rejectProposal",
    gatewayMethod: "evolution.proposals.transition",
  },
  apply_canary: {
    surfaceOperation: "apply",
    controlPlaneMethod: "EvolutionControlPlane.apply",
    gatewayMethod: "evolution.applications.apply",
  },
  verify: {
    surfaceOperation: "verify",
    controlPlaneMethod: "EvolutionControlPlane.verifyApplication",
    gatewayMethod: "evolution.applications.verify",
  },
  promote: {
    surfaceOperation: "promote",
    controlPlaneMethod: "EvolutionControlPlane.promoteProposal",
    gatewayMethod: "evolution.proposals.transition",
  },
  rollback: {
    surfaceOperation: "rollback",
    controlPlaneMethod: "EvolutionControlPlane.rollbackApplication",
    gatewayMethod: "evolution.applications.rollback",
  },
  participate_canary: {
    surfaceOperation: "observe",
    controlPlaneMethod: "DiagnosisDelegationMachine.approve",
    gatewayMethod: "evolution.delegation.approve",
  },
  employee_final_authorization: {
    surfaceOperation: "observe",
    controlPlaneMethod: "DiagnosisDelegationMachine.approve",
    gatewayMethod: "evolution.delegation.approve",
  },
};

export type EvolutionDecisionActionRefusal =
  | "adapter_forbidden"
  | "perception_readonly"
  | "daibai_chat_not_approval"
  | "unmapped_action"
  | "control_plane_action_unavailable";

export function classifyEvolutionDecisionActionToken(
  action: string,
):
  | { ok: true; action: EvolutionDecisionAction }
  | { ok: false; code: EvolutionDecisionActionRefusal } {
  if ((ADAPTER_ACTION_IDS as readonly string[]).includes(action)) {
    return { ok: false, code: "adapter_forbidden" };
  }
  if ((PERCEPTION_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, code: "perception_readonly" };
  }
  if (action === "daibai_chat_approve") {
    return { ok: false, code: "daibai_chat_not_approval" };
  }
  if (!isEvolutionDecisionAction(action)) {
    return { ok: false, code: "unmapped_action" };
  }
  if ((EVOLUTION_DECISION_UNAVAILABLE_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, code: "control_plane_action_unavailable" };
  }
  return { ok: true, action };
}

export function mapEvolutionDecisionCommand(
  action: string,
):
  | { ok: true; mapping: EvolutionDecisionControlPlaneMapping }
  | { ok: false; code: EvolutionDecisionActionRefusal } {
  const classified = classifyEvolutionDecisionActionToken(action);
  if (!classified.ok) {
    return classified;
  }
  if ((EVOLUTION_DECISION_UNAVAILABLE_ACTIONS as readonly string[]).includes(classified.action)) {
    return { ok: false, code: "control_plane_action_unavailable" };
  }
  const row = MAPPINGS[classified.action as AvailableEvolutionDecisionAction];
  return {
    ok: true,
    mapping: {
      action: classified.action,
      ...row,
      callsAdapter: false,
      perceptionWrite: false,
    },
  };
}

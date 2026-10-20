/**
 * Phase D1 decision DTOs.
 *
 * These types project the existing control plane. They are not a second
 * Proposal store or state machine.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import type {
  EvolutionConfidentialityScope,
  EvolutionProposalStatus,
  EvolutionRiskLevel,
  EvolutionTarget,
} from "../types.js";

export const EVOLUTION_DECISION_SCHEMA_VERSION = 1 as const;

export const EVOLUTION_DECISION_STATUSES = ["pending", "resolved", "expired", "blocked"] as const;
export type EvolutionDecisionStatus = (typeof EVOLUTION_DECISION_STATUSES)[number];

export const EVOLUTION_DECISION_ENDPOINTS = ["employee", "enterprise", "platform"] as const;
export type EvolutionDecisionEndpoint = (typeof EVOLUTION_DECISION_ENDPOINTS)[number];

export const EVOLUTION_DECISION_OUTCOMES = [
  "accepted",
  "rejected",
  "blocked",
  "idempotent_replay",
] as const;
export type EvolutionDecisionOutcome = (typeof EVOLUTION_DECISION_OUTCOMES)[number];

export const EVOLUTION_DECISION_ACTIONS = [
  "authorize",
  "start_experiment",
  "hold",
  "reject",
  "approve_application",
  "apply_canary",
  "verify",
  "promote",
  "rollback",
  "participate_canary",
  "employee_final_authorization",
] as const;
export type EvolutionDecisionAction = (typeof EVOLUTION_DECISION_ACTIONS)[number];

/**
 * Participation confirmations. Every other command changes control-plane
 * state and must carry a non-empty expectedVersion.
 */
export const EVOLUTION_DECISION_VERSIONLESS_ACTIONS = [
  "participate_canary",
  "employee_final_authorization",
] as const;

export function evolutionDecisionActionRequiresVersion(action: EvolutionDecisionAction): boolean {
  return !(EVOLUTION_DECISION_VERSIONLESS_ACTIONS as readonly string[]).includes(action);
}

export const EVOLUTION_DECISION_TYPES = [
  "authorize_experiment",
  "approve_application",
  "hold_or_resume",
  "verify_effect",
  "promote",
  "rollback",
  "canary_participation",
  "employee_final_authorization",
] as const;
export type EvolutionDecisionType = (typeof EVOLUTION_DECISION_TYPES)[number];

export const EVOLUTION_DECISION_REQUIRED_AUTHORITIES = [
  "employee",
  "enterprise",
  "platform",
  "platform_and_enterprise",
  "employee_and_enterprise",
] as const;
export type EvolutionDecisionRequiredAuthority =
  (typeof EVOLUTION_DECISION_REQUIRED_AUTHORITIES)[number];

export const EVOLUTION_DECISION_PARTICIPATIONS = [
  "none",
  "enterprise_canary",
  "employee_final_authorization",
] as const;
export type EvolutionDecisionParticipation = (typeof EVOLUTION_DECISION_PARTICIPATIONS)[number];

/** Top-level command keys a client may send. */
export const EVOLUTION_DECISION_COMMAND_FIELDS = [
  "commandId",
  "decisionId",
  "action",
  "expectedVersion",
] as const;

/**
 * Client-supplied authority or evidence. Presence alone is a refusal;
 * the value is never read as identity.
 */
export const EVOLUTION_DECISION_CLIENT_FORBIDDEN_FIELDS = [
  "tenantId",
  "enterpriseId",
  "trustedTenantId",
  "principalRef",
  "role",
  "audience",
  "enterpriseAdmin",
  "platformOperator",
  "ownerId",
  "ownerAgentId",
  "ownerAssetId",
  "approval",
  "grant",
  "delegation",
  "adapter",
  "adapterParams",
  "evidence",
  "sourceEvidenceRefs",
  "messageText",
] as const;

export const EVOLUTION_DECISION_SURFACE_WRITES = Object.freeze([] as const);

export const RESERVED_ENGINEERING_REMEDIATION_SURFACE_ID =
  "system.engineering-remediation" as const;

export type EvolutionDecisionItem = {
  schemaVersion: 1;
  decisionId: string;
  /** Server-projected decision version. Replay must match this value. */
  decisionVersion: string;
  tenantScope: string | null;
  target: EvolutionTarget;
  surfaceId: string;
  sourceCaseId?: string;
  sourceFindingIds: readonly string[];
  sourceEvidenceRefs: readonly string[];
  proposalId?: string;
  experimentId?: string;
  applicationId?: string;
  verificationId?: string;
  decisionType: EvolutionDecisionType;
  requiredAuthority: EvolutionDecisionRequiredAuthority;
  allowedActions: readonly EvolutionDecisionAction[];
  status: EvolutionDecisionStatus;
  expiresAt?: string;
  evidenceAccessGrantRef?: string;
  delegationGrantRef?: string;
  riskLevel: EvolutionRiskLevel;
  confidentialityScope: EvolutionConfidentialityScope;
};

export type EvolutionDecisionCommand = {
  commandId: string;
  decisionId: string;
  action: EvolutionDecisionAction;
  expectedVersion: string;
};

export type EvolutionDecisionReceipt = {
  commandId: string;
  decisionId: string;
  action: string;
  outcome: EvolutionDecisionOutcome;
  controlPlaneRef?: string;
  /** Not a Ledger event and not an effect proof. */
  auditReceiptRef: string;
};

export type EvolutionDecisionPrincipal = {
  audience: EvolutionDecisionEndpoint;
  trustedTenantId: string | null;
  platformOperator: boolean;
  enterpriseAdmin: boolean;
  ownerAgentId?: string;
  ownerAssetId?: string;
};

export type EvolutionDecisionAuthorityFacts = {
  enterpriseCanaryAcknowledged: boolean;
  employeeFinalAuthorization: boolean;
};

const RESOLVED_PROPOSAL_STATUSES = new Set<EvolutionProposalStatus>([
  "REJECTED",
  "ROLLED_BACK",
  "PROMOTED",
  "REVOKED",
]);

export function isEvolutionDecisionAction(value: string): value is EvolutionDecisionAction {
  return (EVOLUTION_DECISION_ACTIONS as readonly string[]).includes(value);
}

export function projectEvolutionDecisionStatus(input: {
  proposalStatus: EvolutionProposalStatus | null;
  expiresAt?: string;
  now: string;
  authorityBlocked: boolean;
}): EvolutionDecisionStatus {
  if (input.expiresAt !== undefined) {
    const expiresAt = Date.parse(input.expiresAt);
    const now = Date.parse(input.now);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || now >= expiresAt) {
      return "expired";
    }
  }
  if (input.proposalStatus === "EXPIRED") {
    return "expired";
  }
  if (input.proposalStatus === null || input.authorityBlocked) {
    return "blocked";
  }
  if (RESOLVED_PROPOSAL_STATUSES.has(input.proposalStatus)) {
    return "resolved";
  }
  return "pending";
}

export function evolutionDecisionCommandExpired(
  item: Pick<EvolutionDecisionItem, "status" | "expiresAt">,
  now: string,
): boolean {
  if (item.status === "expired") {
    return true;
  }
  return (
    projectEvolutionDecisionStatus({
      proposalStatus: "EXPERIMENTING",
      expiresAt: item.expiresAt,
      now,
      authorityBlocked: false,
    }) === "expired"
  );
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readEvolutionDecisionCommand(payload: Record<string, unknown>):
  | { ok: true; command: EvolutionDecisionCommand }
  | {
      ok: false;
      code: "client_authority_forbidden" | "invalid_command" | "version_required";
      actionToken?: string;
    } {
  const keys = Object.keys(payload);
  if (
    keys.some((key) =>
      (EVOLUTION_DECISION_CLIENT_FORBIDDEN_FIELDS as readonly string[]).includes(key),
    )
  ) {
    return { ok: false, code: "client_authority_forbidden" };
  }
  if (keys.some((key) => !(EVOLUTION_DECISION_COMMAND_FIELDS as readonly string[]).includes(key))) {
    return { ok: false, code: "invalid_command" };
  }
  const commandId = readString(payload.commandId);
  const decisionId = readString(payload.decisionId);
  const actionToken = readString(payload.action);
  if (!commandId || !decisionId || !actionToken) {
    return { ok: false, code: "invalid_command", ...(actionToken ? { actionToken } : {}) };
  }
  if (!isEvolutionDecisionAction(actionToken)) {
    return { ok: false, code: "invalid_command", actionToken };
  }
  const versionless = !evolutionDecisionActionRequiresVersion(actionToken);
  let expectedVersion: string;
  if (payload.expectedVersion === undefined) {
    if (!versionless) {
      return { ok: false, code: "version_required" };
    }
    expectedVersion = "";
  } else {
    const parsedVersion = readString(payload.expectedVersion);
    if (parsedVersion === null) {
      return { ok: false, code: versionless ? "invalid_command" : "version_required" };
    }
    expectedVersion = parsedVersion;
  }
  return {
    ok: true,
    command: { commandId, decisionId, action: actionToken, expectedVersion },
  };
}

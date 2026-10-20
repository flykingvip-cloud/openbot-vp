import type {
  AuthorizationGrant,
  DelegationActor,
  DiagnosisDelegationMachine,
} from "../../diagnosis/delegation.js";
import type { DiagnosticPrincipal, TrustedTenantContext } from "../../diagnosis/types.js";

export const EVOLUTION_GRANT_PURPOSE_PREFIX = "evolution-grant:";

export const EVOLUTION_GRANT_ALLOWED_ACTIONS = [
  "diagnose",
  "suggest",
  "inspect",
  "experiment",
  "apply",
  "verify",
  "promote",
  "rollback",
] as const;

export type EvolutionGrantMetadata = {
  schemaVersion: 1;
  grantVersion: 1;
  tenantId: string;
  agentId: string;
  proposalId?: string;
  surfaceId: "agent.working-dna";
};

export function encodeEvolutionGrantPurpose(metadata: EvolutionGrantMetadata): string {
  return `${EVOLUTION_GRANT_PURPOSE_PREFIX}${JSON.stringify(metadata)}`;
}

export function parseEvolutionGrantPurpose(purpose: string): EvolutionGrantMetadata | null {
  if (!purpose.startsWith(EVOLUTION_GRANT_PURPOSE_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      purpose.slice(EVOLUTION_GRANT_PURPOSE_PREFIX.length),
    ) as EvolutionGrantMetadata;
    if (parsed.schemaVersion !== 1 || parsed.grantVersion !== 1) {
      return null;
    }
    if (!parsed.tenantId || !parsed.agentId || parsed.surfaceId !== "agent.working-dna") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function assertEvolutionGrantBinding(input: {
  grant: AuthorizationGrant;
  tenantId: string;
  agentId: string;
  proposalId?: string;
}): { ok: true } | { ok: false; reason: string } {
  const metadata = parseEvolutionGrantPurpose(input.grant.purpose);
  if (!metadata) {
    return { ok: false, reason: "grant is not an evolution working-dna grant" };
  }
  if (metadata.tenantId !== input.tenantId) {
    return { ok: false, reason: "grant tenant does not match request tenant" };
  }
  if (metadata.agentId !== input.agentId) {
    return { ok: false, reason: "grant agent does not match request agent" };
  }
  if (metadata.proposalId && input.proposalId && metadata.proposalId !== input.proposalId) {
    return { ok: false, reason: "grant proposal binding does not match proposal" };
  }
  if (input.grant.targetTenant !== input.tenantId) {
    return { ok: false, reason: "grant target tenant mismatch" };
  }
  if (input.grant.targetScope.targetId && input.grant.targetScope.targetId !== input.agentId) {
    return { ok: false, reason: "grant target agent mismatch" };
  }
  return { ok: true };
}

/** platform_to_enterprise request uses platform trusted context (tenantId null). */
export function resolveEvolutionGrantRequestTrusted(input: {
  issuer: DelegationActor;
  trusted: TrustedTenantContext;
}): TrustedTenantContext {
  return input.issuer.role === "platform" ? { tenantId: null } : input.trusted;
}

export function requestEvolutionWorkingDnaGrant(input: {
  machine: DiagnosisDelegationMachine;
  commandId: string;
  trusted: TrustedTenantContext;
  issuer: DelegationActor;
  approver: DelegationActor;
  grantee: DelegationActor;
  tenantId: string;
  agentId: string;
  proposalId?: string;
  evidenceRefs: string[];
  expiresAt: string;
}): { grantId: string; receipt: ReturnType<DiagnosisDelegationMachine["dispatch"]> } {
  const metadata: EvolutionGrantMetadata = {
    schemaVersion: 1,
    grantVersion: 1,
    tenantId: input.tenantId,
    agentId: input.agentId,
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    surfaceId: "agent.working-dna",
  };
  const requestTrusted = resolveEvolutionGrantRequestTrusted({
    issuer: input.issuer,
    trusted: input.trusted,
  });
  const receipt = input.machine.dispatch({
    commandId: input.commandId,
    command: "request",
    trusted: requestTrusted,
    actor: input.issuer,
    scenario: "platform_to_enterprise",
    approver: input.approver,
    grantee: input.grantee,
    targetTenant: input.tenantId,
    targetScope: {
      tenantId: input.tenantId,
      targetType: "agent",
      targetId: input.agentId,
    },
    allowedEvidence: input.evidenceRefs,
    allowedActions: [...EVOLUTION_GRANT_ALLOWED_ACTIONS],
    purpose: encodeEvolutionGrantPurpose(metadata),
    expiresAt: input.expiresAt,
    canSubdelegate: false,
    oneShot: false,
  });
  if (!receipt.grantId) {
    throw new Error(receipt.reason ?? "grant request failed");
  }
  return { grantId: receipt.grantId, receipt };
}

export function approveEvolutionGrant(input: {
  machine: DiagnosisDelegationMachine;
  commandId: string;
  trusted: TrustedTenantContext;
  approver: DelegationActor;
  grantId: string;
}): ReturnType<DiagnosisDelegationMachine["dispatch"]> {
  return input.machine.dispatch({
    commandId: input.commandId,
    command: "approve",
    trusted: input.trusted,
    actor: input.approver,
    grantId: input.grantId,
  });
}

export function evolutionGrantActorFromPrincipal(
  principal: DiagnosticPrincipal,
  role: DelegationActor["role"],
): DelegationActor {
  return { role, principal };
}

/**
 * Phase 8 — governed EvolutionProposal bridge from authorized diagnosis/consult.
 * Projects Skill / Working DNA / Capsule / Fabric / Governance candidates only.
 * Does not publish, install, write Working DNA, promote capsules, mutate Fabric,
 * or execute evolution-governance tick / redirect / runtime actions.
 *
 * Live v1 write model. Unified v2 types, state mapping, and accept gates live in
 * `@openbot/evolution-core`. Phase 0/1 must not change this machine's external behavior.
 */
import type {
  AuthorizationGrant,
  DaibaiRole,
  DiagnosisDelegationMachine,
  EvidenceShareGrant,
  RemoteDiagnosisMission,
  ReportShareGrant,
} from "./delegation.js";
import { FORBIDDEN_EVOLUTION_MUTATIONS } from "./delegation.js";
import {
  DiagnosisContractError,
  validateDiagnosticPrincipal,
  type DiagnosticPrincipal,
  type TrustedTenantContext,
} from "./types.js";

export const DIAGNOSIS_EVOLUTION_PROPOSAL_SCHEMA_VERSION = 1 as const;

export const EVOLUTION_PROPOSAL_DOMAINS = [
  "skill",
  "agent_working_dna",
  "collaboration_capsule",
  "fabric_feedback",
  "evolution_governance",
] as const;
export type EvolutionProposalDomain = (typeof EVOLUTION_PROPOSAL_DOMAINS)[number];

export const EVOLUTION_PROPOSAL_STATUSES = [
  "SUGGESTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "APPLIED",
  "VERIFIED",
  "ROLLED_BACK",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
] as const;
export type EvolutionProposalStatus = (typeof EVOLUTION_PROPOSAL_STATUSES)[number];

export const EVOLUTION_PROPOSAL_COMMANDS = [
  "suggest",
  "submit",
  "approve",
  "apply",
  "verify",
  "rollback",
  "reject",
  "expire",
  "revoke",
] as const;
export type EvolutionProposalCommand = (typeof EVOLUTION_PROPOSAL_COMMANDS)[number];

export const EVOLUTION_CONFIDENTIALITY_SCOPES = ["personal", "enterprise", "platform"] as const;
export type EvolutionConfidentialityScope = (typeof EVOLUTION_CONFIDENTIALITY_SCOPES)[number];

export const EVOLUTION_RISK_LEVELS = ["low", "medium", "high"] as const;
export type EvolutionRiskLevel = (typeof EVOLUTION_RISK_LEVELS)[number];

const TERMINAL = new Set<EvolutionProposalStatus>([
  "VERIFIED",
  "ROLLED_BACK",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
]);
const GRANT_BLOCKING = new Set<string>([
  "DENIED",
  "EXPIRED",
  "REVOKED",
  "CONSUMED",
  "SUSPENDED",
  "REQUESTED",
  "missing",
]);
const FORBIDDEN_CHANGE_KEYS = [
  "prompt",
  "skillBody",
  "workingStyle",
  "fabricPolicy",
  "transcript",
  "toolOutput",
  "evidencePayload",
  "publishSkill",
  "installSkill",
] as const;

export type EvolutionProposedChange = {
  summary: string;
  action?: string;
};

export type EvolutionProposal = {
  schemaVersion: 1;
  proposalId: string;
  sourceCaseId?: string;
  sourceMissionId?: string;
  sourceConversationRunId?: string;
  sourceFindingIds: string[];
  sourceEvidenceRefs: string[];
  sourceReportRef?: string;
  tenantScope: string | null;
  targetDomain: EvolutionProposalDomain;
  proposedChange: EvolutionProposedChange;
  expectedEffect: string;
  riskLevel: EvolutionRiskLevel;
  confidentialityScope: EvolutionConfidentialityScope;
  status: EvolutionProposalStatus;
  approvalRequired: true;
  approverScope: EvolutionConfidentialityScope;
  grantId: string;
  missionId?: string;
  evidenceShareGrantId?: string;
  reportShareGrantId?: string;
  createdAt: string;
  expiresAt: string;
  auditReceipt: string;
  verificationRef?: string;
  candidateRef?: string;
  approvalRef?: string;
  applicationRef?: string;
};

export type EvolutionCandidateProjection = {
  kind:
    | "PatternCandidate"
    | "WorkingDnaProposal"
    | "ExperienceCapsuleCandidate"
    | "FabricFeedbackSignal"
    | "EvolutionGovernanceProposal";
  candidateId: string;
  proposalId: string;
  tenantId: string | null;
  status: "candidate";
  summary: string;
  evidenceRefs: string[];
  requiresHumanApproval: true;
  autoApplied: false;
  autoExecute: false;
};

export type EvolutionApproval = {
  kind: "approval";
  approvalId: string;
  proposalId: string;
  approverPrincipalId: string;
  decidedAt: string;
};

export type EvolutionApplication = {
  kind: "application";
  applicationId: string;
  proposalId: string;
  appliedAt: string;
  appliedToRuntime: false;
};

export type EvolutionVerification = {
  kind: "verification";
  verificationId: string;
  proposalId: string;
  applicationId: string;
  verifiedAt: string;
  outcome: "linked";
};

export type RedactedEnterpriseSummary = {
  tenantId: string;
  summary: string;
  shareGrantId?: string;
};

export type EvolutionAuthorizationView = {
  grantId: string;
  status: string;
  tenantScope: string | null;
  allowedEvidence: string[];
  allowedActions: string[];
  confidentialityCeiling: EvolutionConfidentialityScope;
  targetPrincipal?: string;
  delegatedRole?: DaibaiRole;
};

export type EvolutionAuthorizationInspector = {
  inspect(grantId: string): EvolutionAuthorizationView | { status: "missing" };
  inspectMission?(missionId: string): { status: string };
  inspectEvidenceShare?(shareId: string): {
    status: string;
    evidenceIds: string[];
  };
  inspectReportShare?(shareId: string): {
    status: string;
    reportIds: string[];
    findingIds: string[];
  };
};

export type EvolutionProposalActor = {
  role: DaibaiRole;
  principal: DiagnosticPrincipal;
};

export type EvolutionProposalCommandInput = {
  commandId: string;
  command: EvolutionProposalCommand;
  trusted: TrustedTenantContext;
  actor: EvolutionProposalActor;
  proposalId?: string;
  grantId?: string;
  missionId?: string;
  evidenceShareGrantId?: string;
  reportShareGrantId?: string;
  sourceCaseId?: string;
  sourceMissionId?: string;
  sourceConversationRunId?: string;
  sourceFindingIds?: string[];
  sourceEvidenceRefs?: string[];
  sourceReportRef?: string;
  targetDomain?: EvolutionProposalDomain;
  proposedChange?: EvolutionProposedChange;
  expectedEffect?: string;
  riskLevel?: EvolutionRiskLevel;
  confidentialityScope?: EvolutionConfidentialityScope;
  tenantScope?: string | null;
  expiresAt?: string;
  redactedEnterpriseSummaries?: RedactedEnterpriseSummary[];
  sessionTenantId?: unknown;
};

export type EvolutionProposalReceipt = {
  commandId: string;
  proposalId: string;
  status: EvolutionProposalStatus;
  idempotent: boolean;
  candidateRef?: string;
  approvalRef?: string;
  applicationRef?: string;
  verificationRef?: string;
  reason?: string;
};

export type EvolutionProposalStore = {
  getProposal(id: string): EvolutionProposal | undefined;
  putProposal(proposal: EvolutionProposal): void;
  getCandidate(id: string): EvolutionCandidateProjection | undefined;
  putCandidate(candidate: EvolutionCandidateProjection): void;
  getApproval(id: string): EvolutionApproval | undefined;
  putApproval(approval: EvolutionApproval): void;
  getApplication(id: string): EvolutionApplication | undefined;
  putApplication(application: EvolutionApplication): void;
  getVerification(id: string): EvolutionVerification | undefined;
  putVerification(verification: EvolutionVerification): void;
  getCommand(id: string): EvolutionProposalReceipt | undefined;
  putCommand(id: string, receipt: EvolutionProposalReceipt): void;
};

export type EvolutionDomainAdapters = {
  project(input: { proposal: EvolutionProposal }): EvolutionCandidateProjection;
};

export type DiagnosisEvolutionProposalMachine = {
  dispatch(input: EvolutionProposalCommandInput): EvolutionProposalReceipt;
  getProposal(proposalId: string): EvolutionProposal | undefined;
  getCandidate(candidateId: string): EvolutionCandidateProjection | undefined;
  getApproval(approvalId: string): EvolutionApproval | undefined;
  getApplication(applicationId: string): EvolutionApplication | undefined;
  getVerification(verificationId: string): EvolutionVerification | undefined;
  exportProposal(proposalId: string): EvolutionProposal;
};

function fail(code: string, message: string, path = "command"): never {
  throw new DiagnosisContractError(code, message, path);
}

export function createMemoryEvolutionProposalStore(): EvolutionProposalStore {
  const proposals = new Map<string, EvolutionProposal>();
  const candidates = new Map<string, EvolutionCandidateProjection>();
  const approvals = new Map<string, EvolutionApproval>();
  const applications = new Map<string, EvolutionApplication>();
  const verifications = new Map<string, EvolutionVerification>();
  const commands = new Map<string, EvolutionProposalReceipt>();
  return {
    getProposal: (id) => proposals.get(id),
    putProposal: (row) => {
      proposals.set(row.proposalId, row);
    },
    getCandidate: (id) => candidates.get(id),
    putCandidate: (row) => {
      candidates.set(row.candidateId, row);
    },
    getApproval: (id) => approvals.get(id),
    putApproval: (row) => {
      approvals.set(row.approvalId, row);
    },
    getApplication: (id) => applications.get(id),
    putApplication: (row) => {
      applications.set(row.applicationId, row);
    },
    getVerification: (id) => verifications.get(id),
    putVerification: (row) => {
      verifications.set(row.verificationId, row);
    },
    getCommand: (id) => commands.get(id),
    putCommand: (id, receipt) => {
      commands.set(id, receipt);
    },
  };
}

export function createUnavailableEvolutionProposalStore(): EvolutionProposalStore {
  const down = (): never =>
    fail("evolution_store_unavailable", "evolution proposal store is unavailable", "store");
  return {
    getProposal: down,
    putProposal: down,
    getCandidate: down,
    putCandidate: down,
    getApproval: down,
    putApproval: down,
    getApplication: down,
    putApplication: down,
    getVerification: down,
    putVerification: down,
    getCommand: down,
    putCommand: down,
  };
}

export function createUnavailableEvolutionInspector(): EvolutionAuthorizationInspector {
  const down = (): never =>
    fail("evolution_inspector_unavailable", "grant inspector is unavailable", "grantInspector");
  return {
    inspect: down,
    inspectMission: down,
    inspectEvidenceShare: down,
    inspectReportShare: down,
  };
}

export function createDefaultEvolutionAdapters(): EvolutionDomainAdapters {
  return {
    project({ proposal }) {
      const kind =
        proposal.targetDomain === "skill"
          ? "PatternCandidate"
          : proposal.targetDomain === "agent_working_dna"
            ? "WorkingDnaProposal"
            : proposal.targetDomain === "collaboration_capsule"
              ? "ExperienceCapsuleCandidate"
              : proposal.targetDomain === "fabric_feedback"
                ? "FabricFeedbackSignal"
                : "EvolutionGovernanceProposal";
      return {
        kind,
        candidateId: `cand:${proposal.proposalId}`,
        proposalId: proposal.proposalId,
        tenantId: proposal.tenantScope,
        status: "candidate",
        summary: proposal.proposedChange.summary,
        evidenceRefs: [...proposal.sourceEvidenceRefs],
        requiresHumanApproval: true,
        autoApplied: false,
        autoExecute: false,
      };
    },
  };
}

function ceilingFromGrant(grant: AuthorizationGrant): EvolutionConfidentialityScope {
  if (grant.targetPrincipal || grant.grantee.role === "employee") {
    return "personal";
  }
  if (grant.grantee.role === "enterprise" || grant.approver.role === "enterprise") {
    return "enterprise";
  }
  return "enterprise";
}

export function createDelegationEvolutionInspector(
  machine: Pick<
    DiagnosisDelegationMachine,
    "getGrant" | "getMission" | "getEvidenceShare" | "getReportShare" | "inspectGrant"
  >,
): EvolutionAuthorizationInspector {
  return {
    inspect(grantId) {
      const looked = machine.inspectGrant(grantId);
      if (looked.status === "missing") {
        return { status: "missing" };
      }
      const grant = machine.getGrant(grantId);
      if (!grant) {
        return { status: "missing" };
      }
      return {
        grantId,
        status: looked.status,
        tenantScope: grant.targetTenant,
        allowedEvidence: [...grant.allowedEvidence],
        allowedActions: [...grant.allowedActions],
        confidentialityCeiling: ceilingFromGrant(grant),
        ...(grant.targetPrincipal ? { targetPrincipal: grant.targetPrincipal } : {}),
        delegatedRole: grant.grantee.role,
      };
    },
    inspectMission(missionId) {
      const mission: RemoteDiagnosisMission | undefined = machine.getMission(missionId);
      return { status: mission?.status ?? "missing" };
    },
    inspectEvidenceShare(shareId) {
      const share: EvidenceShareGrant | undefined = machine.getEvidenceShare(shareId);
      return {
        status: share?.status ?? "missing",
        evidenceIds: share ? [...share.evidenceIds] : [],
      };
    },
    inspectReportShare(shareId) {
      const share: ReportShareGrant | undefined = machine.getReportShare(shareId);
      return {
        status: share?.status ?? "missing",
        reportIds: share ? [...share.reportIds] : [],
        findingIds: share ? [...share.findingIds] : [],
      };
    },
  };
}

function rank(scope: EvolutionConfidentialityScope): number {
  if (scope === "personal") {
    return 0;
  }
  if (scope === "enterprise") {
    return 1;
  }
  return 2;
}

function defaultAdaptersAndStore(deps: {
  store?: EvolutionProposalStore;
  adapters?: EvolutionDomainAdapters;
}): { store: EvolutionProposalStore; adapters: EvolutionDomainAdapters } {
  return {
    store: deps.store ?? createMemoryEvolutionProposalStore(),
    adapters: deps.adapters ?? createDefaultEvolutionAdapters(),
  };
}

export function createDiagnosisEvolutionProposalMachine(
  deps: {
    now?: () => number;
    store?: EvolutionProposalStore;
    grantInspector?: EvolutionAuthorizationInspector;
    adapters?: EvolutionDomainAdapters;
  } = {},
): DiagnosisEvolutionProposalMachine {
  const now = deps.now ?? Date.now;
  const { store, adapters } = defaultAdaptersAndStore(deps);
  const inspector = deps.grantInspector;

  const persist = (receipt: EvolutionProposalReceipt): EvolutionProposalReceipt => {
    store.putCommand(receipt.commandId, receipt);
    return receipt;
  };

  const refreshProposal = (proposal: EvolutionProposal, nowMs: number): EvolutionProposal => {
    if (!TERMINAL.has(proposal.status) && Date.parse(proposal.expiresAt) <= nowMs) {
      return { ...proposal, status: "EXPIRED" };
    }
    return proposal;
  };

  const requireLiveGrant = (grantId: string, path = "grantId"): EvolutionAuthorizationView => {
    if (!inspector) {
      fail("authorization_required", "grant inspector is required", "grantInspector");
    }
    const viewed = inspector.inspect(grantId);
    if (viewed.status === "missing" || !("grantId" in viewed)) {
      fail("authorization_required", "linked grant is missing", path);
    }
    if (GRANT_BLOCKING.has(viewed.status)) {
      fail(
        viewed.status === "EXPIRED"
          ? "grant_expired"
          : viewed.status === "REVOKED"
            ? "grant_revoked"
            : viewed.status === "SUSPENDED"
              ? "grant_suspended"
              : viewed.status === "CONSUMED"
                ? "grant_consumed"
                : "grant_inactive",
        "linked grant is not approved",
        path,
      );
    }
    if (viewed.status !== "APPROVED") {
      fail("grant_inactive", "linked grant is not approved", path);
    }
    return viewed;
  };

  const assertTrustedActor = (input: EvolutionProposalCommandInput): EvolutionProposalActor => {
    if (input.sessionTenantId !== undefined) {
      fail(
        "untrusted_tenant_source",
        "sessionTenantId is not a trusted tenant authority",
        "sessionTenantId",
      );
    }
    const principal = validateDiagnosticPrincipal(
      input.actor.principal,
      input.trusted,
      "actor.principal",
    );
    if (input.actor.role !== "platform" && principal.tenantId !== input.trusted.tenantId) {
      fail("tenant_mismatch", "actor tenant must match trusted tenant", "actor");
    }
    return { role: input.actor.role, principal };
  };

  const assertChange = (change: EvolutionProposedChange | undefined): EvolutionProposedChange => {
    if (!change?.summary) {
      fail("missing_field", "proposedChange.summary is required", "proposedChange");
    }
    for (const key of Object.keys(change)) {
      if ((FORBIDDEN_CHANGE_KEYS as readonly string[]).includes(key)) {
        fail("scope_widened", "proposedChange cannot carry runtime payloads", "proposedChange");
      }
    }
    if (
      change.action &&
      (FORBIDDEN_EVOLUTION_MUTATIONS as readonly string[]).includes(change.action)
    ) {
      fail(
        "evolution_mutation_forbidden",
        "proposal cannot execute capability mutations",
        "proposedChange",
      );
    }
    return { summary: change.summary, ...(change.action ? { action: change.action } : {}) };
  };

  const suggest = (
    input: EvolutionProposalCommandInput,
    actor: EvolutionProposalActor,
    nowMs: number,
  ): EvolutionProposalReceipt => {
    const grantId = input.grantId ?? fail("missing_field", "grantId is required", "grantId");
    const grant = requireLiveGrant(grantId);
    if (input.missionId) {
      const mission = inspector?.inspectMission?.(input.missionId) ?? { status: "missing" };
      if (GRANT_BLOCKING.has(mission.status) || mission.status !== "APPROVED") {
        fail("grant_inactive", "linked mission is not approved", "missionId");
      }
    }
    const domain = input.targetDomain;
    if (!domain || !(EVOLUTION_PROPOSAL_DOMAINS as readonly string[]).includes(domain)) {
      fail("invalid_literal", "targetDomain is required", "targetDomain");
    }
    if (
      !input.sourceCaseId &&
      !input.sourceMissionId &&
      !input.sourceConversationRunId &&
      !input.missionId
    ) {
      fail("missing_field", "proposal requires a diagnosis or consult source", "sourceCaseId");
    }
    const evidenceRefs = [...(input.sourceEvidenceRefs ?? [])];
    const findingIds = [...(input.sourceFindingIds ?? [])];
    if (input.evidenceShareGrantId) {
      const share = inspector?.inspectEvidenceShare?.(input.evidenceShareGrantId);
      if (!share || share.status !== "APPROVED") {
        fail(
          "evidence_share_required",
          "EvidenceShareGrant is not approved",
          "evidenceShareGrantId",
        );
      }
      if (evidenceRefs.some((id) => !share.evidenceIds.includes(id))) {
        fail("scope_widened", "evidence refs exceed the share grant", "sourceEvidenceRefs");
      }
    } else if (evidenceRefs.some((id) => !grant.allowedEvidence.includes(id))) {
      fail("scope_widened", "evidence refs exceed the authorization grant", "sourceEvidenceRefs");
    }
    if (input.reportShareGrantId) {
      const share = inspector?.inspectReportShare?.(input.reportShareGrantId);
      if (!share || share.status !== "APPROVED") {
        fail("report_share_required", "ReportShareGrant is not approved", "reportShareGrantId");
      }
      if (input.sourceReportRef && !share.reportIds.includes(input.sourceReportRef)) {
        fail("scope_widened", "report ref exceeds the share grant", "sourceReportRef");
      }
      if (findingIds.some((id) => !share.findingIds.includes(id))) {
        fail("scope_widened", "finding ids exceed the share grant", "sourceFindingIds");
      }
    }
    const confidentiality =
      input.confidentialityScope ??
      (actor.role === "platform"
        ? "platform"
        : actor.role === "enterprise"
          ? "enterprise"
          : "personal");
    if (!(EVOLUTION_CONFIDENTIALITY_SCOPES as readonly string[]).includes(confidentiality)) {
      fail("invalid_literal", "confidentialityScope is invalid", "confidentialityScope");
    }
    if (
      rank(confidentiality) > rank(grant.confidentialityCeiling) &&
      confidentiality !== "platform"
    ) {
      fail("scope_widened", "proposal cannot exceed grant confidentiality", "confidentialityScope");
    }
    if (confidentiality === "platform") {
      if (actor.role !== "platform") {
        fail("unauthorized", "only platform Da Bai may create platform proposals", "actor.role");
      }
      if (evidenceRefs.length > 0) {
        fail(
          "raw_evidence_forbidden",
          "platform proposals cannot aggregate raw Evidence",
          "sourceEvidenceRefs",
        );
      }
      const summaries = input.redactedEnterpriseSummaries ?? [];
      const tenants = new Set(summaries.map((row) => row.tenantId).filter(Boolean));
      if (summaries.length < 2 || tenants.size < 2) {
        fail(
          "redacted_summaries_required",
          "platform proposals require authorized redacted summaries from multiple enterprises",
          "redactedEnterpriseSummaries",
        );
      }
    } else if (actor.role === "employee" && confidentiality !== "personal") {
      fail("scope_widened", "employee proposals stay in personal scope", "confidentialityScope");
    }
    const tenantScope =
      confidentiality === "platform" ? null : (input.tenantScope ?? actor.principal.tenantId);
    if (confidentiality !== "platform") {
      if (tenantScope !== actor.principal.tenantId || tenantScope !== input.trusted.tenantId) {
        fail("tenant_mismatch", "proposal tenant must match trusted tenant", "tenantScope");
      }
      if (grant.tenantScope !== tenantScope) {
        fail("scope_widened", "proposal tenant exceeds grant tenant scope", "tenantScope");
      }
    }
    if (
      actor.role === "employee" &&
      grant.targetPrincipal &&
      grant.targetPrincipal !== actor.principal.principalId
    ) {
      fail("principal_mismatch", "employee may only propose for the granted principal", "actor");
    }
    if (
      input.proposedChange?.action &&
      !grant.allowedActions.includes(input.proposedChange.action)
    ) {
      fail("scope_widened", "proposed action exceeds grant allowedActions", "proposedChange");
    }
    const proposalId = input.proposalId ?? `evo:${input.commandId}`;
    const existing = store.getProposal(proposalId);
    if (existing) {
      return persist({
        commandId: input.commandId,
        proposalId,
        status: existing.status,
        idempotent: true,
        ...(existing.candidateRef ? { candidateRef: existing.candidateRef } : {}),
      });
    }
    const expiresAt = input.expiresAt ?? toIso(nowMs + 60 * 60 * 1000);
    const proposal: EvolutionProposal = {
      schemaVersion: 1,
      proposalId,
      ...(input.sourceCaseId ? { sourceCaseId: input.sourceCaseId } : {}),
      ...((input.sourceMissionId ?? input.missionId)
        ? { sourceMissionId: input.sourceMissionId ?? input.missionId }
        : {}),
      ...(input.sourceConversationRunId
        ? { sourceConversationRunId: input.sourceConversationRunId }
        : {}),
      sourceFindingIds: findingIds,
      sourceEvidenceRefs: evidenceRefs,
      ...(input.sourceReportRef ? { sourceReportRef: input.sourceReportRef } : {}),
      tenantScope,
      targetDomain: domain,
      proposedChange: assertChange(input.proposedChange),
      expectedEffect: input.expectedEffect ?? "reduce recurrence of the diagnosed failure",
      riskLevel: input.riskLevel ?? "medium",
      confidentialityScope: confidentiality,
      status: "SUGGESTED",
      approvalRequired: true,
      approverScope: confidentiality,
      grantId,
      ...(input.missionId ? { missionId: input.missionId } : {}),
      ...(input.evidenceShareGrantId ? { evidenceShareGrantId: input.evidenceShareGrantId } : {}),
      ...(input.reportShareGrantId ? { reportShareGrantId: input.reportShareGrantId } : {}),
      createdAt: toIso(nowMs),
      expiresAt,
      auditReceipt: `aud:${proposalId}`,
    };
    const candidate = adapters.project({ proposal });
    if (candidate.autoApplied || candidate.autoExecute) {
      fail("evolution_mutation_forbidden", "adapters cannot auto-apply candidates", "adapters");
    }
    const next = { ...proposal, candidateRef: candidate.candidateId };
    store.putProposal(next);
    store.putCandidate(candidate);
    return persist({
      commandId: input.commandId,
      proposalId,
      status: "SUGGESTED",
      idempotent: false,
      candidateRef: candidate.candidateId,
    });
  };

  const transition = (
    from: EvolutionProposalStatus,
    command: EvolutionProposalCommand,
  ): EvolutionProposalStatus => {
    if (command === "submit" && from === "SUGGESTED") {
      return "PENDING_APPROVAL";
    }
    if (command === "approve" && from === "PENDING_APPROVAL") {
      return "APPROVED";
    }
    if (command === "apply" && from === "APPROVED") {
      return "APPLIED";
    }
    if (command === "verify" && from === "APPLIED") {
      return "VERIFIED";
    }
    if (command === "rollback" && (from === "APPLIED" || from === "VERIFIED")) {
      return "ROLLED_BACK";
    }
    if (command === "reject" && (from === "SUGGESTED" || from === "PENDING_APPROVAL")) {
      return "REJECTED";
    }
    if (command === "expire" && !TERMINAL.has(from) && from !== "APPLIED") {
      return "EXPIRED";
    }
    if (
      command === "revoke" &&
      (from === "SUGGESTED" || from === "PENDING_APPROVAL" || from === "APPROVED")
    ) {
      return "REVOKED";
    }
    fail("illegal_transition", `cannot ${command} a ${from} proposal`, "status");
  };

  return {
    dispatch(input) {
      if (input.sessionTenantId !== undefined) {
        fail(
          "untrusted_tenant_source",
          "sessionTenantId is not a trusted tenant authority",
          "sessionTenantId",
        );
      }
      const cached = store.getCommand(input.commandId);
      if (cached) {
        return { ...cached, idempotent: true };
      }
      const actor = assertTrustedActor(input);
      const nowMs = now();
      if (input.command === "suggest") {
        return suggest(input, actor, nowMs);
      }
      const proposalId =
        input.proposalId ?? fail("missing_field", "proposalId is required", "proposalId");
      const loaded =
        store.getProposal(proposalId) ?? fail("not_found", "proposal not found", "proposalId");
      let proposal = refreshProposal(loaded, nowMs);
      if (proposal.status === "EXPIRED" && loaded.status !== "EXPIRED") {
        store.putProposal(proposal);
      }
      if (proposal.status === "EXPIRED" && input.command !== "expire") {
        fail("grant_expired", "proposal has expired", "expiresAt");
      }
      requireLiveGrant(proposal.grantId);
      if (proposal.missionId) {
        const mission = inspector?.inspectMission?.(proposal.missionId) ?? { status: "missing" };
        if (GRANT_BLOCKING.has(mission.status) || mission.status !== "APPROVED") {
          fail("grant_inactive", "linked mission is no longer approved", "missionId");
        }
      }
      const nextStatus = transition(proposal.status, input.command);
      const next: EvolutionProposal = { ...proposal, status: nextStatus };
      if (input.command === "approve") {
        const approval: EvolutionApproval = {
          kind: "approval",
          approvalId: `apr:${input.commandId}`,
          proposalId,
          approverPrincipalId: actor.principal.principalId,
          decidedAt: toIso(nowMs),
        };
        store.putApproval(approval);
        next.approvalRef = approval.approvalId;
      }
      if (input.command === "apply") {
        const application: EvolutionApplication = {
          kind: "application",
          applicationId: `app:${input.commandId}`,
          proposalId,
          appliedAt: toIso(nowMs),
          appliedToRuntime: false,
        };
        store.putApplication(application);
        next.applicationRef = application.applicationId;
      }
      if (input.command === "verify") {
        const applicationId =
          proposal.applicationRef ?? fail("missing_field", "apply before verify", "applicationRef");
        const verification: EvolutionVerification = {
          kind: "verification",
          verificationId: `ver:${input.commandId}`,
          proposalId,
          applicationId,
          verifiedAt: toIso(nowMs),
          outcome: "linked",
        };
        store.putVerification(verification);
        next.verificationRef = verification.verificationId;
      }
      store.putProposal(next);
      return persist({
        commandId: input.commandId,
        proposalId,
        status: nextStatus,
        idempotent: false,
        ...(next.candidateRef ? { candidateRef: next.candidateRef } : {}),
        ...(next.approvalRef ? { approvalRef: next.approvalRef } : {}),
        ...(next.applicationRef ? { applicationRef: next.applicationRef } : {}),
        ...(next.verificationRef ? { verificationRef: next.verificationRef } : {}),
      });
    },
    getProposal: (proposalId) => {
      const proposal = store.getProposal(proposalId);
      return proposal ? refreshProposal(proposal, now()) : undefined;
    },
    getCandidate: (candidateId) => store.getCandidate(candidateId),
    getApproval: (approvalId) => store.getApproval(approvalId),
    getApplication: (applicationId) => store.getApplication(applicationId),
    getVerification: (verificationId) => store.getVerification(verificationId),
    exportProposal(proposalId) {
      const proposal =
        store.getProposal(proposalId) ?? fail("not_found", "proposal not found", "proposalId");
      const live = refreshProposal(proposal, now());
      if (live.status === "EXPIRED") {
        fail("grant_expired", "expired proposals cannot be exported", "status");
      }
      requireLiveGrant(live.grantId);
      return live;
    },
  };
}

function toIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

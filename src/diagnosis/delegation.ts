/**
 * Phase 7 — in-process graded authorization, downward delegation, and consult.
 * Does not call cross-tenant RPC, live Da Bai, chat, or repair.
 */
import {
  AUTHORIZATION_GRANT_STATUSES,
  type AuthorizationGrantStatus,
} from "./authorization-grant-status.js";
import type { DiagnosisDaibaiDeliveryAuth, DiagnosisDaibaiRoute } from "./daibai-delivery.js";
import { isPhase1Diagnoser } from "./diagnosers.js";
import { isPhase2Diagnoser } from "./phase2.js";
import type { DiagnosticSignal } from "./signal.js";
import {
  DiagnosisContractError,
  validateDiagnosticPrincipal,
  type DiagnosticPrincipal,
  type TrustedTenantContext,
} from "./types.js";

export const DIAGNOSIS_DELEGATION_SCHEMA_VERSION = 1 as const;
export const DAIBAI_ROLES = ["platform", "enterprise", "employee"] as const;
export type DaibaiRole = (typeof DAIBAI_ROLES)[number];

export { AUTHORIZATION_GRANT_STATUSES, type AuthorizationGrantStatus };

export const DELEGATION_COMMANDS = [
  "request",
  "approve",
  "deny",
  "revoke",
  "suspend",
  "resume",
  "expire",
  "consume",
] as const;
export type DelegationCommand = (typeof DELEGATION_COMMANDS)[number];

export const DELEGATION_SCENARIOS = [
  "platform_to_enterprise",
  "platform_to_employee",
  "enterprise_to_employee",
] as const;
export type DelegationScenario = (typeof DELEGATION_SCENARIOS)[number];

export const EVOLUTION_CANDIDATE_KINDS = [
  "EvolutionProposal",
  "PatternCandidate",
  "WorkingDnaProposal",
  "ExperienceCapsuleCandidate",
  "FabricFeedbackSignal",
] as const;
export type EvolutionCandidateKind = (typeof EVOLUTION_CANDIDATE_KINDS)[number];

export const EVOLUTION_LIFECYCLE = ["suggest", "approve", "apply", "verify", "rollback"] as const;
export const FORBIDDEN_EVOLUTION_MUTATIONS = [
  "publish_skill",
  "install_skill",
  "modify_working_dna",
  "promote_capsule",
  "mutate_fabric_policy",
  "runtime_action",
] as const;

const TERMINAL = new Set<AuthorizationGrantStatus>(["DENIED", "EXPIRED", "REVOKED", "CONSUMED"]);

/** REQUESTED approve/deny edges shared with the diagnosis approval ledger. */
export function transitionRequestedAuthorizationGrant(
  from: AuthorizationGrantStatus,
  command: "approve" | "deny",
): "APPROVED" | "DENIED" | null {
  if (command === "approve" && from === "REQUESTED") {
    return "APPROVED";
  }
  if (command === "deny" && from === "REQUESTED") {
    return "DENIED";
  }
  return null;
}
const BLOCKING = new Set<AuthorizationGrantStatus>([
  "DENIED",
  "EXPIRED",
  "REVOKED",
  "CONSUMED",
  "SUSPENDED",
  "REQUESTED",
]);

export type DelegationActor = {
  role: DaibaiRole;
  principal: DiagnosticPrincipal;
};

export type DelegationTargetScope = {
  tenantId: string | null;
  targetType?: string;
  targetId?: string;
};

export type AuthorizationGrant = {
  schemaVersion: 1;
  grantId: string;
  kind: "authorization";
  issuer: DelegationActor;
  approver: DelegationActor;
  grantee: DelegationActor;
  sourceTenant: string | null;
  targetTenant: string | null;
  targetPrincipal?: string;
  targetScope: DelegationTargetScope;
  allowedEvidence: string[];
  allowedActions: string[];
  purpose: string;
  canSubdelegate: boolean;
  expiresAt: string;
  oneShot: boolean;
  status: AuthorizationGrantStatus;
  parentGrantId?: string;
  auditReceipt: string;
};

export type AgentDelegationGrant = {
  schemaVersion: 1;
  grantId: string;
  kind: "delegation";
  authorizationGrantId: string;
  delegatingAgent: string;
  delegatedAgent: string;
  delegatingRole: DaibaiRole;
  delegatedRole: DaibaiRole;
  tenantScope: string | null;
  targetScope: DelegationTargetScope;
  allowedDiagnosers: string[];
  allowedEvidence: string[];
  allowedActions: string[];
  canSubdelegate: boolean;
  expiresAt: string;
  status: AuthorizationGrantStatus;
  auditReceipt: string;
};

export type EvidenceShareGrant = {
  schemaVersion: 1;
  grantId: string;
  kind: "evidence_share";
  missionId: string;
  sourceTenant: string | null;
  targetTenant: string | null;
  evidenceIds: string[];
  status: AuthorizationGrantStatus;
  expiresAt: string;
  auditReceipt: string;
};

export type ReportShareGrant = {
  schemaVersion: 1;
  grantId: string;
  kind: "report_share";
  missionId: string;
  sourceTenant: string | null;
  targetTenant: string | null;
  reportIds: string[];
  findingIds: string[];
  status: AuthorizationGrantStatus;
  expiresAt: string;
  auditReceipt: string;
};

export type RemoteDiagnosisOutput = {
  kind: "finding_ref" | "report_summary" | "evidence_ref" | EvolutionCandidateKind;
  id: string;
  redacted: boolean;
};

export type RemoteDiagnosisMission = {
  schemaVersion: 1;
  missionId: string;
  parentCaseId?: string;
  requesterAgent: string;
  assignedAgent: string;
  grantId: string;
  requiredGrantIds: string[];
  targetTenant: string | null;
  targetPrincipal?: string;
  requestedInputs: string[];
  returnedOutputs: RemoteDiagnosisOutput[];
  status: AuthorizationGrantStatus;
  scenario: DelegationScenario;
  conversationRunId?: string;
  evidenceShareGrantId?: string;
  reportShareGrantId?: string;
  auditReceipt: string;
  verificationRef?: string;
};

export type DelegationReceipt = {
  commandId: string;
  grantId?: string;
  missionId?: string;
  status: AuthorizationGrantStatus;
  idempotent: boolean;
  reason?: string;
};

export type DelegationCommandInput = {
  commandId: string;
  command: DelegationCommand;
  trusted: TrustedTenantContext;
  actor: DelegationActor;
  grantId?: string;
  missionId?: string;
  parentGrantId?: string;
  scenario?: DelegationScenario;
  issuer?: DelegationActor;
  approver?: DelegationActor;
  grantee?: DelegationActor;
  targetTenant?: string | null;
  targetPrincipal?: string;
  targetScope?: DelegationTargetScope;
  allowedEvidence?: string[];
  allowedActions?: string[];
  allowedDiagnosers?: string[];
  purpose?: string;
  canSubdelegate?: boolean;
  expiresAt?: string;
  oneShot?: boolean;
  parentCaseId?: string;
  conversationRunId?: string;
  outputs?: RemoteDiagnosisOutput[];
  shareEvidenceIds?: string[];
  shareReportIds?: string[];
  shareFindingIds?: string[];
  sessionTenantId?: unknown;
};

export type DelegationStore = {
  getGrant(grantId: string): AuthorizationGrant | undefined;
  putGrant(grant: AuthorizationGrant): void;
  getDelegation(grantId: string): AgentDelegationGrant | undefined;
  putDelegation(grant: AgentDelegationGrant): void;
  getMission(missionId: string): RemoteDiagnosisMission | undefined;
  putMission(mission: RemoteDiagnosisMission): void;
  getEvidenceShare(grantId: string): EvidenceShareGrant | undefined;
  putEvidenceShare(grant: EvidenceShareGrant): void;
  getReportShare(grantId: string): ReportShareGrant | undefined;
  putReportShare(grant: ReportShareGrant): void;
  getCommand(commandId: string): DelegationReceipt | undefined;
  putCommand(commandId: string, receipt: DelegationReceipt): void;
  listMissions(): RemoteDiagnosisMission[];
};

export type DiagnosisDelegationMachine = {
  dispatch(input: DelegationCommandInput): DelegationReceipt;
  getGrant(grantId: string): AuthorizationGrant | undefined;
  getDelegation(grantId: string): AgentDelegationGrant | undefined;
  getMission(missionId: string): RemoteDiagnosisMission | undefined;
  getEvidenceShare(grantId: string): EvidenceShareGrant | undefined;
  getReportShare(grantId: string): ReportShareGrant | undefined;
  inspectGrant(grantId: string): { status: AuthorizationGrantStatus | "missing" };
  assertDeliverable(input: {
    signal: DiagnosticSignal;
    auth?: DiagnosisDaibaiDeliveryAuth;
    route: DiagnosisDaibaiRoute;
  }): { ok: true } | { ok: false; reason: string };
  restoreGrant(grant: AuthorizationGrant, trusted: TrustedTenantContext): AuthorizationGrant;
};

export function createMemoryDelegationStore(): DelegationStore {
  const grants = new Map<string, AuthorizationGrant>();
  const delegations = new Map<string, AgentDelegationGrant>();
  const missions = new Map<string, RemoteDiagnosisMission>();
  const evidenceShares = new Map<string, EvidenceShareGrant>();
  const reportShares = new Map<string, ReportShareGrant>();
  const commands = new Map<string, DelegationReceipt>();
  return {
    getGrant: (id) => grants.get(id),
    putGrant: (grant) => {
      grants.set(grant.grantId, grant);
    },
    getDelegation: (id) => delegations.get(id),
    putDelegation: (grant) => {
      delegations.set(grant.grantId, grant);
    },
    getMission: (id) => missions.get(id),
    putMission: (mission) => {
      missions.set(mission.missionId, mission);
    },
    getEvidenceShare: (id) => evidenceShares.get(id),
    putEvidenceShare: (grant) => {
      evidenceShares.set(grant.grantId, grant);
    },
    getReportShare: (id) => reportShares.get(id),
    putReportShare: (grant) => {
      reportShares.set(grant.grantId, grant);
    },
    getCommand: (id) => commands.get(id),
    putCommand: (id, receipt) => {
      commands.set(id, receipt);
    },
    listMissions: () => [...missions.values()],
  };
}

export function createUnavailableDelegationStore(): DelegationStore {
  const fail = (): never => {
    throw new DiagnosisContractError(
      "delegation_store_unavailable",
      "authorization store is unavailable",
      "store",
    );
  };
  return {
    getGrant: fail,
    putGrant: fail,
    getDelegation: fail,
    putDelegation: fail,
    getMission: fail,
    putMission: fail,
    getEvidenceShare: fail,
    putEvidenceShare: fail,
    getReportShare: fail,
    putReportShare: fail,
    getCommand: fail,
    putCommand: fail,
    listMissions: fail,
  };
}

export function createDiagnosisDelegationMachine(
  deps: {
    now?: () => number;
    store?: DelegationStore;
  } = {},
): DiagnosisDelegationMachine {
  const now = deps.now ?? Date.now;
  const store = deps.store ?? createMemoryDelegationStore();

  function fail(code: string, message: string, path = "command"): never {
    throw new DiagnosisContractError(code, message, path);
  }

  const refreshStatus = <T extends { status: AuthorizationGrantStatus; expiresAt: string }>(
    row: T,
    nowMs: number,
  ): T => {
    if (!TERMINAL.has(row.status) && Date.parse(row.expiresAt) <= nowMs) {
      return { ...row, status: "EXPIRED" };
    }
    return row;
  };

  const assertTrustedActor = (input: DelegationCommandInput): DelegationActor => {
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
    if (input.actor.role === "platform") {
      if (input.trusted.tenantId !== null) {
        fail(
          "tenant_mismatch",
          "platform actor requires a platform trusted context",
          "trusted.tenantId",
        );
      }
    } else if (principal.tenantId !== input.trusted.tenantId) {
      fail("tenant_mismatch", "actor tenant must match trusted tenant", "actor");
    }
    if (!(DAIBAI_ROLES as readonly string[]).includes(input.actor.role)) {
      fail("invalid_literal", "actor.role is not a DaibaiRole", "actor.role");
    }
    return { role: input.actor.role, principal };
  };

  const requiredApprover = (
    scenario: DelegationScenario,
    grant: AuthorizationGrant,
  ): DaibaiRole => {
    if (scenario === "platform_to_enterprise") {
      return "enterprise";
    }
    if (scenario === "enterprise_to_employee" || grant.targetPrincipal) {
      return "employee";
    }
    return grant.approver.role;
  };

  const assertTransition = (
    from: AuthorizationGrantStatus,
    command: DelegationCommand,
  ): AuthorizationGrantStatus => {
    if (command === "approve" || command === "deny") {
      const next = transitionRequestedAuthorizationGrant(from, command);
      if (next) {
        return next;
      }
    }
    if (
      command === "revoke" &&
      (from === "REQUESTED" || from === "APPROVED" || from === "SUSPENDED")
    ) {
      return "REVOKED";
    }
    if (command === "suspend" && from === "APPROVED") {
      return "SUSPENDED";
    }
    if (command === "resume" && from === "SUSPENDED") {
      return "APPROVED";
    }
    if (command === "expire" && !TERMINAL.has(from)) {
      return "EXPIRED";
    }
    if (command === "consume" && from === "APPROVED") {
      return "CONSUMED";
    }
    fail("illegal_transition", `cannot ${command} a ${from} grant`, "status");
  };

  const persistReceipt = (receipt: DelegationReceipt): DelegationReceipt => {
    store.putCommand(receipt.commandId, receipt);
    return receipt;
  };

  const requestMission = (
    input: DelegationCommandInput,
    actor: DelegationActor,
    nowMs: number,
  ): DelegationReceipt => {
    const scenario = input.scenario;
    if (!scenario) {
      fail("missing_field", "request requires a scenario", "scenario");
    }
    if (input.canSubdelegate === true && !input.parentGrantId) {
      fail(
        "subdelegate_forbidden",
        "canSubdelegate defaults to false and cannot be self-asserted",
        "canSubdelegate",
      );
    }
    if (input.parentGrantId) {
      const parent = refreshStatus(
        store.getGrant(input.parentGrantId) ?? fail("not_found", "parent grant not found"),
        nowMs,
      );
      if (parent.status !== "APPROVED" || !parent.canSubdelegate) {
        fail("subdelegate_forbidden", "parent grant does not allow subdelegation", "parentGrantId");
      }
    }
    if (scenario === "platform_to_enterprise" && actor.role !== "platform") {
      fail("unauthorized", "only platform Da Bai may request enterprise dispatch", "actor.role");
    }
    if (scenario === "platform_to_employee") {
      fail(
        "enterprise_authorization_required",
        "platform Da Bai cannot dispatch an employee without a separate enterprise grant",
        "scenario",
      );
    }
    if (scenario === "enterprise_to_employee" && actor.role !== "enterprise") {
      fail("unauthorized", "only enterprise Da Bai may request employee dispatch", "actor.role");
    }
    const targetTenant = input.targetTenant ?? null;
    if (
      scenario !== "platform_to_enterprise" &&
      targetTenant !== actor.principal.tenantId &&
      actor.role !== "platform"
    ) {
      fail("tenant_mismatch", "target tenant must match actor trusted tenant", "targetTenant");
    }
    const approver = input.approver ?? fail("missing_field", "approver is required", "approver");
    const grantee = input.grantee ?? fail("missing_field", "grantee is required", "grantee");
    if (
      scenario === "platform_to_enterprise" &&
      (approver.role !== "enterprise" || grantee.role !== "enterprise")
    ) {
      fail(
        "unauthorized",
        "enterprise admin must approve and receive enterprise dispatch",
        "approver",
      );
    }
    if (
      scenario === "enterprise_to_employee" &&
      (approver.role !== "employee" || grantee.role !== "employee")
    ) {
      fail("unauthorized", "employee must approve employee dispatch", "approver");
    }
    if (grantee.role === "employee" && !input.targetPrincipal) {
      fail("missing_field", "employee dispatch requires targetPrincipal", "targetPrincipal");
    }
    const expiresAt = input.expiresAt ?? toIso(nowMs + 60 * 60 * 1000);
    const grantId = input.grantId ?? `grant:${input.commandId}`;
    const existing = store.getGrant(grantId);
    if (existing) {
      return persistReceipt({
        commandId: input.commandId,
        grantId,
        status: existing.status,
        idempotent: true,
      });
    }
    const grant: AuthorizationGrant = {
      schemaVersion: 1,
      grantId,
      kind: "authorization",
      issuer: actor,
      approver,
      grantee,
      sourceTenant: actor.principal.tenantId,
      targetTenant,
      ...(input.targetPrincipal ? { targetPrincipal: input.targetPrincipal } : {}),
      targetScope: input.targetScope ?? { tenantId: targetTenant },
      allowedEvidence: [...(input.allowedEvidence ?? [])],
      allowedActions: [...(input.allowedActions ?? ["diagnose"])],
      purpose: input.purpose ?? scenario,
      canSubdelegate: false,
      expiresAt,
      oneShot: input.oneShot === true,
      status: "REQUESTED",
      ...(input.parentGrantId ? { parentGrantId: input.parentGrantId } : {}),
      auditReceipt: `aud:${grantId}`,
    };
    store.putGrant(grant);
    const delegation: AgentDelegationGrant = {
      schemaVersion: 1,
      grantId: `dlg:${grantId}`,
      kind: "delegation",
      authorizationGrantId: grantId,
      delegatingAgent: actor.principal.principalId,
      delegatedAgent: grantee.principal.principalId,
      delegatingRole: actor.role,
      delegatedRole: grantee.role,
      tenantScope: targetTenant,
      targetScope: grant.targetScope,
      allowedDiagnosers: (input.allowedDiagnosers ?? []).filter((id) => {
        if (!isPhase1Diagnoser(id) && !isPhase2Diagnoser(id)) {
          fail("unregistered_diagnoser", `Diagnoser ${id} is not registered`, "allowedDiagnosers");
        }
        return true;
      }),
      allowedEvidence: grant.allowedEvidence,
      allowedActions: grant.allowedActions,
      canSubdelegate: false,
      expiresAt,
      status: "REQUESTED",
      auditReceipt: `aud:dlg:${grantId}`,
    };
    store.putDelegation(delegation);
    const missionId = input.missionId ?? `msn:${input.commandId}`;
    const mission: RemoteDiagnosisMission = {
      schemaVersion: 1,
      missionId,
      ...(input.parentCaseId ? { parentCaseId: input.parentCaseId } : {}),
      requesterAgent: actor.principal.principalId,
      assignedAgent: grantee.principal.principalId,
      grantId,
      requiredGrantIds: [grantId],
      targetTenant,
      ...(input.targetPrincipal ? { targetPrincipal: input.targetPrincipal } : {}),
      requestedInputs: [...grant.allowedEvidence],
      returnedOutputs: [],
      status: "REQUESTED",
      scenario,
      ...(input.conversationRunId ? { conversationRunId: input.conversationRunId } : {}),
      auditReceipt: `aud:${missionId}`,
    };
    store.putMission(mission);
    return persistReceipt({
      commandId: input.commandId,
      grantId,
      missionId,
      status: "REQUESTED",
      idempotent: false,
    });
  };

  const requestPlatformEmployee = (
    input: DelegationCommandInput,
    actor: DelegationActor,
    nowMs: number,
  ): DelegationReceipt => {
    if (actor.role !== "platform") {
      fail("unauthorized", "only platform Da Bai may request dual employee dispatch", "actor.role");
    }
    const enterprise =
      input.approver ?? fail("missing_field", "enterprise approver is required", "approver");
    const employee =
      input.grantee ?? fail("missing_field", "employee grantee is required", "grantee");
    if (enterprise.role !== "enterprise" || employee.role !== "employee") {
      fail(
        "unauthorized",
        "platform-to-employee requires enterprise approver and employee grantee",
        "approver",
      );
    }
    const enterpriseInput: DelegationCommandInput = {
      ...input,
      commandId: `${input.commandId}:enterprise`,
      grantId: input.grantId ? `${input.grantId}:enterprise` : undefined,
      missionId: undefined,
      scenario: "platform_to_enterprise",
      approver: enterprise,
      grantee: enterprise,
      targetPrincipal: undefined,
    };
    const enterpriseReceipt = requestMission(enterpriseInput, actor, nowMs);
    const employeeGrantId = input.grantId
      ? `${input.grantId}:employee`
      : `grant:${input.commandId}:employee`;
    const employeeInput: DelegationCommandInput = {
      ...input,
      commandId: `${input.commandId}:employee`,
      grantId: employeeGrantId,
      missionId: undefined,
      scenario: "enterprise_to_employee",
      actor: enterprise,
      trusted: { tenantId: enterprise.principal.tenantId },
      approver: employee,
      grantee: employee,
    };
    const employeeReceipt = requestMission(employeeInput, enterprise, nowMs);
    const missionId = input.missionId ?? `msn:${input.commandId}`;
    const mission: RemoteDiagnosisMission = {
      schemaVersion: 1,
      missionId,
      requesterAgent: actor.principal.principalId,
      assignedAgent: employee.principal.principalId,
      grantId: employeeReceipt.grantId ?? employeeGrantId,
      requiredGrantIds: [
        enterpriseReceipt.grantId ?? `${input.commandId}:enterprise`,
        employeeReceipt.grantId ?? employeeGrantId,
      ],
      targetTenant: input.targetTenant ?? employee.principal.tenantId,
      ...(input.targetPrincipal ? { targetPrincipal: input.targetPrincipal } : {}),
      requestedInputs: [...(input.allowedEvidence ?? [])],
      returnedOutputs: [],
      status: "REQUESTED",
      scenario: "platform_to_employee",
      ...(input.conversationRunId ? { conversationRunId: input.conversationRunId } : {}),
      auditReceipt: `aud:${missionId}`,
    };
    store.putMission(mission);
    return persistReceipt({
      commandId: input.commandId,
      grantId: mission.grantId,
      missionId,
      status: "REQUESTED",
      idempotent: false,
      reason: "dual_authorization_required",
    });
  };

  const syncMission = (grantId: string, nowMs: number) => {
    for (const candidate of store.listMissions()) {
      if (candidate.requiredGrantIds.includes(grantId) || candidate.grantId === grantId) {
        store.putMission(refreshMission(candidate, nowMs));
      }
    }
  };

  const refreshMission = (
    mission: RemoteDiagnosisMission,
    nowMs: number,
  ): RemoteDiagnosisMission => {
    const grants = mission.requiredGrantIds.map((id) => {
      const grant = store.getGrant(id);
      return grant ? refreshStatus(grant, nowMs) : undefined;
    });
    if (grants.some((grant) => !grant || grant.status === "DENIED" || grant.status === "REVOKED")) {
      return {
        ...mission,
        status: grants.some((grant) => grant?.status === "DENIED") ? "DENIED" : "REVOKED",
      };
    }
    if (grants.some((grant) => grant?.status === "EXPIRED" || grant?.status === "SUSPENDED")) {
      const blocked = grants.find(
        (grant) => grant?.status === "EXPIRED" || grant?.status === "SUSPENDED",
      );
      return { ...mission, status: blocked?.status === "EXPIRED" ? "EXPIRED" : "SUSPENDED" };
    }
    if (
      grants.length > 0 &&
      grants.every((grant) => grant?.status === "APPROVED" || grant?.status === "CONSUMED")
    ) {
      return { ...mission, status: mission.status === "CONSUMED" ? "CONSUMED" : "APPROVED" };
    }
    return mission;
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
      // Trusted-context checks run before idempotent replay so a mismatched
      // platform/enterprise context cannot reuse a cached receipt.
      const actor = assertTrustedActor(input);
      const cached = store.getCommand(input.commandId);
      if (cached) {
        return { ...cached, idempotent: true };
      }
      const nowMs = now();
      if (input.command === "request") {
        if (input.scenario === "platform_to_employee") {
          return requestPlatformEmployee(input, actor, nowMs);
        }
        return requestMission(input, actor, nowMs);
      }
      const grantId = input.grantId ?? fail("missing_field", "grantId is required", "grantId");
      const loaded = store.getGrant(grantId) ?? fail("not_found", "grant not found", "grantId");
      const grant = refreshStatus(loaded, nowMs);
      if (grant.status === "EXPIRED" && grant.status !== loaded.status) {
        store.putGrant(grant);
        const delegation = store.getDelegation(`dlg:${grantId}`);
        if (delegation) {
          store.putDelegation({ ...delegation, status: "EXPIRED" });
        }
      }
      if (input.command !== "expire" && grant.status === "EXPIRED" && input.command !== "revoke") {
        fail("grant_expired", "grant has expired", "expiresAt");
      }
      const nextStatus = assertTransition(grant.status, input.command);
      if (input.command === "approve") {
        const needed = requiredApprover(
          input.scenario ?? (grant.purpose as DelegationScenario),
          grant,
        );
        if (
          actor.role !== grant.approver.role ||
          actor.principal.principalId !== grant.approver.principal.principalId
        ) {
          fail("unauthorized", "only the designated approver may approve this grant", "actor");
        }
        if (actor.role !== needed && grant.approver.role !== actor.role) {
          fail(
            "unauthorized",
            "approver role does not match the required authorization",
            "actor.role",
          );
        }
      }
      if (
        (input.command === "deny" ||
          input.command === "revoke" ||
          input.command === "suspend" ||
          input.command === "resume") &&
        actor.principal.principalId !== grant.approver.principal.principalId &&
        actor.principal.principalId !== grant.issuer.principal.principalId
      ) {
        fail("unauthorized", "only issuer or approver may change grant status", "actor");
      }
      const next: AuthorizationGrant = { ...grant, status: nextStatus };
      store.putGrant(next);
      const delegation = store.getDelegation(`dlg:${grantId}`);
      if (delegation) {
        store.putDelegation({ ...refreshStatus(delegation, nowMs), status: nextStatus });
      }
      if (input.missionId) {
        const mission = store.getMission(input.missionId);
        if (mission) {
          store.putMission(
            refreshMission(
              {
                ...mission,
                ...(input.conversationRunId ? { conversationRunId: input.conversationRunId } : {}),
              },
              nowMs,
            ),
          );
        }
      } else {
        syncMission(grantId, nowMs);
        const linked =
          store.getMission(`msn:${input.commandId}`) ?? store.getMission(`msn:${grantId}`);
        if (linked) {
          store.putMission(refreshMission(linked, nowMs));
        }
      }
      if (input.command === "consume") {
        if (input.outputs) {
          for (const output of input.outputs) {
            if ((FORBIDDEN_EVOLUTION_MUTATIONS as readonly string[]).includes(output.id)) {
              fail(
                "evolution_mutation_forbidden",
                "remote consult cannot mutate Skill/DNA/Capsule/Fabric",
                "outputs",
              );
            }
            if (
              output.kind === "evidence_ref" &&
              grant.sourceTenant !== grant.targetTenant &&
              !input.shareEvidenceIds?.includes(output.id)
            ) {
              fail(
                "evidence_share_required",
                "raw Evidence cannot cross tenants without EvidenceShareGrant",
                "outputs",
              );
            }
          }
        }
        if (input.shareEvidenceIds?.length) {
          const share: EvidenceShareGrant = {
            schemaVersion: 1,
            grantId: `esh:${grantId}`,
            kind: "evidence_share",
            missionId: input.missionId ?? `msn:${grantId}`,
            sourceTenant: grant.targetTenant,
            targetTenant: grant.sourceTenant,
            evidenceIds: [...input.shareEvidenceIds],
            status: "APPROVED",
            expiresAt: grant.expiresAt,
            auditReceipt: `aud:esh:${grantId}`,
          };
          store.putEvidenceShare(share);
        }
        if (input.shareReportIds?.length || input.shareFindingIds?.length) {
          const share: ReportShareGrant = {
            schemaVersion: 1,
            grantId: `rsh:${grantId}`,
            kind: "report_share",
            missionId: input.missionId ?? `msn:${grantId}`,
            sourceTenant: grant.targetTenant,
            targetTenant: grant.sourceTenant,
            reportIds: [...(input.shareReportIds ?? [])],
            findingIds: [...(input.shareFindingIds ?? [])],
            status: "APPROVED",
            expiresAt: grant.expiresAt,
            auditReceipt: `aud:rsh:${grantId}`,
          };
          store.putReportShare(share);
        }
        if (!next.oneShot && input.outputs) {
          // non-oneShot consume still records outputs on the mission
        }
        const mission = input.missionId ? store.getMission(input.missionId) : undefined;
        if (mission && input.outputs) {
          store.putMission({
            ...mission,
            returnedOutputs: input.outputs.map((row) => ({ ...row, redacted: true })),
            status: next.oneShot ? "CONSUMED" : mission.status,
            ...(input.shareEvidenceIds?.length ? { evidenceShareGrantId: `esh:${grantId}` } : {}),
            ...(input.shareReportIds?.length || input.shareFindingIds?.length
              ? { reportShareGrantId: `rsh:${grantId}` }
              : {}),
          });
        }
      }
      return persistReceipt({
        commandId: input.commandId,
        grantId,
        ...(input.missionId ? { missionId: input.missionId } : {}),
        status: nextStatus,
        idempotent: false,
      });
    },
    getGrant: (grantId) => {
      const grant = store.getGrant(grantId);
      return grant ? refreshStatus(grant, now()) : undefined;
    },
    getDelegation: (grantId) => {
      const grant = store.getDelegation(grantId);
      return grant ? refreshStatus(grant, now()) : undefined;
    },
    getMission: (missionId) => {
      const mission = store.getMission(missionId);
      return mission ? refreshMission(mission, now()) : undefined;
    },
    getEvidenceShare: (grantId) => store.getEvidenceShare(grantId),
    getReportShare: (grantId) => store.getReportShare(grantId),
    inspectGrant(grantId) {
      const grant = store.getGrant(grantId);
      if (!grant) {
        return { status: "missing" };
      }
      return { status: refreshStatus(grant, now()).status };
    },
    assertDeliverable({ signal, auth, route }) {
      const grantId = auth?.delegationGrantId;
      if (!grantId) {
        return { ok: false, reason: "delegation_required" };
      }
      const delegation = store.getDelegation(grantId) ?? store.getDelegation(`dlg:${grantId}`);
      const authGrant =
        store.getGrant(grantId) ??
        (delegation ? store.getGrant(delegation.authorizationGrantId) : undefined);
      if (!delegation || !authGrant) {
        return { ok: false, reason: "delegation_missing" };
      }
      const nowMs = now();
      const liveAuth = refreshStatus(authGrant, nowMs);
      const liveDlg = refreshStatus(delegation, nowMs);
      if (BLOCKING.has(liveAuth.status) || BLOCKING.has(liveDlg.status)) {
        return {
          ok: false,
          reason:
            liveAuth.status === "EXPIRED" || liveDlg.status === "EXPIRED"
              ? "grant_expired"
              : liveAuth.status === "REVOKED" || liveDlg.status === "REVOKED"
                ? "grant_revoked"
                : liveAuth.status === "SUSPENDED" || liveDlg.status === "SUSPENDED"
                  ? "grant_suspended"
                  : liveAuth.status === "CONSUMED"
                    ? "grant_consumed"
                    : "grant_inactive",
        };
      }
      const principalId = typeof auth.principalId === "string" ? auth.principalId.trim() : "";
      if (!principalId) {
        return { ok: false, reason: "principal_required" };
      }
      if (principalId !== liveDlg.delegatedAgent) {
        return { ok: false, reason: "principal_mismatch" };
      }
      if (auth.sessionDomain && auth.sessionDomain !== liveDlg.delegatedRole) {
        return { ok: false, reason: "role_mismatch" };
      }
      if (liveDlg.tenantScope !== signal.tenantId) {
        return { ok: false, reason: "scope_mismatch" };
      }
      if (liveDlg.delegatedRole !== route) {
        return { ok: false, reason: "scope_mismatch" };
      }
      return { ok: true };
    },
    restoreGrant(grant, trusted) {
      validateDiagnosticPrincipal(grant.approver.principal, trusted, "approver.principal");
      if (grant.targetTenant !== trusted.tenantId && grant.approver.role !== "platform") {
        if (grant.approver.principal.tenantId !== trusted.tenantId) {
          fail(
            "tenant_mismatch",
            "restored grant tenant does not match trusted tenant",
            "targetTenant",
          );
        }
      }
      const restored = refreshStatus(grant, now());
      store.putGrant(restored);
      return restored;
    },
  };
}

function toIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

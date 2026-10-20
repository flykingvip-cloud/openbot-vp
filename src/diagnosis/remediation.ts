/**
 * Phase 9 — in-process governed remediation preview, approval, execution gate,
 * verification, and rollback. Default executor is dry-run / unavailable.
 * Does not call Doctor --fix, Channel restart, config writes, Skill
 * install/disable, runtime actions, chat, or live gateway packs.
 */
import type {
  DiagnosisEvolutionProposalMachine,
  EvolutionAuthorizationInspector,
  EvolutionAuthorizationView,
  EvolutionProposal,
  EvolutionProposalActor,
} from "./evolution-proposal.js";
import {
  DiagnosisContractError,
  validateDiagnosticPrincipal,
  validateDiagnosticTarget,
  type DiagnosticTarget,
  type TrustedTenantContext,
} from "./types.js";

export const DIAGNOSIS_REMEDIATION_SCHEMA_VERSION = 1 as const;

export const REMEDIATION_ACTION_TYPES = [
  "read_only_check",
  "safe_reversible",
  "configuration_change",
  "doctor_repair",
  "channel_restart",
  "skill_disable",
  "batch_change",
] as const;
export type RemediationActionType = (typeof REMEDIATION_ACTION_TYPES)[number];

export const REMEDIATION_STATUSES = [
  "PROPOSED",
  "PREVIEWED",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "VERIFYING",
  "VERIFIED",
  "ROLLED_BACK",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
  "BLOCKED",
  "FAILED",
] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

export const REMEDIATION_COMMANDS = [
  "propose",
  "preview",
  "submit",
  "approve",
  "reject",
  "execute",
  "verify",
  "rollback",
  "expire",
  "revoke",
] as const;
export type RemediationCommand = (typeof REMEDIATION_COMMANDS)[number];

export const REMEDIATION_VERDICTS = ["improved", "unchanged", "regressed", "inconclusive"] as const;
export type RemediationVerdict = (typeof REMEDIATION_VERDICTS)[number];

export const BLOCKED_RUNTIME_ACTIONS = [
  "doctor_repair",
  "channel_restart",
  "skill_disable",
] as const;
export const PRODUCTION_ACTIONS = [
  ...BLOCKED_RUNTIME_ACTIONS,
  "configuration_change",
  "batch_change",
] as const;

const GRANT_BLOCKING = new Set([
  "DENIED",
  "EXPIRED",
  "REVOKED",
  "CONSUMED",
  "SUSPENDED",
  "REQUESTED",
  "missing",
]);
const P8_READY = new Set(["APPROVED", "APPLIED", "VERIFIED"]);
const FORBIDDEN_PAYLOAD_KEYS = [
  "prompt",
  "transcript",
  "toolOutput",
  "skillBody",
  "doctorFix",
  "evidencePayload",
] as const;

export type RemediationRiskLevel = "low" | "medium" | "high";

export type RemediationDryRunPreview = {
  dryRun: true;
  impactScope: { tenantId: string | null; targetId: string; actionType: RemediationActionType };
  rollbackPlan: { summary: string; reversible: boolean };
  sideEffects: string[];
};

export type RemediationProposal = {
  schemaVersion: 1;
  remediationId: string;
  sourceProposalId: string;
  sourceCaseId?: string;
  targetTenant: string | null;
  target: DiagnosticTarget;
  actionType: RemediationActionType;
  riskLevel: RemediationRiskLevel;
  dryRunPreview?: RemediationDryRunPreview;
  expectedEffect: string;
  rollbackPlan: { summary: string; reversible: boolean };
  requiredApprovals: string[];
  authorizationRefs: {
    grantId: string;
    enterpriseGrantId?: string;
    employeeGrantId?: string;
    platformGrantId?: string;
  };
  status: RemediationStatus;
  auditReceipt: string;
  executionRef?: string;
  verificationRef?: string;
  failureEvidence?: string[];
  expiresAt: string;
};

export type RemediationExecution = {
  schemaVersion: 1;
  executionId: string;
  remediationId: string;
  approvedBy?: string;
  startedAt: string;
  finishedAt?: string;
  actionResult: "dry_run" | "blocked" | "failed" | "unavailable";
  sideEffectSummary: string[];
  rollbackRef?: string;
  verificationRef?: string;
  baselineWindow?: RemediationWindow;
  status: "EXECUTING" | "EXECUTED" | "FAILED" | "BLOCKED" | "ROLLED_BACK";
  appliedToRuntime: false;
};

export type RemediationWindow = {
  from: string;
  to: string;
  metric: string;
};

export type RemediationVerification = {
  schemaVersion: 1;
  verificationId: string;
  remediationId: string;
  executionId: string;
  baselineWindow: RemediationWindow;
  observationWindow: RemediationWindow;
  expectedOutcome: { metric: string; direction: "decrease" | "increase" };
  actualOutcome: { metric: string; baseline: number; observed: number };
  verdict: RemediationVerdict;
  evidenceRefs: string[];
  missingEvidence?: string[];
  status: "VERIFYING" | "VERIFIED" | "FAILED";
};

export type EvolutionProposalView = {
  proposalId: string;
  status: string;
  tenantScope: string | null;
  grantId: string;
  sourceCaseId?: string;
  sourceEvidenceRefs: string[];
};

export type EvolutionProposalInspector = {
  inspect(proposalId: string): EvolutionProposalView | { status: "missing" };
};

export type RemediationExecutor = {
  preview(input: {
    actionType: RemediationActionType;
    target: DiagnosticTarget;
  }): RemediationDryRunPreview;
  execute(input: {
    actionType: RemediationActionType;
    target: DiagnosticTarget;
    remediationId: string;
  }):
    | { ok: true; result: "dry_run"; sideEffects: string[] }
    | { ok: false; reason: "failed" | "unavailable"; evidence: string[] };
};

export type RemediationMetricReader = {
  read(window: RemediationWindow): {
    value?: number;
    evidenceRefs: string[];
    missingEvidence?: string[];
    copiedFindingIds?: string[];
  };
};

export type RemediationCommandInput = {
  commandId: string;
  command: RemediationCommand;
  trusted: TrustedTenantContext;
  actor: EvolutionProposalActor;
  remediationId?: string;
  executionId?: string;
  sourceProposalId?: string;
  grantId?: string;
  enterpriseGrantId?: string;
  employeeGrantId?: string;
  platformGrantId?: string;
  target?: DiagnosticTarget;
  actionType?: RemediationActionType;
  expectedEffect?: string;
  expectedOutcome?: { metric: string; direction: "decrease" | "increase" };
  expiresAt?: string;
  escalateRollback?: boolean;
  sessionTenantId?: unknown;
};

export type RemediationReceipt = {
  commandId: string;
  remediationId: string;
  status: RemediationStatus;
  idempotent: boolean;
  executionId?: string;
  verificationId?: string;
  reason?: string;
};

export type RemediationStore = {
  getProposal(id: string): RemediationProposal | undefined;
  putProposal(row: RemediationProposal): void;
  getExecution(id: string): RemediationExecution | undefined;
  putExecution(row: RemediationExecution): void;
  getVerification(id: string): RemediationVerification | undefined;
  putVerification(row: RemediationVerification): void;
  getCommand(id: string): RemediationReceipt | undefined;
  putCommand(id: string, receipt: RemediationReceipt): void;
};

export type DiagnosisRemediationMachine = {
  dispatch(input: RemediationCommandInput): RemediationReceipt;
  getProposal(id: string): RemediationProposal | undefined;
  getExecution(id: string): RemediationExecution | undefined;
  getVerification(id: string): RemediationVerification | undefined;
};

function fail(code: string, message: string, path = "command"): never {
  throw new DiagnosisContractError(code, message, path);
}

export function riskForAction(action: RemediationActionType): RemediationRiskLevel {
  if (action === "read_only_check") {
    return "low";
  }
  if (action === "safe_reversible") {
    return "medium";
  }
  return "high";
}

export function requiresHumanApproval(action: RemediationActionType): boolean {
  return riskForAction(action) === "high";
}

export function createMemoryRemediationStore(): RemediationStore {
  const proposals = new Map<string, RemediationProposal>();
  const executions = new Map<string, RemediationExecution>();
  const verifications = new Map<string, RemediationVerification>();
  const commands = new Map<string, RemediationReceipt>();
  return {
    getProposal: (id) => proposals.get(id),
    putProposal: (row) => {
      proposals.set(row.remediationId, row);
    },
    getExecution: (id) => executions.get(id),
    putExecution: (row) => {
      executions.set(row.executionId, row);
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

export function createUnavailableRemediationStore(): RemediationStore {
  const down = (): never =>
    fail("remediation_store_unavailable", "remediation store is unavailable", "store");
  return {
    getProposal: down,
    putProposal: down,
    getExecution: down,
    putExecution: down,
    getVerification: down,
    putVerification: down,
    getCommand: down,
    putCommand: down,
  };
}

export function createDryRunRemediationExecutor(): RemediationExecutor {
  return {
    preview({ actionType, target }) {
      return {
        dryRun: true,
        impactScope: { tenantId: target.tenantId, targetId: target.targetId, actionType },
        rollbackPlan: {
          summary: `dry-run rollback for ${actionType}`,
          reversible: actionType === "read_only_check" || actionType === "safe_reversible",
        },
        sideEffects: [],
      };
    },
    execute() {
      return { ok: true, result: "dry_run", sideEffects: [] };
    },
  };
}

export function createUnavailableRemediationExecutor(): RemediationExecutor {
  return {
    preview: () => fail("executor_unavailable", "remediation executor is unavailable", "executor"),
    execute: () => ({ ok: false, reason: "unavailable", evidence: ["executor_unavailable"] }),
  };
}

export function createUnavailableMetricReader(): RemediationMetricReader {
  return {
    read: () => fail("metric_reader_unavailable", "verification reader is unavailable", "reader"),
  };
}

export function createEvolutionProposalInspector(
  machine: Pick<DiagnosisEvolutionProposalMachine, "getProposal">,
): EvolutionProposalInspector {
  return {
    inspect(proposalId) {
      const proposal: EvolutionProposal | undefined = machine.getProposal(proposalId);
      if (!proposal) {
        return { status: "missing" };
      }
      return {
        proposalId,
        status: proposal.status,
        tenantScope: proposal.tenantScope,
        grantId: proposal.grantId,
        ...(proposal.sourceCaseId ? { sourceCaseId: proposal.sourceCaseId } : {}),
        sourceEvidenceRefs: [...proposal.sourceEvidenceRefs],
      };
    },
  };
}

export function createDiagnosisRemediationMachine(
  deps: {
    now?: () => number;
    store?: RemediationStore;
    grantInspector?: EvolutionAuthorizationInspector;
    proposalInspector?: EvolutionProposalInspector;
    executor?: RemediationExecutor;
    metricReader?: RemediationMetricReader;
  } = {},
): DiagnosisRemediationMachine {
  const now = deps.now ?? Date.now;
  const store = deps.store ?? createMemoryRemediationStore();
  const executor = deps.executor ?? createUnavailableRemediationExecutor();
  const reader = deps.metricReader ?? createUnavailableMetricReader();

  const persist = (receipt: RemediationReceipt): RemediationReceipt => {
    store.putCommand(receipt.commandId, receipt);
    return receipt;
  };

  const refresh = (row: RemediationProposal, nowMs: number): RemediationProposal => {
    if (
      row.status !== "EXECUTED" &&
      row.status !== "VERIFIED" &&
      row.status !== "ROLLED_BACK" &&
      row.status !== "FAILED" &&
      row.status !== "BLOCKED" &&
      Date.parse(row.expiresAt) <= nowMs
    ) {
      return { ...row, status: "EXPIRED" };
    }
    return row;
  };

  const requireGrant = (grantId: string, path = "grantId"): EvolutionAuthorizationView => {
    if (!deps.grantInspector) {
      fail("authorization_required", "grant inspector is required", "grantInspector");
    }
    const viewed = deps.grantInspector.inspect(grantId);
    if (viewed.status === "missing" || !("grantId" in viewed)) {
      fail("authorization_required", "linked grant is missing", path);
    }
    if (GRANT_BLOCKING.has(viewed.status) || viewed.status !== "APPROVED") {
      fail(
        viewed.status === "EXPIRED"
          ? "grant_expired"
          : viewed.status === "REVOKED"
            ? "grant_revoked"
            : viewed.status === "CONSUMED"
              ? "grant_consumed"
              : viewed.status === "SUSPENDED"
                ? "grant_suspended"
                : "grant_inactive",
        "linked grant is not approved",
        path,
      );
    }
    return viewed;
  };

  const assertActor = (input: RemediationCommandInput): EvolutionProposalActor => {
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

  const assertLiveAuth = (
    proposal: RemediationProposal,
    actor: EvolutionProposalActor,
    trusted: TrustedTenantContext,
  ) => {
    const grant = requireGrant(proposal.authorizationRefs.grantId);
    if (grant.tenantScope !== proposal.targetTenant) {
      fail("scope_widened", "remediation tenant no longer matches grant", "targetTenant");
    }
    if (actor.role !== "platform" && proposal.targetTenant !== trusted.tenantId) {
      fail("tenant_mismatch", "remediation tenant must match trusted tenant", "targetTenant");
    }
    if (proposal.targetTenant === null || actor.role === "platform") {
      const refs = proposal.authorizationRefs;
      if (!refs.platformGrantId || !refs.enterpriseGrantId || !refs.employeeGrantId) {
        fail(
          "dual_authorization_required",
          "cross-tenant remediation requires platform, enterprise, and employee grants",
          "authorizationRefs",
        );
      }
      requireGrant(refs.platformGrantId, "platformGrantId");
      requireGrant(refs.enterpriseGrantId, "enterpriseGrantId");
      requireGrant(refs.employeeGrantId, "employeeGrantId");
    }
    return grant;
  };

  const propose = (
    input: RemediationCommandInput,
    actor: EvolutionProposalActor,
    nowMs: number,
  ): RemediationReceipt => {
    const sourceProposalId =
      input.sourceProposalId ??
      fail("missing_field", "sourceProposalId is required", "sourceProposalId");
    if (!deps.proposalInspector) {
      fail("authorization_required", "proposal inspector is required", "proposalInspector");
    }
    const source = deps.proposalInspector.inspect(sourceProposalId);
    if (source.status === "missing" || !("proposalId" in source)) {
      fail("not_found", "source EvolutionProposal not found", "sourceProposalId");
    }
    if (!P8_READY.has(source.status)) {
      fail("p8_approval_required", "P8 proposal must already be approved", "sourceProposalId");
    }
    const grantId = input.grantId ?? source.grantId;
    const grant = requireGrant(grantId);
    const actionType =
      input.actionType ?? fail("missing_field", "actionType is required", "actionType");
    if (!(REMEDIATION_ACTION_TYPES as readonly string[]).includes(actionType)) {
      fail("invalid_literal", "actionType is not a governed remediation action", "actionType");
    }
    if (
      input.expectedEffect &&
      (FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(input.expectedEffect)
    ) {
      fail("model_action_forbidden", "model output cannot become an action", "expectedEffect");
    }
    if (!grant.allowedActions.includes(actionType)) {
      fail("scope_widened", "actionType exceeds grant allowedActions", "actionType");
    }
    const rawTarget = input.target ?? fail("missing_field", "target is required", "target");
    const targetTrusted =
      actor.role === "platform" ? { tenantId: rawTarget.tenantId ?? null } : input.trusted;
    const target = validateDiagnosticTarget(rawTarget, targetTrusted, "target");
    if (target.tenantId !== source.tenantScope || target.tenantId !== grant.tenantScope) {
      fail("scope_widened", "target tenant exceeds P8/P7 scope", "target");
    }
    if (
      actor.role === "employee" &&
      grant.targetPrincipal &&
      grant.targetPrincipal !== actor.principal.principalId
    ) {
      fail("principal_mismatch", "employee may only remediate the granted principal", "actor");
    }
    if (actor.role === "platform" || target.tenantId === null) {
      if (!input.platformGrantId || !input.enterpriseGrantId || !input.employeeGrantId) {
        fail(
          "dual_authorization_required",
          "cross-tenant remediation requires platform, enterprise, and employee grants",
          "authorizationRefs",
        );
      }
      requireGrant(input.platformGrantId, "platformGrantId");
      requireGrant(input.enterpriseGrantId, "enterpriseGrantId");
      requireGrant(input.employeeGrantId, "employeeGrantId");
    }
    const remediationId = input.remediationId ?? `rem:${input.commandId}`;
    const existing = store.getProposal(remediationId);
    if (existing) {
      return persist({
        commandId: input.commandId,
        remediationId,
        status: existing.status,
        idempotent: true,
      });
    }
    const riskLevel = riskForAction(actionType);
    const preview =
      actionType === "read_only_check" ? executor.preview({ actionType, target }) : undefined;
    const proposal: RemediationProposal = {
      schemaVersion: 1,
      remediationId,
      sourceProposalId,
      ...(source.sourceCaseId ? { sourceCaseId: source.sourceCaseId } : {}),
      targetTenant: target.tenantId,
      target,
      actionType,
      riskLevel,
      ...(preview ? { dryRunPreview: preview } : {}),
      expectedEffect: input.expectedEffect ?? `preview ${actionType} without runtime mutation`,
      rollbackPlan: preview?.rollbackPlan ?? {
        summary: `governed rollback plan for ${actionType}`,
        reversible: actionType === "safe_reversible" || actionType === "read_only_check",
      },
      requiredApprovals: requiresHumanApproval(actionType) ? ["human"] : [],
      authorizationRefs: {
        grantId,
        ...(input.enterpriseGrantId ? { enterpriseGrantId: input.enterpriseGrantId } : {}),
        ...(input.employeeGrantId ? { employeeGrantId: input.employeeGrantId } : {}),
        ...(input.platformGrantId ? { platformGrantId: input.platformGrantId } : {}),
      },
      status: preview ? "PREVIEWED" : "PROPOSED",
      auditReceipt: `aud:${remediationId}`,
      expiresAt: input.expiresAt ?? toIso(nowMs + 60 * 60 * 1000),
    };
    store.putProposal(proposal);
    return persist({
      commandId: input.commandId,
      remediationId,
      status: proposal.status,
      idempotent: false,
    });
  };

  const transition = (from: RemediationStatus, command: RemediationCommand): RemediationStatus => {
    if (command === "preview" && from === "PROPOSED") {
      return "PREVIEWED";
    }
    if (command === "submit" && (from === "PROPOSED" || from === "PREVIEWED")) {
      return "PENDING_APPROVAL";
    }
    if (command === "approve" && from === "PENDING_APPROVAL") {
      return "APPROVED";
    }
    if (
      command === "reject" &&
      (from === "PROPOSED" || from === "PREVIEWED" || from === "PENDING_APPROVAL")
    ) {
      return "REJECTED";
    }
    if (
      command === "revoke" &&
      (from === "PROPOSED" ||
        from === "PREVIEWED" ||
        from === "PENDING_APPROVAL" ||
        from === "APPROVED")
    ) {
      return "REVOKED";
    }
    if (
      command === "expire" &&
      from !== "EXECUTED" &&
      from !== "VERIFIED" &&
      from !== "ROLLED_BACK"
    ) {
      return "EXPIRED";
    }
    fail("illegal_transition", `cannot ${command} a ${from} remediation`, "status");
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
      const actor = assertActor(input);
      const nowMs = now();
      if (input.command === "propose") {
        return propose(input, actor, nowMs);
      }
      const remediationId =
        input.remediationId ?? fail("missing_field", "remediationId is required", "remediationId");
      const loaded =
        store.getProposal(remediationId) ??
        fail("not_found", "remediation not found", "remediationId");
      let proposal = refresh(loaded, nowMs);
      if (proposal.status === "EXPIRED" && loaded.status !== "EXPIRED") {
        store.putProposal(proposal);
      }
      if (proposal.status === "EXPIRED" && input.command !== "expire") {
        fail("grant_expired", "remediation has expired", "expiresAt");
      }
      const grant = assertLiveAuth(proposal, actor, input.trusted);
      if (input.command === "preview") {
        const nextStatus = transition(proposal.status, "preview");
        const preview = executor.preview({
          actionType: proposal.actionType,
          target: proposal.target,
        });
        store.putProposal({
          ...proposal,
          status: nextStatus,
          dryRunPreview: preview,
          rollbackPlan: preview.rollbackPlan,
        });
        return persist({
          commandId: input.commandId,
          remediationId,
          status: nextStatus,
          idempotent: false,
        });
      }
      if (
        input.command === "submit" ||
        input.command === "approve" ||
        input.command === "reject" ||
        input.command === "revoke" ||
        input.command === "expire"
      ) {
        const nextStatus = transition(proposal.status, input.command);
        store.putProposal({ ...proposal, status: nextStatus });
        return persist({
          commandId: input.commandId,
          remediationId,
          status: nextStatus,
          idempotent: false,
        });
      }
      if (input.command === "execute") {
        if (proposal.actionType !== "read_only_check" && !proposal.dryRunPreview) {
          fail("preview_required", "execute requires a dry-run preview", "status");
        }
        if (
          proposal.actionType === "safe_reversible" &&
          proposal.status !== "PREVIEWED" &&
          proposal.status !== "APPROVED"
        ) {
          fail(
            "preview_required",
            "safe_reversible execute requires preview and authorization",
            "status",
          );
        }
        if (requiresHumanApproval(proposal.actionType) && proposal.status !== "APPROVED") {
          fail("approval_required", "high-risk remediation requires human approval", "status");
        }
        if (
          proposal.actionType !== "read_only_check" &&
          proposal.actionType !== "safe_reversible" &&
          proposal.status !== "APPROVED"
        ) {
          fail("illegal_transition", `cannot execute a ${proposal.status} remediation`, "status");
        }
        if (proposal.status === "PROPOSED") {
          fail("illegal_transition", "cannot execute a PROPOSED remediation", "status");
        }
        const executionId = input.executionId ?? `rex:${input.commandId}`;
        const existingExec = store.getExecution(executionId);
        if (existingExec) {
          return persist({
            commandId: input.commandId,
            remediationId,
            status: proposal.status,
            idempotent: true,
            executionId,
          });
        }
        const startedAt = toIso(nowMs);
        const baselineWindow: RemediationWindow = {
          from: toIso(nowMs - 60_000),
          to: startedAt,
          metric: input.expectedOutcome?.metric ?? "error_rate",
        };
        if ((PRODUCTION_ACTIONS as readonly string[]).includes(proposal.actionType)) {
          const blocked: RemediationExecution = {
            schemaVersion: 1,
            executionId,
            remediationId,
            startedAt,
            finishedAt: toIso(now()),
            actionResult: "blocked",
            sideEffectSummary: [],
            baselineWindow,
            status: "BLOCKED",
            appliedToRuntime: false,
          };
          store.putExecution(blocked);
          store.putProposal({
            ...proposal,
            status: "BLOCKED",
            executionRef: executionId,
            failureEvidence: [`${proposal.actionType}_blocked`],
          });
          return persist({
            commandId: input.commandId,
            remediationId,
            status: "BLOCKED",
            idempotent: false,
            executionId,
            reason: "production_action_blocked",
          });
        }
        store.putProposal({ ...proposal, status: "EXECUTING" });
        const outcome = executor.execute({
          actionType: proposal.actionType,
          target: proposal.target,
          remediationId,
        });
        if (!outcome.ok) {
          const failed: RemediationExecution = {
            schemaVersion: 1,
            executionId,
            remediationId,
            startedAt,
            finishedAt: toIso(now()),
            actionResult: outcome.reason,
            sideEffectSummary: [],
            baselineWindow,
            status: "FAILED",
            appliedToRuntime: false,
          };
          store.putExecution(failed);
          store.putProposal({
            ...proposal,
            status: "FAILED",
            executionRef: executionId,
            failureEvidence: outcome.evidence,
          });
          return persist({
            commandId: input.commandId,
            remediationId,
            status: "FAILED",
            idempotent: false,
            executionId,
            reason: outcome.reason,
          });
        }
        const executed: RemediationExecution = {
          schemaVersion: 1,
          executionId,
          remediationId,
          ...(proposal.requiredApprovals.length ? { approvedBy: actor.principal.principalId } : {}),
          startedAt,
          finishedAt: toIso(now()),
          actionResult: "dry_run",
          sideEffectSummary: outcome.sideEffects,
          baselineWindow,
          status: "EXECUTED",
          appliedToRuntime: false,
        };
        store.putExecution(executed);
        store.putProposal({ ...proposal, status: "EXECUTED", executionRef: executionId });
        return persist({
          commandId: input.commandId,
          remediationId,
          status: "EXECUTED",
          idempotent: false,
          executionId,
        });
      }
      if (input.command === "verify") {
        if (proposal.status !== "EXECUTED" && proposal.status !== "VERIFYING") {
          fail("illegal_transition", `cannot verify a ${proposal.status} remediation`, "status");
        }
        const executionId =
          proposal.executionRef ?? fail("missing_field", "execute before verify", "executionRef");
        const execution =
          store.getExecution(executionId) ??
          fail("not_found", "execution not found", "executionRef");
        const baseline = execution.baselineWindow ?? {
          from: execution.startedAt,
          to: execution.finishedAt ?? execution.startedAt,
          metric: input.expectedOutcome?.metric ?? "error_rate",
        };
        const observation: RemediationWindow = {
          from: execution.finishedAt ?? execution.startedAt,
          to: toIso(nowMs),
          metric: baseline.metric,
        };
        const before = reader.read(baseline);
        const after = reader.read(observation);
        if (before.copiedFindingIds?.length || after.copiedFindingIds?.length) {
          fail("verification_copied_finding", "verification cannot copy an old Finding", "reader");
        }
        const missing = [...(before.missingEvidence ?? []), ...(after.missingEvidence ?? [])];
        const expected = input.expectedOutcome ?? {
          metric: baseline.metric,
          direction: "decrease" as const,
        };
        let verdict: RemediationVerdict = "inconclusive";
        if (missing.length > 0 || before.value === undefined || after.value === undefined) {
          verdict = "inconclusive";
        } else if (after.value === before.value) {
          verdict = "unchanged";
        } else if (
          expected.direction === "decrease"
            ? after.value < before.value
            : after.value > before.value
        ) {
          verdict = "improved";
        } else {
          verdict = "regressed";
        }
        const verificationId = `ver:${input.commandId}`;
        const success = verdict === "improved" || verdict === "unchanged";
        const verification: RemediationVerification = {
          schemaVersion: 1,
          verificationId,
          remediationId,
          executionId,
          baselineWindow: baseline,
          observationWindow: observation,
          expectedOutcome: expected,
          actualOutcome: {
            metric: expected.metric,
            baseline: before.value ?? Number.NaN,
            observed: after.value ?? Number.NaN,
          },
          verdict,
          evidenceRefs: [...before.evidenceRefs, ...after.evidenceRefs],
          ...(missing.length ? { missingEvidence: missing } : {}),
          status: success ? "VERIFIED" : "FAILED",
        };
        store.putVerification(verification);
        store.putExecution({ ...execution, verificationRef: verificationId });
        store.putProposal({
          ...proposal,
          status: success ? "VERIFIED" : "FAILED",
          verificationRef: verificationId,
          ...(success ? {} : { failureEvidence: missing.length ? missing : [verdict] }),
        });
        return persist({
          commandId: input.commandId,
          remediationId,
          status: success ? "VERIFIED" : "FAILED",
          idempotent: false,
          executionId,
          verificationId,
          reason: verdict,
        });
      }
      if (input.command === "rollback") {
        if (
          proposal.status !== "EXECUTED" &&
          proposal.status !== "VERIFYING" &&
          proposal.status !== "VERIFIED" &&
          proposal.status !== "FAILED"
        ) {
          fail("illegal_transition", `cannot rollback a ${proposal.status} remediation`, "status");
        }
        if (!proposal.rollbackPlan.reversible && !input.escalateRollback) {
          fail("rollback_forbidden", "rollback plan is not reversible", "rollbackPlan");
        }
        if (!grant.allowedActions.includes(proposal.actionType)) {
          fail("scope_widened", "rollback action exceeds grant allowedActions", "actionType");
        }
        if ((PRODUCTION_ACTIONS as readonly string[]).includes(proposal.actionType)) {
          fail(
            "production_action_blocked",
            "rollback cannot invoke a production action",
            "actionType",
          );
        }
        const executionId = proposal.executionRef ?? `rex:${input.commandId}`;
        const existing = store.getExecution(executionId);
        const rolled: RemediationExecution = {
          schemaVersion: 1,
          executionId,
          remediationId,
          startedAt: existing?.startedAt ?? toIso(nowMs),
          finishedAt: toIso(nowMs),
          actionResult: "dry_run",
          sideEffectSummary: [],
          rollbackRef: `rbk:${input.commandId}`,
          status: "ROLLED_BACK",
          appliedToRuntime: false,
        };
        store.putExecution(rolled);
        store.putProposal({ ...proposal, status: "ROLLED_BACK", executionRef: executionId });
        return persist({
          commandId: input.commandId,
          remediationId,
          status: "ROLLED_BACK",
          idempotent: false,
          executionId,
        });
      }
      fail("illegal_transition", "unhandled remediation command", "command");
    },
    getProposal: (id) => {
      const row = store.getProposal(id);
      return row ? refresh(row, now()) : undefined;
    },
    getExecution: (id) => store.getExecution(id),
    getVerification: (id) => store.getVerification(id),
  };
}

function toIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

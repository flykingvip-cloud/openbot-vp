import {
  assertCandidateMatchesExperiment,
  assertEvolutionTransition,
  assertExperimentBoundToProposal,
  buildObservationWindow,
  canHold,
  canMarkVerified,
  canPromote,
  capsuleMetricSet,
  classifyBaselineCapture,
  evaluateExperiment,
  evaluateSurfaceAutonomy,
  organizationMetricSet,
  recommendAutonomyFollowUp,
  runtimeGovernanceMetricSet,
  skillMetricSet,
  verificationOutcomeFromDecision,
  workingDnaMetricSet,
  type SurfaceAutonomyPolicy,
  type DomainTargetHint,
  type EvolutionAdapter,
  type EvolutionApplication,
  type EvolutionExperiment,
  type EvolutionProposal,
  type EvolutionVerification,
  type CapsuleObservationEligibility,
  type ExperimentDecision,
  type ExternalEffectVerificationResult,
  requiredVerifierIdForSurface,
  type ExpectedExternalEffect,
  type RollbackDrillRecord,
  type DiagnosisRecheckPort,
  type EvaluationDecision,
  type AuthorityRecheckDecision,
  type ExternalEffectDomainReader,
} from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import type { EvolutionProposal as DiagnosisProposalV1 } from "../../diagnosis/evolution-proposal.js";
import type { CapsuleCandidate } from "./adapters/capsule.js";
import { createFailClosedAdapter } from "./adapters/fail-closed.js";
import type { OrganizationCandidate } from "./adapters/organization.js";
import type { RuntimeGovernanceCandidate } from "./adapters/runtime-governance.js";
import type { SkillCandidate } from "./adapters/skill.js";
import type { WorkingDnaCandidate } from "./adapters/working-dna.js";
import { checkEvolutionAuthority } from "./authority-gate.js";
import { recheckAuthorityFromLedger, skillAgentIdFromCandidate } from "./authority-recheck.js";
import {
  createMemoryCandidateStore,
  hashCandidatePayload,
  sealGovernedCandidate,
  type GovernedCandidate,
} from "./candidate-store.js";
import {
  assertDiagnosisControlledApply,
  diagnosisApplyApprovalFor,
} from "./diagnosis-apply-gate.js";
import { createMemoryEvolutionLedger, type EvolutionLedger } from "./evolution-ledger.js";
import {
  assertApplicationApproval,
  createExperiment,
  createMemoryExperimentStore,
  evaluateStoredExperiment,
} from "./experiment-manager.js";
import type { VerifierRegistry } from "./external-effect-registry.js";
import { createExternalEffectService } from "./external-effect-service.js";
import {
  createFailClosedObservationProvider,
  type ExperimentObservationProvider,
} from "./observation.js";
import { createEvolutionControlPersistence } from "./persistent-store.js";
import { createMemoryEvolutionProposalIndex } from "./proposal-projection.js";
import { resolveEvolutionSurface } from "./surface-registry.js";
import { createReadonlyEvolutionDomainReader } from "./verifiers/readonly-domain.js";
import { SKILL_INSTALLATION_RAW_VERIFIER_ID } from "./verifiers/skill-installation-raw.js";
import { WORKING_DNA_RAW_VERIFIER_ID } from "./verifiers/working-dna-raw.js";
import {
  diagnosisOriginEvaluationApplies,
  evaluateSkillInstallationClosure as decideSkillInstallationEvaluation,
  evaluateWorkingDnaClosure as decideWorkingDnaEvaluation,
  skillInstallationEvaluationApplies,
  workingDnaEvaluationApplies,
} from "./working-dna-evaluation.js";

type ApplyCommand = {
  commandId: string;
  proposalId: string;
  experimentId: string;
  principalRef: string;
  trustedTenantId: string | null;
  scope: EvolutionApplication["scope"];
  unattended?: boolean;
};

export type EvolutionControlPlane = {
  ingestV1(proposal: DiagnosisProposalV1, targetHint?: DomainTargetHint): EvolutionProposal;
  getProposal(proposalId: string): EvolutionProposal | undefined;
  listProposals(): EvolutionProposal[];
  startExperiment(input: {
    commandId: string;
    proposalId: string;
    freeze: EvolutionExperiment["frozen"];
    now: string;
  }): Promise<EvolutionExperiment>;
  startWorkingDnaExperiment(input: {
    commandId: string;
    proposalId: string;
    freeze: EvolutionExperiment["frozen"];
    now: string;
  }): Promise<EvolutionExperiment>;
  evaluateExperiment(experimentId: string): Promise<{
    experiment: EvolutionExperiment;
    decision: ExperimentDecision;
    recommendedFollowUp: "continue" | "hold" | "rollback-recommended";
  }>;
  registerProposal(proposal: EvolutionProposal, candidate?: unknown): EvolutionProposal;
  /** Persist a diagnosis submit onto this plane. Does not start an experiment or Apply. */
  stageDiagnosisProposal(proposal: EvolutionProposal): EvolutionProposal;
  registerCandidate(
    candidateRef: string,
    payload: unknown,
    governedVersion?: string,
  ): GovernedCandidate;
  getCandidate(candidateRef: string): GovernedCandidate | undefined;
  applyWorkingDna(input: ApplyCommand): Promise<EvolutionApplication>;
  applyCapsule(input: ApplyCommand): Promise<EvolutionApplication>;
  applySkill(input: ApplyCommand): Promise<EvolutionApplication>;
  applyOrganization(input: ApplyCommand): Promise<EvolutionApplication>;
  applyRuntimeGovernance(input: ApplyCommand): Promise<EvolutionApplication>;
  getExperiment(experimentId: string): EvolutionExperiment | undefined;
  getApplication(applicationId: string): EvolutionApplication | undefined;
  listApplications(filter?: { proposalId?: string; experimentId?: string }): EvolutionApplication[];
  getVerification(verificationId: string): EvolutionVerification | undefined;
  getRollbackDrill(drillId: string): RollbackDrillRecord | undefined;
  listRollbackDrills(filter?: {
    proposalId?: string;
    experimentId?: string;
  }): RollbackDrillRecord[];
  runRollbackDrill(input: {
    commandId: string;
    applicationId: string;
    principalRef: string;
    trustedTenantId: string | null;
    verifiedBy: string;
    evidenceRefs?: string[];
  }): Promise<RollbackDrillRecord>;
  rejectProposal(input: {
    commandId: string;
    proposalId: string;
    principalRef: string;
    trustedTenantId: string | null;
  }): EvolutionProposal;
  suggestProposal(input: {
    commandId: string;
    proposalId: string;
    principalRef: string;
    trustedTenantId: string | null;
  }): EvolutionProposal;
  expireProposal(input: {
    commandId: string;
    proposalId: string;
    principalRef: string;
    trustedTenantId: string | null;
  }): EvolutionProposal;
  holdProposal(input: {
    commandId: string;
    proposalId: string;
    principalRef: string;
    trustedTenantId: string | null;
  }): EvolutionProposal;
  verifyApplication(input: {
    commandId: string;
    applicationId: string;
    principalRef: string;
    trustedTenantId: string | null;
    now?: string;
  }): Promise<EvolutionVerification>;
  getExternalEffectResult(applicationId: string): ExternalEffectVerificationResult | undefined;
  promoteProposal(input: {
    commandId: string;
    proposalId: string;
    principalRef: string;
    trustedTenantId: string | null;
  }): EvolutionProposal;
  evaluateWorkingDnaClosure(proposalId: string): Promise<EvaluationDecision>;
  evaluateSkillInstallationClosure(proposalId: string): Promise<EvaluationDecision>;
  recheckAuthority(proposalId: string): Promise<AuthorityRecheckDecision>;
  rollbackApplication(input: {
    commandId: string;
    applicationId: string;
    principalRef: string;
    trustedTenantId: string | null;
  }): Promise<{ application: EvolutionApplication; verificationId?: string }>;
  ledger: EvolutionLedger;
};

function metricsForSurface(surfaceId: string) {
  if (surfaceId === "knowledge.experience-capsule") {
    return capsuleMetricSet();
  }
  if (surfaceId === "capability.skill-spec" || surfaceId === "capability.skill-installation") {
    return skillMetricSet();
  }
  if (surfaceId === "organization.task-routing" || surfaceId === "organization.team-composition") {
    return organizationMetricSet();
  }
  if (surfaceId === "system.runtime-binding-governance") {
    return runtimeGovernanceMetricSet();
  }
  return workingDnaMetricSet();
}

export function createEvolutionControlPlane(deps: {
  inspector: EvolutionAuthorizationInspector;
  workingDnaAdapter: EvolutionAdapter<WorkingDnaCandidate>;
  capsuleAdapter?: EvolutionAdapter<CapsuleCandidate>;
  skillSpecAdapter?: EvolutionAdapter<SkillCandidate>;
  skillInstallationAdapter?: EvolutionAdapter<SkillCandidate>;
  organizationAdapter?: EvolutionAdapter<OrganizationCandidate>;
  runtimeGovernanceAdapter?: EvolutionAdapter<RuntimeGovernanceCandidate>;
  isKillSwitchActive?: () => boolean;
  autonomyPolicy?: (surfaceId: string) => SurfaceAutonomyPolicy;
  observationProvider?: ExperimentObservationProvider;
  persistDir?: string;
  now?: () => string;
  styleConfig?: OpenBotConfig;
  verifierRegistry?: VerifierRegistry;
  skillEventsConfigDir?: string;
  readCapsuleEligibility?: (assetId: string) => Promise<CapsuleObservationEligibility>;
  diagnosisRecheckPort?: DiagnosisRecheckPort;
  authorityDomainReader?: ExternalEffectDomainReader;
}): EvolutionControlPlane {
  const persistDir = deps.persistDir?.trim() || undefined;
  const persistence = persistDir ? createEvolutionControlPersistence(persistDir) : undefined;
  const proposals = persistence?.proposals ?? createMemoryEvolutionProposalIndex();
  const experiments = persistence?.experiments ?? createMemoryExperimentStore();
  const candidates = persistence?.candidates ?? createMemoryCandidateStore();
  const observationProvider = deps.observationProvider ?? createFailClosedObservationProvider();
  const targetIndex = persistence?.targetIndex ?? new Map<string, string>();
  const applications = persistence?.applications ?? new Map<string, EvolutionApplication>();
  const verifications = persistence?.verifications ?? new Map<string, EvolutionVerification>();
  const drills = persistence?.drills ?? new Map<string, RollbackDrillRecord>();
  const ledger = persistence?.ledger ?? createMemoryEvolutionLedger();
  const workingDnaEvaluations = new Map<string, EvaluationDecision>();
  const now = deps.now ?? (() => new Date().toISOString());
  const externalEffects = createExternalEffectService({
    persistDir,
    styleConfig: deps.styleConfig,
    skillEventsConfigDir: deps.skillEventsConfigDir,
    registry: deps.verifierRegistry,
  });
  const recordCapsuleExclusion = async (
    commandId: string,
    proposal: EvolutionProposal,
    experimentId?: string,
  ) => {
    if (proposal.surfaceId !== "knowledge.experience-capsule") {
      return;
    }
    if (proposal.target.domain !== "knowledge" || !deps.readCapsuleEligibility) {
      return;
    }
    const eligibility = await deps.readCapsuleEligibility(proposal.target.assetId);
    if (eligibility.eligible) {
      return;
    }
    ledger.append({
      eventId: `led:${commandId}:excluded`,
      type: "observation.excluded",
      timestamp: now(),
      proposalId: proposal.proposalId,
      target: proposal.target,
      surfaceId: proposal.surfaceId,
      tenantScope: proposal.tenantScope,
      principalRef: "control-plane",
      grantId: proposal.grantId,
      evidenceRefs: proposal.sourceEvidenceRefs,
      experimentId,
      exclusionReason: eligibility.reason,
    });
  };
  const expectedWorkingDnaEffect = (
    proposal: EvolutionProposal,
    application: EvolutionApplication,
  ): ExpectedExternalEffect => {
    const stored = candidates.get(proposal.candidateRef);
    const payload = stored?.payload as WorkingDnaCandidate | undefined;
    const field = payload ? (Object.keys(payload.delta)[0] as string | undefined) : undefined;
    return {
      kind: "working-style-field",
      field,
      expectedValue:
        field && payload ? payload.delta[field as keyof WorkingDnaCandidate["delta"]] : undefined,
      expectedVersion: application.targetVersionAfter,
    };
  };
  const expectedSkillInstallationEffect = (
    proposal: EvolutionProposal,
    application: EvolutionApplication,
  ): ExpectedExternalEffect => {
    const stored = candidates.get(proposal.candidateRef);
    const payload = stored?.payload as SkillCandidate | undefined;
    const tokens = application.targetVersionAfter.split(":");
    const installedVersion = tokens.length >= 3 ? tokens[2] : application.targetVersionAfter;
    return {
      kind: "skill-installation",
      field: "installedVersion",
      expectedValue: installedVersion,
      expectedVersion: application.targetVersionAfter,
      expectedEnabled: true,
      ...(payload?.agentId ? { agentId: payload.agentId } : {}),
    };
  };
  const expectedExternalEffect = (
    proposal: EvolutionProposal,
    application: EvolutionApplication,
    verifierId: string,
  ): ExpectedExternalEffect => {
    if (verifierId === SKILL_INSTALLATION_RAW_VERIFIER_ID) {
      return expectedSkillInstallationEffect(proposal, application);
    }
    if (verifierId === WORKING_DNA_RAW_VERIFIER_ID) {
      return expectedWorkingDnaEffect(proposal, application);
    }
    return {
      kind: resolveEvolutionSurface(proposal.surfaceId)?.externalEffectKind ?? "unsupported",
    };
  };
  const rollbackDrillFor = (experimentId: string) => {
    const rows = [...drills.values()].filter((row) => row.experimentId === experimentId);
    if (rows.some((row) => row.result === "failed")) {
      return "failed" as const;
    }
    if (rows.some((row) => row.result === "passed")) {
      return "passed" as const;
    }
    return "not_run" as const;
  };
  const resolveAdapter = (application: EvolutionApplication) => {
    return application.adapterId === "capsule"
      ? capsuleAdapter
      : application.adapterId === "skill"
        ? skillSpecAdapter
        : application.adapterId === "skill-installation"
          ? skillInstallationAdapter
          : application.adapterId === "organization"
            ? organizationAdapter
            : application.adapterId === "runtime-governance"
              ? runtimeGovernanceAdapter
              : deps.workingDnaAdapter;
  };
  const capsuleAdapter = deps.capsuleAdapter ?? createFailClosedAdapter("capsule", "knowledge");
  const skillSpecAdapter = deps.skillSpecAdapter ?? createFailClosedAdapter("skill", "capability");
  const skillInstallationAdapter =
    deps.skillInstallationAdapter ?? createFailClosedAdapter("skill-installation", "capability");
  const organizationAdapter =
    deps.organizationAdapter ?? createFailClosedAdapter("organization", "organization");
  const runtimeGovernanceAdapter =
    deps.runtimeGovernanceAdapter ?? createFailClosedAdapter("runtime-governance", "system");

  const requireProposal = (proposalId: string): EvolutionProposal => {
    const proposal = proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`proposal not found: ${proposalId}`);
    }
    return proposal;
  };

  const requireBoundApply = (
    input: ApplyCommand,
  ): {
    proposal: EvolutionProposal;
    experiment: EvolutionExperiment;
    stored: GovernedCandidate;
  } => {
    const proposal = requireProposal(input.proposalId);
    const experiment = experiments.get(input.experimentId);
    if (!experiment) {
      throw new Error(`experiment not found: ${input.experimentId}`);
    }
    assertExperimentBoundToProposal(experiment, proposal);
    const stored = candidates.get(proposal.candidateRef);
    if (!stored) {
      throw new Error(`governed candidate not found: ${proposal.candidateRef}`);
    }
    assertCandidateMatchesExperiment({
      proposal,
      experiment,
      candidateRef: stored.candidateRef,
      version: stored.version,
      payloadHash: stored.payloadHash,
      expectedHash: hashCandidatePayload(stored.payload),
    });
    return { proposal, experiment, stored };
  };

  const requireBoundCandidate = (
    proposal: EvolutionProposal,
    experiment: EvolutionExperiment,
  ): GovernedCandidate => {
    const stored = candidates.get(proposal.candidateRef);
    if (!stored) {
      throw new Error(`governed candidate not found: ${proposal.candidateRef}`);
    }
    assertCandidateMatchesExperiment({
      proposal,
      experiment,
      candidateRef: stored.candidateRef,
      version: stored.version,
      payloadHash: stored.payloadHash,
      expectedHash: hashCandidatePayload(stored.payload),
    });
    return stored;
  };

  const latestApplicationFor = (experimentId: string): EvolutionApplication | undefined => {
    return [...applications.values()]
      .filter((row) => row.experimentId === experimentId)
      .toSorted((left, right) => (left.appliedAt ?? "").localeCompare(right.appliedAt ?? ""))
      .at(-1);
  };

  const replayOrRejectApplyCommand = (input: ApplyCommand): EvolutionApplication | undefined => {
    if (verifications.has(`ver:${input.commandId}`)) {
      throw new Error("apply requires a commandId distinct from verify");
    }
    const existing = applications.get(`app:${input.commandId}`);
    if (!existing) {
      return undefined;
    }
    if (existing.proposalId !== input.proposalId || existing.experimentId !== input.experimentId) {
      throw new Error("duplicate command cannot retarget another object");
    }
    return existing;
  };

  const applyThroughAdapter = async <TCandidate>(
    adapter: EvolutionAdapter<TCandidate>,
    input: ApplyCommand,
    candidate: TCandidate,
  ): Promise<EvolutionApplication> => {
    if (verifications.has(`ver:${input.commandId}`)) {
      throw new Error("apply requires a commandId distinct from verify");
    }
    const existing = applications.get(`app:${input.commandId}`);
    if (existing) {
      if (
        existing.proposalId !== input.proposalId ||
        existing.experimentId !== input.experimentId
      ) {
        throw new Error("duplicate command cannot retarget another object");
      }
      return existing;
    }
    const proposal = requireProposal(input.proposalId);
    const experiment = experiments.get(input.experimentId);
    if (!experiment) {
      throw new Error(`experiment not found: ${input.experimentId}`);
    }
    assertExperimentBoundToProposal(experiment, proposal);
    requireBoundCandidate(proposal, experiment);
    if (deps.isKillSwitchActive?.()) {
      throw new Error("kill switch blocks new applications");
    }
    assertDiagnosisControlledApply({
      proposal,
      experiment,
      now: now(),
      scope: input.scope,
    });
    if (input.unattended) {
      const autonomy = evaluateSurfaceAutonomy({
        surface: resolveEvolutionSurface(proposal.surfaceId),
        ...(deps.autonomyPolicy ? { policy: deps.autonomyPolicy(proposal.surfaceId) } : {}),
        killSwitch: Boolean(deps.isKillSwitchActive?.()),
        now: now(),
        requestedScope: input.scope,
        expandScope: false,
      });
      if (!autonomy.ok) {
        throw new Error(autonomy.reason);
      }
    }
    const authority = checkEvolutionAuthority(deps.inspector, {
      surfaceId: proposal.surfaceId,
      grantId: proposal.grantId,
      tenantScope: proposal.tenantScope,
      trustedTenantId: input.trustedTenantId,
      requestedAction: "apply",
      evidenceRefs: proposal.sourceEvidenceRefs,
      confidentialityScope: proposal.confidentialityScope,
    });
    if (!authority.ok) {
      throw new Error(authority.reason);
    }
    const validation = await adapter.validate(candidate, {
      proposal,
      experiment,
      grantId: proposal.grantId,
      tenantScope: proposal.tenantScope,
      surfaceId: proposal.surfaceId,
      commandId: input.commandId,
    });
    if (!validation.ok) {
      throw new Error(validation.reason);
    }
    const validated: EvolutionExperiment = { ...experiment, candidateValidated: true };
    experiments.put(validated);
    if (input.scope === "canary") {
      assertApplicationApproval(validated, undefined, "canary");
    } else if (input.scope === "active") {
      assertApplicationApproval(validated);
    }
    let nextProposal = proposal;
    if (input.scope === "canary") {
      const approved = {
        ...proposal,
        status: assertEvolutionTransition(proposal.status, "approve_application"),
      };
      nextProposal = {
        ...approved,
        status: assertEvolutionTransition(approved.status, "apply_canary"),
      };
    } else if (input.scope === "active") {
      if (proposal.status === "CANARY") {
        nextProposal = {
          ...proposal,
          status: assertEvolutionTransition(proposal.status, "activate"),
        };
      } else {
        const approved = {
          ...proposal,
          status: assertEvolutionTransition(proposal.status, "approve_application"),
        };
        nextProposal = {
          ...approved,
          status: assertEvolutionTransition(approved.status, "activate"),
        };
      }
    }
    const applied = await adapter.apply({
      candidate,
      context: {
        proposal: nextProposal,
        experiment: validated,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        surfaceId: proposal.surfaceId,
        commandId: input.commandId,
      },
      idempotencyKey: input.commandId,
      scope: input.scope,
    });
    const application: EvolutionApplication = {
      ...applied,
      appliedToRuntime: input.scope !== "shadow",
      scope: input.scope,
      ...(input.scope === "canary" ? { purpose: "canary" as const } : {}),
    };
    applications.set(application.applicationId, application);
    if (input.scope === "shadow") {
      ledger.append({
        eventId: `led:${input.commandId}:shadow`,
        type: "experiment.shadow_observed",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId: validated.experimentId,
        applicationId: application.applicationId,
        domainReceiptRef: application.rollbackRef,
      });
      return application;
    }
    proposals.put({
      ...nextProposal,
      applicationId: application.applicationId,
    });
    ledger.append({
      eventId: `led:${input.commandId}:applied`,
      type: "application.applied",
      timestamp: now(),
      proposalId: proposal.proposalId,
      target: proposal.target,
      surfaceId: proposal.surfaceId,
      tenantScope: proposal.tenantScope,
      principalRef: input.principalRef,
      grantId: proposal.grantId,
      evidenceRefs: proposal.sourceEvidenceRefs,
      experimentId: validated.experimentId,
      applicationId: application.applicationId,
      domainReceiptRef: application.rollbackRef,
    });
    return application;
  };

  const evaluateDiagnosisOriginSlice = async (
    proposalId: string,
    slice: "working-dna" | "skill-installation",
  ): Promise<EvaluationDecision> => {
    const proposal = requireProposal(proposalId);
    const applies =
      slice === "working-dna"
        ? workingDnaEvaluationApplies(proposal)
        : skillInstallationEvaluationApplies(proposal);
    if (!applies) {
      return { action: "block", reasonCode: "unknown_surface" };
    }
    const experimentId = proposal.experimentId;
    if (!experimentId) {
      throw new Error("experiment not found");
    }
    const experiment = experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`experiment not found: ${experimentId}`);
    }
    const verification = proposal.verificationId
      ? verifications.get(proposal.verificationId)
      : undefined;
    const input = {
      proposal,
      experiment,
      ...(verification ? { verification } : {}),
      externalEffectOutcome: proposal.applicationId
        ? (externalEffects.getResultForApplication(proposal.applicationId)?.outcome ?? null)
        : null,
      drills: [...drills.values()].filter((row) => row.proposalId === proposal.proposalId),
      authorityOk: checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: proposal.tenantScope,
        requestedAction: "promote",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      }).ok,
      ...(deps.diagnosisRecheckPort ? { recheckPort: deps.diagnosisRecheckPort } : {}),
    };
    const decision =
      slice === "working-dna"
        ? await decideWorkingDnaEvaluation(input)
        : await decideSkillInstallationEvaluation(input);
    workingDnaEvaluations.set(proposal.proposalId, decision);
    return decision;
  };

  return {
    ledger,
    getExternalEffectResult: (applicationId) =>
      externalEffects.getResultForApplication(applicationId),
    ingestV1(proposal, targetHint) {
      const projected = proposals.ingestV1(proposal, targetHint);
      ledger.append({
        eventId: `led:${projected.proposalId}:imported`,
        type: "legacy.imported",
        timestamp: now(),
        proposalId: projected.proposalId,
        target: projected.target,
        surfaceId: projected.surfaceId,
        tenantScope: projected.tenantScope,
        principalRef: "diagnosis",
        grantId: projected.grantId,
        evidenceRefs: projected.sourceEvidenceRefs,
        legacySource: true,
      });
      return projected;
    },
    getProposal: (proposalId) => proposals.get(proposalId),
    listProposals: () => proposals.list(),
    stageDiagnosisProposal(proposal) {
      proposals.put(proposal);
      return proposal;
    },
    registerProposal(proposal, candidate) {
      proposals.put(proposal);
      if (candidate !== undefined) {
        candidates.put(sealGovernedCandidate(proposal.candidateRef, candidate));
      }
      ledger.append({
        eventId: `led:${proposal.proposalId}:created`,
        type: "proposal.created",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: "control-plane",
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
      });
      return proposal;
    },
    registerCandidate(candidateRef, payload, governedVersion) {
      const sealed = sealGovernedCandidate(candidateRef, payload, governedVersion);
      candidates.put(sealed);
      return sealed;
    },
    getCandidate(candidateRef) {
      return candidates.get(candidateRef);
    },
    async startExperiment(input) {
      const proposal = requireProposal(input.proposalId);
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: proposal.tenantScope,
        requestedAction: "inspect",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      if (proposal.status === "HELD") {
        const experimentId = proposal.experimentId;
        if (!experimentId) {
          throw new Error("held proposal is missing experimentId");
        }
        const existing = experiments.get(experimentId);
        if (!existing) {
          throw new Error(`experiment not found: ${experimentId}`);
        }
        assertExperimentBoundToProposal(existing, proposal);
        const next = {
          ...proposal,
          status: assertEvolutionTransition(proposal.status, "start_experiment"),
        };
        proposals.put(next);
        ledger.append({
          eventId: `led:${input.commandId}:experiment`,
          type: "experiment.started",
          timestamp: input.now,
          proposalId: proposal.proposalId,
          target: proposal.target,
          surfaceId: proposal.surfaceId,
          tenantScope: proposal.tenantScope,
          principalRef: "control-plane",
          grantId: proposal.grantId,
          evidenceRefs: proposal.sourceEvidenceRefs,
          experimentId: existing.experimentId,
        });
        return existing;
      }
      const already = experiments.get(`exp:${input.commandId}`);
      if (already) {
        if (already.proposalId !== input.proposalId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return already;
      }
      const metrics = metricsForSurface(proposal.surfaceId);
      const experiment = createExperiment(
        experiments,
        {
          experimentId: `exp:${input.commandId}`,
          proposal,
          freeze: input.freeze,
          assignment: {
            strategy: "ab",
            treatmentRefs: [`treatment:${proposal.proposalId}`],
            controlRefs: [`control:${proposal.proposalId}`],
          },
          primaryMetric: metrics.primary,
          guardrailMetrics: metrics.guardrails,
          minimumSampleSize: 20,
          requiredConfidence: 0.9,
          startedAt: input.now,
        },
        targetIndex,
      );
      const next = {
        ...proposal,
        status: assertEvolutionTransition(proposal.status, "start_experiment"),
        experimentId: experiment.experimentId,
      };
      proposals.put(next);
      ledger.append({
        eventId: `led:${input.commandId}:experiment`,
        type: "experiment.started",
        timestamp: input.now,
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: "control-plane",
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId: experiment.experimentId,
      });
      const captured = await observationProvider.captureBaseline({
        experiment,
        proposal: next,
        rollbackDrill: "not_run",
      });
      const baselineCapture = classifyBaselineCapture({
        experiment,
        samples: captured?.samples ?? [],
        ...(captured?.window ? { window: captured.window } : {}),
      });
      const frozen: EvolutionExperiment = {
        ...experiment,
        baselineCapture,
        baselineRef: captured?.window.windowId ?? experiment.baselineRef,
      };
      experiments.put(frozen);
      await recordCapsuleExclusion(input.commandId, next, frozen.experimentId);
      return frozen;
    },
    startWorkingDnaExperiment(input) {
      return this.startExperiment(input);
    },
    async evaluateExperiment(experimentId) {
      const experiment = experiments.get(experimentId);
      if (!experiment) {
        throw new Error(`experiment not found: ${experimentId}`);
      }
      const proposal = requireProposal(experiment.proposalId);
      assertExperimentBoundToProposal(experiment, proposal);
      await recordCapsuleExclusion(`eval:${experimentId}`, proposal, experimentId);
      const observation = await observationProvider.collect({
        experiment,
        proposal,
        ...(latestApplicationFor(experimentId)
          ? { application: latestApplicationFor(experimentId) }
          : {}),
        rollbackDrill: rollbackDrillFor(experimentId),
      });
      const evaluated = evaluateStoredExperiment(experiments, experimentId, observation);
      const applyApproval = diagnosisApplyApprovalFor(proposal, evaluated.experiment.result);
      const { applyApproval: previousApproval, ...withoutApproval } = evaluated.experiment;
      void previousApproval;
      const storedExperiment = applyApproval
        ? { ...withoutApproval, applyApproval }
        : withoutApproval;
      experiments.put(storedExperiment);
      ledger.append({
        eventId: `led:${experimentId}:completed`,
        type: "experiment.completed",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: "control-plane",
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId,
      });
      if (applyApproval) {
        const eventId = `led:${experimentId}:approval-pending`;
        const already = ledger
          .list({ proposalId: proposal.proposalId })
          .some((row) => row.eventId === eventId);
        if (!already) {
          ledger.append({
            eventId,
            type: "application.approval_pending",
            timestamp: now(),
            proposalId: proposal.proposalId,
            target: proposal.target,
            surfaceId: proposal.surfaceId,
            tenantScope: proposal.tenantScope,
            principalRef: "control-plane",
            grantId: proposal.grantId,
            evidenceRefs: proposal.sourceEvidenceRefs,
            experimentId,
          });
        }
      }
      return {
        experiment: storedExperiment,
        decision: evaluated.decision,
        recommendedFollowUp: recommendAutonomyFollowUp({
          result: evaluated.decision.result,
          riskLevel: proposal.riskLevel,
        }),
      };
    },
    async applyWorkingDna(input) {
      const replay = replayOrRejectApplyCommand(input);
      if (replay) {
        return replay;
      }
      const { stored } = requireBoundApply(input);
      return applyThroughAdapter(
        deps.workingDnaAdapter,
        input,
        stored.payload as WorkingDnaCandidate,
      );
    },
    async applyCapsule(input) {
      const replay = replayOrRejectApplyCommand(input);
      if (replay) {
        return replay;
      }
      const { stored } = requireBoundApply(input);
      return applyThroughAdapter(capsuleAdapter, input, stored.payload as CapsuleCandidate);
    },
    async applySkill(input) {
      const replay = replayOrRejectApplyCommand(input);
      if (replay) {
        return replay;
      }
      const { stored } = requireBoundApply(input);
      const candidate = stored.payload as SkillCandidate;
      const adapter =
        candidate.operation === "install" ? skillInstallationAdapter : skillSpecAdapter;
      return applyThroughAdapter(adapter, input, candidate);
    },
    async applyOrganization(input) {
      const replay = replayOrRejectApplyCommand(input);
      if (replay) {
        return replay;
      }
      const { stored } = requireBoundApply(input);
      return applyThroughAdapter(
        organizationAdapter,
        input,
        stored.payload as OrganizationCandidate,
      );
    },
    async applyRuntimeGovernance(input) {
      const replay = replayOrRejectApplyCommand(input);
      if (replay) {
        return replay;
      }
      const { stored } = requireBoundApply(input);
      return applyThroughAdapter(
        runtimeGovernanceAdapter,
        input,
        stored.payload as RuntimeGovernanceCandidate,
      );
    },
    getExperiment(experimentId) {
      return experiments.get(experimentId);
    },
    getApplication(applicationId) {
      return applications.get(applicationId);
    },
    listApplications(filter) {
      return [...applications.values()].filter((row) => {
        if (filter?.proposalId && row.proposalId !== filter.proposalId) {
          return false;
        }
        if (filter?.experimentId && row.experimentId !== filter.experimentId) {
          return false;
        }
        return true;
      });
    },
    getVerification(verificationId) {
      return verifications.get(verificationId);
    },
    getRollbackDrill(drillId) {
      return drills.get(drillId);
    },
    listRollbackDrills(filter) {
      return [...drills.values()].filter((row) => {
        if (filter?.proposalId && row.proposalId !== filter.proposalId) {
          return false;
        }
        if (filter?.experimentId && row.experimentId !== filter.experimentId) {
          return false;
        }
        return true;
      });
    },
    async runRollbackDrill(input) {
      const drillId = `drill:${input.commandId}`;
      const existing = drills.get(drillId);
      if (existing) {
        if (existing.applicationId !== input.applicationId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return existing;
      }
      const application = applications.get(input.applicationId);
      if (!application) {
        throw new Error(`application not found: ${input.applicationId}`);
      }
      if (application.scope === "shadow") {
        throw new Error("shadow application cannot run a rollback drill");
      }
      if (application.status !== "applied") {
        throw new Error("only an applied application can run a rollback drill");
      }
      const proposal = requireProposal(application.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      if (proposal.status !== "CANARY") {
        throw new Error("rollback drill requires a CANARY proposal");
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "rollback",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      const startedAt = now();
      ledger.append({
        eventId: `led:${input.commandId}:drill-start`,
        type: "rollback_drill.started",
        timestamp: startedAt,
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: input.evidenceRefs ?? proposal.sourceEvidenceRefs,
        experimentId: application.experimentId,
        applicationId: application.applicationId,
        drillId,
      });
      const adapter = resolveAdapter(application);
      const result = await adapter.rollback(application);
      let inspectedVersion = result.restoredVersion;
      try {
        const snapshot = await adapter.inspect(proposal.target);
        inspectedVersion = snapshot.version;
      } catch {
        inspectedVersion = result.restoredVersion;
      }
      const passed =
        result.status === "rolled_back" && inspectedVersion === application.targetVersionBefore;
      const completedAt = now();
      const drill: RollbackDrillRecord = {
        schemaVersion: 1,
        drillId,
        proposalId: application.proposalId,
        experimentId: application.experimentId,
        applicationId: application.applicationId,
        targetVersionBefore: application.targetVersionBefore,
        targetVersionAfter: application.targetVersionAfter,
        restoredVersion: inspectedVersion,
        startedAt,
        completedAt,
        result: passed ? "passed" : "failed",
        domainReceiptRef: result.restoredVersion || application.rollbackRef,
        verifiedBy: input.verifiedBy,
        evidenceRefs: input.evidenceRefs ?? [],
        ...(!passed
          ? { reason: result.reason ?? "restored_version_mismatch_or_adapter_failed" }
          : {}),
      };
      drills.set(drillId, drill);
      applications.set(application.applicationId, {
        ...application,
        ...(passed ? { status: "rolled_back" as const } : {}),
        rollbackDrillId: drillId,
      });
      ledger.append({
        eventId: `led:${input.commandId}:drill-done`,
        type: "rollback_drill.completed",
        timestamp: completedAt,
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: drill.evidenceRefs,
        experimentId: application.experimentId,
        applicationId: application.applicationId,
        drillId,
        domainReceiptRef: drill.domainReceiptRef,
      });
      if (passed) {
        proposals.put({
          ...proposal,
          status: assertEvolutionTransition(proposal.status, "rollback_drill"),
        });
        ledger.append({
          eventId: `led:${input.commandId}:app-rolled-back`,
          type: "application.rolled_back",
          timestamp: completedAt,
          proposalId: proposal.proposalId,
          target: proposal.target,
          surfaceId: proposal.surfaceId,
          tenantScope: proposal.tenantScope,
          principalRef: input.principalRef,
          grantId: proposal.grantId,
          evidenceRefs: drill.evidenceRefs,
          experimentId: application.experimentId,
          applicationId: application.applicationId,
          drillId,
          domainReceiptRef: drill.domainReceiptRef,
        });
      }
      return drill;
    },
    rejectProposal(input) {
      const existingEvent = ledger
        .list()
        .find((row) => row.eventId === `led:${input.commandId}:rejected`);
      if (existingEvent) {
        if (existingEvent.proposalId !== input.proposalId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return requireProposal(input.proposalId);
      }
      const proposal = requireProposal(input.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "reject",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
        proposal: {
          status: proposal.status,
          sourceMechanismRef: proposal.sourceMechanismRef,
          expiresAt: proposal.expiresAt,
          grantId: proposal.grantId,
        },
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      const next = {
        ...proposal,
        status: assertEvolutionTransition(proposal.status, "reject"),
      };
      proposals.put(next);
      ledger.append({
        eventId: `led:${input.commandId}:rejected`,
        type: "proposal.rejected",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
      });
      return next;
    },
    suggestProposal(input) {
      const existingEvent = ledger
        .list()
        .find((row) => row.eventId === `led:${input.commandId}:suggested`);
      if (existingEvent) {
        if (existingEvent.proposalId !== input.proposalId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return requireProposal(input.proposalId);
      }
      const proposal = requireProposal(input.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "suggest",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      const next = {
        ...proposal,
        status: assertEvolutionTransition(proposal.status, "suggest"),
      };
      proposals.put(next);
      ledger.append({
        eventId: `led:${input.commandId}:suggested`,
        type: "proposal.suggested",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
      });
      return next;
    },
    expireProposal(input) {
      const existingEvent = ledger
        .list()
        .find((row) => row.eventId === `led:${input.commandId}:expired`);
      if (existingEvent) {
        if (existingEvent.proposalId !== input.proposalId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return requireProposal(input.proposalId);
      }
      const proposal = requireProposal(input.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "expire",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
        proposal: {
          status: proposal.status,
          sourceMechanismRef: proposal.sourceMechanismRef,
          expiresAt: proposal.expiresAt,
          grantId: proposal.grantId,
        },
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      const next = {
        ...proposal,
        status: assertEvolutionTransition(proposal.status, "expire"),
      };
      proposals.put(next);
      ledger.append({
        eventId: `led:${input.commandId}:expired`,
        type: "proposal.expired",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
      });
      return next;
    },
    holdProposal(input) {
      const existingEvent = ledger
        .list()
        .find((row) => row.eventId === `led:${input.commandId}:held`);
      if (existingEvent) {
        if (existingEvent.proposalId !== input.proposalId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return requireProposal(input.proposalId);
      }
      const proposal = requireProposal(input.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      const allowed = canHold(proposal);
      if (!allowed.ok) {
        throw new Error(allowed.reason);
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "hold",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      const next = {
        ...proposal,
        status: assertEvolutionTransition(proposal.status, "hold"),
      };
      proposals.put(next);
      ledger.append({
        eventId: `led:${input.commandId}:held`,
        type: "experiment.held",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId: proposal.experimentId,
      });
      return next;
    },
    async verifyApplication(input) {
      if (applications.has(`app:${input.commandId}`)) {
        throw new Error("verify requires a commandId distinct from apply");
      }
      const existing = verifications.get(`ver:${input.commandId}`);
      if (existing) {
        if (existing.applicationId !== input.applicationId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return existing;
      }
      const application = applications.get(input.applicationId);
      if (!application) {
        throw new Error(`application not found: ${input.applicationId}`);
      }
      if (application.scope === "shadow") {
        throw new Error("shadow application cannot be verified");
      }
      if (application.status !== "applied") {
        throw new Error("only an applied application can be verified");
      }
      const proposal = requireProposal(application.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "verify",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      const experiment = experiments.get(application.experimentId);
      if (!experiment) {
        throw new Error(`experiment not found: ${application.experimentId}`);
      }
      assertExperimentBoundToProposal(experiment, proposal);
      const observation = await observationProvider.collect({
        experiment,
        proposal,
        application,
        rollbackDrill: rollbackDrillFor(application.experimentId),
      });
      const decision = evaluateExperiment(observation);
      const verifiedAt = input.now ?? now();
      const treatmentWindow = buildObservationWindow({
        experiment,
        phase: "treatment",
        startedAt: application.appliedAt ?? verifiedAt,
        endedAt: verifiedAt,
      });
      const verification: EvolutionVerification = {
        schemaVersion: 1,
        verificationId: `ver:${input.commandId}`,
        applicationId: application.applicationId,
        baselineWindowRef: experiment.baselineCapture?.window?.windowId ?? "baseline",
        evaluationWindowRef: treatmentWindow.windowId,
        primaryEffect: decision.primaryEffect,
        guardrailResults: decision.guardrailResults,
        sampleSize: observation.sampleSize,
        confidence: decision.assessment.confidence,
        outcome: verificationOutcomeFromDecision(decision.result),
        evidenceRefs: [],
        verifiedAt,
        assessment: decision.assessment,
      };
      const allowed = canMarkVerified({
        outcome: verification.outcome,
        sampleSize: verification.sampleSize,
        minimumSampleSize: observation.minimumSampleSize,
      });
      const surface = resolveEvolutionSurface(proposal.surfaceId);
      let externalResult = externalEffects.getResultForApplication(application.applicationId);
      const requiredVerifierId = requiredVerifierIdForSurface(proposal.surfaceId);
      if (surface?.externalVerificationPolicy === "required" && requiredVerifierId) {
        const request = externalEffects.requestVerification({
          proposal,
          application,
          target: proposal.target,
          expectedEffect: expectedExternalEffect(proposal, application, requiredVerifierId),
          verifierId: requiredVerifierId,
          now: verifiedAt,
          expiresAt: proposal.expiresAt,
        });
        externalResult = await externalEffects.verifyBoundRequest({
          requestId: request.requestId,
          proposal,
          application,
          now: verifiedAt,
          trustedTenantId: input.trustedTenantId,
        });
        ledger.append({
          eventId: `led:${input.commandId}:external`,
          type: "external_effect.recorded",
          timestamp: verifiedAt,
          proposalId: proposal.proposalId,
          target: proposal.target,
          surfaceId: proposal.surfaceId,
          tenantScope: proposal.tenantScope,
          principalRef: input.principalRef,
          grantId: proposal.grantId,
          evidenceRefs: proposal.sourceEvidenceRefs,
          experimentId: application.experimentId,
          applicationId: application.applicationId,
          externalEffectOutcome: externalResult.outcome,
        });
      }
      const externalOk =
        !surface?.requiresExternalEffectVerification || externalResult?.outcome === "verified";
      if (
        allowed.ok &&
        externalOk &&
        (proposal.status === "CANARY" || proposal.status === "ACTIVE")
      ) {
        proposals.put({
          ...proposal,
          status: assertEvolutionTransition(proposal.status, "verify"),
          verificationId: verification.verificationId,
        });
      }
      verifications.set(verification.verificationId, verification);
      ledger.append({
        eventId: `led:${input.commandId}:verified`,
        type: "verification.completed",
        timestamp: verification.verifiedAt,
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId: application.experimentId,
        applicationId: application.applicationId,
        verificationId: verification.verificationId,
      });
      return verification;
    },
    promoteProposal(input) {
      const existingEvent = ledger
        .list()
        .find((row) => row.eventId === `led:${input.commandId}:promoted`);
      if (existingEvent) {
        if (existingEvent.proposalId !== input.proposalId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return requireProposal(input.proposalId);
      }
      const proposal = requireProposal(input.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      const surface = resolveEvolutionSurface(proposal.surfaceId);
      const external = proposal.applicationId
        ? externalEffects.getResultForApplication(proposal.applicationId)
        : undefined;
      const allowed = canPromote(proposal, {
        requireExternalEffect: surface?.requiresExternalEffectVerification === true,
        externalEffectOutcome: external?.outcome,
      });
      if (!allowed.ok) {
        throw new Error(allowed.reason);
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "promote",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      if (diagnosisOriginEvaluationApplies(proposal)) {
        const decision = workingDnaEvaluations.get(proposal.proposalId);
        if (!decision) {
          throw new Error("recheck_required");
        }
        if (decision.action !== "promote") {
          throw new Error(decision.reasonCode);
        }
      }
      const next = {
        ...proposal,
        status: assertEvolutionTransition(proposal.status, "promote"),
      };
      proposals.put(next);
      const liveApplication = proposal.applicationId
        ? applications.get(proposal.applicationId)
        : undefined;
      if (liveApplication?.status === "applied") {
        applications.set(liveApplication.applicationId, {
          ...liveApplication,
          purpose: "promoted",
        });
      }
      ledger.append({
        eventId: `led:${input.commandId}:promoted`,
        type: "promotion.completed",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId: proposal.experimentId,
        applicationId: proposal.applicationId,
        verificationId: proposal.verificationId,
      });
      return next;
    },
    async evaluateWorkingDnaClosure(proposalId) {
      return evaluateDiagnosisOriginSlice(proposalId, "working-dna");
    },
    async evaluateSkillInstallationClosure(proposalId) {
      return evaluateDiagnosisOriginSlice(proposalId, "skill-installation");
    },
    async recheckAuthority(proposalId) {
      const proposal = requireProposal(proposalId);
      const application = proposal.applicationId
        ? applications.get(proposal.applicationId)
        : undefined;
      const stored = candidates.get(proposal.candidateRef);
      const skillAgentId = skillAgentIdFromCandidate(stored?.payload);
      return recheckAuthorityFromLedger({
        proposal,
        ...(application ? { application } : {}),
        events: ledger.replay(proposal.proposalId),
        readDomain:
          deps.authorityDomainReader ??
          createReadonlyEvolutionDomainReader({
            styleConfig: deps.styleConfig,
            skillEventsConfigDir: deps.skillEventsConfigDir,
          }),
        ...(skillAgentId ? { skillAgentId } : {}),
      });
    },
    async rollbackApplication(input) {
      const application = applications.get(input.applicationId);
      if (!application) {
        throw new Error(`application not found: ${input.applicationId}`);
      }
      const proposal = requireProposal(application.proposalId);
      if (input.trustedTenantId != null && proposal.tenantScope !== input.trustedTenantId) {
        throw new Error("proposal not found");
      }
      const authority = checkEvolutionAuthority(deps.inspector, {
        surfaceId: proposal.surfaceId,
        grantId: proposal.grantId,
        tenantScope: proposal.tenantScope,
        trustedTenantId: input.trustedTenantId,
        requestedAction: "rollback",
        evidenceRefs: proposal.sourceEvidenceRefs,
        confidentialityScope: proposal.confidentialityScope,
      });
      if (!authority.ok) {
        throw new Error(authority.reason);
      }
      const existingRolled = ledger
        .list()
        .find((row) => row.eventId === `led:${input.commandId}:rollback-done`);
      if (existingRolled) {
        if (existingRolled.applicationId !== input.applicationId) {
          throw new Error("duplicate command cannot retarget another object");
        }
        return { application: applications.get(input.applicationId) ?? application };
      }
      ledger.append({
        eventId: `led:${input.commandId}:rollback-start`,
        type: "rollback.started",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId: application.experimentId,
        applicationId: application.applicationId,
      });
      const result = await resolveAdapter(application).rollback(application);
      const rolled: EvolutionApplication = {
        ...application,
        status: result.status === "rolled_back" ? "rolled_back" : "failed",
      };
      applications.set(application.applicationId, rolled);
      if (result.status === "rolled_back") {
        proposals.put({
          ...proposal,
          status: assertEvolutionTransition(proposal.status, "rollback"),
        });
      }
      ledger.append({
        eventId: `led:${input.commandId}:rollback-done`,
        type: "rollback.completed",
        timestamp: now(),
        proposalId: proposal.proposalId,
        target: proposal.target,
        surfaceId: proposal.surfaceId,
        tenantScope: proposal.tenantScope,
        principalRef: input.principalRef,
        grantId: proposal.grantId,
        evidenceRefs: proposal.sourceEvidenceRefs,
        experimentId: application.experimentId,
        applicationId: application.applicationId,
        domainReceiptRef: result.restoredVersion,
      });
      return { application: rolled };
    },
  };
}

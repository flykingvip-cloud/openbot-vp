export { checkEvolutionAuthority } from "./authority-gate.js";
export { recheckAuthorityFromLedger } from "./authority-recheck.js";
export { createEvolutionControlPlane, type EvolutionControlPlane } from "./control-plane.js";
export { previewDiagnosisCandidate } from "./diagnosis-ingest.js";
export {
  createLiveDiagnosisRecheckObserver,
  createLiveDiagnosisRecheckPort,
  expectationFromControlPlane,
  skillInstallationRelationHash,
} from "./diagnosis-recheck-observer.js";
export {
  confirmDiagnosisCandidatePreview,
  diagnosisGrantViewFromAuthorization,
  resolveDiagnosisCandidateConfirmDeps,
} from "./confirm-diagnosis-candidate.js";
export {
  attachDiagnosisEvolutionProjection,
  overlayDiagnosisReportLiveStatus,
  projectDiagnosisCandidateStatus,
  resolveDiagnosisCandidateStatusPorts,
  setDiagnosisCandidateStatusPortsForTests,
} from "./project-diagnosis-candidate.js";
export {
  createDiagnosisCandidateSubmitter,
  alignDiagnosisExperimentFreeze,
  createControlPlaneDiagnosisSubmitPorts,
  createMemoryDiagnosisSubmitPorts,
  diagnosisExperimentFreeze,
  diagnosisIngestWalPath,
  defaultSnapshotReader,
  submitDiagnosisCandidate,
  workingDnaBaselineHash,
} from "./submit-diagnosis-candidate.js";
export {
  diagnosisOriginEvaluationApplies,
  evaluateSkillInstallationClosure,
  evaluateWorkingDnaClosure,
  skillInstallationEvaluationApplies,
  workingDnaEvaluationApplies,
} from "./working-dna-evaluation.js";
export { createVerifierRegistry } from "./external-effect-registry.js";
export { createExternalEffectService } from "./external-effect-service.js";
export {
  WORKING_DNA_RAW_VERIFIER_ID,
  WORKING_DNA_RAW_VERIFIER_RECORD,
} from "./verifiers/working-dna-raw.js";
export {
  SKILL_INSTALLATION_RAW_VERIFIER_ID,
  SKILL_INSTALLATION_RAW_VERIFIER_RECORD,
} from "./verifiers/skill-installation-raw.js";
export { createCapsuleEligibilityReader } from "./adapters/capsule.js";
export { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
export { createShadowIntentProposalRegistrar } from "./shadow-intent-proposal.js";
export {
  authorizeShadowIntentProposal,
  projectShadowIntentOperatorHints,
  resolveAuthorizeShadowIntentInspector,
  setAuthorizeShadowIntentInspectorForTests,
  SHADOW_INTENT_AUTHORIZE_SURFACES,
  SHADOW_INTENT_OBSERVE_ONLY_SURFACES,
} from "./authorize-shadow-intent.js";
export {
  ensureEvolutionControlPlaneStarted,
  getDefaultEvolutionControlPlane,
  persistSurfaceSnapshot,
  resetEvolutionControlPlaneForTests,
} from "./bootstrap.js";
export { createFailClosedAdapter } from "./adapters/fail-closed.js";
export {
  createCapsuleAdapter,
  createMemoryCapsuleStore,
  createWorkspaceCapsuleStore,
  type CapsuleAdapterStore,
  capsuleObservationEligibility,
  type CapsuleCandidate,
} from "./adapters/capsule.js";
export {
  createDefaultSkillLifecyclePort,
  createMemorySkillLifecyclePort,
  createSkillAdapter,
  createSkillInstallationAdapter,
  createSkillSpecAdapter,
  type SkillCandidate,
  type SkillLifecyclePort,
  type SkillOperation,
  type SkillRecord,
} from "./adapters/skill.js";
export {
  createFileOrganizationPolicyPort,
  createMemoryOrganizationPort,
  createOrganizationAdapter,
  type OrganizationAdapter,
  type OrganizationCandidate,
  type OrganizationPolicyPort,
} from "./adapters/organization.js";
export {
  createLiveRuntimeGovernancePort,
  createMemoryRuntimeGovernancePort,
  createRuntimeGovernanceAdapter,
  surfaceAllowsRuntimeApply,
  type RuntimeGovernanceCandidate,
  type RuntimeGovernancePort,
} from "./adapters/runtime-governance.js";
export {
  createFileWorkingDnaObservationPort,
  createMemoryWorkingDnaObservationPort,
  createWorkingDnaAdapter,
  type WorkingDnaCandidate,
  type WorkingDnaObservationPort,
  type WorkingDnaTaskOutcome,
} from "./adapters/working-dna.js";
export {
  createMemoryCandidateStore,
  hashCandidatePayload,
  sealGovernedCandidate,
} from "./candidate-store.js";
export { createMemoryEvolutionLedger, type EvolutionLedger } from "./evolution-ledger.js";
export {
  createAdapterObservationProvider,
  createFailClosedObservationProvider,
  observationsToEvaluation,
} from "./observation.js";
export {
  createExperiment,
  createMemoryExperimentStore,
  evaluateStoredExperiment,
} from "./experiment-manager.js";
export {
  createMemoryEvolutionProposalIndex,
  projectDiagnosisProposal,
} from "./proposal-projection.js";
export {
  assertKnownEvolutionSurface,
  listRegisteredEvolutionSurfaces,
  resolveEvolutionSurface,
} from "./surface-registry.js";

export {
  CAPABILITY_GAP_ALLOWED_ACTIONS,
  CAPABILITY_GAP_GRANT_PURPOSE_PREFIX,
  capabilityGapSystemGrantId,
  ensureCapabilityGapSystemGrant,
  expandCapabilityGapGrantEvidence,
  encodeCapabilityGapGrantPurpose,
  parseCapabilityGapGrantPurpose,
  isCapabilityGapSystemGrantId,
  evaluateCapabilityGapSystemGrantAction,
} from "./capability-gap-grant.js";
export {
  persistCapabilityGapEvidence,
  getCapabilityGapEvidence,
  listCapabilityGapEvidence,
  capabilityGapEvidenceId,
  type CapabilityGapEvidenceRecord,
} from "./capability-gap-evidence.js";
export {
  recordCapabilityGapEvent,
  tryResolveCapabilityGapsFromUsage,
  resolveCapabilityGapAfterVerifiedUsage,
  listCapabilityGapBacklog,
  isSkillLifecycleVerifiedEquivalent,
  isLinkedSkillReviewVerified,
  isLinkedToolGovernanceVerified,
  type CapabilityGapCategory,
  type CapabilityGapCandidatePayload,
} from "./capability-gap-ingest.js";
export {
  runCapabilityGapConsumerTick,
  runCapabilityGapConsumerTickSafely,
  configureCapabilityGapConsumer,
} from "./capability-gap-consumer.js";

export {
  advanceSoftObserveDhProposal,
  classifySoftObserveDhStep,
  isSoftObserveDhEnabled,
  runSoftObserveDhClosedLoop,
  runSoftObserveDhLoopTick,
  runSoftObserveDhLoopTickSafely,
  setSoftObserveDhEnabledForTests,
  SOFT_OBSERVE_DH_PRINCIPAL,
  SOFT_OBSERVE_DH_SURFACES,
} from "./soft-observe-dh-loop.js";

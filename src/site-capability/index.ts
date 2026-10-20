export { SAR_DENIAL_CODE, sarDeny, type SarDenial, type SarDenialCode } from "./codes.js";
export {
  SAR_AUTH_MODES,
  SAR_EFFECTS,
  SAR_EXECUTION_MODES,
  SAR_OP_KINDS,
  SAR_P1_PRODUCT_TOOLS,
  SITE_EXECUTION_CONTRACT_ID,
  parseSiteCapabilityManifest,
  type SarOpKind,
  type SiteCapabilityManifest,
} from "./contract.js";
export {
  AccountBrowserSerialDenied,
  claimActiveBrowserDispatch,
  getActiveAccountBrowserDesk,
  releaseActiveBrowserDispatch,
  resetActiveAccountBrowserDeskForTests,
  setActiveAccountBrowserDesk,
  type AccountBrowserDesk,
  type DeskClaimResult,
  type DeskKind,
  type DeskLock,
} from "./desk.js";
export {
  SarExecutionAuthority,
  memoryEpochStore,
  type EpochStore,
  type InFlightAction,
  type InFlightStatus,
  type PersistedEpoch,
  type SarAuthorityOptions,
  type SarBootResult,
  type SarCancelObservation,
  type SarDispatchSuccess,
  type SarRunObservation,
} from "./execution-authority.js";
export { assertSarNavigationAllowed } from "./navigation.js";
export {
  TrustedOperationFault,
  compileSarOperation,
  executeTrustedOperation,
  type CompiledSarOperation,
  type TrustedOpValue,
  type TrustedPagePort,
} from "./operations.js";
export {
  SAR_FORBIDDEN_TARGET_KEYS,
  assertOpaquePageTarget,
  denialForForbiddenTarget,
  deriveAccountBrowserScopeKey,
  findForbiddenTargetKey,
  parseAccountBinding,
  sessionHandleExposesOnlyToken,
  type AccountBinding,
  type ResolvedSessionRecord,
  type ServerPrincipal,
  type SessionHandle,
} from "./session-handle.js";
export {
  ensureAccountBrowserCoordinator,
  resetAccountBrowserCoordinatorForTests,
} from "./coordinator.js";
export {
  isEmptySuccess,
  isOrdinaryFailure,
  type SiteCompleteness,
  type SiteEvidence,
  type SiteRetryHint,
  type SiteRunError,
  type SiteRunResult,
  type SiteRunStatus,
  type SiteVerification,
} from "./result.js";
export {
  SiteCapabilityRuntime,
  getDefaultSiteCapabilityRuntime,
  resetDefaultSiteCapabilityRuntimeForTests,
  type SiteCapabilityDescription,
  type SiteCapabilityGrant,
  type SiteCapabilityRecord,
  type SiteCapabilitySummary,
  type SiteListPage,
} from "./runtime.js";
export {
  SAR_FIXTURE_CAPABILITY,
  SAR_FIXTURE_CREDENTIALS,
  SAR_FIXTURE_GROUND_TRUTH,
  SAR_FIXTURE_ORIGIN,
  ControllableTestSite,
  createTestSitePort,
  type FixtureFault,
  type FixtureScenario,
} from "./test-site.js";
export { decideAcceptance } from "./approval.js";
export {
  DraftStore,
  candidateRecord,
  declarativeArtifactDigest,
  draftToSiteRecord,
  parseDeclarativePlan,
  sameParams,
  type DraftAcceptance,
  type PrivatePlanDraft,
  type VerifiedSuccessEvidence,
} from "./draft-store.js";
export {
  SAR_FAILURE_CLASSES,
  classifySiteFailure,
  proposeRepair,
  type RepairProposal,
  type SarFailureClass,
} from "./failure-class.js";
export { SiteLearningLoop, type ExplorationInput, type SiteLearningLoopOptions } from "./learning-loop.js";
export {
  LEARNING_PERSISTENCE_SCHEMA,
  createLearningAssetStore,
  createSkillLifecycleBridge,
  emptyLearningSnapshot,
  loadLearningSnapshot,
  saveLearningSnapshot,
  sarLifecycleSkillId,
  type LearningAssetStore,
  type LearningPersistenceSnapshot,
  type SarSkillLifecycleBridge,
} from "./learning-persistence.js";
export {
  comparePilotRead,
  PILOT_COMPARISON_COST_CLOCK,
  PILOT_COMPARISON_EVIDENCE_KIND,
  type PilotComparison,
  type PilotSide,
} from "./pilot-comparison.js";
export {
  SAR_R5_STATUS_FIXTURE_ONLY,
  buildReadonlyPilotAuditEvidence,
  formatComparisonTableRow,
  probeLiveReadonlyPilotPrerequisites,
  readonlyPilotAccountScope,
  readonlyPilotTaskSet,
  type LiveSessionBlocker,
  type ReadonlyPilotAccountScope,
  type ReadonlyPilotAuditEvidence,
  type ReadonlyPilotTask,
  type SarR5Status,
} from "./readonly-pilot-audit.js";
export {
  SAR_PILOT_BINDING_ID,
  SAR_PILOT_BULLETIN,
  SAR_PILOT_BULLETIN_ID,
  SAR_PILOT_BULLETIN_ONLY_PRINCIPAL,
  SAR_PILOT_FIXTURE_CREDENTIALS,
  SAR_PILOT_GROUND_TRUTH,
  SAR_PILOT_INBOX,
  SAR_PILOT_INBOX_ID,
  SAR_PILOT_OTHER_PRINCIPAL,
  SAR_PILOT_PRINCIPAL,
  SAR_PILOT_STATION_IDS,
  SAR_PILOT_STEP_MS,
  SAR_PILOT_VERSION,
  attributePilotFailure,
  createReadonlyPilotHarness,
  pilotSourceDraft,
  recordPilotBusinessVerification,
  ReadonlyPilotSite,
  type PilotHarness,
  type PilotStation,
} from "./readonly-pilot.js";
export {
  ThinValidationRunner,
  validationBlocksVerifiedCallable,
  type IndependentReviewEvidence,
  type ValidationBasis,
  type ValidationRecord,
  type ValidationVerdict,
} from "./validation-record.js";
export {
  resolveRunVerification,
  type SiteBusinessVerifier,
  type SiteBusinessVerifierInput,
} from "./verification-gate.js";

export {
  createAccountBrowserPort,
  failClosedAccountBrowserPort,
  installFixtureAccountBrowserBridge,
  lookupAccountBrowserBridge,
  uninstallAccountBrowserBridge,
  SAR_FIXTURE_BRIDGE_CONTAINER,
  type AccountBrowserBridgeKind,
  type AccountBrowserBridgeRef,
} from "./account-browser-port.js";
export {
  applyProductHandBack,
  applyProductHumanTakeover,
  type ProductHandBackResult,
  type ProductTakeoverResult,
} from "./product-takeover.js";

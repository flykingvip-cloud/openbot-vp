/**
 * delivery-lane — Tip A–F public exports.
 */

export {
  DELIVERY_LANE_ENABLED_ENV,
  isDeliveryLaneEnabled,
  isDeliveryLanePath1CrossBotEnabled,
} from "./feature.js";
export { buildFocusSummary, buildLaneProjection, computeMissingKeys } from "./projection.js";
export {
  forgetDeliveryLaneMode,
  rememberDeliveryLaneMode,
  resetDeliveryLaneActiveModeForTests,
  resolveActiveDeliveryLaneMode,
  type ActiveDeliveryLaneMode,
} from "./active-mode.js";
export {
  applyLaneModeToolPolicy,
  evaluateLaneModeToolPolicy,
  argvMatchesDeniedMerge,
  isLaneModeMergeGuardActive,
  isLaneModeMutexActive,
  laneModeDenyToolPolicy,
  LANE_MODE_ALLOWED_LANE_APIS,
  LANE_MODE_ALLOWED_SUPERVISOR_READ_PREFIXES,
  LANE_MODE_DENIED_MERGE_ARGV_PATTERNS,
  LANE_MODE_DENIED_WRITE_TOOLS,
  type LaneModeToolChannel,
  type LaneModeToolDecision,
} from "./mode-policy.js";
export {
  attachLane,
  DeliveryLaneError,
  focusLane,
  getLaneOrThrow,
  requestMergeReady,
  sealLane,
  setLaneMode,
  type AttachLaneInput,
  type FocusLaneInput,
  type RequestMergeReadyInput,
  type SealLaneInput,
  type SetLaneModeInput,
} from "./service.js";
export {
  createGhPrMergePort,
  createRecordingMergePort,
  getDefaultMergePort,
  MergePortError,
  setDefaultMergePortForTests,
  type MergePort,
  type MergePortMethod,
  type MergePortRequest,
  type MergePortResult,
} from "./merge-port.js";
export { requestMerge, type RequestMergeInput } from "./merge-request.js";
export {
  attachLaneHelper,
  countActiveLaneHelpers,
  detachLaneHelper,
  DEFAULT_LANE_MAX_HELPERS,
  resolveLaneMaxHelpers,
  type AttachLaneHelperInput,
  type DetachLaneHelperInput,
} from "./helpers.js";
export {
  assertPath1DualSealAuthority,
  canPublishLaneAcceptSeal,
  HANDOFF_KINDS_FOR_LANE_SEAL,
  HANDOFF_STATUSES_FOR_LANE_SEAL,
  isSameOriginIssuer,
  isSelfSignAcceptVsImplement,
  mapHandoffKindToLaneSealKind,
  runtimePhaseForSealKind,
  sealLaneFromHandoff,
  type HandoffSealSnapshot,
  type LanePublishGateResult,
  type RuntimePhase,
  type SealLaneFromHandoffInput,
} from "./handoff-bridge.js";

export {
  applyLaneEvent,
  canAdvanceStage,
  isLaneEventKind,
  LANE_EVENT_KINDS,
  suggestStageForLaneEvent,
  type ApplyLaneEventInput,
  type ApplyLaneEventResult,
  type LaneEvent,
  type LaneEventKind,
  type LaneEventSource,
  type LaneLastEvent,
} from "./events.js";
export { observeLaneEventShadow, type LaneShadowObservation } from "./lane-shadow.js";
export { createLane, getLane, listLanes, resolveDeliveryLaneDir, updateLane } from "./store.js";
export {
  DELIVERY_LANE_DEFAULT_TEMPLATE_ID,
  getDeliveryLaneTemplate,
  listDeliveryLaneTemplates,
} from "./templates.js";
export type {
  DeliveryLane,
  DeliveryLaneCiPolicy,
  DeliveryLaneTemplate,
  EvidencePackage,
  LaneHelper,
  LaneHelperKind,
  LaneMode,
  LaneProjection,
  LaneSeal,
  LaneSealIssuer,
  LaneSealKind,
  LaneSealVerdict,
  LaneStage,
} from "./types.js";

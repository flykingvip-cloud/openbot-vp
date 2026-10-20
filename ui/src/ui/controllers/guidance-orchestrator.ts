/**
 * Client façade for guidance metrics + UI controls (P3).
 * Implementation lives under ports/employee/guidance to keep views controller-free.
 */

export {
  GUIDANCE_CONTENT_VERSION,
  GUIDANCE_DEFER_MS,
  acknowledgeGuidanceSnapshot,
  clearGuidanceHighRiskConfirm,
  deferGuidanceSnapshot,
  getGuidanceUiControlState,
  isGuidanceHighRiskPending,
  requestGuidanceHighRiskConfirm,
  resetGuidanceUiControlStateForTests,
} from "../ports/employee/guidance/ui-control-state.ts";

export {
  readGuidanceProgressFromGateway,
  recordGuidanceMetricClient,
  recordGuidanceShownOnce,
  type GuidanceMetricClientEvent,
  type GuidanceOrchestratorClient,
} from "../ports/employee/guidance/metrics-client.ts";

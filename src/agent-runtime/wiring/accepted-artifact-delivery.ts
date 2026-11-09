/**
 * Thin facade: re-exports command / state / delivery so legacy import paths keep working.
 * Business orchestration lives in command; reads in state; recover in delivery.
 */
export {
  acceptedArtifactDeliveryDirs,
  issuanceFactsFromBoard,
  requestAcceptedArtifactDelivery,
  requestGroupFinalDelivery,
  revokeAcceptedArtifactDelivery,
  resolveChannelAccountOutboundScopeFacts,
  type AcceptedArtifactDeliveryDirs,
  type AcceptedArtifactDeliveryView,
  type GroupFinalOverallAcceptanceFacts,
} from "../command/accepted-artifact-delivery.js";
export { readAcceptedArtifactDelivery } from "../state/collaboration/accepted-artifact-delivery-read.js";
export {
  recoverAcceptedArtifactBridgeEntry,
  recoverAcceptedArtifactDeliveries,
} from "../delivery/accepted-artifact-recover.js";

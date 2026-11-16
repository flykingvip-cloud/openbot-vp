/**
 * Thin facade: re-exports command / state / delivery so legacy import paths keep working.
 * Business orchestration lives in command; reads in state; recover in delivery.
 * Delivery recover is bound here to state ports so delivery itself stays effect-free of state internals.
 */
import {
  recoverAcceptedArtifactBridgeEntry as recoverAcceptedArtifactBridgeEntryWithStore,
  recoverAcceptedArtifactDeliveries as recoverAcceptedArtifactDeliveriesWithStore,
  type AcceptedArtifactRecoveryStore,
} from "../delivery/accepted-artifact-recover.js";
import {
  claimMemberArtifactSendUnknown,
  readMemberArtifactDeliveryIntent,
  recordMemberArtifactReceipt,
} from "../state/index.js";

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
} from "../command/index.js";
export { readAcceptedArtifactDelivery } from "../state/index.js";

const acceptedArtifactRecoveryStore: AcceptedArtifactRecoveryStore = {
  readIntent: readMemberArtifactDeliveryIntent,
  claimUnknown: claimMemberArtifactSendUnknown,
  recordReceipt: recordMemberArtifactReceipt,
};

export function recoverAcceptedArtifactBridgeEntry(
  params: Omit<Parameters<typeof recoverAcceptedArtifactBridgeEntryWithStore>[0], "store">,
) {
  return recoverAcceptedArtifactBridgeEntryWithStore({
    ...params,
    store: acceptedArtifactRecoveryStore,
  });
}

export function recoverAcceptedArtifactDeliveries(
  params: Omit<Parameters<typeof recoverAcceptedArtifactDeliveriesWithStore>[0], "store">,
) {
  return recoverAcceptedArtifactDeliveriesWithStore({
    ...params,
    store: acceptedArtifactRecoveryStore,
  });
}

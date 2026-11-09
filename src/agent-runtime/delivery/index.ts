/** Delivery public API: presentation, receipt preparation and terminal result settlement. */
export { buildReplyPayloads } from "./presentation/reply-payloads.js";
export { prepareVisibleDelivery } from "./dispatch/prepare-visible.js";
export { evaluateTaskAcceptance } from "./acceptance/criteria.js";
export { confirmPendingTurnDeliveryWithPorts } from "./dispatch/confirm-pending.js";
export { completeReplyDelivery, type ReplyDeliveryResult } from "./dispatch/complete-reply.js";
export { patchAuthorizedPptx, artifactContentHash } from "./artifacts/patch-pptx.js";
export {
  HONEST_EMPTY_REPLY_ZH,
  HONEST_EMPTY_REPLY_EN,
  formatHonestEmptyReply,
  hasUserVisibleReplyPayload,
  decideHonestEmptyReply,
  classifySilentTurnGrowthOutcome,
  type HonestEmptyReplyProbePayload,
  type HonestEmptyReplyDecisionInput,
  type HonestEmptyReplySkipReason,
  type HonestEmptyReplyDecision,
} from "./presentation/empty-reply.js";

export {
  logNestedCommandOutput,
  createAcpVisibleTextAccumulator,
} from "./presentation/command-output.js";

export { deliverAgentCommandResult } from "./dispatch/command-result.js";

export {
  buildEmbeddedRunPayloads,
  type EmbeddedPayloadFormatting,
} from "./presentation/embedded-payloads.js";

export { deliverQueuedReply } from "./dispatch/queued-reply.js";

export {
  writeAcceptedArtifactQueueFile,
  sendAcceptedArtifactBridge,
} from "./accepted-artifact-send.js";
export {
  recoverAcceptedArtifactBridgeEntry,
  recoverAcceptedArtifactDeliveries,
} from "./accepted-artifact-recover.js";

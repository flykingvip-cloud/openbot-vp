import type { ReplyPayload } from "../../../auto-reply/types.js";
import {
  formatTurnProcessPlaceholder,
  type CollaborationReplyLanguage,
} from "../../../gateway/collaboration-dispatch/reply-language.js";
import {
  resolveChatTurnCloseGates,
  type ResolvedTurnTaskContract,
} from "../../../task-outcome/chat-entry.js";
import type { GrowthOutcomeCommitOpts } from "../../../task-outcome/runtime-from-runner.js";
import {
  classifySilentTurnGrowthOutcome,
  decideHonestEmptyReply,
  formatHonestEmptyReply,
  hasMessagingToolDelivery,
  type HonestEmptyReplyDecisionInput,
} from "../presentation/empty-reply.js";

export type ReplyDeliveryResult =
  | { kind: "empty"; probe: HonestEmptyReplyDecisionInput }
  | { kind: "language_filtered"; didUseTools?: boolean }
  // Visible receipts have already been prepared before presentation/usage decoration.
  | { kind: "visible"; payloads: ReplyPayload[] };

/** Fixed host effects, supplied by the original turn owner, never executable configuration. */
type ReplyDeliveryPorts<T> = {
  runId: string;
  language: CollaborationReplyLanguage | null;
  readContract: () => ResolvedTurnTaskContract & { acceptanceVerified?: boolean };
  commitOutcome: (success: boolean, opts: GrowthOutcomeCommitOpts) => unknown;
  recordEmptyGap: (reason: "direct_chat_silent_or_empty_reply") => void;
  considerContinuation: (payloads: ReplyPayload[]) => void;
  finalize: (payload: ReplyPayload | ReplyPayload[] | undefined) => T;
};

/**
 * One terminal reply outlet for empty, filtered, placeholder and prepared visible results.
 * Outcome writes remain fire-and-forget here, as in the original non-visible branches.
 * Continuation and queue draining retain their existing host implementations.
 */
export function completeReplyDelivery<T>(
  result: ReplyDeliveryResult,
  ports: ReplyDeliveryPorts<T>,
): T {
  let payloads: ReplyPayload[] = [];
  let considerContinuation = false;
  if (result.kind === "visible") {
    payloads = result.payloads;
    considerContinuation = true;
  } else if (result.kind === "language_filtered") {
    const text = result.didUseTools
      ? formatTurnProcessPlaceholder(ports.language, "lookup")
      : undefined;
    if (text) {
      // A process sentence is not final delivery and cannot close the task.
      void ports.commitOutcome(true, { processPlaceholder: true });
      payloads = [{ text }];
      considerContinuation = true;
    } else {
      void ports.commitOutcome(false, {
        failureReason: "user_filtered",
        failureDetail: "language_gate_empty",
      });
    }
  } else {
    const decision = decideHonestEmptyReply(result.probe);
    const growth = classifySilentTurnGrowthOutcome(decision);
    if (decision.reason === "user_aborted") {
      void ports.commitOutcome(false, {
        failureReason: "user_cancelled",
        failureDetail: "user_aborted",
      });
    } else if (growth.success) {
      // A silent turn may be valid without a send. Stream/tool callbacks can
      // enqueue or filter output, so their invocation does not confirm delivery.
      const sent = result.probe.reactionDelivered || hasMessagingToolDelivery(result.probe);
      const contract = ports.readContract();
      const gates = resolveChatTurnCloseGates({
        deliveryId: `delivery:${ports.runId}:${decision.reason}`,
        contract,
        deliveryPhase: sent ? "delivered" : "awaiting",
        acceptanceVerified: contract.acceptanceVerified === true,
      });
      void ports.commitOutcome(true, {
        acceptance: gates.acceptance,
        delivery: gates.delivery,
        deliveryId: gates.deliveryId,
      });
    } else {
      void ports.commitOutcome(false, {
        failureReason: "run_failed",
        failureDetail: decision.reason,
      });
    }
    if (decision.emit) {
      ports.recordEmptyGap(decision.reason);
      payloads = [{ text: formatHonestEmptyReply(ports.language) }];
    }
  }
  if (considerContinuation) {
    ports.considerContinuation(payloads);
  }
  // Preserve [] from a shaped visible result; empty/non-visible silence is undefined.
  const payload =
    result.kind === "visible" ? (payloads.length === 1 ? payloads[0] : payloads) : payloads[0];
  return ports.finalize(payload);
}

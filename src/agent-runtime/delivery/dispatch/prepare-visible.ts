import {
  chatTurnTaskId,
  resolveChatTurnCloseGates,
  type ResolvedTurnTaskContract,
} from "../../../task-outcome/chat-entry.js";
import { registerAwaitingDelivery } from "../../../task-outcome/pending-delivery.js";
import type { GrowthOutcomeCommitOpts } from "../../../task-outcome/runtime-from-runner.js";
import type { TaskCompletionBinding } from "../../contracts/task.js";

type PendingIdentity = { runId: string; deliveryId: string; taskId: string; agentId: string };

/** Prepare a visible turn receipt; only the transport confirmation can mark it delivered. */
export async function prepareVisibleDelivery(params: {
  resolvePersistRoot: (agentId: string) => string;
  agentId?: string;
  runId: string;
  sessionKey?: string;
  sessionFile?: string;
  completionBinding?: TaskCompletionBinding;
  contract: ResolvedTurnTaskContract & { acceptanceVerified?: boolean };
  commitOutcome: (success: boolean, opts: GrowthOutcomeCommitOpts) => unknown;
  publishPending: (identity: PendingIdentity) => void;
}): Promise<void> {
  const deliveryId = `delivery:${params.runId}:visible`;
  const gates = resolveChatTurnCloseGates({
    deliveryId,
    contract: params.contract,
    deliveryPhase: "awaiting",
    acceptanceVerified: params.contract.acceptanceVerified === true,
  });
  // Persist preparation before exposing the identity to a potentially immediate send receipt.
  await params.commitOutcome(true, {
    acceptance: gates.acceptance,
    delivery: gates.delivery,
    deliveryId: gates.deliveryId,
  });
  const agentId = params.agentId?.trim();
  if (!agentId) {
    return;
  }
  const persistRoot = params.resolvePersistRoot(agentId);
  const taskId = chatTurnTaskId({ agentId, runId: params.runId, sessionKey: params.sessionKey });
  const identity = { runId: params.runId, deliveryId, taskId, agentId };
  const binding = params.completionBinding;
  const checkedTask =
    gates.acceptance.status === "passed" &&
    params.sessionFile &&
    binding?.taskId &&
    binding.executionAttempt === params.runId &&
    binding.deliverableVersion
      ? { sessionFile: params.sessionFile, binding: { ...binding } }
      : undefined;
  registerAwaitingDelivery({ ...identity, persistRoot, ...(checkedTask ? { checkedTask } : {}) });
  params.publishPending(identity);
}

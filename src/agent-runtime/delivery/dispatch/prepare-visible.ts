import {
  chatTurnTaskId,
  resolveChatTurnCloseGates,
  type ResolvedTurnTaskContract,
} from "../../../task-outcome/chat-entry.js";
import { registerAwaitingDelivery } from "../../../task-outcome/pending-delivery.js";
import type { GrowthOutcomeCommitOpts } from "../../../task-outcome/runtime-from-runner.js";
import type { TaskAcceptanceEvaluation } from "../../contracts/quality.js";
import type { TaskCompletionBinding } from "../../contracts/task-binding.js";
type PendingIdentity = { runId: string; deliveryId: string; taskId: string; agentId: string };

/** Prepare a visible turn receipt; only the transport confirmation can mark it delivered. */
export async function prepareVisibleDelivery(params: {
  resolvePersistRoot: (agentId: string) => string;
  agentId?: string;
  runId: string;
  outcomeTaskId?: string;
  sessionKey?: string;
  sessionFile?: string;
  completionBinding?: TaskCompletionBinding;
  contract: ResolvedTurnTaskContract & { acceptanceVerified?: boolean };
  evaluateAcceptance?: () => Promise<
    | {
        evaluation: TaskAcceptanceEvaluation;
        evidence: NonNullable<GrowthOutcomeCommitOpts["acceptanceEvidence"]>;
      }
    | undefined
  >;
  commitOutcome: (success: boolean, opts: GrowthOutcomeCommitOpts) => unknown;
  publishPending: (identity: PendingIdentity) => void;
}): Promise<"passed" | "failed" | "pending" | "not_required"> {
  const deliveryId = `delivery:${params.runId}:visible`;
  const gates = resolveChatTurnCloseGates({
    deliveryId,
    // A host-bound execution cannot inherit the legacy ordinary-chat waiver.
    contract:
      params.completionBinding?.taskId && params.contract.kind === "chat_turn"
        ? { ...params.contract, id: "execution_task_contract", kind: "execution" }
        : params.contract,
    deliveryPhase: "awaiting",
    acceptanceVerified: params.contract.acceptanceVerified === true,
  });
  const checked = params.evaluateAcceptance ? await params.evaluateAcceptance() : undefined;
  const binding = params.completionBinding;
  const matches = Boolean(
    checked &&
    binding?.taskId &&
    checked.evaluation.taskId === binding.taskId &&
    checked.evaluation.executionAttempt === params.runId &&
    binding.executionAttempt === params.runId &&
    checked.evaluation.deliverableVersion === binding.deliverableVersion,
  );
  if (checked) {
    gates.acceptance = { status: matches ? checked.evaluation.status : "pending" };
  }
  // Persist preparation before exposing the identity to a potentially immediate send receipt.
  await params.commitOutcome(true, {
    acceptance: gates.acceptance,
    delivery: gates.delivery,
    deliveryId: gates.deliveryId,
    ...(checked ? { acceptanceEvidence: matches ? checked.evidence : [] } : {}),
  });
  const agentId = params.agentId?.trim();
  if (!agentId) {
    return gates.acceptance.status;
  }
  const persistRoot = params.resolvePersistRoot(agentId);
  const taskId =
    params.outcomeTaskId ??
    chatTurnTaskId({ agentId, runId: params.runId, sessionKey: params.sessionKey });
  const identity = { runId: params.runId, deliveryId, taskId, agentId };
  const checkedTask =
    params.sessionFile &&
    binding?.taskId &&
    binding.executionAttempt === params.runId &&
    binding.deliverableVersion
      ? { sessionFile: params.sessionFile, binding: { ...binding } }
      : undefined;
  registerAwaitingDelivery({ ...identity, persistRoot, ...(checkedTask ? { checkedTask } : {}) });
  params.publishPending(identity);
  return gates.acceptance.status;
}

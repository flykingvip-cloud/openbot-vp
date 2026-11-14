import {
  chatTurnTaskId,
  resolveChatTurnCloseGates,
  type ResolvedTurnTaskContract,
} from "../../../task-outcome/chat-entry.js";
import {
  handoffAwaitingDelivery,
  persistAwaitingDeliveryIntent,
  releaseLiveProducerPreparation,
  type PendingVisibleAuthorizationLocator,
  type PendingVisiblePayload,
  type PendingVisibleTarget,
} from "../../../task-outcome/pending-delivery.js";
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
  /** Original visible payloads; persisted before commit so recovery can send without a model rerun. */
  payloads?: readonly PendingVisiblePayload[];
  /** Trusted delivery target for the original payloads. */
  target?: PendingVisibleTarget;
  /** Locator for a current-authorization recheck on recovery. Not a grant. */
  authorization?: PendingVisibleAuthorizationLocator;
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
  const agentId = params.agentId?.trim();
  const persistRoot = agentId ? params.resolvePersistRoot(agentId) : "";
  const taskId = agentId
    ? (params.outcomeTaskId ??
      chatTurnTaskId({ agentId, runId: params.runId, sessionKey: params.sessionKey }))
    : undefined;
  const identity =
    agentId && taskId ? { runId: params.runId, deliveryId, taskId, agentId } : undefined;
  const checkedTask =
    params.sessionFile &&
    binding?.taskId &&
    binding.executionAttempt === params.runId &&
    binding.deliverableVersion
      ? { sessionFile: params.sessionFile, binding: { ...binding } }
      : undefined;
  // Persist identity, binding, payload and target before commit. This intent is
  // not a confirmable registration and does not imply the result is committed
  // or delivered. Official handoff + publish still wait for a successful commit.
  let handedOff = false;
  try {
    if (identity && persistRoot) {
      persistAwaitingDeliveryIntent({
        ...identity,
        persistRoot,
        ...(checkedTask ? { checkedTask } : {}),
        ...(params.payloads ? { payloads: [...params.payloads] } : {}),
        ...(params.target ? { target: params.target } : {}),
        ...(params.authorization ? { authorization: params.authorization } : {}),
        sendDisposition: "not_attempted",
      });
    }
    await params.commitOutcome(true, {
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId: gates.deliveryId,
      ...(checked ? { acceptanceEvidence: matches ? checked.evidence : [] } : {}),
    });
    if (!identity || !persistRoot) {
      return gates.acceptance.status;
    }
    const handed = await handoffAwaitingDelivery({
      ...identity,
      persistRoot,
      ...(checkedTask ? { checkedTask } : {}),
      ...(params.payloads ? { payloads: [...params.payloads] } : {}),
      ...(params.target ? { target: params.target } : {}),
      ...(params.authorization ? { authorization: params.authorization } : {}),
      sendDisposition: "handed_off",
    });
    if (handed.ok) {
      handedOff = true;
      params.publishPending(identity);
    }
    return gates.acceptance.status;
  } finally {
    if (identity && persistRoot && !handedOff) {
      await releaseLiveProducerPreparation({ persistRoot, runId: identity.runId });
    }
  }
}

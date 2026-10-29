/**
 * Chat / discussion DELIVERABLE path: when no wake binding was injected, try to
 * bind formal submit to THIS actor's unique active board claim (applied |
 * in_progress). Actor-scoped only — not a whole-group "unique claimant" scan.
 *
 * Uses source=explicit_run with the member run id. Ambiguous / missing claim →
 * null (caller must still schedule collaboration continue).
 */
import type { OpenBotConfig } from "../../config/types.js";
import { listAllBoardClaimItems } from "../collaboration-dispatch/claim-contract.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { SELF_ADVANCE_ACTIVE_BOARD_STATUSES } from "../collaboration-dispatch/self-advance.js";
import { deliveryActorIdsEqual } from "./delivery-actor-binding.js";
import {
  buildExecutionDeliverableBinding,
  type ExecutionDeliverableBinding,
} from "./execution-deliverable-binding.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

const ACTIVE = new Set<string>(SELF_ADVANCE_ACTIVE_BOARD_STATUSES);

export async function tryBuildChatActorExecutionDeliverableBinding(params: {
  authority: RuntimeAuthority;
  agentId: string;
  /** Member run id (e.g. clientRunId:agentId) — durable for this discussion turn. */
  runId: string;
  /** Optional OS / wake task hint to disambiguate when the actor has multiple claims. */
  taskIdHint?: string | null;
  cfg?: OpenBotConfig;
}): Promise<ExecutionDeliverableBinding | null> {
  const agentId = compact(params.agentId);
  const runId = compact(params.runId);
  const groupId = compact(params.authority.groupId);
  if (!agentId || !runId || !groupId) {
    return null;
  }
  try {
    const items = await listAllBoardClaimItems(params.authority);
    const hint = compact(params.taskIdHint);
    const mine = items.filter(
      (item) =>
        compact(item.groupId) === groupId &&
        ACTIVE.has(compact(item.status)) &&
        deliveryActorIdsEqual(item.claimantId, agentId) &&
        (!hint || compact(item.taskId) === hint),
    );
    if (mine.length !== 1) {
      return null;
    }
    const item = mine[0];
    const taskId = compact(item.taskId);
    const boardItemId = compact(item.itemId);
    if (!taskId || !boardItemId) {
      return null;
    }
    return buildExecutionDeliverableBinding({
      tenantId: params.authority.tenantId ?? null,
      groupId,
      taskId,
      boardItemId,
      runId,
      agentId,
      source: "explicit_run",
    });
  } catch {
    return null;
  }
}

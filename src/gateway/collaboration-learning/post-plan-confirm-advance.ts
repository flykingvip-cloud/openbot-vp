import { loadConfig } from "../../config/config.js";
/**
 * Post-plan-confirm auto-advance (product wiring after #128).
 *
 * Uses existing wake contract + wake→round consumer — no second orchestrator.
 * After confirmCollaborationTodolist succeeds, nudge the board claimant/targets
 * and best-effort consumeWakeForRoundDispatch(source=nudge).
 *
 * Gray: wake/selfAdvance execute flags still gate real dispatch; this only
 * connects the confirm success edge to those existing mechanisms.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { recordNudgeWake } from "../collaboration-dispatch/wake-contract.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { buildClaimAuthority, listCollaborationBoardItems } from "./claim-contract-entry.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export type PostPlanConfirmAdvanceResult = {
  /** True when this path attempted the existing wake/schedule mechanism. */
  autoAdvanceWired: true;
  wakeRecorded: boolean;
  wakeConsumed: boolean;
  dispatched: boolean;
  reason: string;
  targetAgentIds: string[];
};

export async function triggerPostPlanConfirmAdvance(params: {
  groupId: string;
  taskId: string;
  boardItemId?: string | null;
  todolistId?: string | null;
  confirmerId: string;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<PostPlanConfirmAdvanceResult> {
  const cfg = params.cfg ?? loadConfig();
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const confirmerId = compact(params.confirmerId);
  if (!groupId || !taskId || !confirmerId) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "missing_group_task_or_confirmer",
      targetAgentIds: [],
    };
  }

  const { authority, stores } = await buildClaimAuthority({
    groupId,
    taskId,
    cfg,
    tenant: params.tenant,
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
  });

  const boardItems = await listCollaborationBoardItems({
    groupId,
    taskId,
    cfg,
    auth: params.auth,
    trusted: params.trusted,
    stores: stores ?? params.stores,
    tenant: params.tenant,
  });
  const boardItemId = compact(params.boardItemId);
  const item =
    (boardItemId ? boardItems.find((row) => row.itemId === boardItemId) : undefined) ??
    boardItems.find((row) => row.taskId === taskId) ??
    boardItems[0];

  const targets = new Set<string>();
  if (item) {
    const claimant = compact(item.claimantId);
    if (claimant && claimant !== confirmerId) {
      targets.add(claimant);
    }
    for (const id of item.intendedClaimantIds ?? []) {
      const t = compact(id);
      if (t && t !== confirmerId) {
        targets.add(t);
      }
    }
    const publishedBy = compact(item.publishedBy);
    if (publishedBy && publishedBy !== confirmerId && targets.size === 0) {
      targets.add(publishedBy);
    }
  }
  const targetAgentIds = [...targets];
  if (targetAgentIds.length === 0) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: "no_advance_targets",
      targetAgentIds: [],
    };
  }

  const nudge = await recordNudgeWake(
    authority,
    {
      groupId,
      fromAgentId: confirmerId,
      toAgentIds: targetAgentIds,
      taskId,
      itemId: item?.itemId,
      reason: "plan_confirmed_auto_advance",
    },
    { cfg },
  );
  if (!nudge.ok) {
    return {
      autoAdvanceWired: true,
      wakeRecorded: false,
      wakeConsumed: false,
      dispatched: false,
      reason: `nudge_failed:${nudge.reason ?? "unknown"}`,
      targetAgentIds,
    };
  }

  const consume = await consumeWakeForRoundDispatch({
    authority,
    cfg,
    writeMode: "execute",
    request: {
      groupId,
      tenantId: params.tenant?.tenantId ?? params.auth?.tenantId ?? null,
      fromAgentId: confirmerId,
      toAgentIds: targetAgentIds,
      source: "nudge",
      taskId,
      itemId: item?.itemId,
      reason: "plan_confirmed_auto_advance",
    },
  });

  return {
    autoAdvanceWired: true,
    wakeRecorded: true,
    wakeConsumed: true,
    dispatched: Boolean(consume.dispatched),
    reason: consume.reason ?? (consume.dispatched ? "dispatched" : "wake_recorded"),
    targetAgentIds,
  };
}

/**
 * After a formal team DELIVERABLE settles (ok or binding rejected), keep the
 * multi-milestone auto-chain alive: inventory-first collaboration continue
 * (wake / self_advance) even when continueAfterRoundComplete is default OFF.
 *
 * task_board_continue is private-session only and will skip group chats — this
 * is the collaboration-side counterpart so sessions do not idle after M1.
 * Best-effort; never throws into the chat / wake hot path. Cooldown still applies.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { maybeContinueAfterRoundComplete } from "../collaboration-dispatch/continue-after-round.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";

const log = createSubsystemLogger("gateway/schedule-continue-after-deliverable");

export async function scheduleContinueAfterDeliverableSettlement(params: {
  authority: RuntimeAuthority;
  roundId: string;
  cfg?: OpenBotConfig;
  /** Why continue was forced (diagnostics). */
  reason?: string;
  agentId?: string | null;
  deliverableOk?: boolean;
  /** Triggering board task/item for this settlement (O5 scope). */
  taskId?: string | null;
  itemId?: string | null;
}): Promise<void> {
  try {
    const scopeTaskId = params.taskId?.trim() || undefined;
    const scopeItemId = params.itemId?.trim() || undefined;
    const result = await maybeContinueAfterRoundComplete({
      authority: params.authority,
      roundId: params.roundId,
      roundState: "ROUND_COMPLETE",
      cfg: params.cfg,
      forceForDeliverableSettlement: true,
      forceContinueScope:
        scopeTaskId || scopeItemId ? { taskId: scopeTaskId, itemId: scopeItemId } : undefined,
    });
    log.info("scheduleContinueAfterDeliverableSettlement", {
      reason: params.reason ?? "deliverable_settlement",
      agentId: params.agentId ?? null,
      deliverableOk: params.deliverableOk ?? null,
      skipped: result.skipped,
      decisionReason: result.decision.reason,
      wakeRecorded: result.decision.wakeRecorded,
      selfAdvanceTriggered: result.decision.selfAdvanceTriggered,
    });
  } catch (err) {
    log.warn("scheduleContinueAfterDeliverableSettlement failed", {
      reason: params.reason ?? "deliverable_settlement",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

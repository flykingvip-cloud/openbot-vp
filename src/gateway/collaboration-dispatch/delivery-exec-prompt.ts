/**
 * FINAL v3 S2 — inject 三件套 into the collaboration agent turn prompt.
 *
 * Called from assembleCollaborationRuntimeContextParts (the get-reply path used
 * after a group discussion turn). Reuses evaluateDeliveryExecGateForBoardItem /
 * formatExecutionTaskBagForPrompt. Does not start a second orchestrator.
 *
 * Claim contract off: no injection (ordinary chat unchanged).
 * Confirmed plan + complete bag: delivery prompt.
 * Missing plan / blocked board: nudge or block text. Never a silent delivery exec.
 */
import type { OpenBotConfig } from "../../config/config.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  boardItemGoal,
  isCollabTaskClaimContractEnabled,
  listAllBoardClaimItems,
  type GroupBoardClaimItem,
} from "./claim-contract.js";
import {
  deliveryToolSideEffectFromTaskBag,
  resolveDeliveryToolSideEffectLedgerDir,
  type DeliveryToolSideEffectSchedule,
} from "./delivery-tool-side-effect.js";
import { formatExecutionTaskBagForPrompt } from "./executor-private-todolist.js";
import { evaluateDeliveryExecGateForBoardItem, type DeliveryExecGate } from "./plan-gate-exec.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority } from "./runtime-authority.js";

export const DELIVERY_EXEC_REFUSAL_HEADER = "## 执行门禁（不得静默交付）";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function activityAt(item: GroupBoardClaimItem): number {
  return (
    item.inProgressAt ??
    item.returnedAt ??
    item.appliedAt ??
    item.claimedAt ??
    item.blockedAt ??
    item.publishedAt ??
    0
  );
}

const PROMPT_STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  returned: 1,
  applied: 2,
  claimed: 3,
  blocked: 4,
  submitted_for_review: 5,
  published: 6,
};

function selectClaimantBoardItem(
  items: readonly GroupBoardClaimItem[],
  agentId: string,
  groupId: string,
): GroupBoardClaimItem | null {
  const mine = items.filter(
    (item) =>
      compact(item.claimantId) === agentId &&
      compact(item.groupId) === groupId &&
      item.status !== "accepted" &&
      item.status !== "cancelled",
  );
  if (mine.length === 0) {
    return null;
  }
  return [...mine].toSorted((a, b) => {
    const byStatus = (PROMPT_STATUS_RANK[a.status] ?? 9) - (PROMPT_STATUS_RANK[b.status] ?? 9);
    if (byStatus !== 0) {
      return byStatus;
    }
    return activityAt(b) - activityAt(a);
  })[0];
}

function formatDeliveryRefusal(gate: DeliveryExecGate, item: GroupBoardClaimItem): string {
  const goal = boardItemGoal(item) || "(无)";
  const lines = [
    DELIVERY_EXEC_REFUSAL_HEADER,
    `- mode: ${gate.mode}`,
    `- reason: ${gate.reason}`,
    `- message: ${gate.message}`,
    `- itemId: ${item.itemId}`,
    `- Goal: ${goal}`,
    `- groupId: ${item.groupId}`,
    "- transcript: runtime/transcript.jsonl (GROUP_PUBLIC; read recent member+human messages)",
    "- 当前步: 未确认或不可执行 — 不得调用交付类工具推进看板。",
    "只允许提醒补齐计划（proposeTodolist → confirmTodolist）或等待人工 unblock。",
  ];
  if (gate.taskBag) {
    lines.push("");
    lines.push(formatExecutionTaskBagForPrompt(gate.taskBag));
  }
  return lines.join("\n");
}

export type DeliveryExecTurn = {
  prompt?: string;
  /** Present only for a confirmed delivery step. Ordinary turns stay unset. */
  sideEffect?: DeliveryToolSideEffectSchedule;
};

/**
 * Prompt section plus optional durable tool fingerprint for the acting bot.
 * Prompt is undefined when claim contract is off or this bot has no open claimed item.
 * sideEffect is set only when the gate is delivery_exec with a confirmed step.
 */
export async function resolveDeliveryExecTurn(params: {
  cfg: OpenBotConfig;
  groupId: string;
  agentId: string;
  tenantId?: string | null;
  taskId?: string;
}): Promise<DeliveryExecTurn> {
  const groupId = compact(params.groupId);
  const agentId = compact(params.agentId);
  if (!groupId || !agentId) {
    return {};
  }
  if (!isCollabTaskClaimContractEnabled(params.cfg, groupId, params.tenantId)) {
    return {};
  }
  try {
    const tenantId = compact(params.tenantId) || null;
    const profile = resolveSecurityProfile(params.cfg, process.env).profile;
    const snapshot = createRoundPolicySnapshot(
      {
        collaborationMode: "task_driven",
        finalDecisionMode: "human_required",
        botMaySelfAdvanceWithoutHuman: false,
      },
      { now: Date.now(), idGen: () => "pss_delivery_prompt" },
    );
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: `delivery-prompt:${groupId}`,
      // Turn tenant id is already resolved upstream. This helper does not
      // re-prove membership, so a present id stays at actor_fallback.
      tenant: tenantId ? { tenantId, trust: "actor_fallback" } : { tenantId: null, trust: "none" },
      groupId,
      profile,
      cfg: params.cfg,
    });
    const items = await listAllBoardClaimItems(authority);
    const item = selectClaimantBoardItem(
      params.taskId ? items.filter((item) => item.taskId === params.taskId) : items,
      agentId,
      groupId,
    );
    if (!item) {
      return {};
    }
    const gate = await evaluateDeliveryExecGateForBoardItem(authority, {
      boardItem: item,
      ownerMemberId: agentId,
    });
    if (gate.mode === "delivery_exec" && gate.taskBag) {
      const ledgerDir = resolveDeliveryToolSideEffectLedgerDir({
        groupId,
        tenantId,
        cfg: params.cfg,
      });
      return {
        prompt: formatExecutionTaskBagForPrompt(gate.taskBag),
        sideEffect: deliveryToolSideEffectFromTaskBag({
          bag: gate.taskBag,
          ledgerDir,
        }),
      };
    }
    return { prompt: formatDeliveryRefusal(gate, item) };
  } catch {
    return {
      prompt: [
        DELIVERY_EXEC_REFUSAL_HEADER,
        "- reason: delivery_prompt_unavailable",
        "不得调用交付类工具推进看板。",
      ].join("\n"),
    };
  }
}

/**
 * Prompt section for the acting bot's current board item.
 * Undefined when claim contract is off or this bot has no open claimed item.
 */
export async function buildDeliveryExecPromptForTurn(params: {
  cfg: OpenBotConfig;
  groupId: string;
  agentId: string;
  tenantId?: string | null;
}): Promise<string | undefined> {
  const turn = await resolveDeliveryExecTurn(params);
  return turn.prompt;
}

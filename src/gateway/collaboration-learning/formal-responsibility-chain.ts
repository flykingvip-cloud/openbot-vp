/**
 * Formal responsibility chain after a legal board is published.
 *
 * Order is fixed: claim → plan → policy-gated confirm → wake.
 * Each ok segment requires a receipt ref from the existing entry point.
 * This module does not call those entry points, does not mint a claim,
 * and does not set humanConfirmed. activate success stays dispatched:false.
 * @mention / 催办 text never writes a segment receipt.
 * `dispatched` is true only after the wake receipt exists AND the dispatcher
 * returns ok with a roundId (consumeWakeForRoundDispatch accept path).
 */

export const ACTIVATE_SUCCESS_DISPATCHED = false as const;

export const FORMAL_ENTRY_POINTS = {
  claim: "claimCollaborationBoardItem",
  plan: "proposeCollaborationTodolist",
  confirm: "confirmCollaborationTodolist",
  wake: "triggerPostPlanConfirmAdvance",
} as const;

export type FormalSegmentId = keyof typeof FORMAL_ENTRY_POINTS;

export type FormalSegmentReceipt =
  | {
      segment: FormalSegmentId;
      ok: true;
      receiptRef: string;
      entryPoint: (typeof FORMAL_ENTRY_POINTS)[FormalSegmentId];
    }
  | {
      segment: FormalSegmentId;
      ok: false;
      receiptRef: null;
      reason: string;
      entryPoint: (typeof FORMAL_ENTRY_POINTS)[FormalSegmentId];
    };

export type DispatcherAcceptResult = {
  ok?: boolean;
  roundId?: string | null;
};

export type FormalChainFacts = {
  boardPublished: boolean;
  /** claimBoardItem committed (item claimed/applied and claimant recorded). */
  claimReceiptRef: string | null;
  /** proposeTodolist committed. */
  planReceiptRef: string | null;
  /**
   * True only when confirmTodolist's policy gate (主答/lead or coordinator,
   * not executor self-confirm) authorized this confirmer.
   * A stored confirm id without this flag is not a confirm receipt.
   */
  confirmAuthorized: boolean;
  confirmReceiptRef: string | null;
  /** recordNudgeWake / wake row written by triggerPostPlanConfirmAdvance. */
  wakeReceiptRef: string | null;
  /** Dispatcher return from consumeWakeForRoundDispatch. Null if not invoked. */
  dispatcher: DispatcherAcceptResult | null;
};

export type FormalChainProjection = {
  receipts: FormalSegmentReceipt[];
  nextEntryPoint: (typeof FORMAL_ENTRY_POINTS)[FormalSegmentId] | null;
  dispatched: boolean;
  activateDispatched: typeof ACTIVATE_SUCCESS_DISPATCHED;
  mintedClaim: false;
  mintedHumanConfirmed: false;
};

export function dispatcherTrulyAccepted(
  result: DispatcherAcceptResult | null | undefined,
): boolean {
  const roundId = result?.roundId?.trim() ?? "";
  return result?.ok === true && roundId.length > 0;
}

function gap(segment: FormalSegmentId, reason: string): FormalSegmentReceipt {
  return {
    segment,
    ok: false,
    receiptRef: null,
    reason,
    entryPoint: FORMAL_ENTRY_POINTS[segment],
  };
}

function okReceipt(segment: FormalSegmentId, receiptRef: string): FormalSegmentReceipt {
  return {
    segment,
    ok: true,
    receiptRef,
    entryPoint: FORMAL_ENTRY_POINTS[segment],
  };
}

/**
 * Project the formal chain from receipts that already exist.
 * Later segments stay closed until the previous segment has an ok receipt.
 * Does not create claim, plan, confirm, or humanConfirmed.
 */
export function projectFormalResponsibilityChain(facts: FormalChainFacts): FormalChainProjection {
  const receipts: FormalSegmentReceipt[] = [];
  if (!facts.boardPublished) {
    receipts.push(gap("claim", "board_not_published"));
    receipts.push(gap("plan", "board_not_published"));
    receipts.push(gap("confirm", "board_not_published"));
    receipts.push(gap("wake", "board_not_published"));
    return {
      receipts,
      nextEntryPoint: null,
      dispatched: false,
      activateDispatched: ACTIVATE_SUCCESS_DISPATCHED,
      mintedClaim: false,
      mintedHumanConfirmed: false,
    };
  }

  const claimRef = facts.claimReceiptRef?.trim() ?? "";
  if (!claimRef) {
    receipts.push(gap("claim", "claim_receipt_missing"));
  } else {
    receipts.push(okReceipt("claim", claimRef));
  }

  const planRef = facts.planReceiptRef?.trim() ?? "";
  if (!receipts[0]?.ok) {
    receipts.push(gap("plan", "claim_required"));
  } else if (!planRef) {
    receipts.push(gap("plan", "plan_receipt_missing"));
  } else {
    receipts.push(okReceipt("plan", planRef));
  }

  const confirmRef = facts.confirmReceiptRef?.trim() ?? "";
  if (!receipts[1]?.ok) {
    receipts.push(gap("confirm", "plan_required"));
  } else if (!facts.confirmAuthorized) {
    receipts.push(gap("confirm", "confirmer_not_authorized"));
  } else if (!confirmRef) {
    receipts.push(gap("confirm", "confirm_receipt_missing"));
  } else {
    receipts.push(okReceipt("confirm", confirmRef));
  }

  const wakeRef = facts.wakeReceiptRef?.trim() ?? "";
  if (!receipts[2]?.ok) {
    receipts.push(gap("wake", "confirm_required"));
  } else if (!wakeRef) {
    receipts.push(gap("wake", "wake_receipt_missing"));
  } else {
    receipts.push(okReceipt("wake", wakeRef));
  }

  const nextGap = receipts.find((row) => !row.ok);
  const wakeOk = receipts[3]?.ok;
  return {
    receipts,
    nextEntryPoint: nextGap && !nextGap.ok ? nextGap.entryPoint : null,
    dispatched: wakeOk && dispatcherTrulyAccepted(facts.dispatcher),
    activateDispatched: ACTIVATE_SUCCESS_DISPATCHED,
    mintedClaim: false,
    mintedHumanConfirmed: false,
  };
}

/** @mention / 催办 / 口头「完成」does not write claim, plan, confirm, or wake receipts. */
export function oralMentionDoesNotAdvanceChain(text: string): {
  substituted: false;
  reason: "mention_or_nudge_is_not_formal_chain";
  textSeen: string;
  receiptsWritten: 0;
  dispatched: false;
  mintedClaim: false;
  mintedHumanConfirmed: false;
} {
  return {
    substituted: false,
    reason: "mention_or_nudge_is_not_formal_chain",
    textSeen: text,
    receiptsWritten: 0,
    dispatched: false,
    mintedClaim: false,
    mintedHumanConfirmed: false,
  };
}

/** Stage tri-state from discuss-to-task. Unknown is not a receipt. */
export function factsFromFormalStages(stages: {
  boardPublished?: boolean | "unknown";
  responsibilityAccepted?: boolean | "unknown";
  planProposed?: boolean | "unknown";
  planConfirmed?: boolean | "unknown";
}): FormalChainFacts {
  const published = stages.boardPublished === true;
  const claimed = stages.responsibilityAccepted === true;
  const proposed = stages.planProposed === true;
  const confirmed = stages.planConfirmed === true;
  return {
    boardPublished: published,
    claimReceiptRef: claimed ? "board:claim" : null,
    planReceiptRef: proposed ? "todolist:proposed" : null,
    confirmAuthorized: confirmed,
    confirmReceiptRef: confirmed ? "todolist:confirmed" : null,
    wakeReceiptRef: null,
    dispatcher: null,
  };
}

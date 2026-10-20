/**
 * Bot↔bot dispatch ticket validation for conversation_send (execution-discipline P2).
 * Lightweight runtime checks — does not invent a second orchestrator.
 */

export type ConversationDispatchTicket = {
  successCriteria?: string;
  singleOwner?: string;
  forbiddenZones?: string;
  message: string;
  target: string;
  taskId?: string;
};

export type ConversationDispatchValidation = {
  ok: boolean;
  missing: string[];
  /** Warn when the payload asks the receiver to re-confirm with the user. */
  secondUserConfirmWarning?: string;
  normalizedOwner?: string;
};

const SECOND_CONFIRM_PATTERNS: readonly RegExp[] = [
  /请?(再)?(向|跟|对)?用户(再)?(确认|询问|征求同意)/u,
  /ask\s+(the\s+)?user\s+to\s+confirm/iu,
  /get\s+(the\s+)?user'?s?\s+confirmation/iu,
  /请用户确认/u,
  /让用户再确认/u,
  /二次确认/u,
  /再确认一次/u,
];

const SUCCESS_MARKERS = /成功标准\s*[:：]|success\s*criteria\s*[:：]/iu;
const FORBIDDEN_MARKERS = /禁区\s*[:：]|约束与禁区\s*[:：]|forbidden\s*zones?\s*[:：]/iu;
const OWNER_MARKERS = /单主责\s*[:：]|主责\s*[:：]|single\s*owner\s*[:：]/iu;

/** True when this send looks like a task dispatch (not casual 1:1 chat). */
export function looksLikeDispatchTicket(params: {
  message: string;
  taskId?: string;
  successCriteria?: string;
  forbiddenZones?: string;
  singleOwner?: string;
}): boolean {
  if (params.taskId?.trim()) {
    return true;
  }
  if (
    params.successCriteria?.trim() ||
    params.forbiddenZones?.trim() ||
    params.singleOwner?.trim()
  ) {
    return true;
  }
  const text = params.message;
  return (
    SUCCESS_MARKERS.test(text) ||
    FORBIDDEN_MARKERS.test(text) ||
    OWNER_MARKERS.test(text) ||
    /目标\s*[:：]/u.test(text)
  );
}

export function detectSecondUserConfirmRisk(message: string): string | undefined {
  for (const pattern of SECOND_CONFIRM_PATTERNS) {
    if (pattern.test(message)) {
      return "receiver_would_prompt_user_confirm: prefer single user-facing confirm exit; do not ask the peer to re-confirm with the user for the same decision";
    }
  }
  return undefined;
}

/**
 * When the payload is a dispatch ticket, require success criteria + single owner
 * + forbidden zones (explicit field or inline marker in message).
 */
export function validateConversationDispatch(
  ticket: ConversationDispatchTicket,
): ConversationDispatchValidation {
  const secondUserConfirmWarning = detectSecondUserConfirmRisk(ticket.message);
  const isDispatch = looksLikeDispatchTicket(ticket);
  if (!isDispatch) {
    return {
      ok: true,
      missing: [],
      ...(secondUserConfirmWarning ? { secondUserConfirmWarning } : {}),
    };
  }

  const missing: string[] = [];
  const hasSuccess =
    Boolean(ticket.successCriteria?.trim()) || SUCCESS_MARKERS.test(ticket.message);
  const hasForbidden =
    Boolean(ticket.forbiddenZones?.trim()) || FORBIDDEN_MARKERS.test(ticket.message);
  const owner =
    ticket.singleOwner?.trim() ||
    (OWNER_MARKERS.test(ticket.message) ? "inline" : ticket.target.trim());
  const hasOwner = Boolean(owner);

  if (!hasSuccess) {
    missing.push("successCriteria");
  }
  if (!hasOwner) {
    missing.push("singleOwner");
  }
  if (!hasForbidden) {
    missing.push("forbiddenZones");
  }

  return {
    ok: missing.length === 0,
    missing,
    normalizedOwner: owner || undefined,
    ...(secondUserConfirmWarning ? { secondUserConfirmWarning } : {}),
  };
}

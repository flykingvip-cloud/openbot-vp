import type { BlueprintDraft, CreationSession, CreationSessionStatus } from "./types.js";
import { canShowConfirmationCard } from "./validate-draft.js";

const TRANSITIONS: Record<CreationSessionStatus, readonly CreationSessionStatus[]> = {
  DESIGNING: ["DRAFT", "FAILED"],
  DRAFT: ["REVISING", "READY_FOR_CONFIRMATION", "FAILED"],
  REVISING: ["DRAFT", "READY_FOR_CONFIRMATION", "FAILED"],
  READY_FOR_CONFIRMATION: ["REVISING", "CONFIRMED", "FAILED"],
  CONFIRMED: ["INSTANTIATING", "FAILED"],
  INSTANTIATING: ["INSTANTIATED", "PARTIAL", "FAILED"],
  INSTANTIATED: [],
  PARTIAL: [],
  FAILED: ["DESIGNING"],
};

export function canTransition(from: CreationSessionStatus, to: CreationSessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: CreationSessionStatus, to: CreationSessionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal creation session transition: ${from} → ${to}`);
  }
}

export function canCallFactory(session: CreationSession): boolean {
  return session.status === "CONFIRMED" || session.status === "INSTANTIATING";
}

export function acceptDraft(session: CreationSession, draft: BlueprintDraft): CreationSession {
  assertTransition(session.status, "DRAFT");
  return { ...session, draftId: draft.draftId, status: "DRAFT" };
}

export function markDraftReady(session: CreationSession, draft: BlueprintDraft): CreationSession {
  if (!canShowConfirmationCard(draft)) {
    throw new Error("invalid draft cannot enter READY_FOR_CONFIRMATION");
  }
  assertTransition(session.status, "READY_FOR_CONFIRMATION");
  return { ...session, draftId: draft.draftId, status: "READY_FOR_CONFIRMATION" };
}

export function confirmDraft(session: CreationSession): CreationSession {
  if (session.status !== "READY_FOR_CONFIRMATION") {
    throw new Error("only READY_FOR_CONFIRMATION may be confirmed");
  }
  assertTransition(session.status, "CONFIRMED");
  return { ...session, status: "CONFIRMED" };
}

export function beginInstantiate(session: CreationSession): CreationSession {
  if (!canCallFactory(session) && session.status !== "CONFIRMED") {
    throw new Error("factory is closed until CONFIRMED");
  }
  assertTransition(session.status, "INSTANTIATING");
  return { ...session, status: "INSTANTIATING" };
}

export function finishInstantiate(
  session: CreationSession,
  result: { agentId: string; failedSkillCount: number },
): CreationSession {
  if (session.status !== "INSTANTIATING") {
    throw new Error("finishInstantiate requires INSTANTIATING");
  }
  const next: CreationSessionStatus = result.failedSkillCount > 0 ? "PARTIAL" : "INSTANTIATED";
  assertTransition(session.status, next);
  return { ...session, status: next, instantiatedAgentId: result.agentId };
}

export function abortSession(session: CreationSession): CreationSession {
  if (session.status === "INSTANTIATED" || session.status === "PARTIAL") {
    throw new Error("cannot abort a completed instantiation");
  }
  if (session.status === "FAILED") {
    return session;
  }
  assertTransition(session.status, "FAILED");
  return { ...session, status: "FAILED" };
}

export function reviseDraft(
  session: CreationSession,
  nextDraft: BlueprintDraft,
): {
  session: CreationSession;
  draft: BlueprintDraft;
} {
  if (session.status === "CONFIRMED" || session.status === "INSTANTIATING") {
    throw new Error("cannot revise after confirm");
  }
  const from =
    session.status === "READY_FOR_CONFIRMATION" ? "READY_FOR_CONFIRMATION" : session.status;
  if (from !== "DRAFT" && from !== "READY_FOR_CONFIRMATION" && from !== "REVISING") {
    throw new Error("cannot revise from this status");
  }
  if (from !== "REVISING") {
    assertTransition(from, "REVISING");
  }
  return {
    session: { ...session, status: "REVISING", draftId: nextDraft.draftId },
    draft: { ...nextDraft, revision: nextDraft.revision + 1 },
  };
}

/** In-memory idempotency ledger for P1. Not an employee identity store. */
export class InstantiationLedger {
  private readonly byKey = new Map<string, string>();

  remember(idempotencyKey: string, agentId: string): string {
    const existing = this.byKey.get(idempotencyKey);
    if (existing) {
      return existing;
    }
    this.byKey.set(idempotencyKey, agentId);
    return agentId;
  }

  peek(idempotencyKey: string): string | undefined {
    return this.byKey.get(idempotencyKey);
  }
}

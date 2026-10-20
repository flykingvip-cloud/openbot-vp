import { extractGroupIdFromChatSessionKey } from "../chat-event-isolation.js";
import { listPersistedRounds, writePersistedRound } from "../collaboration-dispatch/round-store.js";
import { appendCollaborationContextScopeRecord } from "../collaboration-ledger/writer.js";
import { allowedSourcesForAudit } from "./audit.js";
import type { ContextScopePlan } from "./types.js";

/**
 * Scope join contract:
 * - 1:1: persist is optional. Authorization still fail-closes retrieve.
 * - Managed group Round (`requireSnapshot`): if an open round exists, ledger +
 *   snapshot must land before optional retrieve. Explore chats with no open
 *   round stay retrieve-eligible (same as 1:1).
 * - Chat keys `agent:<bot>:main:space:<id>` match round keys `space:<id>`.
 */

function collaborationScopeSessionKeys(sessionKey: string): string[] {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return [];
  }
  const keys = new Set<string>([trimmed]);
  const groupId = extractGroupIdFromChatSessionKey(trimmed);
  if (groupId) {
    keys.add(`space:${groupId}`);
  }
  return [...keys];
}

export function roundSessionMatchesChatSession(
  roundSessionKey: string,
  chatSessionKey: string,
): boolean {
  const roundKeys = new Set(collaborationScopeSessionKeys(roundSessionKey));
  return collaborationScopeSessionKeys(chatSessionKey).some((key) => roundKeys.has(key));
}

export type ContextScopeRuntimeJoinResult = {
  ledger: boolean;
  snapshot: boolean;
  degraded: boolean;
  reason?: "no_open_round" | "snapshot_failed" | "ledger_failed";
};

export async function persistAuthorizedContextScopePlan(params: {
  groupId: string;
  sessionKey: string;
  plan: ContextScopePlan;
  tenantId?: string | null;
  roundsDir?: string;
  roundId?: string;
}): Promise<boolean> {
  const rounds = await listPersistedRounds({
    groupId: params.groupId,
    tenantId: params.tenantId,
    roundsDir: params.roundsDir,
  });
  const target = params.roundId
    ? rounds.find((round) => round.roundId === params.roundId)
    : rounds
        .filter(
          (round) =>
            roundSessionMatchesChatSession(round.sessionKey, params.sessionKey) &&
            round.state !== "ROUND_COMPLETE" &&
            round.state !== "ROUND_ABORTED",
        )
        .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
  if (!target) {
    return false;
  }
  await writePersistedRound({
    round: { ...target, contextScopePlan: params.plan },
    expectedStateVersion: target.stateVersion,
    tenantId: params.tenantId,
    roundsDir: params.roundsDir,
  });
  return true;
}

export async function recordContextScopeOnCollaborationRuntime(params: {
  groupId: string;
  sessionKey: string;
  plan: ContextScopePlan;
  evidenceCount: number;
  tenantId?: string | null;
  roundsDir?: string;
  roundId?: string;
  requireSnapshot?: boolean;
}): Promise<ContextScopeRuntimeJoinResult> {
  try {
    await appendCollaborationContextScopeRecord({
      groupId: params.groupId,
      sessionKey: params.sessionKey,
      mode: params.plan.mode,
      confidentialityMaxLevel: params.plan.confidentiality.maxLevel,
      allowedSources: allowedSourcesForAudit(params.plan.sources),
      deniedSources: params.plan.deniedSources ?? [],
      budgetMaxTokens: params.plan.budget.maxTokens,
      budgetMaxFiles: params.plan.budget.maxFiles,
      evidenceCount: params.evidenceCount,
      tenantId: params.tenantId,
      ...(params.roundId ? { roundId: params.roundId } : {}),
    });
  } catch {
    return {
      ledger: false,
      snapshot: false,
      degraded: true,
      reason: "ledger_failed",
    };
  }

  try {
    const snapshot = await persistAuthorizedContextScopePlan(params);
    if (params.requireSnapshot && !snapshot) {
      return {
        ledger: true,
        snapshot: false,
        // No managed open round (typical explore chat). Do not strip retrieve.
        degraded: false,
        reason: "no_open_round",
      };
    }
    return { ledger: true, snapshot, degraded: false };
  } catch {
    return {
      ledger: true,
      snapshot: false,
      degraded: Boolean(params.requireSnapshot),
      reason: "snapshot_failed",
    };
  }
}

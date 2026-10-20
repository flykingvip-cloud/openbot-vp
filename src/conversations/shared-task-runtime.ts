/**
 * Resolve Shared Task Context system-prompt addition for collaboration sessions.
 * Used by agent runtime (attempt.ts) — never blocks on failure.
 */
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { estimateTokensFromText } from "./context-budget.js";
import { getSharedTaskContextStore, type SharedTaskContext } from "./shared-task-context.js";
import { buildSharedTaskSystemPromptAddition } from "./shared-task-inject.js";

const log = createSubsystemLogger("conversations/shared-task");

/**
 * Detect collaboration group id from session key patterns:
 * - agent:X:main:space:GROUP
 * - agent:X:space:GROUP:execution:CONV
 * - agent:X:main:space:GROUP:conversation:CONV
 * - space:GROUP (alias)
 */
export function extractCollaborationGroupId(sessionKey: string | undefined | null): string | null {
  const raw = sessionKey?.trim().toLowerCase() ?? "";
  if (!raw) {
    return null;
  }
  const spaceMatch = raw.match(/(?:^|:)space:([^:]+)/);
  if (spaceMatch?.[1]) {
    return spaceMatch[1];
  }
  return null;
}

export function extractConversationIdFromSessionKey(
  sessionKey: string | undefined | null,
): string | null {
  const raw = sessionKey?.trim().toLowerCase() ?? "";
  const m = raw.match(/:conversation:(conv_[a-z0-9_]+)/i);
  return m?.[1] ?? null;
}

/**
 * Load shared task for a collaboration session and format as system prompt addition.
 * Fail-soft: returns null on any error.
 */
export async function resolveSharedTaskPromptAddition(params: {
  cfg?: OpenBotConfig | null;
  sessionKey?: string | null;
  /** Optional explicit conversation id when known. */
  conversationId?: string | null;
  maxTokens?: number;
  dataRoot?: string;
}): Promise<{ addition: string | null; groupId: string | null; conversationId: string | null }> {
  try {
    const groupId = extractCollaborationGroupId(params.sessionKey);
    if (!groupId) {
      return { addition: null, groupId: null, conversationId: null };
    }
    const conversationId =
      params.conversationId?.trim() ||
      extractConversationIdFromSessionKey(params.sessionKey) ||
      null;
    if (!conversationId) {
      // Without conversation id we cannot load scoped shared task; skip.
      return { addition: null, groupId, conversationId: null };
    }
    const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg ?? undefined);
    const store = getSharedTaskContextStore(dataRoot);
    const context: SharedTaskContext | null = await store.get(groupId, conversationId);
    if (!context) {
      return { addition: null, groupId, conversationId };
    }
    // Budget: up to 20% of a typical 8k slice is too fixed — use caller max or 800.
    const maxTokens = params.maxTokens ?? 800;
    const addition = buildSharedTaskSystemPromptAddition({ context, maxTokens });
    if (addition) {
      log.debug(
        `shared task inject group=${groupId} conv=${conversationId} tokens~=${estimateTokensFromText(addition)}`,
      );
    }
    return { addition, groupId, conversationId };
  } catch (err) {
    log.warn(`shared task inject failed: ${String(err)}`);
    return { addition: null, groupId: null, conversationId: null };
  }
}

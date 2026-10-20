import { isBuiltinStewardAgent } from "../../../../src/agents/builtin-steward/identity.ts";
import { parseAgentSessionKey } from "../../../../src/sessions/session-key-utils.ts";
import type { AssistantIdentity } from "../assistant-identity.ts";
import { isGroupScopedSessionKey } from "../collaboration/resolve-group-scope.ts";

/** Group livestream placeholder — never the employee-shell steward (大白 / "大"). */
export const SPACE_STREAM_PLACEHOLDER_NAME = "群成员";

export const SPACE_STREAM_PLACEHOLDER_IDENTITY: Pick<AssistantIdentity, "name" | "avatar"> = {
  name: SPACE_STREAM_PLACEHOLDER_NAME,
  avatar: null,
};

export type SpaceStreamIdentityLookup = {
  resolve: (label: string | null | undefined) => Pick<AssistantIdentity, "name" | "avatar"> | null;
};

/** Alias of isGroupScopedSessionKey — both `space:G` and `…:space:G` are group lanes. */
export const isSpaceChatSessionKey = isGroupScopedSessionKey;

/**
 * Group bot turns emit `${clientRunId}:${agentId}` / `${clientRunId}:primary:${agentId}`.
 * Ignore UUID-only suffixes from bare client run ids.
 */
export function extractAgentIdFromChatRunId(runId: string | null | undefined): string | null {
  const trimmed = runId?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  const primaryMatch = trimmed.match(/:primary:([^:]+)$/i);
  if (primaryMatch?.[1] && primaryMatch[1].toLowerCase() !== "user") {
    return primaryMatch[1];
  }
  const suffixMatch = trimmed.match(/:([^:]+)$/);
  const suffix = suffixMatch?.[1]?.trim();
  if (!suffix || suffix.toLowerCase() === "user") {
    return null;
  }
  if (/^[0-9a-f-]{36}$/i.test(suffix)) {
    return null;
  }
  return suffix;
}

export function extractAgentIdFromStreamSessionKey(
  sessionKey: string | null | undefined,
): string | null {
  const parsed = parseAgentSessionKey(sessionKey);
  const agentId = parsed?.agentId?.trim();
  if (!agentId || agentId === "user") {
    return null;
  }
  return agentId;
}

export function resolveSpaceStreamSpeaker(params: {
  sessionKey: string;
  chatRunId?: string | null;
  chatStreamSessionKey?: string | null;
  senderLabel?: string | null;
  agentId?: string | null;
}): { senderLabel: string | null; agentId: string | null } {
  const senderLabel = params.senderLabel?.trim() || null;
  const fromParam = params.agentId?.trim() || null;
  const fromRunId = extractAgentIdFromChatRunId(params.chatRunId);
  const fromStreamKey = extractAgentIdFromStreamSessionKey(params.chatStreamSessionKey);
  const agentId = fromParam || fromRunId || fromStreamKey || null;
  return { senderLabel, agentId };
}

export function resolveSpaceAwareAssistantIdentity(params: {
  sessionKey: string;
  senderLabel?: string | null;
  agentId?: string | null;
  stewardIdentity: Pick<AssistantIdentity, "name" | "avatar">;
  senderIdentityLookup?: SpaceStreamIdentityLookup;
}): Pick<AssistantIdentity, "name" | "avatar"> {
  const senderLabel = params.senderLabel?.trim() || null;
  const agentId = params.agentId?.trim() || null;
  const lookup = params.senderIdentityLookup;

  if (!isSpaceChatSessionKey(params.sessionKey)) {
    const resolved = lookup?.resolve(senderLabel) ?? lookup?.resolve(agentId);
    if (resolved) {
      return resolved;
    }
    if (senderLabel) {
      return { name: senderLabel, avatar: null };
    }
    return params.stewardIdentity;
  }

  const resolved = lookup?.resolve(senderLabel) ?? lookup?.resolve(agentId);
  if (resolved) {
    return resolved;
  }
  if (senderLabel) {
    return { name: senderLabel, avatar: null };
  }
  const sessionAgentId = extractAgentIdFromStreamSessionKey(params.sessionKey);
  if (isBuiltinStewardAgent(agentId) || isBuiltinStewardAgent(sessionAgentId)) {
    return params.stewardIdentity;
  }
  return SPACE_STREAM_PLACEHOLDER_IDENTITY;
}

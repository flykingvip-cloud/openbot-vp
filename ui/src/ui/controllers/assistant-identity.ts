import { parseAgentSessionKey } from "../../../../src/sessions/session-key-utils.ts";
import {
  DEFAULT_ASSISTANT_AVATAR,
  DEFAULT_ASSISTANT_NAME,
  normalizeAssistantIdentity,
} from "../assistant-identity.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

export type AssistantIdentityRosterEntry = {
  id: string;
  name?: string | null;
  identity?: {
    name?: string | null;
    avatar?: string | null;
    avatarUrl?: string | null;
  } | null;
};

export type AssistantIdentityState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  /** Optional agents.list snapshot — used when identity.get returns DEFAULT or errors after switch. */
  agentsList?: { agents?: readonly AssistantIdentityRosterEntry[] | null } | null;
};

function isDefaultAssistantName(name: string | null | undefined): boolean {
  return (name?.trim() ?? "").toLocaleLowerCase() === DEFAULT_ASSISTANT_NAME.toLocaleLowerCase();
}

function isDefaultAssistantAvatar(avatar: string | null | undefined): boolean {
  return (avatar?.trim() ?? "") === DEFAULT_ASSISTANT_AVATAR;
}

/** Same order as sidebar agentDisplayName: identity.name || name. */
export function resolveRosterAssistantFace(
  agents: readonly AssistantIdentityRosterEntry[] | null | undefined,
  agentId: string | null | undefined,
): { name: string; avatar: string | null; agentId: string } | null {
  const id = agentId?.trim() ?? "";
  if (!id || !agents?.length) {
    return null;
  }
  const entry = agents.find(
    (agent) => agent.id.trim().toLocaleLowerCase() === id.toLocaleLowerCase(),
  );
  if (!entry) {
    return null;
  }
  const name = entry.identity?.name?.trim() || entry.name?.trim() || "";
  if (!name || isDefaultAssistantName(name)) {
    return null;
  }
  const avatarRaw = entry.identity?.avatarUrl?.trim() || entry.identity?.avatar?.trim() || null;
  const avatar = avatarRaw && !isDefaultAssistantAvatar(avatarRaw) ? avatarRaw : null;
  return { name, avatar, agentId: id };
}

function applyRosterFace(
  state: AssistantIdentityState,
  face: { name: string; avatar: string | null; agentId: string },
) {
  state.assistantName = face.name;
  state.assistantAvatar = face.avatar;
  state.assistantAgentId = face.agentId;
}

export async function loadAssistantIdentity(
  state: AssistantIdentityState,
  opts?: { sessionKey?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const sessionKey = opts?.sessionKey?.trim() || state.sessionKey.trim();
  const params = sessionKey ? { sessionKey } : {};
  const sessionAgentId = parseAgentSessionKey(sessionKey)?.agentId?.trim() || null;
  const previousAgentId = state.assistantAgentId?.trim() || null;
  try {
    const res = await state.client.request("agent.identity.get", params);
    if (!res) {
      const face = resolveRosterAssistantFace(state.agentsList?.agents, sessionAgentId);
      if (face) {
        applyRosterFace(state, face);
      }
      return;
    }
    const normalized = normalizeAssistantIdentity(res);
    const agentId = normalized.agentId ?? sessionAgentId;
    const rosterFace = resolveRosterAssistantFace(state.agentsList?.agents, agentId);
    // Prefer roster display when identity chain still lands on DEFAULT "Assistant"/A.
    if (isDefaultAssistantName(normalized.name) && rosterFace) {
      applyRosterFace(state, rosterFace);
      return;
    }
    state.assistantName = normalized.name;
    state.assistantAvatar = isDefaultAssistantAvatar(normalized.avatar)
      ? (rosterFace?.avatar ?? null)
      : normalized.avatar;
    state.assistantAgentId = agentId;
  } catch {
    // On agent switch, never keep a previous/DEFAULT identity forever when roster has a real name.
    const switched =
      Boolean(sessionAgentId) &&
      Boolean(previousAgentId) &&
      sessionAgentId!.toLocaleLowerCase() !== previousAgentId!.toLocaleLowerCase();
    const face = resolveRosterAssistantFace(state.agentsList?.agents, sessionAgentId);
    if (face) {
      applyRosterFace(state, face);
      return;
    }
    if (switched) {
      state.assistantAgentId = sessionAgentId;
      // Clear placeholder so computer strip can still resolve from participantAgents.
      if (isDefaultAssistantName(state.assistantName)) {
        state.assistantName = "";
        state.assistantAvatar = null;
      }
    }
    // Same-agent errors: keep last known identity.
  }
}

import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import {
  mergeSessionEntryPreserveActivity,
  resolveStorePath,
  updateSessionStore,
} from "../../config/sessions.js";
import { loadCollaborationGroupProfileForRuntime } from "./group-runtime-profile.js";
import {
  refreshBotGroupSessionParticipationOverlay,
  resolveBotSessionParticipationOverlay,
  resolveMembersForParticipationSync,
  syncGroupParticipationsFromMembers,
} from "./participation-sync.js";
import { resolveCollaborationSpaceSessionId } from "./session-id.js";
import { buildSpaceAliasSessionKey, createWorkspaceCollaborationStores } from "./shared.js";

export async function ensureGatewayCollaborationGroupSessions(params: {
  groupId: string;
  title: string;
  activeBotIds: string[];
  resolveAgentStorePath?: (agentId: string) => string;
}) {
  const cfg = loadConfig();
  const now = Date.now();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const aliasStorePath = params.resolveAgentStorePath
    ? params.resolveAgentStorePath(defaultAgentId)
    : resolveStorePath(cfg.session?.store, { agentId: defaultAgentId });
  const aliasSessionKey = buildSpaceAliasSessionKey(params.groupId);
  const { groupStorage, metadataStorage } = createWorkspaceCollaborationStores();
  const groupProfile = await loadCollaborationGroupProfileForRuntime(params.groupId);
  const members = await resolveMembersForParticipationSync({
    groupId: params.groupId,
    groupStorage,
    activeBotIds: params.activeBotIds,
  });
  await syncGroupParticipationsFromMembers({
    groupId: params.groupId,
    members,
    groupStorage,
  });

  await updateSessionStore(
    aliasStorePath,
    (store) => {
      const existing = store[aliasSessionKey];
      store[aliasSessionKey] = mergeSessionEntryPreserveActivity(existing, {
        sessionId: resolveCollaborationSpaceSessionId({
          groupId: params.groupId,
          existingSessionId: existing?.sessionId,
        }),
        displayName: params.title,
        groupId: params.groupId,
        space: params.groupId,
        chatType: "group",
        ...(groupProfile ? { collaborationGroupProfile: groupProfile } : {}),
        updatedAt: now,
      });
      return store[aliasSessionKey];
    },
    { activeSessionKey: aliasSessionKey },
  );

  // One destination store: `space:<groupId>`. Per-bot leftovers are not minted.
  // Overlay metadata stays in group storage; seed the shared row from the first bot.
  const seedBotId = params.activeBotIds.map((id) => id.trim()).find(Boolean);
  if (!seedBotId) {
    return;
  }
  const overlay =
    (await resolveBotSessionParticipationOverlay({
      groupId: params.groupId,
      botId: seedBotId,
      groupStorage,
      metadataStorage,
    })) ??
    ({
      participationId: `${params.groupId}::${seedBotId}`,
      groupId: params.groupId,
      botId: seedBotId,
      updatedAt: now,
    } as const);

  await refreshBotGroupSessionParticipationOverlay({
    groupId: params.groupId,
    botId: seedBotId,
    title: params.title,
    overlay,
    groupProfile,
    resolveAgentStorePath: params.resolveAgentStorePath,
  });
}

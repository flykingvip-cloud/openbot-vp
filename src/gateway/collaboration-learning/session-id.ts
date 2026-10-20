import { createHash } from "node:crypto";
import { isValidSessionId } from "../../config/sessions/paths.js";

const COLLABORATION_SPACE_SESSION_ID_PREFIX = "space-";
const COLLABORATION_BOT_GROUP_SESSION_ID_PREFIX = "group-";

function hashCollaborationGroupId(groupId: string): string {
  return createHash("sha256").update(groupId.trim(), "utf8").digest("hex").slice(0, 32);
}

export function buildCollaborationSpaceSessionId(groupId: string): string {
  return `${COLLABORATION_SPACE_SESSION_ID_PREFIX}${hashCollaborationGroupId(groupId)}`;
}

export function buildCollaborationBotGroupSessionId(botId: string, groupId: string): string {
  const normalizedBotId = botId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  const safeBotId = normalizedBotId || "bot";
  return `${COLLABORATION_BOT_GROUP_SESSION_ID_PREFIX}${safeBotId}-${hashCollaborationGroupId(groupId)}`;
}

export function resolveCollaborationSpaceSessionId(params: {
  groupId: string;
  existingSessionId?: string | null;
}): string {
  const existing = params.existingSessionId?.trim();
  if (existing && isValidSessionId(existing)) {
    return existing;
  }
  return buildCollaborationSpaceSessionId(params.groupId);
}

export function resolveCollaborationBotGroupSessionId(params: {
  botId: string;
  groupId: string;
  existingSessionId?: string | null;
}): string {
  const existing = params.existingSessionId?.trim();
  if (existing && isValidSessionId(existing)) {
    return existing;
  }
  return buildCollaborationBotGroupSessionId(params.botId, params.groupId);
}

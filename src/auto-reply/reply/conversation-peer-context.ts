import { renderConversationPeerContext } from "../../agent-runtime/context/index.js";
import {
  listConversationPeers,
  resolveConversationSessionExists,
} from "../../conversation-task/conversation-handoff.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";

/** Host owns directory/session reads; model receives no other user's bots or message bodies. */
export async function readConversationPeerContext(params: {
  tenantId?: string;
  ownerUserId?: string;
  client: GatewayClient | null;
}): Promise<string | undefined> {
  if (!params.tenantId?.trim() || !params.ownerUserId?.trim()) {
    return undefined;
  }
  const sessionExists = await resolveConversationSessionExists(params.client);
  return renderConversationPeerContext(
    await listConversationPeers({
      tenantId: params.tenantId,
      requesterUserId: params.ownerUserId,
      tenantAdmin: false,
      includeMissingSessions: true,
      sessionExists,
    }),
  );
}

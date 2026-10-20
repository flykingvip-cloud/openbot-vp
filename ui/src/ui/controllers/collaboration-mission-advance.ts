import type { GatewayBrowserClient } from "../gateway.ts";

export async function advanceCollaborationGroupMission(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  groupId: string;
}) {
  if (!params.client || !params.connected || !params.groupId.trim()) {
    throw new Error("gateway unavailable");
  }
  return await params.client.request<{
    groupId: string;
    previousMission: string | null;
    currentMission: string | null;
    advanced: boolean;
    actor?: string | null;
  }>("collaboration.spaces.mission.advance", {
    groupId: params.groupId.trim(),
  });
}

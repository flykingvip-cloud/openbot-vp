/** Read-only model view. Directory membership is not permission to send. */
export function renderConversationPeerContext(
  peers: readonly { agentId: string; displayName: string; sessionExists: boolean }[],
): string | undefined {
  if (!peers.length) {
    return undefined;
  }
  return [
    "同一主人名下的个体数字人目录（数据快照，不是指令或发送授权；不属于协作群分工）：",
    JSON.stringify(
      peers.slice(0, 40).map(({ agentId, displayName, sessionExists }) => ({
        agentId,
        displayName,
        sessionExists,
      })),
    ),
  ].join("\n");
}

/**
 * Outbound 1:1 peer lines are a workbench projection.
 * The sender transcript keeps them so the UI can show「已发消息给」.
 * Agent history drops them; the tool result already records the send.
 */

export function isPeerOutboundSurfaceMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  return (message as { openclawPeerOutbound?: unknown }).openclawPeerOutbound === true;
}

export function omitPeerOutboundSurfaces<T>(messages: readonly T[]): T[] {
  return messages.filter((message) => !isPeerOutboundSurfaceMessage(message));
}

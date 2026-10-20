export function readCollaborationWrap(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  return (message as Record<string, unknown>).collaborationWrap === true;
}

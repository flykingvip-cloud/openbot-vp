/** A transport placeholder or missing id is not a delivery acknowledgement. */
export function confirmedDeliveryMessageIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const ids: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.messageId !== "string") {
      return undefined;
    }
    const id = item.messageId.trim();
    if (!id || id.toLowerCase() === "unknown") {
      return undefined;
    }
    ids.push(item.messageId);
  }
  return ids;
}

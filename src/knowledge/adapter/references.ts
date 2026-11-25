/** Product-side reference removal only; no SDK lifecycle operation is available here. */
export function detachKnowledgeReference<T extends { spaceId: string; assetId: string }>(
  references: readonly T[],
  spaceId: string,
  assetId: string,
): T[] {
  return references.filter(
    (reference) => reference.spaceId !== spaceId || reference.assetId !== assetId,
  );
}

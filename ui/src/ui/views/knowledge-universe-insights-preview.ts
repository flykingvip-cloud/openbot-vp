import type { RelationshipEdge } from "../capability/knowledge-universe/types.ts";

/** Conflicts surface first in home insight previews (design §11). */
export function prioritizeRelationshipEdgesForPreview(
  edges: RelationshipEdge[],
  limit = 4,
): RelationshipEdge[] {
  return [...edges]
    .toSorted((left, right) => {
      const leftConflict = left.relationType === "conflicts" ? 1 : 0;
      const rightConflict = right.relationType === "conflicts" ? 1 : 0;
      if (rightConflict !== leftConflict) {
        return rightConflict - leftConflict;
      }
      const leftScore = left.score ?? 0;
      const rightScore = right.score ?? 0;
      return rightScore - leftScore;
    })
    .slice(0, limit);
}

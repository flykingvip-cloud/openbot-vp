import type { KnowledgeObject } from "./types.js";

/**
 * Terms that identify a materialized enterprise-data question (用友 T+ warehouse,
 * inventory, and the sibling read models). Kept in one list so chat routing and
 * knowledge matching stay on the same vocabulary.
 */
export const ENTERPRISE_DATA_QUERY_TERMS = [
  "用友",
  "畅捷通",
  "chanjet",
  "yonyou",
  "erp-yonyou",
  "数据产品",
  "t+",
  "仓库",
  "存货",
  "库存",
  "往来单位",
  "销货单",
  "销售订单",
] as const;

export function textMentionsEnterpriseData(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ENTERPRISE_DATA_QUERY_TERMS.some((term) => normalized.includes(term));
}

function knowledgeObjectHaystack(
  object: Pick<KnowledgeObject, "title" | "summary" | "tags" | "source" | "kind">,
): string {
  return [object.title, object.summary, object.tags.join(" "), object.source, object.kind]
    .join(" ")
    .toLowerCase();
}

/**
 * Full-string match, plus enterprise-data term overlap.
 * "查一下用友T+仓库" is not a substring of "001-用友T+仓库", but both share 用友 / 仓库.
 */
export function knowledgeObjectMatchesQuery(
  object: Pick<KnowledgeObject, "title" | "summary" | "tags" | "source" | "kind">,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = knowledgeObjectHaystack(object);
  if (haystack.includes(normalized)) {
    return true;
  }
  return ENTERPRISE_DATA_QUERY_TERMS.some(
    (term) => normalized.includes(term) && haystack.includes(term),
  );
}

/** When the question is enterprise data, surface feed objects ahead of unrelated docs. */
export function preferEnterpriseFeedMatches<T extends { source: string }>(
  objects: readonly T[],
  query: string,
): T[] {
  if (!textMentionsEnterpriseData(query)) {
    return [...objects];
  }
  return objects
    .map((item, index) => ({ item, index }))
    .toSorted((left, right) => {
      const rank = (item: T) => (item.source === "enterprise" ? 0 : 1);
      const delta = rank(left.item) - rank(right.item);
      return delta === 0 ? left.index - right.index : delta;
    })
    .map((entry) => entry.item);
}

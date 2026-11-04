import { listEnterpriseKnowledgeProjectionBindings } from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "../../enterprise-data/knowledge-feed-item-store.js";
import { listKnowledgeLineageRecords } from "../../enterprise-data/knowledge-lineage-store.js";
import type {
  EnterpriseDataStore,
  EnterpriseKnowledgeObjectFeedItem,
  EnterpriseKnowledgeProjectionBinding,
  EnterpriseKnowledgeProjectionSpec,
} from "../../enterprise-data/types.js";
import { applyKnowledgeCompliance } from "../governance/compliance.js";
import type { KnowledgeSourceContext } from "../sources/types.js";
import type { KnowledgeObject, KnowledgeObjectKind } from "../types.js";
import type { KnowledgeFeedItem } from "./types.js";
import { evaluateProjectionVisibility, visibilityScopeLabel } from "./visibility-policy-mapping.js";

const FEED_PAYLOAD_EXCERPT_MAX = 1600;
const FEED_ITEMS_PREVIEW_MAX = 20;
/** Exact fail_closed_redact placeholder — drop from DH excerpts so plaintext Code/Name survive. */
const MASKED_SCALAR = "***";
const SENSITIVE_PAYLOAD_KEY_RE =
  /token|secret|password|passwd|appkey|appsecret|credential|opentoken|authorization/i;
/**
 * Prefer these leaf keys when an items[] row is still too wide after dropping "***".
 * Includes #244 T+ analytics leaves (costs, tax amounts, stock qtys). Nested containers
 * (Customer / SaleDeliveryDetails / …) are kept via recurse-if-children, not this regex.
 */
const BUSINESS_ITEM_KEY_RE =
  /^(id|code|name|voucherdate|specification|unitname|partnertype|warehousename|warehousecode|inventoryname|inventorycode|quantity|availablequantity|existingquantity|amount|total|origtaxamount|origtaxprice|invscost|latestcost|avagcost|retailpricenew)$/i;

function redactFeedPayload(value: unknown, depth: number): unknown {
  // Allow items[] → row → *Details → Inventory → leaf (AggregateTemplate +2 vs flat).
  if (depth > 6) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.slice(0, FEED_ITEMS_PREVIEW_MAX).map((item) => redactFeedPayload(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_PAYLOAD_KEY_RE.test(key) || key === "query") {
      continue;
    }
    const next = redactFeedPayload(child, depth + 1);
    if (next !== undefined) {
      out[key] = next;
    }
  }
  return out;
}

function dropMaskedScalars(value: unknown, depth: number): unknown {
  if (depth > 6) {
    return undefined;
  }
  if (value === MASKED_SCALAR) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, FEED_ITEMS_PREVIEW_MAX)
      .map((item) => dropMaskedScalars(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = dropMaskedScalars(child, depth + 1);
    if (next === undefined) {
      continue;
    }
    if (
      next &&
      typeof next === "object" &&
      !Array.isArray(next) &&
      Object.keys(next as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    out[key] = next;
  }
  return out;
}

function projectBusinessItemKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(row)) {
    // Keep nested business objects (Customer / SaleDeliveryDetails / Inventory / …)
    // whenever their projected children are non-empty — do not require the container
    // key itself to match BUSINESS_ITEM_KEY_RE (that was dropping Customer.Name etc.).
    if (Array.isArray(child)) {
      const mapped = child
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return undefined;
          }
          const nested = projectBusinessItemKeys(item as Record<string, unknown>);
          return Object.keys(nested).length > 0 ? nested : undefined;
        })
        .filter((item): item is Record<string, unknown> => item !== undefined);
      if (mapped.length > 0) {
        out[key] = mapped;
      }
      continue;
    }
    if (child && typeof child === "object") {
      const nested = projectBusinessItemKeys(child as Record<string, unknown>);
      if (Object.keys(nested).length > 0) {
        out[key] = nested;
      }
      continue;
    }
    if (!BUSINESS_ITEM_KEY_RE.test(key)) {
      continue;
    }
    out[key] = child;
  }
  return Object.keys(out).length > 0 ? out : row;
}

/** Compact AggregateTemplate `{count,items}` so many "***" fail_closed keys do not starve Name/Code. */
function compactFeedPreview(record: Record<string, unknown>): Record<string, unknown> {
  const dropped = dropMaskedScalars(record, 0);
  if (!dropped || typeof dropped !== "object" || Array.isArray(dropped)) {
    return record;
  }
  const preview = { ...(dropped as Record<string, unknown>) };
  let text = JSON.stringify(preview);
  if (text.length <= FEED_PAYLOAD_EXCERPT_MAX) {
    return preview;
  }
  if (Array.isArray(preview.items)) {
    preview.items = preview.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return item;
      }
      return projectBusinessItemKeys(item as Record<string, unknown>);
    });
  }
  text = JSON.stringify(preview);
  if (text.length <= FEED_PAYLOAD_EXCERPT_MAX) {
    return preview;
  }
  // Last resort: shrink items[] until under budget while keeping as many leading rows as fit.
  if (Array.isArray(preview.items) && preview.items.length > 1) {
    const items = [...preview.items];
    while (items.length > 1) {
      items.pop();
      const candidate = { ...preview, count: preview.count ?? items.length, items };
      if (JSON.stringify(candidate).length <= FEED_PAYLOAD_EXCERPT_MAX) {
        return candidate;
      }
    }
    return { ...preview, count: preview.count ?? 1, items };
  }
  return preview;
}

/** Bounded row excerpt for accessible feed objects. Restricted seats get none. */
export function feedPayloadExcerpt(payload: Record<string, unknown>): string {
  const redacted = redactFeedPayload(payload, 0);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    return "";
  }
  const record = { ...(redacted as Record<string, unknown>) };
  delete record.summary;
  delete record.publicationNotice;
  if (Object.keys(record).length === 0) {
    return "";
  }
  const compacted = compactFeedPreview(record);
  const text = JSON.stringify(compacted);
  if (!text || text === "{}") {
    return "";
  }
  return text.length > FEED_PAYLOAD_EXCERPT_MAX
    ? `${text.slice(0, FEED_PAYLOAD_EXCERPT_MAX)}…`
    : text;
}

function mapProjectionKind(
  kind: EnterpriseKnowledgeProjectionSpec["objectKind"],
): KnowledgeObjectKind {
  if (kind === "insight") {
    return "insight";
  }
  if (kind === "metric") {
    return "metric";
  }
  return "document";
}

function findBindingForProjection(
  bindings: EnterpriseKnowledgeProjectionBinding[],
  projectionId: string,
): EnterpriseKnowledgeProjectionBinding | null {
  return bindings.find((entry) => entry.projectionId === projectionId && entry.enabled) ?? null;
}

export function feedRecordObjectId(feedObjectId: string): string {
  return `obj:enterprise:feed:${feedObjectId}`;
}

export function resolveLineageIdForFeedRecord(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  feedObjectId: string;
}): string | undefined {
  const record = listKnowledgeLineageRecords({
    store: params.store,
    tenantId: params.tenantId,
    objectId: params.feedObjectId,
  })[0];
  return record?.lineageId;
}

export function adaptEnterpriseFeedRecord(params: {
  item: EnterpriseKnowledgeObjectFeedItem;
  binding: EnterpriseKnowledgeProjectionBinding | null;
  accessState: "accessible" | "restricted";
  lineageId?: string;
}): KnowledgeFeedItem {
  const scopeLabel = visibilityScopeLabel({
    scopeApplied: params.item.scopeApplied,
    visibilityPolicyId: params.binding?.visibilityPolicyId,
    accessState: params.accessState,
  });
  const partialNotice =
    params.item.publication === "partial" ? "不完整输出，不是完整知识对象" : undefined;
  const narrative =
    typeof params.item.payload.summary === "string"
      ? params.item.payload.summary
      : params.item.category;
  const excerpt =
    params.accessState === "accessible" ? feedPayloadExcerpt(params.item.payload) : "";
  const baseSummary = excerpt ? `${narrative} ${excerpt}` : narrative;
  const maskingSummary =
    params.accessState === "restricted"
      ? "需申请访问权限后查看完整内容"
      : partialNotice
        ? partialNotice
        : params.item.maskedFields.length > 0
          ? `已脱敏字段：${params.item.maskedFields.length} 项`
          : "企业知识按可见性与脱敏策略展示";
  return {
    objectId: feedRecordObjectId(params.item.objectId),
    source: "enterprise",
    title: params.item.title,
    kind: mapProjectionKind(params.item.kind),
    summary: partialNotice ? `${partialNotice}。${baseSummary}` : baseSummary,
    category: params.item.category,
    sourceSystems: params.item.sourceSystems,
    scopeLabel,
    maskingSummary,
    projectionId: params.item.projectionId,
    visibilityPolicyId: params.binding?.visibilityPolicyId,
    lineageId: params.lineageId,
    traceRefs: params.item.traceRefs,
    freshnessStatus: params.item.freshnessStatus,
    ...(params.item.publication ? { publication: params.item.publication } : {}),
    accessState: params.accessState,
    generatedAt: Date.parse(params.item.generatedAt) || Date.now(),
  };
}

export function knowledgeObjectFromFeedItem(feedItem: KnowledgeFeedItem): KnowledgeObject {
  const capabilityLink = feedItem.capabilityId ? [`obj:data:${feedItem.capabilityId}`] : undefined;
  const object: KnowledgeObject = {
    id: feedItem.objectId,
    title: feedItem.title,
    source: "enterprise",
    kind: feedItem.kind,
    summary: feedItem.summary,
    tags: [feedItem.category, ...feedItem.sourceSystems],
    updatedAt: feedItem.generatedAt,
    sourceSystem: feedItem.sourceSystems.join(" / ") || "企业知识",
    scopeLabel: feedItem.scopeLabel,
    maskingSummary: feedItem.maskingSummary,
    accessState: feedItem.accessState,
    projectionId: feedItem.projectionId,
    lineageId: feedItem.lineageId,
    traceRefs: feedItem.traceRefs,
    freshnessStatus: feedItem.freshnessStatus,
    ...(feedItem.publication ? { publication: feedItem.publication } : {}),
    relationshipSummary: {
      relatedCount: feedItem.traceRefs?.length ?? capabilityLink?.length ?? 0,
      conflictCount: 0,
      supportingCount: feedItem.accessState === "accessible" ? 1 : 0,
    },
    relatedObjectIds: capabilityLink,
  };
  return applyKnowledgeCompliance(object, {
    sourceSystem: object.sourceSystem,
    scopeLabel: feedItem.scopeLabel,
    maskingSummary: feedItem.maskingSummary,
    lineageId: feedItem.lineageId,
    traceRefs: feedItem.traceRefs,
    accessState: feedItem.accessState,
  });
}

export function loadEnterpriseKnowledgeFeed(params: {
  store: EnterpriseDataStore;
  context: KnowledgeSourceContext;
}): {
  feedItems: KnowledgeFeedItem[];
  accessible: KnowledgeObject[];
  restricted: KnowledgeObject[];
} {
  if (!params.context.tenantId) {
    return { feedItems: [], accessible: [], restricted: [] };
  }
  const tenantId = params.context.tenantId;
  const bindings = listEnterpriseKnowledgeProjectionBindings({
    store: params.store,
    tenantId,
    enabled: true,
  });
  const feedRecords = listKnowledgeFeedItems({ store: params.store, tenantId });

  const feedItems: KnowledgeFeedItem[] = [];
  const accessible: KnowledgeObject[] = [];
  const restricted: KnowledgeObject[] = [];

  for (const record of feedRecords) {
    const binding = findBindingForProjection(bindings, record.projectionId);
    const visibility = evaluateProjectionVisibility({
      store: params.store,
      tenantId,
      projectionId: record.projectionId,
      visibilityPolicyId: binding?.visibilityPolicyId,
      context: params.context,
    });
    const feedItem = adaptEnterpriseFeedRecord({
      item: record,
      binding,
      accessState: visibility.accessState,
      lineageId: resolveLineageIdForFeedRecord({
        store: params.store,
        tenantId,
        feedObjectId: record.objectId,
      }),
    });
    feedItems.push(feedItem);
    const object = knowledgeObjectFromFeedItem(feedItem);
    if (visibility.visible) {
      accessible.push(object);
    } else {
      restricted.push(object);
    }
  }

  const feedIds = new Set(accessible.map((item) => item.id));
  const mergedAccessible = accessible.filter(
    (item, index, array) => array.findIndex((entry) => entry.id === item.id) === index,
  );
  return {
    feedItems,
    accessible: mergedAccessible,
    restricted: restricted.filter((item) => !feedIds.has(item.id)),
  };
}

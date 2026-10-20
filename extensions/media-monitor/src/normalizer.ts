import { createHash } from "node:crypto";
import { buildDedupeKey } from "./contract.js";
import { newId, nowIso } from "./monitor-store.js";
import { sanitizePayloadForStorage } from "./redact.js";
import type {
  AdapterCommentItem,
  AdapterContentItem,
  AdapterSuccessEnvelope,
  MonitorEvent,
  MonitorEventType,
  MonitorTarget,
} from "./types.js";

export function hashContent(parts: Array<string | undefined>): string {
  const h = createHash("sha256");
  h.update(parts.filter(Boolean).join("\n"));
  return h.digest("hex").slice(0, 32);
}

export function buildNotificationBody(params: {
  eventType: MonitorEventType;
  target: MonitorTarget;
  title?: string;
  summary?: string;
  contentUrl?: string;
  publishedAt?: string;
  observedAt: string;
}): string {
  const platformLabel = params.target.platform === "xhs" ? "小红书" : params.target.platform;
  const headline =
    params.eventType === "content.created"
      ? `[监测] ${platformLabel}账号发布新内容`
      : params.eventType === "comment.created"
        ? `[监测] ${platformLabel}内容出现新评论`
        : params.eventType === "monitor.reauth_required"
          ? `[监测] ${platformLabel}需要重新认证`
          : params.eventType === "monitor.rate_limited"
            ? `[监测] ${platformLabel}触发限流`
            : `[监测] ${platformLabel}任务失败`;

  const lines = [headline, "", `账号：${params.target.displayName || params.target.accountId}`];
  if (params.title) {
    lines.push(`标题：${params.title}`);
  }
  if (params.summary) {
    lines.push(`摘要：${params.summary.slice(0, 280)}`);
  }
  if (params.publishedAt) {
    lines.push(`发布时间：${params.publishedAt}`);
  }
  if (params.contentUrl) {
    lines.push(`原文链接：${params.contentUrl}`);
  }
  lines.push(`采集时间：${params.observedAt}`);
  return lines.join("\n");
}

export function contentItemToEvent(params: {
  target: MonitorTarget;
  item: AdapterContentItem;
  observedAt?: string;
}): MonitorEvent {
  const observedAt = params.observedAt ?? nowIso();
  const contentHash =
    params.item.content_hash ??
    hashContent([params.item.platform_id, params.item.title, params.item.text, params.item.url]);
  const eventType: MonitorEventType = "content.created";
  return {
    id: newId("evt"),
    targetId: params.target.id,
    tenantId: params.target.tenantId,
    agentId: params.target.agentId,
    platform: params.target.platform,
    eventType,
    platformObjectId: params.item.platform_id,
    contentUrl: params.item.url,
    publishedAt: params.item.published_at,
    observedAt,
    contentHash,
    payloadJson: sanitizePayloadForStorage({
      title: params.item.title,
      text: params.item.text,
      url: params.item.url,
    }),
    dedupeKey: buildDedupeKey({
      platform: params.target.platform,
      targetId: params.target.id,
      eventType,
      platformObjectId: params.item.platform_id,
    }),
    analysisState: "none",
    createdAt: observedAt,
  };
}

export function commentItemToEvent(params: {
  target: MonitorTarget;
  item: AdapterCommentItem;
  observedAt?: string;
}): MonitorEvent {
  const observedAt = params.observedAt ?? nowIso();
  const eventType: MonitorEventType = "comment.created";
  // Comment IDs are scoped by content: target + content + comment
  const scopedObjectId = `${params.item.parent_platform_id}:${params.item.platform_id}`;
  const contentHash =
    params.item.content_hash ??
    hashContent([
      params.item.parent_platform_id,
      params.item.platform_id,
      params.item.text,
      params.item.author_name,
    ]);
  return {
    id: newId("evt"),
    targetId: params.target.id,
    tenantId: params.target.tenantId,
    agentId: params.target.agentId,
    platform: params.target.platform,
    eventType,
    platformObjectId: scopedObjectId,
    parentObjectId: params.item.parent_platform_id,
    contentUrl: params.item.url,
    publishedAt: params.item.published_at,
    observedAt,
    contentHash,
    payloadJson: sanitizePayloadForStorage({
      text: params.item.text,
      author_name: params.item.author_name,
      url: params.item.url,
      comment_platform_id: params.item.platform_id,
      content_platform_id: params.item.parent_platform_id,
    }),
    dedupeKey: buildDedupeKey({
      platform: params.target.platform,
      targetId: params.target.id,
      eventType,
      platformObjectId: scopedObjectId,
    }),
    analysisState: "none",
    createdAt: observedAt,
  };
}

export function healthEvent(params: {
  target: MonitorTarget;
  eventType: Extract<
    MonitorEventType,
    "monitor.failed" | "monitor.reauth_required" | "monitor.rate_limited"
  >;
  message: string;
  providerCode?: string;
  observedAt?: string;
}): MonitorEvent {
  const observedAt = params.observedAt ?? nowIso();
  const platformObjectId = `${params.eventType}:${observedAt}`;
  return {
    id: newId("evt"),
    targetId: params.target.id,
    tenantId: params.target.tenantId,
    agentId: params.target.agentId,
    platform: params.target.platform,
    eventType: params.eventType,
    platformObjectId,
    observedAt,
    payloadJson: sanitizePayloadForStorage({
      message: params.message,
      provider_code: params.providerCode,
    }),
    dedupeKey: buildDedupeKey({
      platform: params.target.platform,
      targetId: params.target.id,
      eventType: params.eventType,
      platformObjectId,
    }),
    analysisState: "none",
    createdAt: observedAt,
  };
}

export function summarizeSuccessItems(envelope: AdapterSuccessEnvelope): {
  contents: AdapterContentItem[];
  comments: AdapterCommentItem[];
} {
  const contents: AdapterContentItem[] = [];
  const comments: AdapterCommentItem[] = [];
  for (const item of envelope.items) {
    if (item.type === "content") {
      contents.push(item);
    } else if (item.type === "comment") {
      comments.push(item);
    }
  }
  return { contents, comments };
}

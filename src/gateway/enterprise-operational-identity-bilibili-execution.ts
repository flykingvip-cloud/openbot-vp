import {
  addBilibiliArticle,
  publishBilibiliVideoFromSource,
  resolveBilibiliOpenClientConfig,
} from "./enterprise-operational-identity-bilibili-api.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { maybeRefreshOperationalIdentityCredential } from "./enterprise-operational-identity-providers/credential-refresh.js";

export type EnterpriseOperationalIdentityBilibiliPayload = {
  title?: string;
  content?: string;
  body?: string;
  summary?: string;
  tags?: string;
  tag?: string;
  bannerUrl?: string;
  category?: number;
  imageUrls?: string;
  original?: number;
  tid?: number;
  videoUrl?: string;
  videoBase64?: string;
  videoFilename?: string;
  videoContentType?: string;
  coverUrl?: string;
  coverBase64?: string;
  coverFilename?: string;
  coverContentType?: string;
  desc?: string;
  copyright?: number;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function parseEnterpriseOperationalIdentityBilibiliPayload(
  value: unknown,
): EnterpriseOperationalIdentityBilibiliPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    title: stringValue(record.title) || undefined,
    content: stringValue(record.content) || stringValue(record.body) || undefined,
    body: stringValue(record.body) || undefined,
    summary: stringValue(record.summary) || undefined,
    tags: stringValue(record.tags) || stringValue(record.tag) || undefined,
    tag: stringValue(record.tag) || undefined,
    bannerUrl: stringValue(record.bannerUrl) || stringValue(record.banner_url) || undefined,
    category: numberValue(record.category),
    imageUrls: stringValue(record.imageUrls) || stringValue(record.image_urls) || undefined,
    original: numberValue(record.original),
    tid: numberValue(record.tid),
    videoUrl: stringValue(record.videoUrl) || stringValue(record.video_url) || undefined,
    videoBase64: stringValue(record.videoBase64) || stringValue(record.video_base64) || undefined,
    videoFilename:
      stringValue(record.videoFilename) || stringValue(record.video_filename) || undefined,
    videoContentType:
      stringValue(record.videoContentType) || stringValue(record.video_content_type) || undefined,
    coverUrl: stringValue(record.coverUrl) || stringValue(record.cover_url) || undefined,
    coverBase64: stringValue(record.coverBase64) || stringValue(record.cover_base64) || undefined,
    coverFilename:
      stringValue(record.coverFilename) || stringValue(record.cover_filename) || undefined,
    coverContentType:
      stringValue(record.coverContentType) || stringValue(record.cover_content_type) || undefined,
    desc: stringValue(record.desc) || stringValue(record.description) || undefined,
    copyright: numberValue(record.copyright),
  };
}

async function resolveBilibiliAccess(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  credentialBindingId: string;
}): Promise<{ accessToken: string; clientId: string }> {
  const client = resolveBilibiliOpenClientConfig();
  if (!client) {
    throw new Error(
      "Bilibili OAuth client 未配置（OPENBOT_USER_OPERATIONAL_IDENTITY_BILIBILI_*）。",
    );
  }
  const nowIso = new Date().toISOString();
  const refreshed = await maybeRefreshOperationalIdentityCredential({
    provider: "bilibili",
    credentialBindingId: params.credentialBindingId,
    secret: params.secret,
    nowIso,
  });
  const secret = refreshed ?? params.secret;
  const accessToken = secret.accessToken?.trim();
  if (!accessToken) {
    throw new Error("缺少 OAuth access_token；请重新授权哔哩哔哩账号。");
  }
  return { accessToken, clientId: client.clientId };
}

export async function executeBilibiliOperationalAction(params: {
  action: string;
  payload: EnterpriseOperationalIdentityBilibiliPayload;
  secret: EnterpriseOperationalIdentityCredentialSecret;
  credentialBindingId: string;
}): Promise<Record<string, unknown>> {
  const { accessToken, clientId } = await resolveBilibiliAccess({
    secret: params.secret,
    credentialBindingId: params.credentialBindingId,
  });

  if (params.action === "publish_article") {
    const title = stringValue(params.payload.title);
    const content = stringValue(params.payload.content) || stringValue(params.payload.body);
    if (!title || !content) {
      throw new Error("publish_article 需要 title 与 content（或 body）。");
    }
    const result = await addBilibiliArticle({
      accessToken,
      clientId,
      title,
      content,
      summary: params.payload.summary,
      tags: params.payload.tags,
      bannerUrl: params.payload.bannerUrl,
      category: params.payload.category,
      imageUrls: params.payload.imageUrls,
      original: params.payload.original,
    });
    return {
      articleId: result.articleId ?? null,
      title,
      status: "article_submitted",
    };
  }

  if (params.action === "publish_video") {
    const title = stringValue(params.payload.title);
    const tid = params.payload.tid;
    const tag = stringValue(params.payload.tags) || stringValue(params.payload.tag);
    if (!title) {
      throw new Error("publish_video 需要 title。");
    }
    if (tid == null) {
      throw new Error("publish_video 需要 tid（二级分区 id，可通过分区查询接口获取）。");
    }
    if (!tag) {
      throw new Error("publish_video 需要 tag/tags。");
    }
    const videoUrl = stringValue(params.payload.videoUrl);
    const videoBase64 = stringValue(params.payload.videoBase64);
    if (!videoUrl && !videoBase64) {
      throw new Error("publish_video 需要 videoUrl 或 videoBase64。");
    }

    const published = await publishBilibiliVideoFromSource({
      accessToken,
      clientId,
      title,
      tid,
      tag,
      videoUrl: videoUrl || undefined,
      videoBase64: videoBase64 || undefined,
      videoFilename: params.payload.videoFilename,
      videoContentType: params.payload.videoContentType,
      coverUrl: params.payload.coverUrl,
      coverBase64: params.payload.coverBase64,
      coverFilename: params.payload.coverFilename,
      coverContentType: params.payload.coverContentType,
      desc: params.payload.desc,
      copyright: params.payload.copyright,
    });

    return {
      resourceId: published.resourceId ?? null,
      uploadToken: published.uploadToken,
      coverUrl: published.coverUrl,
      videoBytes: published.videoBytes,
      videoFilename: published.videoFilename,
      title,
      tid,
      tag,
      status: "video_submitted",
    };
  }

  throw new Error(`哔哩哔哩不支持动作：${params.action}`);
}

import {
  createDouyinVideo,
  uploadDouyinVideo,
} from "./enterprise-operational-identity-douyin-api.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { maybeRefreshOperationalIdentityCredential } from "./enterprise-operational-identity-providers/credential-refresh.js";

export type EnterpriseOperationalIdentityDouyinPayload = {
  text?: string;
  title?: string;
  message?: string;
  body?: string;
  videoId?: string;
  videoUrl?: string;
  videoBase64?: string;
  videoFilename?: string;
  videoContentType?: string;
  privateStatus?: number;
  coverTsp?: number;
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

export function parseEnterpriseOperationalIdentityDouyinPayload(
  value: unknown,
): EnterpriseOperationalIdentityDouyinPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    text: stringValue(record.text) || undefined,
    title: stringValue(record.title) || undefined,
    message: stringValue(record.message) || undefined,
    body: stringValue(record.body) || undefined,
    videoId: stringValue(record.videoId) || stringValue(record.video_id) || undefined,
    videoUrl: stringValue(record.videoUrl) || stringValue(record.video_url) || undefined,
    videoBase64: stringValue(record.videoBase64) || stringValue(record.video_base64) || undefined,
    videoFilename:
      stringValue(record.videoFilename) || stringValue(record.video_filename) || undefined,
    videoContentType:
      stringValue(record.videoContentType) || stringValue(record.video_content_type) || undefined,
    privateStatus: numberValue(record.privateStatus ?? record.private_status),
    coverTsp: numberValue(record.coverTsp ?? record.cover_tsp),
  };
}

function resolveDouyinText(payload: EnterpriseOperationalIdentityDouyinPayload): string {
  return (
    stringValue(payload.text) ||
    stringValue(payload.title) ||
    stringValue(payload.message) ||
    stringValue(payload.body) ||
    ""
  );
}

async function resolveDouyinAccess(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  credentialBindingId: string;
  externalAccountId?: string;
}): Promise<{ accessToken: string; openId: string }> {
  const nowIso = new Date().toISOString();
  const refreshed = await maybeRefreshOperationalIdentityCredential({
    provider: "douyin",
    credentialBindingId: params.credentialBindingId,
    secret: params.secret,
    externalAccountId: params.externalAccountId,
    nowIso,
  });
  const secret = refreshed ?? params.secret;
  const accessToken = secret.accessToken?.trim();
  const openId =
    params.externalAccountId?.trim() ||
    secret.externalAccountId?.trim() ||
    secret.metadata?.openId?.trim() ||
    "";
  if (!accessToken || !openId) {
    throw new Error("缺少 OAuth access_token 或 open_id；请重新授权抖音账号。");
  }
  return { accessToken, openId };
}

export async function executeDouyinOperationalAction(params: {
  action: string;
  payload: EnterpriseOperationalIdentityDouyinPayload;
  secret: EnterpriseOperationalIdentityCredentialSecret;
  credentialBindingId: string;
  externalAccountId?: string;
}): Promise<Record<string, unknown>> {
  const { accessToken, openId } = await resolveDouyinAccess({
    secret: params.secret,
    credentialBindingId: params.credentialBindingId,
    externalAccountId: params.externalAccountId,
  });

  if (params.action === "publish_video") {
    const text = resolveDouyinText(params.payload);
    let encryptedVideoId = stringValue(params.payload.videoId);
    let uploadMeta: Record<string, unknown> | undefined;

    if (!encryptedVideoId) {
      const videoUrl = stringValue(params.payload.videoUrl);
      const videoBase64 = stringValue(params.payload.videoBase64);
      if (!videoUrl && !videoBase64) {
        throw new Error("publish_video 需要 videoId，或提供 videoUrl / videoBase64 上传视频。");
      }
      const uploaded = await uploadDouyinVideo({
        accessToken,
        openId,
        videoUrl: videoUrl || undefined,
        videoBase64: videoBase64 || undefined,
        videoFilename: params.payload.videoFilename,
        videoContentType: params.payload.videoContentType,
      });
      encryptedVideoId = uploaded.videoId;
      uploadMeta = {
        uploadedVideoId: uploaded.videoId,
        videoBytes: uploaded.videoBytes,
        videoFilename: uploaded.videoFilename,
      };
    }

    const created = await createDouyinVideo({
      accessToken,
      openId,
      videoId: encryptedVideoId,
      text: text || undefined,
      privateStatus: params.payload.privateStatus,
      coverTsp: params.payload.coverTsp,
    });

    return {
      openId,
      encryptedVideoId,
      douyinVideoId: created.videoId ?? null,
      itemId: created.itemId ?? null,
      text: text || null,
      ...uploadMeta,
      status: "video_published",
    };
  }

  throw new Error(`抖音不支持动作：${params.action}`);
}

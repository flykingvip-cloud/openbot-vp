import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { maybeRefreshOperationalIdentityCredential } from "./enterprise-operational-identity-providers/credential-refresh.js";
import {
  postWeiboStatus,
  postWeiboStatusWithPic,
  uploadWeiboPic,
} from "./enterprise-operational-identity-weibo-api.js";

export type EnterpriseOperationalIdentityWeiboPayload = {
  message?: string;
  status?: string;
  body?: string;
  picId?: string;
  picUrl?: string;
  picBase64?: string;
  picFilename?: string;
  picContentType?: string;
  visible?: number;
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

export function parseEnterpriseOperationalIdentityWeiboPayload(
  value: unknown,
): EnterpriseOperationalIdentityWeiboPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    message: stringValue(record.message) || undefined,
    status: stringValue(record.status) || undefined,
    body: stringValue(record.body) || undefined,
    picId: stringValue(record.picId) || stringValue(record.pic_id) || undefined,
    picUrl: stringValue(record.picUrl) || stringValue(record.pic_url) || undefined,
    picBase64: stringValue(record.picBase64) || stringValue(record.pic_base64) || undefined,
    picFilename: stringValue(record.picFilename) || stringValue(record.pic_filename) || undefined,
    picContentType:
      stringValue(record.picContentType) || stringValue(record.pic_content_type) || undefined,
    visible: numberValue(record.visible),
  };
}

function resolveWeiboStatusText(payload: EnterpriseOperationalIdentityWeiboPayload): string {
  return (
    stringValue(payload.message) || stringValue(payload.status) || stringValue(payload.body) || ""
  );
}

async function resolveWeiboAccessToken(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  credentialBindingId: string;
  externalAccountId?: string;
}): Promise<{ accessToken: string; uid?: string }> {
  const nowIso = new Date().toISOString();
  const refreshed = await maybeRefreshOperationalIdentityCredential({
    provider: "weibo",
    credentialBindingId: params.credentialBindingId,
    secret: params.secret,
    externalAccountId: params.externalAccountId,
    nowIso,
  });
  const secret = refreshed ?? params.secret;
  const accessToken = secret.accessToken?.trim();
  if (!accessToken) {
    throw new Error("缺少 OAuth access_token；请重新授权微博账号。");
  }
  const uid =
    params.externalAccountId?.trim() ||
    secret.externalAccountId?.trim() ||
    secret.metadata?.uid?.trim() ||
    undefined;
  return { accessToken, uid };
}

export async function executeWeiboOperationalAction(params: {
  action: string;
  payload: EnterpriseOperationalIdentityWeiboPayload;
  secret: EnterpriseOperationalIdentityCredentialSecret;
  credentialBindingId: string;
  externalAccountId?: string;
}): Promise<Record<string, unknown>> {
  const { accessToken, uid } = await resolveWeiboAccessToken({
    secret: params.secret,
    credentialBindingId: params.credentialBindingId,
    externalAccountId: params.externalAccountId,
  });

  if (params.action === "upload_image") {
    const uploaded = await uploadWeiboPic({
      accessToken,
      picUrl: params.payload.picUrl,
      picBase64: params.payload.picBase64,
      picFilename: params.payload.picFilename,
      picContentType: params.payload.picContentType,
    });
    return {
      uid: uid ?? null,
      picId: uploaded.picId,
      picMd5: uploaded.picMd5 ?? null,
      picBytes: uploaded.picBytes,
      picFilename: uploaded.picFilename,
      status: "pic_uploaded",
    };
  }

  if (params.action === "post_status") {
    const status = resolveWeiboStatusText(params.payload);
    if (!status) {
      throw new Error("post_status 需要 message（或 status / body）。");
    }
    const picId = stringValue(params.payload.picId);
    const picUrl = stringValue(params.payload.picUrl);
    const picBase64 = stringValue(params.payload.picBase64);
    const visible = params.payload.visible;

    let posted: Awaited<ReturnType<typeof postWeiboStatus>>;
    let picUploaded: Record<string, unknown> | undefined;

    if (picUrl || picBase64) {
      posted = await postWeiboStatusWithPic({
        accessToken,
        status,
        picUrl: picUrl || undefined,
        picBase64: picBase64 || undefined,
        picFilename: params.payload.picFilename,
        picContentType: params.payload.picContentType,
        visible,
      });
    } else {
      posted = await postWeiboStatus({
        accessToken,
        status,
        picId: picId || undefined,
        visible,
      });
      if (picId) {
        picUploaded = { picId };
      }
    }

    return {
      uid: uid ?? null,
      weiboId: posted.idstr ?? (posted.id != null ? String(posted.id) : null),
      mid: posted.mid ?? null,
      createdAt: posted.createdAt ?? null,
      ...picUploaded,
      status: "posted",
    };
  }

  throw new Error(`微博不支持动作：${params.action}`);
}

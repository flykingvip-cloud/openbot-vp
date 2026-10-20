import { randomUUID } from "node:crypto";
import {
  recordOperationalIdentityUsage,
  recordOperationalIdentityUsageDenied,
  type OperationalIdentityAccessDecisionMeta,
} from "./enterprise-operational-identity-access.js";
import {
  executeBilibiliOperationalAction,
  parseEnterpriseOperationalIdentityBilibiliPayload,
} from "./enterprise-operational-identity-bilibili-execution.js";
import {
  executeDouyinOperationalAction,
  parseEnterpriseOperationalIdentityDouyinPayload,
} from "./enterprise-operational-identity-douyin-execution.js";
import {
  parseEnterpriseOperationalIdentityImapPayload,
  readEnterpriseOperationalIdentityEmails,
  replyEnterpriseOperationalIdentityEmail,
  searchEnterpriseOperationalIdentityEmails,
} from "./enterprise-operational-identity-imap-read.js";
import { loadEnterpriseOperationalIdentityCredentialSecretStore } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { sendEnterpriseOperationalIdentityEmail } from "./enterprise-operational-identity-smtp-send.js";
import {
  executeTencentMeetingOperationalAction,
  parseEnterpriseOperationalIdentityTencentMeetingPayload,
} from "./enterprise-operational-identity-tencent-meeting-execution.js";
import type { EnterpriseIdentity } from "./enterprise-operational-identity-types.js";
import {
  executeWechatOfficialOperationalAction,
  parseEnterpriseOperationalIdentityWechatPayload,
} from "./enterprise-operational-identity-wechat-official-execution.js";
import {
  executeWeiboOperationalAction,
  parseEnterpriseOperationalIdentityWeiboPayload,
} from "./enterprise-operational-identity-weibo-execution.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";

export type EnterpriseOperationalIdentityExecutionPayload = {
  to?: string;
  subject?: string;
  message?: string;
  body?: string;
  html?: string;
  mailbox?: string;
  uid?: number;
  limit?: number;
  query?: string;
  unseen?: boolean;
  includeBody?: boolean;
  title?: string;
  content?: string;
  author?: string;
  digest?: string;
  thumbMediaId?: string;
  thumbUrl?: string;
  thumbBase64?: string;
  thumbFilename?: string;
  thumbContentType?: string;
  mediaId?: string;
  publishId?: string;
  sendToAll?: boolean;
  tagId?: number;
  picId?: string;
  picUrl?: string;
  picBase64?: string;
  picFilename?: string;
  picContentType?: string;
  visible?: number;
  text?: string;
  videoId?: string;
  videoUrl?: string;
  videoBase64?: string;
  videoFilename?: string;
  videoContentType?: string;
  privateStatus?: number;
  coverTsp?: number;
  summary?: string;
  tags?: string;
  tag?: string;
  bannerUrl?: string;
  category?: number;
  imageUrls?: string;
  original?: number;
  tid?: number;
  coverUrl?: string;
  coverBase64?: string;
  coverFilename?: string;
  coverContentType?: string;
  desc?: string;
  copyright?: number;
  imageUrl?: string;
  imageBase64?: string;
  imageFilename?: string;
  imageContentType?: string;
  rewriteContentImages?: boolean;
  startTime?: number;
  endTime?: number;
  type?: number;
  userid?: string;
  instanceid?: number;
  password?: string;
  timeZone?: string;
  meetingId?: string;
  meetingCode?: string;
  page?: number;
  pageSize?: number;
  inviteeUserIds?: string;
  reasonCode?: number;
  reasonDetail?: string;
};

export type EnterpriseOperationalIdentityExecutionResult =
  | {
      ok: true;
      provider: EnterpriseIdentity["provider"];
      action: string;
      executionId: string;
      output: Record<string, unknown>;
    }
  | { ok: false; code: string; message: string };

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

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function parseEnterpriseOperationalIdentityExecutionPayload(
  value: unknown,
): EnterpriseOperationalIdentityExecutionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    to: stringValue(record.to) || undefined,
    subject: stringValue(record.subject) || undefined,
    message: stringValue(record.message) || undefined,
    body: stringValue(record.body) || undefined,
    html: stringValue(record.html) || undefined,
    mailbox: stringValue(record.mailbox) || undefined,
    uid: numberValue(record.uid),
    limit: numberValue(record.limit),
    query: stringValue(record.query) || undefined,
    unseen: booleanValue(record.unseen),
    includeBody: booleanValue(record.includeBody),
    title: stringValue(record.title) || undefined,
    content: stringValue(record.content) || stringValue(record.body) || undefined,
    author: stringValue(record.author) || undefined,
    digest: stringValue(record.digest) || undefined,
    thumbMediaId:
      stringValue(record.thumbMediaId) || stringValue(record.thumb_media_id) || undefined,
    thumbUrl: stringValue(record.thumbUrl) || stringValue(record.thumb_url) || undefined,
    thumbBase64: stringValue(record.thumbBase64) || stringValue(record.thumb_base64) || undefined,
    thumbFilename:
      stringValue(record.thumbFilename) || stringValue(record.thumb_filename) || undefined,
    thumbContentType:
      stringValue(record.thumbContentType) || stringValue(record.thumb_content_type) || undefined,
    mediaId: stringValue(record.mediaId) || stringValue(record.media_id) || undefined,
    publishId: stringValue(record.publishId) || stringValue(record.publish_id) || undefined,
    sendToAll: booleanValue(record.sendToAll ?? record.send_to_all),
    tagId: numberValue(record.tagId ?? record.tag_id),
    picId: stringValue(record.picId) || stringValue(record.pic_id) || undefined,
    picUrl: stringValue(record.picUrl) || stringValue(record.pic_url) || undefined,
    picBase64: stringValue(record.picBase64) || stringValue(record.pic_base64) || undefined,
    picFilename: stringValue(record.picFilename) || stringValue(record.pic_filename) || undefined,
    picContentType:
      stringValue(record.picContentType) || stringValue(record.pic_content_type) || undefined,
    visible: numberValue(record.visible),
    text: stringValue(record.text) || undefined,
    videoId: stringValue(record.videoId) || stringValue(record.video_id) || undefined,
    videoUrl: stringValue(record.videoUrl) || stringValue(record.video_url) || undefined,
    videoBase64: stringValue(record.videoBase64) || stringValue(record.video_base64) || undefined,
    videoFilename:
      stringValue(record.videoFilename) || stringValue(record.video_filename) || undefined,
    videoContentType:
      stringValue(record.videoContentType) || stringValue(record.video_content_type) || undefined,
    privateStatus: numberValue(record.privateStatus ?? record.private_status),
    coverTsp: numberValue(record.coverTsp ?? record.cover_tsp),
    summary: stringValue(record.summary) || undefined,
    tags: stringValue(record.tags) || stringValue(record.tag) || undefined,
    tag: stringValue(record.tag) || undefined,
    bannerUrl: stringValue(record.bannerUrl) || stringValue(record.banner_url) || undefined,
    category: numberValue(record.category),
    imageUrls: stringValue(record.imageUrls) || stringValue(record.image_urls) || undefined,
    original: numberValue(record.original),
    tid: numberValue(record.tid),
    coverUrl: stringValue(record.coverUrl) || stringValue(record.cover_url) || undefined,
    coverBase64: stringValue(record.coverBase64) || stringValue(record.cover_base64) || undefined,
    coverFilename:
      stringValue(record.coverFilename) || stringValue(record.cover_filename) || undefined,
    coverContentType:
      stringValue(record.coverContentType) || stringValue(record.cover_content_type) || undefined,
    desc: stringValue(record.desc) || stringValue(record.description) || undefined,
    copyright: numberValue(record.copyright),
    imageUrl: stringValue(record.imageUrl) || stringValue(record.image_url) || undefined,
    imageBase64: stringValue(record.imageBase64) || stringValue(record.image_base64) || undefined,
    imageFilename:
      stringValue(record.imageFilename) || stringValue(record.image_filename) || undefined,
    imageContentType:
      stringValue(record.imageContentType) || stringValue(record.image_content_type) || undefined,
    rewriteContentImages: booleanValue(
      record.rewriteContentImages ?? record.rewrite_content_images,
    ),
    startTime: numberValue(record.startTime ?? record.start_time),
    endTime: numberValue(record.endTime ?? record.end_time),
    type: numberValue(record.type),
    userid: stringValue(record.userid) || undefined,
    instanceid: numberValue(record.instanceid ?? record.instance_id),
    password: stringValue(record.password) || undefined,
    timeZone: stringValue(record.timeZone ?? record.time_zone) || undefined,
    meetingId: stringValue(record.meetingId ?? record.meeting_id) || undefined,
    meetingCode: stringValue(record.meetingCode ?? record.meeting_code) || undefined,
    page: numberValue(record.page),
    pageSize: numberValue(record.pageSize ?? record.page_size),
    inviteeUserIds:
      stringValue(record.inviteeUserIds ?? record.invitees) ||
      (Array.isArray(record.invitees)
        ? record.invitees.filter((entry): entry is string => typeof entry === "string").join(",")
        : undefined),
    reasonCode: numberValue(record.reasonCode ?? record.reason_code),
    reasonDetail: stringValue(record.reasonDetail ?? record.reason_detail) || undefined,
  };
}

function assertActionCapability(identity: EnterpriseIdentity, action: string): void {
  if (!identity.capabilities || identity.capabilities.length === 0) {
    return;
  }
  if (!identity.capabilities.includes(action)) {
    throw new Error(`动作 ${action} 不在已验证能力范围内；请先测试连接或调整策略。`);
  }
}

async function executeEnterpriseEmailAction(params: {
  action: string;
  payload: EnterpriseOperationalIdentityExecutionPayload;
  secret: EnterpriseOperationalIdentityCredentialSecret;
}): Promise<Record<string, unknown>> {
  const imapPayload = parseEnterpriseOperationalIdentityImapPayload(params.payload);

  if (params.action === "send_email") {
    const to = stringValue(params.payload.to);
    const subject = stringValue(params.payload.subject);
    const message = stringValue(params.payload.message) || stringValue(params.payload.body);
    if (!to || !subject || !message) {
      throw new Error("send_email 需要 to、subject、message（或 body）。");
    }
    const sent = await sendEnterpriseOperationalIdentityEmail({
      secret: params.secret,
      to,
      subject,
      message,
      html: stringValue(params.payload.html) || undefined,
    });
    return {
      messageId: sent.messageId,
      to,
      subject,
      from: sent.from,
      status: sent.status,
    };
  }

  if (params.action === "read_email") {
    return await readEnterpriseOperationalIdentityEmails({
      secret: params.secret,
      payload: imapPayload,
    });
  }

  if (params.action === "search_email") {
    return await searchEnterpriseOperationalIdentityEmails({
      secret: params.secret,
      payload: imapPayload,
    });
  }

  if (params.action === "reply_email") {
    return await replyEnterpriseOperationalIdentityEmail({
      secret: params.secret,
      payload: imapPayload,
    });
  }

  throw new Error(`企业邮箱不支持动作：${params.action}`);
}

export async function executeEnterpriseOperationalIdentityAction(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identity: EnterpriseIdentity;
  action: string;
  payload: EnterpriseOperationalIdentityExecutionPayload;
  seatId: string;
  agentId: string;
  policyId: string;
  actorEmployeeId?: string;
  nowIso: string;
  auditId?: string;
  /** PDP EffectiveAccess meta closed into usage / usage_denied audit. */
  accessMeta?: OperationalIdentityAccessDecisionMeta | null;
}): Promise<EnterpriseOperationalIdentityExecutionResult> {
  const executionId = randomUUID();
  const secretStore = await loadEnterpriseOperationalIdentityCredentialSecretStore();
  const secret = secretStore.secrets[params.identity.credentialBindingId] ?? null;
  if (!secret) {
    recordOperationalIdentityUsageDenied({
      store: params.store,
      tenantId: params.tenantId,
      identityId: params.identity.identityId,
      seatId: params.seatId,
      agentId: params.agentId,
      action: params.action,
      code: "IDENTITY_001",
      message: "Credential secret is missing.",
      actorEmployeeId: params.actorEmployeeId,
      nowIso: params.nowIso,
      auditId: params.auditId,
      meta: params.accessMeta,
    });
    return {
      ok: false,
      code: "IDENTITY_001",
      message: "凭证密钥缺失，请重新配置身份。",
    };
  }

  try {
    assertActionCapability(params.identity, params.action);
    let output: Record<string, unknown>;
    if (params.identity.provider === "enterprise-email") {
      output = await executeEnterpriseEmailAction({
        action: params.action,
        payload: params.payload,
        secret,
      });
    } else if (params.identity.provider === "wechat-official") {
      output = await executeWechatOfficialOperationalAction({
        action: params.action,
        payload: parseEnterpriseOperationalIdentityWechatPayload(params.payload),
        secret,
        credentialBindingId: params.identity.credentialBindingId,
        externalAccountId: params.identity.externalAccountId,
      });
    } else if (params.identity.provider === "weibo") {
      output = await executeWeiboOperationalAction({
        action: params.action,
        payload: parseEnterpriseOperationalIdentityWeiboPayload(params.payload),
        secret,
        credentialBindingId: params.identity.credentialBindingId,
        externalAccountId: params.identity.externalAccountId,
      });
    } else if (params.identity.provider === "douyin") {
      output = await executeDouyinOperationalAction({
        action: params.action,
        payload: parseEnterpriseOperationalIdentityDouyinPayload(params.payload),
        secret,
        credentialBindingId: params.identity.credentialBindingId,
        externalAccountId: params.identity.externalAccountId,
      });
    } else if (params.identity.provider === "bilibili") {
      output = await executeBilibiliOperationalAction({
        action: params.action,
        payload: parseEnterpriseOperationalIdentityBilibiliPayload(params.payload),
        secret,
        credentialBindingId: params.identity.credentialBindingId,
      });
    } else if (params.identity.provider === "tencent-meeting") {
      output = await executeTencentMeetingOperationalAction({
        action: params.action,
        payload: parseEnterpriseOperationalIdentityTencentMeetingPayload(params.payload),
        secret,
        externalAccountId: params.identity.externalAccountId,
      });
    } else {
      throw new Error(`Provider ${params.identity.provider} 的执行层尚未接入。`);
    }
    recordOperationalIdentityUsage({
      store: params.store,
      tenantId: params.tenantId,
      identityId: params.identity.identityId,
      seatId: params.seatId,
      agentId: params.agentId,
      action: params.action,
      policyId: params.policyId,
      actorEmployeeId: params.actorEmployeeId,
      nowIso: params.nowIso,
      auditId: params.auditId,
      result: "success",
      meta: params.accessMeta,
    });
    return {
      ok: true,
      provider: params.identity.provider,
      action: params.action,
      executionId,
      output: { ...output, executionId },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Operational identity execution failed.";
    recordOperationalIdentityUsageDenied({
      store: params.store,
      tenantId: params.tenantId,
      identityId: params.identity.identityId,
      seatId: params.seatId,
      agentId: params.agentId,
      action: params.action,
      code: "IDENTITY_005",
      message,
      actorEmployeeId: params.actorEmployeeId,
      nowIso: params.nowIso,
      auditId: params.auditId,
      meta: params.accessMeta,
    });
    return {
      ok: false,
      code: "IDENTITY_005",
      message,
    };
  }
}

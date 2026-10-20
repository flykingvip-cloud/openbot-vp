import {
  addWechatOfficialDraft,
  broadcastWechatOfficialArticle,
  getWechatOfficialFreePublishStatus,
  rewriteWechatOfficialHtmlContentImages,
  submitWechatOfficialFreePublish,
  uploadWechatOfficialContentImageFromSource,
  uploadWechatOfficialThumbFromSource,
} from "../enterprise-operational-identity-wechat-official-api.js";

export type WechatOfficialOperationalActionPayload = {
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
  imageUrl?: string;
  imageBase64?: string;
  imageFilename?: string;
  imageContentType?: string;
  rewriteContentImages?: boolean;
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

export function parseWechatOfficialOperationalActionPayload(
  value: unknown,
): WechatOfficialOperationalActionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
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
    imageUrl: stringValue(record.imageUrl) || stringValue(record.image_url) || undefined,
    imageBase64: stringValue(record.imageBase64) || stringValue(record.image_base64) || undefined,
    imageFilename:
      stringValue(record.imageFilename) || stringValue(record.image_filename) || undefined,
    imageContentType:
      stringValue(record.imageContentType) || stringValue(record.image_content_type) || undefined,
    rewriteContentImages: booleanValue(
      record.rewriteContentImages ?? record.rewrite_content_images,
    ),
  };
}

async function resolveWechatOfficialThumbMediaId(params: {
  accessToken: string;
  payload: WechatOfficialOperationalActionPayload;
}): Promise<{ thumbMediaId: string; thumbUploaded?: Record<string, unknown> }> {
  const existing = stringValue(params.payload.thumbMediaId);
  if (existing) {
    return { thumbMediaId: existing };
  }
  const thumbUrl = stringValue(params.payload.thumbUrl);
  // imageBase64 is the content-image field; accept it as a cover alias so models
  // that only saw imageBase64 on the tool schema still reach the thumb uploader.
  const thumbBase64 =
    stringValue(params.payload.thumbBase64) || stringValue(params.payload.imageBase64);
  if (!thumbUrl && !thumbBase64) {
    throw new Error(
      "创建草稿需要 thumbMediaId，或提供 thumbUrl / thumbBase64 自动上传封面（≤64KB）。",
    );
  }
  const uploaded = await uploadWechatOfficialThumbFromSource({
    accessToken: params.accessToken,
    thumbUrl: thumbUrl || undefined,
    thumbBase64: thumbBase64 || undefined,
    thumbFilename: params.payload.thumbFilename,
    thumbContentType: params.payload.thumbContentType,
  });
  return {
    thumbMediaId: uploaded.mediaId,
    thumbUploaded: {
      thumbMediaId: uploaded.mediaId,
      thumbFilename: uploaded.filename,
      thumbBytes: uploaded.bytes,
    },
  };
}

async function prepareWechatOfficialArticleContent(params: {
  accessToken: string;
  payload: WechatOfficialOperationalActionPayload;
}): Promise<{
  content: string;
  contentImagesRewritten?: Array<{ source: string; url: string }>;
  contentImagesSkipped?: string[];
}> {
  const content = stringValue(params.payload.content);
  if (!content) {
    throw new Error("content 不能为空。");
  }
  if (params.payload.rewriteContentImages === false) {
    return { content };
  }
  const rewritten = await rewriteWechatOfficialHtmlContentImages({
    accessToken: params.accessToken,
    html: content,
  });
  return {
    content: rewritten.html,
    ...(rewritten.rewritten.length > 0 ? { contentImagesRewritten: rewritten.rewritten } : {}),
    ...(rewritten.skipped.length > 0 ? { contentImagesSkipped: rewritten.skipped } : {}),
  };
}

async function createDraftMediaId(params: {
  accessToken: string;
  payload: WechatOfficialOperationalActionPayload;
}): Promise<{
  mediaId: string;
  thumbUploaded?: Record<string, unknown>;
  contentImagesRewritten?: Array<{ source: string; url: string }>;
  contentImagesSkipped?: string[];
}> {
  const title = stringValue(params.payload.title);
  if (!title) {
    throw new Error("创建草稿需要 title。");
  }
  const prepared = await prepareWechatOfficialArticleContent({
    accessToken: params.accessToken,
    payload: params.payload,
  });
  const thumb = await resolveWechatOfficialThumbMediaId(params);
  const draft = await addWechatOfficialDraft({
    accessToken: params.accessToken,
    article: {
      title,
      content: prepared.content,
      thumbMediaId: thumb.thumbMediaId,
      author: params.payload.author,
      digest: params.payload.digest,
    },
  });
  return {
    mediaId: draft.mediaId,
    ...(thumb.thumbUploaded ? { thumbUploaded: thumb.thumbUploaded } : {}),
    ...(prepared.contentImagesRewritten
      ? { contentImagesRewritten: prepared.contentImagesRewritten }
      : {}),
    ...(prepared.contentImagesSkipped
      ? { contentImagesSkipped: prepared.contentImagesSkipped }
      : {}),
  };
}

/** Credential-store-agnostic WeChat Official Account publish/upload execution. */
export async function executeWechatOfficialActionsWithAccessToken(params: {
  action: string;
  payload: WechatOfficialOperationalActionPayload;
  accessToken: string;
  appId: string;
}): Promise<Record<string, unknown>> {
  const accessToken = params.accessToken.trim();
  const authorizerAppId = params.appId.trim();
  if (!accessToken || !authorizerAppId) {
    throw new Error("缺少 AppID 或 access_token。");
  }

  if (params.action === "upload_thumb") {
    const uploaded = await uploadWechatOfficialThumbFromSource({
      accessToken,
      thumbUrl: params.payload.thumbUrl,
      thumbBase64: params.payload.thumbBase64 || params.payload.imageBase64,
      thumbFilename: params.payload.thumbFilename,
      thumbContentType: params.payload.thumbContentType,
    });
    return {
      authorizerAppId,
      thumbMediaId: uploaded.mediaId,
      thumbFilename: uploaded.filename,
      thumbBytes: uploaded.bytes,
      status: "thumb_uploaded",
    };
  }

  if (params.action === "upload_content_image") {
    const uploaded = await uploadWechatOfficialContentImageFromSource({
      accessToken,
      imageUrl: params.payload.imageUrl,
      imageBase64: params.payload.imageBase64,
      imageFilename: params.payload.imageFilename,
      imageContentType: params.payload.imageContentType,
    });
    return {
      authorizerAppId,
      imageUrl: uploaded.url,
      imageFilename: uploaded.filename,
      imageBytes: uploaded.bytes,
      status: "content_image_uploaded",
    };
  }

  if (params.action === "get_publish_status") {
    const publishId = stringValue(params.payload.publishId);
    if (!publishId) {
      throw new Error("get_publish_status 需要 publishId。");
    }
    const status = await getWechatOfficialFreePublishStatus({
      accessToken,
      publishId,
    });
    return {
      authorizerAppId,
      publishId,
      status,
    };
  }

  if (params.action === "publish_draft") {
    const draft = await createDraftMediaId({
      accessToken,
      payload: params.payload,
    });
    return {
      authorizerAppId,
      mediaId: draft.mediaId,
      ...draft.thumbUploaded,
      ...(draft.contentImagesRewritten
        ? { contentImagesRewritten: draft.contentImagesRewritten }
        : {}),
      ...(draft.contentImagesSkipped ? { contentImagesSkipped: draft.contentImagesSkipped } : {}),
      status: "draft_created",
    };
  }

  if (params.action === "publish_article") {
    const draft = stringValue(params.payload.mediaId)
      ? { mediaId: stringValue(params.payload.mediaId) }
      : await createDraftMediaId({ accessToken, payload: params.payload });
    const published = await submitWechatOfficialFreePublish({
      accessToken,
      mediaId: draft.mediaId,
    });
    return {
      authorizerAppId,
      mediaId: draft.mediaId,
      publishId: published.publishId,
      ...("thumbUploaded" in draft && draft.thumbUploaded ? draft.thumbUploaded : {}),
      ...("contentImagesRewritten" in draft && draft.contentImagesRewritten
        ? { contentImagesRewritten: draft.contentImagesRewritten }
        : {}),
      ...("contentImagesSkipped" in draft && draft.contentImagesSkipped
        ? { contentImagesSkipped: draft.contentImagesSkipped }
        : {}),
      status: "publish_submitted",
    };
  }

  if (params.action === "broadcast_article") {
    const mediaId = stringValue(params.payload.mediaId);
    if (!mediaId) {
      throw new Error("broadcast_article 需要 mediaId（草稿/图文 media_id）。");
    }
    const broadcast = await broadcastWechatOfficialArticle({
      accessToken,
      mediaId,
      sendToAll: params.payload.sendToAll,
      tagId: params.payload.tagId,
    });
    return {
      authorizerAppId,
      mediaId,
      msgId: broadcast.msgId,
      msgDataId: broadcast.msgDataId ?? null,
      status: "broadcast_sent",
    };
  }

  throw new Error(`微信公众号不支持动作：${params.action}`);
}

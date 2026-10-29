import { resizeToJpeg } from "../media/image-ops.js";
import { probeWechatOfficialCredentials } from "./wechat-official/credentials.js";

type WechatApiPayload = Record<string, unknown> & {
  errcode?: number;
  errmsg?: string;
};

export const WECHAT_OFFICIAL_THUMB_MAX_BYTES = 64 * 1024;
/** Source may exceed thumb cap; we re-encode to JPEG ≤ THUMB_MAX before upload. */
export const WECHAT_OFFICIAL_THUMB_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES = 1024 * 1024;

const THUMB_JPEG_QUALITY_STEPS = [85, 75, 65, 55, 45, 35, 28] as const;
const THUMB_JPEG_MAX_SIDE_STEPS = [900, 720, 640, 520, 420] as const;

/** Agents often pass a workspace path as thumbBase64; that becomes garbage bytes. */
export function looksLikeFilesystemImagePath(value: string): boolean {
  const v = value.trim();
  if (v.length < 3 || v.length > 512) {
    return false;
  }
  if (v.includes("\n") || v.includes(";base64,")) {
    return false;
  }
  if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(v)) {
    return false;
  }
  return (
    v.startsWith("/") || v.startsWith("./") || v.startsWith("../") || /^[A-Za-z]:[\\/]/.test(v)
  );
}

/**
 * Re-encode any decodable image to RGB JPEG under the WeChat thumb 64KB cap.
 * Permanent thumb material rejects truncated / wrong-MIME bytes as
 * "unsupported file type hint".
 */
export async function normalizeWechatOfficialThumbJpeg(data: Buffer): Promise<{
  data: Buffer;
  contentType: "image/jpeg";
  filename: string;
}> {
  if (!data.length) {
    throw new Error("封面图为空。");
  }
  let lastError: unknown;
  for (const maxSide of THUMB_JPEG_MAX_SIDE_STEPS) {
    for (const quality of THUMB_JPEG_QUALITY_STEPS) {
      try {
        const jpeg = await resizeToJpeg({
          buffer: data,
          maxSide,
          quality,
          withoutEnlargement: true,
        });
        if (jpeg.length > 0 && jpeg.length <= WECHAT_OFFICIAL_THUMB_MAX_BYTES) {
          return { data: jpeg, contentType: "image/jpeg", filename: "thumb.jpg" };
        }
      } catch (err) {
        lastError = err;
        // Invalid image bytes — stop trying qualities.
        break;
      }
    }
  }
  if (lastError) {
    throw new Error(
      `封面图无法解码为 JPEG（微信会返回 unsupported file type）。请提供标准 PNG/JPEG，勿传文件路径当 base64。原始错误：${
        lastError instanceof Error ? lastError.message : "unknown decode error"
      }`,
    );
  }
  throw new Error(
    `封面图压缩后仍超过 ${WECHAT_OFFICIAL_THUMB_MAX_BYTES} 字节上限。请缩小尺寸或降低画质后再传。`,
  );
}

async function parseWechatApiResponse<T extends WechatApiPayload>(
  response: Response,
  path: string,
): Promise<T> {
  if (!response.ok) {
    throw new Error(`WeChat API HTTP ${response.status}: ${path}`);
  }
  const payload = (await response.json()) as T;
  if (payload.errcode != null && payload.errcode !== 0) {
    throw new Error(payload.errmsg ?? `WeChat API errcode ${payload.errcode}`);
  }
  return payload;
}

async function wechatOfficialPost<T extends WechatApiPayload>(params: {
  accessToken: string;
  path: string;
  body: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(
    `https://api.weixin.qq.com${params.path}?access_token=${encodeURIComponent(params.accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
    },
  );
  return await parseWechatApiResponse<T>(response, params.path);
}

export function readWechatApiId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.trim() : "";
}

function normalizeThumbFilename(filename: string | undefined, contentType: string): string {
  const trimmed = filename?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (contentType.includes("png")) {
    return "thumb.png";
  }
  return "thumb.jpg";
}

function parseDataUrlBase64(value: string): { contentType: string; data: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(value.trim());
  if (!match?.[2]) {
    return null;
  }
  return {
    contentType: match[1] || "image/jpeg",
    data: Buffer.from(match[2], "base64"),
  };
}

export async function loadWechatOfficialThumbImage(params: {
  thumbUrl?: string;
  thumbBase64?: string;
  thumbFilename?: string;
  thumbContentType?: string;
}): Promise<{ data: Buffer; contentType: string; filename: string }> {
  const fromBase64 = params.thumbBase64?.trim();
  if (fromBase64) {
    if (looksLikeFilesystemImagePath(fromBase64)) {
      throw new Error(
        "thumbBase64 看起来是本地文件路径。请传图片字节的 base64（或 data URL），或用可访问的 thumbUrl；不要把路径字符串当作 base64。",
      );
    }
    const parsed = parseDataUrlBase64(fromBase64);
    const data = parsed?.data ?? Buffer.from(fromBase64, "base64");
    if (!data.length) {
      throw new Error("thumbBase64 为空或无效。");
    }
    if (data.length > WECHAT_OFFICIAL_THUMB_SOURCE_MAX_BYTES) {
      throw new Error(`封面图源文件超过 ${WECHAT_OFFICIAL_THUMB_SOURCE_MAX_BYTES} 字节上限。`);
    }
    const contentType = params.thumbContentType?.trim() || parsed?.contentType || "image/jpeg";
    return {
      data,
      contentType,
      filename: normalizeThumbFilename(params.thumbFilename, contentType),
    };
  }

  const thumbUrl = params.thumbUrl?.trim();
  if (!thumbUrl) {
    throw new Error("缺少 thumbMediaId、thumbUrl 或 thumbBase64。");
  }
  let url: URL;
  try {
    url = new URL(thumbUrl);
  } catch {
    throw new Error("thumbUrl 不是合法 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("thumbUrl 仅支持 http/https。");
  }
  const response = await fetch(thumbUrl);
  if (!response.ok) {
    throw new Error(`下载封面图失败：HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) {
    throw new Error("封面图为空。");
  }
  if (data.length > WECHAT_OFFICIAL_THUMB_SOURCE_MAX_BYTES) {
    throw new Error(`封面图源文件超过 ${WECHAT_OFFICIAL_THUMB_SOURCE_MAX_BYTES} 字节上限。`);
  }
  const contentType =
    params.thumbContentType?.trim() ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  return {
    data,
    contentType,
    filename: normalizeThumbFilename(params.thumbFilename, contentType),
  };
}

export async function uploadWechatOfficialThumbMaterial(params: {
  accessToken: string;
  data: Buffer;
  contentType: string;
  filename: string;
}): Promise<{ mediaId: string }> {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(params.data)], { type: params.contentType }),
    params.filename,
  );
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(params.accessToken)}&type=thumb`,
    { method: "POST", body: form },
  );
  const payload = await parseWechatApiResponse<{ media_id?: string }>(
    response,
    "/cgi-bin/material/add_material",
  );
  const mediaId = readWechatApiId(payload.media_id);
  if (!mediaId) {
    throw new Error("material/add_material 未返回 media_id。");
  }
  return { mediaId };
}

function normalizeContentImageFilename(filename: string | undefined, contentType: string): string {
  const trimmed = filename?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (contentType.includes("png")) {
    return "content.png";
  }
  if (contentType.includes("gif")) {
    return "content.gif";
  }
  return "content.jpg";
}

export function isWechatHostedContentImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host.includes("qpic.cn") ||
      host.includes("qlogo.cn") ||
      host.endsWith("wx.qq.com") ||
      host.includes("weixin.qq.com")
    );
  } catch {
    return false;
  }
}

export async function loadWechatOfficialContentImage(params: {
  imageUrl?: string;
  imageBase64?: string;
  imageFilename?: string;
  imageContentType?: string;
}): Promise<{ data: Buffer; contentType: string; filename: string }> {
  const fromBase64 = params.imageBase64?.trim();
  if (fromBase64) {
    const parsed = parseDataUrlBase64(fromBase64);
    const data = parsed?.data ?? Buffer.from(fromBase64, "base64");
    if (!data.length) {
      throw new Error("imageBase64 为空或无效。");
    }
    if (data.length > WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES) {
      throw new Error(`正文图片超过 ${WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES} 字节上限。`);
    }
    const contentType = params.imageContentType?.trim() || parsed?.contentType || "image/jpeg";
    return {
      data,
      contentType,
      filename: normalizeContentImageFilename(params.imageFilename, contentType),
    };
  }

  const imageUrl = params.imageUrl?.trim();
  if (!imageUrl) {
    throw new Error("缺少 imageUrl 或 imageBase64。");
  }
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("imageUrl 不是合法 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("imageUrl 仅支持 http/https。");
  }
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`下载正文图片失败：HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) {
    throw new Error("正文图片为空。");
  }
  if (data.length > WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES) {
    throw new Error(`正文图片超过 ${WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES} 字节上限。`);
  }
  const contentType =
    params.imageContentType?.trim() ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  return {
    data,
    contentType,
    filename: normalizeContentImageFilename(params.imageFilename, contentType),
  };
}

export async function uploadWechatOfficialContentImage(params: {
  accessToken: string;
  data: Buffer;
  contentType: string;
  filename: string;
}): Promise<{ url: string }> {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(params.data)], { type: params.contentType }),
    params.filename,
  );
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(params.accessToken)}`,
    { method: "POST", body: form },
  );
  const payload = await parseWechatApiResponse<{ url?: string }>(
    response,
    "/cgi-bin/media/uploadimg",
  );
  const url = payload.url?.trim();
  if (!url) {
    throw new Error("media/uploadimg 未返回 url。");
  }
  return { url };
}

export async function uploadWechatOfficialContentImageFromSource(params: {
  accessToken: string;
  imageUrl?: string;
  imageBase64?: string;
  imageFilename?: string;
  imageContentType?: string;
}): Promise<{ url: string; filename: string; bytes: number }> {
  const image = await loadWechatOfficialContentImage(params);
  const uploaded = await uploadWechatOfficialContentImage({
    accessToken: params.accessToken,
    data: image.data,
    contentType: image.contentType,
    filename: image.filename,
  });
  return {
    url: uploaded.url,
    filename: image.filename,
    bytes: image.data.length,
  };
}

export async function rewriteWechatOfficialHtmlContentImages(params: {
  accessToken: string;
  html: string;
}): Promise<{
  html: string;
  rewritten: Array<{ source: string; url: string }>;
  skipped: string[];
}> {
  const rewritten: Array<{ source: string; url: string }> = [];
  const skipped: string[] = [];
  const cache = new Map<string, string>();
  const imgTagPattern = /<img\b[^>]*?\ssrc=(["'])(.*?)\1[^>]*>/gi;
  const sources = new Set<string>();
  for (const match of params.html.matchAll(imgTagPattern)) {
    const source = match[2]?.trim();
    if (source) {
      sources.add(source);
    }
  }

  for (const source of sources) {
    if (isWechatHostedContentImageUrl(source)) {
      skipped.push(source);
      continue;
    }
    if (source.startsWith("data:")) {
      const uploaded = await uploadWechatOfficialContentImageFromSource({
        accessToken: params.accessToken,
        imageBase64: source,
      });
      cache.set(source, uploaded.url);
      rewritten.push({ source, url: uploaded.url });
      continue;
    }
    const uploaded = await uploadWechatOfficialContentImageFromSource({
      accessToken: params.accessToken,
      imageUrl: source,
    });
    cache.set(source, uploaded.url);
    rewritten.push({ source, url: uploaded.url });
  }

  let html = params.html;
  for (const [source, url] of cache) {
    html = html.split(source).join(url);
  }
  return { html, rewritten, skipped };
}

export async function uploadWechatOfficialThumbFromSource(params: {
  accessToken: string;
  thumbUrl?: string;
  thumbBase64?: string;
  thumbFilename?: string;
  thumbContentType?: string;
}): Promise<{ mediaId: string; filename: string; bytes: number }> {
  const loaded = await loadWechatOfficialThumbImage(params);
  const image = await normalizeWechatOfficialThumbJpeg(loaded.data);
  const uploaded = await uploadWechatOfficialThumbMaterial({
    accessToken: params.accessToken,
    data: image.data,
    contentType: image.contentType,
    filename: image.filename,
  });
  return {
    mediaId: uploaded.mediaId,
    filename: image.filename,
    bytes: image.data.length,
  };
}

export async function getWechatOfficialFreePublishStatus(params: {
  accessToken: string;
  publishId: string;
}): Promise<Record<string, unknown>> {
  return await wechatOfficialPost<WechatApiPayload & Record<string, unknown>>({
    accessToken: params.accessToken,
    path: "/cgi-bin/freepublish/get",
    body: { publish_id: params.publishId },
  });
}

export type WechatOfficialDraftArticleInput = {
  title: string;
  content: string;
  author?: string;
  digest?: string;
  thumbMediaId: string;
  contentSourceUrl?: string;
};

export async function addWechatOfficialDraft(params: {
  accessToken: string;
  article: WechatOfficialDraftArticleInput;
}): Promise<{ mediaId: string }> {
  const payload = await wechatOfficialPost<{ media_id?: string | number }>({
    accessToken: params.accessToken,
    path: "/cgi-bin/draft/add",
    body: {
      articles: [
        {
          title: params.article.title,
          author: params.article.author ?? "",
          digest: params.article.digest ?? "",
          content: params.article.content,
          content_source_url: params.article.contentSourceUrl ?? "",
          thumb_media_id: params.article.thumbMediaId,
        },
      ],
    },
  });
  const mediaId = readWechatApiId(payload.media_id);
  if (!mediaId) {
    throw new Error("draft/add 未返回 media_id。");
  }
  return { mediaId };
}

export async function submitWechatOfficialFreePublish(params: {
  accessToken: string;
  mediaId: string;
}): Promise<{ publishId: string }> {
  const payload = await wechatOfficialPost<{ publish_id?: string | number }>({
    accessToken: params.accessToken,
    path: "/cgi-bin/freepublish/submit",
    body: { media_id: params.mediaId },
  });
  const publishId = readWechatApiId(payload.publish_id);
  if (!publishId) {
    throw new Error("freepublish/submit 未返回 publish_id。");
  }
  return { publishId };
}

export async function broadcastWechatOfficialArticle(params: {
  accessToken: string;
  mediaId: string;
  sendToAll?: boolean;
  tagId?: number;
}): Promise<{ msgId: string; msgDataId?: string }> {
  const filter =
    params.sendToAll === false && params.tagId != null
      ? { is_to_all: false, tag_id: params.tagId }
      : { is_to_all: true };
  const payload = await wechatOfficialPost<{ msg_id?: number; msg_data_id?: number }>({
    accessToken: params.accessToken,
    path: "/cgi-bin/message/mass/sendall",
    body: {
      filter,
      mpnews: { media_id: params.mediaId },
      msgtype: "mpnews",
      send_ignore_republish: 0,
    },
  });
  if (payload.msg_id == null) {
    throw new Error("mass/sendall 未返回 msg_id。");
  }
  return {
    msgId: String(payload.msg_id),
    ...(payload.msg_data_id != null ? { msgDataId: String(payload.msg_data_id) } : {}),
  };
}

export async function fetchWechatOfficialClientCredentialToken(params: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const appId = params.appId.trim();
  const appSecret = params.appSecret.trim();
  if (!appId || !appSecret) {
    throw new Error("AppID 与 AppSecret 均为必填。");
  }
  const probe = await probeWechatOfficialCredentials({
    appId,
    appSecret,
    fetchImpl: params.fetchImpl,
    forceRefresh: params.forceRefresh,
  });
  if (!probe.ok) {
    throw new Error(probe.error);
  }
  return {
    accessToken: probe.accessToken,
    expiresIn: 7200,
  };
}

export async function fetchWechatOfficialAccountBasicInfo(params: { accessToken: string }): Promise<
  | {
      ok: true;
      nickName?: string;
      principalName?: string;
      accountType?: string;
      canBroadcast: boolean;
    }
  | { ok: false; error: string }
> {
  const accessToken = params.accessToken.trim();
  if (!accessToken) {
    return { ok: false, error: "access_token 为空。" };
  }
  try {
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/account/getaccountbasicinfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!response.ok) {
      return { ok: false, error: `getaccountbasicinfo HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
      account_type?: number;
      principal_name?: string;
      nickname?: string;
    };
    if (payload.errcode != null && payload.errcode !== 0) {
      return { ok: false, error: payload.errmsg ?? "getaccountbasicinfo 失败。" };
    }
    // account_type: 1 订阅号 2 服务号 3 小程序
    const accountType = payload.account_type != null ? String(payload.account_type) : undefined;
    return {
      ok: true,
      nickName: payload.nickname?.trim() || undefined,
      principalName: payload.principal_name?.trim() || undefined,
      accountType,
      canBroadcast: payload.account_type === 2,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "getaccountbasicinfo 失败。",
    };
  }
}

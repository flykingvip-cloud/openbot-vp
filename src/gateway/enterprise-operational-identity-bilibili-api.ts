import { resolveUserOperationalIdentityOAuthAdapterConfig } from "./user-operational-identity-oauth-adapters/index.js";

type BilibiliApiPayload = {
  code?: number;
  message?: string;
};

export const BILIBILI_SINGLE_PART_MAX_BYTES = 20 * 1024 * 1024;
export const BILIBILI_VIDEO_MAX_BYTES = 128 * 1024 * 1024;

const MEMBER_BASE = "https://member.bilibili.com";
const UPLOAD_BASE = "https://openupos.bilivideo.com";
const API_BASE = "https://api.bilibili.com";

export function resolveBilibiliOpenClientConfig(): {
  clientId: string;
  clientSecret: string;
} | null {
  const config = resolveUserOperationalIdentityOAuthAdapterConfig({ provider: "bilibili" });
  if (!config) {
    return null;
  }
  return { clientId: config.clientId, clientSecret: config.clientSecret };
}

function parseBilibiliError(payload: BilibiliApiPayload): string | null {
  if (payload.code != null && payload.code !== 0) {
    return payload.message ?? `Bilibili API error ${payload.code}`;
  }
  return null;
}

async function parseBilibiliJsonResponse<T extends BilibiliApiPayload>(
  response: Response,
  path: string,
): Promise<T> {
  if (!response.ok) {
    throw new Error(`Bilibili API HTTP ${response.status}: ${path}`);
  }
  const payload = (await response.json()) as T;
  const error = parseBilibiliError(payload);
  if (error) {
    throw new Error(error);
  }
  return payload;
}

function buildArcopenQuery(params: {
  clientId: string;
  accessToken: string;
  extra?: Record<string, string>;
}) {
  const query = new URLSearchParams({
    client_id: params.clientId,
    access_token: params.accessToken,
  });
  for (const [key, value] of Object.entries(params.extra ?? {})) {
    if (value.trim()) {
      query.set(key, value.trim());
    }
  }
  return query;
}

function parseDataUrlBase64(value: string): { contentType: string; data: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(value.trim());
  if (!match?.[2]) {
    return null;
  }
  return {
    contentType: match[1] || "application/octet-stream",
    data: Buffer.from(match[2], "base64"),
  };
}

function normalizeVideoFilename(filename: string | undefined, contentType: string): string {
  const trimmed = filename?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (contentType.includes("webm")) {
    return "video.webm";
  }
  return "video.mp4";
}

function normalizeImageFilename(filename: string | undefined, contentType: string): string {
  const trimmed = filename?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (contentType.includes("png")) {
    return "cover.png";
  }
  return "cover.jpg";
}

export async function loadBilibiliVideoFile(params: {
  videoUrl?: string;
  videoBase64?: string;
  videoFilename?: string;
  videoContentType?: string;
}): Promise<{ data: Buffer; contentType: string; filename: string }> {
  const fromBase64 = params.videoBase64?.trim();
  if (fromBase64) {
    const parsed = parseDataUrlBase64(fromBase64);
    const data = parsed?.data ?? Buffer.from(fromBase64, "base64");
    if (!data.length) {
      throw new Error("videoBase64 为空或无效。");
    }
    if (data.length > BILIBILI_VIDEO_MAX_BYTES) {
      throw new Error(`视频超过 ${BILIBILI_VIDEO_MAX_BYTES} 字节上限。`);
    }
    if (data.length > BILIBILI_SINGLE_PART_MAX_BYTES) {
      throw new Error(
        `视频超过 ${BILIBILI_SINGLE_PART_MAX_BYTES} 字节；当前仅支持单分片上传（≤20MB），更大文件分片上传待支持。`,
      );
    }
    const contentType = params.videoContentType?.trim() || parsed?.contentType || "video/mp4";
    return {
      data,
      contentType,
      filename: normalizeVideoFilename(params.videoFilename, contentType),
    };
  }

  const videoUrl = params.videoUrl?.trim();
  if (!videoUrl) {
    throw new Error("缺少 videoUrl 或 videoBase64。");
  }
  let url: URL;
  try {
    url = new URL(videoUrl);
  } catch {
    throw new Error("videoUrl 不是合法 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("videoUrl 仅支持 http/https。");
  }
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`下载视频失败：HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) {
    throw new Error("视频为空。");
  }
  if (data.length > BILIBILI_VIDEO_MAX_BYTES) {
    throw new Error(`视频超过 ${BILIBILI_VIDEO_MAX_BYTES} 字节上限。`);
  }
  if (data.length > BILIBILI_SINGLE_PART_MAX_BYTES) {
    throw new Error(
      `视频超过 ${BILIBILI_SINGLE_PART_MAX_BYTES} 字节；当前仅支持单分片上传（≤20MB），更大文件分片上传待支持。`,
    );
  }
  const contentType =
    params.videoContentType?.trim() ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "video/mp4";
  return {
    data,
    contentType,
    filename: normalizeVideoFilename(params.videoFilename, contentType),
  };
}

export async function loadBilibiliCoverImage(params: {
  coverUrl?: string;
  coverBase64?: string;
  coverFilename?: string;
  coverContentType?: string;
}): Promise<{ data: Buffer; contentType: string; filename: string }> {
  const fromBase64 = params.coverBase64?.trim();
  if (fromBase64) {
    const parsed = parseDataUrlBase64(fromBase64);
    const data = parsed?.data ?? Buffer.from(fromBase64, "base64");
    if (!data.length) {
      throw new Error("coverBase64 为空或无效。");
    }
    const contentType = params.coverContentType?.trim() || parsed?.contentType || "image/jpeg";
    return {
      data,
      contentType,
      filename: normalizeImageFilename(params.coverFilename, contentType),
    };
  }

  const coverUrl = params.coverUrl?.trim();
  if (!coverUrl) {
    throw new Error("缺少 coverUrl 或 coverBase64。");
  }
  const response = await fetch(coverUrl);
  if (!response.ok) {
    throw new Error(`下载封面失败：HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) {
    throw new Error("封面图为空。");
  }
  const contentType =
    params.coverContentType?.trim() ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  return {
    data,
    contentType,
    filename: normalizeImageFilename(params.coverFilename, contentType),
  };
}

export function resolveBilibiliExpiresAtIso(
  expiresIn: number | undefined,
  nowIso: string,
): string | undefined {
  if (expiresIn == null || !Number.isFinite(expiresIn)) {
    return undefined;
  }
  if (expiresIn > 1_000_000_000_000) {
    return new Date(expiresIn).toISOString();
  }
  if (expiresIn > 1_000_000_000) {
    return new Date(expiresIn * 1000).toISOString();
  }
  return new Date(new Date(nowIso).getTime() + expiresIn * 1000).toISOString();
}

export async function verifyBilibiliAccessToken(params: {
  accessToken: string;
  clientId: string;
}): Promise<{ ok: true }> {
  const query = buildArcopenQuery({
    clientId: params.clientId,
    accessToken: params.accessToken,
  });
  const response = await fetch(`${MEMBER_BASE}/arcopen/fn/archive/type/list?${query.toString()}`);
  await parseBilibiliJsonResponse(response, "/arcopen/fn/archive/type/list");
  return { ok: true };
}

export async function refreshBilibiliAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const query = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  const response = await fetch(
    `${API_BASE}/x/account-oauth2/v1/refresh_token?${query.toString()}`,
    {
      method: "POST",
    },
  );
  const payload = await parseBilibiliJsonResponse<{
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
  }>(response, "/x/account-oauth2/v1/refresh_token");
  const accessToken = payload.data?.access_token?.trim();
  if (!accessToken) {
    throw new Error("Bilibili refresh_token 未返回 access_token。");
  }
  return {
    accessToken,
    refreshToken: payload.data?.refresh_token?.trim() || undefined,
    expiresIn: payload.data?.expires_in,
  };
}

export async function addBilibiliArticle(params: {
  accessToken: string;
  clientId: string;
  title: string;
  content: string;
  summary?: string;
  tags?: string;
  bannerUrl?: string;
  category?: number;
  imageUrls?: string;
  original?: number;
}): Promise<{ articleId?: number }> {
  const query = buildArcopenQuery({
    clientId: params.clientId,
    accessToken: params.accessToken,
  });
  const body = new URLSearchParams({
    title: params.title,
    content: params.content,
  });
  if (params.summary?.trim()) {
    body.set("summary", params.summary.trim());
  }
  if (params.tags?.trim()) {
    body.set("tags", params.tags.trim());
  }
  if (params.bannerUrl?.trim()) {
    body.set("banner_url", params.bannerUrl.trim());
  }
  if (params.category != null) {
    body.set("category", String(params.category));
  }
  if (params.imageUrls?.trim()) {
    body.set("image_urls", params.imageUrls.trim());
  }
  if (params.original != null) {
    body.set("original", String(params.original));
  }
  const response = await fetch(`${MEMBER_BASE}/arcopen/fn/article/add?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await parseBilibiliJsonResponse<{
    code?: number;
    message?: string;
    data?: { id?: number };
  }>(response, "/arcopen/fn/article/add");
  return { articleId: payload.data?.id };
}

export async function initBilibiliVideoUpload(params: {
  accessToken: string;
  clientId: string;
  filename: string;
}): Promise<{ uploadToken: string }> {
  const query = buildArcopenQuery({
    clientId: params.clientId,
    accessToken: params.accessToken,
  });
  const response = await fetch(`${MEMBER_BASE}/arcopen/fn/archive/video/init?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: params.filename }),
  });
  const payload = await parseBilibiliJsonResponse<{
    code?: number;
    message?: string;
    data?: { upload_token?: string };
  }>(response, "/arcopen/fn/archive/video/init");
  const uploadToken = payload.data?.upload_token?.trim();
  if (!uploadToken) {
    throw new Error("Bilibili video init 未返回 upload_token。");
  }
  return { uploadToken };
}

export async function uploadBilibiliVideoPart(params: {
  uploadToken: string;
  partNumber: number;
  data: Buffer;
}): Promise<void> {
  const query = new URLSearchParams({
    upload_token: params.uploadToken,
    part_number: String(params.partNumber),
  });
  const response = await fetch(`${UPLOAD_BASE}/video/v2/part/upload?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(params.data),
  });
  await parseBilibiliJsonResponse(response, "/video/v2/part/upload");
}

export async function completeBilibiliVideoUpload(params: { uploadToken: string }): Promise<void> {
  const query = new URLSearchParams({ upload_token: params.uploadToken });
  const response = await fetch(
    `${MEMBER_BASE}/arcopen/fn/archive/video/complete?${query.toString()}`,
    {
      method: "POST",
    },
  );
  await parseBilibiliJsonResponse(response, "/arcopen/fn/archive/video/complete");
}

export async function uploadBilibiliCover(params: {
  accessToken: string;
  clientId: string;
  coverUrl?: string;
  coverBase64?: string;
  coverFilename?: string;
  coverContentType?: string;
}): Promise<{ coverUrl: string }> {
  const cover = await loadBilibiliCoverImage(params);
  const query = buildArcopenQuery({
    clientId: params.clientId,
    accessToken: params.accessToken,
  });
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(cover.data)], { type: cover.contentType }),
    cover.filename,
  );
  const response = await fetch(
    `${MEMBER_BASE}/arcopen/fn/archive/cover/upload?${query.toString()}`,
    {
      method: "POST",
      body: form,
    },
  );
  const payload = await parseBilibiliJsonResponse<{
    code?: number;
    message?: string;
    data?: { url?: string };
  }>(response, "/arcopen/fn/archive/cover/upload");
  const coverUrl = payload.data?.url?.trim();
  if (!coverUrl) {
    throw new Error("Bilibili 封面上传未返回 url。");
  }
  return { coverUrl };
}

export async function submitBilibiliArchiveByUploadToken(params: {
  accessToken: string;
  clientId: string;
  uploadToken: string;
  title: string;
  coverUrl: string;
  tid: number;
  tag: string;
  copyright?: number;
  desc?: string;
}): Promise<{ resourceId?: string }> {
  const query = buildArcopenQuery({
    clientId: params.clientId,
    accessToken: params.accessToken,
    extra: { upload_token: params.uploadToken },
  });
  const body: Record<string, unknown> = {
    title: params.title,
    cover: params.coverUrl,
    tid: params.tid,
    tag: params.tag,
    copyright: params.copyright ?? 1,
  };
  if (params.desc?.trim()) {
    body.desc = params.desc.trim();
  }
  const response = await fetch(
    `${MEMBER_BASE}/arcopen/fn/archive/add-by-utoken?${query.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const payload = await parseBilibiliJsonResponse<{
    code?: number;
    message?: string;
    data?: { resource_id?: string | number };
  }>(response, "/arcopen/fn/archive/add-by-utoken");
  const resourceId = payload.data?.resource_id;
  return {
    resourceId: resourceId != null ? String(resourceId) : undefined,
  };
}

export async function publishBilibiliVideoFromSource(params: {
  accessToken: string;
  clientId: string;
  title: string;
  tid: number;
  tag: string;
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
}): Promise<{
  uploadToken: string;
  coverUrl: string;
  resourceId?: string;
  videoBytes: number;
  videoFilename: string;
}> {
  const video = await loadBilibiliVideoFile(params);
  const cover =
    params.coverUrl?.trim() || params.coverBase64?.trim()
      ? await uploadBilibiliCover({
          accessToken: params.accessToken,
          clientId: params.clientId,
          coverUrl: params.coverUrl,
          coverBase64: params.coverBase64,
          coverFilename: params.coverFilename,
          coverContentType: params.coverContentType,
        })
      : null;
  if (!cover?.coverUrl) {
    throw new Error("publish_video 需要 coverUrl 或 coverBase64 上传封面。");
  }

  const init = await initBilibiliVideoUpload({
    accessToken: params.accessToken,
    clientId: params.clientId,
    filename: video.filename,
  });
  await uploadBilibiliVideoPart({
    uploadToken: init.uploadToken,
    partNumber: 1,
    data: video.data,
  });
  await completeBilibiliVideoUpload({ uploadToken: init.uploadToken });
  const submitted = await submitBilibiliArchiveByUploadToken({
    accessToken: params.accessToken,
    clientId: params.clientId,
    uploadToken: init.uploadToken,
    title: params.title,
    coverUrl: cover.coverUrl,
    tid: params.tid,
    tag: params.tag,
    desc: params.desc,
    copyright: params.copyright,
  });

  return {
    uploadToken: init.uploadToken,
    coverUrl: cover.coverUrl,
    resourceId: submitted.resourceId,
    videoBytes: video.data.length,
    videoFilename: video.filename,
  };
}

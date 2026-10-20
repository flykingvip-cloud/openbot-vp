type DouyinDataPayload = {
  error_code?: number;
  description?: string;
};

type DouyinEnvelope<T extends DouyinDataPayload = DouyinDataPayload> = {
  data?: T;
  extra?: {
    error_code?: number;
    description?: string;
    sub_description?: string;
  };
  message?: string;
};

export const DOUYIN_SIMPLE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const DOUYIN_VIDEO_MAX_BYTES = 128 * 1024 * 1024;

const DOUYIN_OPEN_BASE = "https://open.douyin.com";

function resolveDouyinError(payload: DouyinEnvelope): string | null {
  const dataCode = payload.data?.error_code;
  const extraCode = payload.extra?.error_code;
  if (dataCode != null && dataCode !== 0) {
    return payload.data?.description ?? `Douyin API error ${dataCode}`;
  }
  if (extraCode != null && extraCode !== 0) {
    return (
      payload.extra?.description ??
      payload.extra?.sub_description ??
      `Douyin API error ${extraCode}`
    );
  }
  return null;
}

async function parseDouyinJsonResponse<T extends DouyinDataPayload>(
  response: Response,
  path: string,
): Promise<T> {
  if (!response.ok) {
    throw new Error(`Douyin API HTTP ${response.status}: ${path}`);
  }
  const payload = (await response.json()) as DouyinEnvelope<T>;
  const error = resolveDouyinError(payload);
  if (error) {
    throw new Error(error);
  }
  if (!payload.data) {
    throw new Error(`Douyin API 响应缺少 data：${path}`);
  }
  return payload.data;
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

function parseDataUrlBase64(value: string): { contentType: string; data: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(value.trim());
  if (!match?.[2]) {
    return null;
  }
  return {
    contentType: match[1] || "video/mp4",
    data: Buffer.from(match[2], "base64"),
  };
}

export async function loadDouyinVideoFile(params: {
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
    if (data.length > DOUYIN_VIDEO_MAX_BYTES) {
      throw new Error(`视频超过 ${DOUYIN_VIDEO_MAX_BYTES} 字节上限。`);
    }
    if (data.length > DOUYIN_SIMPLE_UPLOAD_MAX_BYTES) {
      throw new Error(
        `视频超过 ${DOUYIN_SIMPLE_UPLOAD_MAX_BYTES} 字节；当前仅支持整文件上传（≤50MB），更大文件请分片上传（待支持）。`,
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
  if (data.length > DOUYIN_VIDEO_MAX_BYTES) {
    throw new Error(`视频超过 ${DOUYIN_VIDEO_MAX_BYTES} 字节上限。`);
  }
  if (data.length > DOUYIN_SIMPLE_UPLOAD_MAX_BYTES) {
    throw new Error(
      `视频超过 ${DOUYIN_SIMPLE_UPLOAD_MAX_BYTES} 字节；当前仅支持整文件上传（≤50MB），更大文件请分片上传（待支持）。`,
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

export async function verifyDouyinAccessToken(params: {
  accessToken: string;
  openId: string;
}): Promise<{ openId: string; nickname?: string }> {
  const body = new URLSearchParams({
    access_token: params.accessToken,
    open_id: params.openId,
  });
  const response = await fetch(`${DOUYIN_OPEN_BASE}/oauth/userinfo/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await parseDouyinJsonResponse<{
    open_id?: string;
    nickname?: string;
    error_code?: number;
  }>(response, "/oauth/userinfo");
  const openId = data.open_id?.trim() || params.openId;
  return { openId, nickname: data.nickname?.trim() || undefined };
}

export async function refreshDouyinAccessToken(params: {
  clientKey: string;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}> {
  const response = await fetch(`${DOUYIN_OPEN_BASE}/oauth/refresh_token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_key: params.clientKey,
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }),
  });
  if (!response.ok) {
    throw new Error(`Douyin token refresh failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as DouyinEnvelope<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_code?: number;
    description?: string;
  }>;
  const error = resolveDouyinError(payload);
  if (error) {
    throw new Error(error);
  }
  const accessToken = payload.data?.access_token?.trim();
  if (!accessToken) {
    throw new Error(payload.message ?? "Douyin token refresh failed.");
  }
  return {
    accessToken,
    refreshToken: payload.data?.refresh_token?.trim() || undefined,
    expiresIn: payload.data?.expires_in,
  };
}

export async function uploadDouyinVideo(params: {
  accessToken: string;
  openId: string;
  videoUrl?: string;
  videoBase64?: string;
  videoFilename?: string;
  videoContentType?: string;
}): Promise<{ videoId: string; videoBytes: number; videoFilename: string }> {
  const video = await loadDouyinVideoFile(params);
  const query = new URLSearchParams({ open_id: params.openId });
  const form = new FormData();
  form.append(
    "video",
    new Blob([new Uint8Array(video.data)], { type: video.contentType }),
    video.filename,
  );
  const response = await fetch(
    `${DOUYIN_OPEN_BASE}/api/douyin/v1/video/upload_video/?${query.toString()}`,
    {
      method: "POST",
      headers: { "access-token": params.accessToken },
      body: form,
    },
  );
  const data = await parseDouyinJsonResponse<{
    video?: { video_id?: string };
    error_code?: number;
  }>(response, "/video/upload_video");
  const videoId = data.video?.video_id?.trim();
  if (!videoId) {
    throw new Error("抖音 upload_video 未返回 video_id。");
  }
  return {
    videoId,
    videoBytes: video.data.length,
    videoFilename: video.filename,
  };
}

export async function createDouyinVideo(params: {
  accessToken: string;
  openId: string;
  videoId: string;
  text?: string;
  privateStatus?: number;
  coverTsp?: number;
}): Promise<{ itemId?: string; videoId?: string }> {
  const query = new URLSearchParams({ open_id: params.openId });
  const body: Record<string, unknown> = {
    video_id: params.videoId,
  };
  if (params.text?.trim()) {
    body.text = params.text.trim();
  }
  if (params.privateStatus != null) {
    body.private_status = params.privateStatus;
  }
  if (params.coverTsp != null) {
    body.cover_tsp = params.coverTsp;
  }
  const response = await fetch(
    `${DOUYIN_OPEN_BASE}/api/douyin/v1/video/create_video/?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "access-token": params.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = await parseDouyinJsonResponse<{
    item_id?: string;
    video_id?: string;
    error_code?: number;
  }>(response, "/video/create_video");
  return {
    itemId: data.item_id?.trim() || undefined,
    videoId: data.video_id?.trim() || undefined,
  };
}

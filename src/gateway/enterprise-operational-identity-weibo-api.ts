type WeiboApiErrorPayload = {
  error?: string;
  error_code?: number;
  request?: string;
};

export const WEIBO_PIC_MAX_BYTES = 5 * 1024 * 1024;

const WEIBO_API_BASE = "https://api.weibo.com/2";
const WEIBO_UPLOAD_BASE = "https://upload.api.weibo.com/2";

function parseWeiboError(payload: WeiboApiErrorPayload): string | null {
  if (payload.error) {
    const code = payload.error_code != null ? ` (${payload.error_code})` : "";
    return `${payload.error}${code}`;
  }
  return null;
}

async function parseWeiboJsonResponse<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`Weibo API HTTP ${response.status}: ${path}`);
  }
  const payload = (await response.json()) as T & WeiboApiErrorPayload;
  const error = parseWeiboError(payload);
  if (error) {
    throw new Error(error);
  }
  return payload;
}

function normalizePicFilename(filename: string | undefined, contentType: string): string {
  const trimmed = filename?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (contentType.includes("png")) {
    return "pic.png";
  }
  if (contentType.includes("gif")) {
    return "pic.gif";
  }
  return "pic.jpg";
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

export async function loadWeiboPicImage(params: {
  picUrl?: string;
  picBase64?: string;
  picFilename?: string;
  picContentType?: string;
}): Promise<{ data: Buffer; contentType: string; filename: string }> {
  const fromBase64 = params.picBase64?.trim();
  if (fromBase64) {
    const parsed = parseDataUrlBase64(fromBase64);
    const data = parsed?.data ?? Buffer.from(fromBase64, "base64");
    if (!data.length) {
      throw new Error("picBase64 为空或无效。");
    }
    if (data.length > WEIBO_PIC_MAX_BYTES) {
      throw new Error(`图片超过 ${WEIBO_PIC_MAX_BYTES} 字节上限。`);
    }
    const contentType = params.picContentType?.trim() || parsed?.contentType || "image/jpeg";
    return {
      data,
      contentType,
      filename: normalizePicFilename(params.picFilename, contentType),
    };
  }

  const picUrl = params.picUrl?.trim();
  if (!picUrl) {
    throw new Error("缺少 picUrl 或 picBase64。");
  }
  let url: URL;
  try {
    url = new URL(picUrl);
  } catch {
    throw new Error("picUrl 不是合法 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("picUrl 仅支持 http/https。");
  }
  const response = await fetch(picUrl);
  if (!response.ok) {
    throw new Error(`下载图片失败：HTTP ${response.status}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) {
    throw new Error("图片为空。");
  }
  if (data.length > WEIBO_PIC_MAX_BYTES) {
    throw new Error(`图片超过 ${WEIBO_PIC_MAX_BYTES} 字节上限。`);
  }
  const contentType =
    params.picContentType?.trim() ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "image/jpeg";
  return {
    data,
    contentType,
    filename: normalizePicFilename(params.picFilename, contentType),
  };
}

export async function verifyWeiboAccessToken(params: {
  accessToken: string;
}): Promise<{ uid: string; screenName?: string }> {
  const query = new URLSearchParams({ access_token: params.accessToken });
  const uidResponse = await fetch(`${WEIBO_API_BASE}/account/get_uid.json?${query.toString()}`);
  const uidPayload = await parseWeiboJsonResponse<{ uid?: number | string }>(
    uidResponse,
    "/account/get_uid",
  );
  const uid = uidPayload.uid != null ? String(uidPayload.uid) : "";
  if (!uid) {
    throw new Error("Weibo token 验证失败：缺少 uid。");
  }

  let screenName: string | undefined;
  try {
    const showQuery = new URLSearchParams({
      access_token: params.accessToken,
      uid,
    });
    const showResponse = await fetch(`${WEIBO_API_BASE}/users/show.json?${showQuery.toString()}`);
    const showPayload = await parseWeiboJsonResponse<{ screen_name?: string }>(
      showResponse,
      "/users/show",
    );
    screenName = showPayload.screen_name?.trim() || undefined;
  } catch {
    // users/show 失败不阻断 verify；uid 已足够证明 token 有效。
  }

  return { uid, screenName };
}

export async function uploadWeiboPic(params: {
  accessToken: string;
  picUrl?: string;
  picBase64?: string;
  picFilename?: string;
  picContentType?: string;
}): Promise<{ picId: string; picMd5?: string; picBytes: number; picFilename: string }> {
  const image = await loadWeiboPicImage(params);
  const form = new FormData();
  form.append("access_token", params.accessToken);
  form.append(
    "pic",
    new Blob([new Uint8Array(image.data)], { type: image.contentType }),
    image.filename,
  );
  const response = await fetch(`${WEIBO_UPLOAD_BASE}/statuses/upload_pic.json`, {
    method: "POST",
    body: form,
  });
  const payload = await parseWeiboJsonResponse<{ pic_id?: string; pic_md5?: string }>(
    response,
    "/statuses/upload_pic",
  );
  const picId = payload.pic_id?.trim();
  if (!picId) {
    throw new Error("微博 upload_pic 未返回 pic_id。");
  }
  return {
    picId,
    picMd5: payload.pic_md5?.trim() || undefined,
    picBytes: image.data.length,
    picFilename: image.filename,
  };
}

export async function postWeiboStatus(params: {
  accessToken: string;
  status: string;
  picId?: string;
  visible?: number;
}): Promise<{ id?: string | number; idstr?: string; mid?: string; createdAt?: string }> {
  const body = new URLSearchParams({
    access_token: params.accessToken,
    status: params.status,
  });
  if (params.picId?.trim()) {
    body.set("pic_id", params.picId.trim());
  }
  if (params.visible != null) {
    body.set("visible", String(params.visible));
  }
  const response = await fetch(`${WEIBO_API_BASE}/statuses/update.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await parseWeiboJsonResponse<{
    id?: string | number;
    idstr?: string;
    mid?: string;
    created_at?: string;
  }>(response, "/statuses/update");
  return {
    id: payload.id,
    idstr: payload.idstr,
    mid: payload.mid,
    createdAt: payload.created_at,
  };
}

export async function postWeiboStatusWithPic(params: {
  accessToken: string;
  status: string;
  picUrl?: string;
  picBase64?: string;
  picFilename?: string;
  picContentType?: string;
  visible?: number;
}): Promise<{ id?: string | number; idstr?: string; mid?: string; createdAt?: string }> {
  const image = await loadWeiboPicImage(params);
  const form = new FormData();
  form.append("access_token", params.accessToken);
  form.append("status", params.status);
  form.append(
    "pic",
    new Blob([new Uint8Array(image.data)], { type: image.contentType }),
    image.filename,
  );
  if (params.visible != null) {
    form.append("visible", String(params.visible));
  }
  const response = await fetch(`${WEIBO_UPLOAD_BASE}/statuses/upload.json`, {
    method: "POST",
    body: form,
  });
  const payload = await parseWeiboJsonResponse<{
    id?: string | number;
    idstr?: string;
    mid?: string;
    created_at?: string;
  }>(response, "/statuses/upload");
  return {
    id: payload.id,
    idstr: payload.idstr,
    mid: payload.mid,
    createdAt: payload.created_at,
  };
}

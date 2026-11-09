/**
 * User-token reader for one Feishu docx API.
 *
 * Docs, not Measured: Feishu documents
 * `GET /open-apis/docx/v1/documents/:document_id` and
 * `GET /open-apis/docx/v1/documents/:document_id/raw_content`
 * (https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content).
 * Both accept user_access_token. Scopes named there are `docx:document` or
 * `docx:document:readonly`. This tree has not observed that call in a target
 * enterprise. A tenant config boolean `measured.projectDocs: true` is not that
 * observation. Group history is not this reader.
 *
 * The caller must already have passed the slice 2 decision and the resource
 * whitelist. This function never sends, and it never uses an app token.
 */
import type { EnterpriseImUserDocReadResult } from "./enterprise-im-employee-read.js";

export const FEISHU_USER_DOCX_RAW_CONTENT_API =
  "GET /open-apis/docx/v1/documents/:document_id/raw_content";

export const FEISHU_USER_DOCX_META_API = "GET /open-apis/docx/v1/documents/:document_id";

const FEISHU_OPEN_API = "https://open.feishu.cn/open-apis/docx/v1/documents";

const DOC_URL = /https?:\/\/[^\s"'<>]+\/(?:docx|wiki|docs)\/([A-Za-z0-9]{27})\b/g;
const BARE_DOC_TOKEN = /\b((?:dox|wik|doc)[A-Za-z0-9]{24})\b/g;
const CHAT_ID = /\boc_[0-9A-Za-z]{16,}\b/g;

const INVALID_TOKEN_CODES = new Set([99991663, 99991668]);
const RATE_LIMIT_CODES = new Set([99991400]);
const NOT_FOUND_CODES = new Set([1770002, 1770003]);

export function extractFeishuResourceIds(value: string): string[] {
  const found = new Set<string>();
  for (const match of value.matchAll(DOC_URL)) {
    const token = match[1];
    if (token) {
      found.add(token);
    }
  }
  for (const match of value.matchAll(BARE_DOC_TOKEN)) {
    const token = match[1];
    if (token) {
      found.add(token);
    }
  }
  for (const match of value.matchAll(CHAT_ID)) {
    found.add(match[0]);
  }
  return [...found];
}

type FeishuEnvelope = {
  code?: number;
  msg?: string;
  data?: {
    document?: { document_id?: string; revision_id?: number; title?: string };
    content?: string;
  };
};

function classify(httpStatus: number, code: number): EnterpriseImUserDocReadResult | null {
  if (code === 0 && httpStatus < 400) {
    return null;
  }
  if (httpStatus === 401 || INVALID_TOKEN_CODES.has(code)) {
    return { ok: false, kind: "invalid_user_token", message: "用户令牌无效。" };
  }
  if (httpStatus === 429 || RATE_LIMIT_CODES.has(code)) {
    return { ok: false, kind: "rate_limited", message: "飞书文档读取被限流。" };
  }
  if (httpStatus === 404 || NOT_FOUND_CODES.has(code)) {
    return { ok: false, kind: "not_found", message: "飞书文档不存在或已删除。" };
  }
  return { ok: false, kind: "rejected", message: "飞书拒绝了这次文档读取。" };
}

async function feishuGet(params: {
  url: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<{ httpStatus: number; body: FeishuEnvelope } | { network: true }> {
  let response: Response;
  try {
    response = await params.fetchImpl(params.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    return { network: true };
  }
  let body: FeishuEnvelope = {};
  try {
    body = (await response.json()) as FeishuEnvelope;
  } catch {
    body = {};
  }
  return { httpStatus: response.status, body };
}

/** Reads one docx with the employee user token. Does not follow links. */
export async function readFeishuUserDocx(params: {
  resourceId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<EnterpriseImUserDocReadResult> {
  const documentId = params.resourceId.trim();
  const fetchImpl = params.fetchImpl ?? fetch;
  const headersToken = params.accessToken;
  const metaUrl = `${FEISHU_OPEN_API}/${encodeURIComponent(documentId)}`;
  const meta = await feishuGet({ url: metaUrl, accessToken: headersToken, fetchImpl });
  if ("network" in meta) {
    return { ok: false, kind: "network", message: "飞书文档读取没有完成。" };
  }
  const metaCode =
    typeof meta.body.code === "number" ? meta.body.code : meta.httpStatus >= 400 ? -1 : 0;
  const metaFailure = classify(meta.httpStatus, metaCode);
  if (metaFailure) {
    return metaFailure;
  }
  const returnedId = meta.body.data?.document?.document_id?.trim() || "";
  if (!returnedId || returnedId !== documentId) {
    return {
      ok: false,
      kind: "resource_id_mismatch",
      returnedId,
      message: "返回的文档编号与授权请求不一致。",
    };
  }
  const raw = await feishuGet({
    url: `${metaUrl}/raw_content`,
    accessToken: headersToken,
    fetchImpl,
  });
  if ("network" in raw) {
    return { ok: false, kind: "network", message: "飞书文档读取没有完成。" };
  }
  const rawCode =
    typeof raw.body.code === "number" ? raw.body.code : raw.httpStatus >= 400 ? -1 : 0;
  const rawFailure = classify(raw.httpStatus, rawCode);
  if (rawFailure) {
    return rawFailure;
  }
  const content = raw.body.data?.content ?? "";
  const revision = meta.body.data?.document?.revision_id;
  return {
    ok: true,
    doc: {
      resourceId: returnedId,
      title: meta.body.data?.document?.title?.trim() || returnedId,
      updatedAt: "",
      revisionId: revision === undefined ? "" : String(revision),
      body: content,
      links: extractFeishuResourceIds(content).filter((id) => id !== returnedId),
    },
  };
}

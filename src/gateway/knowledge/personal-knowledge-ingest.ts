import { createHash } from "node:crypto";
import { listAgentIds, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { describeImageWithModel } from "../../media-understanding/providers/image-runtime.js";
import { resolveAutoImageModel } from "../../media-understanding/runner.js";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import { ownershipProofFromLocalUser } from "../data-governance/ownership-proof.js";
import type { GovernanceOwnershipProof } from "../data-governance/write-gate.js";
import type { GatewayClient } from "../server-methods/types.js";
import { getPersonalSkillAssetDetail, type EmployeeSkillDetail } from "../skill-lifecycle-store.js";
import { resolveAgentDirForClient } from "../tenant-context.js";
import { recordDatasetSchemaForDocument } from "./dataset-schema-store.js";
import { knowledgeDocumentIdFromSkillRef } from "./document-display-title.js";
import {
  type KnowledgeIngestParseOptions,
  resolveChunkingFromStrategy,
} from "./ingest-parse-options.js";
import {
  ingestKnowledgeDocument,
  resolveKnowledgeIngestEmbeddingProvider,
  type IngestKnowledgeDocumentResult,
} from "./kb-ingest.js";
import {
  attachDocumentToKnowledgeBase,
  getKnowledgeBase,
  KnowledgeBaseStoreError,
  type KnowledgeBase,
} from "./knowledge-base-store.js";
import {
  resolveKnowledgeDirectoryLayoutForBase,
  resolveKnowledgeIndexRootForBase,
} from "./knowledge-directory.js";
import { persistKnowledgeOriginal } from "./knowledge-original-store.js";
import {
  buildPersonalDocumentUploadDescription,
  isUnparsedDocumentPlaceholder,
  type PersonalDocumentUploadAttachment,
} from "./personal-document-upload.js";
import { parsePersonalObjectId } from "./personal-mutations.js";
import { recordWebSourceSnapshot } from "./web-source-snapshot-store.js";

export type PersonalKnowledgeIngestOutcome = {
  attempted: boolean;
  skipped: boolean;
  reason?: string;
  chunkCount?: number;
  versionLabel?: string | null;
  delta?: IngestKnowledgeDocumentResult["delta"];
  vectorizeQueued?: boolean;
  error?: string;
};

export function normalizePersonalDocumentId(documentId: string): string | null {
  const trimmed = documentId.trim();
  if (!trimmed) {
    return null;
  }
  return parsePersonalObjectId(trimmed) ?? trimmed;
}

function decodeAttachmentDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:[^;]+;base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!match?.[1]) {
    return null;
  }
  return Buffer.from(match[1], "base64");
}

export function attachmentToSourceBuffer(
  attachment: PersonalDocumentUploadAttachment,
): { fileName: string; mimeType: string; buffer: Buffer } | null {
  if (attachment.kind === "text" && attachment.textContent?.trim()) {
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType || "text/plain",
      buffer: Buffer.from(attachment.textContent, "utf8"),
    };
  }
  if ((attachment.kind === "binary" || attachment.kind === "image") && attachment.dataUrl) {
    const buffer = decodeAttachmentDataUrl(attachment.dataUrl);
    if (!buffer) {
      return null;
    }
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType || "application/octet-stream",
      buffer,
    };
  }
  return null;
}

export function attachmentToIngestBuffer(
  attachment: PersonalDocumentUploadAttachment,
): { fileName: string; mimeType: string; buffer: Buffer } | null {
  if (attachment.kind === "text" && attachment.textContent?.trim()) {
    return {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType || "text/plain",
      buffer: Buffer.from(attachment.textContent, "utf8"),
    };
  }
  if (attachment.kind === "binary") {
    return attachmentToSourceBuffer(attachment);
  }
  const description = buildPersonalDocumentUploadDescription(attachment).trim();
  if (!description) {
    return null;
  }
  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType || "application/octet-stream",
    buffer: Buffer.from(description, "utf8"),
  };
}

function attachmentExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function fileStem(fileName: string): string {
  const extension = attachmentExtension(fileName);
  if (!extension) {
    return fileName.trim();
  }
  return fileName.slice(0, -extension.length).trim() || fileName.trim();
}

const KNOWLEDGE_IMAGE_OCR_PROMPT = [
  "Perform OCR on this knowledge-upload image.",
  "Extract all readable text faithfully.",
  "Preserve line breaks and table-like structure when possible.",
  "If there is little or no readable text, provide a concise factual description of visible content.",
  "Return only the extracted content without preamble.",
].join(" ");

export function validateAttachmentForKnowledgeIngest(
  attachment: PersonalDocumentUploadAttachment,
): string | null {
  if (attachment.kind === "text" && attachment.textContent?.trim()) {
    return null;
  }
  if (attachment.kind === "binary") {
    const extension = attachmentExtension(attachment.fileName);
    if (extension === ".pdf" || attachment.mimeType === "application/pdf") {
      return attachment.dataUrl?.trim()
        ? null
        : "PDF 文件缺少原始字节，无法建立知识索引，请升级前端后重试";
    }
    if (
      extension === ".docx" ||
      attachment.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return attachment.dataUrl?.trim()
        ? null
        : "DOCX 文件缺少原始字节，无法建立知识索引，请升级前端后重试";
    }
    if (
      extension === ".xlsx" ||
      attachment.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      return attachment.dataUrl?.trim()
        ? null
        : "XLSX 文件缺少原始字节，无法建立知识索引，请升级前端后重试";
    }
    if (
      extension === ".pptx" ||
      attachment.mimeType ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      return attachment.dataUrl?.trim()
        ? null
        : "PPTX 文件缺少原始字节，无法建立知识索引，请升级前端后重试";
    }
    return "当前知识解析仅支持文本/Markdown/CSV、PDF、DOCX、XLSX 与 PPTX；旧版 Word/Excel/PPT 等格式暂不支持索引入库";
  }
  if (attachment.kind === "image") {
    return attachment.dataUrl?.trim()
      ? null
      : "图片缺少原始字节，无法执行 OCR 建立知识索引，请升级前端后重试";
  }
  return "当前附件无法形成可检索知识内容";
}

export async function extractImageTextForKnowledge(params: {
  attachment: PersonalDocumentUploadAttachment;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
}): Promise<string> {
  const source = attachmentToSourceBuffer(params.attachment);
  if (!source) {
    throw new Error("image attachment missing source bytes");
  }
  const cfg = params.cfg ?? loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const agentDir = await resolveAgentDirForClient(params.client ?? null, agentId, cfg);
  const activeModel = await resolveAutoImageModel({ cfg, agentDir });
  if (!activeModel?.provider || !activeModel.model) {
    throw new Error("未配置可用视觉模型，无法为图片建立 OCR 索引");
  }
  const result = await describeImageWithModel({
    buffer: source.buffer,
    fileName: source.fileName,
    mime: source.mimeType,
    provider: activeModel.provider,
    model: activeModel.model,
    prompt: KNOWLEDGE_IMAGE_OCR_PROMPT,
    maxTokens: 1200,
    timeoutMs: 60_000,
    agentDir,
    cfg,
  });
  const text = result.text.trim();
  if (!text) {
    throw new Error("图片未识别到可入库内容");
  }
  return text;
}

export function collectedKnowledgeToIngestBuffer(params: { title: string; summary: string }): {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
} {
  const title = params.title.trim();
  const summary = params.summary.trim();
  const safeName = title.replace(/[^\w\u4e00-\u9fff-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    fileName: `${safeName || "collected"}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${title}\n\n${summary}`, "utf8"),
  };
}

function fileNameFromUploadInputDescription(inputDescription: string): string | null {
  const marker = "知识宇宙文档上传: ";
  const index = inputDescription.indexOf(marker);
  if (index < 0) {
    return null;
  }
  const fileName = inputDescription.slice(index + marker.length).trim();
  return fileName || null;
}

export function skillDetailToIngestPayload(
  detail: EmployeeSkillDetail,
): { fileName: string; mimeType: string; buffer: Buffer } | null {
  const output = detail.profile.outputDescription?.trim();
  const summary = detail.profile.summary?.trim();
  const text = output || summary;
  if (!text) {
    return null;
  }
  const uploadedName = detail.profile.inputDescription
    ? fileNameFromUploadInputDescription(detail.profile.inputDescription)
    : null;
  const fileName = uploadedName ?? `${detail.profile.name || detail.id}.md`;
  const mimeType =
    fileName.endsWith(".pdf") || detail.profile.inputDescription?.includes(".pdf")
      ? "application/pdf"
      : fileName.endsWith(".md") || fileName.endsWith(".markdown")
        ? "text/markdown"
        : "text/plain";
  return {
    fileName,
    mimeType,
    buffer: Buffer.from(text, "utf8"),
  };
}

async function resolveIngestEmbeddingProvider(
  cfg?: OpenBotConfig,
  client?: GatewayClient | null,
): Promise<EmbeddingProvider | null> {
  const config = cfg ?? loadConfig();
  for (const agentId of listAgentIds(config)) {
    try {
      const provider = await resolveKnowledgeIngestEmbeddingProvider({
        cfg: config,
        agentId,
        client,
      });
      if (provider) {
        return provider;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function assertOwnedKnowledgeBase(params: {
  knowledgeBaseId: string;
  ownerId: string;
  storePath?: string;
}): KnowledgeBase {
  const knowledgeBase = getKnowledgeBase(params.knowledgeBaseId, params.storePath);
  if (!knowledgeBase || knowledgeBase.ownerId !== params.ownerId) {
    throw new KnowledgeBaseStoreError("not authorized to ingest into knowledge base");
  }
  return knowledgeBase;
}

export async function ingestKnowledgePayloadToBase(params: {
  knowledgeBase: KnowledgeBase;
  documentId: string;
  title: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  ownerId: string;
  sourceName?: string;
  indexRoot?: string;
  originalsRoot?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  parseOptions?: KnowledgeIngestParseOptions;
  /** Trusted proof from authenticated call entry — required when knowledgeBase.tenantId is set. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
  deferEmbedding?: boolean;
}): Promise<PersonalKnowledgeIngestOutcome> {
  if (params.buffer.length === 0) {
    return { attempted: true, skipped: true, reason: "empty content" };
  }
  if (isUnparsedDocumentPlaceholder(params.buffer.toString("utf8"))) {
    return { attempted: false, skipped: true, reason: "unparsed placeholder" };
  }
  // Persist originals before extract/index so a later first-reference can reuse bytes
  // when this ingest attempt fails (parser/governance) without asking the user to re-upload.
  const layout = resolveKnowledgeDirectoryLayoutForBase(params.knowledgeBase);
  const originalsRoot = params.originalsRoot ?? layout.originalsRoot;
  const indexRoot = resolveKnowledgeIndexRootForBase(params.knowledgeBase, {
    indexRoot: params.indexRoot,
  });
  try {
    persistKnowledgeOriginal({
      kbId: params.knowledgeBase.id,
      docId: params.documentId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      buffer: params.buffer,
      originalsRoot,
    });
  } catch {
    // Preview store must not fail indexing.
  }
  try {
    const embeddingProvider =
      params.embeddingProvider !== undefined
        ? params.embeddingProvider
        : await resolveIngestEmbeddingProvider(params.cfg, params.client);
    const tenantId = params.knowledgeBase.tenantId?.trim() || null;
    const governanceOwnershipProof =
      params.governanceOwnershipProof ??
      (tenantId ? undefined : ownershipProofFromLocalUser({ userId: params.ownerId }));
    if (tenantId && !governanceOwnershipProof) {
      return {
        attempted: true,
        skipped: true,
        error: "governance_write_denied:missing_ownership_proof",
      };
    }
    const result = await ingestKnowledgeDocument({
      kbId: params.knowledgeBase.id,
      docId: params.documentId,
      title: params.title,
      fileName: params.fileName,
      mimeType: params.mimeType,
      buffer: params.buffer,
      ownerId: params.ownerId,
      tenantId: params.knowledgeBase.tenantId,
      visibility: params.knowledgeBase.visibility,
      source: params.sourceName ?? params.fileName,
      indexRoot,
      embeddingProvider,
      chunking: resolveChunkingFromStrategy(params.parseOptions?.chunkingStrategy),
      ocrEnabled: params.parseOptions?.ocrEnabled,
      cfg: params.cfg,
      governanceOwnershipProof,
      deferEmbedding: params.deferEmbedding === true,
    });
    // Best-effort dataset schema extraction for tabular uploads (CSV/TSV/JSON). Returns
    // without opening the index for non-tabular content, so free-text docs are untouched.
    try {
      await recordDatasetSchemaForDocument({
        knowledgeBase: params.knowledgeBase,
        docId: params.documentId,
        text: params.buffer.toString("utf8"),
        fileName: params.fileName,
        mimeType: params.mimeType,
        ...(indexRoot ? { indexRoot } : {}),
      });
    } catch {
      // ignore schema-extraction failures
    }
    return {
      attempted: true,
      skipped: result.skipped,
      reason: result.skipped ? result.delta : undefined,
      chunkCount: result.chunkCount,
      versionLabel: result.versionLabel,
      delta: result.delta,
      ...(result.vectorizeQueued ? { vectorizeQueued: true } : {}),
    };
  } catch (error) {
    return {
      attempted: true,
      skipped: true,
      error: error instanceof Error ? error.message : "ingest failed",
    };
  }
}

export async function ingestUploadedPersonalKnowledge(params: {
  knowledgeBaseId: string;
  skillId: string;
  title: string;
  ownerId: string;
  attachment: PersonalDocumentUploadAttachment;
  imageOcrText?: string;
  knowledgeBase?: KnowledgeBase;
  storePath?: string;
  indexRoot?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  parseOptions?: KnowledgeIngestParseOptions;
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<PersonalKnowledgeIngestOutcome> {
  const validationError = validateAttachmentForKnowledgeIngest(params.attachment);
  if (validationError) {
    return { attempted: false, skipped: true, reason: validationError, error: validationError };
  }
  const payload =
    params.attachment.kind === "image"
      ? {
          fileName: `${fileStem(params.attachment.fileName) || params.skillId}.md`,
          mimeType: "text/markdown",
          buffer: Buffer.from(
            `# ${params.title}\n\n来源图片: ${params.attachment.fileName}\n\n${
              params.imageOcrText ??
              (await extractImageTextForKnowledge({
                attachment: params.attachment,
                cfg: params.cfg,
                client: params.client,
              }))
            }`,
            "utf8",
          ),
        }
      : attachmentToIngestBuffer(params.attachment);
  if (!payload) {
    return { attempted: false, skipped: true, reason: "no ingestible attachment content" };
  }
  const knowledgeBase =
    params.knowledgeBase ??
    assertOwnedKnowledgeBase({
      knowledgeBaseId: params.knowledgeBaseId,
      ownerId: params.ownerId,
      storePath: params.storePath,
    });
  return ingestKnowledgePayloadToBase({
    knowledgeBase,
    documentId: knowledgeDocumentIdFromSkillRef(knowledgeBase.id, params.skillId),
    title: params.title,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    buffer: payload.buffer,
    ownerId: params.ownerId,
    sourceName: params.attachment.fileName,
    indexRoot: params.indexRoot,
    cfg: params.cfg,
    embeddingProvider: params.embeddingProvider,
    parseOptions: params.parseOptions,
    governanceOwnershipProof: params.governanceOwnershipProof,
  });
}

export async function ingestCollectedPersonalKnowledge(params: {
  knowledgeBaseId: string;
  skillId: string;
  title: string;
  summary: string;
  ownerId: string;
  knowledgeBase?: KnowledgeBase;
  storePath?: string;
  indexRoot?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<PersonalKnowledgeIngestOutcome> {
  const knowledgeBase =
    params.knowledgeBase ??
    assertOwnedKnowledgeBase({
      knowledgeBaseId: params.knowledgeBaseId,
      ownerId: params.ownerId,
      storePath: params.storePath,
    });
  const payload = collectedKnowledgeToIngestBuffer({
    title: params.title,
    summary: params.summary,
  });
  return ingestKnowledgePayloadToBase({
    knowledgeBase,
    documentId: knowledgeDocumentIdFromSkillRef(knowledgeBase.id, params.skillId),
    title: params.title,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    buffer: payload.buffer,
    ownerId: params.ownerId,
    indexRoot: params.indexRoot,
    cfg: params.cfg,
    embeddingProvider: params.embeddingProvider,
    governanceOwnershipProof: params.governanceOwnershipProof,
  });
}

export async function ingestAttachedPersonalKnowledgeDocument(params: {
  knowledgeBaseId: string;
  documentId: string;
  ownerId: string;
  knowledgeBase?: KnowledgeBase;
  storePath?: string;
  indexRoot?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  governanceOwnershipProof?: GovernanceOwnershipProof;
  deferEmbedding?: boolean;
}): Promise<PersonalKnowledgeIngestOutcome> {
  const skillId = normalizePersonalDocumentId(params.documentId);
  if (!skillId) {
    return { attempted: false, skipped: true, reason: "invalid documentId" };
  }
  const knowledgeBase =
    params.knowledgeBase ??
    assertOwnedKnowledgeBase({
      knowledgeBaseId: params.knowledgeBaseId,
      ownerId: params.ownerId,
      storePath: params.storePath,
    });
  let detail: EmployeeSkillDetail;
  try {
    detail = getPersonalSkillAssetDetail(skillId);
  } catch {
    return { attempted: false, skipped: true, reason: "personal document not found" };
  }
  const payload = skillDetailToIngestPayload(detail);
  if (!payload) {
    return { attempted: false, skipped: true, reason: "no ingestible document content" };
  }
  return ingestKnowledgePayloadToBase({
    knowledgeBase,
    documentId: knowledgeDocumentIdFromSkillRef(knowledgeBase.id, skillId),
    title: detail.profile.name,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    buffer: payload.buffer,
    ownerId: params.ownerId,
    indexRoot: params.indexRoot,
    cfg: params.cfg,
    embeddingProvider: params.embeddingProvider,
    governanceOwnershipProof: params.governanceOwnershipProof,
    deferEmbedding: params.deferEmbedding === true,
  });
}

export type WebPageFetchResult = { title?: string; text: string };
export type WebPageFetcher = (url: string) => Promise<WebPageFetchResult>;

const WEB_FETCH_TIMEOUT_MS = 15_000;
const WEB_FETCH_MAX_BYTES = 2_000_000;

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1] ? htmlToPlainText(match[1]) : "";
  return title || undefined;
}

async function defaultWebPageFetcher(url: string): Promise<WebPageFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) {
      throw new Error(`web fetch failed: HTTP ${response.status}`);
    }
    const raw = await response.text();
    const body = raw.length > WEB_FETCH_MAX_BYTES ? raw.slice(0, WEB_FETCH_MAX_BYTES) : raw;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("html") || /<html|<body|<div/i.test(body)) {
      return { title: extractHtmlTitle(body), text: htmlToPlainText(body) };
    }
    return { text: body.trim() };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch and extract readable text from a web page. Network access is injectable so
 * callers (and tests) stay explicit about outbound requests. Returns the extracted
 * plain text plus a best-effort page title.
 */
export async function fetchWebPageForKnowledge(params: {
  url: string;
  fetcher?: WebPageFetcher;
}): Promise<WebPageFetchResult> {
  return (params.fetcher ?? defaultWebPageFetcher)(params.url.trim());
}

/**
 * Ingest already-fetched web page content into a personal knowledge base, keyed by
 * the owning skill-asset id. The web reference therefore shows up as a KnowledgeObject
 * (like an uploaded document) AND is chunk-indexed for governance-aware retrieval, so
 * it reuses the same ingest → chunk → embed → index pipeline as file upload.
 */
export async function ingestWebReferencePersonalKnowledge(params: {
  knowledgeBaseId: string;
  skillId: string;
  title: string;
  url: string;
  text: string;
  ownerId: string;
  knowledgeBase?: KnowledgeBase;
  storePath?: string;
  indexRoot?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
}): Promise<PersonalKnowledgeIngestOutcome> {
  const text = params.text.trim();
  if (!text) {
    return { attempted: true, skipped: true, reason: "empty web content" };
  }
  const knowledgeBase =
    params.knowledgeBase ??
    assertOwnedKnowledgeBase({
      knowledgeBaseId: params.knowledgeBaseId,
      ownerId: params.ownerId,
      storePath: params.storePath,
    });
  const title = params.title.trim() || params.url;
  const documentId = knowledgeDocumentIdFromSkillRef(knowledgeBase.id, params.skillId);
  const outcome = await ingestKnowledgePayloadToBase({
    knowledgeBase,
    documentId,
    title,
    fileName: `${documentId}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${title}\n\n来源: ${params.url}\n\n${text}`, "utf8"),
    ownerId: params.ownerId,
    indexRoot: params.indexRoot,
    cfg: params.cfg,
    embeddingProvider: params.embeddingProvider,
  });
  // Record a web-source snapshot keyed by url so re-collecting the same page tracks
  // real change rate over time. Best-effort: never let snapshot bookkeeping break ingest.
  if (outcome.attempted && !outcome.error) {
    try {
      await recordWebSourceSnapshot({
        knowledgeBase,
        docId: documentId,
        url: params.url,
        text,
        ...(params.indexRoot ? { indexRoot: params.indexRoot } : {}),
      });
    } catch {
      // ignore snapshot failures
    }
  }
  return outcome;
}

export type DatasetImportRecord = { title?: string; text: string };

export type DatasetImportOutcome = {
  attempted: boolean;
  imported: number;
  skipped: number;
  chunkCount: number;
  documentIds: string[];
};

const DATASET_IMPORT_MAX_RECORDS = 200;

/**
 * Bulk-import a dataset (a batch of text records) into a personal knowledge base as
 * passive, chunk-indexed documents — the multi-source input path for "数据导入". Each
 * record becomes a stable per-dataset document (`dataset:<hash>:<index>`) so re-importing
 * the same dataset title updates the same documents instead of duplicating them. Records
 * are NOT turned into individual KnowledgeObjects (avoids object explosion); they are
 * attached to the KB and reachable by governance-aware retrieval, like uploaded docs.
 */
export async function importDatasetPersonalKnowledge(params: {
  knowledgeBaseId: string;
  datasetTitle: string;
  records: DatasetImportRecord[];
  ownerId: string;
  knowledgeBase?: KnowledgeBase;
  storePath?: string;
  indexRoot?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  maxRecords?: number;
}): Promise<DatasetImportOutcome> {
  const knowledgeBase =
    params.knowledgeBase ??
    assertOwnedKnowledgeBase({
      knowledgeBaseId: params.knowledgeBaseId,
      ownerId: params.ownerId,
      storePath: params.storePath,
    });
  const datasetTitle = params.datasetTitle.trim() || "数据集";
  const datasetId = `dataset:${createHash("sha256")
    .update(`${knowledgeBase.id}::${datasetTitle}`)
    .digest("hex")
    .slice(0, 20)}`;
  const cap = Math.min(params.records.length, params.maxRecords ?? DATASET_IMPORT_MAX_RECORDS);
  const outcome: DatasetImportOutcome = {
    attempted: true,
    imported: 0,
    skipped: 0,
    chunkCount: 0,
    documentIds: [],
  };
  for (let index = 0; index < cap; index += 1) {
    const text = params.records[index]?.text?.trim() ?? "";
    if (!text) {
      outcome.skipped += 1;
      continue;
    }
    const title = params.records[index]?.title?.trim() || `${datasetTitle} #${index + 1}`;
    const documentId = `${datasetId}:${index}`;
    const result = await ingestKnowledgePayloadToBase({
      knowledgeBase,
      documentId,
      title,
      fileName: `${documentId}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(`# ${title}\n\n${text}`, "utf8"),
      ownerId: params.ownerId,
      indexRoot: params.indexRoot,
      cfg: params.cfg,
      embeddingProvider: params.embeddingProvider,
    });
    attachDocumentToKnowledgeBase(knowledgeBase.id, documentId, params.storePath);
    outcome.documentIds.push(documentId);
    if (result.skipped) {
      outcome.skipped += 1;
    } else {
      outcome.imported += 1;
      outcome.chunkCount += result.chunkCount ?? 0;
    }
  }
  return outcome;
}

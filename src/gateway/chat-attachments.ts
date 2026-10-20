import { estimateBase64DecodedBytes } from "../media/base64.js";
import { extractFileContentFromSource, resolveInputFileLimits } from "../media/input-files.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  assetId?: string;
  versionId?: string;
  contentHash?: string;
  sizeBytes?: number;
  lastModified?: number;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
  fileName?: string;
};

/** Non-image upload kept as binary so agents can open the real file (xlsx/docx/…), not only text extract. */
export type ChatFileContent = {
  type: "file";
  data: string;
  mimeType: string;
  fileName: string;
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
  /** Original file bytes (base64) for workspace staging — present even when text was also extracted. */
  files: ChatFileContent[];
};

type AttachmentLog = {
  warn?: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
};

export const DEFAULT_CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

type ParseMessageWithAttachmentsOptions = {
  /**
   * Legacy single limit. When provided, it applies to both images and files.
   */
  maxBytes?: number;
  imageMaxBytes?: number;
  fileMaxBytes?: number;
  log?: AttachmentLog;
};

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = mime.split(";")[0]?.trim().toLowerCase();
  return cleaned || undefined;
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

function isLikelyImageAttachment(att: ChatAttachment, normalized: NormalizedAttachment): boolean {
  const mime = normalizeMime(normalized.mime);
  if (isImageMime(mime)) {
    return true;
  }
  const type = typeof att.type === "string" ? att.type.trim().toLowerCase() : "";
  return type === "image";
}

const XML_ESCAPE_MAP: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&apos;",
};

function xmlEscapeAttr(value: string): string {
  return value.replace(/[<>&"']/g, (char) => XML_ESCAPE_MAP[char] ?? char);
}

function escapeFileBlockContent(value: string): string {
  return value.replace(/<\s*\/\s*file\s*>/gi, "&lt;/file&gt;").replace(/<\s*file\b/gi, "&lt;file");
}

function buildAttachmentNotice(params: {
  name: string;
  mime: string;
  extracted: boolean;
  stagedHint?: boolean;
}) {
  let suffix: string;
  if (params.stagedHint && params.extracted) {
    suffix =
      "content extracted below; binary also staged for tools — prefer reading the staged file (media/inbound/<filename> after sandbox staging) for sheet/structure-preserving work. Do NOT ask the user to re-upload the same file";
  } else if (params.stagedHint) {
    suffix =
      "binary staged for tools — prefer reading the staged file (media/inbound/<filename> after sandbox staging). Do NOT ask the user to re-upload the same file";
  } else if (params.extracted) {
    suffix = "content extracted below";
  } else {
    suffix =
      "content could not be extracted; use the filename and ask the user for a supported copy if needed";
  }
  const status = params.stagedHint
    ? params.extracted
      ? "extracted_and_staged"
      : "staged"
    : params.extracted
      ? "extracted"
      : "received";
  return `<attachment name="${xmlEscapeAttr(params.name)}" mime="${xmlEscapeAttr(params.mime || "")}" status="${status}">${suffix}</attachment>`;
}

function buildImageAttachmentNotice(params: { name: string; mime: string }) {
  return `<attachment name="${xmlEscapeAttr(params.name)}" mime="${xmlEscapeAttr(params.mime || "")}" status="image_input">image content is attached to this message as a vision/media input; do not look for a local file by this filename unless a media attached path is also provided</attachment>`;
}

function isValidBase64(value: string): boolean {
  // Iterative validation: avoid regex on multi‑MB payloads (engine-dependent recursion risk).
  if (!value || value.length % 4 !== 0) {
    return false;
  }
  let padding = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isAlpha =
      (code >= 48 && code <= 57) || // 0-9
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      code === 43 || // +
      code === 47; // /
    if (isAlpha) {
      if (padding > 0) {
        return false;
      }
      continue;
    }
    if (code === 61) {
      // =
      padding += 1;
      if (padding > 2) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

function isAttachmentProcessingFatal(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /exceeds size limit|invalid base64|content must be base64/i.test(message);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...").
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64 };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text and an array of image content blocks
 * compatible with Claude API's image format.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: ParseMessageWithAttachmentsOptions,
): Promise<ParsedMessageWithImages> {
  const imageMaxBytes =
    opts?.maxBytes ?? opts?.imageMaxBytes ?? DEFAULT_CHAT_IMAGE_ATTACHMENT_MAX_BYTES;
  const fileMaxBytes =
    opts?.maxBytes ?? opts?.fileMaxBytes ?? DEFAULT_CHAT_FILE_ATTACHMENT_MAX_BYTES;
  const log = opts?.log;
  if (!attachments || attachments.length === 0) {
    return { message, images: [], files: [] };
  }

  const images: ChatImageContent[] = [];
  const files: ChatFileContent[] = [];
  const fileContexts: string[] = [];
  const attachmentNotices: string[] = [];
  const fileLimits = resolveInputFileLimits({
    allowUrl: false,
    maxBytes: fileMaxBytes,
  });

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    // Isolate each attachment: PDF/ebook parsers (pdfjs) and large base64 paths must not
    // abort the whole chat.send with an uncaught RangeError / stack overflow.
    try {
      const normalized = normalizeAttachment(att, idx, {
        stripDataUrlPrefix: true,
        requireImageMime: false,
      });
      const maxBytes = isLikelyImageAttachment(att, normalized) ? imageMaxBytes : fileMaxBytes;
      validateAttachmentBase64OrThrow(normalized, { maxBytes });
      const { base64: b64, label, mime } = normalized;

      const providedMime = normalizeMime(mime);
      const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
      const effectiveMime = sniffedMime ?? providedMime ?? mime;
      if (sniffedMime && providedMime && sniffedMime !== providedMime) {
        log?.warn?.(
          `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
        );
      }

      if (!isImageMime(effectiveMime)) {
        let extracted = false;
        const fileName = att.fileName || label;
        let file:
          | Awaited<ReturnType<typeof extractFileContentFromSource>>
          | { filename: string; text?: string; images?: ChatImageContent[] };
        try {
          file = await extractFileContentFromSource({
            source: {
              type: "base64",
              data: b64,
              mediaType: effectiveMime,
              filename: fileName,
            },
            limits: fileLimits,
          });
        } catch (err) {
          log?.warn?.(`attachment ${label}: content extraction failed (${String(err)})`);
          file = { filename: fileName };
        }
        if (file.text?.trim()) {
          extracted = true;
          fileContexts.push(
            `<file name="${xmlEscapeAttr(file.filename)}" mime="${xmlEscapeAttr(effectiveMime || "")}">\n${escapeFileBlockContent(file.text)}\n</file>`,
          );
        } else if (file.images && file.images.length > 0) {
          extracted = true;
          fileContexts.push(
            `<file name="${xmlEscapeAttr(file.filename)}" mime="${xmlEscapeAttr(effectiveMime || "")}">[PDF content rendered to images]</file>`,
          );
        }
        // Keep original bytes so chat.send can stage them into the agent workspace.
        files.push({
          type: "file",
          data: b64,
          mimeType: effectiveMime || "application/octet-stream",
          fileName: file.filename || fileName,
        });
        attachmentNotices.push(
          buildAttachmentNotice({
            name: file.filename || fileName,
            mime: effectiveMime || "",
            extracted,
            stagedHint: true,
          }),
        );
        if (file.images && file.images.length > 0) {
          images.push(...file.images);
        }
        continue;
      }

      images.push({
        type: "image",
        data: b64,
        mimeType: effectiveMime,
        fileName: att.fileName || label,
      });
      attachmentNotices.push(
        buildImageAttachmentNotice({
          name: att.fileName || label,
          mime: effectiveMime || "",
        }),
      );
    } catch (err) {
      const label =
        (typeof att.fileName === "string" && att.fileName.trim()) ||
        (typeof att.type === "string" && att.type.trim()) ||
        `attachment-${idx + 1}`;
      if (isAttachmentProcessingFatal(err)) {
        throw err;
      }
      log?.warn?.(
        `attachment ${label}: processing failed (${String(err)}); continuing without content`,
      );
      attachmentNotices.push(
        buildAttachmentNotice({
          name: label,
          mime: normalizeMime(att.mimeType) || "",
          extracted: false,
        }),
      );
    }
  }

  const fileContext = [...attachmentNotices, ...fileContexts].join("\n\n").trim();
  return {
    message: fileContext ? [message.trim(), fileContext].filter(Boolean).join("\n\n") : message,
    images,
    files,
  };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000; // 2 MB
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });
    const { base64, label, mime } = normalized;

    const safeLabel = label.replace(/\s+/g, "_");
    const dataUrl = `![${safeLabel}](data:${mime};base64,${base64})`;
    blocks.push(dataUrl);
  }

  if (blocks.length === 0) {
    return message;
  }
  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}

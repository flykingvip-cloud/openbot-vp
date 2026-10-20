export type PersonalDocumentUploadAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  kind: "text" | "image" | "binary";
  textContent?: string;
  dataUrl?: string;
};

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv"]);
const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".md",
  ".markdown",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

const MAX_TEXT_BYTES = 512_000;
const MAX_IMAGE_DATA_URL_BYTES = 768_000;
/** Shared with knowledge original-blob persistence (preview store). */
export const MAX_BINARY_DATA_URL_BYTES = 8_000_000;

/** Catalog-only stub written when Office/PDF bytes were registered but not extracted. */
export const UNPARSED_DOCUMENT_PLACEHOLDER = "已登记附件，Office/PDF 全文解析将在后续版本提供。";

export function isUnparsedDocumentPlaceholder(text: string): boolean {
  return text.includes("全文解析将在后续版本提供");
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

export function isSupportedPersonalDocument(fileName: string, mimeType: string): boolean {
  const extension = extensionOf(fileName);
  if (SUPPORTED_EXTENSIONS.has(extension)) {
    return true;
  }
  return mimeType.startsWith("text/") || mimeType.startsWith("image/");
}

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildPersonalDocumentUploadDescription(
  attachment: PersonalDocumentUploadAttachment,
): string {
  const header = `文档：${attachment.fileName} (${attachment.mimeType || "unknown"}, ${formatSize(attachment.size)})`;
  if (attachment.kind === "text" && attachment.textContent?.trim()) {
    return `${header}\n\n${attachment.textContent.trim()}`;
  }
  if (attachment.kind === "image" && attachment.dataUrl) {
    return `${header}\n\n[image:${attachment.fileName}]`;
  }
  return `${header}\n\n${UNPARSED_DOCUMENT_PLACEHOLDER}`;
}

export function derivePersonalDocumentTitle(
  attachment: PersonalDocumentUploadAttachment,
  fallbackTitle?: string,
): string {
  const trimmed = fallbackTitle?.trim();
  if (trimmed) {
    return trimmed;
  }
  const extension = extensionOf(attachment.fileName);
  if (!extension) {
    return attachment.fileName;
  }
  return attachment.fileName.slice(0, -extension.length) || attachment.fileName;
}

export function derivePersonalDocumentSummary(
  attachment: PersonalDocumentUploadAttachment,
  fallbackSummary?: string,
): string {
  const trimmed = fallbackSummary?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (attachment.kind === "text" && attachment.textContent?.trim()) {
    return attachment.textContent.trim().slice(0, 240);
  }
  return `上传文档 ${attachment.fileName}`;
}

export function derivePersonalDocumentTags(attachment: PersonalDocumentUploadAttachment): string[] {
  const extension = extensionOf(attachment.fileName).replace(/^\./, "");
  const tags = ["上传文档"];
  if (extension) {
    tags.push(extension);
  }
  if (attachment.kind === "image") {
    tags.push("图片");
  }
  return tags;
}

export async function readPersonalDocumentUpload(
  file: File,
): Promise<PersonalDocumentUploadAttachment> {
  if (!isSupportedPersonalDocument(file.name, file.type)) {
    throw new Error("unsupported document type");
  }
  const extension = extensionOf(file.name);
  if (
    TEXT_EXTENSIONS.has(extension) ||
    file.type.startsWith("text/") ||
    extension === ".md" ||
    extension === ".markdown"
  ) {
    if (file.size > MAX_TEXT_BYTES) {
      throw new Error("text document exceeds size limit");
    }
    return {
      fileName: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      kind: "text",
      textContent: await file.text(),
    };
  }
  const readAsDataUrl = () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const result = reader.result;
        resolve(typeof result === "string" ? result : "");
      });
      reader.addEventListener("error", () =>
        reject(reader.error ?? new Error("failed to read file")),
      );
      reader.readAsDataURL(file);
    });
  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_DATA_URL_BYTES) {
      throw new Error("image exceeds size limit");
    }
    const dataUrl = await readAsDataUrl();
    return {
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      kind: "image",
      dataUrl,
    };
  }
  if (file.size > MAX_BINARY_DATA_URL_BYTES) {
    throw new Error("binary document exceeds size limit");
  }
  const dataUrl = await readAsDataUrl();
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind: "binary",
    dataUrl,
  };
}

/** Max files accepted from a single folder upload (mirrors the dataset import cap). */
export const MAX_FOLDER_UPLOAD_FILES = 200;

export type FolderUploadReadResult = {
  attachments: PersonalDocumentUploadAttachment[];
  skipped: Array<{ fileName: string; reason: string }>;
};

function relativePathOf(file: File): string {
  const relative = (file.webkitRelativePath || "").trim();
  return relative || file.name;
}

/**
 * Reads a whole-folder selection (e.g. an `<input webkitdirectory multiple>`) into
 * ingestible attachments. Unsupported / oversized files are skipped with a reason
 * instead of aborting the entire batch, and each attachment's `fileName` preserves
 * the relative path so the folder structure survives into document titles. The
 * batch is capped to keep a single import bounded.
 */
export async function readPersonalDocumentUploadFolder(
  files: readonly File[],
  options?: { maxFiles?: number },
): Promise<FolderUploadReadResult> {
  const maxFiles = Math.max(1, options?.maxFiles ?? MAX_FOLDER_UPLOAD_FILES);
  const attachments: PersonalDocumentUploadAttachment[] = [];
  const skipped: Array<{ fileName: string; reason: string }> = [];
  for (const file of files) {
    const relativePath = relativePathOf(file);
    if (attachments.length >= maxFiles) {
      skipped.push({ fileName: relativePath, reason: "folder upload file limit reached" });
      continue;
    }
    if (!isSupportedPersonalDocument(file.name, file.type)) {
      skipped.push({ fileName: relativePath, reason: "unsupported document type" });
      continue;
    }
    try {
      const attachment = await readPersonalDocumentUpload(file);
      attachments.push(
        relativePath && relativePath !== attachment.fileName
          ? { ...attachment, fileName: relativePath }
          : attachment,
      );
    } catch (error) {
      skipped.push({
        fileName: relativePath,
        reason: error instanceof Error ? error.message : "failed to read file",
      });
    }
  }
  return { attachments, skipped };
}

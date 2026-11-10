/**
 * Attachment kind / MIME resolution for chat ingest and resume.
 * A Markdown or other non-image suffix must not be sent to the model as an image
 * just because a client declared image/* and sniffing found no magic bytes.
 */
import path from "node:path";

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

/** Extensions that must stay on the file path unless bytes themselves are a confirmed image. */
const NON_IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".xml",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

const VISION_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

export function isNonImageAttachmentFileName(fileName?: string | null): boolean {
  if (!fileName) {
    return false;
  }
  const ext = path.extname(fileName.split(/[\\/]/).pop() ?? "").toLowerCase();
  return NON_IMAGE_ATTACHMENT_EXTENSIONS.has(ext);
}

/**
 * Resolve attachment MIME from sniffed bytes, suffix, then declared type.
 * A Markdown/text suffix must not be sent to the model as an image just because
 * the client declared image/* or type=image and sniffing found no magic bytes.
 */
export function resolveAttachmentEffectiveMime(params: {
  fileName?: string;
  providedMime?: string;
  sniffedMime?: string;
}): string {
  const sniffed = normalizeMime(params.sniffedMime);
  const provided = normalizeMime(params.providedMime);
  const fileName = params.fileName?.trim() || "";
  if (isNonImageAttachmentFileName(fileName)) {
    // Trust confirmed image magic bytes even when the suffix is non-image.
    if (sniffed && VISION_IMAGE_MIME.has(sniffed)) {
      return sniffed;
    }
    if (provided && !isImageMime(provided)) {
      return provided;
    }
    const ext = path.extname(fileName.split(/[\\/]/).pop() ?? "").toLowerCase();
    if (ext === ".md" || ext === ".markdown") {
      return "text/markdown";
    }
    if (ext === ".csv") {
      return "text/csv";
    }
    if (ext === ".txt" || ext === ".text") {
      return "text/plain";
    }
    return sniffed && !isImageMime(sniffed) ? sniffed : provided && !isImageMime(provided) ? provided : "text/plain";
  }
  if (sniffed) {
    return sniffed;
  }
  return provided ?? params.providedMime ?? "";
}

/** Drop resume/history image parts whose suffix or MIME shows they are not vision images. */
export function sanitizeModelImageInputs<T extends { mimeType?: string; fileName?: string }>(
  images: readonly T[] | undefined,
): T[] {
  return (images ?? []).filter((image) => {
    if (isNonImageAttachmentFileName(image.fileName)) {
      return false;
    }
    const mime = normalizeMime(image.mimeType);
    return !mime || isImageMime(mime);
  });
}

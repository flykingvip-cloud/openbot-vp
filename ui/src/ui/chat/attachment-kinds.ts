/**
 * Composer attachment allowlist.
 *
 * The file picker `accept` attribute and the runtime check must stay in lockstep.
 * Browsers (especially Windows) often report an empty MIME or a vendor alias such
 * as `application/x-zip-compressed`, so extension matching is the fallback.
 */

export const CHAT_ATTACHMENT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-gtar",
] as const;

export const CHAT_ATTACHMENT_EXTENSIONS = [
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".csv",
  ".json",
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".tgz",
] as const;

const CHAT_ATTACHMENT_MIME_SET = new Set<string>(CHAT_ATTACHMENT_MIME_TYPES);

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  ...CHAT_ATTACHMENT_MIME_TYPES,
  ...CHAT_ATTACHMENT_EXTENSIONS,
].join(",");

function normalizedMime(type: string | undefined): string {
  return (type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function normalizedName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export function isSupportedAttachmentFile(file: { name?: string; type?: string }): boolean {
  const mime = normalizedMime(file.type);
  if (mime.startsWith("image/")) {
    return true;
  }
  if (mime && CHAT_ATTACHMENT_MIME_SET.has(mime)) {
    return true;
  }
  const name = normalizedName(file.name);
  // `.tar.gz` is not a single extension; `.gz` alone would also match, but keep
  // the compound suffix explicit so the allowlist documents it.
  if (name.endsWith(".tar.gz")) {
    return true;
  }
  return CHAT_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Read-time image projection for history surfaces.
 *
 * User transcripts persist images as `{ type:"image", source:{ type:"base64", data } }`
 * (`buildUserTranscriptContentBlocks`). The chat-history sanitizer and the image
 * compressor historically only recognized a top-level `data` string, so a caption
 * sitting next to `source.data` was replaced by a whole-message placeholder.
 *
 * These helpers never write the transcript. Callers project a copy.
 */

export type ImageOmissionFacts = {
  fileName?: string;
  mimeType?: string;
  bytes: number;
  assetId?: string;
  mediaPath?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readOptionalString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function formatImageOmissionLine(facts: ImageOmissionFacts): string {
  const parts: string[] = [];
  if (facts.fileName) {
    parts.push(`file=${JSON.stringify(facts.fileName)}`);
  }
  if (facts.mimeType) {
    parts.push(`type=${JSON.stringify(facts.mimeType)}`);
  }
  parts.push(`bytes=${facts.bytes}`);
  if (facts.assetId) {
    parts.push(`assetId=${JSON.stringify(facts.assetId)}`);
  }
  if (facts.mediaPath) {
    parts.push(`path=${JSON.stringify(facts.mediaPath)}`);
  }
  return `[image omitted: ${parts.join(" ")}]`;
}

function imageOmissionFacts(
  entry: Record<string, unknown>,
  source: Record<string, unknown> | null,
  bytes: number,
): ImageOmissionFacts {
  return {
    fileName: readOptionalString(entry, "fileName") ?? readOptionalString(entry, "filename"),
    mimeType:
      readOptionalString(entry, "mimeType") ??
      readOptionalString(source, "media_type") ??
      readOptionalString(entry, "mediaType"),
    bytes,
    assetId: readOptionalString(entry, "assetId"),
    mediaPath:
      readOptionalString(entry, "mediaPath") ??
      readOptionalString(entry, "path") ??
      readOptionalString(entry, "url"),
  };
}

function imagePayloads(entry: Record<string, unknown>): {
  topData?: string;
  source: Record<string, unknown> | null;
  sourceData?: string;
} {
  const source = asRecord(entry.source);
  return {
    topData: typeof entry.data === "string" ? entry.data : undefined,
    source,
    sourceData: source && typeof source.data === "string" ? source.data : undefined,
  };
}

/** Compressor shape: `{ type:"image", data:string, mimeType:string }`. */
function isCompressorImageBlock(entry: Record<string, unknown>): boolean {
  return typeof entry.data === "string" && typeof entry.mimeType === "string";
}

/**
 * Strip image bytes for `chat.history` (every message) and for the newest
 * `sessions_history` message. Sibling text blocks are left to the caller.
 * The image block keeps filename / type / assetId plus `omitted` and `bytes`,
 * and a following text block carries the one-line marker.
 */
export function omitImagePayloadForHistory(block: unknown): {
  blocks: unknown[];
  changed: boolean;
} {
  const entry = asRecord(block);
  if (!entry || entry.type !== "image") {
    return { blocks: [block], changed: false };
  }
  const payloads = imagePayloads(entry);
  if (payloads.topData === undefined && payloads.sourceData === undefined) {
    return { blocks: [block], changed: false };
  }
  const canonical = payloads.sourceData ?? payloads.topData ?? "";
  const bytes = Buffer.byteLength(canonical, "utf8");
  const next: Record<string, unknown> = { ...entry };
  if (payloads.topData !== undefined) {
    delete next.data;
  }
  if (payloads.source && payloads.sourceData !== undefined) {
    const nextSource = { ...payloads.source };
    delete nextSource.data;
    next.source = nextSource;
  }
  next.omitted = true;
  next.bytes = bytes;
  const marker = formatImageOmissionLine(imageOmissionFacts(entry, payloads.source, bytes));
  return {
    blocks: [next, { type: "text", text: marker }],
    changed: true,
  };
}

/**
 * Model-history projection, applied before `sanitizeSessionMessagesImages`.
 *
 * - `source.data` without a compressor-shaped payload becomes a text marker
 *   pointing at the staged file name, media path, and assetId. Historical turns
 *   must not re-embed that base64; the current turn already receives pixels
 *   through the prompt image path.
 * - A block the compressor already recognizes keeps its top-level `data`, and
 *   any duplicate `source.data` is dropped on the copy so the compressor does
 *   not spread the original bytes back into the request.
 */
export function projectSourceImageBlock(block: unknown): unknown {
  const entry = asRecord(block);
  if (!entry || entry.type !== "image") {
    return block;
  }
  const payloads = imagePayloads(entry);
  if (isCompressorImageBlock(entry)) {
    if (!payloads.source || payloads.sourceData === undefined) {
      return block;
    }
    const nextSource = { ...payloads.source };
    delete nextSource.data;
    return { ...entry, source: nextSource };
  }
  if (payloads.sourceData === undefined) {
    return block;
  }
  const bytes = Buffer.byteLength(payloads.sourceData, "utf8");
  return {
    type: "text",
    text: formatImageOmissionLine(imageOmissionFacts(entry, payloads.source, bytes)),
  };
}

export function projectTranscriptSourceImages<T>(messages: T[]): T[] {
  let changed = false;
  const next = messages.map((message) => {
    const projected = projectMessageSourceImages(message);
    if (projected !== message) {
      changed = true;
    }
    return projected as T;
  });
  return changed ? next : messages;
}

function projectMessageSourceImages(message: unknown): unknown {
  const entry = asRecord(message);
  if (!entry || !Array.isArray(entry.content)) {
    return message;
  }
  let changed = false;
  const content = entry.content.map((block) => {
    const record = asRecord(block);
    // UI attachment metadata is not a provider image/content block. Keep the
    // extracted text and a read-time reference, without mutating SessionManager.
    const projected =
      record?.type === "file"
        ? {
            type: "text",
            text: `[Attachment reference: ${JSON.stringify({
              fileName: typeof record.fileName === "string" ? record.fileName : undefined,
              mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
              assetId: typeof record.assetId === "string" ? record.assetId : undefined,
              contentHash: typeof record.contentHash === "string" ? record.contentHash : undefined,
            })}]`,
          }
        : projectSourceImageBlock(block);
    if (projected !== block) {
      changed = true;
    }
    return projected;
  });
  if (!changed) {
    return message;
  }
  return { ...entry, content };
}

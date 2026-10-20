import { createHash } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai/compat";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { canonicalizeBase64 } from "../media/base64.js";
import {
  buildImageResizeSideGrid,
  convertHeicToJpeg,
  getImageMetadata,
  IMAGE_REDUCE_QUALITY_STEPS,
  resizeToJpeg,
} from "../media/image-ops.js";
import {
  DEFAULT_IMAGE_MAX_BYTES,
  DEFAULT_IMAGE_MAX_DIMENSION_PX,
  type ImageSanitizationLimits,
} from "./image-sanitization.js";

type ToolContentBlock = AgentToolResult<unknown>["content"][number];
type ImageContentBlock = Extract<ToolContentBlock, { type: "image" }>;
type TextContentBlock = Extract<ToolContentBlock, { type: "text" }>;

// Anthropic Messages API limitations (observed in OpenBot sessions):
// - Images over ~2000px per side can fail in multi-image requests.
// - Images over 5MB are rejected by the API.
//
// To keep sessions resilient (and avoid "silent" WhatsApp non-replies), we auto-downscale
// and recompress base64 image blocks when they exceed these limits.
const MAX_IMAGE_DIMENSION_PX = DEFAULT_IMAGE_MAX_DIMENSION_PX;
const MAX_IMAGE_BYTES = DEFAULT_IMAGE_MAX_BYTES;
const log = createSubsystemLogger("agents/tool-images");

/** Raster types Anthropic-compatible and DeepSeek vision endpoints accept. */
const PROVIDER_SAFE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const UNSUPPORTED_IMAGE_FORMAT = "unsupported image format";

function isImageBlock(block: unknown): block is ImageContentBlock {
  if (!block || typeof block !== "object") {
    return false;
  }
  const rec = block as Record<string, unknown>;
  return rec.type === "image" && typeof rec.data === "string" && typeof rec.mimeType === "string";
}

function isTextBlock(block: unknown): block is TextContentBlock {
  if (!block || typeof block !== "object") {
    return false;
  }
  const rec = block as Record<string, unknown>;
  return rec.type === "text" && typeof rec.text === "string";
}

function canonicalProviderImageMime(mime: string | undefined): string | undefined {
  const normalized = mime?.split(";")[0]?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "image/jpg" ||
    normalized === "image/pjpeg" ||
    normalized === "image/x-citrix-jpeg"
  ) {
    return "image/jpeg";
  }
  if (normalized === "image/x-png") {
    return "image/png";
  }
  return normalized;
}

/** Magic-byte sniff for the four formats providers actually decode. */
function sniffProviderImageMime(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 6) {
    const gif = buf.subarray(0, 6).toString("ascii");
    if (gif === "GIF87a" || gif === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function isHeicLike(mime: string | undefined, buf: Buffer): boolean {
  if (mime === "image/heic" || mime === "image/heif") {
    return true;
  }
  if (buf.length < 12) {
    return false;
  }
  if (!buf.subarray(4, 8).toString("ascii").startsWith("ftyp")) {
    return false;
  }
  const brand = buf.subarray(8, 16).toString("ascii");
  return /heic|heix|heif|mif1|msf1/i.test(brand);
}

function imageContentDigest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
}

function formatBytesShort(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.round(bytes))}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function parseMediaPathFromText(text: string): string | undefined {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("MEDIA:")) {
      continue;
    }
    const raw = trimmed.slice("MEDIA:".length).trim();
    if (!raw) {
      continue;
    }
    const backtickWrapped = raw.match(/^`([^`]+)`$/u);
    return (backtickWrapped?.[1] ?? raw).trim();
  }
  return undefined;
}

function fileNameFromPathLike(pathLike: string): string | undefined {
  const value = pathLike.trim();
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const candidate = url.pathname.split("/").filter(Boolean).at(-1);
    return candidate && candidate.length > 0 ? candidate : undefined;
  } catch {
    // Not a URL; continue with path-like parsing.
  }

  const normalized = value.replaceAll("\\", "/");
  const candidate = normalized.split("/").filter(Boolean).at(-1);
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function inferImageFileName(params: {
  block: ImageContentBlock;
  label?: string;
  mediaPathHint?: string;
}): string | undefined {
  const rec = params.block as unknown as Record<string, unknown>;
  const explicitKeys = ["fileName", "filename", "path", "url"] as const;
  for (const key of explicitKeys) {
    const raw = rec[key];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      continue;
    }
    const candidate = fileNameFromPathLike(raw);
    if (candidate) {
      return candidate;
    }
  }

  if (typeof rec.name === "string" && rec.name.trim().length > 0) {
    return rec.name.trim();
  }

  if (params.mediaPathHint) {
    const candidate = fileNameFromPathLike(params.mediaPathHint);
    if (candidate) {
      return candidate;
    }
  }

  if (typeof params.label === "string" && params.label.startsWith("read:")) {
    const candidate = fileNameFromPathLike(params.label.slice("read:".length));
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

async function resizeImageBase64IfNeeded(params: {
  base64: string;
  mimeType: string;
  maxDimensionPx: number;
  maxBytes: number;
  label?: string;
  fileName?: string;
}): Promise<{
  base64: string;
  mimeType: string;
  resized: boolean;
  width?: number;
  height?: number;
}> {
  const original = Buffer.from(params.base64, "base64");
  const declaredMime = canonicalProviderImageMime(params.mimeType);
  let buf = original;
  if (!sniffProviderImageMime(buf) && isHeicLike(declaredMime, original)) {
    try {
      // Node Buffer is generic. Buffer.from(base64) is Buffer<ArrayBuffer>, while
      // convertHeicToJpeg returns Buffer<ArrayBufferLike> (TS2322 on the Mac build).
      buf = Buffer.from(await convertHeicToJpeg(original));
    } catch (err) {
      throw new Error(UNSUPPORTED_IMAGE_FORMAT, { cause: err });
    }
  }
  const sniffedMime = sniffProviderImageMime(buf);
  const providerMime =
    sniffedMime && PROVIDER_SAFE_IMAGE_MIMES.has(sniffedMime) ? sniffedMime : undefined;
  const meta = await getImageMetadata(buf);
  const width = meta?.width;
  const height = meta?.height;
  const overBytes = buf.byteLength > params.maxBytes;
  const hasDimensions = typeof width === "number" && typeof height === "number";
  const overDimensions =
    hasDimensions && (width > params.maxDimensionPx || height > params.maxDimensionPx);
  if (
    providerMime &&
    hasDimensions &&
    !overBytes &&
    width <= params.maxDimensionPx &&
    height <= params.maxDimensionPx
  ) {
    return {
      base64: buf.toString("base64"),
      mimeType: providerMime,
      resized: buf !== original,
      width,
      height,
    };
  }

  const maxDim = hasDimensions ? Math.max(width ?? 0, height ?? 0) : params.maxDimensionPx;
  const sideStart = maxDim > 0 ? Math.min(params.maxDimensionPx, maxDim) : params.maxDimensionPx;
  const sideGrid = buildImageResizeSideGrid(params.maxDimensionPx, sideStart);

  let smallest: { buffer: Buffer; size: number } | null = null;
  for (const side of sideGrid) {
    for (const quality of IMAGE_REDUCE_QUALITY_STEPS) {
      let out: Buffer;
      try {
        out = await resizeToJpeg({
          buffer: buf,
          maxSide: side,
          quality,
          withoutEnlargement: true,
        });
      } catch (err) {
        // Sharp can decode TIFF/BMP/etc. into jpeg. Bytes it cannot decode
        // (HTML, SVG, a mislabeled non-image) must not be forwarded.
        if (!providerMime) {
          throw new Error(UNSUPPORTED_IMAGE_FORMAT, { cause: err });
        }
        throw err;
      }
      if (!smallest || out.byteLength < smallest.size) {
        smallest = { buffer: out, size: out.byteLength };
      }
      if (out.byteLength <= params.maxBytes) {
        const sourcePixels =
          typeof width === "number" && typeof height === "number"
            ? `${width}x${height}px`
            : "unknown";
        const sourceWithFile = params.fileName
          ? `${params.fileName} ${sourcePixels}`
          : sourcePixels;
        const byteReductionPct =
          buf.byteLength > 0
            ? Number((((buf.byteLength - out.byteLength) / buf.byteLength) * 100).toFixed(1))
            : 0;
        log.info(
          `Image resized to fit limits: ${sourceWithFile} ${formatBytesShort(buf.byteLength)} -> ${formatBytesShort(out.byteLength)} (-${byteReductionPct}%)`,
          {
            label: params.label,
            fileName: params.fileName,
            sourceMimeType: params.mimeType,
            sourceWidth: width,
            sourceHeight: height,
            sourceBytes: buf.byteLength,
            maxBytes: params.maxBytes,
            maxDimensionPx: params.maxDimensionPx,
            triggerOverBytes: overBytes,
            triggerOverDimensions: overDimensions,
            outputMimeType: "image/jpeg",
            outputBytes: out.byteLength,
            outputQuality: quality,
            outputMaxSide: side,
            byteReductionPct,
          },
        );
        return {
          base64: out.toString("base64"),
          mimeType: "image/jpeg",
          resized: true,
          width,
          height,
        };
      }
    }
  }

  if (!smallest && !providerMime) {
    throw new Error(UNSUPPORTED_IMAGE_FORMAT);
  }

  const best = smallest?.buffer ?? buf;
  const maxMb = (params.maxBytes / (1024 * 1024)).toFixed(0);
  const gotMb = (best.byteLength / (1024 * 1024)).toFixed(2);
  const sourcePixels =
    typeof width === "number" && typeof height === "number" ? `${width}x${height}px` : "unknown";
  const sourceWithFile = params.fileName ? `${params.fileName} ${sourcePixels}` : sourcePixels;
  log.warn(
    `Image resize failed to fit limits: ${sourceWithFile} best=${formatBytesShort(best.byteLength)} limit=${formatBytesShort(params.maxBytes)}`,
    {
      label: params.label,
      fileName: params.fileName,
      sourceMimeType: params.mimeType,
      sourceWidth: width,
      sourceHeight: height,
      sourceBytes: buf.byteLength,
      maxDimensionPx: params.maxDimensionPx,
      maxBytes: params.maxBytes,
      smallestCandidateBytes: best.byteLength,
      triggerOverBytes: overBytes,
      triggerOverDimensions: overDimensions,
    },
  );
  throw new Error(`Image could not be reduced below ${maxMb}MB (got ${gotMb}MB)`);
}

export async function sanitizeContentBlocksImages(
  blocks: ToolContentBlock[],
  label: string,
  opts: ImageSanitizationLimits = {},
): Promise<ToolContentBlock[]> {
  const maxDimensionPx = Math.max(opts.maxDimensionPx ?? MAX_IMAGE_DIMENSION_PX, 1);
  const maxBytes = Math.max(opts.maxBytes ?? MAX_IMAGE_BYTES, 1);
  const out: ToolContentBlock[] = [];
  let mediaPathHint: string | undefined;

  for (const block of blocks) {
    if (isTextBlock(block)) {
      const mediaPath = parseMediaPathFromText(block.text);
      if (mediaPath) {
        mediaPathHint = mediaPath;
      }
    }

    if (!isImageBlock(block)) {
      out.push(block);
      continue;
    }

    const data = block.data.trim();
    if (!data) {
      out.push({
        type: "text",
        text: `[${label}] omitted empty image payload`,
      } satisfies TextContentBlock);
      continue;
    }
    const canonicalData = canonicalizeBase64(data);
    if (!canonicalData) {
      out.push({
        type: "text",
        text: `[${label}] omitted image payload: invalid base64`,
      } satisfies TextContentBlock);
      continue;
    }

    try {
      const declaredMime = canonicalProviderImageMime(block.mimeType) ?? block.mimeType;
      const fileName = inferImageFileName({ block, label, mediaPathHint });
      const resized = await resizeImageBase64IfNeeded({
        base64: canonicalData,
        mimeType: declaredMime,
        maxDimensionPx,
        maxBytes,
        label,
        fileName,
      });
      out.push({
        ...block,
        data: resized.base64,
        mimeType: resized.mimeType,
      });
    } catch (err) {
      const decoded = Buffer.from(canonicalData, "base64");
      const digest = imageContentDigest(decoded);
      const unsupported = String(err).includes(UNSUPPORTED_IMAGE_FORMAT);
      const reason = unsupported ? UNSUPPORTED_IMAGE_FORMAT : String(err);
      log.warn(`omitted image payload (${label}) ${reason} digest=${digest}`);
      out.push({
        type: "text",
        text: `[${label}] omitted image payload: ${reason} (digest=${digest})`,
      } satisfies TextContentBlock);
    }
  }

  return out;
}

export async function sanitizeImageBlocks(
  images: ImageContent[],
  label: string,
  opts: ImageSanitizationLimits = {},
): Promise<{ images: ImageContent[]; dropped: number }> {
  if (images.length === 0) {
    return { images, dropped: 0 };
  }
  const sanitized = await sanitizeContentBlocksImages(images as ToolContentBlock[], label, opts);
  const next = sanitized.filter(isImageBlock);
  return { images: next, dropped: Math.max(0, images.length - next.length) };
}

export async function sanitizeToolResultImages(
  result: AgentToolResult<unknown>,
  label: string,
  opts: ImageSanitizationLimits = {},
): Promise<AgentToolResult<unknown>> {
  const content = Array.isArray(result.content) ? result.content : [];
  if (!content.some((b) => isImageBlock(b) || isTextBlock(b))) {
    return result;
  }

  const next = await sanitizeContentBlocksImages(content, label, opts);
  return { ...result, content: next };
}

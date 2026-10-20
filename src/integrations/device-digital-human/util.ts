import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DeviceDhError } from "./errors.js";

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function parseBasic(
  header: string | undefined,
): { clientId: string; secret: string } | null {
  if (!header?.startsWith("Basic ")) {
    return null;
  }
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice("Basic ".length).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const split = decoded.indexOf(":");
  if (split <= 0) {
    return null;
  }
  return { clientId: decoded.slice(0, split), secret: decoded.slice(split + 1) };
}

export function basicHeader(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function bodyHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type InspectedImage = {
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

function assertDimensions(width: number, height: number, maxPixels: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8000 ||
    height > 8000 ||
    width * height > maxPixels
  ) {
    throw new DeviceDhError("MEDIA_INVALID", "Image dimensions are not allowed");
  }
}

function readJpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) {
      return null;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      return null;
    }
    const sof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof && length >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Container-level check: PNG IHDR or JPEG SOF plus size caps.
 * This stub does not inflate pixels or run a production image decoder.
 */
export function inspectImage(bytes: Buffer, maxBytes: number, maxPixels: number): InspectedImage {
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new DeviceDhError("MEDIA_INVALID", "Image exceeds size limit");
  }
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
      throw new DeviceDhError("MEDIA_INVALID", "PNG is missing IHDR");
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assertDimensions(width, height, maxPixels);
    return { contentType: "image/png", width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = readJpegSize(bytes);
    if (!size) {
      throw new DeviceDhError("MEDIA_INVALID", "JPEG is missing a start-of-frame marker");
    }
    assertDimensions(size.width, size.height, maxPixels);
    return { contentType: "image/jpeg", width: size.width, height: size.height };
  }
  throw new DeviceDhError("MEDIA_INVALID", "Only JPEG and PNG images are accepted");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

import { DeviceDhError } from "./errors.js";
import { inspectImage, isLoopbackHost, sha256Hex, type InspectedImage } from "./util.js";

export type MediaPullOptions = {
  allowOrigins: string[];
  maxBytes: number;
  maxPixels: number;
  timeoutMs: number;
};

export type MediaCheck = {
  contentType?: string;
  width?: number;
  height?: number;
  byteLength?: number;
  checksum?: string;
};

function assertDeclared(actual: InspectedImage, bytes: Buffer, declared: MediaCheck): void {
  if (declared.contentType && declared.contentType !== actual.contentType) {
    throw new DeviceDhError("MEDIA_INVALID", "Image content type does not match the payload");
  }
  if (declared.width !== undefined && declared.width !== actual.width) {
    throw new DeviceDhError("MEDIA_INVALID", "Image width does not match the payload");
  }
  if (declared.height !== undefined && declared.height !== actual.height) {
    throw new DeviceDhError("MEDIA_INVALID", "Image height does not match the payload");
  }
  if (declared.byteLength !== undefined && declared.byteLength !== bytes.length) {
    throw new DeviceDhError("MEDIA_INVALID", "Image byte length does not match the payload");
  }
  if (declared.checksum) {
    const expected = declared.checksum.replace(/^sha256:/, "").toLowerCase();
    const got = sha256Hex(bytes);
    if (expected !== got) {
      throw new DeviceDhError("MEDIA_INVALID", "Image checksum does not match the payload");
    }
  }
}

export function validateImageBytes(
  bytes: Buffer,
  declared: MediaCheck,
  limits: { maxBytes: number; maxPixels: number },
): InspectedImage {
  const actual = inspectImage(bytes, limits.maxBytes, limits.maxPixels);
  assertDeclared(actual, bytes, declared);
  return actual;
}

/**
 * Pull bytes from a loopback or explicitly allowlisted origin.
 * Redirects are rejected. Hostnames are not resolved, so private DNS cannot
 * be used to reach an internal address.
 */
export async function pullMedia(rawUrl: string, options: MediaPullOptions): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DeviceDhError("MEDIA_INVALID", "Media URL is invalid");
  }
  if (parsed.username || parsed.password) {
    throw new DeviceDhError("MEDIA_INVALID", "Media URL must not include credentials");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DeviceDhError("MEDIA_INVALID", "Media URL scheme is not allowed");
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (!isLoopbackHost(parsed.hostname) && !options.allowOrigins.includes(origin)) {
    throw new DeviceDhError("MEDIA_INVALID", "Media URL is not allowed");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(parsed, { redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new DeviceDhError("MEDIA_INVALID", "Media redirects are not allowed");
    }
    if (!response.ok) {
      throw new DeviceDhError("MEDIA_INVALID", "Media fetch failed");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      throw new DeviceDhError("MEDIA_INVALID", "Image exceeds size limit");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > options.maxBytes) {
      throw new DeviceDhError("MEDIA_INVALID", "Image exceeds size limit");
    }
    return bytes;
  } catch (error) {
    if (error instanceof DeviceDhError) {
      throw error;
    }
    const aborted = error instanceof Error && error.name === "AbortError";
    if (aborted) {
      throw new DeviceDhError("TIMEOUT", "Media fetch timed out", { retryable: true });
    }
    throw new DeviceDhError("MEDIA_INVALID", "Media fetch failed");
  } finally {
    clearTimeout(timer);
  }
}

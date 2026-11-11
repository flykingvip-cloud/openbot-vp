import { createHash } from "node:crypto";
import { ExecProtocolError } from "./errors.js";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export function sha256Of(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeSha256(value: string): string {
  if (typeof value !== "string") {
    throw new ExecProtocolError("EXEC_CHECKSUM_MISMATCH", "sha256 must be a string");
  }
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
  if (!SHA256_HEX_RE.test(hex)) {
    throw new ExecProtocolError(
      "EXEC_CHECKSUM_MISMATCH",
      "sha256 must be a full 64-character lowercase hex digest, optionally prefixed with sha256:",
    );
  }
  return hex;
}

export function encodeInlineJsonBytes(json: unknown): Buffer {
  return Buffer.from(JSON.stringify(json), "utf8");
}

export function decodeBase64Bytes(bytesBase64: string): Buffer {
  if (typeof bytesBase64 !== "string") {
    throw new ExecProtocolError("EXEC_INTERNAL", "bytesBase64 must be a string");
  }
  const buffer = Buffer.from(bytesBase64, "base64");
  if (buffer.length === 0 && bytesBase64.length > 0 && bytesBase64.replace(/\s+/g, "") !== "") {
    // Empty decode of non-empty input can happen for invalid base64; still allow empty payload.
  }
  return buffer;
}

export function assertChecksumMatch(params: {
  expectedSha256: string;
  expectedByteCount: number;
  actual: Buffer;
}): { sha256: string; byteCount: number } {
  const expectedSha256 = normalizeSha256(params.expectedSha256);
  if (!Number.isInteger(params.expectedByteCount) || params.expectedByteCount < 0) {
    throw new ExecProtocolError(
      "EXEC_CHECKSUM_MISMATCH",
      "byteCount must be a non-negative integer",
    );
  }
  const actualSha256 = sha256Of(params.actual);
  const actualByteCount = params.actual.byteLength;
  if (actualSha256 !== expectedSha256 || actualByteCount !== params.expectedByteCount) {
    throw new ExecProtocolError(
      "EXEC_CHECKSUM_MISMATCH",
      `artifact checksum or byte count mismatch (expected sha256=${expectedSha256} bytes=${params.expectedByteCount}, actual sha256=${actualSha256} bytes=${actualByteCount})`,
    );
  }
  return { sha256: actualSha256, byteCount: actualByteCount };
}

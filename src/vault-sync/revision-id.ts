import { createHash } from "node:crypto";
import { VAULT_SYNC_PROTOCOL_VERSION } from "./types.js";

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

function encodeUint64Be(n: number): Buffer {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error("deviceSequence must be a non-negative integer");
  }
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(n), 0);
  return buf;
}

/**
 * Stable, verifiable, idempotent revision id.
 * Same inputs always produce the same id (retry-safe).
 */
export function computeRevisionId(params: {
  vaultId: string;
  opaquePathId: string;
  deviceId: string;
  deviceSequence: number;
  ciphertextHash: string;
  parentRevisionIds: string[];
  protocolVersion?: number;
}): string {
  const protocolVersion = params.protocolVersion ?? VAULT_SYNC_PROTOCOL_VERSION;
  const parents = [...params.parentRevisionIds]
    .map((p) => p.trim())
    .filter(Boolean)
    .toSorted();
  const h = createHash("sha256");
  h.update(params.vaultId, "utf8");
  h.update(Buffer.from([0]));
  h.update(params.opaquePathId, "utf8");
  h.update(Buffer.from([0]));
  h.update(params.deviceId, "utf8");
  h.update(Buffer.from([0]));
  h.update(encodeUint64Be(params.deviceSequence));
  h.update(Buffer.from([0]));
  h.update(params.ciphertextHash, "utf8");
  h.update(Buffer.from([0]));
  h.update(parents.join("\n"), "utf8");
  h.update(Buffer.from([0]));
  h.update(String(protocolVersion), "utf8");
  return toBase64Url(h.digest());
}

/**
 * Gateway capability signing keyset, and the node-side verification set.
 *
 * Trust direction: the gateway signs, the node verifies. This is deliberately NOT
 * the device connection signature — device identity already uses Ed25519 and
 * derives a device id from the public key (`src/infra/device-identity.ts`); we
 * reuse that format and tooling but never the same key (design 9.3).
 *
 * Fail-closed rules implemented here (design 9.3 / 9.7):
 * - the node pins a trust root at first pairing
 * - keyset updates must be signed by the pinned trust root, or arrive over the
 *   already-authenticated device connection
 * - an unknown `keyId` is never resolved by asking the caller for a public key
 * - an expired keyset that cannot be refreshed denies new reads
 * - revoking a key removes it from the verification set, which immediately
 *   invalidates issued-but-unexpired tokens without any node-local blacklist
 */

import crypto from "node:crypto";
import {
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
  verifyDeviceSignature,
} from "../infra/device-identity.js";
import { canonicalJsonStringify } from "./canonical-json.js";

export type CapabilityVerificationKey = {
  keyId: string;
  /** Raw Ed25519 public key, base64url. */
  publicKey: string;
};

export type CapabilityKeysetDocument = {
  version: 1;
  /** Monotonic. An update that is not strictly newer is rejected as a rollback. */
  issuedAtMs: number;
  /** After this instant the node must refresh before serving new reads. */
  expiresAtMs: number;
  keys: CapabilityVerificationKey[];
};

export type SignedKeysetDocument = {
  alg: "Ed25519";
  trustRootKeyId: string;
  documentJSON: string;
  signature: string;
};

export type CapabilityTrustRoot = {
  keyId: string;
  /** Raw Ed25519 public key, base64url. */
  publicKey: string;
};

export type KeysetUpdateResult =
  | { ok: true; document: CapabilityKeysetDocument }
  | {
      ok: false;
      reason:
        | "no-trust-root"
        | "trust-root-mismatch"
        | "bad-signature"
        | "malformed-document"
        | "not-canonical"
        | "rollback"
        | "unprotected-channel";
    };

export type KeyResolution =
  | { ok: true; publicKey: string }
  | { ok: false; reason: "no-keyset" | "keyset-expired" | "unknown-key-id" };

function isVerificationKey(value: unknown): value is CapabilityVerificationKey {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.keyId === "string" &&
    record.keyId.trim().length > 0 &&
    typeof record.publicKey === "string" &&
    record.publicKey.trim().length > 0
  );
}

function parseKeysetDocument(documentJSON: string): CapabilityKeysetDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentJSON);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }
  if (typeof record.issuedAtMs !== "number" || !Number.isFinite(record.issuedAtMs)) {
    return null;
  }
  if (typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) {
    return null;
  }
  if (!Array.isArray(record.keys) || !record.keys.every(isVerificationKey)) {
    return null;
  }
  // Duplicate key ids would make resolution order-dependent.
  const ids = new Set<string>();
  for (const key of record.keys) {
    if (ids.has(key.keyId)) {
      return null;
    }
    ids.add(key.keyId);
  }
  return {
    version: 1,
    issuedAtMs: record.issuedAtMs,
    expiresAtMs: record.expiresAtMs,
    keys: record.keys.map((key) => ({ keyId: key.keyId, publicKey: key.publicKey })),
  };
}

/**
 * Node-side verification set. Holds the pinned trust root and the current
 * keyset document, and is the only thing that can hand out a verification key.
 */
export class NodeCapabilityKeyset {
  private trustRoot: CapabilityTrustRoot | null = null;
  private document: CapabilityKeysetDocument | null = null;

  /** Pin the trust root. First pairing only; re-pinning a different root is refused. */
  pinTrustRoot(root: CapabilityTrustRoot): { ok: boolean; reason?: "already-pinned" } {
    if (this.trustRoot) {
      if (this.trustRoot.keyId === root.keyId && this.trustRoot.publicKey === root.publicKey) {
        return { ok: true };
      }
      return { ok: false, reason: "already-pinned" };
    }
    this.trustRoot = { keyId: root.keyId, publicKey: root.publicKey };
    return { ok: true };
  }

  hasTrustRoot(): boolean {
    return this.trustRoot !== null;
  }

  getTrustRootKeyId(): string | null {
    return this.trustRoot?.keyId ?? null;
  }

  /** Apply a keyset update signed by the pinned trust root. */
  applyKeysetUpdate(signed: SignedKeysetDocument): KeysetUpdateResult {
    if (!this.trustRoot) {
      return { ok: false, reason: "no-trust-root" };
    }
    if (signed.trustRootKeyId !== this.trustRoot.keyId) {
      return { ok: false, reason: "trust-root-mismatch" };
    }
    if (!verifyDeviceSignature(this.trustRoot.publicKey, signed.documentJSON, signed.signature)) {
      return { ok: false, reason: "bad-signature" };
    }
    return this.acceptDocument(signed.documentJSON);
  }

  /**
   * Apply a keyset update that arrived over the already-authenticated device
   * connection. The caller must assert that channel explicitly; an unauthenticated
   * caller cannot install a keyset.
   */
  applyKeysetOverAuthenticatedConnection(
    documentJSON: string,
    channel: { authenticatedDeviceConnection: boolean },
  ): KeysetUpdateResult {
    if (!channel.authenticatedDeviceConnection) {
      return { ok: false, reason: "unprotected-channel" };
    }
    if (!this.trustRoot) {
      return { ok: false, reason: "no-trust-root" };
    }
    return this.acceptDocument(documentJSON);
  }

  private acceptDocument(documentJSON: string): KeysetUpdateResult {
    const parsed = parseKeysetDocument(documentJSON);
    if (!parsed) {
      return { ok: false, reason: "malformed-document" };
    }
    // Enforce canonical form so the signed bytes are unambiguous.
    if (canonicalJsonStringify(parsed) !== documentJSON) {
      return { ok: false, reason: "not-canonical" };
    }
    if (this.document && parsed.issuedAtMs <= this.document.issuedAtMs) {
      return { ok: false, reason: "rollback" };
    }
    this.document = parsed;
    return { ok: true, document: parsed };
  }

  /**
   * Resolve a `keyId` to a verification key.
   *
   * Never falls back to a caller-supplied key, and refuses once the keyset has
   * expired, so a node that cannot refresh stops serving reads.
   */
  resolveVerificationKey(keyId: string, nowMs: number): KeyResolution {
    if (!this.document) {
      return { ok: false, reason: "no-keyset" };
    }
    if (nowMs > this.document.expiresAtMs) {
      return { ok: false, reason: "keyset-expired" };
    }
    const found = this.document.keys.find((key) => key.keyId === keyId);
    if (!found) {
      return { ok: false, reason: "unknown-key-id" };
    }
    return { ok: true, publicKey: found.publicKey };
  }

  /** Current verification key ids, for diagnostics. */
  listKeyIds(): string[] {
    return this.document ? this.document.keys.map((key) => key.keyId) : [];
  }

  /** Copy of the pinned trust root, for persistence. */
  protected snapshotTrustRoot(): CapabilityTrustRoot | null {
    return this.trustRoot ? { ...this.trustRoot } : null;
  }

  /** Copy of the accepted keyset document, for persistence. */
  protected snapshotDocument(): CapabilityKeysetDocument | null {
    return this.document
      ? { ...this.document, keys: this.document.keys.map((key) => ({ ...key })) }
      : null;
  }
}

export type CapabilitySigningKey = {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
};

/** Mint a capability signing keypair. `keyId` is derived from the public key. */
export function generateCapabilitySigningKey(keyIdPrefix = "cap"): CapabilitySigningKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const raw = publicKeyRawBase64UrlFromPem(publicKeyPem);
  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return { keyId: `${keyIdPrefix}-${fingerprint}`, privateKeyPem, publicKeyPem };
}

export function verificationKeyFor(key: CapabilitySigningKey): CapabilityVerificationKey {
  return { keyId: key.keyId, publicKey: publicKeyRawBase64UrlFromPem(key.publicKeyPem) };
}

/** Build and sign a keyset document with the trust root key. */
export function signKeysetDocument(params: {
  trustRoot: CapabilitySigningKey;
  keys: CapabilityVerificationKey[];
  issuedAtMs: number;
  expiresAtMs: number;
}): SignedKeysetDocument {
  const document: CapabilityKeysetDocument = {
    version: 1,
    issuedAtMs: params.issuedAtMs,
    expiresAtMs: params.expiresAtMs,
    keys: params.keys.map((key) => ({ keyId: key.keyId, publicKey: key.publicKey })),
  };
  const documentJSON = canonicalJsonStringify(document);
  return {
    alg: "Ed25519",
    trustRootKeyId: params.trustRoot.keyId,
    documentJSON,
    signature: signDevicePayload(params.trustRoot.privateKeyPem, documentJSON),
  };
}

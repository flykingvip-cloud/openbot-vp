/**
 * Node-side persistence for the capability verification keyset (design 9.3).
 *
 * What is persisted and what is not:
 * - the pinned trust root IS persisted, because pinning happens once at first
 *   pairing and must survive restarts
 * - the current keyset document IS persisted, so a restarted node can keep
 *   verifying without waiting for a refresh
 * - consumed nonces are NOT persisted, and deliberately so. Node-local nonce
 *   state is not a consumption record: it is lost on restart, which is exactly
 *   the replay window the design closes by keeping consumption on the gateway.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { canonicalJsonStringify } from "../../local-files/canonical-json.js";
import {
  NodeCapabilityKeyset,
  type CapabilityKeysetDocument,
  type CapabilityTrustRoot,
  type SignedKeysetDocument,
} from "../../local-files/keyset.js";

type StoredKeyset = {
  version: 1;
  trustRoot?: CapabilityTrustRoot;
  document?: CapabilityKeysetDocument;
};

const FILE_NAME = "local-files-keyset.json";

export function resolveKeysetPath(): string {
  return path.join(resolveStateDir(), FILE_NAME);
}

function readStored(filePath: string): StoredKeyset | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoredKeyset;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(filePath: string, stored: StoredKeyset): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Keyset that persists accepted state.
 *
 * Verification itself is inherited unchanged; only the accepted trust root and
 * document are mirrored to disk.
 */
export class PersistentNodeCapabilityKeyset extends NodeCapabilityKeyset {
  private readonly filePath: string;

  constructor(filePath: string = resolveKeysetPath()) {
    super();
    this.filePath = filePath;
    const stored = readStored(filePath);
    if (stored?.trustRoot) {
      super.pinTrustRoot(stored.trustRoot);
    }
    if (stored?.document) {
      // Re-enter through the normal acceptance path so a tampered on-disk
      // document still has to satisfy the structural and canonical-form checks.
      // Must use the canonical serializer: JSON.stringify preserves insertion
      // order, which does not match canonical key order, so the acceptance check
      // would reject our own persisted document as non-canonical.
      super.applyKeysetOverAuthenticatedConnection(canonicalJsonStringify(stored.document), {
        authenticatedDeviceConnection: true,
      });
    }
  }

  override pinTrustRoot(root: CapabilityTrustRoot): { ok: boolean; reason?: "already-pinned" } {
    const result = super.pinTrustRoot(root);
    if (result.ok) {
      this.persist();
    }
    return result;
  }

  private persist(): void {
    const stored: StoredKeyset = { version: 1 };
    const keyId = this.getTrustRootKeyId();
    if (keyId) {
      stored.trustRoot = this.snapshotTrustRoot() ?? undefined;
    }
    const document = this.snapshotDocument();
    if (document) {
      stored.document = document;
    }
    try {
      writeStored(this.filePath, stored);
    } catch {
      // Persistence is best effort; verification state in memory is authoritative
      // for this process, and a failed write only costs a refresh after restart.
    }
  }

  /** Persist whatever was accepted. Call after a successful keyset update. */
  flush(): void {
    this.persist();
  }
}

export function loadNodeCapabilityKeyset(): PersistentNodeCapabilityKeyset {
  return new PersistentNodeCapabilityKeyset();
}

/**
 * Apply a keyset document pushed by the gateway.
 *
 * Trust chain: the document must be signed by the trust root this node pinned at
 * first pairing. On a first-ever connection there is no pinned root yet, so the
 * document's own `trustRootKeyId` is pinned from it — that is the pairing moment.
 * Every later update must then match the pinned root, so a second gateway cannot
 * take over an already-paired node (design 9.3).
 */
export function applyLocalFilesKeysetEvent(
  payload: unknown,
  keyset: PersistentNodeCapabilityKeyset = sharedKeyset(),
): { ok: boolean; reason?: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "malformed-payload" };
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.trustRootKeyId !== "string" ||
    typeof record.documentJSON !== "string" ||
    typeof record.signature !== "string"
  ) {
    return { ok: false, reason: "malformed-payload" };
  }
  const signed: SignedKeysetDocument = {
    alg: "Ed25519",
    trustRootKeyId: record.trustRootKeyId,
    documentJSON: record.documentJSON,
    signature: record.signature,
  };

  if (!keyset.hasTrustRoot()) {
    // First pairing. We cannot verify a signature without a root, so the root is
    // adopted here and pinned; from now on updates are authenticated against it.
    const rootPublicKey =
      typeof record.trustRootPublicKey === "string" ? record.trustRootPublicKey : null;
    if (!rootPublicKey) {
      return { ok: false, reason: "no-trust-root-to-pin" };
    }
    const pinned = keyset.pinTrustRoot({
      keyId: signed.trustRootKeyId,
      publicKey: rootPublicKey,
    });
    if (!pinned.ok) {
      return { ok: false, reason: pinned.reason ?? "pin-failed" };
    }
  }

  const applied = keyset.applyKeysetUpdate(signed);
  if (!applied.ok) {
    return { ok: false, reason: applied.reason };
  }
  keyset.flush();
  return { ok: true };
}

let shared: PersistentNodeCapabilityKeyset | null = null;

/** The keyset instance the node host runtime uses. */
export function sharedKeyset(): PersistentNodeCapabilityKeyset {
  shared ??= loadNodeCapabilityKeyset();
  return shared;
}

/** Test seam. */
export function resetSharedKeyset(): void {
  shared = null;
}

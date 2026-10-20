import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signCapability, verifyCapability } from "../../local-files/capability.js";
import {
  generateCapabilitySigningKey,
  signKeysetDocument,
  verificationKeyFor,
  type CapabilitySigningKey,
} from "../../local-files/keyset.js";
import type { CapabilityBinding } from "../../local-files/types.js";
import { applyLocalFilesKeysetEvent, PersistentNodeCapabilityKeyset } from "./keyset-store.js";

let tmpDir: string;
let keysetPath: string;
let trustRoot: CapabilitySigningKey;
let signingKey: CapabilitySigningKey;

const NOW = Date.now();

function binding(): CapabilityBinding {
  return {
    tenantId: "t1",
    userId: "u1",
    agentId: "bot-skill",
    sessionKey: "s1",
    turnId: "turn-1",
    nodeId: "node-1",
    devicePublicKey: "key-1",
  };
}

/** The payload shape the gateway pushes over the authenticated connection. */
function keysetPayload(params: {
  root: CapabilitySigningKey;
  keys: CapabilitySigningKey[];
  issuedAtMs?: number;
  ttlMs?: number;
  includeRootPublicKey?: boolean;
}) {
  const issuedAtMs = params.issuedAtMs ?? NOW;
  const signed = signKeysetDocument({
    trustRoot: params.root,
    keys: params.keys.map(verificationKeyFor),
    issuedAtMs,
    expiresAtMs: issuedAtMs + (params.ttlMs ?? 600_000),
  });
  return {
    ...signed,
    ...(params.includeRootPublicKey === false
      ? {}
      : { trustRootPublicKey: verificationKeyFor(params.root).publicKey }),
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldrg-keyset-"));
  keysetPath = path.join(tmpDir, "local-files-keyset.json");
  trustRoot = generateCapabilitySigningKey("root");
  signingKey = generateCapabilitySigningKey();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("keyset delivery over the authenticated connection (design 9.3)", () => {
  it("pins the trust root on first pairing and accepts the verification keys", () => {
    const keyset = new PersistentNodeCapabilityKeyset(keysetPath);
    expect(keyset.hasTrustRoot()).toBe(false);
    // Before any keyset, every read is refused.
    expect(keyset.resolveVerificationKey(signingKey.keyId, NOW).ok).toBe(false);

    const res = applyLocalFilesKeysetEvent(
      keysetPayload({ root: trustRoot, keys: [signingKey] }),
      keyset,
    );
    expect(res.ok).toBe(true);
    expect(keyset.getTrustRootKeyId()).toBe(trustRoot.keyId);
    expect(keyset.resolveVerificationKey(signingKey.keyId, NOW).ok).toBe(true);
  });

  it("makes a capability verifiable only after the keyset arrives", () => {
    const keyset = new PersistentNodeCapabilityKeyset(keysetPath);
    const capability = signCapability(
      {
        kind: "invocation",
        capabilityId: "ic_1",
        authorizationId: "ta_1",
        binding: binding(),
        canonicalPath: "/Users/demo/Desktop/a.txt",
        fileId: { dev: "1", ino: "2" },
        targetKind: "file",
        scope: "exact",
        operation: "fs.read",
        useCount: 1,
        nonce: "n1",
        issuedAtMs: NOW,
        expiresAtMs: NOW + 30_000,
      },
      signingKey,
    );

    const before = verifyCapability(capability, {
      keyset,
      nowMs: NOW,
      expectedKind: "invocation",
    });
    expect(before.ok).toBe(false);
    expect(!before.ok && before.reason).toBe("no-keyset");

    applyLocalFilesKeysetEvent(keysetPayload({ root: trustRoot, keys: [signingKey] }), keyset);
    expect(
      verifyCapability(capability, { keyset, nowMs: NOW, expectedKind: "invocation" }).ok,
    ).toBe(true);
  });

  it("refuses a second gateway trying to take over an already-paired node", () => {
    const keyset = new PersistentNodeCapabilityKeyset(keysetPath);
    applyLocalFilesKeysetEvent(keysetPayload({ root: trustRoot, keys: [signingKey] }), keyset);

    const impostorRoot = generateCapabilitySigningKey("root");
    const impostorKey = generateCapabilitySigningKey();
    const res = applyLocalFilesKeysetEvent(
      keysetPayload({ root: impostorRoot, keys: [impostorKey], issuedAtMs: NOW + 1000 }),
      keyset,
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("trust-root-mismatch");
    // The impostor's key never enters the verification set.
    expect(keyset.resolveVerificationKey(impostorKey.keyId, NOW).ok).toBe(false);
    expect(keyset.resolveVerificationKey(signingKey.keyId, NOW).ok).toBe(true);
  });

  it("refuses a first-pairing payload with no root public key to pin", () => {
    const keyset = new PersistentNodeCapabilityKeyset(keysetPath);
    const res = applyLocalFilesKeysetEvent(
      keysetPayload({ root: trustRoot, keys: [signingKey], includeRootPublicKey: false }),
      keyset,
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-trust-root-to-pin");
  });

  it("refuses a malformed payload", () => {
    const keyset = new PersistentNodeCapabilityKeyset(keysetPath);
    for (const payload of [null, undefined, 42, "x", {}, { trustRootKeyId: "k" }]) {
      const res = applyLocalFilesKeysetEvent(payload, keyset);
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("malformed-payload");
    }
  });

  it("refuses a rolled-back document", () => {
    const keyset = new PersistentNodeCapabilityKeyset(keysetPath);
    applyLocalFilesKeysetEvent(
      keysetPayload({ root: trustRoot, keys: [signingKey], issuedAtMs: NOW }),
      keyset,
    );
    const res = applyLocalFilesKeysetEvent(
      keysetPayload({ root: trustRoot, keys: [], issuedAtMs: NOW - 1 }),
      keyset,
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("rollback");
    // The old key survives, rather than being dropped by a replayed document.
    expect(keyset.resolveVerificationKey(signingKey.keyId, NOW).ok).toBe(true);
  });

  it("applies a revocation that removes a key from the set", () => {
    const keyset = new PersistentNodeCapabilityKeyset(keysetPath);
    applyLocalFilesKeysetEvent(keysetPayload({ root: trustRoot, keys: [signingKey] }), keyset);
    const rotated = generateCapabilitySigningKey();

    const res = applyLocalFilesKeysetEvent(
      keysetPayload({ root: trustRoot, keys: [rotated], issuedAtMs: NOW + 1000 }),
      keyset,
    );
    expect(res.ok).toBe(true);
    expect(keyset.resolveVerificationKey(signingKey.keyId, NOW).ok).toBe(false);
    expect(keyset.resolveVerificationKey(rotated.keyId, NOW).ok).toBe(true);
  });
});

describe("persistence across a node restart", () => {
  it("keeps the pinned root and the verification set", async () => {
    const first = new PersistentNodeCapabilityKeyset(keysetPath);
    applyLocalFilesKeysetEvent(keysetPayload({ root: trustRoot, keys: [signingKey] }), first);

    const restarted = new PersistentNodeCapabilityKeyset(keysetPath);
    expect(restarted.getTrustRootKeyId()).toBe(trustRoot.keyId);
    expect(restarted.resolveVerificationKey(signingKey.keyId, NOW).ok).toBe(true);

    // Nonces are deliberately NOT persisted: node-local consumption records are
    // not a source of truth, which is why redemption lives on the gateway.
    const raw = JSON.parse(await fs.readFile(keysetPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(raw).toSorted()).toEqual(["document", "trustRoot", "version"]);
    expect(JSON.stringify(raw)).not.toContain("nonce");
    expect(JSON.stringify(raw)).not.toContain("PRIVATE KEY");
  });

  it("still fails closed after restart once the keyset has expired", () => {
    const first = new PersistentNodeCapabilityKeyset(keysetPath);
    applyLocalFilesKeysetEvent(
      keysetPayload({ root: trustRoot, keys: [signingKey], ttlMs: 1000 }),
      first,
    );
    const restarted = new PersistentNodeCapabilityKeyset(keysetPath);
    const resolved = restarted.resolveVerificationKey(signingKey.keyId, NOW + 5000);
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.reason).toBe("keyset-expired");
  });
});

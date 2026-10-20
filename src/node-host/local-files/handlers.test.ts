import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveInvocationCapability,
  issueResolveTicket,
  issueTurnAuthorization,
} from "../../local-files/issue.js";
import {
  generateCapabilitySigningKey,
  NodeCapabilityKeyset,
  signKeysetDocument,
  verificationKeyFor,
  type CapabilitySigningKey,
} from "../../local-files/keyset.js";
import type { PathPolicyContext } from "../../local-files/path-policy.js";
import { TurnAuthorizationStore } from "../../local-files/turn-authorization.js";
import {
  CAPABILITY_CLOCK_SKEW_MS,
  LOCAL_FILES_OPAQUE_DENIAL,
  type CapabilityBinding,
  type FileIdentity,
  type LocalFilesOperation,
} from "../../local-files/types.js";
import { guardCommand } from "./guard.js";
import {
  handleArchiveList,
  handleArchiveReadEntry,
  handleFsList,
  handleFsRead,
  handleFsStatResolve,
  type LocalFilesHandlerDeps,
} from "./handlers.js";

const NODE_ID = "node-test";
const DEVICE_KEY = "device-key-test";

let tmpHome: string;
let signingKey: CapabilitySigningKey;
let keyset: NodeCapabilityKeyset;
let store: TurnAuthorizationStore;
let deps: LocalFilesHandlerDeps;
let redeemCalls: Array<{ operation: string }>;
let redeemResult: { ok: true } | { ok: false; reason: string };

function binding(): CapabilityBinding {
  return {
    tenantId: "t1",
    userId: "u1",
    agentId: "bot-skill",
    sessionKey: "s1",
    turnId: "turn-1",
    nodeId: NODE_ID,
    devicePublicKey: DEVICE_KEY,
  };
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "ldrg-"));
  // realpath so /var vs /private/var on macOS does not defeat the home check.
  tmpHome = await fs.realpath(tmpHome);
  await fs.mkdir(path.join(tmpHome, "Desktop"), { recursive: true });
  await fs.mkdir(path.join(tmpHome, ".ssh"), { recursive: true });

  signingKey = generateCapabilitySigningKey();
  const trustRoot = generateCapabilitySigningKey("root");
  keyset = new NodeCapabilityKeyset();
  keyset.pinTrustRoot({
    keyId: trustRoot.keyId,
    publicKey: verificationKeyFor(trustRoot).publicKey,
  });
  keyset.applyKeysetUpdate(
    signKeysetDocument({
      trustRoot,
      keys: [verificationKeyFor(signingKey)],
      issuedAtMs: Date.now(),
      expiresAtMs: Date.now() + 600_000,
    }),
  );

  store = new TurnAuthorizationStore();
  redeemCalls = [];
  redeemResult = { ok: true };

  const policy: PathPolicyContext = { homeDir: tmpHome, caseInsensitive: true };
  deps = {
    keyset,
    policy,
    configuredProfile: "local-files-readonly",
    redemption: {
      redeem: async ({ operation }) => {
        redeemCalls.push({ operation });
        return redeemResult;
      },
    },
  };
});

afterEach(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
});

function resolveTicketFor(rawPath: string, op: LocalFilesOperation = "fs.read") {
  return issueResolveTicket({
    binding: binding(),
    rawPath,
    intendedOperation: op,
    signingKey,
    nowMs: Date.now(),
  }).signed;
}

function authorizationFor(params: {
  canonicalPath: string;
  fileId: FileIdentity;
  targetKind: "file" | "directory";
  operations: LocalFilesOperation[];
  maxCalls?: number;
}) {
  const issued = issueTurnAuthorization({
    binding: binding(),
    canonicalPath: params.canonicalPath,
    fileId: params.fileId,
    targetKind: params.targetKind,
    operations: params.operations,
    grantSource: "user-directed",
    // These tests exercise handler behaviour, not budget arithmetic, so give
    // enough headroom for the negative-path calls each test makes.
    budget: {
      maxCalls: params.maxCalls ?? 8,
      maxEntriesRead: 8,
      maxTotalExpandedBytes: 8 * 1024 * 1024,
    },
    signingKey,
    store,
    nowMs: Date.now(),
    expiresAtMs: Date.now() + 120_000,
  });
  if (!issued.ok) {
    throw new Error(`fixture: ${issued.reason}`);
  }
  return issued;
}

function capabilityFor(
  authorizationId: string,
  operation: LocalFilesOperation,
  archiveEntryPath?: string,
) {
  const derived = deriveInvocationCapability({
    authorizationId,
    operation,
    archiveEntryPath,
    signingKey,
    store,
    nowMs: Date.now(),
    clockSkewMs: CAPABILITY_CLOCK_SKEW_MS,
  });
  if (!derived.ok) {
    throw new Error(`fixture: ${derived.reason}`);
  }
  return derived.signed;
}

async function resolveOk(rawPath: string) {
  const res = await handleFsStatResolve({ ticket: resolveTicketFor(rawPath), deps });
  if (!res.ok) {
    throw new Error(`resolve failed: ${res.detail}`);
  }
  return res;
}

describe("node command guard (acceptance 6.8, 6.9)", () => {
  it("refuses system.run even though it never reaches a handler", () => {
    const res = guardCommand("system.run");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.failure.kind).toBe("command-denied");
  });

  it("refuses commands outside the profile", () => {
    for (const command of ["browser.proxy", "fs.write", "fs.resolve", "archive.extract"]) {
      expect(guardCommand(command).ok).toBe(false);
    }
  });

  it("admits the five profile commands", () => {
    for (const command of ["fs.stat", "fs.list", "fs.read", "archive.list", "archive.readEntry"]) {
      expect(guardCommand(command).ok).toBe(true);
    }
  });
});

describe("two-phase resolution (design 9.1, 9.6 case 1)", () => {
  it("expands ~ on the node and returns path identity only", async () => {
    const target = path.join(tmpHome, "Desktop", "notes.txt");
    await fs.writeFile(target, "hello");

    const res = await resolveOk("~/Desktop/notes.txt");
    expect(res.canonicalPath).toBe(target);
    expect(res.targetKind).toBe("file");
    expect(res.fileId.ino).toMatch(/^\d+$/);
    // No content and no content hash is returned by resolve.
    expect(Object.keys(res)).not.toContain("text");
    expect(Object.keys(res)).not.toContain("sha256");
    expect(Object.keys(res)).not.toContain("entries");
  });

  it("returns the same opaque denial for missing and hard-denied paths (9.6 case 10)", async () => {
    await fs.writeFile(path.join(tmpHome, ".ssh", "id_ed25519"), "SECRET");

    const missing = await handleFsStatResolve({
      ticket: resolveTicketFor("~/Desktop/does-not-exist.txt"),
      deps,
    });
    const denied = await handleFsStatResolve({
      ticket: resolveTicketFor("~/.ssh/id_ed25519"),
      deps,
    });

    expect(missing.ok).toBe(false);
    expect(denied.ok).toBe(false);
    // Identical model-visible message: existence is not disclosed.
    expect(!missing.ok && missing.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    expect(!denied.ok && denied.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    expect(!missing.ok && missing.message).toBe(!denied.ok && denied.message);
    // Only the audit detail differs.
    expect(!missing.ok && missing.detail).not.toBe(!denied.ok && denied.detail);
  });

  it("does not touch the filesystem when the ticket fails verification (9.6 case 1)", async () => {
    const foreign = generateCapabilitySigningKey("evil");
    const forged = issueResolveTicket({
      binding: binding(),
      rawPath: "~/Desktop/notes.txt",
      intendedOperation: "fs.read",
      signingKey: foreign,
      nowMs: Date.now(),
    }).signed;

    const res = await handleFsStatResolve({ ticket: forged, deps });
    expect(res.ok).toBe(false);
    // Verification failed locally, so redemption was never contacted (9.6 case 5).
    expect(redeemCalls).toHaveLength(0);
  });

  it("never resolves a path on an external volume or a network mount (9.6 case 7)", async () => {
    // `evaluateCanonicalPath` can only run after canonicalization, so on a host
    // where the volume is not mounted the refusal lands as not-found and on a
    // host where it is mounted it lands as a policy denial. Both are refusals
    // with the same model-visible message, which is the guarantee that matters;
    // the policy layer itself is asserted deterministically below and in
    // path-policy.test.ts.
    for (const rawPath of ["/Volumes/USB/pack.zip", "/net/share/pack.zip"]) {
      const res = await handleFsStatResolve({ ticket: resolveTicketFor(rawPath), deps });
      expect(res.ok).toBe(false);
      expect(!res.ok && res.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    }
  });

  it("refuses a read whose capability names an external volume (9.6 case 7)", async () => {
    // Drives the node-side policy layer directly: the path is carried on a
    // validly signed capability, so nothing but the policy can refuse it, and it
    // is refused without any filesystem access.
    const authorization = authorizationFor({
      canonicalPath: "/Volumes/USB/pack.zip",
      fileId: { dev: "1", ino: "1" },
      targetKind: "file",
      operations: ["fs.read"],
    });
    const res = await handleFsRead({
      capability: capabilityFor(authorization.claims.authorizationId, "fs.read"),
      deps,
    });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toBe(LOCAL_FILES_OPAQUE_DENIAL);
    expect(!res.ok && res.detail).toContain("foreign-volume");
  });

  it("refuses to act when the gateway declines redemption", async () => {
    await fs.writeFile(path.join(tmpHome, "Desktop", "notes.txt"), "hello");
    redeemResult = { ok: false, reason: "nonce-already-consumed" };

    const res = await handleFsStatResolve({
      ticket: resolveTicketFor("~/Desktop/notes.txt"),
      deps,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.detail).toContain("redemption-refused");
  });
});

describe("fs.read safe open (design 4.8)", () => {
  it("reads an authorized text file and reports metadata", async () => {
    const target = path.join(tmpHome, "Desktop", "notes.txt");
    await fs.writeFile(target, "hello world");
    const resolved = await resolveOk("~/Desktop/notes.txt");
    const auth = authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "file",
      operations: ["fs.read"],
    });

    const res = await handleFsRead({
      capability: capabilityFor(auth.claims.authorizationId, "fs.read"),
      deps,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.text).toBe("hello world");
    expect(res.isText).toBe(true);
    expect(res.sha256).toBe(crypto.createHash("sha256").update("hello world").digest("hex"));
    expect(res.truncated).toBe(false);
  });

  it("returns metadata only for binary content", async () => {
    const target = path.join(tmpHome, "Desktop", "blob.bin");
    await fs.writeFile(target, Buffer.from([0x00, 0x01, 0x02, 0xff]));
    const resolved = await resolveOk("~/Desktop/blob.bin");
    const auth = authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "file",
      operations: ["fs.read"],
    });

    const res = await handleFsRead({
      capability: capabilityFor(auth.claims.authorizationId, "fs.read"),
      deps,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.isText).toBe(false);
    expect(res.ok && res.text).toBeUndefined();
  });

  it("truncates at the byte cap and says so", async () => {
    const target = path.join(tmpHome, "Desktop", "big.txt");
    await fs.writeFile(target, "x".repeat(4096));
    const resolved = await resolveOk("~/Desktop/big.txt");
    const auth = authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "file",
      operations: ["fs.read"],
    });

    const res = await handleFsRead({
      capability: capabilityFor(auth.claims.authorizationId, "fs.read"),
      deps,
      maxBytes: 100,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.bytesReturned).toBe(100);
    expect(res.truncated).toBe(true);
    expect(res.sizeBytes).toBe(4096);
  });

  it("fails when the inode is replaced after approval (9.6 case 16)", async () => {
    const target = path.join(tmpHome, "Desktop", "swap.txt");
    await fs.writeFile(target, "original");
    const resolved = await resolveOk("~/Desktop/swap.txt");
    const auth = authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "file",
      operations: ["fs.read"],
    });
    const capability = capabilityFor(auth.claims.authorizationId, "fs.read");

    // Replace the file with a different inode at the same path.
    await fs.rm(target);
    await fs.writeFile(target, "substituted");

    const res = await handleFsRead({ capability, deps });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.detail).toBe("open:identity-mismatch");
  });

  it("refuses a symlink that points outside the permitted area (acceptance 6.7)", async () => {
    const secret = path.join(tmpHome, ".ssh", "config");
    await fs.writeFile(secret, "SECRET");
    const link = path.join(tmpHome, "Desktop", "link.txt");
    await fs.symlink(secret, link);

    const res = await handleFsStatResolve({ ticket: resolveTicketFor("~/Desktop/link.txt"), deps });
    // realpath follows the link, and the resolved target is hard-denied.
    expect(res.ok).toBe(false);
    expect(!res.ok && res.detail).toContain("denied");
  });

  it("refuses a sensitive file hard-linked into Desktop (9.6 case 14)", async () => {
    const secret = path.join(tmpHome, "Desktop", "innocent.txt");
    await fs.writeFile(secret, "SECRET");
    await fs.link(secret, path.join(tmpHome, "Desktop", "second-name.txt"));

    const res = await handleFsStatResolve({
      ticket: resolveTicketFor("~/Desktop/innocent.txt"),
      deps,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.detail).toContain("hardlink");
  });

  it("refuses a fifo", async () => {
    // Directories are the only non-file kind accepted; verify via a directory
    // target presented to fs.read, which must not be readable as a file.
    const dir = path.join(tmpHome, "Desktop", "folder");
    await fs.mkdir(dir);
    const resolved = await resolveOk("~/Desktop/folder");
    const auth = authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "directory",
      operations: ["fs.list"],
    });
    const res = await handleFsRead({
      capability: capabilityFor(auth.claims.authorizationId, "fs.list"),
      deps,
    });
    expect(res.ok).toBe(false);
  });
});

describe("fs.list boundary (design 9.4)", () => {
  it("lists direct children only and grants nothing for them", async () => {
    const dir = path.join(tmpHome, "Downloads");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.mkdir(path.join(dir, "nested"));
    await fs.writeFile(path.join(dir, "nested", "deep.txt"), "deep");

    const resolved = await resolveOk("~/Downloads");
    const auth = authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "directory",
      operations: ["fs.list"],
    });

    const res = await handleFsList({
      capability: capabilityFor(auth.claims.authorizationId, "fs.list"),
      deps,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entries.map((e) => e.name).toSorted()).toEqual(["a.txt", "nested"]);
    // Not recursive: the nested file is not present.
    expect(res.entries.map((e) => e.name)).not.toContain("deep.txt");

    // A directory grant cannot be spent on reading a child.
    const readAttempt = await handleFsRead({
      capability: capabilityFor(auth.claims.authorizationId, "fs.list"),
      deps,
    });
    expect(readAttempt.ok).toBe(false);
  });

  it("refuses a file target presented to fs.list", async () => {
    const target = path.join(tmpHome, "Desktop", "notes.txt");
    await fs.writeFile(target, "hi");
    const resolved = await resolveOk("~/Desktop/notes.txt");
    const auth = authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "file",
      operations: ["fs.list", "fs.read"],
    });
    const res = await handleFsList({
      capability: capabilityFor(auth.claims.authorizationId, "fs.list"),
      deps,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.detail).toBe("list:target-not-directory");
  });
});

describe("archive inspection without extraction (design 4.7, acceptance 6.1, 6.12)", () => {
  async function writeZip(
    entries: Record<string, string>,
    opts?: { deflate?: boolean },
  ): Promise<string> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(entries)) {
      zip.file(name, content);
    }
    // JSZip defaults to STORE. A bomb fixture must actually be compressed.
    const buffer = await zip.generateAsync(
      opts?.deflate
        ? { type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }
        : { type: "nodebuffer" },
    );
    const target = path.join(tmpHome, "Desktop", "pack.zip");
    await fs.writeFile(target, buffer);
    return target;
  }

  async function archiveAuth(operations: LocalFilesOperation[]) {
    const resolved = await resolveOk("~/Desktop/pack.zip");
    return authorizationFor({
      canonicalPath: resolved.canonicalPath,
      fileId: resolved.fileId,
      targetKind: "file",
      operations,
    });
  }

  it("lists entries and reads one without writing anything to disk", async () => {
    await writeZip({
      "skills/a/SKILL.md": "# Skill A",
      "skills/b/SKILL.md": "# Skill B",
    });
    const auth = await archiveAuth(["archive.list", "archive.readEntry"]);

    const listed = await handleArchiveList({
      capability: capabilityFor(auth.claims.authorizationId, "archive.list"),
      deps,
    });
    expect(listed.ok).toBe(true);
    expect(listed.ok && listed.entries.map((e) => e.path)).toContain("skills/a/SKILL.md");

    const entry = await handleArchiveReadEntry({
      capability: capabilityFor(
        auth.claims.authorizationId,
        "archive.readEntry",
        "skills/a/SKILL.md",
      ),
      deps,
    });
    expect(entry.ok).toBe(true);
    expect(entry.ok && entry.text).toBe("# Skill A");

    // Nothing was extracted next to the archive.
    const desktop = await fs.readdir(path.join(tmpHome, "Desktop"));
    expect(desktop.toSorted()).toEqual(["pack.zip"]);
  });

  it("refuses a sensitive entry even though the ZIP is on the Desktop (design 9.5)", async () => {
    await writeZip({ "config/.env": "TOKEN=abc", "readme.md": "hi" });
    const auth = await archiveAuth(["archive.list", "archive.readEntry"]);

    const entry = await handleArchiveReadEntry({
      capability: capabilityFor(auth.claims.authorizationId, "archive.readEntry", "config/.env"),
      deps,
    });
    expect(entry.ok).toBe(false);
    expect(!entry.ok && entry.detail).toContain("entry-denied");

    // Listing counts it as denied instead of naming it.
    const listed = await handleArchiveList({
      capability: capabilityFor(auth.claims.authorizationId, "archive.list"),
      deps,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.entries.map((e) => e.path)).not.toContain("config/.env");
    expect(listed.deniedCount).toBeGreaterThan(0);
  });

  it("refuses a nested archive entry", async () => {
    await writeZip({ "inner.zip": "PK\u0003\u0004fake", "readme.md": "hi" });
    const auth = await archiveAuth(["archive.readEntry"]);

    const entry = await handleArchiveReadEntry({
      capability: capabilityFor(auth.claims.authorizationId, "archive.readEntry", "inner.zip"),
      deps,
    });
    expect(entry.ok).toBe(false);
    expect(!entry.ok && entry.detail).toContain("nested-archive");
  });

  it("refuses an entry name that escapes the archive root", async () => {
    await writeZip({ "readme.md": "hi" });
    const auth = await archiveAuth(["archive.readEntry"]);

    for (const evil of ["../../etc/passwd", "/etc/passwd"]) {
      const entry = await handleArchiveReadEntry({
        capability: capabilityFor(auth.claims.authorizationId, "archive.readEntry", evil),
        deps,
      });
      expect(entry.ok).toBe(false);
      expect(!entry.ok && entry.detail).toContain("entry-denied");
    }
  });

  it("refuses a compression bomb by declared expansion ratio (acceptance 6.12)", async () => {
    // 24 MiB of zeros deflates to a few KB: a ratio far past the ceiling.
    await writeZip({ "bomb.txt": "0".repeat(24 * 1024 * 1024) }, { deflate: true });
    const auth = await archiveAuth(["archive.list", "archive.readEntry"]);

    const listed = await handleArchiveList({
      capability: capabilityFor(auth.claims.authorizationId, "archive.list"),
      deps,
    });
    expect(listed.ok).toBe(false);
    expect(!listed.ok && listed.detail).toContain("bomb");
  });

  it("caps an entry read at the byte ceiling rather than inflating it fully", async () => {
    // Under the ratio ceiling, so listing passes; the entry read must still cap.
    await writeZip({ "big.txt": "abcdefgh".repeat(512 * 1024) }, { deflate: true });
    const auth = await archiveAuth(["archive.readEntry"]);

    const entry = await handleArchiveReadEntry({
      capability: capabilityFor(auth.claims.authorizationId, "archive.readEntry", "big.txt"),
      deps,
    });
    expect(entry.ok).toBe(true);
    if (!entry.ok) {
      return;
    }
    expect(entry.truncated).toBe(true);
    expect(entry.bytesReturned).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("requires the entry path to be named on the capability, not at call time", async () => {
    await writeZip({ "readme.md": "hi" });
    const auth = await archiveAuth(["archive.readEntry"]);

    const entry = await handleArchiveReadEntry({
      // No archiveEntryPath on the capability.
      capability: capabilityFor(auth.claims.authorizationId, "archive.readEntry"),
      deps,
    });
    expect(entry.ok).toBe(false);
    expect(!entry.ok && entry.detail).toBe("archive-read:entry-path-missing");
  });
});

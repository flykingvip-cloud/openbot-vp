import { describe, expect, it } from "vitest";
import {
  evaluateArchiveEntryPath,
  evaluateCanonicalPath,
  evaluateSensitiveName,
  evaluateStatFacts,
  evaluateTarget,
  normalizeForComparison,
  prefilterRawPath,
  stripDataVolumePrefix,
  type PathPolicyContext,
} from "./path-policy.js";

const CTX: PathPolicyContext = {
  homeDir: "/Users/demo",
  caseInsensitive: true,
};

function expectDenied(decision: ReturnType<typeof evaluateCanonicalPath>, layer: string) {
  expect(decision.allowed).toBe(false);
  expect(!decision.allowed && decision.layer).toBe(layer);
}

describe("layer 1: system hard deny (design 4.9, acceptance 6.6)", () => {
  it("denies credential stores under the home directory", () => {
    for (const p of [
      "/Users/demo/.ssh/id_ed25519",
      "/Users/demo/.ssh",
      "/Users/demo/.aws/credentials",
      "/Users/demo/.gnupg/secring.gpg",
      "/Users/demo/.kube/config",
      "/Users/demo/.docker/config.json",
      "/Users/demo/.openbot/credentials/whatsapp.json",
      "/Users/demo/Library/Keychains/login.keychain-db",
    ]) {
      expectDenied(evaluateCanonicalPath(p, CTX), "system-path");
    }
  });

  it("denies absolute system locations", () => {
    for (const p of [
      "/System/Library/CoreServices",
      "/private/etc/passwd",
      "/etc/hosts",
      "/dev/null",
    ]) {
      const decision = evaluateCanonicalPath(p, CTX);
      expect(decision.allowed).toBe(false);
    }
  });

  it("denies another user's home directory", () => {
    expectDenied(
      evaluateCanonicalPath("/Users/someoneelse/Desktop/a.txt", CTX),
      "outside-user-home",
    );
  });

  it("denies external volumes and network mounts (9.6 case 7)", () => {
    expectDenied(evaluateCanonicalPath("/Volumes/USB/a.txt", CTX), "foreign-volume");
    expectDenied(evaluateCanonicalPath("/net/share/a.txt", CTX), "foreign-volume");
  });

  it("denies a credential store even when the user named it explicitly", () => {
    // The point of the layer: naming it yourself does not unlock it.
    expectDenied(evaluateCanonicalPath("/Users/demo/.ssh/id_rsa", CTX), "system-path");
  });
});

describe("layer 2: sensitive names and types", () => {
  it("denies dotenv, npmrc, keys and browser stores wherever they sit", () => {
    for (const p of [
      "/Users/demo/Desktop/.env",
      "/Users/demo/Desktop/.env.production",
      "/Users/demo/Desktop/.npmrc",
      "/Users/demo/Desktop/.pypirc",
      "/Users/demo/Desktop/.git-credentials",
      "/Users/demo/Desktop/server.pem",
      "/Users/demo/Desktop/private.key",
      "/Users/demo/Desktop/vault.kdbx",
      "/Users/demo/Desktop/Cookies",
      "/Users/demo/Desktop/Login Data",
      "/Users/demo/Desktop/chat.db",
      "/Users/demo/Desktop/id_ed25519",
    ]) {
      expectDenied(evaluateCanonicalPath(p, CTX), "sensitive-name");
    }
  });

  it("allows an ssh public key, which is not secret material", () => {
    expect(evaluateSensitiveName("/Users/demo/Desktop/id_ed25519.pub").allowed).toBe(true);
  });

  it("matches sensitive names case-insensitively and across NFD spelling", () => {
    expectDenied(evaluateCanonicalPath("/Users/demo/Desktop/COOKIES", CTX), "sensitive-name");
    expectDenied(evaluateCanonicalPath("/Users/demo/Desktop/.ENV", CTX), "sensitive-name");
  });
});

describe("layer 3: ordinary user content is eligible, not automatically readable", () => {
  it("allows the user content roots", () => {
    for (const p of [
      "/Users/demo/Desktop/pack.zip",
      "/Users/demo/Downloads/report.pdf",
      "/Users/demo/Documents/notes/todo.md",
    ]) {
      expect(evaluateCanonicalPath(p, CTX).allowed).toBe(true);
    }
  });

  it("denies home locations that are neither hard-denied nor user content", () => {
    expectDenied(
      evaluateCanonicalPath("/Users/demo/some-project/src/a.ts", CTX),
      "not-user-content",
    );
    expectDenied(evaluateCanonicalPath("/Users/demo", CTX), "not-user-content");
  });

  it("honours a narrowed user content root list", () => {
    const narrowed: PathPolicyContext = { ...CTX, userContentRoots: ["Desktop"] };
    expect(evaluateCanonicalPath("/Users/demo/Desktop/a.txt", narrowed).allowed).toBe(true);
    expectDenied(
      evaluateCanonicalPath("/Users/demo/Downloads/a.txt", narrowed),
      "not-user-content",
    );
  });
});

describe("macOS path semantics (design 9.5, acceptance 9.6 case 8)", () => {
  it("treats /System/Volumes/Data/Users/... as the same path as /Users/...", () => {
    const viaFirmlink = evaluateCanonicalPath(
      "/System/Volumes/Data/Users/demo/Desktop/pack.zip",
      CTX,
    );
    expect(viaFirmlink.allowed).toBe(true);
    // Without stripping, the /System deny rule would have fired for the wrong reason.
    expect(stripDataVolumePrefix("/System/Volumes/Data/Users/demo")).toBe("/Users/demo");
  });

  it("folds case and Unicode form for comparison only", () => {
    // "é" composed vs decomposed must compare equal.
    const composed = "/Users/demo/Desktop/caf\u00e9.txt";
    const decomposed = "/Users/demo/Desktop/cafe\u0301.txt";
    expect(normalizeForComparison(composed, true)).toBe(normalizeForComparison(decomposed, true));
    expect(evaluateCanonicalPath(decomposed, CTX).allowed).toBe(true);
  });

  it("rejects paths that are not canonical", () => {
    expectDenied(evaluateCanonicalPath("Users/demo/Desktop/a.txt", CTX), "malformed-path");
    expectDenied(
      evaluateCanonicalPath("/Users/demo/Desktop/../../other/a.txt", CTX),
      "malformed-path",
    );
    expectDenied(evaluateCanonicalPath("/Users/demo/Desktop/a\0b.txt", CTX), "malformed-path");
  });
});

describe("stat facts: special files and hard links (design 9.5, acceptance 9.6 case 14)", () => {
  it("accepts a plain regular file and a directory", () => {
    expect(evaluateStatFacts({ kind: "file", nlink: 1 }).allowed).toBe(true);
    expect(evaluateStatFacts({ kind: "directory", nlink: 2 }).allowed).toBe(true);
  });

  it("denies a hard-linked regular file by default", () => {
    const decision = evaluateStatFacts({ kind: "file", nlink: 2 });
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.layer).toBe("hardlink");
  });

  it("denies sockets, fifos, devices and a symlink as the final target", () => {
    for (const kind of [
      "socket",
      "fifo",
      "char-device",
      "block-device",
      "symlink",
      "other",
    ] as const) {
      const decision = evaluateStatFacts({ kind, nlink: 1 });
      expect(decision.allowed).toBe(false);
      expect(!decision.allowed && decision.layer).toBe("special-file");
    }
  });

  it("refuses a sensitive file hard-linked into Desktop", () => {
    // Path layers pass (Desktop, innocuous name) but the link count does not.
    const decision = evaluateTarget({
      canonicalPath: "/Users/demo/Desktop/holiday-notes.txt",
      facts: { kind: "file", nlink: 2 },
      ctx: CTX,
    });
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.layer).toBe("hardlink");
  });

  it("refuses when the opened kind disagrees with the granted target kind", () => {
    const decision = evaluateTarget({
      canonicalPath: "/Users/demo/Desktop/pack.zip",
      facts: { kind: "directory", nlink: 2 },
      expectedKind: "file",
      ctx: CTX,
    });
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.layer).toBe("special-file");
  });
});

describe("gateway prefilter on the raw path (design 4.9, 10.3)", () => {
  it("refuses the unmistakable cases without canonicalizing", () => {
    for (const raw of [
      "~/.ssh/id_ed25519",
      "~/.aws/credentials",
      "/etc/hosts",
      "/System/Library/a.plist",
      "/dev/null",
      "/Volumes/USB/a.txt",
      "/net/share/a.txt",
      "~/Desktop/project/.env",
      "~/Desktop/key.pem",
    ]) {
      const decision = prefilterRawPath(raw);
      expect(decision, raw).toBeDefined();
      expect(decision?.allowed, raw).toBe(false);
    }
  });

  it("stays undecided rather than admitting anything", () => {
    // `undefined` means "ask the node". The prefilter has no allow verdict at all,
    // so it can never widen what the node would have refused.
    for (const raw of [
      "~/Desktop/pack.zip",
      "/Users/demo/Desktop/pack.zip",
      "Desktop/pack.zip",
      // $HOME is not expanded here, so a credential *directory* behind it is
      // invisible to the gateway. Its basename still is not: the case below.
      "$HOME/.ssh/config",
      // Nor can the gateway know which local account the bound user owns.
      "/Users/someone-else/Desktop/a.txt",
    ]) {
      expect(prefilterRawPath(raw), raw).toBeUndefined();
    }
  });

  it("judges the basename even when it cannot judge the directory", () => {
    // Two halves of the same path, decided differently, which is the honest
    // boundary of a filter that never canonicalizes.
    expect(prefilterRawPath("$HOME/.ssh/id_ed25519")?.allowed).toBe(false);
    expect(prefilterRawPath("$HOME/.ssh/config")).toBeUndefined();
  });

  it("refuses an empty path and a NUL byte", () => {
    expect(prefilterRawPath("")?.allowed).toBe(false);
    expect(prefilterRawPath("   ")?.allowed).toBe(false);
    expect(prefilterRawPath("~/Desktop/a\0.txt")?.allowed).toBe(false);
  });

  it("folds case and separator form, since folding can only widen a denial", () => {
    expect(prefilterRawPath("~/.SSH/ID_ED25519")?.allowed).toBe(false);
    expect(prefilterRawPath("/ETC/hosts")?.allowed).toBe(false);
    expect(prefilterRawPath("/System/Volumes/Data/etc/hosts")?.allowed).toBe(false);
  });

  it("never disagrees with the node by allowing what the node denies", () => {
    // The contract that makes the prefilter safe: for every path it refuses, the
    // authoritative canonical-path policy refuses too.
    const ctx: PathPolicyContext = { homeDir: "/Users/demo", caseInsensitive: true };
    for (const absolute of [
      "/etc/hosts",
      "/dev/null",
      "/Volumes/USB/a.txt",
      "/Users/demo/.ssh/id_ed25519",
      "/Users/demo/Desktop/project/.env",
    ]) {
      const prefiltered = prefilterRawPath(absolute);
      if (prefiltered && !prefiltered.allowed) {
        expect(evaluateCanonicalPath(absolute, ctx).allowed, absolute).toBe(false);
      }
    }
  });
});

describe("archive entries carry the same rules (design 9.5)", () => {
  it("rejects Zip Slip and absolute or backslash entry names", () => {
    for (const entry of [
      "../../etc/passwd",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "skills\\a.md",
      "a/../../b",
    ]) {
      const decision = evaluateArchiveEntryPath(entry);
      expect(decision.allowed).toBe(false);
    }
  });

  it("rejects sensitive entries even though the ZIP itself sits on the Desktop", () => {
    for (const entry of [
      "config/.env",
      "keys/id_ed25519",
      "certs/server.pem",
      "creds/credentials",
    ]) {
      const decision = evaluateArchiveEntryPath(entry);
      expect(decision.allowed).toBe(false);
      expect(!decision.allowed && decision.layer).toBe("sensitive-name");
    }
  });

  it("allows an ordinary entry", () => {
    expect(evaluateArchiveEntryPath("skills/browser-auth/SKILL.md").allowed).toBe(true);
  });

  it("rejects an empty or NUL entry name", () => {
    expect(evaluateArchiveEntryPath("").allowed).toBe(false);
    expect(evaluateArchiveEntryPath("a\0b").allowed).toBe(false);
  });
});

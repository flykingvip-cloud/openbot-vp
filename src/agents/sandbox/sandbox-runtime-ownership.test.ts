import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ensureColdAccountBrowserProfile } from "../../browser/account-browser-namespace.js";
import {
  type SandboxOwnershipEntry,
  type SandboxOwnershipStat,
  SANDBOX_RUNTIME_GID,
  SANDBOX_RUNTIME_UID,
  ensureSandboxRuntimeNodeOwnership,
  ensureSandboxRuntimeOwnership,
  resolveSandboxRuntimeIdentity,
} from "./sandbox-runtime-ownership.js";

function stat(uid: number, gid: number, directory: boolean): SandboxOwnershipStat {
  return {
    uid,
    gid,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  };
}

function entry(name: string, directory: boolean, symlink: boolean): SandboxOwnershipEntry {
  return {
    name,
    isDirectory: () => directory,
    isSymbolicLink: () => symlink,
  };
}

describe("resolveSandboxRuntimeIdentity", () => {
  it("uses the image sandbox user when docker.user is unset", () => {
    expect(resolveSandboxRuntimeIdentity(undefined, false)).toEqual({ uid: 1000, gid: 1000 });
  });

  it("leaves classic unset docker.user alone", () => {
    expect(resolveSandboxRuntimeIdentity(undefined, true)).toBeNull();
    expect(resolveSandboxRuntimeIdentity("  ", true)).toBeNull();
  });

  it("parses numeric users and the sandbox name", () => {
    expect(resolveSandboxRuntimeIdentity("1000:1000", true)).toEqual({ uid: 1000, gid: 1000 });
    expect(resolveSandboxRuntimeIdentity("2000", true)).toEqual({ uid: 2000, gid: 2000 });
    expect(resolveSandboxRuntimeIdentity("sandbox", true)).toEqual({ uid: 1000, gid: 1000 });
  });

  it("does not retarget a root or named docker user", () => {
    expect(resolveSandboxRuntimeIdentity("0:0", true)).toBeNull();
    expect(resolveSandboxRuntimeIdentity("0", false)).toBeNull();
    expect(resolveSandboxRuntimeIdentity("nobody", true)).toBeNull();
  });
});

describe("ensureSandboxRuntimeOwnership", () => {
  it("does nothing when the gateway is not root", async () => {
    let chowned = false;
    await ensureSandboxRuntimeOwnership(["/state/browser"], {
      io: {
        getuid: () => 1000,
        chown: async () => {
          chowned = true;
        },
      },
    });
    expect(chowned).toBe(false);
  });

  it("chowns a root-owned browser tree without following symlinks", async () => {
    const events: string[] = [];
    await ensureSandboxRuntimeOwnership(["/state/browser"], {
      io: {
        getuid: () => 0,
        lstat: async (target) => {
          if (target === "/state/browser" || target === "/state/browser/Default") {
            return stat(0, 0, true);
          }
          return stat(0, 0, false);
        },
        readdir: async (target) => {
          if (target === "/state/browser") {
            return [
              entry("Default", true, false),
              entry("Cookies", false, false),
              entry("SingletonLock", false, true),
            ];
          }
          if (target === "/state/browser/Default") {
            return [entry("Preferences", false, false)];
          }
          throw new Error(`unexpected readdir ${target}`);
        },
        chown: async (target, uid, gid) => {
          events.push(`chown ${target} ${uid}:${gid}`);
        },
        lchown: async (target, uid, gid) => {
          events.push(`lchown ${target} ${uid}:${gid}`);
        },
      },
    });
    expect(events).toEqual([
      "chown /state/browser 1000:1000",
      "chown /state/browser/Default 1000:1000",
      "chown /state/browser/Default/Preferences 1000:1000",
      "chown /state/browser/Cookies 1000:1000",
      "lchown /state/browser/SingletonLock 1000:1000",
    ]);
  });

  it("skips a tree the sandbox user already owns", async () => {
    let reads = 0;
    await ensureSandboxRuntimeOwnership(["/account/workspace"], {
      sandboxUser: "1000:1000",
      requireExplicitUser: true,
      io: {
        getuid: () => 0,
        lstat: async () => stat(1000, 1000, true),
        readdir: async () => {
          reads += 1;
          return [];
        },
        chown: async () => {
          throw new Error("chown");
        },
      },
    });
    expect(reads).toBe(0);
  });

  it("honors an explicit non-root exec sandbox user", async () => {
    const chowned: string[] = [];
    await ensureSandboxRuntimeOwnership(["/workspace"], {
      sandboxUser: "2000:2001",
      requireExplicitUser: true,
      io: {
        getuid: () => 0,
        lstat: async () => stat(0, 0, true),
        readdir: async () => [],
        chown: async (target, uid, gid) => {
          chowned.push(`${target} ${uid}:${gid}`);
        },
      },
    });
    expect(chowned).toEqual(["/workspace 2000:2001"]);
  });

  it("chowns a cold account browser profile created by a root gateway", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-browser-own-"));
    const profile = path.join(root, "state", "browser");
    const chowned: string[] = [];
    try {
      await ensureColdAccountBrowserProfile(profile, {
        io: {
          getuid: () => 0,
          lstat: async () => stat(0, 0, true),
          readdir: async () => [],
          chown: async (target, uid, gid) => {
            chowned.push(`${target} ${uid}:${gid}`);
          },
        },
      });
      expect(chowned).toEqual([`${profile} 1000:1000`]);
      await expect(fs.stat(profile)).resolves.toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("chowns one new inode inside a directory the sandbox user already owns", async () => {
    const chowned: string[] = [];
    await ensureSandboxRuntimeNodeOwnership("/state/browser/Default/Preferences", {
      io: {
        getuid: () => 0,
        lstat: async () => stat(0, 0, false),
        chown: async (target, uid, gid) => {
          chowned.push(`${target} ${uid}:${gid}`);
        },
      },
    });
    expect(chowned).toEqual(["/state/browser/Default/Preferences 1000:1000"]);
  });

  it("does not chown classic exec dirs when docker.user is unset", async () => {
    let chowned = false;
    await ensureSandboxRuntimeOwnership(["/workspace"], {
      requireExplicitUser: true,
      io: {
        getuid: () => 0,
        chown: async () => {
          chowned = true;
        },
      },
    });
    expect(chowned).toBe(false);
  });
});

describe("Dockerfile.sandbox UID contract", () => {
  const dockerfilePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../Dockerfile.sandbox",
  );

  it("pins sandbox to uid/gid 1000 and does not FROM node:*", async () => {
    const body = await fs.readFile(dockerfilePath, "utf8");
    expect(body).toMatch(/FROM debian:trixie-slim@sha256:[a-f0-9]{64}/);
    expect(body).not.toMatch(/^\s*FROM\s+[^\n]*\bnode:/m);
    expect(body).toMatch(/useradd\s+--uid\s+1000\s+--gid\s+1000/);
    expect(body).toMatch(/groupadd\s+--gid\s+1000\s+sandbox/);
    expect(body).toMatch(/test\s+"\$\(id -u sandbox\)"\s+=\s+"1000"/);
    expect(body).toMatch(/test\s+"\$\(id -g sandbox\)"\s+=\s+"1000"/);
    expect(body).toMatch(/\bnodejs\b/);
    expect(body).toMatch(/\bnpm\b/);
    expect(body).toMatch(/\bchromium\b/);
    expect(body).toMatch(/\bpoppler-utils\b/);
    expect(body).toMatch(/\bfonts-noto-cjk\b/);
    expect(body).toMatch(/node_major/);
    expect(body).toMatch(/test "\$node_major" -ge 20/);
    expect(body).toMatch(/Noto Sans CJK SC/);
    expect(body).toMatch(/FORBIDDEN rebuild pattern/);
    expect(body).toMatch(/openbot-sandbox:bookworm-slim/);
  });

  it("keeps SANDBOX_RUNTIME_UID aligned with the image contract", () => {
    expect(SANDBOX_RUNTIME_UID).toBe(1000);
    expect(SANDBOX_RUNTIME_GID).toBe(1000);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isMissingFilesystemPath,
  listMacNodeHostApprovalCwdFallbacks,
  selectMacNodeHostApprovalCwd,
  type MacNodeHostApprovalCwdDeps,
} from "./invoke-system-run-cwd.js";
import {
  buildSystemRunApprovalPlan,
  resolveApprovalCwdForSystemRun,
} from "./invoke-system-run-plan.js";

const LINUX_WORKSPACE = "/home/ubuntu/.openbot/workspace";

function isRealApprovableDirectory(candidate: string): boolean {
  try {
    const listed = fs.lstatSync(candidate);
    // Reject symlink candidates (e.g. process.cwd link) but accept real dirs
    // under macOS /var -> /private/var (realpath !== path.resolve).
    if (!listed.isDirectory() || listed.isSymbolicLink()) {
      return false;
    }
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function deps(
  overrides: Partial<MacNodeHostApprovalCwdDeps> &
    Pick<MacNodeHostApprovalCwdDeps, "isApprovableDirectory">,
): MacNodeHostApprovalCwdDeps {
  return {
    platform: "darwin",
    processCwd: () => "/Users/mac/node-host",
    envHome: "/Users/mac",
    homedir: () => "/Users/mac",
    isMissingPath: () => true,
    ...overrides,
  };
}

describe("selectMacNodeHostApprovalCwd", () => {
  it("falls back to process.cwd before Documents and HOME", () => {
    const seen: string[] = [];
    const selected = selectMacNodeHostApprovalCwd(
      LINUX_WORKSPACE,
      deps({
        isApprovableDirectory: (candidate) => {
          seen.push(candidate);
          return candidate === "/Users/mac/node-host";
        },
      }),
    );
    expect(selected).toBe("/Users/mac/node-host");
    expect(seen).toEqual(["/Users/mac/node-host"]);
  });

  it("uses ~/Documents when process.cwd is not an approvable directory", () => {
    const seen: string[] = [];
    const selected = selectMacNodeHostApprovalCwd(
      "/root/.openclaw/workspace-main",
      deps({
        isApprovableDirectory: (candidate) => {
          seen.push(candidate);
          return candidate === "/Users/mac/Documents";
        },
      }),
    );
    expect(selected).toBe("/Users/mac/Documents");
    expect(seen).toEqual(["/Users/mac/node-host", "/Users/mac/Documents"]);
  });

  it("uses $HOME when process.cwd and Documents are not approvable", () => {
    const seen: string[] = [];
    const selected = selectMacNodeHostApprovalCwd(
      "/workspace/openbot",
      deps({
        isApprovableDirectory: (candidate) => {
          seen.push(candidate);
          return candidate === "/Users/mac";
        },
      }),
    );
    expect(selected).toBe("/Users/mac");
    expect(seen).toEqual(["/Users/mac/node-host", "/Users/mac/Documents", "/Users/mac"]);
  });

  it("reads HOME from the environment before os.homedir", () => {
    const fallbacks = listMacNodeHostApprovalCwdFallbacks({
      processCwd: () => "/srv/node",
      envHome: "/Users/from-env",
      homedir: () => {
        throw new Error("homedir should not be called when HOME is set");
      },
    });
    expect(fallbacks).toEqual(["/srv/node", "/Users/from-env/Documents", "/Users/from-env"]);
  });

  it("uses os.homedir when HOME is unset", () => {
    const fallbacks = listMacNodeHostApprovalCwdFallbacks({
      processCwd: () => {
        throw new Error("cwd missing");
      },
      envHome: "  ",
      homedir: () => "/Users/from-os",
    });
    expect(fallbacks).toEqual(["/Users/from-os/Documents", "/Users/from-os"]);
  });

  it("keeps the original cwd when every fallback fails the canonical check", () => {
    const selected = selectMacNodeHostApprovalCwd(
      LINUX_WORKSPACE,
      deps({ isApprovableDirectory: () => false }),
    );
    expect(selected).toBe(LINUX_WORKSPACE);
  });

  it("does not rewrite a missing macOS-local cwd", () => {
    const missing = "/Users/mac/Projects/missing";
    const selected = selectMacNodeHostApprovalCwd(
      missing,
      deps({
        isMissingPath: () => true,
        isApprovableDirectory: () => true,
      }),
    );
    expect(selected).toBe(missing);
  });

  it("does not rewrite a Linux workspace path that exists on this Mac", () => {
    const existing = "/opt/openbot/workspace";
    const selected = selectMacNodeHostApprovalCwd(
      existing,
      deps({
        isMissingPath: (candidate) => candidate !== existing,
        isApprovableDirectory: () => {
          throw new Error("existing cwd must not be replaced");
        },
      }),
    );
    expect(selected).toBe(existing);
  });

  it("does not rewrite on non-mac node hosts", () => {
    const selected = selectMacNodeHostApprovalCwd(
      LINUX_WORKSPACE,
      deps({
        platform: "linux",
        isApprovableDirectory: () => true,
      }),
    );
    expect(selected).toBe(LINUX_WORKSPACE);
  });

  it("does not rewrite a relative cwd", () => {
    const selected = selectMacNodeHostApprovalCwd(
      "relative/workspace",
      deps({ isApprovableDirectory: () => true }),
    );
    expect(selected).toBe("relative/workspace");
  });

  it.runIf(process.platform !== "win32")(
    "skips a symlink process.cwd and a missing Documents directory",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cwd-fallback-"));
      const home = path.join(root, "home");
      const cwdLink = path.join(root, "cwd-link");
      fs.mkdirSync(home);
      fs.symlinkSync(home, cwdLink);
      try {
        const selected = selectMacNodeHostApprovalCwd("/root/.openclaw/workspace", {
          platform: "darwin",
          processCwd: () => cwdLink,
          envHome: home,
          homedir: () => home,
          isMissingPath: isMissingFilesystemPath,
          isApprovableDirectory: isRealApprovableDirectory,
        });
        expect(selected).toBe(path.resolve(home));
        expect(isMissingFilesystemPath(path.join(home, "Documents"))).toBe(true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "prefers an existing Documents directory over HOME",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cwd-docs-"));
      const home = path.join(root, "home");
      const documents = path.join(home, "Documents");
      const cwdLink = path.join(root, "cwd-link");
      fs.mkdirSync(documents, { recursive: true });
      fs.symlinkSync(home, cwdLink);
      try {
        const selected = selectMacNodeHostApprovalCwd("/home/gateway/.openbot/workspace", {
          platform: "darwin",
          processCwd: () => cwdLink,
          envHome: home,
          homedir: () => home,
          isMissingPath: isMissingFilesystemPath,
          isApprovableDirectory: isRealApprovableDirectory,
        });
        expect(selected).toBe(path.resolve(documents));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("resolveApprovalCwdForSystemRun", () => {
  it.runIf(process.platform !== "win32")(
    "binds approval to an existing fallback before the prompt",
    () => {
      const selected = resolveApprovalCwdForSystemRun(LINUX_WORKSPACE, "darwin");
      expect(selected).toBeTruthy();
      expect(selected).not.toBe(LINUX_WORKSPACE);
      expect(fs.statSync(selected!).isDirectory()).toBe(true);
      const prepared = buildSystemRunApprovalPlan({
        command: ["/bin/sh", "-c", "echo SAFE"],
        cwd: selected,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) {
        throw new Error("unreachable");
      }
      expect(prepared.plan.cwd).toBe(fs.realpathSync(selected!));
    },
  );

  it.runIf(process.platform !== "darwin")(
    "leaves a missing Linux workspace unchanged on non-mac hosts",
    () => {
      expect(resolveApprovalCwdForSystemRun(LINUX_WORKSPACE)).toBe(LINUX_WORKSPACE);
      const prepared = buildSystemRunApprovalPlan({
        command: ["/bin/sh", "-c", "echo SAFE"],
        cwd: LINUX_WORKSPACE,
      });
      expect(prepared).toEqual({
        ok: false,
        message: "SYSTEM_RUN_DENIED: approval requires an existing canonical cwd",
      });
    },
  );

  it.runIf(process.platform !== "win32")("keeps a missing macOS path denied", () => {
    const missing = "/Users/openbot/does-not-exist-workspace";
    expect(resolveApprovalCwdForSystemRun(missing, "darwin")).toBe(missing);
    const prepared = buildSystemRunApprovalPlan({
      command: ["/bin/sh", "-c", "echo SAFE"],
      cwd: missing,
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) {
      throw new Error("unreachable");
    }
    expect(prepared.message).toBe("SYSTEM_RUN_DENIED: approval requires an existing canonical cwd");
  });
});

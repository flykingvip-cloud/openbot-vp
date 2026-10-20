import { existsSync, mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SandboxOwnershipStat } from "../../agents/sandbox/sandbox-runtime-ownership.js";
import {
  assertAccountProductionWriteAllowed,
  ensureAccountProductionDirectories,
  isRetiredMultitenantWritePath,
  resolveAccountExecutionPaths,
} from "../account-execution-paths.js";
import {
  copyMissingOperatorWorkspace,
  relocateTenantsVolumeUserPath,
  rewriteTenantsVolumeUserPaths,
} from "./operator-workspace-heal.js";

const ENV_KEYS = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
] as const;

const ZHANGXS = "e8666db5-f43d-4d98-883e-536a6808a8c0";
const XUBB = "c9c35f3f-2a50-4df8-992c-1f8f4e26e6d1";
const THIRD = "7dd0afd7-8606-4e2d-9c0a-2fe4bb374a6a";
const TENANT = "workspace-17-1cf3799d";

function saveEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    prev[key] = process.env[key];
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function liveWorkspace(tenantsRoot: string, userId: string): string {
  return path.join(tenantsRoot, TENANT, "users", userId, "OpenBot", "agents", "main", "workspace");
}

describe("operator workspace heal", () => {
  let prev: Record<string, string | undefined> = {};
  let root = "";

  afterEach(async () => {
    restoreEnv(prev);
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("keeps the LIVE tenants workspace retired and remounts it onto operators", () => {
    prev = saveEnv();
    root = mkdtempSync(path.join(os.tmpdir(), "ob-op-heal-live-"));
    const stateDir = path.join(root, "state");
    const tenantsRoot = "/root/openbot-tenants";
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_STATE_DIR = stateDir;

    for (const userId of [ZHANGXS, XUBB, THIRD]) {
      const retired = liveWorkspace(tenantsRoot, userId);
      expect(isRetiredMultitenantWritePath(retired)).toBe(true);
      expect(relocateTenantsVolumeUserPath(retired)).toBe(
        path.join(stateDir, "operators", userId, "OpenBot", "agents", "main", "workspace"),
      );
      expect(isRetiredMultitenantWritePath(relocateTenantsVolumeUserPath(retired))).toBe(false);
    }
  });

  it("copies missing workspace files and refuses a new write on the tenants root", async () => {
    prev = saveEnv();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-op-heal-copy-"));
    const tenantsRoot = path.join(root, "tenants");
    const stateDir = path.join(root, "state");
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_STATE_DIR = stateDir;
    const cfg = { data: { mode: "managed" as const } };
    const ctx = { tenantId: TENANT, userId: ZHANGXS, domain: "employee" as const };
    const retired = liveWorkspace(tenantsRoot, ZHANGXS);
    await fs.mkdir(retired, { recursive: true });
    await fs.writeFile(path.join(retired, "USER.md"), "keep", "utf8");
    await fs.mkdir(path.join(retired, ".git"), { recursive: true });
    await fs.writeFile(path.join(retired, ".git", "config"), "skip", "utf8");

    const paths = await ensureAccountProductionDirectories({ ctx, cfg, agentId: "main" });

    expect(paths.workspaceDir).toBe(
      path.join(stateDir, "operators", ZHANGXS, "OpenBot", "agents", "main", "workspace"),
    );
    expect(paths.workspaceDir.includes(TENANT)).toBe(false);
    expect(await fs.readFile(path.join(paths.workspaceDir, "USER.md"), "utf8")).toBe("keep");
    expect(existsSync(path.join(paths.workspaceDir, ".git"))).toBe(false);
    const retiredEntries = (await fs.readdir(retired)).toSorted();
    expect(retiredEntries).toEqual([".git", "USER.md"]);
    expect(() => assertAccountProductionWriteAllowed(retired, cfg)).toThrow(/retired root/);
    expect(() => assertAccountProductionWriteAllowed(paths.workspaceDir, cfg)).not.toThrow();
    expect(isRetiredMultitenantWritePath(paths.browserProfileDir)).toBe(false);
    expect(paths.browserProfileDir).toBe(
      path.join(stateDir, "operators", ZHANGXS, "state", "browser"),
    );
  });

  it("does not clobber an operator file that is already there", async () => {
    prev = saveEnv();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-op-heal-keep-"));
    const from = path.join(root, "from");
    const to = path.join(root, "to");
    await fs.mkdir(from, { recursive: true });
    await fs.mkdir(to, { recursive: true });
    await fs.writeFile(path.join(from, "USER.md"), "old", "utf8");
    await fs.writeFile(path.join(to, "USER.md"), "operator", "utf8");
    await fs.writeFile(path.join(from, "NEW.md"), "copied", "utf8");

    await copyMissingOperatorWorkspace(from, to);

    expect(await fs.readFile(path.join(to, "USER.md"), "utf8")).toBe("operator");
    expect(await fs.readFile(path.join(to, "NEW.md"), "utf8")).toBe("copied");
  });

  it("chowns a healed operator tree to the sandbox user and does not chown the source", async () => {
    prev = saveEnv();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-op-heal-own-"));
    const from = path.join(
      root,
      "tenants",
      TENANT,
      "users",
      ZHANGXS,
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    const to = path.join(
      root,
      "state",
      "operators",
      ZHANGXS,
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    await fs.mkdir(from, { recursive: true });
    await fs.writeFile(path.join(from, "USER.md"), "keep", "utf8");
    await fs.mkdir(path.join(to, "notes"), { recursive: true });
    await fs.writeFile(path.join(to, "notes", "old.txt"), "stay", "utf8");
    const chowned: string[] = [];
    const ownershipStat = async (target: string): Promise<SandboxOwnershipStat> => {
      const real = await fs.lstat(target);
      return {
        uid: 0,
        gid: 0,
        isDirectory: () => real.isDirectory(),
        isSymbolicLink: () => real.isSymbolicLink(),
      };
    };
    await copyMissingOperatorWorkspace(from, to, {
      io: {
        getuid: () => 0,
        lstat: ownershipStat,
        readdir: (target) => fs.readdir(target, { withFileTypes: true }),
        chown: async (target, uid, gid) => {
          chowned.push(`${target} ${uid}:${gid}`);
        },
        lchown: async (target, uid, gid) => {
          chowned.push(`link ${target} ${uid}:${gid}`);
        },
      },
    });
    expect(await fs.readFile(path.join(to, "USER.md"), "utf8")).toBe("keep");
    expect(await fs.readFile(path.join(from, "USER.md"), "utf8")).toBe("keep");
    expect(chowned).toContain(`${to} 1000:1000`);
    expect(chowned).toContain(`${path.join(to, "USER.md")} 1000:1000`);
    expect(chowned).toContain(`${path.join(to, "notes", "old.txt")} 1000:1000`);
    expect(chowned.some((line) => line.startsWith(from))).toBe(false);
    expect(chowned.some((line) => line.includes(`${path.sep}${TENANT}${path.sep}`))).toBe(false);
  });

  it("leaves personal execution paths off the operator tree", () => {
    prev = saveEnv();
    root = mkdtempSync(path.join(os.tmpdir(), "ob-op-heal-local-"));
    process.env.OPENBOT_DATA_MODE = "local";
    delete process.env.OPENBOT_MULTITENANT;
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    const paths = resolveAccountExecutionPaths({
      ctx: { tenantId: TENANT, userId: XUBB, domain: "employee" },
      cfg: { data: { mode: "local" } },
      agentId: "main",
    });
    expect(paths.workspaceDir.includes(`${path.sep}operators${path.sep}`)).toBe(false);
  });

  it("rewrites skill snapshot paths and keeps an already healed snapshot", () => {
    prev = saveEnv();
    root = mkdtempSync(path.join(os.tmpdir(), "ob-op-heal-skills-"));
    const stateDir = path.join(root, "state");
    const tenantsRoot = "/root/openbot-tenants";
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_STATE_DIR = stateDir;
    const retired = liveWorkspace(tenantsRoot, ZHANGXS);
    const healed = path.join(
      stateDir,
      "operators",
      ZHANGXS,
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    const snapshot = {
      prompt: `read ${retired}/skills/demo/SKILL.md and ${retired}`,
      skills: [{ name: "demo" }],
      resolvedSkills: [{ filePath: `${retired}/skills/demo/SKILL.md`, baseDir: retired }],
      version: 3,
    };

    const rewritten = rewriteTenantsVolumeUserPaths(snapshot);
    expect(rewritten).not.toBe(snapshot);
    expect(rewritten.prompt).toBe(`read ${healed}/skills/demo/SKILL.md and ${healed}`);
    expect(rewritten.resolvedSkills?.[0]?.filePath).toBe(`${healed}/skills/demo/SKILL.md`);
    expect(rewritten.version).toBe(3);
    expect(rewriteTenantsVolumeUserPaths(rewritten)).toBe(rewritten);

    const unrelated = { prompt: "no tenants path" };
    expect(rewriteTenantsVolumeUserPaths(unrelated)).toBe(unrelated);
  });
});

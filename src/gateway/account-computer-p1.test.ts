/**
 * Account Computer v4.1 P1: production writes go through the existing resolvers.
 * Retired roots receive no new writes. Shared skills are not copied into user trees.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SandboxOwnershipStat } from "../agents/sandbox/sandbox-runtime-ownership.js";
import { syncSkillsToWorkspace } from "../agents/skills.js";
import { launchOpenClawChrome } from "../browser/chrome.js";
import { CONFIG_DIR } from "../utils.js";
import {
  assertAccountProductionWriteAllowed,
  ensureAccountProductionDirectories,
  isRetiredMultitenantWritePath,
  resolveAccountExecutionPaths,
} from "./account-execution-paths.js";
import {
  resolveDataRootForContext,
  resolveTenantRuntimeStateRootForContext,
} from "./tenant-store-paths.js";
import { discoverWorkspaceCandidates } from "./workspace-inventory/discover-candidates.js";
import { runWorkspaceInventory } from "./workspace-inventory/inventory.js";
import { resolveRobotOwnWriteRoot } from "./workspace-resolver/write-roots.js";

const ENV_KEYS = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
] as const;

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

const managedCfg = { data: { mode: "managed" as const } };
const ctx = { tenantId: "tenant-a", userId: "user-a", domain: "employee" as const };

describe("account computer P1 path closure", () => {
  let prev: Record<string, string | undefined>;
  let root = "";

  afterEach(async () => {
    restoreEnv(prev);
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("returns workspace, artifacts, and browser from the three resolvers", () => {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-p1-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    const stateDir = path.join(root, "operator-state");
    process.env.OPENBOT_STATE_DIR = stateDir;

    const paths = resolveAccountExecutionPaths({ ctx, cfg: managedCfg, agentId: "Bot" });
    const operatorRoot = path.join(stateDir, "operators", "user-a");
    const dataRoot = resolveDataRootForContext(ctx, managedCfg);
    const stateRoot = resolveTenantRuntimeStateRootForContext(ctx);
    expect(paths.dataRoot).not.toBe(dataRoot);
    expect(paths.stateRoot).not.toBe(stateRoot);
    expect(paths.dataRoot).toBe(path.join(operatorRoot, "OpenBot"));
    expect(paths.stateRoot).toBe(path.join(operatorRoot, "state"));
    expect(paths.workspaceDir).toBe(
      path.join(operatorRoot, "OpenBot", "agents", "bot", "workspace"),
    );
    expect(paths.artifactsDir).toBe(path.join(path.dirname(paths.workspaceDir), "artifacts"));
    expect(paths.browserProfileDir).toBe(path.join(operatorRoot, "state", "browser"));
    expect(
      resolveRobotOwnWriteRoot({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        agentId: "bot",
        dataRoot,
      }),
    ).toBe(path.join(root, "tenant-a", "users", "user-a", "OpenBot", "agents", "bot", "workspace"));
    expect(isRetiredMultitenantWritePath(paths.workspaceDir)).toBe(false);
    expect(isRetiredMultitenantWritePath(paths.artifactsDir)).toBe(false);
    expect(isRetiredMultitenantWritePath(paths.browserProfileDir)).toBe(false);
  });

  it("creates canonical dirs and leaves retired roots untouched", async () => {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-p1-write-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    const retiredFlat = path.join(root, "tenant-a", "users", "user-a", "OpenBot", "workspace");
    const retiredHost = path.join(root, "workspace-bot");
    const retiredEmployees = path.join(root, "agents", "main", "employees", "user-a", "workspace");
    await fsp.mkdir(retiredFlat, { recursive: true });
    await fsp.writeFile(path.join(retiredFlat, "old.txt"), "keep", "utf8");
    const hostBrowser = path.join(CONFIG_DIR, "browser");
    const hostBrowserBefore = fs.existsSync(hostBrowser);

    const paths = await ensureAccountProductionDirectories({
      ctx,
      cfg: managedCfg,
      agentId: "bot",
    });

    expect(fs.existsSync(paths.workspaceDir)).toBe(true);
    expect(fs.existsSync(paths.artifactsDir)).toBe(true);
    expect(fs.existsSync(paths.browserProfileDir)).toBe(true);
    expect(fs.existsSync(path.join(paths.workspaceDir, "skills"))).toBe(false);
    expect(await fsp.readFile(path.join(retiredFlat, "old.txt"), "utf8")).toBe("keep");
    const flatEntries = await fsp.readdir(retiredFlat);
    expect(flatEntries).toEqual(["old.txt"]);
    expect(fs.existsSync(retiredHost)).toBe(false);
    expect(fs.existsSync(retiredEmployees)).toBe(false);
    expect(fs.existsSync(hostBrowser)).toBe(hostBrowserBefore);

    expect(() => assertAccountProductionWriteAllowed(retiredFlat, managedCfg)).toThrow(/retired/);
    expect(() =>
      assertAccountProductionWriteAllowed(
        path.join(hostBrowser, "openclaw", "user-data"),
        managedCfg,
      ),
    ).toThrow(/retired/);
    expect(() => assertAccountProductionWriteAllowed(paths.workspaceDir, managedCfg)).not.toThrow();
    expect(() =>
      assertAccountProductionWriteAllowed(
        retiredFlat,
        { data: { mode: "local" } },
        {
          OPENBOT_DATA_MODE: "local",
        },
      ),
    ).not.toThrow();
  });

  it("chowns sandbox mounts to uid 1000 when the gateway is root", async () => {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-p1-own-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    const chowned: string[] = [];
    const rootOwned: SandboxOwnershipStat = {
      uid: 0,
      gid: 0,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
    const paths = await ensureAccountProductionDirectories({
      ctx,
      cfg: managedCfg,
      agentId: "bot",
      ownership: {
        io: {
          getuid: () => 0,
          lstat: async () => rootOwned,
          readdir: async () => [],
          chown: async (target, uid, gid) => {
            chowned.push(`${target} ${uid}:${gid}`);
          },
        },
      },
    });

    expect(chowned.toSorted()).toEqual(
      [paths.workspaceDir, paths.artifactsDir, paths.sharedArtifactsDir, paths.browserProfileDir]
        .map((dir) => `${dir} 1000:1000`)
        .toSorted(),
    );
  });

  it("leaves mount ownership alone when the gateway is not root", async () => {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-p1-noroot-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    let chowned = false;
    const paths = await ensureAccountProductionDirectories({
      ctx,
      cfg: managedCfg,
      agentId: "bot",
      ownership: {
        io: {
          getuid: () => 1000,
          chown: async () => {
            chowned = true;
          },
        },
      },
    });
    expect(chowned).toBe(false);
    expect(fs.existsSync(paths.browserProfileDir)).toBe(true);
  });

  it("does not copy shared skills into the user workspace", async () => {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-p1-skills-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    const paths = await ensureAccountProductionDirectories({
      ctx,
      cfg: managedCfg,
      agentId: "bot",
    });
    const shared = path.join(root, "shared-skills");
    await fsp.mkdir(path.join(shared, "demo-skill"), { recursive: true });
    await fsp.writeFile(
      path.join(shared, "demo-skill", "SKILL.md"),
      "---\nname: demo\n---\n",
      "utf8",
    );

    await expect(
      syncSkillsToWorkspace({
        sourceWorkspaceDir: shared,
        targetWorkspaceDir: paths.workspaceDir,
      }),
    ).rejects.toThrow(/read-only/);
    expect(fs.existsSync(path.join(paths.workspaceDir, "skills"))).toBe(false);
    expect(fs.existsSync(path.join(paths.workspaceDir, "demo-skill"))).toBe(false);
  });

  it("refuses host browser launch when shared addressing is on", async () => {
    prev = saveEnv();
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    await expect(
      launchOpenClawChrome(
        { profiles: {} } as never,
        { name: "openclaw", cdpPort: 1, cdpIsLoopback: true } as never,
      ),
    ).rejects.toThrow(/runtime state root/);
  });

  it("classifies persistent, secret, shared, ephemeral, and legacy roots", () => {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-p1-inv-"));
    const userBase = path.join(root, "tenants", "tenant-a", "users", "user-a", "OpenBot");
    fs.mkdirSync(path.join(userBase, "workspace"), { recursive: true });
    fs.writeFileSync(path.join(userBase, "workspace", "old.txt"), "legacy");
    fs.mkdirSync(path.join(userBase, "agents", "bot", "workspace"), { recursive: true });
    fs.mkdirSync(path.join(userBase, "agents", "bot", "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(userBase, "agents", "bot", "artifacts", "file.bin"), "artifact");
    fs.mkdirSync(path.join(userBase, "memory"), { recursive: true });
    const browser = path.join(root, "tenants", "tenant-a", "users", "user-a", "state", "browser");
    fs.mkdirSync(browser, { recursive: true });
    fs.writeFileSync(path.join(browser, "Cookies"), "cookie");
    const secret = path.join(
      root,
      "tenants",
      "tenant-a",
      "users",
      "user-a",
      "state",
      "agents",
      "bot",
      "agent",
    );
    fs.mkdirSync(secret, { recursive: true });
    fs.writeFileSync(path.join(secret, "auth-profiles.json"), "sk-live-secret-value");
    fs.mkdirSync(path.join(root, "skills", "shared"), { recursive: true });
    fs.mkdirSync(path.join(root, "canvas"), { recursive: true });
    fs.mkdirSync(path.join(root, "cache"), { recursive: true });
    fs.mkdirSync(path.join(root, "workspace-bot"), { recursive: true });

    const { candidates } = discoverWorkspaceCandidates({
      containmentRoot: root,
      maxCandidates: 100,
    });
    const byClass = new Map(
      candidates.map((candidate) => [candidate.normalizedRootClass, candidate]),
    );
    expect(byClass.get("data_space_flat_workspace")?.durabilityClass).toBe("LEGACY");
    expect(byClass.get("host_workspace_agent")?.durabilityClass).toBe("LEGACY");
    expect(byClass.get("agent_workspace")?.durabilityClass).toBe("PERSISTENT");
    expect(byClass.get("agent_artifacts")?.durabilityClass).toBe("PERSISTENT");
    expect(byClass.get("account_memory")?.durabilityClass).toBe("PERSISTENT");
    expect(byClass.get("account_browser_profile")?.durabilityClass).toBe("PERSISTENT");
    expect(byClass.get("account_credential_dir")?.durabilityClass).toBe("SECRET");
    expect(byClass.get("host_skill_risk")?.durabilityClass).toBe("SHARED_READONLY");
    expect(byClass.get("canvas_risk")?.durabilityClass).toBe("SHARED_READONLY");
    expect(byClass.get("ephemeral_cache")?.durabilityClass).toBe("EPHEMERAL");

    const report = runWorkspaceInventory({
      containmentRoot: root,
      inventoryUtc: "2026-10-06T00:00:00.000Z",
    });
    const secretRecord = report.records.find(
      (record) => record.normalizedRootClass === "account_credential_dir",
    );
    expect(secretRecord?.contentDigest).toBeNull();
    expect(secretRecord?.fileCount).toBe(0);
    expect(JSON.stringify(report)).not.toContain("sk-live-secret-value");
  });
});

describe("account computer P1 new path code", () => {
  it("does not concatenate retired roots", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "account-execution-paths.ts"), "utf8");
    expect(source).not.toMatch(/CONFIG_DIR,\s*["']browser["']/);
    expect(source).not.toMatch(/["']OpenBot["']\s*,\s*["']workspace["']/);
    expect(source).not.toMatch(/["']users["']\s*,[^;\n]*["']workspace["']/);
  });
});

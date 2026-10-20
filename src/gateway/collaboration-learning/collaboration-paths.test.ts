import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import {
  materializeGroupCollaborationWorkspace,
  resolveGroupCollaborationPaths,
  resolveGroupPublicTranscriptPath,
} from "./collaboration-paths.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("resolveGroupCollaborationPaths", () => {
  it("throws when groupId is empty", () => {
    expect(() => resolveGroupCollaborationPaths("  ")).toThrow(/groupId is required/);
  });

  it("materializes workspace and memory under configured collaboration root", async () => {
    const stateDir = await makeTempDir("openbot-collab-paths-state-");
    const workspaceDir = await makeTempDir("openbot-collab-paths-ws-");
    const collaborationRoot = await makeTempDir("openbot-collab-paths-root-");
    const previousState = process.env.OPENBOT_STATE_DIR;
    const previousConfig = process.env.OPENCLAW_CONFIG_PATH;
    const previousOpenbotConfig = process.env.OPENBOT_CONFIG_PATH;
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    await fs.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
    await fs.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { defaults: { workspace: collaborationRoot } },
      }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    try {
      const groupId = "grp-test-convergence";
      const paths = resolveGroupCollaborationPaths(groupId);
      expect(paths.groupRootDir).toBe(path.join(collaborationRoot, "groups"));
      expect(paths.memoryDir).toBe(
        path.join(collaborationRoot, "groups", encodeURIComponent(groupId), "memory"),
      );
      expect(paths.managedSpaceDir).toBe(paths.groupDir);

      expect(paths.publicTranscriptFile).toBe(
        path.join(
          collaborationRoot,
          "groups",
          encodeURIComponent(groupId),
          "runtime",
          "transcript.jsonl",
        ),
      );
      expect(resolveGroupPublicTranscriptPath(groupId)).toBe(paths.publicTranscriptFile);

      const workspacePath = await materializeGroupCollaborationWorkspace(groupId);
      expect(workspacePath).toBe(paths.workspacePath);
      await expect(fs.stat(paths.memoryDir)).resolves.toBeDefined();
      await expect(fs.stat(path.join(paths.groupDir, "runtime"))).resolves.toBeDefined();
    } finally {
      clearConfigCache();
      clearRuntimeConfigSnapshot();
      if (previousState === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previousState;
      }
      if (previousConfig === undefined) {
        delete process.env.OPENCLAW_CONFIG_PATH;
      } else {
        process.env.OPENCLAW_CONFIG_PATH = previousConfig;
      }
      if (previousOpenbotConfig === undefined) {
        delete process.env.OPENBOT_CONFIG_PATH;
      } else {
        process.env.OPENBOT_CONFIG_PATH = previousOpenbotConfig;
      }
    }
  });
});

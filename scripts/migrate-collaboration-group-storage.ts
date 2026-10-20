/**
 * 一次性迁移：协作群 storage 收敛到唯一 collaboration root。
 *
 * 用法：
 *   bun scripts/migrate-collaboration-group-storage.ts \
 *     --group-id grp-daniel-hhd-gmail-com-upbeyond \
 *     [--collaboration-root ~/.openbot/collaboration-shared] \
 *     [--dry-run] \
 *     [--apply-config] \
 *     [--remove-copies]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../src/agents/agent-scope.js";
import { loadConfig, writeConfigFile } from "../src/config/config.js";
import { resolveStateDir } from "../src/config/paths.js";
import { materializeGroupCollaborationWorkspace } from "../src/gateway/collaboration-learning/collaboration-paths.js";
import {
  discoverLegacyGroupDirs,
  migrateCollaborationGroupStorage,
  resolveManagedSpaceProfilePath,
} from "../src/gateway/collaboration-learning/group-storage-migration.js";
import { resolveUserPath } from "../src/utils.js";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1]?.trim() || null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function applyCollaborationRootConfig(collaborationRoot: string): Promise<void> {
  const cfg = loadConfig();
  const nextCfg = {
    ...cfg,
    collaboration: {
      ...cfg.collaboration,
      defaults: {
        ...cfg.collaboration?.defaults,
        workspace: collaborationRoot,
      },
    },
  };
  await writeConfigFile(nextCfg);
}

async function run(): Promise<void> {
  const groupId = readArg("--group-id");
  if (!groupId) {
    throw new Error("--group-id is required");
  }

  const dryRun = hasFlag("--dry-run");
  const applyConfig = hasFlag("--apply-config");
  const removeCopies = hasFlag("--remove-copies");
  const stateDir = resolveStateDir();
  const cfg = loadConfig();
  const defaultWorkspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const collaborationRoot = resolveUserPath(
    readArg("--collaboration-root") ??
      cfg.collaboration?.defaults?.workspace?.trim() ??
      path.join(stateDir, "collaboration-shared"),
  );

  const legacyGroupDirs = await discoverLegacyGroupDirs({
    stateDir,
    groupId,
    extraRoots: [defaultWorkspaceDir],
  });

  const managedSpaceProfilePath = resolveManagedSpaceProfilePath(stateDir, groupId);
  const backupDir = dryRun
    ? null
    : path.join(
        stateDir,
        "backups",
        `collaboration-migrate-${groupId}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      );

  if (applyConfig && !dryRun) {
    await applyCollaborationRootConfig(collaborationRoot);
  }

  const report = await migrateCollaborationGroupStorage({
    groupId,
    collaborationRoot,
    legacyGroupDirs,
    managedSpaceProfilePath,
    backupDir,
    dryRun,
    removeLegacyCopies: removeCopies,
  });

  if (!dryRun) {
    await materializeGroupCollaborationWorkspace(groupId);
    const sharedMemoryPath = path.join(stateDir, "spaces", groupId, "SHARED_MEMORY.md");
    if (
      !(await fs
        .access(sharedMemoryPath)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.writeFile(
        sharedMemoryPath,
        `# ${groupId}\n\nShared group memory summary (human-editable).\n`,
        "utf8",
      );
      report.copiedGroupFiles.push("spaces/SHARED_MEMORY.md");
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});

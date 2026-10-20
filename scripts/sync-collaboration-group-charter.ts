/**
 * 将 group charter 物化到 canonical group root（触发 operating-state sync → charter sync）。
 *
 * 用法：
 *   bun scripts/sync-collaboration-group-charter.ts \
 *     --group-id grp-daniel-hhd-gmail-com-upbeyond
 */

import fs from "node:fs/promises";
import { loadConfig } from "../src/config/config.js";
import { resolveGroupCollaborationPaths } from "../src/gateway/collaboration-learning/collaboration-paths.js";
import {
  createWorkspaceCollaborationStores,
  syncGroupOperatingState,
} from "../src/gateway/collaboration-learning/shared.js";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1]?.trim() || null;
}

async function main(): Promise<void> {
  const groupId = readArg("--group-id");
  if (!groupId) {
    throw new Error("--group-id is required");
  }

  const {
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores(loadConfig());

  await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId,
  });

  const paths = resolveGroupCollaborationPaths(groupId, loadConfig());
  await fs.access(paths.groupCharterFile);
  console.log(`Charter synced: ${paths.groupCharterFile}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

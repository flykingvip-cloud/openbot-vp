import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  createWorkspaceCollaborationStores,
  syncGroupOperatingState,
  writeGroupOperatingState,
} from "./shared.js";

const tempDirs: string[] = [];

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENBOT_STATE_DIR;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract: true },
    },
  } as OpenBotConfig;
}

async function useSyncHarness(): Promise<{
  cfg: OpenBotConfig;
  groupId: string;
  stores: ReturnType<typeof createWorkspaceCollaborationStores>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-os-bind-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const groupId = "grp-os-bind";
  const stores = createWorkspaceCollaborationStores(cfg);
  await stores.groupStorage.writeProfile({
    groupId,
    groupCode: groupId,
    displayName: "os-bind",
    ownerUserId: "human:owner",
    coordinatorBotId: "bot-c",
    createdAtMs: 1,
    updatedAtMs: 1,
  });
  await stores.groupStorage.writeMembers(groupId, [
    {
      memberId: "human:owner",
      memberKind: "human",
      userId: "human:owner",
      name: "Owner",
      governanceRole: "owner",
      status: "active",
      updatedAtMs: 1,
    },
    {
      memberId: "bot-c",
      memberKind: "bot",
      agentId: "bot-c",
      name: "Coordinator",
      governanceRole: "member",
      status: "active",
      updatedAtMs: 1,
    },
  ]);
  return { cfg, groupId, stores };
}

it("live seam: repeated observation preserves proposal version, real policy change advances it", async () => {
  const { cfg, groupId, stores } = await useSyncHarness();
  const sync = () => syncGroupOperatingState({ ...stores, groupId });
  const first = await sync();
  await new Promise((resolve) => setTimeout(resolve, 12));
  const second = await sync();
  expect(second.updatedAtMs).toBe(first.updatedAtMs);
  await writeGroupOperatingState({
    fileStore: stores.fileStore,
    groupId,
    state: { ...second, updatedAtMs: second.updatedAtMs + 50 },
    cfg,
  });
  const observed = await sync();
  expect(observed.updatedAtMs).toBe(first.updatedAtMs);
  const changed = {
    ...second,
    collaborationPolicy: { ...second.collaborationPolicy, maxVisibleBotRepliesPerRound: 2 },
    updatedAtMs: second.updatedAtMs + 100,
  };
  await writeGroupOperatingState({ fileStore: stores.fileStore, groupId, state: changed, cfg });
  const third = await sync();
  expect(third.updatedAtMs).not.toBe(first.updatedAtMs);
  expect(third.collaborationPolicy.maxVisibleBotRepliesPerRound).toBe(2);
  await writeGroupOperatingState({
    fileStore: stores.fileStore,
    groupId,
    cfg,
    state: {
      ...third,
      activeContext: { ...third.activeContext, updatedAtMs: third.activeContext.updatedAtMs + 1 },
      updatedAtMs: third.updatedAtMs + 1,
    },
  });
  const stored = await stores.fileStore.readGroupFile<{ updatedAtMs: number }>({
    groupId,
    filename: "operating-state.json",
  });
  expect(stored?.updatedAtMs).toBe(third.updatedAtMs + 1);
});

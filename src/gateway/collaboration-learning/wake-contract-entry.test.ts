/**
 * C2 follow-up — whoWokeWhom / listWakeEvents entry (read-only; no flag required).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { recordStructuredMentionWake } from "../collaboration-dispatch/wake-contract.js";
import { getCollaborationWhoWokeWhom, listCollaborationWakeEvents } from "./wake-contract-entry.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function useConfig(wakeContract: boolean) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c2-wake-entry-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { wakeContract },
    },
  } as OpenBotConfig;
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

describe("wake-contract-entry", () => {
  test("whoWokeWhom entry returns timeline after structured mention write", async () => {
    const { cfg } = await useConfig(true);
    const authority = createRuntimeAuthority({
      snapshot: createRoundPolicySnapshot(
        { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
        { now: 1, idGen: () => "pss_wake_entry" },
      ),
      episodeId: "ep_wake_entry",
      tenant: { tenantId: null, trust: "none" },
      groupId: "grp_wake_entry",
      profile: "personal_local",
      cfg,
    });
    await recordStructuredMentionWake(
      authority,
      {
        groupId: "grp_wake_entry",
        fromAgentId: "human_ops",
        toAgentIds: ["bot_a", "bot_b"],
        taskId: "task_entry_1",
        relatedId: "run_1",
      },
      { cfg },
    );
    const listed = await listCollaborationWakeEvents({
      groupId: "grp_wake_entry",
      taskId: "task_entry_1",
      cfg,
    });
    expect(listed.length).toBe(1);
    const result = await getCollaborationWhoWokeWhom({
      groupId: "grp_wake_entry",
      taskId: "task_entry_1",
      cfg,
    });
    expect(result.timeline.map((row) => row.to).toSorted()).toEqual(["bot_a", "bot_b"]);
    expect(result.timeline.every((row) => row.source === "structured_mention")).toBe(true);
  });
});

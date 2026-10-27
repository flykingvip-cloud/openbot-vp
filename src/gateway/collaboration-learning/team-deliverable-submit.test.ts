import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { readTeamDeliverable, submitTeamDeliverable } from "./team-deliverable-submit.js";

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

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-team-deliv-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
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

describe("submitTeamDeliverable", () => {
  it("rejects empty content without claiming group-dir write", async () => {
    const { cfg } = await useConfig();
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-1",
      actor: "human:owner",
      title: "提纲",
      content: "",
      cfg,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.writtenToGroupDir).toBe(false);
      expect(result.reason).toBe("empty_content");
    }
  });

  it("rejects path traversal", async () => {
    const { cfg } = await useConfig();
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-1",
      actor: "human:owner",
      title: "提纲",
      content: "# hello\n",
      relativePath: "deliverables/../../etc/passwd",
      cfg,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.writtenToGroupDir).toBe(false);
      expect(result.reason).toBe("invalid_relative_path");
    }
  });

  it("submits body to group deliverables locator with verifiable receipt", async () => {
    const { cfg } = await useConfig();
    const body = "# 能源材料研究提纲\n\n来源：IEA 2026\n";
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-outline",
      actor: "bot-writer",
      title: "能源材料研究提纲",
      content: body,
      cfg,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.taskId).toBe("task-outline");
    expect(result.version).toBe(1);
    expect(result.status).toBe("submitted");
    expect(result.sizeBytes).toBe(Buffer.byteLength(body, "utf8"));
    expect(result.relativePath.startsWith("deliverables/")).toBe(true);
    const onDisk = await fs.readFile(result.locator, "utf8");
    expect(onDisk).toBe(body);

    const read = await readTeamDeliverable({
      groupId: "grp_team",
      deliverableId: result.deliverableId,
      actor: "bot-reader",
      cfg,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.content).toBe(body);
    expect(read.contentSha256).toBe(result.contentSha256);
  });

  it("idempotent replay does not mint a new version for same body", async () => {
    const { cfg } = await useConfig();
    const body = "same body\n";
    const first = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-idem",
      actor: "bot-a",
      title: "底稿",
      content: body,
      cfg,
    });
    const second = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-idem",
      actor: "bot-a",
      title: "底稿",
      content: body,
      cfg,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.idempotentReplay).toBe(true);
    expect(second.deliverableId).toBe(first.deliverableId);
    expect(second.version).toBe(first.version);
  });

  it("revision with previousDeliverableId creates a new version", async () => {
    const { cfg } = await useConfig();
    const first = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-rev",
      actor: "bot-a",
      title: "底稿",
      content: "v1\n",
      cfg,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-rev",
      actor: "bot-a",
      title: "底稿",
      content: "v2 revised\n",
      previousDeliverableId: first.deliverableId,
      cfg,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.idempotentReplay).toBe(false);
    expect(second.deliverableId).not.toBe(first.deliverableId);
    expect(second.version).toBe(first.version + 1);
  });
});

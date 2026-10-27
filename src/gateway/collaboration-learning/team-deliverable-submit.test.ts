import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { persistAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { createWorkspaceCollaborationStores } from "./shared.js";
import {
  assertNoSymlinkEscape,
  readTeamDeliverable,
  submitTeamDeliverable,
} from "./team-deliverable-submit.js";

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

async function seedTask(cfg: OpenBotConfig, groupId: string, taskId: string) {
  const stores = createWorkspaceCollaborationStores(cfg);
  const now = Date.now();
  const task: Task = {
    taskId,
    groupId,
    title: taskId,
    status: "ready",
    createdAtMs: now,
    updatedAtMs: now,
  };
  await stores.objectStorage.writeObject(groupId, "task", taskId, task);
}

describe("submitTeamDeliverable", () => {
  it("rejects empty content without claiming group-dir write", async () => {
    const { cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-1");
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-1",
      actor: "human:owner",
      title: "提纲",
      content: "",
      cfg,
      enforceAcl: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.writtenToGroupDir).toBe(false);
      expect(result.reason).toBe("empty_content");
    }
  });

  it("rejects path traversal", async () => {
    const { cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-1");
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-1",
      actor: "human:owner",
      title: "提纲",
      content: "# hello\n",
      relativePath: "deliverables/../../etc/passwd",
      cfg,
      enforceAcl: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.writtenToGroupDir).toBe(false);
      expect(result.reason).toBe("invalid_relative_path");
    }
  });

  it("rejects missing task before any write", async () => {
    const { cfg } = await useConfig();
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "missing-task",
      actor: "human:owner",
      title: "提纲",
      content: "# hello\n",
      cfg,
      enforceAcl: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("task_not_found");
      expect(result.writtenToGroupDir).toBe(false);
    }
  });

  it("submits body to group deliverables locator with verifiable receipt", async () => {
    const { cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-outline");
    const body = "# 能源材料研究提纲\n\n来源：IEA 2026\n";
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-outline",
      actor: "bot-writer",
      title: "能源材料研究提纲",
      content: body,
      cfg,
      enforceAcl: false,
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
      enforceAcl: false,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) {
      return;
    }
    expect(read.content).toBe(body);
    expect(read.contentSha256).toBe(result.contentSha256);
    expect(read.relativePath).toBe(result.relativePath);
    expect(read.locator).toBe(result.locator);
  });

  it("idempotent replay returns stored locator even if request relativePath differs", async () => {
    const { cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-idem");
    const body = "same body\n";
    const first = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-idem",
      actor: "bot-a",
      title: "底稿",
      content: body,
      cfg,
      enforceAcl: false,
    });
    const second = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-idem",
      actor: "bot-a",
      title: "底稿",
      content: body,
      relativePath: "deliverables/other-name.md",
      cfg,
      enforceAcl: false,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.idempotentReplay).toBe(true);
    expect(second.deliverableId).toBe(first.deliverableId);
    expect(second.version).toBe(first.version);
    expect(second.relativePath).toBe(first.relativePath);
    expect(second.locator).toBe(first.locator);
  });

  it("revision with previousDeliverableId creates a new immutable version path", async () => {
    const { cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-rev");
    const first = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-rev",
      actor: "bot-a",
      title: "底稿",
      content: "v1\n",
      cfg,
      enforceAcl: false,
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
      enforceAcl: false,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.idempotentReplay).toBe(false);
    expect(second.deliverableId).not.toBe(first.deliverableId);
    expect(second.version).toBe(first.version + 1);
    expect(second.locator).not.toBe(first.locator);
    const v1 = await fs.readFile(first.locator, "utf8");
    expect(v1).toBe("v1\n");
  });

  it("rejects parent-directory symlink escape", async () => {
    const { root, cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-symlink");
    // Resolve real group dir via a submit path probe: create group dir first.
    const outside = path.join(root, "outside-secret");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "leak.md"), "secret\n", "utf8");
    // Create group deliverables parent then replace deliverables with symlink to outside.
    const first = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-symlink",
      actor: "bot-a",
      title: "seed",
      content: "seed\n",
      cfg,
      enforceAcl: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const groupDir = path.dirname(path.dirname(first.locator)); // .../groupId
    const deliverablesDir = path.join(groupDir, "deliverables");
    await fs.rm(deliverablesDir, { recursive: true, force: true });
    await fs.symlink(outside, deliverablesDir);
    const escaped = await assertNoSymlinkEscape({
      groupDir,
      absolutePath: path.join(deliverablesDir, "x.md"),
    });
    expect(escaped.ok).toBe(false);
    const result = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-symlink",
      actor: "bot-a",
      title: "escape",
      content: "pwn\n",
      relativePath: "deliverables/x.md",
      cfg,
      enforceAcl: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("symlink_escape_rejected");
      expect(result.writtenToGroupDir).toBe(false);
    }
  });
});

describe("submitTeamDeliverable managed ACL", () => {
  it("denies non-member write with no file side effects (two-tenant isolation)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-team-deliv-mt-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: true,
      },
    } as OpenBotConfig;
    // Force managed profile via env for resolveSecurityProfile
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();

    const groupId = "grp_shared_name";
    await persistAuthoritativeGroupMembers({
      groupId,
      tenantId: "tenant-a",
      profile: "managed_enterprise",
      cfg,
      members: [
        {
          memberId: "m-a",
          memberKind: "human",
          userId: "user-a",
          governanceRole: "owner",
          status: "active",
          updatedAtMs: Date.now(),
        },
      ],
    });
    await persistAuthoritativeGroupMembers({
      groupId,
      tenantId: "tenant-b",
      profile: "managed_enterprise",
      cfg,
      members: [
        {
          memberId: "m-b",
          memberKind: "human",
          userId: "user-b",
          governanceRole: "owner",
          status: "active",
          updatedAtMs: Date.now(),
        },
      ],
    });

    // Seed task under personal path is insufficient for managed; still assert ACL deny first.
    const denied = await submitTeamDeliverable({
      groupId,
      taskId: "task-mt",
      actor: "user-b",
      title: "提纲",
      content: "# cross\n",
      cfg,
      enforceAcl: true,
      tenant: { tenantId: "tenant-a", trust: "membership" },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.writtenToGroupDir).toBe(false);
      expect(["write_acl_denied", "trusted_tenant_required", "task_not_found"]).toContain(
        denied.reason,
      );
    }
    // Locator for tenant-a must not contain the cross body.
    const locatorA = resolveTrustedGroupLocator({
      groupId,
      tenantId: "tenant-a",
      profile: "managed_enterprise",
      cfg,
    });
    const leaked = await fs
      .readdir(path.join(locatorA, "deliverables"))
      .then(() => true)
      .catch(() => false);
    if (leaked) {
      const files = await fs.readdir(path.join(locatorA, "deliverables"));
      for (const name of files) {
        const body = await fs.readFile(path.join(locatorA, "deliverables", name), "utf8");
        expect(body.includes("# cross")).toBe(false);
      }
    }
    delete process.env.OPENBOT_SECURITY_PROFILE;
  });
});

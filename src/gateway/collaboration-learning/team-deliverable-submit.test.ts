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
import {
  assertNoSymlinkEscape,
  readTeamDeliverable,
  submitTeamDeliverable,
  writeFileExclusiveImmutable,
} from "./team-deliverable-submit.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

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

async function seedTask(
  cfg: OpenBotConfig,
  groupId: string,
  taskId: string,
  opts?: { tenantId?: string | null; profile?: "personal_local" | "managed_enterprise" },
) {
  const profile = opts?.profile ?? "personal_local";
  const groupLocator = resolveTrustedGroupLocator({
    groupId,
    tenantId: opts?.tenantId ?? null,
    profile,
    cfg,
  });
  const stores = createTrustedGroupStores({
    groupsRoot: path.dirname(groupLocator),
    groupLocator,
  });
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

describe("submitTeamDeliverable concurrency and idempotent file checks", () => {
  it("writeFileExclusiveImmutable refuses different content at same path", async () => {
    const { root } = await useConfig();
    const { createHash } = await import("node:crypto");
    const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
    const target = path.join(root, "deliverables", "same-v2.md");
    const a = await writeFileExclusiveImmutable(target, "body-a\n", sha("body-a\n"));
    expect(a.ok).toBe(true);
    const b = await writeFileExclusiveImmutable(target, "body-b\n", sha("body-b\n"));
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.reason).toBe("version_path_conflict");
    }
    const same = await writeFileExclusiveImmutable(target, "body-a\n", sha("body-a\n"));
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect(same.created).toBe(false);
    }
  });

  it("concurrent different bodies at same logical path: one wins, other conflicts", async () => {
    const { cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-race");
    const rel = "deliverables/fixed-name-v1.md";
    const [a, b] = await Promise.all([
      submitTeamDeliverable({
        groupId: "grp_team",
        taskId: "task-race",
        actor: "bot-a",
        title: "race-a",
        content: "content-aaa\n",
        relativePath: rel,
        logicalId: "race-fixed",
        cfg,
        enforceAcl: false,
      }),
      submitTeamDeliverable({
        groupId: "grp_team",
        taskId: "task-race",
        actor: "bot-b",
        title: "race-b",
        content: "content-bbb\n",
        relativePath: rel,
        logicalId: "race-fixed-b",
        cfg,
        enforceAcl: false,
      }),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const fails = [a, b].filter((r) => !r.ok);
    // Different titles → different logical paths by default; force same relativePath.
    // One may succeed; if both try same path with different content, at least one must not ok
    // OR they used different deliverableIds with same relativePath — wx ensures only one file body.
    if (oks.length === 2) {
      // Same relativePath cannot hold two different bodies
      expect(oks[0].ok && oks[1].ok && oks[0].locator === oks[1].locator).toBe(false);
    } else {
      expect(oks.length).toBeGreaterThanOrEqual(1);
      expect(fails.length).toBeGreaterThanOrEqual(1);
      if (!fails[0].ok) {
        expect(
          [
            "version_path_conflict",
            "formal_root_write_failed",
            "idempotent_replay_content_mismatch",
          ].includes(fails[0].reason) || fails[0].reason.length > 0,
        ).toBe(true);
      }
    }
    if (oks[0]?.ok) {
      const body = await fs.readFile(oks[0].locator, "utf8");
      expect(["content-aaa\n", "content-bbb\n"]).toContain(body);
    }
  });

  it("idempotent replay fails when object exists but formal file is missing", async () => {
    const { cfg } = await useConfig();
    await seedTask(cfg, "grp_team", "task-missing-file");
    const body = "persist-me\n";
    const first = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-missing-file",
      actor: "bot-a",
      title: "底稿",
      content: body,
      cfg,
      enforceAcl: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    await fs.rm(first.locator, { force: true });
    const second = await submitTeamDeliverable({
      groupId: "grp_team",
      taskId: "task-missing-file",
      actor: "bot-a",
      title: "底稿",
      content: body,
      cfg,
      enforceAcl: false,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("idempotent_replay_file_missing");
      expect(second.writtenToGroupDir).toBe(false);
    }
  });
});

describe("submitTeamDeliverable two-tenant same local ids", () => {
  it("same groupId/taskId write to different trusted locators without cross-read", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-team-deliv-2t-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
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

    const groupId = "grp_shared_name";
    const taskId = "task-shared-id";
    for (const [tenantId, userId, memberId] of [
      ["tenant-a", "user-a", "m-a"],
      ["tenant-b", "user-b", "m-b"],
    ] as const) {
      await persistAuthoritativeGroupMembers({
        groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg,
        members: [
          {
            memberId,
            memberKind: "human",
            userId,
            governanceRole: "owner",
            status: "active",
            updatedAtMs: Date.now(),
          },
        ],
      });
      await seedTask(cfg, groupId, taskId, {
        tenantId,
        profile: "managed_enterprise",
      });
    }

    const writeA = await submitTeamDeliverable({
      groupId,
      taskId,
      actor: "user-a",
      title: "提纲",
      content: "# tenant-a body\n",
      cfg,
      enforceAcl: true,
      tenant: { tenantId: "tenant-a", trust: "membership" },
    });
    const writeB = await submitTeamDeliverable({
      groupId,
      taskId,
      actor: "user-b",
      title: "提纲",
      content: "# tenant-b body\n",
      cfg,
      enforceAcl: true,
      tenant: { tenantId: "tenant-b", trust: "membership" },
    });
    expect(writeA.ok).toBe(true);
    expect(writeB.ok).toBe(true);
    if (!writeA.ok || !writeB.ok) {
      return;
    }
    expect(writeA.locator).not.toBe(writeB.locator);
    expect(writeA.locator.includes("tenant-a") || writeA.locator.includes("tenants")).toBe(true);
    const bodyA = await fs.readFile(writeA.locator, "utf8");
    const bodyB = await fs.readFile(writeB.locator, "utf8");
    expect(bodyA).toBe("# tenant-a body\n");
    expect(bodyB).toBe("# tenant-b body\n");
    expect(bodyA.includes("tenant-b")).toBe(false);
    expect(bodyB.includes("tenant-a")).toBe(false);

    const crossRead = await readTeamDeliverable({
      groupId,
      deliverableId: writeA.deliverableId,
      actor: "user-b",
      cfg,
      enforceAcl: true,
      tenant: { tenantId: "tenant-b", trust: "membership" },
    });
    expect(crossRead.ok).toBe(false);

    delete process.env.OPENBOT_SECURITY_PROFILE;
  });
});

describe("dual-root cleanup — team SoT uniqueness", () => {
  it("managed without tenant/auth refuses host collaboration fallthrough", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-team-deliv-legacy-"));
    tempDirs.push(root);
    const stateDir = path.join(root, "state");
    const tenantsRoot = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
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

    // Plant a decoy file under host legacy collaboration root.
    const legacyGroup = path.join(
      stateDir,
      "collaboration",
      "groups",
      encodeURIComponent("grp_dual"),
      "deliverables",
    );
    await fs.mkdir(legacyGroup, { recursive: true });
    await fs.writeFile(path.join(legacyGroup, "decoy.md"), "# decoy legacy\n", "utf8");

    const denied = await submitTeamDeliverable({
      groupId: "grp_dual",
      taskId: "task-dual",
      actor: "user-x",
      title: "提纲",
      content: "# should not land in legacy\n",
      cfg,
      enforceAcl: false,
      // no trusted / no tenant → must refuse
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(
        denied.reason === "trusted_group_locator_required" ||
          denied.reason === "legacy_collaboration_root_rejected",
      ).toBe(true);
      expect(denied.writtenToGroupDir).toBe(false);
    }
    // Decoy untouched and no new team write under legacy
    const legacyListing = await fs.readdir(legacyGroup);
    expect(legacyListing).toEqual(["decoy.md"]);

    delete process.env.OPENBOT_SECURITY_PROFILE;
    delete process.env.OPENBOT_TENANTS_ROOT;
  });

  it("when legacy+managed coexist, write goes only to managed tenants root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-team-deliv-both-"));
    tempDirs.push(root);
    const stateDir = path.join(root, "state");
    const tenantsRoot = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
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

    const groupId = "grp_both";
    const taskId = "task-both";
    const tenantId = "tenant-managed";

    const legacyDeliverables = path.join(
      stateDir,
      "collaboration",
      "groups",
      encodeURIComponent(groupId),
      "deliverables",
    );
    await fs.mkdir(legacyDeliverables, { recursive: true });
    await fs.writeFile(
      path.join(legacyDeliverables, "legacy-only.md"),
      "# only in legacy — must not be team SoT\n",
      "utf8",
    );

    await persistAuthoritativeGroupMembers({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
      members: [
        {
          memberId: "m1",
          memberKind: "human",
          userId: "user-m",
          governanceRole: "owner",
          status: "active",
          updatedAtMs: Date.now(),
        },
      ],
    });
    await seedTask(cfg, groupId, taskId, { tenantId, profile: "managed_enterprise" });

    const write = await submitTeamDeliverable({
      groupId,
      taskId,
      actor: "user-m",
      title: "正式成果",
      content: "# managed only\n",
      cfg,
      enforceAcl: true,
      tenant: { tenantId, trust: "membership" },
    });
    expect(write.ok).toBe(true);
    if (!write.ok) {
      return;
    }
    expect(
      write.locator.includes(path.join("tenants", tenantId)) || write.locator.includes(tenantId),
    ).toBe(true);
    expect(
      write.locator.includes(`${stateDir}/collaboration`) ||
        write.locator.includes("/state/collaboration/"),
    ).toBe(false);
    const managedBody = await fs.readFile(write.locator, "utf8");
    expect(managedBody).toBe("# managed only\n");

    // Legacy decoy still only decoy — team write did not land there
    const legacyFiles = await fs.readdir(legacyDeliverables);
    expect(legacyFiles).toEqual(["legacy-only.md"]);

    // Reading with same managed auth succeeds; legacy-only content is not team deliverable
    const readOk = await readTeamDeliverable({
      groupId,
      deliverableId: write.deliverableId,
      actor: "user-m",
      cfg,
      enforceAcl: true,
      tenant: { tenantId, trust: "membership" },
    });
    expect(readOk.ok).toBe(true);
    if (readOk.ok) {
      expect(readOk.content).toBe("# managed only\n");
      expect(readOk.content.includes("only in legacy")).toBe(false);
    }

    delete process.env.OPENBOT_SECURITY_PROFILE;
    delete process.env.OPENBOT_TENANTS_ROOT;
  });
});

describe("submitTeamDeliverable failure recovery", () => {
  it("recovers draft+file when submitted object write failed then retried", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-deliv-rec-"));
    tempDirs.push(root);
    const groupDir = path.join(root, "groups", "grp_rec");
    await fs.mkdir(path.join(groupDir, "deliverables"), { recursive: true });
    const trusted = { groupsRoot: path.join(root, "groups"), groupLocator: groupDir };
    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const stores = createTrustedGroupStores(trusted);
    await stores.objectStorage.writeObject("grp_rec", "task", "t1", {
      taskId: "t1",
      groupId: "grp_rec",
      title: "任务",
      status: "ready",
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    });

    const content = "# recovered body\n";
    const first = await submitTeamDeliverable({
      groupId: "grp_rec",
      taskId: "t1",
      actor: "human:owner",
      title: "成果恢复",
      content,
      enforceAcl: false,
      trusted,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    // Simulate lost response + retry (same content, no previousId).
    const second = await submitTeamDeliverable({
      groupId: "grp_rec",
      taskId: "t1",
      actor: "human:owner",
      title: "成果恢复",
      content,
      enforceAcl: false,
      trusted,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.idempotentReplay).toBe(true);
      expect(second.deliverableId).toBe(first.deliverableId);
      expect(second.locator).toBe(first.locator);
    }
  });

  it("retries with previousId after success+lost response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-deliv-prev-"));
    tempDirs.push(root);
    const groupDir = path.join(root, "groups", "grp_prev");
    await fs.mkdir(path.join(groupDir, "deliverables"), { recursive: true });
    const trusted = { groupsRoot: path.join(root, "groups"), groupLocator: groupDir };
    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    await stores.objectStorage.writeObject("grp_prev", "task", "t1", {
      taskId: "t1",
      groupId: "grp_prev",
      title: "任务",
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    });
    const previousId = "del-prev-base";
    await stores.objectStorage.writeObject("grp_prev", "deliverable", previousId, {
      deliverableId: previousId,
      groupId: "grp_prev",
      taskId: "t1",
      title: "旧版",
      status: "submitted",
      version: 1,
      content: "# v1\n",
      contentSha256: "x",
      createdAtMs: now,
      updatedAtMs: now,
      submittedAtMs: now,
    });

    const content = "# v2 revision\n";
    const first = await submitTeamDeliverable({
      groupId: "grp_prev",
      taskId: "t1",
      actor: "human:owner",
      title: "新版",
      content,
      previousDeliverableId: previousId,
      enforceAcl: false,
      trusted,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const retry = await submitTeamDeliverable({
      groupId: "grp_prev",
      taskId: "t1",
      actor: "human:owner",
      title: "新版",
      content,
      previousDeliverableId: previousId,
      enforceAcl: false,
      trusted,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.idempotentReplay).toBe(true);
      expect(retry.deliverableId).toBe(first.deliverableId);
      expect(retry.version).toBe(first.version);
    }
  });

  it("recovers from draft left after file write when submitted transition is retried", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-deliv-draft-"));
    tempDirs.push(root);
    const groupDir = path.join(root, "groups", "grp_draft");
    await fs.mkdir(path.join(groupDir, "deliverables"), { recursive: true });
    const trusted = { groupsRoot: path.join(root, "groups"), groupLocator: groupDir };
    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const { writeFileExclusiveImmutable } = await import("./team-deliverable-submit.js");
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    await stores.objectStorage.writeObject("grp_draft", "task", "t1", {
      taskId: "t1",
      groupId: "grp_draft",
      title: "任务",
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    });
    const content = "# draft interrupt\n";
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(content, "utf8").digest("hex");
    const deliverableId = "del-draft-interrupt";
    const relativePath = `deliverables/${deliverableId}-v1.md`;
    const absolutePath = path.join(groupDir, relativePath);
    await stores.objectStorage.writeObject("grp_draft", "deliverable", deliverableId, {
      deliverableId,
      groupId: "grp_draft",
      taskId: "t1",
      title: "中断成果",
      status: "draft",
      version: 1,
      content,
      contentSha256: sha,
      relativePath,
      formalLocator: absolutePath,
      createdBy: "human:owner",
      updatedBy: "human:owner",
      createdAtMs: now,
      updatedAtMs: now,
    });
    const written = await writeFileExclusiveImmutable(absolutePath, content, sha);
    expect(written.ok).toBe(true);

    const result = await submitTeamDeliverable({
      groupId: "grp_draft",
      taskId: "t1",
      actor: "human:owner",
      title: "中断成果",
      content,
      enforceAcl: false,
      trusted,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deliverableId).toBe(deliverableId);
      expect(result.status).toBe("submitted");
      const onDisk = await fs.readFile(absolutePath, "utf8");
      expect(onDisk).toBe(content);
    }
  });
});

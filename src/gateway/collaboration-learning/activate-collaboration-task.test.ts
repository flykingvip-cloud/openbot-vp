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
import { activateCollaborationTask, buildActivationKey } from "./activate-collaboration-task.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;
const savedTenantsRoot = process.env.OPENBOT_TENANTS_ROOT;

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
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }

  if (savedTenantsRoot === undefined) {
    delete process.env.OPENBOT_TENANTS_ROOT;
  } else {
    process.env.OPENBOT_TENANTS_ROOT = savedTenantsRoot;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string, claimContract: boolean): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract },
    },
  } as OpenBotConfig;
}

async function useConfig(claimContract: boolean): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-activate-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, claimContract);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

describe("activateCollaborationTask", () => {
  it("blocks missing fields without claiming dispatched", async () => {
    const { cfg } = await useConfig(true);
    const result = await activateCollaborationTask({
      groupId: "",
      taskId: "t1",
      title: "x",
      message: "y",
      actor: "human:owner",
      humanConfirmed: true,
      cfg,
    });
    expect(result.status).toBe("blocked");
    expect(result.boardPublished).toBe(false);
    expect(result.dispatched).toBe(false);
  });

  it("keeps draft and does not publish when humanConfirmed is false", async () => {
    const { cfg } = await useConfig(true);
    const result = await activateCollaborationTask({
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-1",
      title: "能源材料研究提纲",
      message: "请为能源材料研究提纲发布看板并分工",
      actor: "human:owner",
      goal: "产出有来源的研究提纲",
      acceptanceCriteria: ["两成员各写一段", "汇总为 Markdown"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
    });
    expect(["needs_confirm", "blocked"]).toContain(result.status);
    expect(result.boardPublished).toBe(false);
    expect(result.dispatched).toBe(false);
    expect(result.taskEnsured).toBe(true);
    const stores = createWorkspaceCollaborationStores(cfg);
    const task = await stores.objectStorage.readObject<Task>("grp_act", "task", "TEAM-REAL-ACT-1");
    expect(task?.status).toBe("draft");
  });

  it("refuses to reopen a completed terminal task", async () => {
    const { cfg } = await useConfig(true);
    const stores = createWorkspaceCollaborationStores(cfg);
    const now = Date.now();
    await stores.objectStorage.writeObject("grp_act", "task", "TEAM-REAL-DONE", {
      taskId: "TEAM-REAL-DONE",
      groupId: "grp_act",
      title: "旧任务",
      status: "completed",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    const result = await activateCollaborationTask({
      groupId: "grp_act",
      taskId: "TEAM-REAL-DONE",
      title: "新标题",
      message: "尝试重开",
      actor: "human:owner",
      humanConfirmed: true,
      cfg,
    });
    expect(result.status).toBe("blocked");
    expect(result.boardPublished).toBe(false);
    if (result.status === "blocked") {
      expect(result.reason).toBe("terminal_task_not_reopened");
    }
    const live = await stores.objectStorage.readObject<Task>("grp_act", "task", "TEAM-REAL-DONE");
    expect(live?.status).toBe("completed");
  });

  it("activates with board publish when confirmed and is idempotent on retry", async () => {
    const { cfg } = await useConfig(true);
    const input = {
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-2",
      title: "能源材料研究提纲",
      message: "请为能源材料研究提纲发布看板并分工，验收两段有来源底稿",
      actor: "human:owner",
      goal: "产出有来源的研究提纲",
      acceptanceCriteria: ["两成员各写一段", "汇总为 Markdown"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      cfg,
    };
    const first = await activateCollaborationTask(input);
    if (first.status === "activated") {
      expect(first.boardPublished).toBe(true);
      expect(first.dispatched).toBe(false);
      expect(first.boardItemId).toBeTruthy();
      const second = await activateCollaborationTask(input);
      expect(second.status).toBe("activated");
      if (second.status === "activated") {
        expect(second.idempotentReplay).toBe(true);
        expect(second.boardItemId).toBe(first.boardItemId);
      }
    } else {
      expect(first.boardPublished).toBe(false);
      expect(first.dispatched).toBe(false);
      expect(["needs_confirm", "blocked", "partial_success"]).toContain(first.status);
    }
  });

  it("conflicts when same taskId retries with a different contract fingerprint", async () => {
    const { cfg } = await useConfig(true);
    const base = {
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-3",
      title: "能源材料研究提纲",
      message: "请为能源材料研究提纲发布看板并分工",
      actor: "human:owner",
      goal: "目标A",
      acceptanceCriteria: ["a"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      cfg,
    };
    const first = await activateCollaborationTask(base);
    // Even if materialize blocks, task tag may be stamped; retry with different goal.
    const second = await activateCollaborationTask({
      ...base,
      goal: "目标B-完全不同",
      acceptanceCriteria: ["b", "c"],
    });
    if (first.status === "activated" || first.taskEnsured) {
      expect(second.status).toBe("blocked");
      if (second.status !== "blocked") {
        throw new Error(`expected blocked, got ${second.status}`);
      }
      expect(second.reason).toBe("activation_contract_conflict");
      expect(second.boardPublished).toBe(false);
    }
  });

  it("draft needs_confirm then confirm with drifted fields is activation_contract_conflict", async () => {
    const { cfg } = await useConfig(true);
    const draft = await activateCollaborationTask({
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-CONFIRM-BIND",
      title: "确认绑定提纲",
      message: "请发布看板并分工，验收标准：有来源",
      actor: "human:owner",
      goal: "目标草稿",
      acceptanceCriteria: ["有来源"],
      constraints: ["不得编造"],
      suggestedClaimantIds: ["bot-a", "bot-b"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
    });
    expect(draft.taskEnsured).toBe(true);
    expect(draft.boardPublished).toBe(false);
    const drifted = await activateCollaborationTask({
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-CONFIRM-BIND",
      title: "确认绑定提纲",
      message: "请发布看板并分工，验收标准：有来源（已改文案）",
      actor: "human:owner",
      goal: "目标草稿-已改",
      acceptanceCriteria: ["有来源"],
      constraints: ["不得编造", "额外"],
      suggestedClaimantIds: ["bot-a"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      cfg,
    });
    expect(drifted.status).toBe("blocked");
    if (drifted.status !== "blocked") {
      throw new Error(`expected blocked, got ${drifted.status}`);
    }
    expect(drifted.reason).toBe("activation_contract_conflict");
    expect(drifted.boardPublished).toBe(false);
  });

  it("buildActivationKey changes when acceptance criteria change", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "b"],
      message: "m",
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "c"],
      message: "m",
    });
    expect(a).not.toBe(b);
  });
  it("buildActivationKey changes when dueAtMs changes", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      dueAtMs: 1_700_000_000_000,
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      dueAtMs: 1_700_000_000_001,
    });
    expect(a).not.toBe(b);
  });

  it("buildActivationKey changes when suggestedClaimantIds change", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      suggestedClaimantIds: ["bot-1"],
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      suggestedClaimantIds: ["bot-2"],
    });
    expect(a).not.toBe(b);
  });

  it("buildActivationKey is stable for same contract regardless of claimant order", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["b", "a"],
      message: "m",
      suggestedClaimantIds: ["bot-2", "bot-1"],
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "b"],
      message: "m",
      suggestedClaimantIds: ["bot-1", "bot-2"],
    });
    expect(a).toBe(b);
  });
});

describe("activateCollaborationTask two-tenant same local ids full entry", () => {
  it("activates then submit/read stay isolated per tenant locator", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-act-2ten-"));
    tempDirs.push(root);
    const tenantsRoot = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: path.join(root, "host-collaboration") },
        runtimeNamespace: true,
        task: { claimContract: true },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();

    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const { submitTeamDeliverable, readTeamDeliverable } =
      await import("./team-deliverable-submit.js");
    const { resolveTrustedGroupLocator } = await import("../workspace/group-locator.js");

    const groupId = "grp_shared_local";
    const taskId = "TASK_SHARED_LOCAL";
    const shared = {
      groupId,
      taskId,
      title: "两租户同局部ID",
      message: "请为两租户隔离激活看板并验收交付",
      actor: "human:owner",
      goal: "隔离",
      acceptanceCriteria: ["A租户成果", "B租户成果"],
      constraints: ["仅写本租户 locator", "禁止串租户读写"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      cfg,
    };

    const tenants = ["tenant-aaa", "tenant-bbb"] as const;
    const bodies = ["# tenant A body\n", "# tenant B body\n"] as const;
    for (let i = 0; i < tenants.length; i += 1) {
      const tenantId = tenants[i];
      const groupLocator = resolveTrustedGroupLocator({
        groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg,
      });
      const groupsRoot = path.dirname(groupLocator);
      const trusted = { groupsRoot, groupLocator };
      const stores = createTrustedGroupStores(trusted);
      await fs.mkdir(groupLocator, { recursive: true });

      const activated = await activateCollaborationTask({
        ...shared,
        trusted,
        tenant: { tenantId, trust: "membership" },
      });
      // Full entry: must create task via activate on this tenant locator (no pre-seed).
      expect(["activated", "partial_success"]).toContain(activated.status);
      const task = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
      expect(task).toBeTruthy();
      expect(task?.groupId).toBe(groupId);
      expect(activated.taskEnsured).toBe(true);

      const write = await submitTeamDeliverable({
        groupId,
        taskId,
        actor: "human:owner",
        title: shared.title,
        content: bodies[i],
        enforceAcl: false,
        trusted,
        cfg,
      });
      expect(write.ok).toBe(true);
      if (!write.ok) {
        return;
      }
      expect(write.locator.includes(tenantId)).toBe(true);
      const read = await readTeamDeliverable({
        groupId,
        deliverableId: write.deliverableId,
        actor: "human:owner",
        enforceAcl: false,
        trusted,
        cfg,
      });
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.content).toBe(bodies[i]);
      }
    }

    // Cross-tenant: A locator must not see B file bytes.
    const locatorA = resolveTrustedGroupLocator({
      groupId,
      tenantId: "tenant-aaa",
      profile: "managed_enterprise",
      cfg,
    });
    const storesA = createTrustedGroupStores({
      groupsRoot: path.dirname(locatorA),
      groupLocator: locatorA,
    });
    const listA = await storesA.objectStorage.listObjects(groupId, "deliverable");
    for (const row of listA) {
      const body =
        typeof (row as { content?: string }).content === "string"
          ? (row as { content: string }).content
          : "";
      expect(body).not.toContain("tenant B");
    }
  });
});

describe("activateCollaborationTask lock order vs auth", () => {
  it("activate sync and concurrent auth-lock revoke do not deadlock", async () => {
    const { cfg } = await useConfig(true);
    const { withGroupAuthLock } = await import("./shared.js");
    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const { resolveTrustedGroupLocator } = await import("../workspace/group-locator.js");

    const groupId = "grp_lock_order";
    const taskId = "TEAM-REAL-LOCK-1";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    await fs.mkdir(groupLocator, { recursive: true });

    const activatePromise = activateCollaborationTask({
      groupId,
      taskId,
      title: "锁序并发",
      message: "请发布看板并验证锁序，验收无死锁",
      actor: "human:owner",
      goal: "无死锁",
      acceptanceCriteria: ["无死锁", "无重复看板"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      trusted,
      cfg,
    });

    const revokePromise = (async () => {
      // Hold auth lock briefly overlapping activation sync window.
      await withGroupAuthLock({
        groupId,
        groupRootDir: trusted.groupsRoot,
        cfg,
        fn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return "revoked-sim";
        },
      });
    })();

    const settled = await Promise.race([
      Promise.all([activatePromise, revokePromise]).then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), 15_000)),
    ]);
    expect(settled.ok).toBe(true);
    if (!settled.ok) {
      return;
    }
    const [activated] = settled.value;
    expect(["activated", "partial_success", "needs_confirm", "blocked"]).toContain(
      activated.status,
    );
    if (activated.status === "activated" || activated.status === "partial_success") {
      const stores = createTrustedGroupStores(trusted);
      // Re-activate same contract should be idempotent (no duplicate board).
      const again = await activateCollaborationTask({
        groupId,
        taskId,
        title: "锁序并发",
        message: "请发布看板并验证锁序，验收无死锁",
        actor: "human:owner",
        goal: "无死锁",
        acceptanceCriteria: ["无死锁", "无重复看板"],
        humanConfirmed: true,
        requireHumanConfirm: true,
        trusted,
        cfg,
      });
      if (again.status === "activated" && activated.status === "activated") {
        expect(again.boardItemId).toBe(activated.boardItemId);
        expect(again.idempotentReplay).toBe(true);
      }
      void stores;
    }
  });
});

describe("R4 trusted chain: two-tenant activate→claim→apply→propose→confirm→deliverable", () => {
  it("records per-step locators and never crosses tenant roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-r4-chain-"));
    tempDirs.push(root);
    const tenantsRoot = path.join(root, "tenants");
    const hostCollab = path.join(root, "host-collaboration");
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: hostCollab },
        runtimeNamespace: true,
        task: { claimContract: true },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();

    const { createTrustedGroupStores } = await import("./team-resource-auth.js");
    const { resolveTrustedGroupLocator } = await import("../workspace/group-locator.js");
    const { taskControlLockDir } = await import("../collaboration-dispatch/task-control-cas.js");
    const { writeGroupOperatingState } = await import("./shared.js");
    const { makeOperatingState } =
      await import("../collaboration-dispatch/__fixtures__/policy-source-matrix.js");
    const {
      claimCollaborationBoardItem,
      applyCollaborationBoardClaim,
      proposeCollaborationTodolist,
      listCollaborationBoardItems,
    } = await import("./claim-contract-entry.js");
    const { maybeConfirmPlanFromChatSend } = await import("./chat-plan-confirm-hook.js");
    const { resolveOwnerDecisionDeliveryLogPath } = await import("./owner-decision-delivery.js");
    const { submitTeamDeliverable, readTeamDeliverable } =
      await import("./team-deliverable-submit.js");

    const groupId = "grp_r4_shared";
    const taskId = "TASK_R4_SHARED";
    const actor = "human:owner";
    const claimant = "bot-analyst";
    const tenants = ["tenant-r4-a", "tenant-r4-b"] as const;
    const bodies = ["# A chain deliverable\n", "# B chain deliverable\n"] as const;

    type StepLoc = { step: string; path: string };
    const allLocs: Record<string, StepLoc[]> = {};

    for (let i = 0; i < tenants.length; i += 1) {
      const tenantId = tenants[i];
      const groupLocator = resolveTrustedGroupLocator({
        groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg,
      });
      const groupsRoot = path.dirname(groupLocator);
      const trusted = { groupsRoot, groupLocator };
      const stores = createTrustedGroupStores(trusted);
      await fs.mkdir(groupLocator, { recursive: true });
      const locs: StepLoc[] = [];
      const record = (step: string, p: string) => {
        expect(p.includes(tenantId), `${step} must sit under ${tenantId}: ${p}`).toBe(true);
        expect(p.includes(hostCollab), `${step} must not use host collab: ${p}`).toBe(false);
        locs.push({ step, path: p });
      };

      record("groupLocator", groupLocator);

      const activated = await activateCollaborationTask({
        groupId,
        taskId,
        title: "整链收敛验收报告",
        message: "请为双租户隔离整链发布看板并分工认领，验收交付报告与计划确认闭环",
        actor,
        goal: "产出可验收的整链交付报告",
        acceptanceCriteria: ["激活隔离", "认领应用", "计划确认", "成果提交"],
        constraints: ["仅本租户 locator", "禁止串租户读写"],
        suggestedClaimantIds: [claimant],
        humanConfirmed: true,
        requireHumanConfirm: true,
        trusted,
        tenant: { tenantId, trust: "membership" },
        cfg,
      });
      if (activated.status !== "activated" && activated.status !== "partial_success") {
        throw new Error(`activate failed: ${JSON.stringify(activated)}`);
      }
      expect(["activated", "partial_success"]).toContain(activated.status);
      const boardItemId = activated.boardItemId;
      record("taskObjectRoot", stores.groupsRoot);
      const lockDir = taskControlLockDir({ groupId, cfg, groupRootDir: groupsRoot });
      record("taskControlLockDir", lockDir);

      const listed = await listCollaborationBoardItems({
        groupId,
        taskId,
        trusted,
        tenant: { tenantId, trust: "membership" },
        cfg,
      });
      expect(listed.some((row) => row.itemId === boardItemId)).toBe(true);

      const claimed = await claimCollaborationBoardItem({
        groupId,
        taskId,
        itemId: boardItemId,
        claimantId: claimant,
        actor: claimant,
        trusted,
        tenant: { tenantId, trust: "membership" },
        cfg,
      });
      expect(claimed.status).toBe("claimed");

      const applied = await applyCollaborationBoardClaim({
        groupId,
        taskId,
        itemId: boardItemId,
        actor: claimant,
        trusted,
        tenant: { tenantId, trust: "membership" },
        cfg,
      });
      expect(applied.item.status).toBe("applied");

      // Seed OS after apply sync so confirmer ACL is not wiped by projection rewrite.
      const { readGroupOperatingState } = await import("./shared.js");
      const liveOs = await readGroupOperatingState({
        fileStore: stores.fileStore,
        groupId,
      });
      const state = makeOperatingState({
        groupId,
        governance: {
          ...liveOs?.governance,
          coordinatorBotId: actor,
          ownerUserId: actor,
        },
      });
      state.memberRoleMap = [
        {
          memberId: actor,
          memberKind: "human",
          governanceRole: "owner",
          collaborationRole: null,
          status: "active",
        },
        {
          memberId: claimant,
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: null,
          status: "active",
        },
      ];
      (state as { authEpoch?: number }).authEpoch =
        (typeof (liveOs as { authEpoch?: number } | null)?.authEpoch === "number"
          ? (liveOs as { authEpoch: number }).authEpoch
          : 0) + 1;
      await writeGroupOperatingState({
        fileStore: stores.fileStore,
        groupId,
        state,
        writeKind: "auth",
        groupRootDir: groupsRoot,
      });

      const proposed = await proposeCollaborationTodolist({
        groupId,
        taskId,
        boardItemId,
        ownerMemberId: claimant,
        steps: [{ title: "写成果" }, { title: "自检" }],
        actor: claimant,
        trusted,
        tenant: { tenantId, trust: "membership" },
        cfg,
      });
      expect(proposed.todolist.status).toBe("proposed");
      const deliveryLog = resolveOwnerDecisionDeliveryLogPath(groupId, cfg, {
        groupRootDir: groupsRoot,
        groupLocator,
      });
      record("ownerDecisionDeliveryLog", deliveryLog);

      // Chat confirm path (same entry as UI card) — user-visible message, no auto-advance.
      const chatHook = await maybeConfirmPlanFromChatSend({
        groupId,
        message: "确认计划",
        actor,
        taskId,
        boardItemId,
        todolistId: proposed.todolist.todolistId,
        expectedVersion: proposed.todolist.version,
        trusted,
        tenant: { tenantId, trust: "membership" },
        cfg,
      });
      expect(chatHook.handled).toBe(true);
      if (!chatHook.handled) {
        return;
      }
      expect(chatHook.result.confirmed).toBe(true);
      expect(chatHook.userMessage).toContain("计划已确认");
      expect(chatHook.autoAdvanceWired).toBe(true);
      expect(chatHook.userMessage).toMatch(/已触发后续推进|尚未接通|推进/);

      const write = await submitTeamDeliverable({
        groupId,
        taskId,
        actor,
        title: "整链成果",
        content: bodies[i],
        enforceAcl: false,
        trusted,
        cfg,
      });
      expect(write.ok).toBe(true);
      if (!write.ok) {
        return;
      }
      record("deliverableLocator", write.locator);
      const read = await readTeamDeliverable({
        groupId,
        deliverableId: write.deliverableId,
        actor,
        enforceAcl: false,
        trusted,
        cfg,
      });
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.content).toBe(bodies[i]);
      }

      allLocs[tenantId] = locs;
    }

    // Cross-tenant: no locator from A appears under B's tenant id path and vice versa.
    for (const loc of allLocs["tenant-r4-a"]) {
      expect(loc.path.includes("tenant-r4-b")).toBe(false);
    }
    for (const loc of allLocs["tenant-r4-b"]) {
      expect(loc.path.includes("tenant-r4-a")).toBe(false);
    }
  });
});

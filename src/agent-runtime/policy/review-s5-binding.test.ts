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
import { activateCollaborationTask } from "../../gateway/collaboration-learning/activate-collaboration-task.js";
import { controlledDiscussToTask } from "../../gateway/collaboration-learning/controlled-discuss-to-task.js";
import {
  organizerFromTask,
  persistFirstStageAcceptanceHold,
  projectBoundTaskWorkBrief,
  recordAuthoritativeMemberContribution,
  shouldSuppressWakeForFirstStageHold,
} from "../../gateway/collaboration-learning/s5-collaboration-consumers.js";
import { createTrustedGroupStores } from "../../gateway/collaboration-learning/team-resource-auth.js";
import { parseAppointedProjectOwner } from "./collaboration-current-goal-binding.js";
import type { TaskResponsibility as Responsibility } from "./collaboration-policy-model.js";

const tempDirs: string[] = [];
const saved = {
  state: process.env.OPENBOT_STATE_DIR,
  cfg: process.env.OPENBOT_CONFIG_PATH,
  claw: process.env.OPENCLAW_CONFIG_PATH,
  sec: process.env.OPENBOT_SECURITY_PROFILE,
  leg: process.env.OPENCLAW_SECURITY_PROFILE,
  ten: process.env.OPENBOT_TENANTS_ROOT,
};

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  const restore = (key: keyof typeof saved, env: string) => {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[env];
    } else {
      process.env[env] = value;
    }
  };
  restore("state", "OPENBOT_STATE_DIR");
  restore("cfg", "OPENBOT_CONFIG_PATH");
  restore("claw", "OPENCLAW_CONFIG_PATH");
  restore("sec", "OPENBOT_SECURITY_PROFILE");
  restore("leg", "OPENCLAW_SECURITY_PROFILE");
  restore("ten", "OPENBOT_TENANTS_ROOT");
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const MEMBERS = [
  { id: "bot-owner", name: "校园项目负责人" },
  { id: "bot-coord", name: "群协调者" },
  { id: "bot-a", name: "成员A" },
  { id: "bot-b", name: "成员B" },
];

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

async function useReviewWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s5-review-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const groupsRoot = path.join(root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_s5");
  await fs.mkdir(groupLocator, { recursive: true });
  const trusted = { groupsRoot, groupLocator };
  const stores = createTrustedGroupStores(trusted);
  const now = Date.now();
  await stores.groupStorage.writeProfile({
    groupId: "grp_s5",
    groupCode: "grp_s5",
    displayName: "s5-review",
    ownerUserId: "human:owner",
    coordinatorBotId: "bot-coord",
    createdAtMs: now,
    updatedAtMs: now,
  });
  await stores.groupStorage.writeMembers("grp_s5", [
    {
      memberId: "m-owner",
      memberKind: "bot",
      agentId: "bot-owner",
      userId: "bot-owner",
      name: "校园项目负责人",
      governanceRole: "member",
      status: "active",
      updatedAtMs: now,
    },
    {
      memberId: "m-coord",
      memberKind: "bot",
      agentId: "bot-coord",
      userId: "bot-coord",
      name: "群协调者",
      governanceRole: "member",
      status: "active",
      updatedAtMs: now,
    },
    {
      memberId: "m-a",
      memberKind: "bot",
      agentId: "bot-a",
      userId: "bot-a",
      name: "成员A",
      governanceRole: "member",
      status: "active",
      updatedAtMs: now,
    },
    {
      memberId: "m-b",
      memberKind: "bot",
      agentId: "bot-b",
      userId: "bot-b",
      name: "成员B",
      governanceRole: "member",
      status: "active",
      updatedAtMs: now,
    },
  ]);
  return { root, cfg, trusted, stores };
}

describe("independent review: S5-R1 appointment authority", () => {
  it("independent review: negated appointment does not select the mentioned member", () => {
    expect(
      parseAppointedProjectOwner({
        message: "不要任命 @bot-a 为项目负责人，请继续由原负责人负责",
        knownMembers: MEMBERS,
      }),
    ).toBeNull();
  });

  it("independent review: unsettled candidate choice does not pick the first member", () => {
    expect(
      parseAppointedProjectOwner({
        message: "请任命 @bot-a 或 @bot-b 为项目负责人，先等我确定人选",
        knownMembers: MEMBERS,
      }),
    ).toBeNull();
  });

  it("independent review: a non-member is not accepted from the parser", () => {
    expect(
      parseAppointedProjectOwner({
        message: "请任命 @bot-not-in-this-group 为项目负责人",
        appointedOwnerId: "bot-not-in-this-group",
        knownMembers: MEMBERS,
      }),
    ).toBeNull();
  });

  it("independent review: activate does not persist a foreign owner", async () => {
    const { cfg, trusted, stores } = await useReviewWorkspace();
    const result = await activateCollaborationTask({
      groupId: "grp_s5",
      taskId: "TEAM-S5-FOREIGN-1",
      title: "校园项目",
      message: "请任命 @bot-not-in-this-group 为项目负责人。验收标准：成员A写背景。",
      actor: "human:owner",
      appointedOwnerId: "bot-not-in-this-group",
      coordinatorBotId: "bot-coord",
      knownMembers: [...MEMBERS, { id: "bot-not-in-this-group", name: "外人" }],
      goal: "完成第一阶段提纲",
      acceptanceCriteria: ["成员A写背景"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
      trusted,
    });
    const task = (await stores.objectStorage.readObject<Task>(
      "grp_s5",
      "task",
      "TEAM-S5-FOREIGN-1",
    )) as (Task & { responsibility?: Responsibility }) | null;
    const persisted = {
      status: result.status,
      owner: task?.ownerMemberId ?? task?.responsibility?.owner ?? null,
    };
    // Reconstruct the independent review log line without accepting the foreign owner.
    expect(persisted.owner).not.toBe("bot-not-in-this-group");
    expect(task?.responsibility?.owner).not.toBe("bot-not-in-this-group");
  });

  it("independent review: a clearly legal member appointment still persists", async () => {
    const { cfg, trusted, stores } = await useReviewWorkspace();
    const result = await activateCollaborationTask({
      groupId: "grp_s5",
      taskId: "TEAM-S5-LEGAL-1",
      title: "校园项目第一阶段提纲",
      message:
        "请任命 @bot-owner 作为这个校园项目的项目负责人，组织两名成员完成第一阶段提纲。验收标准：成员A写背景。",
      actor: "human:owner",
      appointedOwnerId: "bot-owner",
      coordinatorBotId: "bot-coord",
      goal: "完成第一阶段提纲",
      acceptanceCriteria: ["成员A写背景"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
      trusted,
    });
    expect(result.taskEnsured).toBe(true);
    const task = (await stores.objectStorage.readObject<Task>(
      "grp_s5",
      "task",
      "TEAM-S5-LEGAL-1",
    )) as (Task & { responsibility?: Responsibility }) | null;
    expect(task?.ownerMemberId).toBe("bot-owner");
    expect(task?.responsibility?.owner).toBe("bot-owner");
    expect(task?.responsibility?.coordinator).toBe("bot-coord");
    expect(organizerFromTask(task)).toBe("bot-owner");
  });
});

describe("independent review: S5-R2 goal binding", () => {
  it("independent review: a directed revision binds 项目甲, not the later-updated 项目乙", async () => {
    const { cfg, trusted, stores } = await useReviewWorkspace();
    const common = {
      groupId: "grp_s5",
      actor: "human:owner",
      coordinatorBotId: "bot-coord",
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
      trusted,
    } as const;
    const first = await activateCollaborationTask({
      ...common,
      taskId: "TEAM-S5-REVIEW-A",
      title: "项目甲 阶段稿",
      message: "建立项目甲，验收标准：写出提纲。",
      goal: "项目甲",
      acceptanceCriteria: ["写出提纲"],
    });
    expect(first.taskEnsured).toBe(true);
    const second = await activateCollaborationTask({
      ...common,
      taskId: "TEAM-S5-REVIEW-B",
      title: "项目乙 阶段稿",
      message: "建立项目乙，验收标准：写出提纲。",
      goal: "项目乙",
      acceptanceCriteria: ["写出提纲"],
    });
    expect(second.taskEnsured).toBe(true);
    const laterB = (await stores.objectStorage.readObject<Task>(
      "grp_s5",
      "task",
      "TEAM-S5-REVIEW-B",
    ))!;
    await stores.objectStorage.writeObject("grp_s5", "task", "TEAM-S5-REVIEW-B", {
      ...laterB,
      updatedAtMs: (laterB.updatedAtMs ?? 0) + 60_000,
    });

    const revision = await controlledDiscussToTask({
      sourceMessageId: "s5-target-jia",
      sourceKind: "trusted_inbound",
      groupId: "grp_s5",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: "把截止日期改到周五，针对项目甲",
      forceExplicit: true,
      goal: "项目甲",
      acceptanceCriteria: ["写出提纲"],
      cfg,
      trusted,
    });
    expect(revision.taskId).toBe("TEAM-S5-REVIEW-A");
    expect(revision.taskId).not.toBe("TEAM-S5-REVIEW-B");
    expect(revision.attempted).toBe(true);
    expect(revision.internalReason).toBe("bound_revision_applied");
    const afterA = await stores.objectStorage.readObject<Task>(
      "grp_s5",
      "task",
      "TEAM-S5-REVIEW-A",
    );
    const afterB = await stores.objectStorage.readObject<Task>(
      "grp_s5",
      "task",
      "TEAM-S5-REVIEW-B",
    );
    expect(afterA?.description).toContain("把截止日期改到周五，针对项目甲");
    expect(afterB?.description ?? "").not.toContain("把截止日期改到周五");
  });

  it("independent review: no unique target clarifies and does not mint", async () => {
    const { cfg, trusted, stores } = await useReviewWorkspace();
    const common = {
      groupId: "grp_s5",
      actor: "human:owner",
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
      trusted,
    } as const;
    await activateCollaborationTask({
      ...common,
      taskId: "TEAM-S5-REVIEW-A",
      title: "项目甲 阶段稿",
      message: "建立项目甲，验收标准：写出提纲。",
      goal: "项目甲",
      acceptanceCriteria: ["写出提纲"],
    });
    await activateCollaborationTask({
      ...common,
      taskId: "TEAM-S5-REVIEW-B",
      title: "项目乙 阶段稿",
      message: "建立项目乙，验收标准：写出提纲。",
      goal: "项目乙",
      acceptanceCriteria: ["写出提纲"],
    });
    const unclear = await controlledDiscussToTask({
      sourceMessageId: "s5-no-unique",
      sourceKind: "trusted_inbound",
      groupId: "grp_s5",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: "把截止日期改到周五",
      forceExplicit: true,
      acceptanceCriteria: ["写出提纲"],
      cfg,
      trusted,
    });
    expect(unclear.attempted).toBe(false);
    expect(unclear.taskId).toBeNull();
    expect(unclear.internalReason).toBe("no_unique_target");
    const listed = await stores.objectStorage.listObjects<Task>("grp_s5", "task");
    expect(listed.map((item) => item.taskId).toSorted()).toEqual([
      "TEAM-S5-REVIEW-A",
      "TEAM-S5-REVIEW-B",
    ]);
  });

  it("independent review: a cancelled target is not reused and does not mint a replacement", async () => {
    const { cfg, trusted, stores } = await useReviewWorkspace();
    await activateCollaborationTask({
      groupId: "grp_s5",
      taskId: "TEAM-S5-REVIEW-A",
      title: "项目甲 阶段稿",
      message: "建立项目甲，验收标准：写出提纲。",
      actor: "human:owner",
      humanConfirmed: false,
      requireHumanConfirm: true,
      goal: "项目甲",
      acceptanceCriteria: ["写出提纲"],
      cfg,
      trusted,
    });
    const live = (await stores.objectStorage.readObject<Task>(
      "grp_s5",
      "task",
      "TEAM-S5-REVIEW-A",
    ))!;
    await stores.objectStorage.writeObject("grp_s5", "task", "TEAM-S5-REVIEW-A", {
      ...live,
      status: "cancelled",
    });
    const result = await controlledDiscussToTask({
      sourceMessageId: "s5-cancelled",
      sourceKind: "trusted_inbound",
      groupId: "grp_s5",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: "把截止日期改到周五，针对项目甲",
      forceExplicit: true,
      acceptanceCriteria: ["写出提纲"],
      cfg,
      trusted,
    });
    expect(result.attempted).toBe(false);
    expect(result.internalReason).toBe("target_replaced_or_cancelled");
    const listed = await stores.objectStorage.listObjects<Task>("grp_s5", "task");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("cancelled");
  });
});

describe("independent review: S5-R3 production consumers", () => {
  it("independent review: appoint, confirm, two member identities, hold, and query stay on the original task", async () => {
    const { cfg, trusted, stores } = await useReviewWorkspace();
    const appoint = await activateCollaborationTask({
      groupId: "grp_s5",
      taskId: "TEAM-S5-CAMPUS-1",
      title: "校园项目第一阶段提纲",
      message:
        "请任命 @bot-owner 作为这个校园项目的项目负责人，组织两名成员完成第一阶段提纲。验收标准：成员A写背景，成员B写结论，汇总不超过 400 字。完成后先交给我验收，不要自动通过。",
      actor: "human:owner",
      appointedOwnerId: "bot-owner",
      coordinatorBotId: "bot-coord",
      goal: "完成第一阶段提纲",
      acceptanceCriteria: ["成员A写背景", "成员B写结论", "汇总不超过 400 字"],
      constraints: ["完成后先交给我验收，不要自动通过"],
      suggestedClaimantIds: ["bot-a", "bot-b"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
      trusted,
    });
    expect(appoint.status).toBe("needs_confirm");
    expect(appoint.boardPublished).toBe(false);
    expect(appoint.dispatched).toBe(false);

    const confirmed = await activateCollaborationTask({
      groupId: "grp_s5",
      taskId: "TEAM-S5-CAMPUS-1",
      title: "校园项目第一阶段提纲",
      message:
        "请任命 @bot-owner 作为这个校园项目的项目负责人，组织两名成员完成第一阶段提纲。验收标准：成员A写背景，成员B写结论，汇总不超过 400 字。完成后先交给我验收，不要自动通过。",
      actor: "human:owner",
      appointedOwnerId: "bot-owner",
      coordinatorBotId: "bot-coord",
      goal: "完成第一阶段提纲",
      acceptanceCriteria: ["成员A写背景", "成员B写结论", "汇总不超过 400 字"],
      constraints: ["完成后先交给我验收，不要自动通过"],
      suggestedClaimantIds: ["bot-a", "bot-b"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      cfg,
      trusted,
    });
    expect(confirmed.status).toBe("activated");
    if (confirmed.status === "activated") {
      expect(confirmed.boardPublished).toBe(true);
      expect(confirmed.dispatched).toBe(false);
    }

    const memberA = await recordAuthoritativeMemberContribution({
      groupId: "grp_s5",
      taskId: "TEAM-S5-CAMPUS-1",
      cfg,
      groupRootDir: trusted.groupsRoot,
      objectStorage: stores.objectStorage,
      actorId: "bot-a",
      memberId: "bot-a",
      kind: "produce",
      runOwnerId: "bot-a",
      artifactAuthorId: "bot-a",
      runId: "run-bot-a-background",
      artifactId: "art-background-v1",
      memberStatus: "active",
      text: "背景稿 v1",
    });
    const memberB = await recordAuthoritativeMemberContribution({
      groupId: "grp_s5",
      taskId: "TEAM-S5-CAMPUS-1",
      cfg,
      groupRootDir: trusted.groupsRoot,
      objectStorage: stores.objectStorage,
      actorId: "bot-b",
      memberId: "bot-b",
      kind: "block",
      runOwnerId: "bot-b",
      artifactAuthorId: "bot-b",
      runId: "run-bot-b-conclusion",
      artifactId: "art-conclusion-blocked",
      memberStatus: "active",
      text: "结论数据源被挡住，无法继续",
    });
    expect(memberA).toEqual({ accepted: true, actorId: "bot-a", kind: "produce" });
    expect(memberB).toEqual({ accepted: true, actorId: "bot-b", kind: "block" });

    const rejectedGhost = await recordAuthoritativeMemberContribution({
      groupId: "grp_s5",
      taskId: "TEAM-S5-CAMPUS-1",
      cfg,
      groupRootDir: trusted.groupsRoot,
      objectStorage: stores.objectStorage,
      actorId: "bot-coord",
      memberId: "bot-a",
      kind: "produce",
      runOwnerId: "bot-coord",
      artifactAuthorId: "bot-a",
      memberStatus: "active",
      text: "成员A的成果：背景已写好",
    });
    expect(rejectedGhost.accepted).toBe(false);

    const hold = await persistFirstStageAcceptanceHold({
      groupId: "grp_s5",
      taskId: "TEAM-S5-CAMPUS-1",
      cfg,
      groupRootDir: trusted.groupsRoot,
      objectStorage: stores.objectStorage,
      ownerIntegrated: true,
      userAskedToWaitForAcceptance: true,
      memberAccepted: true,
    });
    expect(hold.kind).toBe("waiting_acceptance");
    expect(hold.autoAccept).toBe(false);
    expect(hold.memberAcceptCountsAsGroupFinal).toBe(false);
    expect(hold.groupFinalChainOpen).toBe(true);

    const task = (await stores.objectStorage.readObject<Task>(
      "grp_s5",
      "task",
      "TEAM-S5-CAMPUS-1",
    )) as (Task & { responsibility?: Responsibility }) | null;
    expect(organizerFromTask(task)).toBe("bot-owner");
    expect(organizerFromTask(task)).not.toBe("bot-coord");
    expect(task?.status).toBe("blocked");
    expect(task?.tags?.some((tag) => tag.includes("member-contribution:produce:bot-a"))).toBe(true);
    expect(task?.tags?.some((tag) => tag.includes("run:run-bot-a-background"))).toBe(true);
    expect(
      task?.tags?.some((tag) =>
        tag.includes(
          "member-contribution:produce:bot-a/run:run-bot-a-background/artifact:art-background-v1",
        ),
      ),
    ).toBe(true);
    expect(task?.tags?.some((tag) => tag.includes("run:run-bot-b-conclusion"))).toBe(true);
    expect(shouldSuppressWakeForFirstStageHold(task?.tags)).toBe(true);
    const brief = projectBoundTaskWorkBrief(task);
    expect(brief).toContain("Project owner: bot-owner");
    expect(brief).toContain("Group coordinator: bot-coord");

    const query = await controlledDiscussToTask({
      sourceMessageId: "s5-r3-query",
      sourceKind: "trusted_inbound",
      groupId: "grp_s5",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: "进度如何",
      forceExplicit: true,
      cfg,
      trusted,
    });
    expect(query.attempted).toBe(false);
    expect(query.internalReason).toBe("bound_read_only_query");
    expect(query.classification).toBe("discussion");
    expect(query.taskId).toBe("TEAM-S5-CAMPUS-1");

    await activateCollaborationTask({
      groupId: "grp_s5",
      taskId: "TEAM-S5-SIDE-2",
      title: "旁项目",
      message: "另外再开一个旁项目。验收标准：独立交付。",
      actor: "human:owner",
      goal: "旁项目",
      acceptanceCriteria: ["独立交付"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
      trusted,
    });
    const side = await stores.objectStorage.readObject<Task>("grp_s5", "task", "TEAM-S5-SIDE-2");
    expect(shouldSuppressWakeForFirstStageHold(side?.tags)).toBe(false);
  });
});

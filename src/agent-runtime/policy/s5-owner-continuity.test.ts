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
import { createWorkspaceCollaborationStores } from "../../gateway/collaboration-learning/shared.js";
import { createTrustedGroupStores } from "../../gateway/collaboration-learning/team-resource-auth.js";
import {
  buildAuthoritativeResponsibility,
  classifyLaterBoundMessage,
  classifyMemberContribution,
  evaluateFirstStageAcceptanceHold,
  parseAppointedProjectOwner,
  projectCollaborationWorkBrief,
  resolveOwnerAfterLaterMessage,
} from "./collaboration-current-goal-binding.js";
import type { TaskResponsibility } from "./collaboration-policy-model.js";

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

async function useS5Workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s5-owner-"));
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
    displayName: "s5",
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

const MEMBERS = [
  { id: "bot-owner", name: "校园项目负责人" },
  { id: "bot-coord", name: "群协调者" },
  { id: "bot-a", name: "成员A" },
  { id: "bot-b", name: "成员B" },
];

const APPOINT_MSG =
  "请任命 @bot-owner 作为这个校园项目的项目负责人，组织两名成员完成第一阶段提纲。验收标准：成员A写背景，成员B写结论，汇总不超过 400 字。完成后先交给我验收，不要自动通过。";

describe("S5 current-goal and project-owner binding", () => {
  it("parses an appointment without treating a plain mention as ownership", () => {
    expect(
      parseAppointedProjectOwner({
        message: APPOINT_MSG,
        knownMembers: MEMBERS,
      })?.ownerId,
    ).toBe("bot-owner");
    expect(
      parseAppointedProjectOwner({
        message: "请 @bot-a 看一下这段背景",
        knownMembers: MEMBERS,
      }),
    ).toBeNull();
  });

  it("records owner and standing coordinator separately and does not fall back", () => {
    const seeded = buildAuthoritativeResponsibility({
      appointedOwnerId: "bot-owner",
      standingCoordinatorBotId: "bot-coord",
      createdBy: "human:owner",
    });
    expect(seeded.owner).toBe("bot-owner");
    expect(seeded.coordinator).toBe("bot-coord");
    const later = resolveOwnerAfterLaterMessage({
      responsibility: seeded,
      standingCoordinatorBotId: "bot-coord",
      laterMessage: "把交付日期改到周五，不必再 @ 负责人",
      laterMentions: [],
    });
    expect(later.owner).toBe("bot-owner");
    expect(later.coordinator).toBe("bot-coord");
  });

  it("binds later clarifications and revisions to the current goal and keeps queries read-only", () => {
    expect(
      classifyLaterBoundMessage({
        currentTaskId: "task-s5",
        currentGoal: "完成第一阶段提纲",
        message: "确认，就按这个目标和验收继续",
      }),
    ).toBe("clarification_bound");
    expect(
      classifyLaterBoundMessage({
        currentTaskId: "task-s5",
        currentGoal: "完成第一阶段提纲",
        message: "把截止日期改到周五",
      }),
    ).toBe("revision_bound");
    expect(
      classifyLaterBoundMessage({
        currentTaskId: "task-s5",
        currentGoal: "完成第一阶段提纲",
        message: "进度如何",
      }),
    ).toBe("read_only_query");
    expect(
      classifyLaterBoundMessage({
        currentTaskId: "task-s5",
        currentGoal: "完成第一阶段提纲",
        message: "请两名成员协作完成另一份交付说明\n验收标准：\n- 成员A写背景",
      }),
    ).toBe("no_followup_signal");
  });

  it("rejects role-play, ghostwriting and plain mentions as member contributions", () => {
    expect(
      classifyMemberContribution({
        actorId: "bot-a",
        memberId: "bot-a",
        kind: "produce",
        source: "member_self",
        text: "背景稿已提交",
      }).accepted,
    ).toBe(true);
    expect(
      classifyMemberContribution({
        actorId: "bot-b",
        memberId: "bot-b",
        kind: "block",
        source: "member_self",
        text: "数据源被挡住，无法继续",
      }).accepted,
    ).toBe(true);
    expect(
      classifyMemberContribution({
        actorId: "bot-coord",
        memberId: "bot-a",
        kind: "produce",
        source: "role_play_text",
        text: "我扮演成员A提交背景",
      }).accepted,
    ).toBe(false);
    expect(
      classifyMemberContribution({
        actorId: "bot-coord",
        memberId: "bot-a",
        kind: "produce",
        source: "main_answer_ghostwrite",
        text: "成员A的成果：背景已写好",
      }).accepted,
    ).toBe(false);
    expect(
      classifyMemberContribution({
        actorId: "human:owner",
        memberId: "bot-b",
        kind: "produce",
        source: "plain_mention",
        text: "请 @bot-b 也出一份",
      }).accepted,
    ).toBe(false);
  });

  it("holds first-stage delivery for acceptance and does not treat member accept as group-final", () => {
    const hold = evaluateFirstStageAcceptanceHold({
      ownerIntegrated: true,
      userAskedToWaitForAcceptance: true,
      memberAccepted: true,
    });
    expect(hold.kind).toBe("waiting_acceptance");
    expect(hold.autoAccept).toBe(false);
    expect(hold.authorizationWidened).toBe(false);
    expect(hold.memberAcceptCountsAsGroupFinal).toBe(false);
    expect(hold.groupFinalChainOpen).toBe(true);
  });

  it("projects a work brief from authoritative facts across a model switch", () => {
    const responsibility: TaskResponsibility = {
      owner: "bot-owner",
      executors: ["bot-a", "bot-b"],
      coordinator: "bot-coord",
      decisionAuthority: "bot-owner",
    };
    const first = projectCollaborationWorkBrief({
      goal: "完成第一阶段提纲",
      constraints: ["汇总不超过 400 字", "等待验收"],
      completedSteps: ["成员A提交背景"],
      artifacts: [{ id: "art-background", version: "v1" }],
      evidenceVersions: ["ev-1"],
      responsibility,
    });
    const afterSwitch = projectCollaborationWorkBrief({
      goal: "完成第一阶段提纲",
      constraints: ["汇总不超过 400 字", "等待验收"],
      completedSteps: ["成员A提交背景"],
      artifacts: [{ id: "art-background", version: "v1" }],
      evidenceVersions: ["ev-1"],
      responsibility,
    });
    expect(first).toContain("Goal: 完成第一阶段提纲");
    expect(first).toContain("Project owner: bot-owner");
    expect(first).toContain("Group coordinator: bot-coord");
    expect(first).toContain("art-background@v1");
    expect(first).toContain("Evidence versions: ev-1");
    expect(afterSwitch).toBe(first);
  });
});

describe("S5 isolated campus-project path on existing ports", () => {
  it("appoints an owner, binds later unmentioned replies, and waits for first-stage acceptance", async () => {
    const { cfg, trusted } = await useS5Workspace();
    const first = await activateCollaborationTask({
      groupId: "grp_s5",
      taskId: "TEAM-S5-CAMPUS-1",
      title: "校园项目第一阶段提纲",
      message: APPOINT_MSG,
      actor: "human:owner",
      appointedOwnerId: "bot-owner",
      coordinatorBotId: "bot-coord",
      knownMembers: MEMBERS,
      goal: "完成第一阶段提纲",
      acceptanceCriteria: ["成员A写背景", "成员B写结论", "汇总不超过 400 字"],
      constraints: ["完成后先交给我验收，不要自动通过"],
      suggestedClaimantIds: ["bot-a", "bot-b"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
      trusted,
    });
    expect(first.taskEnsured).toBe(true);
    expect(first.boardPublished).toBe(false);
    expect(first.dispatched).toBe(false);

    const stores = createWorkspaceCollaborationStores(cfg);
    const trustedStores = createTrustedGroupStores(trusted);
    const objectStore = trustedStores.objectStorage ?? stores.objectStorage;
    const task = (await objectStore.readObject<Task>("grp_s5", "task", "TEAM-S5-CAMPUS-1")) as
      | (Task & { responsibility?: TaskResponsibility })
      | null;
    expect(task).toBeTruthy();
    expect(task?.ownerMemberId).toBe("bot-owner");
    expect(task?.responsibility?.owner).toBe("bot-owner");
    expect(task?.responsibility?.coordinator).toBe("bot-coord");
    expect(task?.createdBy).toBe("human:owner");

    const later = await controlledDiscussToTask({
      sourceMessageId: "s5-later-no-at",
      sourceKind: "trusted_inbound",
      groupId: "grp_s5",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: "确认，就按这个目标和验收继续，不必再 @ 负责人。把截止日期改到周五也可以。",
      forceExplicit: true,
      goal: "完成第一阶段提纲",
      acceptanceCriteria: ["成员A写背景", "成员B写结论", "汇总不超过 400 字"],
      cfg,
      trusted,
    });
    expect(later.taskId).toBe("TEAM-S5-CAMPUS-1");
    expect(later.attempted).toBe(true);
    expect(later.internalReason).toMatch(/bound_(clarification|revision)_applied/);

    const query = await controlledDiscussToTask({
      sourceMessageId: "s5-later-query",
      sourceKind: "trusted_inbound",
      groupId: "grp_s5",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: "进度如何",
      forceExplicit: true,
      goal: "完成第一阶段提纲",
      acceptanceCriteria: ["成员A写背景"],
      cfg,
      trusted,
    });
    expect(query.attempted).toBe(false);
    expect(query.internalReason).toBe("bound_read_only_query");
    expect(query.classification).toBe("discussion");

    const afterLater = (await objectStore.readObject<Task>("grp_s5", "task", "TEAM-S5-CAMPUS-1")) as
      | (Task & { responsibility?: TaskResponsibility })
      | null;
    expect(afterLater?.ownerMemberId).toBe("bot-owner");
    expect(afterLater?.responsibility?.owner).toBe("bot-owner");
    expect(afterLater?.responsibility?.coordinator).toBe("bot-coord");
    expect(afterLater?.description).toContain("把截止日期改到周五");

    const listed = await objectStore.listObjects<Task>("grp_s5", "task");
    expect(listed.map((item) => item.taskId)).toEqual(["TEAM-S5-CAMPUS-1"]);

    const memberA = classifyMemberContribution({
      actorId: "bot-a",
      memberId: "bot-a",
      kind: "produce",
      source: "member_self",
      text: "背景稿 v1",
    });
    const memberB = classifyMemberContribution({
      actorId: "bot-b",
      memberId: "bot-b",
      kind: "block",
      source: "member_self",
      text: "结论数据源被挡住，无法继续",
    });
    expect(memberA).toEqual({ accepted: true, actorId: "bot-a", kind: "produce" });
    expect(memberB).toEqual({ accepted: true, actorId: "bot-b", kind: "block" });

    const brief = projectCollaborationWorkBrief({
      goal: "完成第一阶段提纲",
      constraints: ["完成后先交给我验收，不要自动通过"],
      completedSteps: ["成员A提交背景稿 v1"],
      artifacts: [{ id: "art-background", version: "v1" }],
      evidenceVersions: ["ev-background-v1"],
      responsibility: afterLater?.responsibility as TaskResponsibility,
    });
    expect(brief).toContain("Project owner: bot-owner");
    expect(brief).toContain("Group coordinator: bot-coord");

    const hold = evaluateFirstStageAcceptanceHold({
      ownerIntegrated: true,
      userAskedToWaitForAcceptance: true,
      memberAccepted: true,
    });
    expect(hold.kind).toBe("waiting_acceptance");
    expect(hold.autoAccept).toBe(false);
    expect(hold.memberAcceptCountsAsGroupFinal).toBe(false);
    expect(hold.groupFinalChainOpen).toBe(true);
  });
});

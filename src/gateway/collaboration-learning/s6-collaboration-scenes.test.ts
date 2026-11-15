import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskResponsibility as Responsibility } from "../../agent-runtime/policy/index.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  assertPeerReviewGateForAccept,
  recordPeerReview,
} from "../collaboration-dispatch/peer-review-gate.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { activateCollaborationTask } from "./activate-collaboration-task.js";
import { controlledDiscussToTask } from "./controlled-discuss-to-task.js";
import {
  organizerFromTask,
  persistFirstStageAcceptanceHold,
  projectBoundTaskWorkBrief,
  recordAuthoritativeMemberContribution,
  shouldSuppressWakeForFirstStageHold,
} from "./s5-collaboration-consumers.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

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
      task: { claimContract: true, wakeContract: true, requirePeerReview: true },
    },
  } as OpenBotConfig;
}

async function useS6Workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s6-collab-"));
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
  const groupLocator = path.join(groupsRoot, "grp_s6");
  await fs.mkdir(groupLocator, { recursive: true });
  const trusted = { groupsRoot, groupLocator };
  const stores = createTrustedGroupStores(trusted);
  const now = Date.now();
  await stores.groupStorage.writeProfile({
    groupId: "grp_s6",
    groupCode: "grp_s6",
    displayName: "s6-campus",
    ownerUserId: "human:owner",
    coordinatorBotId: "bot-coord",
    createdAtMs: now,
    updatedAtMs: now,
  });
  await stores.groupStorage.writeMembers("grp_s6", [
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
  const authority = createRuntimeAuthority({
    snapshot: createRoundPolicySnapshot(
      { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
      { now, idGen: () => "pss_s6_collab" },
    ),
    episodeId: "ep_s6_collab",
    tenant: { tenantId: null, trust: "none" },
    groupId: "grp_s6",
    profile: "personal_local",
    cfg,
  });
  return { root, cfg, trusted, stores, authority };
}

describe("S6 collaboration production-consumer scenes", () => {
  it("admits once, binds a real owner, records two member identities, independent review, latest limits, hold, and does not wake the wrong project", async () => {
    const { cfg, trusted, stores, authority } = await useS6Workspace();
    const appointMessage =
      "请任命 @bot-owner 作为这个校园项目的项目负责人，组织两名成员完成第一阶段提纲。验收标准：成员A写背景，成员B写结论，汇总不超过 400 字。完成后先交给我验收，不要自动通过。";
    const appoint = await activateCollaborationTask({
      groupId: "grp_s6",
      taskId: "TEAM-S6-CAMPUS-1",
      title: "校园项目第一阶段提纲",
      message: appointMessage,
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
      groupId: "grp_s6",
      taskId: "TEAM-S6-CAMPUS-1",
      title: "校园项目第一阶段提纲",
      message: appointMessage,
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

    // Persistence-rule evidence only: the test supplies runId/artifactId/
    // runOwnerId/memberStatus. It does not start these members, receive
    // runner completion events, or read artifacts submitted by an execution.
    // This proves contribution persistence and ghost rejection, not
    // independent member execution.
    const memberA = await recordAuthoritativeMemberContribution({
      groupId: "grp_s6",
      taskId: "TEAM-S6-CAMPUS-1",
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
      groupId: "grp_s6",
      taskId: "TEAM-S6-CAMPUS-1",
      cfg,
      groupRootDir: trusted.groupsRoot,
      objectStorage: stores.objectStorage,
      actorId: "bot-b",
      memberId: "bot-b",
      kind: "produce",
      runOwnerId: "bot-b",
      artifactAuthorId: "bot-b",
      runId: "run-bot-b-conclusion",
      artifactId: "art-conclusion-v1",
      memberStatus: "active",
      text: "结论稿 v1",
    });
    expect(memberA).toEqual({ accepted: true, actorId: "bot-a", kind: "produce" });
    expect(memberB).toEqual({ accepted: true, actorId: "bot-b", kind: "produce" });
    const rejectedGhost = await recordAuthoritativeMemberContribution({
      groupId: "grp_s6",
      taskId: "TEAM-S6-CAMPUS-1",
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

    const restriction = await controlledDiscussToTask({
      sourceMessageId: "s6-limit",
      sourceKind: "trusted_inbound",
      groupId: "grp_s6",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: "针对校园项目第一阶段提纲，把汇总上限改成不超过 300 字",
      forceExplicit: true,
      cfg,
      trusted,
    });
    expect(restriction.attempted).toBe(true);
    expect(restriction.taskId).toBe("TEAM-S6-CAMPUS-1");
    expect(restriction.internalReason).toBe("bound_revision_applied");

    // recordPeerReview non-author identity and localization are a real local
    // rule. Passing an item and recording revise does not prove the author
    // revised and resubmitted, that review was accepted, or that a group-final
    // was delivered. The group-final authoritative chain remains GAP.
    const item = {
      taskId: "TEAM-S6-CAMPUS-1",
      itemId: "item-background",
      submissionId: "sub-background-v1",
      claimantId: "bot-a",
      groupId: "grp_s6",
      status: "submitted_for_review" as const,
    };
    const selfReview = await recordPeerReview(
      authority,
      {
        taskId: item.taskId,
        itemId: item.itemId,
        reviewerId: "bot-a",
        verdict: "approve",
        comment: "作者自审",
        item,
      },
      { cfg },
    );
    expect(selfReview.ok).toBe(false);
    if (!selfReview.ok) {
      expect(selfReview.reason).toBe("self_review_forbidden");
    }
    const peerReview = await recordPeerReview(
      authority,
      {
        taskId: item.taskId,
        itemId: item.itemId,
        reviewerId: "bot-b",
        verdict: "revise",
        comment: "背景稿 art-background-v1 需要补来源后再修订原工作，不要另建任务。",
        item,
      },
      { cfg },
    );
    expect(peerReview.ok).toBe(true);
    if (peerReview.ok) {
      expect(peerReview.value.authorId).toBe("bot-a");
      expect(peerReview.value.reviewerId).toBe("bot-b");
      expect(peerReview.value.reviewerId).not.toBe(peerReview.value.authorId);
      expect(peerReview.value.submissionId).toBe("sub-background-v1");
      expect(peerReview.value.drivesAdmission).toBe(false);
    }
    const gate = await assertPeerReviewGateForAccept(authority, item, { cfg });
    expect(gate.ok).toBe(true);

    const query = await controlledDiscussToTask({
      sourceMessageId: "s6-mid-query",
      sourceKind: "trusted_inbound",
      groupId: "grp_s6",
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
    expect(query.taskId).toBe("TEAM-S6-CAMPUS-1");

    // The test writes ownerIntegrated=true itself, then consumeWakeForRoundDispatch
    // proves that mark blocks dispatch. This is a read/write/consume boundary,
    // not proof that a real integration or stage-delivery completion event
    // writes the mark. Excluding tests, organizerFromTask,
    // recordAuthoritativeMemberContribution, and persistFirstStageAcceptanceHold
    // currently have definitions only, with no host callers.
    // projectBoundTaskWorkBrief already has a context-assembly consumer in
    // auto-reply/reply/runtime-context-assembly.ts.
    const hold = await persistFirstStageAcceptanceHold({
      groupId: "grp_s6",
      taskId: "TEAM-S6-CAMPUS-1",
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
      "grp_s6",
      "task",
      "TEAM-S6-CAMPUS-1",
    )) as (Task & { responsibility?: Responsibility; description?: string }) | null;
    expect(organizerFromTask(task)).toBe("bot-owner");
    expect(organizerFromTask(task)).not.toBe("bot-coord");
    expect(task?.tags?.some((tag) => tag.includes("run:run-bot-a-background"))).toBe(true);
    expect(task?.tags?.some((tag) => tag.includes("artifact:art-background-v1"))).toBe(true);
    expect(task?.tags?.some((tag) => tag.includes("run:run-bot-b-conclusion"))).toBe(true);
    expect(task?.tags?.some((tag) => tag.includes("artifact:art-conclusion-v1"))).toBe(true);
    expect(`${task?.description ?? ""}\n${projectBoundTaskWorkBrief(task) ?? ""}`).toContain(
      "不超过 300 字",
    );
    expect(shouldSuppressWakeForFirstStageHold(task?.tags)).toBe(true);

    let campusDispatch = 0;
    const campusWake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        campusDispatch += 1;
        return { ok: true, roundId: "must-not-dispatch-held" };
      },
      request: {
        groupId: "grp_s6",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot-owner"],
        source: "nudge",
        taskId: "TEAM-S6-CAMPUS-1",
        itemId: "item-stage-two",
        reason: "s6-first-stage-hold",
      },
    });
    expect(campusWake.dispatched).toBe(false);
    expect(campusWake.reason).toBe("waiting_acceptance");
    expect(campusDispatch).toBe(0);

    await activateCollaborationTask({
      groupId: "grp_s6",
      taskId: "TEAM-S6-SIDE-2",
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
    const side = await stores.objectStorage.readObject<Task>("grp_s6", "task", "TEAM-S6-SIDE-2");
    expect(shouldSuppressWakeForFirstStageHold(side?.tags)).toBe(false);
    let sideDispatch = 0;
    const sideWake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        sideDispatch += 1;
        return { ok: true, roundId: "side-round-1" };
      },
      request: {
        groupId: "grp_s6",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot-coord"],
        source: "nudge",
        taskId: "TEAM-S6-SIDE-2",
        itemId: "item-side",
        reason: "s6-side-not-held",
      },
    });
    expect(sideWake.reason).not.toBe("waiting_acceptance");
    if (sideWake.dispatched) {
      expect(sideDispatch).toBe(1);
    } else {
      expect(sideDispatch).toBe(0);
    }
    expect(shouldSuppressWakeForFirstStageHold(side?.tags)).toBe(false);
    const listed = await stores.objectStorage.listObjects<Task>("grp_s6", "task");
    expect(listed.map((row) => row.taskId).toSorted()).toEqual([
      "TEAM-S6-CAMPUS-1",
      "TEAM-S6-SIDE-2",
    ]);
    const campusAgain = await stores.objectStorage.readObject<Task>(
      "grp_s6",
      "task",
      "TEAM-S6-CAMPUS-1",
    );
    expect(shouldSuppressWakeForFirstStageHold(campusAgain?.tags)).toBe(true);
    expect(organizerFromTask(campusAgain)).toBe("bot-owner");
  });
});

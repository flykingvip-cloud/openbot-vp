/**
 * FINAL v3 S2 — Plan gate on all delivery exec paths (incl. applied self-advance).
 *
 * Inventory-first: claim-contract / executor-private-todolist / self-advance / plan-gate-exec.
 * Flags default OFF; tests enable claim only in fixture cfg. LIVE untouched.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  applyClaim,
  claimBoardItem,
  markBoardItemInProgress,
  publishBoardItem,
  type GroupBoardClaimItem,
} from "./claim-contract.js";
import {
  buildExecutionTaskBagForActor,
  canReadExecutorTodolist,
  confirmTodolist,
  proposeTodolist,
  reviseTodolist,
} from "./executor-private-todolist.js";
import {
  assertExecutionTaskBagAllowsDelivery,
  boardTodolistDeliveryMapping,
  evaluateDeliveryExecGate,
  s2DoesNotDefaultSelfAdvanceOn,
} from "./plan-gate-exec.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { trySelfAdvance } from "./self-advance.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string, opts: { claimContract?: boolean }): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: opts.claimContract !== undefined ? { claimContract: opts.claimContract } : {},
    },
  } as OpenBotConfig;
}

async function useConfig(opts: { claimContract?: boolean }): Promise<{
  root: string;
  cfg: OpenBotConfig;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s2-pg-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, opts);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(
  cfg: OpenBotConfig,
  opts?: { botMaySelfAdvanceWithoutHuman?: boolean },
): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    {
      collaborationMode: "task_driven",
      finalDecisionMode: "human_required",
      botMaySelfAdvanceWithoutHuman: opts?.botMaySelfAdvanceWithoutHuman ?? false,
    },
    { now: 1, idGen: () => "pss_s2" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_s2",
    tenant: { tenantId: "001", trust: "explicit" },
    groupId: "grp_s2",
    profile: "personal_local",
    cfg,
  });
}

const seedTask = {
  taskId: "task_s2",
  title: "S2 plan gate",
  status: "open",
} as Task;

function boardStub(
  partial: Partial<GroupBoardClaimItem> & { itemId: string },
): GroupBoardClaimItem {
  return {
    groupId: "grp_s2",
    taskId: "task_s2",
    title: "t",
    remainingWork: "交付报告",
    acceptanceCriteria: ["含来源"],
    intendedClaimantIds: ["bot-analyst"],
    publishedBy: "bot-lead",
    publishedAt: 1,
    status: "applied",
    claimantId: "bot-analyst",
    goal: "交付 overnight 报告",
    constraints: ["不得串读 Todolist"],
    ...partial,
  };
}

describe("FINAL v3 S2 plan gate on all exec paths", () => {
  test("contracts: flags stay off defaults; mapping §A", () => {
    expect(s2DoesNotDefaultSelfAdvanceOn()).toBe(true);
    const applied = boardTodolistDeliveryMapping("applied");
    expect(applied.draftAllowed).toBe(true);
    expect(applied.deliveryRequiresConfirmedPlan).toBe(true);
    expect(applied.deliverySelfAdvanceEligible).toBe(true);
    const inProg = boardTodolistDeliveryMapping("in_progress");
    expect(inProg.deliveryRequiresConfirmedPlan).toBe(true);
    expect(boardTodolistDeliveryMapping("accepted").deliverySelfAdvanceEligible).toBe(false);
    expect(boardTodolistDeliveryMapping("submitted_for_review").deliverySelfAdvanceEligible).toBe(
      false,
    );
  });

  test("unconfirmed plan cannot markInProgress; revise invalidates confirm", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_s2",
        taskId: seedTask.taskId,
        remainingWork: "交付 overnight 报告",
        acceptanceCriteria: ["含来源"],
        goal: "交付 overnight 报告",
        constraints: ["私有计划"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-lead",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });

    const gated = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.reason).toBe("plan_gate_unconfirmed");
    }

    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId: seedTask.taskId,
        groupId: "grp_s2",
        ownerMemberId: "bot-analyst",
        steps: [{ title: "收集来源" }, { title: "写正文" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot-lead",
      },
      { cfg, authorizedConfirmerIds: ["bot-lead"] },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }

    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);

    const revised = await reviseTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.value.todolistId,
        reviserId: "bot-lead",
        reason: "补约束",
      },
      { cfg, authorizedConfirmerIds: ["bot-lead"] },
    );
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      return;
    }
    expect(revised.value.status).toBe("revise_requested");

    const gate = evaluateDeliveryExecGate({
      boardItem: boardStub({
        itemId,
        status: "applied",
        claimantId: "bot-analyst",
      }),
      todolist: revised.value,
      ownerMemberId: "bot-analyst",
    });
    expect(gate.mode).toBe("plan_nudge");
    expect(gate.reason).toBe("plan_gate_unconfirmed");
  });

  test("applied self-advance without confirm → plan_nudge; with confirm → delivery_exec", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg, { botMaySelfAdvanceWithoutHuman: true });
    const item = boardStub({ itemId: "bi-applied", status: "applied", claimantId: "bot-analyst" });

    const nudge = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot-analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: [item],
    });
    expect(nudge.ok).toBe(true);
    if (!nudge.ok) {
      return;
    }
    expect(nudge.advanced).toBe(false);
    expect(nudge.execMode).toBe("plan_nudge");

    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: item.itemId,
        taskId: item.taskId,
        groupId: "grp_s2",
        ownerMemberId: "bot-analyst",
        steps: [{ title: "执行步1" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    await confirmTodolist(
      auth,
      {
        taskId: item.taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot-lead",
      },
      { cfg, authorizedConfirmerIds: ["bot-lead"] },
    );

    const delivery = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot-analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: [item],
    });
    expect(delivery.ok).toBe(true);
    if (!delivery.ok) {
      return;
    }
    expect(delivery.advanced).toBe(true);
    expect(delivery.execMode).toBe("delivery_exec");
    expect(delivery.taskBag?.todolistCurrentStep?.title).toBe("执行步1");
    const bagOk = assertExecutionTaskBagAllowsDelivery(delivery.taskBag);
    expect(bagOk.ok).toBe(true);
  });

  test("private Todolist ACL: unauthorized read + cross-executor bag 串读 refused", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_s2",
        taskId: seedTask.taskId,
        remainingWork: "A 的私有计划",
        acceptanceCriteria: ["保密"],
        goal: "A 交付",
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-lead",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });

    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId: seedTask.taskId,
        groupId: "grp_s2",
        ownerMemberId: "bot-analyst",
        steps: [{ title: "私有步骤" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }

    expect(
      canReadExecutorTodolist({
        viewerId: "bot-peer",
        todolist: proposed.value,
        authorizedConfirmerIds: ["bot-lead"],
      }),
    ).toBe(false);
    expect(
      canReadExecutorTodolist({
        viewerId: "bot-analyst",
        todolist: proposed.value,
      }),
    ).toBe(true);

    const cross = await buildExecutionTaskBagForActor(auth, {
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
      viewerId: "bot-peer",
      authorizedConfirmerIds: ["bot-lead"],
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) {
      expect(cross.reason).toBe("forbidden");
    }

    // Different executor asking for their own empty bag on A's item still forbidden without auth
    const otherOwner = await buildExecutionTaskBagForActor(auth, {
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-other",
      viewerId: "bot-other",
    });
    // other owner has no todolist on this item — bag builds with null step, but viewer==ownerMemberId OK
    // 串读 case is viewer≠owner without confirmer — covered above.
    expect(otherOwner.ok).toBe(true);
    if (otherOwner.ok) {
      expect(otherOwner.value.todolistCurrentStep).toBeNull();
      expect(otherOwner.value.planGate.confirmed).toBe(false);
      const refuse = assertExecutionTaskBagAllowsDelivery(otherOwner.value);
      expect(refuse.ok).toBe(false);
    }
  });

  test("in_progress delivery bag incomplete without confirmed step → refuse", () => {
    const bag = evaluateDeliveryExecGate({
      boardItem: boardStub({ itemId: "bi-ip", status: "in_progress", claimantId: "bot-analyst" }),
      todolist: null,
      ownerMemberId: "bot-analyst",
    });
    expect(bag.mode).toBe("plan_nudge");
    expect(assertExecutionTaskBagAllowsDelivery(null).ok).toBe(false);
  });
});

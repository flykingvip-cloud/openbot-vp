/**
 * P2 — Executor-private Todolist + plan gate tests.
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
  markBoardItemInProgress,
  publishBoardItem,
  claimBoardItem,
} from "./claim-contract.js";
import {
  buildExecutionTaskBag,
  canReadExecutorTodolist,
  confirmTodolist,
  formatExecutionTaskBagForPrompt,
  freeChatIsTodolist,
  proposeTodolist,
  reviseTodolist,
  signalInsight,
  todolistIsGroupSharedBoardSubrecord,
} from "./executor-private-todolist.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { listWakeEvents, whoWokeWhom } from "./wake-contract.js";

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

function flagConfig(
  root: string,
  opts: { claimContract: boolean; wakeContract?: boolean },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: opts.claimContract,
        ...(opts.wakeContract !== undefined ? { wakeContract: opts.wakeContract } : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: {
  claimContract: boolean;
  wakeContract?: boolean;
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p2-todolist-"));
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

function authority(cfg: OpenBotConfig, groupId = "grp_p2"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_p2_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_p2",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

const seedTask: Task = {
  taskId: "task-p2-1",
  groupId: "grp_p2",
  title: "overnight report",
  status: "in_progress",
  ownerMemberId: "human-ceo",
  assignedMemberIds: ["human-ceo"],
  createdBy: "human-ceo",
  updatedBy: "human-ceo",
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe("P2 executor-private todolist", () => {
  test("free chat is never a Todolist; Todolist is not group-shared board sub-record", () => {
    expect(freeChatIsTodolist()).toBe(false);
    expect(todolistIsGroupSharedBoardSubrecord()).toBe(false);
  });

  test("flag-off: propose refuses", async () => {
    const { cfg } = await useConfig({ claimContract: false });
    const auth = authority(cfg);
    const result = await proposeTodolist(
      auth,
      {
        boardItemId: "bi-1",
        taskId: seedTask.taskId,
        groupId: "grp_p2",
        ownerMemberId: "bot-analyst",
        steps: [{ title: "a" }],
      },
      { cfg },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("flag_off");
    }
  });

  test("propose → confirm → markInProgress; revise clears confirm (plan gate)", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_p2",
        taskId: seedTask.taskId,
        remainingWork: "交付 overnight 报告",
        acceptanceCriteria: ["含来源"],
        goal: "交付 overnight 报告",
        constraints: ["不得把 Todolist 当共享合同"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
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
        groupId: "grp_p2",
        ownerMemberId: "bot-analyst",
        steps: [
          { title: "收集来源", detail: "公开报告" },
          { title: "写正文" },
          { title: "自检 Acceptance" },
        ],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    expect(proposed.value.visibility).toBe("executor_private");
    expect(proposed.value.status).toBe("proposed");

    // Privacy: random group member cannot read
    expect(
      canReadExecutorTodolist({
        viewerId: "bot-other",
        todolist: proposed.value,
        authorizedConfirmerIds: ["bot-secretary"],
      }),
    ).toBe(false);
    expect(
      canReadExecutorTodolist({
        viewerId: "bot-analyst",
        todolist: proposed.value,
      }),
    ).toBe(true);
    expect(
      canReadExecutorTodolist({
        viewerId: "bot-secretary",
        todolist: proposed.value,
        authorizedConfirmerIds: ["bot-secretary"],
      }),
    ).toBe(true);

    // Self-confirm refused
    const selfConfirm = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot-analyst",
      },
      { cfg, authorizedConfirmerIds: ["bot-secretary"] },
    );
    expect(selfConfirm.ok).toBe(false);
    if (!selfConfirm.ok) {
      expect(selfConfirm.reason).toBe("actor_not_confirmer");
    }

    // Unconfirmed → plan gate
    const gated = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.reason).toBe("plan_gate_unconfirmed");
    }

    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot-secretary",
      },
      { cfg, authorizedConfirmerIds: ["bot-secretary"] },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(confirmed.value.status).toBe("confirmed");

    const bag = buildExecutionTaskBag({
      boardItem: published.value,
      todolist: confirmed.value,
    });
    expect(bag.planGate.confirmed).toBe(true);
    expect(bag.todolistCurrentStep?.title).toBe("收集来源");
    expect(bag.boardSummary.goal).toBe("交付 overnight 报告");
    const prompt = formatExecutionTaskBagForPrompt(bag);
    expect(prompt).toContain("执行三件套");
    expect(prompt).toContain("收集来源");
    expect(prompt).toContain("共享看板");

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
        reviserId: "bot-secretary",
        reason: "补数据来源步骤",
      },
      { cfg, authorizedConfirmerIds: ["bot-secretary"] },
    );
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      return;
    }
    expect(revised.value.status).toBe("revise_requested");

    // After revise, cannot pretend delivery progress until re-confirm
    // (item already in_progress — gate applies on next mark from returned/blocked etc.)
    // Re-propose path: owner proposes again
    const reproposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId: seedTask.taskId,
        groupId: "grp_p2",
        ownerMemberId: "bot-analyst",
        steps: [{ title: "补来源" }, { title: "写正文" }],
      },
      { cfg },
    );
    expect(reproposed.ok).toBe(true);
    if (!reproposed.ok) {
      return;
    }
    expect(reproposed.value.version).toBeGreaterThanOrEqual(2);
    expect(reproposed.value.status).toBe("proposed");
  });

  test("claimant bot ≡ owner bot:bot projection: confirmed plan allows markInProgress", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_p2",
        taskId: seedTask.taskId,
        remainingWork: "claimant bot vs owner bot:bot",
        acceptanceCriteria: ["mark_in_progress ok after confirm"],
        goal: "投影归一",
        constraints: [],
        intendedClaimantIds: ["bot"],
        publishedBy: "bot:bot",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(auth, { taskId: seedTask.taskId, itemId, claimantId: "bot" }, { cfg });
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });

    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId: seedTask.taskId,
        groupId: "grp_p2",
        ownerMemberId: "bot:bot",
        steps: [{ title: "写稿" }, { title: "交卷" }],
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
        confirmerId: "human:owner",
        expectedVersion: proposed.value.version,
      },
      { cfg, authorizedConfirmerIds: ["human:owner", "bot:bot"] },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }

    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);
    if (inProg.ok) {
      expect(inProg.value.status).toBe("in_progress");
    }
  });

  test("empty confirmer list does not authorize a non-owner", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_p2",
        taskId: seedTask.taskId,
        remainingWork: "交付 overnight 报告",
        acceptanceCriteria: ["含来源"],
        goal: "交付 overnight 报告",
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: published.value.itemId,
        taskId: seedTask.taskId,
        groupId: "grp_p2",
        ownerMemberId: "bot-analyst",
        steps: [{ title: "写正文" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    const openConfirm = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot-attacker",
      },
      { cfg },
    );
    expect(openConfirm.ok).toBe(false);
    if (!openConfirm.ok) {
      expect(openConfirm.reason).toBe("actor_not_confirmer");
    }
  });

  test("signalInsight wakes 主答 when wakeContract on; auditable via whoWokeWhom", async () => {
    const { cfg } = await useConfig({ claimContract: true, wakeContract: true });
    const auth = authority(cfg);
    const result = await signalInsight(
      auth,
      {
        groupId: "grp_p2",
        taskId: seedTask.taskId,
        boardItemId: "bi-insight",
        fromMemberId: "bot-analyst",
        toLeadIds: ["bot-secretary"],
        insightSummary: "发现新的公开数据源，可能扩 scope",
      },
      { cfg },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.woke).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_p2" });
    expect(events.some((e) => e.source === "insight")).toBe(true);
    const timeline = whoWokeWhom(events);
    expect(timeline.some((row) => row.source === "insight")).toBe(true);
  });

  test("signalInsight with wakeContract off is best-effort no write", async () => {
    const { cfg } = await useConfig({ claimContract: true, wakeContract: false });
    const auth = authority(cfg);
    const result = await signalInsight(
      auth,
      {
        groupId: "grp_p2",
        taskId: seedTask.taskId,
        boardItemId: "bi-insight-2",
        fromMemberId: "bot-analyst",
        toLeadIds: ["bot-secretary"],
        insightSummary: "silent when flag off",
      },
      { cfg },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.woke).toBe(false);
  });
});

describe("confirmTodolist confirmer identity aliases (F4)", () => {
  const OWNER_UUID = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
  const OWNER_EMAIL = "daniel.hhd@gmail.com";
  const OWNER_HUMAN = `human:${OWNER_UUID}`;

  async function seedProposedTodolist() {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_p2",
        taskId: seedTask.taskId,
        remainingWork: "F4 confirmer identity",
        acceptanceCriteria: ["charter written"],
        goal: "F4 confirmer identity",
        intendedClaimantIds: ["bot:bot"],
        publishedBy: "bot:bot",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      throw new Error("publish failed");
    }
    const itemId = published.value.itemId;
    await claimBoardItem(auth, { taskId: seedTask.taskId, itemId, claimantId: "bot:bot" }, { cfg });
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId: seedTask.taskId,
        groupId: "grp_p2",
        ownerMemberId: "bot:bot",
        steps: [{ title: "write charter" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      throw new Error("propose failed");
    }
    return { cfg, auth, proposed: proposed.value };
  }

  test("Owner email matches authorized human:<uuid> with session subjects", async () => {
    const { cfg, auth, proposed } = await seedProposedTodolist();
    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.todolistId,
        confirmerId: OWNER_EMAIL,
      },
      {
        cfg,
        authorizedConfirmerIds: ["bot:bot", OWNER_HUMAN],
        sessionActorSubjects: [OWNER_UUID, OWNER_EMAIL],
      },
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.status).toBe("confirmed");
      expect(confirmed.value.confirmedBy).toBe(OWNER_EMAIL);
    }
  });

  test("unrelated email fails against human:<uuid> allowlist", async () => {
    const { cfg, auth, proposed } = await seedProposedTodolist();
    const denied = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.todolistId,
        confirmerId: "stranger@example.com",
      },
      {
        cfg,
        authorizedConfirmerIds: ["bot:bot", OWNER_HUMAN],
        sessionActorSubjects: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "stranger@example.com"],
      },
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("actor_not_confirmer");
    }
  });

  test("bot:bot confirmer still works", async () => {
    const { cfg, auth, proposed } = await seedProposedTodolist();
    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.todolistId,
        confirmerId: "bot:bot",
      },
      { cfg, authorizedConfirmerIds: ["bot:bot", OWNER_HUMAN] },
    );
    expect(confirmed.ok).toBe(true);
  });

  test("executor self-confirm still fails when not in allowlist", async () => {
    const { cfg, auth, proposed } = await seedProposedTodolist();
    // Owner of todolist is bot:bot; a different executor must not confirm.
    const denied = await confirmTodolist(
      auth,
      {
        taskId: seedTask.taskId,
        todolistId: proposed.todolistId,
        confirmerId: "bot:executor-other",
      },
      { cfg, authorizedConfirmerIds: ["bot:bot", OWNER_HUMAN] },
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("actor_not_confirmer");
    }
  });
});

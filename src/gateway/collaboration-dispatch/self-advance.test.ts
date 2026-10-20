/**
 * P4 — limited self_advance production caller + §1.5 conditions.
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
import { type GroupBoardClaimItem } from "./claim-contract.js";
import { confirmTodolist, proposeTodolist } from "./executor-private-todolist.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import {
  evaluateSelfAdvanceEligibility,
  platformDefaultBotMaySelfAdvanceWithoutHuman,
  selfAdvanceDeliveryRequiresConfirmedPlan,
  selfAdvanceDoesNotBypassHumanRequiredOutbound,
  trySelfAdvance,
} from "./self-advance.js";
import { listWakeEvents } from "./wake-contract.js";

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
  opts: {
    wakeContract?: boolean;
    claimContract?: boolean;
    selfAdvanceMode?: "dry_run" | "execute";
    selfAdvanceExecuteAllowlist?: string[];
  },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        ...(opts.wakeContract !== undefined ? { wakeContract: opts.wakeContract } : {}),
        ...(opts.claimContract !== undefined ? { claimContract: opts.claimContract } : {}),
        ...(opts.selfAdvanceMode !== undefined || opts.selfAdvanceExecuteAllowlist !== undefined
          ? {
              selfAdvance: {
                ...(opts.selfAdvanceMode !== undefined ? { mode: opts.selfAdvanceMode } : {}),
                ...(opts.selfAdvanceExecuteAllowlist !== undefined
                  ? { executeGroupAllowlist: opts.selfAdvanceExecuteAllowlist }
                  : {}),
              },
            }
          : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: {
  wakeContract?: boolean;
  claimContract?: boolean;
  selfAdvanceMode?: "dry_run" | "execute";
  selfAdvanceExecuteAllowlist?: string[];
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p4-sa-"));
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
  groupId: string,
  opts?: { botMaySelfAdvanceWithoutHuman?: boolean; finalDecisionMode?: string },
): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    {
      collaborationMode: "task_driven",
      finalDecisionMode: opts?.finalDecisionMode ?? "human_required",
      botMaySelfAdvanceWithoutHuman: opts?.botMaySelfAdvanceWithoutHuman ?? false,
    },
    { now: 1, idGen: () => "pss_p4_sa" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_p4_sa",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

function boardItem(
  partial: Partial<GroupBoardClaimItem> & { itemId: string },
): GroupBoardClaimItem {
  return {
    groupId: "grp_sa",
    taskId: "task_sa",
    title: "t",
    remainingWork: "rw",
    acceptanceCriteria: ["a"],
    intendedClaimantIds: [],
    publishedBy: "bot:lead",
    publishedAt: 1,
    status: "in_progress",
    claimantId: "bot:analyst",
    ...partial,
  };
}

describe("P4 self_advance contracts", () => {
  test("platform default stays false; outbound still human_required; S2 plan gate on", () => {
    expect(platformDefaultBotMaySelfAdvanceWithoutHuman()).toBe(false);
    expect(selfAdvanceDoesNotBypassHumanRequiredOutbound()).toBe(true);
    expect(selfAdvanceDeliveryRequiresConfirmedPlan()).toBe(true);
  });

  test("§1.5: all conditions required; L2 false blocks", () => {
    const { cfg } = { cfg: {} as OpenBotConfig };
    void cfg;
    const auth = authority(
      {
        agents: { defaults: { workspace: "/tmp" } },
        gateway: { security: { profile: "personal_local" } },
        collaboration: { runtimeNamespace: true },
      } as OpenBotConfig,
      "grp_sa",
      { botMaySelfAdvanceWithoutHuman: false },
    );
    const eligibility = evaluateSelfAdvanceEligibility({
      effective: auth.policy.effective,
      actor: { type: "bot", id: "bot:analyst" },
      boardItems: [boardItem({ itemId: "i1", status: "in_progress" })],
      currentMission: "AI×能源研究与交付",
    });
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.reason).toBe("l2_bot_may_self_advance");
  });

  test("§1.5: onboarding mission blocks even when L2 true", () => {
    const auth = authority(
      {
        agents: { defaults: { workspace: "/tmp" } },
        gateway: { security: { profile: "personal_local" } },
        collaboration: { runtimeNamespace: true },
      } as OpenBotConfig,
      "grp_sa",
      { botMaySelfAdvanceWithoutHuman: true },
    );
    const eligibility = evaluateSelfAdvanceEligibility({
      effective: auth.policy.effective,
      actor: { type: "bot", id: "bot:analyst" },
      boardItems: [boardItem({ itemId: "i1", status: "applied" })],
      currentMission: "成员介绍与认识协作上下文",
    });
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.reason).toBe("mission_not_onboarding");
  });

  test("§1.5: no active board blocks", () => {
    const auth = authority(
      {
        agents: { defaults: { workspace: "/tmp" } },
        gateway: { security: { profile: "personal_local" } },
        collaboration: { runtimeNamespace: true },
      } as OpenBotConfig,
      "grp_sa",
      { botMaySelfAdvanceWithoutHuman: true },
    );
    const eligibility = evaluateSelfAdvanceEligibility({
      effective: auth.policy.effective,
      actor: { type: "bot", id: "bot:analyst" },
      boardItems: [boardItem({ itemId: "i1", status: "accepted" })],
      currentMission: "AI×能源研究与交付",
    });
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.reason).toBe("active_unaccepted_board");
  });

  test("S2: applied without confirmed plan → plan_nudge only (no delivery advanced)", async () => {
    const { cfg } = await useConfig({ claimContract: true, wakeContract: true });
    const auth = authority(cfg, "grp_sa", { botMaySelfAdvanceWithoutHuman: true });
    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: [
        boardItem({ itemId: "i-applied", status: "applied", claimantId: "bot:analyst" }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.advanced).toBe(false);
    expect(result.execMode).toBe("plan_nudge");
    expect(result.reason).toBe("plan_gate_unconfirmed");
    expect(result.eligibility.allowed).toBe(true);
  });

  test("S2: confirmed plan + in_progress → delivery_exec (dryRun)", async () => {
    const { cfg } = await useConfig({ claimContract: true, wakeContract: true });
    const auth = authority(cfg, "grp_sa", { botMaySelfAdvanceWithoutHuman: true });
    const item = boardItem({
      itemId: "i-dry",
      status: "in_progress",
      claimantId: "bot:analyst",
      taskId: "task_sa",
    });
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: item.itemId,
        taskId: item.taskId,
        groupId: "grp_sa",
        ownerMemberId: "bot:analyst",
        steps: [{ title: "写交付草稿" }, { title: "自检 Acceptance" }],
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
        taskId: item.taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: "bot:lead",
      },
      { cfg, authorizedConfirmerIds: ["bot:lead"] },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }

    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: [item],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.advanced).toBe(true);
    expect(result.execMode).toBe("delivery_exec");
    expect(result.eligibility.allowed).toBe(true);
    expect(result.lead?.leadAgentId).toBe("bot:analyst");
    expect(result.lead?.reason).toBe("board_claimant");
    expect(result.taskBag?.planGate.confirmed).toBe(true);
    expect(result.taskBag?.todolistCurrentStep?.title).toBe("写交付草稿");
  });

  test("production trySelfAdvance writes wake source=self_advance when wake ON (delivery)", async () => {
    // S5: real execute requires mode=execute + executeGroupAllowlist (default is dry_run).
    const { cfg } = await useConfig({
      claimContract: true,
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_sa"],
    });
    const auth = authority(cfg, "grp_sa", { botMaySelfAdvanceWithoutHuman: true });
    const item = boardItem({
      itemId: "i-wake",
      status: "in_progress",
      claimantId: "bot:analyst",
      taskId: "task_sa",
    });
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: item.itemId,
        taskId: item.taskId,
        groupId: "grp_sa",
        ownerMemberId: "bot:analyst",
        steps: [{ title: "推进一步" }],
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
        confirmerId: "bot:lead",
      },
      { cfg, authorizedConfirmerIds: ["bot:lead"] },
    );

    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [item],
      nowMs: 1_700_000_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.advanced) {
      return;
    }
    expect(result.execMode).toBe("delivery_exec");
    expect(result.wakeEvent?.source).toBe("self_advance");
    expect(result.wakeEvent?.reason).toContain("delivery_exec");
    // P0-2: unbound dispatcher → recorded (真回合 needs consumer bound).
    expect(result.wakeEvent?.outcome).toBe("recorded");
    expect(result.roundDispatched).toBe(false);
    const events = await listWakeEvents(auth, { groupId: "grp_sa" });
    expect(events.some((e) => e.source === "self_advance" && e.outcome === "recorded")).toBe(true);
  });

  test("§1.5-only path can skip plan gate via enforcePlanGate:false (unit)", async () => {
    const { cfg } = await useConfig({ claimContract: true, wakeContract: false });
    const auth = authority(cfg, "grp_sa", { botMaySelfAdvanceWithoutHuman: true });
    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      enforcePlanGate: false,
      boardItems: [
        boardItem({ itemId: "i-legacy", status: "in_progress", claimantId: "bot:analyst" }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.advanced).toBe(true);
    expect(result.execMode).toBe("delivery_exec");
  });
});

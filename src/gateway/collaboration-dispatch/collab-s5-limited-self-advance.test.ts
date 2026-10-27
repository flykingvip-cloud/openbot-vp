/**
 * FINAL v3 S5 — limited self_advance authorization boundary.
 *
 * Covers: platform default off; dry_run default (ledger, no wake); execute only
 * with mode+allowlist; per-tick reauth; claimant/status invalidation; onboarding /
 * governance / plan-unconfirmed / no-task blocks; does-not-auto-complete.
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
  listSelfAdvanceDecisions,
  platformDefaultBotMaySelfAdvanceWithoutHuman,
  platformDefaultSelfAdvanceWriteMode,
  resolveSelfAdvanceWriteMode,
  selfAdvanceDoesNotAutoCompleteTask,
  selfAdvanceDoesNotBypassHumanRequiredOutbound,
  selfAdvanceRequiresPerTickReauth,
  shouldInvalidatePriorSelfAdvanceRequest,
  buildSelfAdvanceBoardFingerprint,
  serializeSelfAdvanceBoardFingerprint,
  trySelfAdvance,
  writeSelfAdvancePendingFingerprintForTest,
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s5-sa-"));
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
    { now: 1, idGen: () => "pss_s5_sa" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_s5_sa",
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
    groupId: "grp_s5",
    taskId: "task_s5",
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

async function confirmPlan(
  auth: RuntimeAuthority,
  cfg: OpenBotConfig,
  item: GroupBoardClaimItem,
): Promise<void> {
  const proposed = await proposeTodolist(
    auth,
    {
      boardItemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      ownerMemberId: item.claimantId ?? "bot:analyst",
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
}

describe("S5 limited self_advance contracts", () => {
  test("platform defaults: L1 false, writeMode dry_run, no auto-complete, per-tick reauth", () => {
    expect(platformDefaultBotMaySelfAdvanceWithoutHuman()).toBe(false);
    expect(platformDefaultSelfAdvanceWriteMode()).toBe("dry_run");
    expect(selfAdvanceDoesNotAutoCompleteTask()).toBe(true);
    expect(selfAdvanceDoesNotBypassHumanRequiredOutbound()).toBe(true);
    expect(selfAdvanceRequiresPerTickReauth()).toBe(true);
    expect(resolveSelfAdvanceWriteMode({} as OpenBotConfig, "grp_x")).toBe("dry_run");
  });

  test("mode=execute without allowlist still dry_run", () => {
    const cfg = {
      collaboration: { task: { selfAdvance: { mode: "execute", executeGroupAllowlist: [] } } },
    } as OpenBotConfig;
    expect(resolveSelfAdvanceWriteMode(cfg, "grp_s5")).toBe("dry_run");
  });

  test("mode=execute + allowlist → execute", () => {
    const cfg = {
      collaboration: {
        task: { selfAdvance: { mode: "execute", executeGroupAllowlist: ["grp_s5"] } },
      },
    } as OpenBotConfig;
    expect(resolveSelfAdvanceWriteMode(cfg, "grp_s5")).toBe("execute");
    expect(resolveSelfAdvanceWriteMode(cfg, "other")).toBe("dry_run");
  });

  test("claimant change / status change / cancelled invalidate prior request", () => {
    const base = buildSelfAdvanceBoardFingerprint(
      boardItem({ itemId: "i1", status: "in_progress", claimantId: "bot:a" }),
    );
    const prior = serializeSelfAdvanceBoardFingerprint(base);
    expect(
      shouldInvalidatePriorSelfAdvanceRequest({
        priorFingerprint: prior,
        current: buildSelfAdvanceBoardFingerprint(
          boardItem({ itemId: "i1", status: "in_progress", claimantId: "bot:b" }),
        ),
      }).reason,
    ).toBe("claimant_changed");
    expect(
      shouldInvalidatePriorSelfAdvanceRequest({
        priorFingerprint: prior,
        current: buildSelfAdvanceBoardFingerprint(
          boardItem({ itemId: "i1", status: "returned", claimantId: "bot:a" }),
        ),
      }).invalidate,
    ).toBe(true);
    expect(
      shouldInvalidatePriorSelfAdvanceRequest({
        priorFingerprint: prior,
        current: buildSelfAdvanceBoardFingerprint(
          boardItem({ itemId: "i1", status: "cancelled", claimantId: "bot:a" }),
        ),
      }).reason,
    ).toBe("board_status_cancelled");
    expect(
      shouldInvalidatePriorSelfAdvanceRequest({
        priorFingerprint: prior,
        current: base,
      }).invalidate,
    ).toBe(false);
  });

  test("L2 false / no task / onboarding / governance refuse → no advance", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const authOff = authority(cfg, "grp_s5", { botMaySelfAdvanceWithoutHuman: false });
    const r1 = await trySelfAdvance(authOff, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [boardItem({ itemId: "i1", status: "in_progress" })],
      triggerSource: "test:l2_off",
    });
    expect(r1.ok && !r1.advanced).toBe(true);
    if (r1.ok && !r1.advanced) {
      expect(r1.reason).toBe("l2_bot_may_self_advance");
      expect(r1.executed).toBe(false);
      expect(r1.writeMode).toBe("dry_run");
    }

    const authOn = authority(cfg, "grp_s5", { botMaySelfAdvanceWithoutHuman: true });
    const r2 = await trySelfAdvance(authOn, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [boardItem({ itemId: "i2", status: "accepted" })],
      triggerSource: "test:no_task",
    });
    expect(r2.ok && !r2.advanced).toBe(true);
    if (r2.ok && !r2.advanced) {
      expect(r2.reason).toBe("active_unaccepted_board");
    }

    const r3 = await trySelfAdvance(authOn, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "成员介绍与认识协作上下文",
      boardItems: [boardItem({ itemId: "i3", status: "applied" })],
      triggerSource: "test:onboarding",
    });
    expect(r3.ok && !r3.advanced).toBe(true);
    if (r3.ok && !r3.advanced) {
      expect(r3.reason).toBe("mission_not_onboarding");
    }
  });

  test("plan unconfirmed → plan_nudge only; dry_run records decision, no wake", async () => {
    const { cfg } = await useConfig({ claimContract: true, wakeContract: true });
    const auth = authority(cfg, "grp_s5", { botMaySelfAdvanceWithoutHuman: true });
    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [
        boardItem({ itemId: "i-applied", status: "applied", claimantId: "bot:analyst" }),
      ],
      triggerSource: "test:plan_nudge",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.advanced).toBe(false);
    expect(result.execMode).toBe("plan_nudge");
    expect(result.executed).toBe(false);
    expect(result.writeMode).toBe("dry_run");
    expect(result.wakeEvent).toBeUndefined();
    expect(result.decision?.result).toContain("dry_run");
    const decisions = await listSelfAdvanceDecisions(auth);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0]?.triggerSource).toBe("test:plan_nudge");
    expect(decisions[0]?.executed).toBe(false);
    const wakes = await listWakeEvents(auth, { groupId: "grp_s5" });
    expect(wakes).toHaveLength(0);
  });

  test("dry_run eligible delivery: advanced=true executed=false; ledger only", async () => {
    const { cfg } = await useConfig({ claimContract: true, wakeContract: true });
    const auth = authority(cfg, "grp_s5", { botMaySelfAdvanceWithoutHuman: true });
    const item = boardItem({
      itemId: "i-dry",
      status: "in_progress",
      claimantId: "bot:analyst",
    });
    await confirmPlan(auth, cfg, item);
    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [item],
      triggerSource: "test:dry_delivery",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.advanced).toBe(true);
    expect(result.execMode).toBe("delivery_exec");
    expect(result.executed).toBe(false);
    expect(result.writeMode).toBe("dry_run");
    expect(result.wakeEvent).toBeUndefined();
    expect(result.decision?.taskId).toBe("task_s5");
    expect(result.decision?.boardItemId).toBe("i-dry");
    expect(result.decision?.claimantId).toBe("bot:analyst");
    expect(result.decision?.policyJudgment.allowed).toBe(true);
    const wakes = await listWakeEvents(auth, { groupId: "grp_s5" });
    expect(wakes).toHaveLength(0);
  });

  test("execute + allowlist + confirmed plan → wake; still not auto-complete", async () => {
    const { cfg } = await useConfig({
      claimContract: true,
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_s5"],
    });
    const auth = authority(cfg, "grp_s5", { botMaySelfAdvanceWithoutHuman: true });
    const item = boardItem({
      itemId: "i-exec",
      status: "in_progress",
      claimantId: "bot:analyst",
    });
    await confirmPlan(auth, cfg, item);
    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [item],
      nowMs: 1_700_000_000_100,
      triggerSource: "test:execute",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.advanced) {
      return;
    }
    expect(result.executed).toBe(true);
    expect(result.writeMode).toBe("execute");
    expect(result.wakeEvent?.source).toBe("self_advance");
    expect(result.wakeEvent?.outcome).toBe("recorded");
    expect(selfAdvanceDoesNotAutoCompleteTask()).toBe(true);
    // Board status unchanged — self_advance does not submit/accept.
    expect(item.status).toBe("in_progress");
    const decisions = await listSelfAdvanceDecisions(auth);
    expect(decisions.some((d) => d.result === "delivery_exec" && d.executed)).toBe(true);
  });

  test("claimant change after prior pending → invalidatedPrior on next tick", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg, "grp_s5", { botMaySelfAdvanceWithoutHuman: true });
    const itemA = boardItem({
      itemId: "i-xfer",
      status: "in_progress",
      claimantId: "bot:analyst",
    });
    const fpA = serializeSelfAdvanceBoardFingerprint(buildSelfAdvanceBoardFingerprint(itemA));
    await writeSelfAdvancePendingFingerprintForTest(auth, cfg, {
      boardItemId: "i-xfer",
      fingerprint: fpA,
      at: 1,
    });
    const itemB = boardItem({
      itemId: "i-xfer",
      status: "in_progress",
      claimantId: "bot:other",
    });
    await confirmPlan(auth, cfg, itemB);
    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:other",
      currentMission: "AI×能源研究与交付",
      boardItems: [itemB],
      triggerSource: "test:claimant_change",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.invalidatedPrior).toBe(true);
    expect(result.decision?.invalidationReason).toBe("claimant_changed");
  });
});

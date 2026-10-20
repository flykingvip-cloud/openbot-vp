/**
 * FINAL v3 S1 — Shared board + single-challenger short red/blue flow.
 *
 * Inventory-first: reuses claim-contract / challenge-window / intent-board-materialize.
 * Flags default OFF; tests enable claim + challenge only in fixture cfg (not tip prod).
 * Does not invent a second orchestrator or touch Floor/LIVE.
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
  openChallengeWindow,
  recordChallengeCritique,
  resolveChallengeWindow,
  skipChallengeWindow,
  isCollabTaskChallengeWindowEnabled,
} from "./challenge-window.js";
import {
  applyClaim,
  claimBoardItem,
  isCollabTaskClaimContractEnabled,
  publishBoardItem,
} from "./claim-contract.js";
import {
  buildBoardPublishDraftFromIntent,
  materializeIntentToBoardItem,
} from "./intent-board-materialize.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority } from "./runtime-authority.js";

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

const GRAY = "grp-daniel-hhd-gmail-com-upbeyond";
const SCOPED = "001/grp-daniel-hhd-gmail-com-upbeyond";

function flagConfig(
  root: string,
  opts: { claimAllowlist: string[]; challengeWindow: boolean },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: false,
        claimContractGroupAllowlist: opts.claimAllowlist,
        challengeWindow: opts.challengeWindow,
      },
    },
  } as OpenBotConfig;
}

async function useFixture(opts: { claimAllowlist: string[]; challengeWindow: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s1-flow-"));
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

function authority(cfg: OpenBotConfig, groupId: string, tenantId: string | null = null) {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_s1" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_s1",
    tenant: tenantId
      ? { tenantId, trust: "trusted_runtime" as const }
      : { tenantId: null, trust: "none" },
    groupId,
    profile: tenantId ? "managed_enterprise" : "personal_local",
    cfg,
  });
}

function seedTask(taskId: string): Task {
  return {
    taskId,
    groupId: GRAY,
    title: taskId,
    status: "in_progress",
    ownerMemberId: "lead_bot",
    assignedMemberIds: ["lead_bot"],
    createdBy: "lead_bot",
    updatedBy: "lead_bot",
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

describe("FINAL v3 S1 board + single-challenger flow", () => {
  test("platform defaults: claim/challenge OFF (flags not flipped by this PR)", async () => {
    const { cfg } = await useFixture({ claimAllowlist: [], challengeWindow: false });
    expect(isCollabTaskClaimContractEnabled(cfg, GRAY)).toBe(false);
    expect(isCollabTaskChallengeWindowEnabled(cfg)).toBe(false);
  });

  test("quality gate: raw intent without Acceptance stays needs_confirm (no fake contract)", async () => {
    const { cfg } = await useFixture({
      claimAllowlist: [GRAY],
      challengeWindow: true,
    });
    const auth = authority(cfg, GRAY);
    const draft = buildBoardPublishDraftFromIntent({
      message: "请今晚前交付 overnight 能源报告并带来源",
      groupId: GRAY,
      taskId: "task_s1_quality",
      publishedBy: "lead_bot",
    });
    expect(draft?.acceptanceCriteria).toEqual([]);
    expect(draft?.quality.ok).toBe(false);

    const result = await materializeIntentToBoardItem({
      authority: auth,
      input: {
        message: "请今晚前交付 overnight 能源报告并带来源",
        groupId: GRAY,
        taskId: "task_s1_quality",
        publishedBy: "lead_bot",
        humanConfirmed: true,
      },
      cfg,
    });
    expect(result.status).toBe("needs_confirm");
  });

  test("publish → challenge(1蓝) → resolve(absorb+reason) → claim → apply", async () => {
    const { cfg } = await useFixture({
      claimAllowlist: [GRAY],
      challengeWindow: true,
    });
    const auth = authority(cfg, GRAY);
    const taskId = "task_s1_full";
    const draftSnapshot = {
      goal: "交付 AI×能源 overnight 调研报告",
      remainingWork: "撰写 overnight 报告并附来源",
      acceptanceCriteria: ["含可核对来源", "发电侧/用电侧各≥3要点"],
      constraints: ["必须带来源/引用", "禁止外发未脱敏数据"],
      intendedClaimantIds: ["bot-analyst"],
    };

    const opened = await openChallengeWindow(
      auth,
      {
        taskId,
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: draftSnapshot,
        windowId: "win_s1_1",
      },
      { cfg, nowMs: 1000 },
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.value.challengerId).toBe("blue_bot");

    // Second challenger refused (single-蓝)
    const stranger = await recordChallengeCritique(
      auth,
      {
        taskId,
        windowId: "win_s1_1",
        challengerId: "stranger_bot",
        issues: ["acceptance_gap"],
        comment: "not designated",
      },
      { cfg, nowMs: 1100 },
    );
    expect(stranger.ok).toBe(false);

    const critique = await recordChallengeCritique(
      auth,
      {
        taskId,
        windowId: "win_s1_1",
        challengerId: "blue_bot",
        issues: ["acceptance_gap"],
        comment: "Acceptance 缺量化阈值",
      },
      { cfg, nowMs: 1200 },
    );
    expect(critique.ok).toBe(true);

    const resolved = await resolveChallengeWindow(
      auth,
      {
        taskId,
        windowId: "win_s1_1",
        leadId: "lead_bot",
        decision: "absorb",
        reason: "吸收：补量化 Acceptance 与来源硬约束",
        revisedDraft: {
          ...draftSnapshot,
          acceptanceCriteria: ["含可核对来源", "发电侧/用电侧各≥3要点", "至少 2 个可量化指标"],
        },
      },
      { cfg, nowMs: 1300 },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.value.resolution?.decision).toBe("absorb");
    expect(resolved.value.resolution?.reason).toContain("量化");

    // Hang board only after resolve
    const published = await publishBoardItem(
      auth,
      {
        groupId: GRAY,
        taskId,
        remainingWork: draftSnapshot.remainingWork,
        acceptanceCriteria: ["含可核对来源", "发电侧/用电侧各≥3要点", "至少 2 个可量化指标"],
        goal: draftSnapshot.goal,
        constraints: draftSnapshot.constraints,
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "lead_bot",
        challengeWindowId: "win_s1_1",
      },
      { cfg, nowMs: 1400 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const claimed = await claimBoardItem(
      auth,
      { taskId, itemId: published.value.itemId, claimantId: "bot-analyst" },
      { cfg, nowMs: 1500 },
    );
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) {
      return;
    }

    const applied = await applyClaim(
      auth,
      { taskId, itemId: published.value.itemId },
      seedTask(taskId),
      auth.policy.effective,
      { cfg, nowMs: 1600 },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.value.item.status).toBe("applied");
    expect(applied.value.assignedMemberIds).toContain("bot-analyst");
  });

  test("skip path: skipChallengeWindow → publish → claim (still auditable skip)", async () => {
    const { cfg } = await useFixture({
      claimAllowlist: [GRAY],
      challengeWindow: true,
    });
    const auth = authority(cfg, GRAY);
    const taskId = "task_s1_skip";
    const draft = {
      goal: "交付周报摘要",
      remainingWork: "整理本周协作周报",
      acceptanceCriteria: ["含本周完成项清单"],
      constraints: ["仅组内可见"],
    };
    const skipped = await skipChallengeWindow(
      auth,
      {
        groupId: GRAY,
        taskId,
        leadId: "lead_bot",
        draft,
        skipReason: "低风险例行周报，主答显式跳过短红蓝",
        windowId: "win_s1_skip",
      },
      { cfg, nowMs: 2000 },
    );
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) {
      return;
    }
    expect(skipped.value.status).toBe("skipped");
    expect(skipped.value.skipReason).toContain("跳过");

    const published = await publishBoardItem(
      auth,
      {
        groupId: GRAY,
        taskId,
        remainingWork: draft.remainingWork,
        acceptanceCriteria: draft.acceptanceCriteria,
        goal: draft.goal,
        constraints: draft.constraints,
        publishedBy: "lead_bot",
        challengeWindowId: "win_s1_skip",
      },
      { cfg, nowMs: 2100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      { taskId, itemId: published.value.itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    // No intendedClaimantIds → any member may claim depending on implementation
    expect(claimed.ok).toBe(true);
  });

  test("managed gray tip key uses scoped allowlist 001/grp-… (bare does not authorize)", async () => {
    const { cfg } = await useFixture({
      claimAllowlist: [SCOPED],
      challengeWindow: false,
    });
    // Bare groupId allowlist path: with tenant 001, only scoped entry matches
    expect(isCollabTaskClaimContractEnabled(cfg, GRAY, "001")).toBe(true);
    expect(isCollabTaskClaimContractEnabled(cfg, GRAY, "002")).toBe(false);

    const { cfg: bareCfg } = await useFixture({
      claimAllowlist: [GRAY],
      challengeWindow: false,
    });
    expect(isCollabTaskClaimContractEnabled(bareCfg, GRAY, "001")).toBe(false);
    expect(isCollabTaskClaimContractEnabled(bareCfg, GRAY, null)).toBe(true);
  });
});

/**
 * P5 — Single-challenger challenge window unit tests.
 * Flag-off: no writes / publish unchanged.
 * Flag-on: exactly 1 蓝 → critique → 红 absorb|reject → ledger; publish gated.
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
import {
  assertChallengeWindowForPublish,
  challengeWindowMustNotDriveAdmission,
  isCollabTaskChallengeWindowEnabled,
  isGroupOnChallengeWindowAllowlist,
  listChallengeWindows,
  openChallengeWindow,
  recordChallengeCritique,
  resolveChallengeWindow,
  skipChallengeWindow,
} from "./challenge-window.js";
import { publishBoardItem } from "./claim-contract.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";

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
    claimContract: boolean;
    challengeWindow: boolean;
    challengeWindowGroupAllowlist?: string[];
    securityProfile?: "personal_local" | "managed_enterprise";
  },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: opts.securityProfile ?? "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: opts.claimContract,
        challengeWindow: opts.challengeWindow,
        ...(opts.challengeWindowGroupAllowlist
          ? { challengeWindowGroupAllowlist: opts.challengeWindowGroupAllowlist }
          : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: {
  claimContract: boolean;
  challengeWindow: boolean;
  challengeWindowGroupAllowlist?: string[];
  securityProfile?: "personal_local" | "managed_enterprise";
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p5-challenge-"));
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

function authority(cfg: OpenBotConfig, groupId = "grp_challenge"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_challenge_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_challenge",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

function managedAuthority(cfg: OpenBotConfig, tenantId: string, groupId: string): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => `pss_challenge_${tenantId}` },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: `ep_challenge_${tenantId}`,
    tenant: { tenantId, trust: "membership" },
    groupId,
    profile: "managed_enterprise",
    cfg,
  });
}

const SAMPLE_GRAY = "grp-daniel-hhd-gmail-com-upbeyond";

const DRAFT = {
  goal: "交付 AI×能源周报",
  remainingWork: "交付 AI×能源周报",
  acceptanceCriteria: ["含来源", "主答可验收"],
  constraints: ["不得口头派工"],
  suggestedRole: "analyst",
  title: "能源周报",
};

describe("P5 challengeWindow", () => {
  test("challengeWindow defaults off; drivesAdmission invariant", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: false });
    expect(isCollabTaskChallengeWindowEnabled(cfg)).toBe(false);
    expect(challengeWindowMustNotDriveAdmission()).toBe(true);
  });

  test("flag-off: openChallengeWindow does not write", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: false });
    const auth = authority(cfg);
    const opened = await openChallengeWindow(
      auth,
      {
        taskId: "task_a",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
      },
      { cfg, nowMs: 1000 },
    );
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.reason).toBe("flag_off");
    }
    expect(await listChallengeWindows(auth, { taskId: "task_a" })).toEqual([]);
  });

  test("flag-off: publishBoardItem unchanged (no challenge required)", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: false });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_challenge",
        taskId: "task_pub_off",
        remainingWork: DRAFT.remainingWork,
        acceptanceCriteria: DRAFT.acceptanceCriteria,
        goal: DRAFT.goal,
        publishedBy: "lead_bot",
      },
      { cfg, nowMs: 2000 },
    );
    expect(published.ok).toBe(true);
  });

  test("flag-on: exactly 1 蓝 → critique → absorb; ledger auditable; then publish", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: true });
    const auth = authority(cfg);
    expect(isCollabTaskChallengeWindowEnabled(cfg)).toBe(true);

    const opened = await openChallengeWindow(
      auth,
      {
        taskId: "task_rb",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
        windowId: "win_1",
      },
      { cfg, nowMs: 3000 },
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.value.challengerId).toBe("blue_bot");
    expect(opened.value.status).toBe("open");
    expect(opened.value.drivesAdmission).toBe(false);

    const otherBlue = await recordChallengeCritique(
      auth,
      {
        taskId: "task_rb",
        windowId: "win_1",
        challengerId: "other_bot",
        issues: ["acceptance_gap"],
        comment: "验收缺量化指标",
      },
      { cfg, nowMs: 3100 },
    );
    expect(otherBlue.ok).toBe(false);
    if (!otherBlue.ok) {
      expect(otherBlue.reason).toBe("challenger_mismatch");
    }

    const critique = await recordChallengeCritique(
      auth,
      {
        taskId: "task_rb",
        windowId: "win_1",
        challengerId: "blue_bot",
        issues: ["acceptance_gap", "scope_drift"],
        comment: "验收缺量化；范围可能飘到全行业综述",
      },
      { cfg, nowMs: 3200 },
    );
    expect(critique.ok).toBe(true);
    if (!critique.ok) {
      return;
    }
    expect(critique.value.status).toBe("challenged");
    expect(critique.value.critiques).toHaveLength(1);
    expect(critique.value.critiques[0]?.issues).toEqual(["acceptance_gap", "scope_drift"]);

    const resolveTooEarlyLead = await resolveChallengeWindow(
      auth,
      {
        taskId: "task_rb",
        windowId: "win_1",
        leadId: "not_lead",
        decision: "absorb",
        reason: "wrong lead",
      },
      { cfg, nowMs: 3300 },
    );
    expect(resolveTooEarlyLead.ok).toBe(false);
    if (!resolveTooEarlyLead.ok) {
      expect(resolveTooEarlyLead.reason).toBe("lead_mismatch");
    }

    const resolved = await resolveChallengeWindow(
      auth,
      {
        taskId: "task_rb",
        windowId: "win_1",
        leadId: "lead_bot",
        decision: "absorb",
        reason: "补量化 Acceptance；收窄为能源政策周报",
        revisedDraft: {
          ...DRAFT,
          acceptanceCriteria: ["含来源", "主答可验收", "至少 3 个量化指标"],
        },
      },
      { cfg, nowMs: 3400 },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.value.status).toBe("resolved");
    expect(resolved.value.resolution?.decision).toBe("absorb");
    expect(resolved.value.resolution?.reason).toContain("量化");

    const listed = await listChallengeWindows(auth, { taskId: "task_rb" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.resolution?.decision).toBe("absorb");

    const gate = await assertChallengeWindowForPublish(
      auth,
      { taskId: "task_rb", challengeWindowId: "win_1" },
      { cfg },
    );
    expect(gate.ok).toBe(true);

    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_challenge",
        taskId: "task_rb",
        remainingWork: DRAFT.remainingWork,
        acceptanceCriteria: ["含来源", "主答可验收", "至少 3 个量化指标"],
        goal: DRAFT.goal,
        publishedBy: "lead_bot",
        challengeWindowId: "win_1",
      },
      { cfg, nowMs: 3500 },
    );
    expect(published.ok).toBe(true);
  });

  test("flag-on: reject with reason is auditable; challenger===lead refused", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: true });
    const auth = authority(cfg);
    const self = await openChallengeWindow(
      auth,
      {
        taskId: "task_rej",
        leadId: "lead_bot",
        challengerId: "lead_bot",
        draft: DRAFT,
      },
      { cfg, nowMs: 4000 },
    );
    expect(self.ok).toBe(false);
    if (!self.ok) {
      expect(self.reason).toBe("challenger_is_lead");
    }

    const opened = await openChallengeWindow(
      auth,
      {
        taskId: "task_rej",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
        windowId: "win_rej",
      },
      { cfg, nowMs: 4100 },
    );
    expect(opened.ok).toBe(true);
    await recordChallengeCritique(
      auth,
      {
        taskId: "task_rej",
        windowId: "win_rej",
        challengerId: "blue_bot",
        issues: ["role_mismatch"],
        comment: "建议认领人角色与交付不匹配",
      },
      { cfg, nowMs: 4200 },
    );
    const rejected = await resolveChallengeWindow(
      auth,
      {
        taskId: "task_rej",
        windowId: "win_rej",
        leadId: "lead_bot",
        decision: "reject",
        reason: "角色提示仅供参考，不改 Acceptance",
      },
      { cfg, nowMs: 4300 },
    );
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) {
      return;
    }
    expect(rejected.value.resolution?.decision).toBe("reject");
  });

  test("flag-on: publish without window refused; skipChallengeWindow allows; unresolved blocks", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: true });
    const auth = authority(cfg);

    const blocked = await publishBoardItem(
      auth,
      {
        groupId: "grp_challenge",
        taskId: "task_gate",
        remainingWork: DRAFT.remainingWork,
        acceptanceCriteria: DRAFT.acceptanceCriteria,
        publishedBy: "lead_bot",
      },
      { cfg, nowMs: 5000 },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("challenge_window_required");
    }

    const skippedPub = await publishBoardItem(
      auth,
      {
        groupId: "grp_challenge",
        taskId: "task_gate_skip",
        remainingWork: DRAFT.remainingWork,
        acceptanceCriteria: DRAFT.acceptanceCriteria,
        publishedBy: "lead_bot",
        skipChallengeWindow: true,
      },
      { cfg, nowMs: 5100 },
    );
    expect(skippedPub.ok).toBe(true);

    const opened = await openChallengeWindow(
      auth,
      {
        taskId: "task_open_block",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
        windowId: "win_open",
      },
      { cfg, nowMs: 5200 },
    );
    expect(opened.ok).toBe(true);
    const openBlock = await publishBoardItem(
      auth,
      {
        groupId: "grp_challenge",
        taskId: "task_open_block",
        remainingWork: DRAFT.remainingWork,
        acceptanceCriteria: DRAFT.acceptanceCriteria,
        publishedBy: "lead_bot",
        challengeWindowId: "win_open",
      },
      { cfg, nowMs: 5300 },
    );
    expect(openBlock.ok).toBe(false);
    if (!openBlock.ok) {
      expect(["challenge_window_open", "challenge_window_unresolved"]).toContain(openBlock.reason);
    }

    const skipped = await skipChallengeWindow(
      auth,
      {
        taskId: "task_skip_rec",
        leadId: "lead_bot",
        draft: DRAFT,
        skipReason: "紧急挂板，人确认可关修正窗",
        windowId: "win_skip",
      },
      { cfg, nowMs: 5400 },
    );
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) {
      return;
    }
    expect(skipped.value.status).toBe("skipped");
    const pubAfterSkip = await publishBoardItem(
      auth,
      {
        groupId: "grp_challenge",
        taskId: "task_skip_rec",
        remainingWork: DRAFT.remainingWork,
        acceptanceCriteria: DRAFT.acceptanceCriteria,
        publishedBy: "lead_bot",
        challengeWindowId: "win_skip",
      },
      { cfg, nowMs: 5500 },
    );
    expect(pubAfterSkip.ok).toBe(true);
  });

  test("resolve without critique refused", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: true });
    const auth = authority(cfg);
    await openChallengeWindow(
      auth,
      {
        taskId: "task_nocrit",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
        windowId: "win_nocrit",
      },
      { cfg, nowMs: 6000 },
    );
    const resolved = await resolveChallengeWindow(
      auth,
      {
        taskId: "task_nocrit",
        windowId: "win_nocrit",
        leadId: "lead_bot",
        decision: "absorb",
        reason: "无挑战也吸收",
      },
      { cfg, nowMs: 6100 },
    );
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toBe("critique_required");
    }
  });
});

describe("P5 challengeWindowGroupAllowlist (gray scoped)", () => {
  test("defaults: global false + empty allowlist → off", async () => {
    const { cfg } = await useConfig({ claimContract: true, challengeWindow: false });
    expect(isCollabTaskChallengeWindowEnabled(cfg)).toBe(false);
    expect(isCollabTaskChallengeWindowEnabled(cfg, SAMPLE_GRAY, "001")).toBe(false);
    expect(isGroupOnChallengeWindowAllowlist({ groupId: SAMPLE_GRAY, tenantId: "001", cfg })).toBe(
      false,
    );
  });

  test("bare groupId never authorizes managed tenant caller", async () => {
    const { cfg } = await useConfig({
      claimContract: true,
      challengeWindow: false,
      challengeWindowGroupAllowlist: [SAMPLE_GRAY],
      securityProfile: "managed_enterprise",
    });
    expect(isCollabTaskChallengeWindowEnabled(cfg)).toBe(false);
    expect(isCollabTaskChallengeWindowEnabled(cfg, SAMPLE_GRAY, "001")).toBe(false);
    expect(isGroupOnChallengeWindowAllowlist({ groupId: SAMPLE_GRAY, tenantId: "001", cfg })).toBe(
      false,
    );

    const auth = managedAuthority(cfg, "001", SAMPLE_GRAY);
    const opened = await openChallengeWindow(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task_bare",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
      },
      { cfg, nowMs: 7000 },
    );
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.reason).toBe("flag_off");
    }
  });

  test("cross-tenant: 001/group allowlist refuses tenant 002", async () => {
    const { cfg } = await useConfig({
      claimContract: true,
      challengeWindow: false,
      challengeWindowGroupAllowlist: [`001/${SAMPLE_GRAY}`],
      securityProfile: "managed_enterprise",
    });
    expect(isCollabTaskChallengeWindowEnabled(cfg, SAMPLE_GRAY, "001")).toBe(true);
    expect(isCollabTaskChallengeWindowEnabled(cfg, SAMPLE_GRAY, "002")).toBe(false);
    expect(isGroupOnChallengeWindowAllowlist({ groupId: SAMPLE_GRAY, tenantId: "002", cfg })).toBe(
      false,
    );

    const auth002 = managedAuthority(cfg, "002", SAMPLE_GRAY);
    const refused = await openChallengeWindow(
      auth002,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task_xtenant",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
      },
      { cfg, nowMs: 7100 },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("flag_off");
    }
  });

  test("allowlist hit enables window without global challengeWindow=true", async () => {
    const { cfg } = await useConfig({
      claimContract: true,
      challengeWindow: false,
      challengeWindowGroupAllowlist: [`001/${SAMPLE_GRAY}`],
      securityProfile: "managed_enterprise",
    });
    expect(isCollabTaskChallengeWindowEnabled(cfg)).toBe(false);
    expect(isCollabTaskChallengeWindowEnabled(cfg, SAMPLE_GRAY, "001")).toBe(true);
    expect(isGroupOnChallengeWindowAllowlist({ groupId: SAMPLE_GRAY, tenantId: "001", cfg })).toBe(
      true,
    );

    const auth = managedAuthority(cfg, "001", SAMPLE_GRAY);
    const opened = await openChallengeWindow(
      auth,
      {
        groupId: SAMPLE_GRAY,
        taskId: "task_allow",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
        windowId: "win_allow",
      },
      { cfg, nowMs: 7200 },
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.value.windowId).toBe("win_allow");
    expect(opened.value.status).toBe("open");

    // Other group still fail-closed
    const other = managedAuthority(cfg, "001", "grp-other");
    const otherOpen = await openChallengeWindow(
      other,
      {
        groupId: "grp-other",
        taskId: "task_other",
        leadId: "lead_bot",
        challengerId: "blue_bot",
        draft: DRAFT,
      },
      { cfg, nowMs: 7300 },
    );
    expect(otherOpen.ok).toBe(false);
    if (!otherOpen.ok) {
      expect(otherOpen.reason).toBe("flag_off");
    }

    // publish gate: allowlist ON requires challengeWindowId (fresh task, no window yet)
    const gate = await assertChallengeWindowForPublish(
      auth,
      { taskId: "task_need_window", groupId: SAMPLE_GRAY },
      { cfg },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe("challenge_window_required");
    }
    // open unresolved window for same task blocks publish until resolve/skip
    const openGate = await assertChallengeWindowForPublish(
      auth,
      { taskId: "task_allow", groupId: SAMPLE_GRAY, challengeWindowId: "win_allow" },
      { cfg },
    );
    expect(openGate.ok).toBe(false);
    if (!openGate.ok) {
      expect(openGate.reason).toBe("challenge_window_open");
    }
  });
});
